// Diamond pack purchases via Stripe Checkout, geo-priced by player country.
//
// Authenticated JSON routes (mounted under /api behind authRequired):
//   GET  /shop/diamonds/prices    -> { currency, packs: [{gems, display}] }
//   POST /shop/diamonds/checkout  -> {gems} -> {url} (Stripe Checkout redirect)
//
// Webhook (mounted in index.js BEFORE express.json(), with express.raw body):
//   POST /webhooks/stripe -> verifies Stripe-Signature, credits gems idempotently.
//
// Price IDs below were created in the Stripe Dashboard (live account).
// Display amounts mirror the Stripe amounts exactly — keep them in sync.
const { Router } = require('express');
const crypto = require('crypto');
const { ah } = require('../async');

const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://aquanimgame.com').replace(/\/$/, '');

// gems -> currency -> { price: Stripe Price ID, amount: minor units, display: store label }
const PACKS = {
  50: {
    BRL: { price: 'price_1UNpoT1ovwaJyKuGg4PYCfiQ', amount: 499,  display: 'R$ 4,99' },
    USD: { price: 'price_1UNpoT1ovwaJyKuGW1EpoBES', amount: 99,   display: '$0.99' },
    CAD: { price: 'price_1UNpma1ovwaJyKuGvtt8Uxk1', amount: 149,  display: '$1.49' },
  },
  100: {
    BRL: { price: 'price_1UNprD1ovwaJyKuGcb87az2c', amount: 899,  display: 'R$ 8,99' },
    USD: { price: 'price_1UNprD1ovwaJyKuGQ28as9uX', amount: 199,  display: '$1.99' },
    CAD: { price: 'price_1UNppX1ovwaJyKuGnU0ZJtyl', amount: 249,  display: '$2.49' },
  },
  300: {
    BRL: { price: 'price_1UNptJ1ovwaJyKuGCNxUGIp5', amount: 2999, display: 'R$ 29,99' },
    USD: { price: 'price_1UNptJ1ovwaJyKuGS28fCaKG', amount: 499,  display: '$4.99' },
    CAD: { price: 'price_1UNpsE1ovwaJyKuGKKD08Nhf', amount: 699,  display: '$6.99' },
  },
  600: {
    BRL: { price: 'price_1UNpw91ovwaJyKuGPUhIpJFe', amount: 4499, display: 'R$ 44,99' },
    USD: { price: 'price_1UNpw91ovwaJyKuGNuMVV1C3', amount: 899,  display: '$8.99' },
    CAD: { price: 'price_1UNpuO1ovwaJyKuGAp8yy29V', amount: 1199, display: '$11.99' },
  },
  1000: {
    BRL: { price: 'price_1UNq0v1ovwaJyKuGNdq7fIf9', amount: 6999, display: 'R$ 69,99' },
    USD: { price: 'price_1UNq051ovwaJyKuGVykWVtkY', amount: 1299, display: '$12.99' },
    CAD: { price: 'price_1UNpyt1ovwaJyKuGDYMW7YF1', amount: 1799, display: '$17.99' },
  },
};
const GEM_AMOUNTS = Object.keys(PACKS).map(Number).sort((a, b) => a - b);

// ---- geo: country -> currency ------------------------------------------------
const COUNTRY_CURRENCY = { BR: 'BRL', US: 'USD', CA: 'CAD' };
const geoCache = new Map(); // ip -> { cc, exp }

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  const ra = req.socket && req.socket.remoteAddress;
  return ra ? String(ra).replace(/^::ffff:/, '') : '';
}
function isPublicIp(ip) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(ip) &&
    !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ip);
}
async function countryForIp(ip) {
  if (!isPublicIp(ip)) return null;
  const hit = geoCache.get(ip);
  if (hit && hit.exp > Date.now()) return hit.cc;
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch(`https://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`,
      { signal: ctl.signal });
    clearTimeout(to);
    const j = await r.json();
    const cc = (j && j.status === 'success' && j.countryCode) ? String(j.countryCode) : null;
    geoCache.set(ip, { cc, exp: Date.now() + 6 * 3600e3 });
    if (geoCache.size > 5000) geoCache.clear();
    return cc;
  } catch (e) { return null; }
}
async function currencyForReq(req) {
  const cc = await countryForIp(clientIp(req));
  return COUNTRY_CURRENCY[cc] || 'USD';
}

