// Shared Express app factory for the Aquarium game.
// Used by:
//   - server/index.js  (standalone: local dev, Docker, Render-style hosts)
//   - api/index.js     (Vercel serverless function wrapper)
// The app serves the JSON API under /api and (standalone only) the frontend
// from ../public. On Vercel, static files are served by the CDN via
// vercel.json rewrites, so the function only ever sees /api/* and /health.
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { openDb } = require('./db');
const { authRequired } = require('./auth');
const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');
const { paymentRoutes, stripeWebhookHandler } = require('./routes/payments');

async function createApp() {
  const db = await openDb();
  const app = express();

  // Stripe webhook needs the RAW body for signature verification,
  // and no auth (Stripe calls it, not the player). Mount before express.json().
  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }),
    stripeWebhookHandler(db));

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/api', authRoutes(db));
  app.use('/api', authRequired(db), gameRoutes(db));
  app.use('/api', authRequired(db), paymentRoutes(db));

  // Frontend (single-container deploy): serve public/ for everything non-API.
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  app.use((req, res) => res.status(404).json({ ok: false, error: 'not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('unhandled error:', err);
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: 'invalid JSON body' });
    }
    res.status(500).json({ ok: false, error: 'internal error' });
  });

  return app;
}

module.exports = { createApp };
