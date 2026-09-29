// All authenticated /api game routes. Every query is filtered by user_id.
// All DB access is async (libSQL facade).
const { Router } = require('express');
const { ah } = require('../async');
const C = require('../catalog');

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// Weekly event config. ends_at = unix seconds when the event ends.
// Event fish (and their offspring) are trophies locked to the account while
// the event runs; they become market-tradeable only after it ends.
// ends_at: null = end date not announced yet (fish stay locked).
const EVENT_META = {
  autumn1: { goal: 300000, fish: 'autumn_fish', ends_at: null },
};
const EVENT_GOALS = { autumn1: EVENT_META.autumn1.goal };
const EVENT_FISH = { autumn1: EVENT_META.autumn1.fish };
const eventEnded = (eventId, nowT) => {
  const m = EVENT_META[eventId];
  return !!(m && m.ends_at != null && nowT >= m.ends_at);
};
// Marketplace tradeability:
// - shop-bought commons: bound to the account, never tradeable
// - bred fish: tradeable, unless they carry an event lineage whose event hasn't ended
// - event fish: locked as trophies until their event ends
const fishTradeable = (fish, nowT) => {
  if (!fish) return { ok: false, reason: 'fish not found' };
  if (fish.origin === 'shop' || !fish.origin) {
    return { ok: false, reason: '🎒 Shop fish are bound to your account' };
  }
  if (fish.event_id && !eventEnded(fish.event_id, nowT)) {
    return { ok: false, reason: '🏆 Event trophy — tradeable when the event ends' };
  }
  return { ok: true };
};

