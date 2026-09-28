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
      x REAL, y REAL, born_at INTEGER, fed_at INTEGER, lineage TEXT,
      nickname TEXT, origin TEXT, event_id TEXT);
    CREATE TABLE IF NOT EXISTS eggs(
      id INTEGER PRIMARY KEY, user_id INTEGER, grp TEXT,
      variant_a TEXT, variant_b TEXT, hybrid INTEGER,
      generation INTEGER, hatch_at INTEGER, created_at INTEGER, event_id TEXT);
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
    CREATE TABLE IF NOT EXISTS daily_shell(
      user_id INTEGER PRIMARY KEY, last_played_at INTEGER);
    CREATE TABLE IF NOT EXISTS event_progress(
      user_id INTEGER, event_id TEXT, score INTEGER, level INTEGER, moves INTEGER,
      updated_at INTEGER, PRIMARY KEY(user_id,event_id));
    CREATE TABLE IF NOT EXISTS event_rewards(
      user_id INTEGER, event_id TEXT, claimed_at INTEGER,
      PRIMARY KEY(user_id,event_id));
    CREATE TABLE IF NOT EXISTS market_listings(
      id INTEGER PRIMARY KEY, seller_id INTEGER, fish_id INTEGER UNIQUE,
      price_diamonds INTEGER, listed_at INTEGER);
    CREATE INDEX IF NOT EXISTS idx_market_seller ON market_listings(seller_id);
    CREATE INDEX IF NOT EXISTS idx_market_fish ON market_listings(fish_id);
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

  // lightweight migrations for databases created before a column existed
  try {
    const cols = await client.execute('PRAGMA table_info(fish)');
    if (!cols.rows.some((c) => c.name === 'nickname')) {
      await client.execute('ALTER TABLE fish ADD COLUMN nickname TEXT');
    }
    // marketplace: fish origin ('shop'|'bred'|'event') + source event id
    if (!cols.rows.some((c) => c.name === 'origin')) {
      await client.execute('ALTER TABLE fish ADD COLUMN origin TEXT');
    }
    if (!cols.rows.some((c) => c.name === 'event_id')) {
      await client.execute('ALTER TABLE fish ADD COLUMN event_id TEXT');
    }
    // backfill origin for fish created before the marketplace:
    // event fish first, then bred (has parents in lineage) vs shop-bought.
    await client.execute(
      "UPDATE fish SET origin='event', event_id='autumn1' WHERE origin IS NULL AND species_id='autumn_fish'");
    await client.execute(
      `UPDATE fish SET origin=CASE
         WHEN lineage IS NOT NULL AND json_extract(lineage,'$.mother') IS NOT NULL THEN 'bred'
         ELSE 'shop' END
       WHERE origin IS NULL`);
    const eggCols = await client.execute('PRAGMA table_info(eggs)');
    if (!eggCols.rows.some((c) => c.name === 'event_id')) {
      await client.execute('ALTER TABLE eggs ADD COLUMN event_id TEXT');
    }
  } catch (_) { /* non-fatal */ }

  const db = wrap(client);
  db.mode = remote ? 'turso' : 'local';
  db.describe = () => describe;
  db.close = () => client.close();
  return db;
}

module.exports = { openDb };
