// POST /api/register, /api/login, /api/logout, GET /api/me
// POST /api/password/forgot, POST /api/password/reset
const { Router } = require('express');
const crypto = require('crypto');
const { ah } = require('../async');
const { sendEmail, passwordResetHtml } = require('../email');
const {
  hashPassword, checkPassword, createSession,
  setSessionCookie, destroySession, authRequired, COOKIE_NAME,
} = require('../auth');
const { QUEST_DEFS, periodKey } = require('../catalog');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function seedStarterKit(db, userId, now) {
  await db.run('INSERT INTO wallets (user_id,coins,gems,food,xp,level) VALUES (?,?,?,?,?,?)',
    userId, 500, 10, 5, 0, 1);
  await db.run('INSERT INTO user_tanks (user_id,small,medium,large,active) VALUES (?,?,?,?,?)',
    userId, 1, 0, 0, 'small');
  // New players start with a nursery too
  await db.run('UPDATE user_tanks SET nursery=1 WHERE user_id=?', userId);
  await db.run('INSERT INTO dirt_state (user_id,last_cleaned_at) VALUES (?,?)', userId, now);
  await db.run('INSERT INTO settings (user_id,music,sfx,quality) VALUES (?,?,?,?)',
    userId, 1, 1, 'high');

  const lineage = JSON.stringify({ mother: null, father: null, hybrid: 0, generation: 0 });
  const fishSql =
    `INSERT INTO fish (user_id,species_id,grp,variant,gender,location,tank,x,y,born_at,fed_at,lineage)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
  await db.run(fishSql, userId, 'sakura_goldfish', 'goldfish', 'sakura_goldfish', 'female',
    'tank', 'small', 0.35, 0.5, now, now, lineage);
  await db.run(fishSql, userId, 'azure_tang', 'goldfish', 'azure_tang', 'male',
    'tank', 'small', 0.6, 0.45, now, now, lineage);
  await db.run('INSERT INTO collection (user_id,species_id,count) VALUES (?,?,?)',
    userId, 'sakura_goldfish', 1);
  await db.run('INSERT INTO collection (user_id,species_id,count) VALUES (?,?,?)',
    userId, 'azure_tang', 1);

  for (const def of QUEST_DEFS) {
    await db.run(
      'INSERT OR IGNORE INTO quests (user_id,quest_id,period,progress,claimed) VALUES (?,?,?,?,0)',
      userId, def.id, periodKey(def.period, now), 0);
  }
}

module.exports = function authRoutes(db) {
  const r = Router();

  r.post('/register', ah(async (req, res) => {
    const { name, email, password } = req.body || {};
    const now = Math.floor(Date.now() / 1000);

    if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: 'name is required' });
    if (!email || !EMAIL_RE.test(String(email))) return res.status(400).json({ ok: false, error: 'valid email is required' });
    if (!password || String(password).length < 6) return res.status(400).json({ ok: false, error: 'password must be at least 6 characters' });

    const emailNorm = String(email).trim().toLowerCase();
    const exists = await db.get('SELECT id FROM users WHERE email=?', emailNorm);
    if (exists) return res.status(409).json({ ok: false, error: 'email already registered' });

    const pwHash = await hashPassword(String(password));
    const userId = await db.tx(async (t) => {
      const info = await t.run(
        'INSERT INTO users (name,email,password_hash,created_at) VALUES (?,?,?,?)',
        String(name).trim(), emailNorm, pwHash, now);
      await seedStarterKit(t, info.lastInsertRowid, now);
      return info.lastInsertRowid;
    });

    const token = await createSession(db, userId, now);
    setSessionCookie(res, token);
    const user = await db.get('SELECT id,name,email FROM users WHERE id=?', userId);
    res.status(201).json({ ok: true, user });
  }));

  r.post('/login', ah(async (req, res) => {
    const { email, password } = req.body || {};
    const now = Math.floor(Date.now() / 1000);
    if (!email || !password) return res.status(401).json({ ok: false, error: 'invalid credentials' });
    const row = await db.get('SELECT id,name,email,password_hash,is_guest FROM users WHERE email=?',
      String(email).trim().toLowerCase());
    if (!row || !(await checkPassword(String(password), row.password_hash))) {
      return res.status(401).json({ ok: false, error: 'invalid credentials' });
    }
    const token = await createSession(db, row.id, now);
    setSessionCookie(res, token);
    res.json({ ok: true, user: { id: row.id, name: row.name, email: row.email, is_guest: !!row.is_guest } });
  }));

  // Guest mode: play without an account. Creates a guest user (or reuses
  // the guest token from localStorage via ?reuse). Progress lives on the
  // server but is only reachable via the guest token.
  r.post('/guest', ah(async (req, res) => {
    const now = Math.floor(Date.now() / 1000);
    const { guest_token } = req.body || {};
    // Reuse existing guest session if the token is still valid
    if (guest_token) {
      const s = await db.get('SELECT user_id FROM sessions WHERE token=? AND expires_at>?', guest_token, now);
      if (s) {
        const u = await db.get('SELECT id,name,email,is_guest FROM users WHERE id=? AND is_guest=1', s.user_id);
        if (u) {
          const token = await createSession(db, u.id, now);
          setSessionCookie(res, token);
          return res.json({ ok: true, user: { id: u.id, name: u.name, email: u.email, is_guest: true }, guest_token: token });
        }
      }
    }
    // Create a fresh guest
    const gid = crypto.randomBytes(8).toString('hex');
    const email = `guest_${gid}@guest.local`;
    const pwHash = await hashPassword(crypto.randomBytes(16).toString('hex'));
    const userId = await db.tx(async (t) => {
      const info = await t.run(
        'INSERT INTO users (name,email,password_hash,created_at,is_guest) VALUES (?,?,?,?,1)',
        'Guest', email, pwHash, now);
      await seedStarterKit(t, info.lastInsertRowid, now);
      return info.lastInsertRowid;
    });
    const token = await createSession(db, userId, now);
    setSessionCookie(res, token);
    res.status(201).json({ ok: true, user: { id: userId, name: 'Guest', email, is_guest: true }, guest_token: token });
  }));

  // Convert a guest account into a real one (sets name/email/password)
  r.post('/claim', authRequired(db), ah(async (req, res) => {
    const { name, email, password } = req.body || {};
    const me = await db.get('SELECT id,is_guest FROM users WHERE id=?', req.user.id);
    if (!me || !me.is_guest) return res.status(400).json({ ok: false, error: 'not a guest account' });
    if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: 'name is required' });
    if (!email || !EMAIL_RE.test(String(email))) return res.status(400).json({ ok: false, error: 'valid email is required' });
    if (!password || String(password).length < 6) return res.status(400).json({ ok: false, error: 'password must be at least 6 characters' });
    const emailNorm = String(email).trim().toLowerCase();
    const exists = await db.get('SELECT id FROM users WHERE email=? AND id!=?', emailNorm, me.id);
    if (exists) return res.status(409).json({ ok: false, error: 'email already registered' });
    const pwHash = await hashPassword(String(password));
    await db.run('UPDATE users SET name=?, email=?, password_hash=?, is_guest=0 WHERE id=?',
      String(name).trim(), emailNorm, pwHash, me.id);
    const user = await db.get('SELECT id,name,email FROM users WHERE id=?', me.id);
    res.json({ ok: true, user: { ...user, is_guest: false } });
  }));

  r.post('/logout', authRequired(db), ah(async (req, res) => {
    await destroySession(db, req.cookies[COOKIE_NAME]);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  }));

  r.get('/me', authRequired(db), ah(async (req, res) => {
    const row = await db.get(
      `SELECT u.id,u.name,u.email,u.is_guest,w.level,w.xp,w.coins,w.gems,w.food
       FROM users u JOIN wallets w ON w.user_id=u.id WHERE u.id=?`,
      req.user.id
    );
    if (!row) return res.status(401).json({ ok: false, error: 'not logged in' });
    row.is_guest = !!row.is_guest;
    res.json({ ok: true, user: row });
  }));

  // ---------- forgot password ----------
  // Always returns ok:true (even for unknown emails) so nobody can probe
  // which emails are registered.
  r.post('/password/forgot', ah(async (req, res) => {
    const now = Math.floor(Date.now() / 1000);
    const emailNorm = String((req.body && req.body.email) || '').trim().toLowerCase();
    const user = emailNorm && EMAIL_RE.test(emailNorm)
      ? await db.get('SELECT id,name,email FROM users WHERE email=?', emailNorm)
      : null;
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await db.run(
        'INSERT INTO password_resets(user_id,token_hash,expires_at,used,created_at) VALUES(?,?,?,?,?)',
        user.id, tokenHash, now + 3600, 0, now);
      const base = (process.env.APP_URL || 'https://www.aquanimgame.com').replace(/\/$/, '');
      const resetUrl = `${base}/?reset=${token}`;
      sendEmail({
        to: user.email,
        subject: '🐠 Reset your AquaNim password',
        html: passwordResetHtml(resetUrl),
      }).catch((e) => console.error('[email] send failed:', e.message));
    }
    res.json({ ok: true });
  }));

  // ---------- reset password with token ----------
  r.post('/password/reset', ah(async (req, res) => {
    const now = Math.floor(Date.now() / 1000);
    const token = String((req.body && req.body.token) || '');
    const password = String((req.body && req.body.password) || '');
    if (!token || password.length < 6) {
      return res.status(400).json({ ok: false, error: 'invalid reset link or weak password' });
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = await db.get(
      'SELECT * FROM password_resets WHERE token_hash=? AND used=0', tokenHash);
    if (!row || row.expires_at < now) {
      return res.status(400).json({ ok: false, error: 'this reset link is invalid or expired' });
    }
    const pwHash = await hashPassword(password);
    await db.tx(async (t) => {
      await t.run('UPDATE users SET password_hash=? WHERE id=?', pwHash, row.user_id);
      await t.run('UPDATE password_resets SET used=1 WHERE id=?', row.id);
    });
    res.json({ ok: true });
  }));

  // ---------- change password (logged-in user) ----------
  r.post('/password/change', authRequired, ah(async (req, res) => {
    const uid = req.user.id;
    const current = String((req.body && req.body.current) || '');
    const password = String((req.body && req.body.password) || '');
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'password must be at least 6 characters' });
    }
    const row = await db.get('SELECT password_hash FROM users WHERE id=?', uid);
    if (!row || !(await checkPassword(current, row.password_hash))) {
      return res.status(400).json({ ok: false, error: 'current password is incorrect' });
    }
    const pwHash = await hashPassword(password);
    await db.run('UPDATE users SET password_hash=? WHERE id=?', pwHash, uid);
    res.json({ ok: true });
  }));

  return r;
};
