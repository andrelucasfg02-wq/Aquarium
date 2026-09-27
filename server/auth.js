// Auth helpers: bcryptjs hashes (10 rounds), random 32-byte hex session
// tokens in `sessions`, HttpOnly cookie `aq_session`, 30-day expiry.
// All DB access is async (libSQL facade).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { ah } = require('./async');

const COOKIE_NAME = 'aq_session';
const SESSION_TTL_SEC = 30 * 24 * 3600;

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}
function checkPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

async function createSession(db, userId, now) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    token, userId, now, now + SESSION_TTL_SEC
  );
  return token;
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SEC * 1000,
  });
}

async function destroySession(db, token) {
  if (token) await db.run('DELETE FROM sessions WHERE token=?', token);
}

// Express middleware: attaches req.user = {id,name,email} or 401.
function authRequired(db) {
  return ah(async (req, res, next) => {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ ok: false, error: 'not logged in' });
    const now = Math.floor(Date.now() / 1000);
    const row = await db.get(
      `SELECT s.user_id, s.expires_at, u.name, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token=?`,
      token
    );
    if (!row || row.expires_at <= now) {
      await destroySession(db, token);
      res.clearCookie(COOKIE_NAME, { path: '/' });
      return res.status(401).json({ ok: false, error: 'session expired' });
    }
    req.user = { id: row.user_id, name: row.name, email: row.email };
    next();
  });
}

module.exports = {
  COOKIE_NAME, hashPassword, checkPassword,
  createSession, setSessionCookie, destroySession, authRequired,
};
