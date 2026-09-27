// POST /api/register, /api/login, /api/logout, GET /api/me
const { Router } = require('express');
const { ah } = require('../async');
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
    const row = await db.get('SELECT id,name,email,password_hash FROM users WHERE email=?',
      String(email).trim().toLowerCase());
    if (!row || !(await checkPassword(String(password), row.password_hash))) {
      return res.status(401).json({ ok: false, error: 'invalid credentials' });
    }
    const token = await createSession(db, row.id, now);
    setSessionCookie(res, token);
    res.json({ ok: true, user: { id: row.id, name: row.name, email: row.email } });
  }));

  r.post('/logout', authRequired(db), ah(async (req, res) => {
    await destroySession(db, req.cookies[COOKIE_NAME]);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  }));

  r.get('/me', authRequired(db), ah(async (req, res) => {
    const row = await db.get(
      `SELECT u.id,u.name,u.email,w.level,w.xp,w.coins,w.gems,w.food
       FROM users u JOIN wallets w ON w.user_id=u.id WHERE u.id=?`,
      req.user.id
    );
    if (!row) return res.status(401).json({ ok: false, error: 'not logged in' });
    res.json({ ok: true, user: row });
  }));

  return r;
};
