// Meadow (Prado) — the Room Decorator test game, ported into AquaNim as a
// gated area. ONLY user_id 2 (Carl) and user_id 6 (Lilith) may open it;
// every endpoint below enforces that server-side, not just by hiding UI.
// Editing progress saves server-side per user (meadow_state); the shop
// uses a SEPARATE meadow gold balance (starts at 50,000 like the test) and
// never touches the real AquaNim coin wallet. Realtime visits reuse the
// house presence pattern: ~1.5s heartbeat, 12s stale window, max 20 peers.
const { Router } = require('express');
const { ah } = require('../async');

const MEADOW_ALLOWED = new Set([2, 6]);
const MEADOW_START_GOLD = 50000;
const PRESENCE_STALE = 12; // seconds
const PRESENCE_MAX_CHAT = 140;
const ROOM_SIZES = { home: 60, store: 42 };

// Shop prices, exactly like the test version. Furniture is ONLY the farm
// set now (old ocean/wood/asia/basic sets are gone from the catalog);
// every animal costs 10. Aquarium tanks are NOT buyable here — the
// meadow only places tanks the player already owns in AquaNim (see
// /api/house), so they are excluded from this table.
const FURNITURE_PRICE = 400;
const ANIMAL_PRICES = { duck: 10, turkey: 10, hen: 10, chick: 10, pig: 10, piglet: 10, horse: 10, sheep: 10 };

const FURNITURE_TYPES = new Set([
  // farm (47) — the only furniture set in the shop now
  'farm_barn', 'farm_open_barn', 'farm_coop_red', 'farm_coop_green',
  'farm_shelter_blue', 'farm_shelter_green', 'farm_shelter_hay', 'farm_shelter_red', 'farm_shelter_pool',
  'farm_trough_hay', 'farm_trough_water', 'farm_veg_crate', 'farm_hay_rack',
  'farm_hay_cart', 'farm_well', 'farm_bench_long', 'farm_crates',
  'farm_fence_ivy', 'farm_fence_plain', 'farm_gate', 'farm_picket_fence', 'farm_rope_fence',
  'farm_flower_arch', 'farm_flower_planter', 'farm_tree', 'farm_log',
  'farm_hay_barrel', 'farm_hay_net', 'farm_pump_trough', 'farm_feeder',
  'farm_hay_bales', 'farm_barrel_big', 'farm_barrel_pair', 'farm_barrel_small',
  'farm_feed_sack', 'farm_milk_can', 'farm_post', 'farm_lantern_post', 'farm_sign_heart',
  'farm_bench_small', 'farm_flower_bush', 'farm_stump',
  'farm_lamp_vine', 'farm_birdhouse_lamp', 'farm_lamp_post', 'farm_signpost',
  'farm_path_stones',
]);

const ANIMAL_KINDS = new Set(['sheep', 'ram', 'horse', 'duck', 'turkey', 'hen', 'chick', 'pig', 'piglet']);
const ANIMAL_POSES = {
  sheep: ['front', 'side', 'back', 'front_tilt', 'stand', 'sit', 'sleep', 'lounge', 'graze', 'back_small'],
  ram: ['front', 'side', 'back', 'front_tilt', 'stand', 'sit', 'sleep', 'lounge', 'graze'],
  horse: ['front', 'side', 'back', 'front_tilt', 'bow', 'sit', 'sleep', 'lounge', 'graze'],
  duck: ['front', 'side', 'back', 'stand', 'preen', 'sleep', 'lounge', 'happy', 'graze'],
  turkey: ['front', 'side', 'back', 'call', 'stand', 'preen', 'sleep', 'graze'],
  hen: ['front', 'side', 'back', 'peck', 'stand', 'wings', 'sleep'],
  chick: ['front', 'back', 'peck', 'chirp', 'wings', 'sleep'],
  pig: ['front', 'side', 'back', 'stand', 'graze', 'happy', 'sit', 'lounge', 'sleep', 'mud'],
  piglet: ['front', 'side', 'back', 'happy', 'sit', 'lounge', 'rest', 'peck', 'sleep', 'mud'],
};
const walkPose = (kind, pose) => {
  if (!pose) return 'front';
  if (/^walk[0-7]$/.test(pose)) return pose;
  const list = ANIMAL_POSES[kind] || [];
  return list.includes(pose) ? pose : 'front';
};