function helpers(db) {
  const getWallet = (uid) => db.get('SELECT * FROM wallets WHERE user_id=?', uid);
  const addCoins = (uid, n) => db.run('UPDATE wallets SET coins=coins+? WHERE user_id=?', n, uid);
  const addGems = (uid, n) => db.run('UPDATE wallets SET gems=gems+? WHERE user_id=?', n, uid);

  const addXp = async (uid, n) => {
    const w = await getWallet(uid);
    const xp = w.xp + n;
    const level = Math.floor(xp / 100) + 1;
    await db.run('UPDATE wallets SET xp=?, level=? WHERE user_id=?', xp, level, uid);
  };

  const getTanks = (uid) => db.get('SELECT * FROM user_tanks WHERE user_id=?', uid);
  const activeTank = async (uid) => (await getTanks(uid)).active;
  const tankFishCount = async (uid, tank) =>
    (await db.get("SELECT COUNT(*) c FROM fish WHERE user_id=? AND tank=? AND location='tank'", uid, tank)).c;
  const totalFishCount = async (uid) =>
    (await db.get('SELECT COUNT(*) c FROM fish WHERE user_id=?', uid)).c;

  // --- quests ---
  const ensureQuests = async (uid, now) => {
    for (const def of C.QUEST_DEFS) {
      await db.run(
        'INSERT OR IGNORE INTO quests (user_id,quest_id,period,progress,claimed) VALUES (?,?,?,?,0)',
        uid, def.id, C.periodKey(def.period, now), 0);
    }
  };
  const questRow = async (uid, questId, now) => {
    const def = C.QUEST_DEFS.find((d) => d.id === questId);
    if (!def) return null;
    return db.get('SELECT * FROM quests WHERE user_id=? AND quest_id=? AND period=?',
      uid, questId, C.periodKey(def.period, now));
  };
  const questProgressAdd = async (uid, questId, amount, now) => {
    await ensureQuests(uid, now);
    const def = C.QUEST_DEFS.find((d) => d.id === questId);
    await db.run('UPDATE quests SET progress=progress+? WHERE user_id=? AND quest_id=? AND period=?',
      amount, uid, questId, C.periodKey(def.period, now));
  };
  const questProgressMax = async (uid, questId, value, now) => {
    await ensureQuests(uid, now);
    const def = C.QUEST_DEFS.find((d) => d.id === questId);
    await db.run(`UPDATE quests SET progress=MAX(progress,?) WHERE user_id=? AND quest_id=? AND period=?`,
      value, uid, questId, C.periodKey(def.period, now));
  };
  const questList = async (uid, now) => {
    await ensureQuests(uid, now);
    const out = [];
    for (const def of C.QUEST_DEFS) {
      const row = await db.get('SELECT progress,claimed FROM quests WHERE user_id=? AND quest_id=? AND period=?',
        uid, def.id, C.periodKey(def.period, now)) || { progress: 0, claimed: 0 };
      out.push({
        id: def.id, title: def.title, desc: def.desc, period: def.period,
        progress: row.progress, target: def.target, claimed: !!row.claimed,
        reward_coins: def.reward_coins, reward_gems: def.reward_gems,
      });
    }
    return out;
  };

  // --- fish ---
  const fishJson = (row, now) => {
    const lineage = row.lineage ? JSON.parse(row.lineage) : { mother: null, father: null, hybrid: 0, generation: 0 };
    const tr = fishTradeable(row, now);
    const hunger = C.hungerPct(row.fed_at, now);
    const sick = !!row.sick_at;
    const level = C.fishLevel(row.grp, !!lineage.hybrid, row.born_at, now);
    const stage = C.growthStage(row.species_id, level);
    // coin farming (tank fish only): finished cycle waits until collected
    const coinRate = row.location === 'tank' ? (C.COIN_FARM[stage] || null) : null;
    const coin_pending = row.coin_pending || 0;
    const coin_in = (coinRate && !coin_pending)
      ? Math.max(0, coinRate.secs - (now - (row.coin_at || now))) : 0;
    const gem_pending = row.gem_pending || 0;
    const gem_amount = row.event_id ? (C.EVENT_DIAMONDS[stage] || 0) : 0;
    return {
      id: row.id, species_id: row.species_id, group: row.grp, variant: row.variant,
      name: C.SPECIES_NAMES[row.species_id] || row.species_id,
      nickname: row.nickname || null,
      gender: row.gender, location: row.location, tank: row.tank,
      x: row.x, y: row.y, born_at: row.born_at,
      level,
      stage,
      grow_level: C.growLevel(row.species_id),
      hunger, sick, mood: C.fishMood(sick, hunger),
      fed_at: row.fed_at, lineage,
      coin_pending, coin_in, coin_amount: coinRate ? coinRate.coins : 0,
      gem_pending, gem_amount,
      origin: row.origin || 'shop', event_id: row.event_id || null,
      tradeable: tr.ok, trade_lock: tr.ok ? null : tr.reason,
    };
  };

  const addFish = async (uid, speciesId, opts, now) => {
    const grp = C.speciesGroup(speciesId);
    const tank = opts.tank || await activeTank(uid);
    const pos = (opts.x != null) ? { x: opts.x, y: opts.y } : C.randomPointInGlass(tank);
    // bettas: only the female betta is female, every other betta is male;
    // all other groups keep a random gender
    const gender = opts.gender || (grp === 'betta'
      ? (speciesId === 'female_betta' ? 'female' : 'male')
      : (Math.random() < 0.5 ? 'male' : 'female'));
    const lineage = opts.lineage || { mother: null, father: null, hybrid: 0, generation: 0 };
    const info = await db.run(
      `INSERT INTO fish (user_id,species_id,grp,variant,gender,location,tank,x,y,born_at,fed_at,lineage,origin,event_id,coin_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      uid, speciesId, grp, opts.variant || speciesId, gender,
      opts.location || 'tank', tank, pos.x, pos.y,
      opts.born_at || now, opts.fed_at || now, JSON.stringify(lineage),
      opts.origin || 'shop', opts.event_id || null, now);
    await db.run(`INSERT INTO collection (user_id,species_id,count) VALUES (?,?,1)
                ON CONFLICT(user_id,species_id) DO UPDATE SET count=count+1`, uid, speciesId);
    await questProgressMax(uid, 'own_8_fish', await totalFishCount(uid), now);
    return db.get('SELECT * FROM fish WHERE id=?', info.lastInsertRowid);
  };

  const hatchEgg = async (uid, egg, now) => {
    const hybrid = !!egg.hybrid;
    // Maple Betta crosses produce true hybrid offspring (the blended look),
    // not just one parent's look: 50/50 between the cross's two variants.
    const pair = [egg.variant_a, egg.variant_b];
    let variant;
    if (pair.includes('autumn_fish')) {
      const other = pair[0] === 'autumn_fish' ? pair[1] : pair[0];
      const hybs = (C.MAPLE_CROSSES || {})[other];
      variant = hybs ? hybs[Math.random() < 0.5 ? 0 : 1] : null;
    }
    if (!variant) {
      // Goldfish hybrid mixes: each cross-species pair has its own blended look.
      const mixKey = [egg.variant_a, egg.variant_b].sort().join('+');
      variant = (C.HYBRID_MIXES || {})[mixKey] || null;
    }
    if (!variant) {
      variant = egg.variant_a === egg.variant_b
        ? egg.variant_a
        : (Math.random() < 0.5 ? egg.variant_a : egg.variant_b); // cross-variant inherits one parent's look
    }
    const tank = await activeTank(uid);
    const location = await tankFishCount(uid, tank) < C.TANK_CAPACITY[tank] ? 'tank' : 'inventory';
    const fish = await addFish(uid, variant, {
      variant, tank, location, born_at: now,
      lineage: { mother: egg.variant_b, father: egg.variant_a, hybrid: hybrid ? 1 : 0, generation: egg.generation },
      origin: 'bred', event_id: egg.event_id || null,
    }, now);
    await db.run('DELETE FROM eggs WHERE id=? AND user_id=?', egg.id, uid);
    return fish;
  };

  // --- time-based maintenance (runs inside GET /api/state, in a transaction) ---
  const maintain = (uid, now) => db.tx(async (t) => {
    const H = helpers(t);
    let ds = await t.get('SELECT last_cleaned_at FROM dirt_state WHERE user_id=?', uid);
    if (!ds) { await t.run('INSERT INTO dirt_state (user_id,last_cleaned_at) VALUES (?,?)', uid, now); ds = { last_cleaned_at: now }; }
    const hours = Math.floor((now - ds.last_cleaned_at) / 3600);
    const existing = (await t.get('SELECT COUNT(*) c FROM dirt_spots WHERE user_id=?', uid)).c;
    const toAdd = Math.max(0, Math.min(hours * 2, 15 - existing)); // 2/hr, cap 15
    for (let i = 0; i < toAdd; i++) {
      await t.run('INSERT INTO dirt_spots (user_id,x,y,created_at) VALUES (?,?,?,?)',
        uid, rand(0.08, 0.92), rand(0.3, 0.9), now);
    }
    const green = (now - ds.last_cleaned_at) >= 5 * 3600;

    const due = await t.all('SELECT * FROM eggs WHERE user_id=? AND hatch_at<=?', uid, now);
    const hatched = [];
    for (const egg of due) hatched.push(await H.hatchEgg(uid, egg, now));
    return { green, hatched };
  });

  return {
    getWallet, addCoins, addGems, addXp, getTanks, activeTank,
    tankFishCount, totalFishCount, ensureQuests, questRow, questProgressAdd,
    questProgressMax, questList, fishJson, addFish, hatchEgg, maintain,
  };
}

module.exports = function gameRoutes(db) {
  const r = Router();
  const H = helpers(db);
  const now = () => Math.floor(Date.now() / 1000);

  // ---------- state ----------
  r.get('/state', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { green } = await H.maintain(uid, t);
    // lazy sickness: unfed for SICK_AFTER_SECS -> sick
    await db.run('UPDATE fish SET sick_at=? WHERE user_id=? AND sick_at IS NULL AND fed_at IS NOT NULL AND ? - fed_at > ?',
      t, uid, t, C.SICK_AFTER_SECS);
    // lazy coin farming: a finished cycle banks coins and waits for collection
    const coinFish = await db.all(
      "SELECT id, species_id, grp, born_at, lineage, event_id, coin_pending, coin_at FROM fish WHERE user_id=? AND location='tank'", uid);
    for (const fr of coinFish) {
      if (fr.coin_pending > 0) continue;
      if (!fr.coin_at) { await db.run('UPDATE fish SET coin_at=? WHERE id=?', t, fr.id); continue; }
      const lin = fr.lineage ? JSON.parse(fr.lineage) : {};
      const lvl = C.fishLevel(fr.grp, !!lin.hybrid, fr.born_at, t);
      const stage = C.growthStage(fr.species_id, lvl);
      const rate = C.COIN_FARM[stage];
      if (rate && t - fr.coin_at >= rate.secs) {
        // event fish also bank diamonds with the coin cycle (1/1/2 by stage)
        const gems = fr.event_id ? (C.EVENT_DIAMONDS[stage] || 0) : 0;
        await db.run('UPDATE fish SET coin_pending=?, gem_pending=? WHERE id=?', rate.coins, gems, fr.id);
      }
    }
    const user = await db.get(
      `SELECT u.id,u.name,u.email,w.level,w.xp,w.coins,w.gems,w.food,w.medicine
       FROM users u JOIN wallets w ON w.user_id=u.id WHERE u.id=?`, uid);
    const tanks = await H.getTanks(uid);
    const fish = (await db.all('SELECT * FROM fish WHERE user_id=? ORDER BY id', uid))
      .map((f) => H.fishJson(f, t));
    // attach the player's own market listings (price + id) to listed fish
    const myListings = await db.all(
      'SELECT id AS listing_id, fish_id, price_diamonds FROM market_listings WHERE seller_id=?', uid);
    if (myListings.length) {
      const byFish = new Map(myListings.map((l) => [l.fish_id, l]));
      for (const f of fish) {
        const l = byFish.get(f.id);
        if (l) { f.listing_id = l.listing_id; f.listing_price = l.price_diamonds; }
      }
    }
    const eggs = (await db.all('SELECT * FROM eggs WHERE user_id=? ORDER BY hatch_at', uid))
      .map((e) => ({
        id: e.id, group: e.grp, variant_a: e.variant_a, variant_b: e.variant_b,
        hybrid: !!e.hybrid, generation: e.generation, hatch_at: e.hatch_at, created_at: e.created_at,
      }));
    const spots = await db.all('SELECT id,x,y FROM dirt_spots WHERE user_id=?', uid);
    const ds = await db.get('SELECT last_cleaned_at FROM dirt_state WHERE user_id=?', uid);
    const decor_owned = await db.all('SELECT deco_id,qty FROM decor_owned WHERE user_id=? AND qty>0', uid);
    const placements = await db.all('SELECT id,deco_id,tank,x,y FROM decor_placements WHERE user_id=?', uid);
    const collection = (await db.all('SELECT species_id,count FROM collection WHERE user_id=?', uid))
      .map((c) => ({ species_id: c.species_id, seen: 1, count: c.count }));
    const settings = await db.get('SELECT music,sfx,quality FROM settings WHERE user_id=?', uid);

    res.json({
      ok: true,
      state: {
        user,
        wallets: { coins: user.coins, gems: user.gems, food: user.food, xp: user.xp, level: user.level, medicine: user.medicine || 0 },
        tanks: {
          owned: ['small', 'medium', 'large'].filter((k) => tanks[k]),
          active: tanks.active,
          extra: { small: tanks.small_extra || 0, medium: tanks.medium_extra || 0, large: tanks.large_extra || 0 },
          extraMax: C.DECOR_EXTRA_SLOT_MAX,
          extraCost: C.DECOR_EXTRA_SLOT_COST,
        },
        fish, eggs,
        dirt: { spots, green, last_cleaned_at: ds ? ds.last_cleaned_at : t },
        decor_owned, placements,
        quests: await H.questList(uid, t),
        collection,
        settings: { music: !!settings.music, sfx: !!settings.sfx, quality: settings.quality },
      },
    });
  }));

  // ---------- fish shop ----------
  r.post('/shop/fish', ah(async (req, res) => res.json({ ok: true, items: C.fishCatalog().filter((i) => i.price_coins != null || i.price_gems != null) })));

  r.post('/shop/fish/buy', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { species_id } = req.body || {};
    const item = C.fishCatalog().find((i) => i.species_id === species_id);
    if (!item) return res.status(400).json({ ok: false, error: 'unknown species' });
    if (item.price_coins == null && item.price_gems == null)
      return res.status(400).json({ ok: false, error: 'not for sale — event exclusive' });

    const tank = await H.activeTank(uid);
    if (await H.tankFishCount(uid, tank) >= C.TANK_CAPACITY[tank]) {
      return res.status(400).json({ ok: false, error: 'tank is full' });
    }
    const w = await H.getWallet(uid);
    try {
      const row = await db.tx(async (txDb) => {
        const Ht = helpers(txDb);
        if (w.coins >= item.price_coins) {
          await txDb.run('UPDATE wallets SET coins=coins-? WHERE user_id=?', item.price_coins, uid);
        } else if (item.price_gems && w.gems >= item.price_gems) {
          await txDb.run('UPDATE wallets SET gems=gems-? WHERE user_id=?', item.price_gems, uid);
        } else {
          throw Object.assign(new Error('not enough funds'), { status: 400 });
        }
        return Ht.addFish(uid, species_id, { tank, location: 'tank' }, t);
      });
      res.json({ ok: true, fish: H.fishJson(row, t) });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.status ? e.message : 'buy failed' });
    }
  }));

  r.post('/fish/sell', ah(async (req, res) => {
    const uid = req.user.id;
    const { fish_id } = req.body || {};
    const fish = await db.get('SELECT * FROM fish WHERE id=? AND user_id=?', fish_id, uid);
    if (!fish) return res.status(404).json({ ok: false, error: 'fish not found' });
    if (fish.location === 'market')
      return res.status(400).json({ ok: false, error: 'cancel the market listing first 💎' });
    const price = Math.max(10, Math.floor(C.SPECIES_PRICES[fish.species_id].coins * 0.4));
    await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      await txDb.run('DELETE FROM fish WHERE id=? AND user_id=?', fish_id, uid);
      await Ht.addCoins(uid, price);
    });
    res.json({ ok: true, coins: price });
  }));

  r.post('/fish/feed', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const tank = await H.activeTank(uid);
    const tankFish = await db.all("SELECT id FROM fish WHERE user_id=? AND tank=? AND location='tank'", uid, tank);
    const w = await H.getWallet(uid);
    if (w.food <= 0) return res.status(400).json({ ok: false, error: 'no food' });
    const n = Math.max(tankFish.length, 1);
    await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      await txDb.run('UPDATE wallets SET food=food-1 WHERE user_id=?', uid);
      await txDb.run("UPDATE fish SET fed_at=? WHERE user_id=? AND tank=? AND location='tank'", t, uid, tank);
      await Ht.questProgressAdd(uid, 'feed_3', 1, t);
      await Ht.addXp(uid, 2);
    });
    res.json({ ok: true, pellets: n });
  }));

  r.post('/fish/feed-one', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { fish_id } = req.body || {};
    const fish = await db.get('SELECT id FROM fish WHERE id=? AND user_id=?', fish_id, uid);
    if (!fish) return res.status(404).json({ ok: false, error: 'fish not found' });
    const w = await H.getWallet(uid);
    if (w.food < 1) return res.status(400).json({ ok: false, error: 'no food' });
    await db.tx(async (txDb) => {
      await txDb.run('UPDATE wallets SET food=food-1 WHERE user_id=?', uid);
      await txDb.run('UPDATE fish SET fed_at=? WHERE id=?', t, fish_id);
    });
    res.json({ ok: true });
  }));

  r.post('/shop/medicine/buy', ah(async (req, res) => {
    const uid = req.user.id;
    const qty = Math.max(1, Math.min(99, Math.floor(Number((req.body || {}).qty) || 1)));
    const cost = qty * C.MEDICINE_PRICE;
    const w = await H.getWallet(uid);
    if (w.coins < cost) return res.status(400).json({ ok: false, error: 'not enough coins' });
    await db.tx(async (txDb) => {
      await txDb.run('UPDATE wallets SET coins=coins-?, medicine=medicine+? WHERE user_id=?', cost, qty, uid);
    });
    res.json({ ok: true, medicine: (w.medicine || 0) + qty });
  }));

  r.post('/fish/treat', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { fish_id } = req.body || {};
    const fish = await db.get('SELECT id,sick_at FROM fish WHERE id=? AND user_id=?', fish_id, uid);
    if (!fish) return res.status(404).json({ ok: false, error: 'fish not found' });
    if (!fish.sick_at) return res.status(400).json({ ok: false, error: 'not sick' });
    const w = await H.getWallet(uid);
    if ((w.medicine || 0) < 1) return res.status(400).json({ ok: false, error: 'no medicine' });
    await db.tx(async (txDb) => {
      await txDb.run('UPDATE wallets SET medicine=medicine-1 WHERE user_id=?', uid);
      await txDb.run('UPDATE fish SET sick_at=NULL, fed_at=? WHERE id=?', t, fish_id);
    });
    res.json({ ok: true });
  }));

  // ---------- collect farmed coins (fish stops earning until collected) ----------
  r.post('/fish/collect', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { fish_id } = req.body || {};
    const fish = await db.get('SELECT id,coin_pending,gem_pending FROM fish WHERE id=? AND user_id=?', fish_id, uid);
    if (!fish) return res.status(404).json({ ok: false, error: 'fish not found' });
    if (!fish.coin_pending || fish.coin_pending <= 0) {
      return res.status(400).json({ ok: false, error: 'nothing to collect' });
    }
    const coins = fish.coin_pending;
    const gems = fish.gem_pending || 0;
    await db.tx(async (txDb) => {
      await txDb.run('UPDATE fish SET coin_pending=0, gem_pending=0, coin_at=? WHERE id=?', t, fish_id);
      await txDb.run('UPDATE wallets SET coins=coins+?, gems=gems+? WHERE user_id=?', coins, gems, uid);
    });
    const w = await H.getWallet(uid);
    res.json({ ok: true, collected: coins, collected_gems: gems, coins: w.coins, gems: w.gems });
  }));

  r.post('/fish/tap', ah(async (req, res) => {
    const uid = req.user.id;
    const { fish_id } = req.body || {};
    const fish = await db.get('SELECT id FROM fish WHERE id=? AND user_id=?', fish_id, uid);
    if (!fish) return res.status(404).json({ ok: false, error: 'fish not found' });
    // petting is affection only (XP) — it no longer feeds; use Feed for hunger
    await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      await Ht.addXp(uid, 1);
    });
    res.json({ ok: true });
  }));

  // ---------- rename a pet (3 gems) ----------
  r.post('/fish/rename', ah(async (req, res) => {
    const uid = req.user.id;
    const { fish_id, name } = req.body || {};
    const fish = await db.get('SELECT id FROM fish WHERE id=? AND user_id=?', fish_id, uid);
    if (!fish) return res.status(404).json({ ok: false, error: 'fish not found' });
    const nickname = String(name || '').trim().slice(0, 20);
    if (!nickname) return res.status(400).json({ ok: false, error: 'empty name' });
    const RENAME_GEMS = 3;
    const w = await H.getWallet(uid);
    if (w.gems < RENAME_GEMS) return res.status(400).json({ ok: false, error: 'not enough gems' });
    await db.tx(async (txDb) => {
      await txDb.run('UPDATE wallets SET gems=gems-? WHERE user_id=?', RENAME_GEMS, uid);
      await txDb.run('UPDATE fish SET nickname=? WHERE id=? AND user_id=?', nickname, fish_id, uid);
    });
    res.json({ ok: true, nickname, gems: w.gems - RENAME_GEMS });
  }));

  // ---------- transfer a fish to another owned tank (or place from inventory) ----------
  r.post('/fish/transfer', ah(async (req, res) => {
    const uid = req.user.id;
    const { fish_id, tier } = req.body || {};
    if (!['small', 'medium', 'large'].includes(tier)) {
      return res.status(400).json({ ok: false, error: 'invalid tank' });
    }
    const fish = await db.get(
      "SELECT id, tank, location FROM fish WHERE id=? AND user_id=?", fish_id, uid);
    if (!fish) return res.status(404).json({ ok: false, error: 'fish not found' });
    if (fish.location === 'market')
      return res.status(400).json({ ok: false, error: 'cancel the market listing first 💎' });
    if (fish.location === 'tank' && fish.tank === tier)
      return res.status(400).json({ ok: false, error: 'already in that tank' });
    const tanks = await H.getTanks(uid);
    if (!tanks[tier]) return res.status(400).json({ ok: false, error: 'tank not owned' });
    if (await H.tankFishCount(uid, tier) >= C.TANK_CAPACITY[tier]) {
      return res.status(400).json({ ok: false, error: 'target tank is full' });
    }
    await db.run("UPDATE fish SET tank=?, location='tank', x=?, y=? WHERE id=? AND user_id=?",
      tier, Math.random(), 0.2 + Math.random() * 0.6, fish_id, uid);
    res.json({ ok: true, tier });
  }));

  // ---------- tanks ----------
  r.post('/tanks/buy', ah(async (req, res) => {
    const uid = req.user.id;
    const { tier } = req.body || {};
    if (tier !== 'medium' && tier !== 'large') return res.status(400).json({ ok: false, error: 'invalid tier' });
    const tanks = await H.getTanks(uid);
    if (tanks[tier]) return res.status(400).json({ ok: false, error: 'already owned' });
    if (tier === 'large' && !tanks.medium) return res.status(400).json({ ok: false, error: 'buy medium first' });
    const price = C.TANK_PRICES[tier];
    const w = await H.getWallet(uid);
    if (w.coins < price) return res.status(400).json({ ok: false, error: 'not enough coins' });
    await db.tx(async (txDb) => {
      await txDb.run('UPDATE wallets SET coins=coins-? WHERE user_id=?', price, uid);
      await txDb.run(`UPDATE user_tanks SET ${tier}=1 WHERE user_id=?`, uid);
    });
    res.json({ ok: true });
  }));

  r.post('/tanks/switch', ah(async (req, res) => {
    const uid = req.user.id;
    const { tier } = req.body || {};
    if (!['small', 'medium', 'large'].includes(tier)) return res.status(400).json({ ok: false, error: 'invalid tier' });
    const tanks = await H.getTanks(uid);
    if (!tanks[tier]) return res.status(400).json({ ok: false, error: 'tank not owned' });
    await db.run('UPDATE user_tanks SET active=? WHERE user_id=?', tier, uid);
    res.json({ ok: true });
  }));

  // ---------- tanks: buy an extra decor slot (diamonds) ----------
  r.post('/tanks/extra-slot', ah(async (req, res) => {
    const uid = req.user.id;
    const { tank } = req.body || {};
    if (!['small', 'medium', 'large'].includes(tank)) return res.status(400).json({ ok: false, error: 'invalid tank' });
    const col = `${tank}_extra`;
    const max = C.DECOR_EXTRA_SLOT_MAX[tank];
    const cost = C.DECOR_EXTRA_SLOT_COST;
    const tanks = await H.getTanks(uid);
    if (!tanks[tank]) return res.status(400).json({ ok: false, error: 'tank not owned' });
    if ((tanks[col] || 0) >= max) return res.status(400).json({ ok: false, error: 'max slots reached' });
    const w = await H.getWallet(uid);
    if (w.gems < cost) return res.status(400).json({ ok: false, error: 'not enough diamonds' });
    const extra = await db.tx(async (txDb) => {
      await txDb.run('UPDATE wallets SET gems=gems-? WHERE user_id=?', cost, uid);
      await txDb.run(`UPDATE user_tanks SET ${col}=${col}+1 WHERE user_id=?`, uid);
      const row = await txDb.get(`SELECT ${col} AS e FROM user_tanks WHERE user_id=?`, uid);
      return row ? row.e : 0;
    });
    res.json({ ok: true, tank, extra });
  }));

  // ---------- breeding ----------
  r.get('/breeding/partners', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const fishId = Number(req.query.fish_id);
    const fish = await db.get("SELECT * FROM fish WHERE id=? AND user_id=? AND location='tank'", fishId, uid);
    if (!fish) return res.status(404).json({ ok: false, error: 'fish not found' });
    const other = fish.gender === 'male' ? 'female' : 'male';
    const rows = await db.all(
      "SELECT * FROM fish WHERE user_id=? AND location='tank' AND grp=? AND gender=? AND id!=? ORDER BY id",
      uid, fish.grp, other, fishId);
    res.json({ ok: true, partners: rows.map((f) => H.fishJson(f, t)) });
  }));

  r.post('/breeding/breed', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const maleId = Number(req.body && req.body.male_id);
    const femaleId = Number(req.body && req.body.female_id);
    const male = await db.get('SELECT * FROM fish WHERE id=? AND user_id=?', maleId, uid);
    const female = await db.get('SELECT * FROM fish WHERE id=? AND user_id=?', femaleId, uid);
    if (!male || !female) return res.status(404).json({ ok: false, error: 'fish not found' });
    if (male.location === 'market' || female.location === 'market') {
      return res.status(400).json({ ok: false, error: 'cancel the market listing first 💎' });
    }
    if (maleId === femaleId) return res.status(400).json({ ok: false, error: 'pick two different fish' });
    if (male.gender !== 'male' || female.gender !== 'female') {
      return res.status(400).json({ ok: false, error: 'breeding needs one male and one female' });
    }
    if (male.grp !== female.grp) {
      return res.status(400).json({ ok: false, error: "These species can't breed together" });
    }
    const w = await H.getWallet(uid);
    if (w.gems < 2) return res.status(400).json({ ok: false, error: 'not enough gems' });

    const hybrid = male.species_id !== female.species_id;
    const hatchHours = hybrid ? C.HYBRID_HATCH_HOURS : C.HATCH_HOURS[male.grp];
    const lin = (f) => { try { return JSON.parse(f.lineage); } catch { return { generation: 0 }; } };
    const generation = Math.max(lin(male).generation || 0, lin(female).generation || 0) + 1;

    const eggId = await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      await txDb.run('UPDATE wallets SET gems=gems-2 WHERE user_id=?', uid);
      const info = await txDb.run(
        `INSERT INTO eggs (user_id,grp,variant_a,variant_b,hybrid,generation,hatch_at,created_at,event_id)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        uid, male.grp, male.species_id, female.species_id, hybrid ? 1 : 0,
        generation, t + hatchHours * 3600, t, male.event_id || female.event_id || null);
      await Ht.questProgressAdd(uid, 'breed_1', 1, t);
      await Ht.addXp(uid, 5);
      return info.lastInsertRowid;
    });
    const egg = await db.get('SELECT * FROM eggs WHERE id=?', eggId);
    res.json({
      ok: true,
      egg: {
        id: egg.id, group: egg.grp, variant_a: egg.variant_a, variant_b: egg.variant_b,
        hybrid: !!egg.hybrid, generation: egg.generation, hatch_at: egg.hatch_at, created_at: egg.created_at,
      },
    });
  }));

  // ---------- dirt ----------
  r.post('/dirt/wipe', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    const { remaining, green } = await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      let deleted = 0;
      if (ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        deleted = (await txDb.run(`DELETE FROM dirt_spots WHERE user_id=? AND id IN (${placeholders})`,
          uid, ...ids)).changes;
      }
      await Ht.questProgressAdd(uid, 'wipe_5', deleted, t);
      const remaining = (await txDb.get('SELECT COUNT(*) c FROM dirt_spots WHERE user_id=?', uid)).c;
      const ds = await txDb.get('SELECT last_cleaned_at FROM dirt_state WHERE user_id=?', uid);
      const green = ds && (t - ds.last_cleaned_at) >= 5 * 3600;
      if (remaining === 0 && !green) {
        await txDb.run('UPDATE dirt_state SET last_cleaned_at=? WHERE user_id=?', t, uid);
      }
      return { remaining, green: !!green };
    });
    res.json({ ok: true, remaining, green });
  }));

  r.post('/dirt/filter', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const ds = await db.get('SELECT last_cleaned_at FROM dirt_state WHERE user_id=?', uid);
    const green = ds && (t - ds.last_cleaned_at) >= 5 * 3600;
    if (!green) return res.status(400).json({ ok: false, error: 'water is not green' });
    const w = await H.getWallet(uid);
    if (w.coins < 100) return res.status(400).json({ ok: false, error: 'not enough coins' });
    await db.tx(async (txDb) => {
      await txDb.run('UPDATE wallets SET coins=coins-100 WHERE user_id=?', uid);
      await txDb.run('DELETE FROM dirt_spots WHERE user_id=?', uid);
      await txDb.run('UPDATE dirt_state SET last_cleaned_at=? WHERE user_id=?', t, uid);
    });
    res.json({ ok: true });
  }));

  // ---------- decor shop ----------
  r.get('/shop/decor', ah(async (req, res) => res.json({ ok: true, items: C.decorCatalog() })));

  r.post('/shop/decor/buy', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { deco_id } = req.body || {};
    const item = C.decorItem(deco_id);
    if (!item) return res.status(400).json({ ok: false, error: 'unknown decoration' });
    const w = await H.getWallet(uid);
    if (w.coins < item.price) return res.status(400).json({ ok: false, error: 'not enough coins' });
    const qty = await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      await txDb.run('UPDATE wallets SET coins=coins-? WHERE user_id=?', item.price, uid);
      await txDb.run(`INSERT INTO decor_owned (user_id,deco_id,qty) VALUES (?,?,1)
                  ON CONFLICT(user_id,deco_id) DO UPDATE SET qty=qty+1`, uid, deco_id);
      await Ht.questProgressAdd(uid, 'buy_decor_1', 1, t);
      return (await txDb.get('SELECT qty FROM decor_owned WHERE user_id=? AND deco_id=?', uid, deco_id)).qty;
    });
    res.json({ ok: true, qty });
  }));

  r.post('/decor/place', ah(async (req, res) => {
    const uid = req.user.id;
    const { deco_id, tank, x, y } = req.body || {};
    if (!C.decorItem(deco_id)) return res.status(400).json({ ok: false, error: 'unknown decoration' });
    if (!['small', 'medium', 'large'].includes(tank)) return res.status(400).json({ ok: false, error: 'invalid tank' });
    const tanks = await H.getTanks(uid);
    if (!tanks[tank]) return res.status(400).json({ ok: false, error: 'tank not owned' });
    const owned = await db.get('SELECT qty FROM decor_owned WHERE user_id=? AND deco_id=?', uid, deco_id);
    if (!owned || owned.qty <= 0) return res.status(400).json({ ok: false, error: 'not owned' });
    const placed = (await db.get('SELECT COUNT(*) c FROM decor_placements WHERE user_id=? AND tank=?', uid, tank)).c;
    const maxSlots = C.DECOR_SLOTS[tank] + (tanks[`${tank}_extra`] || 0);
    if (placed >= maxSlots) return res.status(400).json({ ok: false, error: 'no free decor slots' });

    const p = C.clampDecor(tank, x, y);
    const id = await db.tx(async (txDb) => {
      await txDb.run('UPDATE decor_owned SET qty=qty-1 WHERE user_id=? AND deco_id=?', uid, deco_id);
      const info = await txDb.run(
        'INSERT INTO decor_placements (user_id,deco_id,tank,x,y) VALUES (?,?,?,?,?)',
        uid, deco_id, tank, p.x, p.y);
      return info.lastInsertRowid;
    });
    res.json({ ok: true, placement: { id, deco_id, tank, x: p.x, y: p.y } });
  }));

  r.post('/decor/move', ah(async (req, res) => {
    const uid = req.user.id;
    const { id, x, y } = req.body || {};
    const pl = await db.get('SELECT * FROM decor_placements WHERE id=? AND user_id=?', id, uid);
    if (!pl) return res.status(404).json({ ok: false, error: 'placement not found' });
    const p = C.clampDecor(pl.tank, x, y);
    await db.run('UPDATE decor_placements SET x=?,y=? WHERE id=? AND user_id=?', p.x, p.y, id, uid);
    res.json({ ok: true });
  }));

  r.post('/decor/remove', ah(async (req, res) => {
    const uid = req.user.id;
    const { id } = req.body || {};
    const pl = await db.get('SELECT * FROM decor_placements WHERE id=? AND user_id=?', id, uid);
    if (!pl) return res.status(404).json({ ok: false, error: 'placement not found' });
    await db.tx(async (txDb) => {
      await txDb.run('DELETE FROM decor_placements WHERE id=? AND user_id=?', id, uid);
      await txDb.run(`INSERT INTO decor_owned (user_id,deco_id,qty) VALUES (?,?,1)
                  ON CONFLICT(user_id,deco_id) DO UPDATE SET qty=qty+1`, uid, pl.deco_id);
    });
    res.json({ ok: true });
  }));

  // ---------- quests ----------
  r.post('/quests/claim', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { quest_id } = req.body || {};
    const def = C.QUEST_DEFS.find((d) => d.id === quest_id);
    if (!def) return res.status(400).json({ ok: false, error: 'unknown quest' });
    await H.ensureQuests(uid, t);
    const row = await H.questRow(uid, quest_id, t);
    if (!row || row.progress < def.target) return res.status(400).json({ ok: false, error: 'quest not complete' });
    if (row.claimed) return res.status(400).json({ ok: false, error: 'already claimed' });
    await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      await txDb.run('UPDATE quests SET claimed=1 WHERE user_id=? AND quest_id=? AND period=?',
        uid, quest_id, C.periodKey(def.period, t));
      if (def.reward_coins) await Ht.addCoins(uid, def.reward_coins);
      if (def.reward_gems) await Ht.addGems(uid, def.reward_gems);
    });
    res.json({ ok: true, coins: def.reward_coins, gems: def.reward_gems });
  }));

  // ---------- food / settings / minigame ----------
  r.post('/shop/food/buy', ah(async (req, res) => {
    const uid = req.user.id;
    const qty = Math.floor(Number(req.body && req.body.qty));
    if (!qty || qty <= 0 || qty > 1000) return res.status(400).json({ ok: false, error: 'invalid qty' });
    const cost = qty * 10;
    const w = await H.getWallet(uid);
    if (w.coins < cost) return res.status(400).json({ ok: false, error: 'not enough coins' });
    const food = await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      await txDb.run('UPDATE wallets SET coins=coins-?, food=food+? WHERE user_id=?', cost, qty, uid);
      return (await Ht.getWallet(uid)).food;
    });
    res.json({ ok: true, food });
  }));

  r.post('/settings', ah(async (req, res) => {
    const uid = req.user.id;
    const { music, sfx, quality } = req.body || {};
    await db.run('UPDATE settings SET music=?, sfx=?, quality=? WHERE user_id=?',
      music ? 1 : 0, sfx ? 1 : 0, String(quality || 'high').slice(0, 16), uid);
    res.json({ ok: true });
  }));

  r.post('/minigame/finish', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const score = Math.floor(Number(req.body && req.body.score));
    if (isNaN(score) || score < 0) return res.status(400).json({ ok: false, error: 'invalid score' });
    await H.ensureQuests(uid, t);
    const row = await H.questRow(uid, 'minigame_1', t);
    if (row && row.progress >= 3) return res.status(400).json({ ok: false, error: 'daily limit reached' });
    const coins = Math.min(score, 100);
    await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      await Ht.addCoins(uid, coins);
      await Ht.questProgressAdd(uid, 'minigame_1', 1, t);
      await Ht.addXp(uid, 3);
    });
    res.json({ ok: true, coins });
  }));

  // ---------- daily shell game: find the pearl, win 10 diamonds (30% luck) ----------
  const SHELL_COOLDOWN = 86400, SHELL_WIN_CHANCE = 0.30, SHELL_PRIZE = 10;
  r.get('/shell/status', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const row = await db.get('SELECT last_played_at FROM daily_shell WHERE user_id=?', uid);
    const last = row && row.last_played_at ? row.last_played_at : 0;
    const nextAt = last + SHELL_COOLDOWN;
    res.json({ ok: true, canPlay: t >= nextAt, nextAt: t >= nextAt ? t : nextAt });
  }));
  r.post('/shell/play', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const pick = Math.floor(Number(req.body && req.body.pick));
    if (pick !== 0 && pick !== 1 && pick !== 2)
      return res.status(400).json({ ok: false, error: 'invalid pick' });
    const out = await db.tx(async (txDb) => {
      const row = await txDb.get('SELECT last_played_at FROM daily_shell WHERE user_id=?', uid);
      const last = row && row.last_played_at ? row.last_played_at : 0;
      if (t < last + SHELL_COOLDOWN)
        return { ok: false, error: 'come back tomorrow 🐚', nextAt: last + SHELL_COOLDOWN };
      // server-side roll: exactly 30% win chance, pearl hidden until reveal
      const win = Math.random() < SHELL_WIN_CHANCE;
      const others = [0, 1, 2].filter((i) => i !== pick);
      const winning = win ? pick : others[Math.floor(Math.random() * others.length)];
      await txDb.run('INSERT OR REPLACE INTO daily_shell(user_id,last_played_at) VALUES(?,?)', uid, t);
      if (win) await txDb.run('UPDATE wallets SET gems=gems+? WHERE user_id=?', SHELL_PRIZE, uid);
      return { ok: true, win, winning, gems: win ? SHELL_PRIZE : 0 };
    });
    if (!out.ok) return res.status(400).json(out);
    res.json(out);
  }));

  // ---------- weekly event: Autumn Crush (event_id "autumn1") ----------
  // Progress is stored per account on the server. Claim is atomic: the
  // event_rewards PK (user_id,event_id,run) makes double-claims impossible.
  // Each player gets up to EVENT_MAX_RUNS full playthroughs (score resets to
  // zero each run), i.e. up to 2 Maple Bettas from this event.
  const EVENT_MAX_RUNS = { autumn1: 2 };
  const validEvent = (e) => typeof e === 'string' && EVENT_GOALS[e] != null;
  const maxRuns = (event) => EVENT_MAX_RUNS[event] || 1;
  const runsClaimed = async (d, uid, event) =>
    (await d.get('SELECT COUNT(*) AS n FROM event_rewards WHERE user_id=? AND event_id=?', uid, event)).n || 0;

  r.get('/event/progress', ah(async (req, res) => {
    const uid = req.user.id;
    const event = String(req.query.event || '');
    if (!validEvent(event)) return res.status(400).json({ ok: false, error: 'unknown event' });
    const claimed = await runsClaimed(db, uid, event);
    const mr = maxRuns(event);
    const finished = claimed >= mr;
    const run = finished ? mr : claimed + 1;
    const p = await db.get('SELECT score,level,moves FROM event_progress WHERE user_id=? AND event_id=? AND run=?', uid, event, run);
    const rw = await db.get('SELECT claimed_at FROM event_rewards WHERE user_id=? AND event_id=? AND run=?', uid, event, run);
    res.json({ ok: true, score: p ? p.score : 0, level: p ? p.level : 0, moves: p ? p.moves : 0,
               claimed: !!rw, goal: EVENT_GOALS[event],
               runs_claimed: claimed, max_runs: mr, current_run: run });
  }));

  r.post('/event/progress', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { event, score, level, moves } = req.body || {};
    if (!validEvent(event)) return res.status(400).json({ ok: false, error: 'unknown event' });
    let s = Math.floor(Number(score)); const l = Math.floor(Number(level)), m = Math.floor(Number(moves));
    if (!Number.isFinite(s) || !Number.isFinite(l) || !Number.isFinite(m) || s < 0 || l < 0 || m < 0)
      return res.status(400).json({ ok: false, error: 'invalid progress' });
    if (l > 9) return res.status(400).json({ ok: false, error: 'invalid progress' });
    const claimed = await runsClaimed(db, uid, event);
    const mr = maxRuns(event);
    if (claimed >= mr) return res.status(400).json({ ok: false, error: 'event finished' });
    const run = claimed + 1;
    // Overshooting the goal is normal — a single move scores in chunks, so nobody
    // lands exactly on it. Clamp to the goal instead of rejecting the save.
    s = Math.min(s, EVENT_GOALS[event]);
    const prev = await db.get('SELECT score, moves, updated_at FROM event_progress WHERE user_id=? AND event_id=? AND run=?', uid, event, run);
    if (prev && s > prev.score) {
      // anti-cheat: the game saves after every move, so a single save can only add what
      // one move can plausibly produce. Generous caps so legit play is never affected.
      const elapsed = Math.max(1, t - (prev.updated_at || t));
      const gainCap = Math.max(20000, elapsed * 5000);
      if (s - prev.score > gainCap || m < prev.moves)
        return res.status(400).json({ ok: false, error: 'suspicious progress' });
    }
    // only forward progress is kept: a replayed/lower score never overwrites a better one
    await db.run(`INSERT INTO event_progress(user_id,event_id,run,score,level,moves,updated_at)
                  VALUES(?,?,?,?,?,?,?)
                  ON CONFLICT(user_id,event_id,run) DO UPDATE SET
                    score=MAX(score,excluded.score), level=MAX(level,excluded.level),
                    moves=MAX(moves,excluded.moves), updated_at=excluded.updated_at`,
                  uid, event, run, s, l, m, t);
    res.json({ ok: true });
  }));

  r.post('/event/claim', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { event } = req.body || {};
    if (!validEvent(event)) return res.status(400).json({ ok: false, error: 'unknown event' });
    const out = await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      const claimed = await runsClaimed(txDb, uid, event);
      const mr = maxRuns(event);
      if (claimed >= mr) return { ok: false, error: 'already claimed' };
      const run = claimed + 1;
      const p = await txDb.get('SELECT score FROM event_progress WHERE user_id=? AND event_id=? AND run=?', uid, event, run);
      if (!p || p.score < EVENT_GOALS[event])
        return { ok: false, error: 'goal not reached yet' };
      await txDb.run('INSERT INTO event_rewards(user_id,event_id,run,claimed_at) VALUES(?,?,?,?)', uid, event, run, t);
      // prize goes to inventory — the player places it in the tank themselves
      const fish = await Ht.addFish(uid, EVENT_FISH[event], {
        location: 'inventory', origin: 'event', event_id: event,
      }, t);
      return { ok: true, fish_id: fish.id, species_id: EVENT_FISH[event], run, runs_claimed: run, max_runs: mr };
    });
    if (!out.ok) return res.status(400).json(out);
    res.json(out);
  }));

  // ---------- player marketplace (diamonds) ----------
  // Tradeability: shop-bought commons are bound to the account; bred fish are
  // tradeable; event fish (and their offspring) unlock only after the event ends.
  const MARKET_FEE_PCT = 10;   // burned on every sale (diamond sink)
  const MARKET_MAX_PRICE = 999999;

  const marketFishJson = (l, t) => ({
    listing_id: l.listing_id, price_diamonds: l.price_diamonds, listed_at: l.listed_at,
    seller_id: l.seller_id, seller_name: l.seller_name,
    fish: H.fishJson({
      id: l.fish_id, species_id: l.species_id, grp: l.grp, variant: l.variant,
      gender: l.gender, location: 'market', tank: null, x: null, y: null,
      born_at: l.born_at, fed_at: null, lineage: l.lineage,
      nickname: l.nickname, origin: l.origin, event_id: l.event_id,
    }, t),
  });

  // browse active listings (newest first)
  r.get('/market/listings', ah(async (req, res) => {
    const t = now();
    const rows = await db.all(
      `SELECT l.id AS listing_id, l.price_diamonds, l.listed_at, l.seller_id,
              u.name AS seller_name,
              f.id AS fish_id, f.species_id, f.grp, f.variant, f.gender,
              f.born_at, f.lineage, f.nickname, f.origin, f.event_id
       FROM market_listings l
       JOIN fish f ON f.id = l.fish_id
       JOIN users u ON u.id = l.seller_id
       ORDER BY l.listed_at DESC LIMIT 100`);
    res.json({ ok: true, listings: rows.map((l) => marketFishJson(l, t)) });
  }));

  // list one of your fish for sale (diamonds)
  r.post('/market/list', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const fishId = Number(req.body && req.body.fish_id);
    const price = Math.floor(Number(req.body && req.body.price_diamonds));
    if (!fishId || !Number.isFinite(price) || price < 1 || price > MARKET_MAX_PRICE) {
      return res.status(400).json({ ok: false, error: 'invalid price (1-' + MARKET_MAX_PRICE + ' 💎)' });
    }
    const fish = await db.get('SELECT * FROM fish WHERE id=? AND user_id=?', fishId, uid);
    if (!fish) return res.status(404).json({ ok: false, error: 'fish not found' });
    if (fish.location === 'market') {
      return res.status(400).json({ ok: false, error: 'already listed on the market' });
    }
    const tr = fishTradeable(fish, t);
    if (!tr.ok) return res.status(400).json({ ok: false, error: tr.reason });
    const out = await db.tx(async (txDb) => {
      const f = await txDb.get('SELECT * FROM fish WHERE id=? AND user_id=?', fishId, uid);
      if (!f || f.location === 'market') return { ok: false, error: 'fish no longer available' };
      const tr2 = fishTradeable(f, t);
      if (!tr2.ok) return { ok: false, error: tr2.reason };
      await txDb.run("UPDATE fish SET location='market' WHERE id=?", fishId);
      const info = await txDb.run(
        'INSERT INTO market_listings (seller_id,fish_id,price_diamonds,listed_at) VALUES (?,?,?,?)',
        uid, fishId, price, t);
      return { ok: true, listing_id: info.lastInsertRowid };
    });
    if (!out.ok) return res.status(400).json(out);
    res.json(out);
  }));

  // cancel your own listing — the fish comes back to your inventory
  r.post('/market/cancel', ah(async (req, res) => {
    const uid = req.user.id;
    const listingId = Number(req.body && req.body.listing_id);
    if (!listingId) return res.status(400).json({ ok: false, error: 'invalid listing' });
    const out = await db.tx(async (txDb) => {
      const l = await txDb.get('SELECT * FROM market_listings WHERE id=? AND seller_id=?', listingId, uid);
      if (!l) return { ok: false, error: 'listing not found' };
      await txDb.run('DELETE FROM market_listings WHERE id=?', listingId);
      await txDb.run("UPDATE fish SET location='inventory' WHERE id=? AND user_id=?", l.fish_id, uid);
      return { ok: true };
    });
    if (!out.ok) return res.status(400).json(out);
    res.json(out);
  }));

  // buy a listing — diamonds move atomically, the fish goes to your inventory
  r.post('/market/buy', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const listingId = Number(req.body && req.body.listing_id);
    if (!listingId) return res.status(400).json({ ok: false, error: 'invalid listing' });
    const out = await db.tx(async (txDb) => {
      const l = await txDb.get('SELECT * FROM market_listings WHERE id=?', listingId);
      if (!l) return { ok: false, error: 'listing is gone' };
      if (l.seller_id === uid) return { ok: false, error: "you can't buy your own listing" };
      const fish = await txDb.get('SELECT * FROM fish WHERE id=?', l.fish_id);
      if (!fish || fish.user_id !== l.seller_id || fish.location !== 'market') {
        return { ok: false, error: 'listing is no longer valid' };
      }
      const w = await txDb.get('SELECT gems FROM wallets WHERE user_id=?', uid);
      if (!w || w.gems < l.price_diamonds) return { ok: false, error: 'not enough 💎' };
      const fee = Math.floor(l.price_diamonds * MARKET_FEE_PCT / 100);
      const sellerGets = l.price_diamonds - fee;
      await txDb.run('UPDATE wallets SET gems=gems-? WHERE user_id=?', l.price_diamonds, uid);
      await txDb.run('UPDATE wallets SET gems=gems+? WHERE user_id=?', sellerGets, l.seller_id);
      await txDb.run("UPDATE fish SET user_id=?, location='inventory' WHERE id=?", uid, fish.id);
      await txDb.run('DELETE FROM market_listings WHERE id=?', listingId);
      const Ht = helpers(txDb);
      await Ht.addXp(uid, 5);
      return { ok: true, fish_id: fish.id, fee_diamonds: fee };
    });
    if (!out.ok) return res.status(400).json(out);
    res.json(out);
  }));

  return r;
};