// ---- Stripe REST (no SDK: plain fetch) ---------------------------------------
function stripeKey() { return process.env.STRIPE_SECRET_KEY || ''; }

async function stripePost(path, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.append(k, v);
  const r = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + stripeKey(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j && j.error && j.error.message) || `stripe ${r.status}`);
  return j;
}

async function createCheckoutSession({ uid, gems, priceId }) {
  return stripePost('/v1/checkout/sessions', {
    'mode': 'payment',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'success_url': `${PUBLIC_URL}/?shop=success`,
    'cancel_url': `${PUBLIC_URL}/?shop=cancelled`,
    'client_reference_id': String(uid),
    'metadata[user_id]': String(uid),
    'metadata[gems]': String(gems),
    'metadata[price_id]': priceId,
  });
}

// ---- webhook signature verification ------------------------------------------
function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = {};
  for (const p of String(header).split(',')) {
    const i = p.indexOf('=');
    if (i > 0) parts[p.slice(0, i)] = p.slice(i + 1);
  }
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
  const sigs = String(header).split(',')
    .filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return sigs.some((s) =>
    s.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

// ---- routes -------------------------------------------------------------------
function paymentRoutes(db) {
  const r = Router();

  // Localized diamond packs for the store UI.
  r.get('/shop/diamonds/prices', ah(async (req, res) => {
    const currency = await currencyForReq(req);
    const packs = GEM_AMOUNTS.map((gems) => ({
      gems,
      currency,
      display: PACKS[gems][currency].display,
    }));
    res.json({ ok: true, currency, packs });
  }));

  // Start a Stripe Checkout session for a pack. Currency is chosen
  // server-side from the player's IP — the client never picks the price.
  r.post('/shop/diamonds/checkout', ah(async (req, res) => {
    const uid = req.user.id;
    const gems = Number(req.body && req.body.gems);
    if (!PACKS[gems]) return res.status(400).json({ ok: false, error: 'invalid pack' });
    if (!stripeKey()) return res.status(503).json({ ok: false, error: 'payments_not_configured' });
    const currency = await currencyForReq(req);
    const pack = PACKS[gems][currency];
    try {
      const session = await createCheckoutSession({ uid, gems, priceId: pack.price });
      if (!session.url) throw new Error('no checkout url');
      res.json({ ok: true, url: session.url, currency });
    } catch (e) {
      console.error('stripe checkout failed:', e.message);
      res.status(502).json({ ok: false, error: 'checkout_failed' });
    }
  }));

  return r;
}

// Raw-body webhook handler. Mount BEFORE express.json() in index.js.
function stripeWebhookHandler(db) {
  return ah(async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
    const raw = req.body; // Buffer (express.raw)
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'], secret)) {
      return res.status(400).json({ ok: false, error: 'bad signature' });
    }
    let event;
    try { event = JSON.parse(raw.toString('utf8')); }
    catch (e) { return res.status(400).json({ ok: false, error: 'bad json' }); }

    if (event.type === 'checkout.session.completed') {
      const s = event.data && event.data.object ? event.data.object : {};
      // Idempotency: Stripe retries webhooks; never credit twice.
      const seen = await db.get('SELECT event_id FROM stripe_events WHERE event_id=?', event.id);
      if (!seen) {
        const uid = Number(s.metadata && s.metadata.user_id);
        const gems = Number(s.metadata && s.metadata.gems);
        const priceId = s.metadata && s.metadata.price_id;
        const validPack = PACKS[gems] &&
          Object.values(PACKS[gems]).some((p) => p.price === priceId);
        if (uid && validPack) {
          await db.run('UPDATE wallets SET gems=gems+? WHERE user_id=?', gems, uid);
        } else {
          console.error('stripe webhook: invalid metadata', event.id);
        }
        await db.run('INSERT INTO stripe_events (event_id, created_at) VALUES (?,?)',
          event.id, Math.floor(Date.now() / 1000));
      }
    }
    res.json({ received: true });
  });
}

module.exports = { paymentRoutes, stripeWebhookHandler, PACKS };