module.exports = function meadowRoutes(db) {
  const r = Router();
  const now = () => Math.floor(Date.now() / 1000);
  const allowed = (req, res) => {
    if (!MEADOW_ALLOWED.has(req.user.id)) {
      res.status(403).json({ ok: false, error: 'meadow locked' });
      return false;
    }
    return true;
  };
  const getStateRow = (uid) => db.get('SELECT state, gold FROM meadow_state WHERE user_id=?', uid);

  // Ungated on purpose: the main game calls this to decide whether to
  // show the entry button. It reveals nothing but {allowed, user_id}.
  r.get('/meadow/access', ah(async (req, res) => {
    res.json({ ok: true, allowed: MEADOW_ALLOWED.has(req.user.id), user_id: req.user.id });
  }));

  r.get('/meadow/state', ah(async (req, res) => {
    if (!allowed(req, res)) return;
    const row = await getStateRow(req.user.id);
    let state = null;
    if (row && row.state) {
      try { state = JSON.parse(row.state); } catch (e) { state = null; }
    }
    res.json({ ok: true, user_id: req.user.id, gold: row ? row.gold : MEADOW_START_GOLD, state });
  }));

  // Save editing progress. The client sends the test version's
  // housePayload; only rooms/activeRoom/char are stored. Client-supplied
  // gold, tanks and tankFish are IGNORED (gold is server-authoritative
  // via /meadow/buy; tanks come from /api/house).
  r.post('/meadow/save', ah(async (req, res) => {
    if (!allowed(req, res)) return;
    const b = req.body || {};
    const rooms = b.rooms;
    if (!rooms || typeof rooms !== 'object' || Array.isArray(rooms))
      return res.status(400).json({ ok: false, error: 'bad rooms' });
    for (const id of Object.keys(rooms)) {
      if (!ROOM_SIZES[id]) return res.status(400).json({ ok: false, error: 'bad room' });
      const rd = rooms[id];
      if (!rd || typeof rd !== 'object' || !Array.isArray(rd.items) || rd.items.length > 400)
        return res.status(400).json({ ok: false, error: 'bad room state' });
      if (Number(rd.size) < 6 || Number(rd.size) > 72)
        return res.status(400).json({ ok: false, error: 'bad room size' });
      if (Array.isArray(rd.animals) && rd.animals.length > 60)
        return res.status(400).json({ ok: false, error: 'too many animals' });
    }
    const char = b.char === 'cat' ? 'cat' : 'lyh';
    const activeRoom = ROOM_SIZES[b.activeRoom] ? b.activeRoom : 'home';
    const stored = JSON.stringify({ rooms, activeRoom, char });
    const t = now();
    await db.run(`INSERT INTO meadow_state (user_id, state, gold, updated_at)
        VALUES (?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`,
      req.user.id, stored, MEADOW_START_GOLD, t);
    // A first save must not reset an existing gold balance: the upsert
    // above only sets gold on insert (the conflict branch leaves it).
    const row = await getStateRow(req.user.id);
    res.json({ ok: true, gold: row ? row.gold : MEADOW_START_GOLD });
  }));

  // Shop purchase against the SEPARATE meadow balance. The layout itself
  // persists only via /meadow/save, so buying then closing without a save
  // keeps the deduction but loses the item — same as the test version.
  r.post('/meadow/buy', ah(async (req, res) => {
    if (!allowed(req, res)) return;
    const b = req.body || {};
    let price = null;
    if (b.kind === 'furniture' && FURNITURE_TYPES.has(b.type)) price = FURNITURE_PRICE;
    else if (b.kind === 'animal' && ANIMAL_PRICES[b.sp] != null) price = ANIMAL_PRICES[b.sp];
    else return res.status(400).json({ ok: false, error: 'unknown item' });
    const row = await getStateRow(req.user.id);
    const gold = row ? row.gold : MEADOW_START_GOLD;
    if (gold < price) return res.status(400).json({ ok: false, error: 'not enough gold', gold });
    const t = now();
    await db.run(`INSERT INTO meadow_state (user_id, state, gold, updated_at)
        VALUES (?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET gold=excluded.gold, updated_at=excluded.updated_at`,
      req.user.id, null, gold - price, t);
    res.json({ ok: true, gold: gold - price });
  }));

  // Read-only visit: BOTH the visitor and the owner must be allowed.
  // Returns the owner's name + saved meadow state (rooms/activeRoom/char).
  r.get('/meadow/visit/:id', ah(async (req, res) => {
    if (!allowed(req, res)) return;
    const ownerId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(ownerId) || !MEADOW_ALLOWED.has(ownerId))
      return res.status(404).json({ ok: false, error: 'user not found' });
    const owner = await db.get('SELECT id, name FROM users WHERE id=?', ownerId);
    if (!owner) return res.status(404).json({ ok: false, error: 'user not found' });
    const row = await getStateRow(ownerId);
    let state = null;
    if (row && row.state) {
      try { state = JSON.parse(row.state); } catch (e) { state = null; }
    }
    res.json({ ok: true, owner_id: owner.id, username: owner.name || '', state });
  }));

  // Realtime presence, modeled on /house/presence. owner_id is the meadow
  // OWNER (self in owner mode, the visited user in visit mode). Animals
  // ride the heartbeat so visitors see the owner's pets moving live; when
  // the owner is offline, the visitor's client falls back to the saved
  // spots from /meadow/visit (static).
  r.post('/meadow/presence', ah(async (req, res) => {
    if (!allowed(req, res)) return;
    const uid = req.user.id; const t = now();
    const b = req.body || {};
    const ownerId = Number.parseInt(b.owner_id, 10);
    if (!Number.isInteger(ownerId) || !MEADOW_ALLOWED.has(ownerId))
      return res.status(404).json({ ok: false, error: 'user not found' });
    const owner = await db.get('SELECT id FROM users WHERE id=?', ownerId);
    if (!owner) return res.status(404).json({ ok: false, error: 'user not found' });
    const room = ROOM_SIZES[b.room] ? b.room : 'home';
    const maxCoord = ROOM_SIZES[room];
    const clampPos = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(maxCoord, n)) : 0;
    };
    const x = clampPos(b.x), y = clampPos(b.y);
    const facing = Number(b.facing) < 0 ? -1 : 1;
    const north = b.north ? 1 : 0;
    const state = ['idle', 'walk', 'sit'].includes(b.state) ? b.state : 'idle';
    const char = b.char === 'cat' ? 'cat' : 'lyh';
    let chatText = null, chatUntil = null;
    if (typeof b.chat_text === 'string') {
      const ct = b.chat_text.trim().slice(0, PRESENCE_MAX_CHAT);
      const cu = Math.floor(Number(b.chat_until));
      if (ct && Number.isFinite(cu) && cu > t) {
        chatText = ct;
        chatUntil = Math.min(cu, t + 15);
      }
    }
    let animals = null;
    if (Array.isArray(b.animals) && b.animals.length <= 80) {
      const clean = [];
      for (const a of b.animals) {
        if (!a || typeof a !== 'object') continue;
        const kind = a.kind || a.sp;
        if (!ANIMAL_KINDS.has(kind)) continue;
        clean.push({
          kind,
          x: clampPos(a.x), y: clampPos(a.y),
          facing: Number(a.facing) < 0 ? -1 : 1,
          pose: walkPose(kind, a.pose),
        });
      }
      animals = JSON.stringify(clean);
    }
    await db.run(`INSERT INTO meadow_presence
        (user_id, owner_id, room, char, x, y, facing, north, state, chat_text, chat_until, animals, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET
          owner_id=excluded.owner_id, room=excluded.room, char=excluded.char,
          x=excluded.x, y=excluded.y, facing=excluded.facing, north=excluded.north,
          state=excluded.state, chat_text=excluded.chat_text, chat_until=excluded.chat_until,
          animals=excluded.animals, updated_at=excluded.updated_at`,
      uid, ownerId, room, char, x, y, facing, north, state, chatText, chatUntil, animals, t);
    const rows = await db.all(
      `SELECT p.user_id, u.name AS username, p.char, p.x, p.y, p.facing,
              p.north, p.state, p.chat_text, p.chat_until, p.animals
         FROM meadow_presence p JOIN users u ON u.id = p.user_id
        WHERE p.owner_id=? AND p.room=? AND p.user_id<>? AND p.updated_at>=?
        ORDER BY p.user_id LIMIT 20`, ownerId, room, uid, t - PRESENCE_STALE);
    const players = rows.map((row) => {
      const chatActive = !!(row.chat_text && row.chat_until && row.chat_until > t);
      let peerAnimals = [];
      if (row.animals) {
        try { peerAnimals = JSON.parse(row.animals) || []; } catch (e) { peerAnimals = []; }
      }
      return {
        user_id: row.user_id, username: row.username || '', char: row.char || 'lyh',
        x: row.x, y: row.y, facing: row.facing < 0 ? -1 : 1, north: !!row.north,
        state: row.state || 'idle',
        chat_text: chatActive ? row.chat_text : null,
        chat_until: chatActive ? row.chat_until : null,
        animals: peerAnimals,
      };
    });
    res.json({ ok: true, players });
  }));

  r.post('/meadow/presence/leave', ah(async (req, res) => {
    if (!allowed(req, res)) return;
    await db.run('DELETE FROM meadow_presence WHERE user_id=?', req.user.id);
    res.json({ ok: true });
  }));

  return r;
};
