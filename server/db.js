// libSQL (@libsql/client) setup — single code path for local file + Turso.
// - TURSO_DATABASE_URL + TURSO_AUTH_TOKEN set -> remote Turso database
//   (URL looks like libsql://<db>-<org>.turso.io).
// - otherwise -> local SQLite file (DB_PATH or ./data/aquarium.db), created on boot.
//
// All queries use `?` placeholders (SQLite dialect on both backends).
// Everything is async: db.get / db.all / db.run, and db.tx for transactions.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE,
      password_hash TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS sessions(
      token TEXT PRIMARY KEY, user_id INTEGER,
      created_at INTEGER, expires_at INTEGER);
    CREATE TABLE IF NOT EXISTS wallets(
      user_id INTEGER PRIMARY KEY, coins INTEGER, gems INTEGER,
      food INTEGER, xp INTEGER, level INTEGER);
    CREATE TABLE IF NOT EXISTS user_tanks(
      user_id INTEGER PRIMARY KEY, small INTEGER, medium INTEGER,
      large INTEGER, active TEXT);
    CREATE TABLE IF NOT EXISTS fish(
      id INTEGER PRIMARY KEY, user_id INTEGER, species_id TEXT, grp TEXT,
      variant TEXT, gender TEXT, location TEXT, tank TEXT,
      x REAL, y REAL, born_at INTEGER, fed_at INTEGER, lineage TEXT);
    CREATE TABLE IF NOT EXISTS eggs(
      id INTEGER PRIMARY KEY, user_id INTEGER, grp TEXT,
      variant_a TEXT, variant_b TEXT, hybrid INTEGER,
      generation INTEGER, hatch_at INTEGER, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS decor_owned(
      user_id INTEGER, deco_id TEXT, qty INTEGER, PRIMARY KEY(user_id,deco_id));
    CREATE TABLE IF NOT EXISTS decor_placements(
      id INTEGER PRIMARY KEY, user_id INTEGER, deco_id TEXT,
      tank TEXT, x REAL, y REAL);
    CREATE TABLE IF NOT EXISTS dirt_spots(
      id INTEGER PRIMARY KEY, user_id INTEGER, x REAL, y REAL, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS dirt_state(
      user_id INTEGER PRIMARY KEY, last_cleaned_at INTEGER);
    CREATE TABLE IF NOT EXISTS quests(
      user_id INTEGER, quest_id TEXT, period TEXT, progress INTEGER,
      claimed INTEGER, PRIMARY KEY(user_id,quest_id,period));
    CREATE TABLE IF NOT EXISTS collection(
      user_id INTEGER, species_id TEXT, count INTEGER, PRIMARY KEY(user_id,species_id));
    CREATE TABLE IF NOT EXISTS settings(
      user_id INTEGER PRIMARY KEY, music INTEGER, sfx INTEGER, quality TEXT);
    CREATE INDEX IF NOT EXISTS idx_fish_user ON fish(user_id);
    CREATE INDEX IF NOT EXISTS idx_eggs_user ON eggs(user_id);
    CREATE INDEX IF NOT EXISTS idx_dirt_user ON dirt_spots(user_id);
    CREATE INDEX IF NOT EXISTS idx_placements_user ON decor_placements(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `;

// Wrap a libsql client (or an open transaction, which exposes .execute too)
// in the db facade used across the codebase.
function wrap(handle) {
  return {
    // one row (object) or undefined
    get: async (sql, ...args) => (await handle.execute({ sql, args })).rows[0],
    // array of row objects
    all: async (sql, ...args) => (await handle.execute({ sql, args })).rows,
    // { lastInsertRowid: Number|undefined, changes: Number }
    run: async (sql, ...args) => {
      const r = await handle.execute({ sql, args });
      return {
        lastInsertRowid: r.lastInsertRowid == null ? undefined : Number(r.lastInsertRowid),
        changes: r.rowsAffected,
      };
    },
    // atomic multi-statement block; fn receives a tx-scoped facade
    tx: async (fn) => {
      const t = await handle.transaction('write');
      try {
        const out = await fn(wrap(t));
        await t.commit();
        return out;
      } catch (e) {
        try { await t.rollback(); } catch (_) { /* ignore */ }
        throw e;
      } finally {
        try { await t.close(); } catch (_) { /* ignore */ }
      }
    },
  };
}

async function openDb() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  const remote = !!(tursoUrl && tursoToken);

  let url;
  let describe;
  if (remote) {
    url = tursoUrl;
    describe = `turso (${tursoUrl})`;
  } else {
    const dbPath = process.env.DB_PATH || './data/aquarium.db';
    const resolved = path.resolve(process.cwd(), dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    url = 'file:' + resolved;
    describe = `local file (${resolved})`;
  }

  const client = remote
    ? createClient({ url, authToken: tursoToken })
    : createClient({ url });

  if (!remote) {
    // WAL is a local-file optimisation; meaningless (and rejected) on remote.
    try { await client.execute('PRAGMA journal_mode=WAL'); } catch (_) { /* non-fatal */ }
  }
  await client.executeMultiple(SCHEMA);

  const db = wrap(client);
  db.mode = remote ? 'turso' : 'local';
  db.describe = () => describe;
  db.close = () => client.close();
  return db;
}

module.exports = { openDb };
