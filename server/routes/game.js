// All authenticated /api game routes. Every query is filtered by user_id.
// All DB access is async (libSQL facade).
const { Router } = require('express');
const { ah } = require('../async');
const C = require('../catalog');
const { parseAvatarCfg } = require('../avatar');

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// Weekly event config. ends_at = unix seconds when the event ends.
// Event fish (and their offspring) are trophies locked to the account while
// the event runs; they become market-tradeable only after it ends.
// ends_at: null = end date not announced yet (fish stay locked).
const EVENT_META = {
  autumn1: { goal: 300000, fish: 'autumn_fish', ends_at: null },
};
// Per-level rewards (level = 0-based index, displayed as level+1).
// Levels 1-4: coins (escalating from 500). Levels 5-10: diamonds (from 5).
// Level 10 (index 9) also grants the event fish via /event/claim.
const EVENT_LEVEL_REWARDS = {
  autumn1: [
    { coins: 500 },   // level 1
    { coins: 750 },   // level 2
    { coins: 1000 },  // level 3
    { coins: 1500 },  // level 4
    { gems: 5 },      // level 5
    { gems: 8 },      // level 6
    { gems: 12 },     // level 7
    { gems: 15 },     // level 8
    { gems: 20 },     // level 9
    { gems: 30 },     // level 10 (+ event fish via /event/claim)
  ],
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

// Resolve what an egg will hatch into at breed time, so the egg card can show
// its exact icon + name. Mirrors hatchEgg's logic; the maple 50/50 is rolled
// here. Returns null for cross-variant inherits (still rolled at hatch).
const resolveEggSpecies = (variant_a, variant_b) => {
  if (variant_a === variant_b) return variant_a;
  const pair = [variant_a, variant_b];
  if (pair.includes('female_betta')) {
    const other = pair[0] === 'female_betta' ? pair[1] : pair[0];
    const v = (C.FEMALE_CROSSES || {})[other];
    if (v) return v;
  }
  if (pair.includes('autumn_fish')) {
    const other = pair[0] === 'autumn_fish' ? pair[1] : pair[0];
    const hybs = (C.MAPLE_CROSSES || {})[other];
    if (hybs) return hybs[Math.random() < 0.5 ? 0 : 1];
  }
  const mixKey = [variant_a, variant_b].sort().join('+');
  const mix = (C.HYBRID_MIXES || {})[mixKey];
  if (mix) return mix;
  return null;
};

function helpers(db) {
  const getWallet = (uid) => db.get('SELECT user_id, COALESCE(coins,0) AS coins, COALESCE(gems,0) AS gems, COALESCE(food,0) AS food, COALESCE(xp,0) AS xp, COALESCE(level,1) AS level, COALESCE(medicine,0) AS medicine, COALESCE(food_special,0) AS food_special FROM wallets WHERE user_id=?', uid);
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
  const activeTankNum = async (uid) => (await getTanks(uid)).active_num || 1;
  const tankFishCount = async (uid, tier, num) =>
    (await db.get("SELECT COUNT(*) c FROM fish WHERE user_id=? AND tank=? AND tank_num=? AND location='tank'", uid, tier, num || 1)).c;
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
    const gem_amount = row.event_id ? C.EVENT_DIAMOND_DAILY : 0;
    return {
      id: row.id, species_id: row.species_id, group: row.grp, variant: row.variant,
      name: C.SPECIES_NAMES[row.species_id] || row.species_id,
      nickname: row.nickname || null,
      gender: row.gender, location: row.location, tank: row.tank,
      tank_num: row.tank_num || 1,
      x: row.x, y: row.y, born_at: row.born_at,
      level,
      stage,
      grow_level: C.growLevel(row.species_id),
      hunger, sick, mood: C.fishMood(sick, hunger),
      fed_at: row.fed_at, lineage,
      coin_pending, coin_in, coin_amount: coinRate ? coinRate.coins : 0,
      gem_pending, gem_amount,
      clean_at: row.clean_at || 0,
      origin: row.origin || 'shop', event_id: row.event_id || null,
      tradeable: tr.ok, trade_lock: tr.ok ? null : tr.reason,
    };
  };

  const addFish = async (uid, speciesId, opts, now) => {
    const grp = C.speciesGroup(speciesId);
    const tank = opts.tank || await activeTank(uid);
    const pos = (opts.x != null) ? { x: opts.x, y: opts.y } : C.randomPointInGlass(tank);
    // female_betta is always female; autumn_fish (event Maple) is 50/50;
    // every other betta is male; other groups are 50/50
    const gender = opts.gender || (speciesId === 'female_betta' ? 'female'
      : speciesId === 'autumn_fish' ? (Math.random() < 0.5 ? 'male' : 'female')
      : grp === 'betta' ? 'male'
      : (Math.random() < 0.5 ? 'male' : 'female'));
    const lineage = opts.lineage || { mother: null, father: null, hybrid: 0, generation: 0 };
    const info = await db.run(
      `INSERT INTO fish (user_id,species_id,grp,variant,gender,location,tank,tank_num,x,y,born_at,fed_at,lineage,origin,event_id,coin_at,sick_next_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      uid, speciesId, grp, opts.variant || speciesId, gender,
      opts.location || 'tank', tank, opts.tank_num || 1, pos.x, pos.y,
      opts.born_at || now, opts.fed_at || now, JSON.stringify(lineage),
      opts.origin || 'shop', opts.event_id || null, now, C.initialSickAt(now));
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
    let variant = egg.species || null; // resolved at breed time for new eggs
    if (!variant) {
    // Female Betta crosses produce their own hybrid offspring (not a 50/50 inherit).
    // Checked before the Maple branch so maple x female yields the bloom hybrid.
    if (pair.includes('female_betta')) {
      const other = pair[0] === 'female_betta' ? pair[1] : pair[0];
      variant = (C.FEMALE_CROSSES || {})[other] || null;
    }
    if (!variant && pair.includes('autumn_fish')) {
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
    }
    // Newborns go to a nursery with space; if all nurseries full, go to inventory
    const tanks = await getTanks(uid);
    let tank = 'nursery', tankNum = 1, location = 'inventory';
    const nurseryCount = tanks.nursery || 0;
    for (let n = 1; n <= nurseryCount; n++) {
      if (await tankFishCount(uid, 'nursery', n) < C.TANK_CAPACITY['nursery']) {
        tankNum = n;
        location = 'tank';
        break;
      }
    }
    // No nursery space (or no nursery): babies go to inventory
    const fish = await addFish(uid, variant, {
      variant, tank, tank_num: tankNum, location, born_at: now,
      lineage: { mother: egg.variant_b, father: egg.variant_a, hybrid: hybrid ? 1 : 0, generation: egg.generation },
      origin: 'bred', event_id: egg.event_id || null,
    }, now);
    await db.run('DELETE FROM eggs WHERE id=? AND user_id=?', egg.id, uid);
    return fish;
  };

  // --- time-based maintenance (runs inside GET /api/state, in a transaction) ---
  const maintain = (uid, now) => db.tx(async (t) => {
    const H = helpers(t);
    let ds = await t.get('SELECT last_cleaned_at, spawned_at FROM dirt_state WHERE user_id=?', uid);
    if (!ds) { await t.run('INSERT INTO dirt_state (user_id,last_cleaned_at,spawned_at) VALUES (?,?,?)', uid, now, now); ds = { last_cleaned_at: now, spawned_at: now }; }
    // bill each elapsed hour exactly once (2 spots/hr, cap 15): previously the
    // hours were re-billed on every state refresh, flooding dirt back in
    const billedFrom = ds.spawned_at != null ? ds.spawned_at : ds.last_cleaned_at;
    const hours = Math.floor((now - billedFrom) / 3600);
    const existing = (await t.get('SELECT COUNT(*) c FROM dirt_spots WHERE user_id=?', uid)).c;
    const toAdd = Math.max(0, Math.min(hours * 2, 15 - existing)); // 2/hr, cap 15
    // spawn dirt inside the fish swim area (glass minus the padding fish keep from edges)
    const tanks = await t.get('SELECT active FROM user_tanks WHERE user_id=?', uid);
    const glass = (C.GLASS || {})[(tanks && tanks.active) || 'small'] || { left: .17, right: .82, top: .38, bottom: .79 };
    const swim = { left: glass.left + .025, right: glass.right - .025, top: glass.top + .04, bottom: glass.bottom - .06 };
    // remove any existing spots that fell outside the swim area
    await t.run(`DELETE FROM dirt_spots WHERE user_id=? AND
      (x < ? OR x > ? OR y < ? OR y > ?)`,
      uid, swim.left, swim.right, swim.top, swim.bottom);
    for (let i = 0; i < toAdd; i++) {
      await t.run('INSERT INTO dirt_spots (user_id,x,y,created_at) VALUES (?,?,?,?)',
        uid, rand(swim.left + .01, swim.right - .01), rand(swim.top + .01, swim.bottom - .01), now);
    }
    if (hours > 0) {
      await t.run('UPDATE dirt_state SET spawned_at=? WHERE user_id=?', billedFrom + hours * 3600, uid);
    }
    const green = (now - ds.last_cleaned_at) >= 5 * 3600;

    // shrimp: each shrimp auto-collects banked coins from 1 fish every 3 hours;
    // the royal shrimp does it every hour
    const shrimps = await t.all(
      "SELECT id, species_id, tank, tank_num, clean_at FROM fish WHERE user_id=? AND grp='shrimp' AND location='tank'", uid);
    for (const sh of shrimps) {
      const cooldown = sh.species_id === 'royal_shrimp' ? 3600 : 3 * 3600;
      if (sh.clean_at && now - sh.clean_at < cooldown) continue;
      const target = await t.get(
        `SELECT id, coin_pending FROM fish WHERE user_id=? AND location='tank'
         AND tank=? AND tank_num=? AND coin_pending > 0 AND id != ?
         ORDER BY coin_pending DESC LIMIT 1`,
        uid, sh.tank, sh.tank_num || 1, sh.id);
      if (!target) continue;
      await t.run('UPDATE wallets SET coins=coins+? WHERE user_id=?', target.coin_pending, uid);
      await t.run('UPDATE fish SET coin_pending=0, coin_at=? WHERE id=?', now, target.id);
      await t.run('UPDATE fish SET clean_at=? WHERE id=?', now, sh.id);
    }

    const due = await t.all('SELECT * FROM eggs WHERE user_id=? AND hatch_at<=?', uid, now);
    const hatched = [];
    for (const egg of due) hatched.push(await H.hatchEgg(uid, egg, now));
    return { green, hatched };
  });

  // ---------- animated background FX ----------
  // One-time unlock per effect (account-wide); equip per tank tier.
  const BGFX = {
    bubbles:  { coins: 2000 },
    plankton: { gems: 1000 },
  };
  const bgfxState = async (uid) => {
    const owned = (await db.all('SELECT fx_id FROM bgfx_owned WHERE user_id=?', uid)).map((r) => r.fx_id);
    const eq = await db.all('SELECT tank, fx_id FROM bgfx_equipped WHERE user_id=?', uid);
    return { owned, equipped: Object.fromEntries(eq.map((r) => [r.tank, r.fx_id])) };
  };

  // ---------- 7-day login rewards ----------
  // Day 1: 15 gems; days 2-5: one autumn furniture each; day 6: 100 gems;
  // day 7: Oldflower Betta. Miss a day and the cycle restarts at day 1.
  const LOGIN_REWARDS = [
    { day: 1, gems: 15 },
    { day: 2, deco: 'deco_autumn_maple_arch' },
    { day: 3, deco: 'deco_autumn_maple_lantern' },
    { day: 4, deco: 'deco_autumn_hollow_log' },
    { day: 5, deco: 'deco_autumn_lantern_bridge' },
    { day: 6, gems: 100 },
    { day: 7, fish: 'oldflower_betta' },
  ];
  const loginDayStr = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  const loginState = async (uid, t) => {
    const row = await db.get('SELECT streak_day, last_claim_date FROM login_streak WHERE user_id=?', uid);
    const today = loginDayStr(t), yesterday = loginDayStr(t - 86400);
    let day = row ? (row.streak_day || 1) : 1;
    let claimedToday = false;
    if (row && row.last_claim_date === today) claimedToday = true;
    else if (!row || row.last_claim_date !== yesterday) day = 1; // fresh start or missed day(s)
    day = Math.min(7, Math.max(1, day));
    const rewards = LOGIN_REWARDS.map((rw) => {
      const d = rw.deco ? C.decorItem(rw.deco) : null;
      return { day: rw.day, gems: rw.gems || 0,
        deco: rw.deco || null, deco_name: d ? d.name : null, deco_file: d ? d.file : null,
        fish: rw.fish || null, fish_name: rw.fish ? 'Oldflower Betta' : null };
    });
    return { day, claimed_today: claimedToday, claimed_days: Array.from({ length: day - 1 }, (_, i) => i + 1), rewards, today };
  };

  return {
    getWallet, addCoins, addGems, addXp, getTanks, activeTank, activeTankNum,
    tankFishCount, totalFishCount, ensureQuests, questRow, questProgressAdd,
    questProgressMax, questList, fishJson, addFish, hatchEgg, maintain,
    BGFX, bgfxState, LOGIN_REWARDS, loginState,
  };
}

module.exports = function gameRoutes(db) {
  const r = Router();
  const H = helpers(db);
  const now = () => Math.floor(Date.now() / 1000);

  // ---------- offline-capable actions (explicit timestamp t) ----------
  // Core game actions. Live routes call these with t=now(); POST /sync replays
  // queued offline actions with validated t. They throw {status, message} on
  // failure so both callers handle errors uniformly. Anti-cheat notes:
  // - collect only pays coin_pending banked server-side (lazy, server clock)
  // - breed RNG rolls here at sync time, never on the client
  // - t is validated by /sync: base-120 <= t <= serverNow+30
  const doFeed = async (uid, kind, t) => {
    kind = kind === 'special' ? 'special' : 'normal';
    const tank = await H.activeTank(uid);
    const tankNum = await H.activeTankNum(uid);
    const tankFish = await db.all("SELECT id, grp, fed_at FROM fish WHERE user_id=? AND tank=? AND tank_num=? AND location='tank'", uid, tank, tankNum);
    // only hungry fish get pellets now: a fish only gets full when it actually
    // catches its pellet (reported via /fish/feed/catch), not when food is dropped
    const targets = tankFish.filter((f) => (kind === 'special') === (f.grp === 'bottom_fish') && C.hungerPct(f.fed_at, t) < 100);
    if (targets.length === 0) return { pellets: 0, kind };
    const w = await H.getWallet(uid);
    if (kind === 'special') {
      if ((w.food_special || 0) < targets.length) throw { status: 400, message: 'no special food' };
    } else if (w.food < targets.length) {
      throw { status: 400, message: 'no food' };
    }
    await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      if (kind === 'special') await txDb.run('UPDATE wallets SET food_special=food_special-? WHERE user_id=?', targets.length, uid);
      else await txDb.run('UPDATE wallets SET food=food-? WHERE user_id=?', targets.length, uid);
      await Ht.questProgressAdd(uid, 'feed_3', 1, t);
      await Ht.addXp(uid, 2);
    });
    return { pellets: targets.length, kind };
  };

  const doFeedCatch = async (uid, fish_id, t) => {
    // the client reports this when a fish visually catches a pellet:
    // only a genuinely hungry fish gets full from it (food was paid at drop time)
    const fish = await db.get("SELECT id, fed_at, location FROM fish WHERE id=? AND user_id=?", fish_id, uid);
    if (!fish) throw { status: 404, message: 'fish not found' };
    if (fish.location !== 'tank') throw { status: 400, message: 'not in tank' };
    if (C.hungerPct(fish.fed_at, t) >= 100) throw { status: 400, message: 'not hungry' };
    await db.run('UPDATE fish SET fed_at=? WHERE id=?', t, fish_id);
    return {};
  };
  const doFeedOne = async (uid, fish_id, t) => {
    const fish = await db.get('SELECT id, grp FROM fish WHERE id=? AND user_id=?', fish_id, uid);
    if (!fish) throw { status: 404, message: 'fish not found' };
    const bottom = fish.grp === 'bottom_fish';
    const w = await H.getWallet(uid);
    if (bottom && (w.food_special || 0) < 1) throw { status: 400, message: 'no special food' };
    if (!bottom && w.food < 1) throw { status: 400, message: 'no food' };
    await db.tx(async (txDb) => {
      if (bottom) await txDb.run('UPDATE wallets SET food_special=food_special-1 WHERE user_id=?', uid);
      else await txDb.run('UPDATE wallets SET food=food-1 WHERE user_id=?', uid);
      await txDb.run('UPDATE fish SET fed_at=? WHERE id=?', t, fish_id);
    });
    return {};
  };

  const doTreat = async (uid, fish_id, t) => {
    const fish = await db.get('SELECT id,sick_at FROM fish WHERE id=? AND user_id=?', fish_id, uid);
    if (!fish) throw { status: 404, message: 'fish not found' };
    if (!fish.sick_at) throw { status: 400, message: 'not sick' };
    const w = await H.getWallet(uid);
    if ((w.medicine || 0) < 1) throw { status: 400, message: 'no medicine' };
    await db.tx(async (txDb) => {
      await txDb.run('UPDATE wallets SET medicine=medicine-1 WHERE user_id=?', uid);
      // cured: next sickness ~a week later (6-8 days, per-fish jitter)
      await txDb.run('UPDATE fish SET sick_at=NULL, fed_at=?, sick_next_at=? WHERE id=?', t, C.nextSickAt(t), fish_id);
    });
    return {};
  };

  const doCollect = async (uid, fish_id, t) => {
    const fish = await db.get('SELECT id,coin_pending,gem_pending FROM fish WHERE id=? AND user_id=?', fish_id, uid);
    if (!fish) throw { status: 404, message: 'fish not found' };
    if (!fish.coin_pending || fish.coin_pending <= 0) {
      throw { status: 400, message: 'nothing to collect' };
    }
    const coins = fish.coin_pending;
    const gems = fish.gem_pending || 0;
    await db.tx(async (txDb) => {
      await txDb.run('UPDATE fish SET coin_pending=0, gem_pending=0, coin_at=? WHERE id=?', t, fish_id);
      if (gems > 0) await txDb.run('UPDATE fish SET gem_at=? WHERE id=?', t, fish_id);
      await txDb.run('UPDATE wallets SET coins=coins+?, gems=gems+? WHERE user_id=?', coins, gems, uid);
    });
    const w = await H.getWallet(uid);
    return { collected: coins, collected_gems: gems, coins: w.coins, gems: w.gems };
  };

  const doTap = async (uid, fish_id, t) => {
    const fish = await db.get('SELECT id FROM fish WHERE id=? AND user_id=?', fish_id, uid);
    if (!fish) throw { status: 404, message: 'fish not found' };
    await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      await Ht.addXp(uid, 1);
    });
    return {};
  };

  const doBreed = async (uid, male_id, female_id, t) => {
    const maleId = Number(male_id);
    const femaleId = Number(female_id);
    const male = await db.get('SELECT * FROM fish WHERE id=? AND user_id=?', maleId, uid);
    const female = await db.get('SELECT * FROM fish WHERE id=? AND user_id=?', femaleId, uid);
    if (!male || !female) throw { status: 404, message: 'fish not found' };
    if (male.location === 'market' || female.location === 'market') {
      throw { status: 400, message: 'cancel the market listing first 💎' };
    }
    if (maleId === femaleId) throw { status: 400, message: 'pick two different fish' };
    if (male.gender !== 'male' || female.gender !== 'female') {
      throw { status: 400, message: 'breeding needs one male and one female' };
    }
    if (C.breedFamily(male.species_id) !== C.breedFamily(female.species_id)) {
      throw { status: 400, message: "These species can't breed together" };
    }
    const lin = (f) => { try { return JSON.parse(f.lineage); } catch { return {}; } };
    if (lin(male).hybrid || lin(female).hybrid) {
      throw { status: 400, message: 'hybrids cannot breed' };
    }
    const w = await H.getWallet(uid);
    if (w.gems < 2) throw { status: 400, message: 'not enough gems' };

    const hybrid = male.species_id !== female.species_id;
    const hatchHours = hybrid ? C.HYBRID_HATCH_HOURS : C.HATCH_HOURS[male.grp];
    const generation = Math.max(lin(male).generation || 0, lin(female).generation || 0) + 1;

    const eggId = await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      await txDb.run('UPDATE wallets SET gems=gems-2 WHERE user_id=?', uid);
      const species = resolveEggSpecies(male.species_id, female.species_id);
      const info = await txDb.run(
        `INSERT INTO eggs (user_id,grp,variant_a,variant_b,hybrid,generation,hatch_at,created_at,event_id,species)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        uid, male.grp, male.species_id, female.species_id, hybrid ? 1 : 0,
        generation, t + hatchHours * 3600, t, null, species);
      await Ht.questProgressAdd(uid, 'breed_1', 1, t);
      await Ht.addXp(uid, 5);
      return info.lastInsertRowid;
    });
    const egg = await db.get('SELECT * FROM eggs WHERE id=?', eggId);
    return {
      egg: {
        id: egg.id, group: egg.grp, variant_a: egg.variant_a, variant_b: egg.variant_b,
        hybrid: !!egg.hybrid, generation: egg.generation, hatch_at: egg.hatch_at, created_at: egg.created_at,
        species: egg.species || null,
      },
    };
  };

  // ---------- state ----------
  // Full game state with lazy time-based mechanics (sickness, coin banking,
  // egg hatching, dirt). Extracted so POST /sync can reuse it after replaying
  // the offline queue. Returns {server_time, state}.
  const getStateJson = async (uid, t) => {
    const { green } = await H.maintain(uid, t);
    // lazy sickness: weekly cycle — a fish falls sick when its scheduled time arrives
    await db.run('UPDATE fish SET sick_at=? WHERE user_id=? AND sick_at IS NULL AND sick_next_at IS NOT NULL AND sick_next_at <= ?',
      t, uid, t);
    // lazy coin farming: a finished cycle banks coins and waits for collection
    const coinFish = await db.all(
      "SELECT id, species_id, grp, born_at, lineage, event_id, coin_pending, coin_at, gem_pending, gem_at FROM fish WHERE user_id=? AND location='tank'", uid);
    for (const fr of coinFish) {
      // diamonds: event fish bank 1 per day on their own cycle (collecting restarts the clock)
      if (fr.event_id) {
        if (!fr.gem_at) { await db.run('UPDATE fish SET gem_at=? WHERE id=?', t, fr.id); }
        else if (!fr.gem_pending && t - fr.gem_at >= C.EVENT_DIAMOND_SECS) {
          await db.run('UPDATE fish SET gem_pending=?, gem_at=? WHERE id=?', C.EVENT_DIAMOND_DAILY, t, fr.id);
        }
      }
      if (fr.coin_pending > 0) continue;
      if (!fr.coin_at) { await db.run('UPDATE fish SET coin_at=? WHERE id=?', t, fr.id); continue; }
      const lin = fr.lineage ? JSON.parse(fr.lineage) : {};
      const lvl = C.fishLevel(fr.grp, !!lin.hybrid, fr.born_at, t);
      const stage = C.growthStage(fr.species_id, lvl);
      const rate = C.COIN_FARM[stage];
      // gold: hourly like every other fish (event fish included)
      if (rate && t - fr.coin_at >= rate.secs) {
        await db.run('UPDATE fish SET coin_pending=? WHERE id=?', rate.coins, fr.id);
      }
    }
    const user = await db.get(
      `SELECT u.id,u.name,u.email,u.avatar,u.avatar_cfg,u.welcome100_seen,w.level,w.xp,w.coins,w.gems,w.food,w.food_special,w.medicine
       FROM users u JOIN wallets w ON w.user_id=u.id WHERE u.id=?`, uid);
    if (user) {
      // `avatar_url` is the uploaded profile photo; `avatar` is the chibi
      // avatar CONFIG object (users.avatar_cfg). The raw photo value and
      // the config JSON stay server-side.
      user.avatar_url = user.avatar ? (user.avatar.startsWith('data:') ? user.avatar : '/uploads/avatars/' + user.avatar) : '';
      user.avatar = parseAvatarCfg(user.avatar_cfg);
      delete user.avatar_cfg;
    }
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
        species: e.species || null,
      }));
    const spots = await db.all('SELECT id,x,y FROM dirt_spots WHERE user_id=?', uid);
    const ds = await db.get('SELECT last_cleaned_at FROM dirt_state WHERE user_id=?', uid);
    const decor_owned = await db.all('SELECT deco_id,qty FROM decor_owned WHERE user_id=? AND qty>0', uid);
    const placements = await db.all('SELECT id,deco_id,tank,tank_num,x,y FROM decor_placements WHERE user_id=?', uid);
    const collection = (await db.all('SELECT species_id,count FROM collection WHERE user_id=?', uid))
      .map((c) => ({ species_id: c.species_id, seen: 1, count: c.count }));
    const settings = await db.get('SELECT music,sfx,quality FROM settings WHERE user_id=?', uid);
    const bgfx = await H.bgfxState(uid);

    return {
      server_time: t,
      state: {
        user,
        show_welcome100: !(user && user.welcome100_seen),
        wallets: { coins: user.coins, gems: user.gems, food: user.food, xp: user.xp, level: user.level, medicine: user.medicine || 0, food_special: user.food_special || 0 },
        bgfx,
        tanks: {
          owned: ['small', 'medium', 'large', 'xl', 'nursery'].filter((k) => tanks[k]),
          // instances: list of {tier, num} for all owned tanks (up to 3 per tier)
          instances: ['small', 'medium', 'large', 'xl', 'nursery'].flatMap((k) =>
            Array.from({ length: tanks[k] || 0 }, (_, i) => ({ tier: k, num: i + 1 }))),
          counts: { small: tanks.small || 0, medium: tanks.medium || 0, large: tanks.large || 0, xl: tanks.xl || 0, nursery: tanks.nursery || 0 },
          active: tanks.active,
          activeNum: tanks.active_num || 1,
          extra: { small: tanks.small_extra || 0, medium: tanks.medium_extra || 0, large: tanks.large_extra || 0, xl: tanks.xl_extra || 0, nursery: tanks.nursery_extra || 0 },
          extraMax: C.DECOR_EXTRA_SLOT_MAX,
          extraCost: C.DECOR_EXTRA_SLOT_COST,
        },
        fish, eggs,
        dirt: { spots, green, last_cleaned_at: ds ? ds.last_cleaned_at : t },
        decor_owned, placements,
        quests: await H.questList(uid, t),
        login: await H.loginState(uid, t),
        collection,
        settings: { music: !!settings.music, sfx: !!settings.sfx, quality: settings.quality },
      },
    };
  };

  r.get('/state', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const out = await getStateJson(uid, t);
    res.json({ ok: true, server_time: out.server_time, state: out.state });
  }));

  // ---------- welcome 100-diamond promo ----------
  // Marks the one-time "YOU GOT 100 DIAMONDS!" ad as seen for this account.
  r.post('/welcome/seen', ah(async (req, res) => {
    await db.run('UPDATE users SET welcome100_seen=1 WHERE id=?', req.user.id);
    res.json({ ok: true });
  }));

  // ---------- offline sync ----------
  // Replays actions queued while the device was offline, then returns fresh
  // state. Anti-cheat:
  // - each action timestamp t must satisfy base_time-120 <= t <= serverNow+30,
  //   where base_time is the last server time the client observed
  // - client timestamps come from a monotonic clock (performance.now anchor),
  //   so changing the phone's wall clock doesn't forge time
  // - coin collect only pays coin_pending banked server-side (server clock)
  // - breed RNG rolls here at sync time, never on the client
  // - max 200 actions per sync; every action re-runs live validation
  r.post('/sync', ah(async (req, res) => {
    const uid = req.user.id;
    const serverNow = now();
    const { base_time, actions } = req.body || {};
    const base = Math.floor(Number(base_time) || 0);
    if (!base || base > serverNow + 30) {
      return res.status(400).json({ ok: false, error: 'bad base_time' });
    }
    const list = Array.isArray(actions) ? actions.slice(0, 200) : [];
    const results = [];
    for (const a of list) {
      const t = Math.floor(Number(a && a.t) || 0);
      if (!t || t < base - 120 || t > serverNow + 30) {
        results.push({ ok: false, type: a && a.type, error: 'bad timestamp' });
        continue;
      }
      try {
        let out;
        switch (a.type) {
          case 'feed': out = await doFeed(uid, a.kind, t); break;
          case 'feed-one': out = await doFeedOne(uid, a.fish_id, t); break;
          case 'feed-catch': out = await doFeedCatch(uid, a.fish_id, t); break;
          case 'treat': out = await doTreat(uid, a.fish_id, t); break;
          case 'collect': out = await doCollect(uid, a.fish_id, t); break;
          case 'tap': out = await doTap(uid, a.fish_id, t); break;
          case 'breed': out = await doBreed(uid, a.male_id, a.female_id, t); break;
          default: throw { status: 400, message: 'unknown action' };
        }
        results.push({ ok: true, type: a.type, ...out });
      } catch (e) {
        results.push({ ok: false, type: a.type, error: (e && e.message) || 'failed' });
      }
    }
    const out = await getStateJson(uid, serverNow);
    res.json({ ok: true, results, server_time: out.server_time, state: out.state });
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
        if (item.price_coins != null && w.coins >= item.price_coins) {
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
    try {
      const out = await doFeed(uid, req.body && req.body.kind, t);
      res.json({ ok: true, pellets: out.pellets, kind: out.kind });
    } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message || 'feed failed' }); }
  }));

  r.post('/fish/feed-one', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    try {
      await doFeedOne(uid, req.body && req.body.fish_id, t);
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message || 'feed failed' }); }
  }));

  // client reports a pellet catch: the fish only gets full if it was hungry
  r.post('/fish/feed/catch', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    try {
      await doFeedCatch(uid, req.body && req.body.fish_id, t);
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message || 'feed failed' }); }
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

  // Lab: cure ALL sick fish in the active tank at once — costs 10 diamonds.
  const CURE_ALL_GEMS = 10;
  r.post('/lab/cure-all', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const w = await H.getWallet(uid);
    if ((w.gems || 0) < CURE_ALL_GEMS) return res.status(400).json({ ok: false, error: 'not enough gems' });
    const tier = await H.activeTank(uid);
    const num = await H.activeTankNum(uid);
    const sick = await db.all(
      "SELECT id FROM fish WHERE user_id=? AND tank=? AND tank_num=? AND location='tank' AND sick_at IS NOT NULL",
      uid, tier, num);
    if (!sick.length) return res.status(400).json({ ok: false, error: 'no sick fish' });
    await db.tx(async (txDb) => {
      await txDb.run('UPDATE wallets SET gems=gems-? WHERE user_id=?', CURE_ALL_GEMS, uid);
      // each cured fish gets its own next-sickness time ~a week out, so they stay staggered
      for (const f of sick) {
        await txDb.run('UPDATE fish SET sick_at=NULL, fed_at=?, sick_next_at=? WHERE id=?',
          t, C.nextSickAt(t), f.id);
      }
    });
    res.json({ ok: true, cured: sick.length });
  }));

  // ---------- animated background FX ----------
  // (catalog + state live on H — see helpers() above)
  r.get('/shop/bgfx', ah(async (req, res) => {
    const uid = req.user.id;
    const st = await H.bgfxState(uid);
    res.json({
      ok: true,
      items: Object.entries(H.BGFX).map(([id, c]) => ({ id, gems: c.gems || 0, coins: c.coins || 0, owned: st.owned.includes(id) })),
      equipped: st.equipped,
    });
  }));
  r.post('/shop/bgfx/buy', ah(async (req, res) => {
    const uid = req.user.id;
    const fx_id = (req.body && req.body.fx_id) || '';
    const item = H.BGFX[fx_id];
    if (!item) return res.status(400).json({ ok: false, error: 'unknown effect' });
    const owned = await db.get('SELECT 1 FROM bgfx_owned WHERE user_id=? AND fx_id=?', uid, fx_id);
    if (owned) return res.status(400).json({ ok: false, error: 'already owned' });
    const w = await H.getWallet(uid);
    const costGems = item.gems || 0, costCoins = item.coins || 0;
    if ((w.gems || 0) < costGems) return res.status(400).json({ ok: false, error: 'not enough gems' });
    if ((w.coins || 0) < costCoins) return res.status(400).json({ ok: false, error: 'not enough coins' });
    await db.tx(async (txDb) => {
      if (costGems > 0) await txDb.run('UPDATE wallets SET gems=gems-? WHERE user_id=?', costGems, uid);
      if (costCoins > 0) await txDb.run('UPDATE wallets SET coins=coins-? WHERE user_id=?', costCoins, uid);
      await txDb.run('INSERT INTO bgfx_owned (user_id, fx_id) VALUES (?,?)', uid, fx_id);
    });
    res.json({ ok: true });
  }));
  r.post('/bgfx/equip', ah(async (req, res) => {
    const uid = req.user.id;
    const fx_id = (req.body && req.body.fx_id) || null;
    if (fx_id !== null) {
      if (!H.BGFX[fx_id]) return res.status(400).json({ ok: false, error: 'unknown effect' });
      const owned = await db.get('SELECT 1 FROM bgfx_owned WHERE user_id=? AND fx_id=?', uid, fx_id);
      if (!owned) return res.status(400).json({ ok: false, error: 'not owned' });
    }
    const tier = await H.activeTank(uid);
    if (fx_id === null) await db.run('DELETE FROM bgfx_equipped WHERE user_id=? AND tank=?', uid, tier);
    else await db.run(`INSERT INTO bgfx_equipped (user_id, tank, fx_id) VALUES (?,?,?)
      ON CONFLICT(user_id, tank) DO UPDATE SET fx_id=excluded.fx_id`, uid, tier, fx_id);
    res.json({ ok: true });
  }));

  r.post('/fish/treat', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    try {
      await doTreat(uid, req.body && req.body.fish_id, t);
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message || 'treat failed' }); }
  }));

  // ---------- collect farmed coins (fish stops earning until collected) ----------
  r.post('/fish/collect', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    try {
      const out = await doCollect(uid, req.body && req.body.fish_id, t);
      res.json({ ok: true, collected: out.collected, collected_gems: out.collected_gems, coins: out.coins, gems: out.gems });
    } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message || 'collect failed' }); }
  }));

  r.post('/fish/tap', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    try {
      await doTap(uid, req.body && req.body.fish_id, t);
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message || 'tap failed' }); }
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
    const { fish_id, tier, num } = req.body || {};
    const tankNum = Math.min(3, Math.max(1, parseInt(num) || 1));
    if (!['small', 'medium', 'large', 'xl', 'nursery'].includes(tier)) {
      return res.status(400).json({ ok: false, error: 'invalid tank' });
    }
    const fish = await db.get(
      "SELECT id, tank, tank_num, location, grp, born_at, lineage FROM fish WHERE id=? AND user_id=?", fish_id, uid);
    if (!fish) return res.status(404).json({ ok: false, error: 'fish not found' });
    if (fish.location === 'market')
      return res.status(400).json({ ok: false, error: 'cancel the market listing first 💎' });
    if (fish.location === 'tank' && fish.tank === tier && (fish.tank_num || 1) === tankNum)
      return res.status(400).json({ ok: false, error: 'already in that tank' });
    // Fish level determines where it can go
    let hybrid = false;
    try { hybrid = !!(JSON.parse(fish.lineage || '{}').hybrid); } catch(e) {}
    const lvl = C.fishLevel(fish.grp, hybrid, fish.born_at, now());
    if (tier === 'nursery') {
      // Nursery accepts baby and young fish (level 1-9), only adults (10) are rejected
      if (lvl >= 10) {
        return res.status(400).json({ ok: false, error: 'nursery only accepts young fish' });
      }
    } else {
      // Regular tanks accept young (5+) and adults — only babies (1-4) must stay in nursery
      if (lvl <= 4) {
        return res.status(400).json({ ok: false, error: 'baby fish must stay in the nursery' });
      }
    }
    const tanks = await H.getTanks(uid);
    if (!(tanks[tier] >= tankNum)) return res.status(400).json({ ok: false, error: 'tank not owned' });
    if (await H.tankFishCount(uid, tier, tankNum) >= C.TANK_CAPACITY[tier]) {
      return res.status(400).json({ ok: false, error: 'target tank is full' });
    }
    await db.run("UPDATE fish SET tank=?, tank_num=?, location='tank', x=?, y=? WHERE id=? AND user_id=?",
      tier, tankNum, Math.random(), 0.2 + Math.random() * 0.6, fish_id, uid);
    res.json({ ok: true, tier, num: tankNum });
  }));

  // ---------- tanks ----------
  r.post('/tanks/buy', ah(async (req, res) => {
    const uid = req.user.id;
    const { tier } = req.body || {};
    if (!['small', 'medium', 'large', 'xl', 'nursery'].includes(tier)) return res.status(400).json({ ok: false, error: 'invalid tier' });
    const tanks = await H.getTanks(uid);
    const count = tanks[tier] || 0;
    if (count >= 3) return res.status(400).json({ ok: false, error: 'max 3 per tier' });
    if (tier === 'large' && !tanks.medium) return res.status(400).json({ ok: false, error: 'buy medium first' });
    if (tier === 'xl' && !tanks.large) return res.status(400).json({ ok: false, error: 'buy large first' });
    const price = C.TANK_PRICES[tier];
    const w = await H.getWallet(uid);
    if (w.coins < price) return res.status(400).json({ ok: false, error: 'not enough coins' });
    await db.tx(async (txDb) => {
      await txDb.run('UPDATE wallets SET coins=coins-? WHERE user_id=?', price, uid);
      await txDb.run(`UPDATE user_tanks SET ${tier}=${tier}+1 WHERE user_id=?`, uid);
    });
    res.json({ ok: true, count: count + 1 });
  }));

  // Sell a tank instance back for half its price. Fish inside return to the
  // inventory, decor returns un-placed, higher instances slide down a number
  // (fish, decor and house layout renumbered together).
  r.post('/tanks/sell', ah(async (req, res) => {
    const uid = req.user.id;
    const { tier } = req.body || {};
    const num = Math.min(3, Math.max(1, parseInt((req.body || {}).num) || 1));
    if (!['small', 'medium', 'large', 'xl', 'nursery'].includes(tier)) return res.status(400).json({ ok: false, error: 'invalid tier' });
    const tanks = await H.getTanks(uid);
    const count = (tanks && tanks[tier]) || 0;
    if (count < num) return res.status(400).json({ ok: false, error: 'tank not owned' });
    const total = ['small', 'medium', 'large', 'xl', 'nursery'].reduce((s, t2) => s + ((tanks && tanks[t2]) || 0), 0);
    if (total <= 1) return res.status(400).json({ ok: false, error: 'cannot sell your last tank' });
    const refund = Math.floor((C.TANK_PRICES[tier] || 0) / 2);
    await db.tx(async (txDb) => {
      await txDb.run("UPDATE fish SET location='inventory' WHERE user_id=? AND tank=? AND tank_num=? AND location='tank'", uid, tier, num);
      await txDb.run('UPDATE fish SET tank_num=tank_num-1 WHERE user_id=? AND tank=? AND tank_num>?', uid, tier, num);
      await txDb.run('DELETE FROM decor_placements WHERE user_id=? AND tank=? AND tank_num=?', uid, tier, num);
      await txDb.run('UPDATE decor_placements SET tank_num=tank_num-1 WHERE user_id=? AND tank=? AND tank_num>?', uid, tier, num);
      await txDb.run(`UPDATE user_tanks SET ${tier}=${tier}-1 WHERE user_id=?`, uid);
      if (refund > 0) await txDb.run('UPDATE wallets SET coins=coins+? WHERE user_id=?', refund, uid);
      // keep the active tank pointer on a tank that still exists
      const nt = await txDb.get('SELECT * FROM user_tanks WHERE user_id=?', uid);
      let active = nt.active, activeNum = nt.active_num || 1;
      if (active === tier) {
        if ((nt[tier] || 0) === 0) {
          active = ['small', 'nursery', 'medium', 'large', 'xl'].find((t2) => (nt[t2] || 0) > 0) || 'small';
          activeNum = 1;
        } else if (activeNum === num) activeNum = Math.min(num, nt[tier]);
        else if (activeNum > num) activeNum -= 1;
      }
      await txDb.run('UPDATE user_tanks SET active=?, active_num=? WHERE user_id=?', active, activeNum, uid);
      // house layout: the sold aquarium leaves the room, higher ones renumber
      const hl = await txDb.get('SELECT layout FROM house_layout WHERE user_id=?', uid);
      if (hl && hl.layout) {
        try {
          const parsed = JSON.parse(hl.layout);
          if (parsed && Array.isArray(parsed.items)) {
            parsed.items = parsed.items.filter((it) => {
              const tk = houseTankOf(it);
              if (!tk || tk.tier !== tier) return true;
              if (tk.num === num) return false;
              if (tk.num > num) it.tank_num = tk.num - 1;
              return true;
            });
            await txDb.run('UPDATE house_layout SET layout=? WHERE user_id=?', JSON.stringify(parsed), uid);
          }
        } catch (e) { /* malformed layout: leave it alone */ }
      }
    });
    res.json({ ok: true, refund, count: count - 1 });
  }));

  r.post('/tanks/switch', ah(async (req, res) => {
    const uid = req.user.id;
    const { tier, num } = req.body || {};
    const tankNum = Math.min(3, Math.max(1, parseInt(num) || 1));
    if (!['small', 'medium', 'large', 'xl', 'nursery'].includes(tier)) return res.status(400).json({ ok: false, error: 'invalid tier' });
    const tanks = await H.getTanks(uid);
    if (!(tanks[tier] >= tankNum)) return res.status(400).json({ ok: false, error: 'tank not owned' });
    await db.run('UPDATE user_tanks SET active=?, active_num=? WHERE user_id=?', tier, tankNum, uid);
    res.json({ ok: true });
  }));

  // ---------- tanks: buy an extra decor slot (diamonds) ----------
  r.post('/tanks/extra-slot', ah(async (req, res) => {
    const uid = req.user.id;
    const { tank } = req.body || {};
    if (!['small', 'medium', 'large', 'xl', 'nursery'].includes(tank)) return res.status(400).json({ ok: false, error: 'invalid tank' });
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
    const fam = C.breedFamily(fish.species_id);
    const rows = await db.all(
      "SELECT * FROM fish WHERE user_id=? AND location='tank' AND gender=? AND id!=? ORDER BY id",
      uid, other, fishId);
    const compatible = rows.filter((f) => C.breedFamily(f.species_id) === fam);
    res.json({ ok: true, partners: compatible.map((f) => H.fishJson(f, t)).filter((p) => !(p.lineage && p.lineage.hybrid)) });
  }));

  r.post('/breeding/breed', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    try {
      const out = await doBreed(uid, req.body && req.body.male_id, req.body && req.body.female_id, t);
      res.json({ ok: true, egg: out.egg });
    } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message || 'breed failed' }); }
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
        await txDb.run('UPDATE dirt_state SET last_cleaned_at=?, spawned_at=? WHERE user_id=?', t, t, uid);
      }
      return { remaining, green: !!green };
    });
    res.json({ ok: true, remaining, green });
  }));

  // cory cleaning: a bottom fish swims to a dirt spot and sucks it up
  // (cory 1/hour, pleco 4/hour, blackleaf 1 per 3 hours — enforced per fish)
  r.post('/dirt/cory-clean', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { spot_id, fish_id } = req.body || {};
    const fish = await db.get('SELECT id, species_id, grp, clean_at, location, tank FROM fish WHERE id=? AND user_id=?', fish_id, uid);
    if (!fish || fish.grp !== 'bottom_fish') return res.status(404).json({ ok: false, error: 'fish not found' });
    if (fish.location !== 'tank') return res.status(400).json({ ok: false, error: 'fish not in tank' });
    const active = await H.activeTank(uid);
    if (fish.tank !== active) return res.status(400).json({ ok: false, error: 'fish not in active tank' });
    const cd = fish.species_id === 'pleco' ? 900 : fish.species_id === 'blackleaf' ? 10800 : 3600;
    if (fish.clean_at && t - fish.clean_at < cd) {
      return res.status(400).json({ ok: false, error: 'cleaning cooldown', retry_in: cd - (t - fish.clean_at) });
    }
    const spot = await db.get('SELECT id FROM dirt_spots WHERE id=? AND user_id=?', spot_id, uid);
    if (!spot) return res.status(404).json({ ok: false, error: 'spot gone' });
    await db.tx(async (txDb) => {
      await txDb.run('DELETE FROM dirt_spots WHERE id=?', spot_id);
      await txDb.run('UPDATE fish SET clean_at=? WHERE id=?', t, fish_id);
    });
    res.json({ ok: true });
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
      await txDb.run('UPDATE dirt_state SET last_cleaned_at=?, spawned_at=? WHERE user_id=?', t, t, uid);
    });
    res.json({ ok: true });
  }));

  // ---------- decor shop ----------
  r.get('/shop/decor', ah(async (req, res) => res.json({ ok: true, items: C.decorCatalog().filter((i) => i.shop) })));
  // full catalog (including retired items) for rendering owned/placed decorations
  r.get('/decor/catalog', ah(async (req, res) => res.json({ ok: true, items: C.decorCatalog() })));

  r.post('/shop/decor/buy', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { deco_id } = req.body || {};
    const item = C.decorItem(deco_id);
    if (!item) return res.status(400).json({ ok: false, error: 'unknown decoration' });
    if (!item.shop) return res.status(400).json({ ok: false, error: 'no longer sold' });
    if (item.event === 'grab') return res.status(400).json({ ok: false, error: 'grab exclusive' });
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
    const { deco_id, tank, tank_num, x, y } = req.body || {};
    if (!C.decorItem(deco_id)) return res.status(400).json({ ok: false, error: 'unknown decoration' });
    if (!['small', 'medium', 'large', 'xl', 'nursery'].includes(tank)) return res.status(400).json({ ok: false, error: 'invalid tank' });
    const tnum = Math.min(3, Math.max(1, Math.floor(Number(tank_num)) || 1));
    const tanks = await H.getTanks(uid);
    if (!tanks[tank]) return res.status(400).json({ ok: false, error: 'tank not owned' });
    const owned = await db.get('SELECT qty FROM decor_owned WHERE user_id=? AND deco_id=?', uid, deco_id);
    if (!owned || owned.qty <= 0) return res.status(400).json({ ok: false, error: 'not owned' });
    const placed = (await db.get('SELECT COUNT(*) c FROM decor_placements WHERE user_id=? AND tank=? AND tank_num=?', uid, tank, tnum)).c;
    const maxSlots = C.DECOR_SLOTS[tank] + (tanks[`${tank}_extra`] || 0);
    if (placed >= maxSlots) return res.status(400).json({ ok: false, error: 'no free decor slots' });

    const p = C.clampDecor(tank, x, y);
    const id = await db.tx(async (txDb) => {
      await txDb.run('UPDATE decor_owned SET qty=qty-1 WHERE user_id=? AND deco_id=?', uid, deco_id);
      const info = await txDb.run(
        'INSERT INTO decor_placements (user_id,deco_id,tank,tank_num,x,y) VALUES (?,?,?,?,?,?)',
        uid, deco_id, tank, tnum, p.x, p.y);
      return info.lastInsertRowid;
    });
    res.json({ ok: true, placement: { id, deco_id, tank, tank_num: tnum, x: p.x, y: p.y } });
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

  // collect all: remove every placement in a tank instance back to inventory
  r.post('/decor/collect-all', ah(async (req, res) => {
    const uid = req.user.id;
    const { tank, tank_num } = req.body || {};
    const where = tank_num != null
      ? 'user_id=? AND tank=? AND tank_num=?'
      : 'user_id=? AND tank=?';
    const args = tank_num != null ? [uid, tank, tank_num] : [uid, tank];
    const placed = await db.all(`SELECT deco_id FROM decor_placements WHERE ${where}`, ...args);
    if (!placed.length) return res.json({ ok: true, collected: 0 });
    await db.tx(async (txDb) => {
      await txDb.run(`DELETE FROM decor_placements WHERE ${where}`, ...args);
      for (const p of placed) {
        await txDb.run(`INSERT INTO decor_owned (user_id,deco_id,qty) VALUES (?,?,1)
                    ON CONFLICT(user_id,deco_id) DO UPDATE SET qty=qty+1`, uid, p.deco_id);
      }
    });
    res.json({ ok: true, collected: placed.length });
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

  // ---------- 7-day login rewards ----------
  r.post('/login/claim', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const st = await H.loginState(uid, t);
    if (st.claimed_today) return res.status(400).json({ ok: false, error: 'already claimed' });
    const reward = H.LOGIN_REWARDS[st.day - 1];
    const granted = await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      if (reward.gems) await Ht.addGems(uid, reward.gems);
      if (reward.deco) await txDb.run(`INSERT INTO decor_owned (user_id,deco_id,qty) VALUES (?,?,1)
        ON CONFLICT(user_id,deco_id) DO UPDATE SET qty=qty+1`, uid, reward.deco);
      let fish = null;
      if (reward.fish) fish = await Ht.addFish(uid, reward.fish, { location: 'inventory', origin: 'login' }, t);
      const next = st.day >= 7 ? 1 : st.day + 1;
      await txDb.run(`INSERT INTO login_streak (user_id, streak_day, last_claim_date) VALUES (?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET streak_day=excluded.streak_day, last_claim_date=excluded.last_claim_date`,
        uid, next, st.today);
      return { fish: fish ? H.fishJson(fish, t) : null };
    });
    res.json({ ok: true, day: st.day, reward, fish: granted.fish, login: await H.loginState(uid, t) });
  }));

  // ---------- food / settings / minigame ----------
  r.post('/shop/food/buy', ah(async (req, res) => {
    const uid = req.user.id;
    const qty = Math.floor(Number(req.body && req.body.qty));
    if (!qty || qty <= 0 || qty > 1000) return res.status(400).json({ ok: false, error: 'invalid qty' });
    // kind: 'normal' (default) or 'special' (for bottom fish)
    const special = (req.body && req.body.kind) === 'special';
    if (special && !(C.SPECIAL_FOOD_PACKS || [1, 10]).includes(qty)) {
      return res.status(400).json({ ok: false, error: 'invalid pack' });
    }
    const price = special ? (C.SPECIAL_FOOD_PRICE || 20) : 10;
    const cost = qty * price;
    const w = await H.getWallet(uid);
    if (w.coins < cost) return res.status(400).json({ ok: false, error: 'not enough coins' });
    const wallet = await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      if (special) await txDb.run('UPDATE wallets SET coins=coins-?, food_special=food_special+? WHERE user_id=?', cost, qty, uid);
      else await txDb.run('UPDATE wallets SET coins=coins-?, food=food+? WHERE user_id=?', cost, qty, uid);
      return Ht.getWallet(uid);
    });
    res.json({ ok: true, food: wallet.food, food_special: wallet.food_special || 0 });
  }));

  r.post('/shop/coins/buy', ah(async (req, res) => {
    const uid = req.user.id;
    const pack = C.COIN_PACKS[Number(req.body && req.body.pack)];
    if (!pack) return res.status(400).json({ ok: false, error: 'invalid pack' });
    const w = await H.getWallet(uid);
    if (w.gems < pack.gems) return res.status(400).json({ ok: false, error: 'not enough gems' });
    const wallet = await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      await txDb.run('UPDATE wallets SET gems=gems-?, coins=coins+? WHERE user_id=?', pack.gems, pack.coins, uid);
      return Ht.getWallet(uid);
    });
    res.json({ ok: true, coins: wallet.coins, gems: wallet.gems });
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
    const claimedLevels = (await db.all('SELECT level FROM event_level_rewards WHERE user_id=? AND event_id=? AND run=?', uid, event, run)).map((r) => r.level);
    res.json({ ok: true, score: p ? p.score : 0, level: p ? p.level : 0, moves: p ? p.moves : 0,
               claimed: !!rw, goal: EVENT_GOALS[event],
               runs_claimed: claimed, max_runs: mr, current_run: run,
               rewards: EVENT_LEVEL_REWARDS[event] || [], claimed_levels: claimedLevels });
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
      // Maple gender: first claim is 50/50; later claims are forced to the
      // opposite of what the player already has, so finishing the event
      // twice always yields one male and one female.
      let mapleGender = null;
      if (EVENT_FISH[event] === 'autumn_fish') {
        const have = await txDb.all("SELECT gender FROM fish WHERE user_id=? AND species_id='autumn_fish'", uid);
        const g = new Set(have.map((r) => r.gender));
        if (g.has('male') && !g.has('female')) mapleGender = 'female';
        else if (g.has('female') && !g.has('male')) mapleGender = 'male';
      }
      const fish = await Ht.addFish(uid, EVENT_FISH[event], {
        location: 'inventory', origin: 'event', event_id: event,
        born_at: t - 10 * 86400, // event prize arrives as an adult
        ...(mapleGender ? { gender: mapleGender } : {}),
      }, t);
      return { ok: true, fish_id: fish.id, species_id: EVENT_FISH[event], run, runs_claimed: run, max_runs: mr };
    });
    if (!out.ok) return res.status(400).json(out);
    res.json(out);
  }));

  // Maze event prize: finishing level 3 of "Help the baby DarkLeaf escape"
  // grants the Blackleaf bottom fish, once per user. The prize goes to the
  // inventory as an adult (born 10 days ago) and banks 1 diamond a day like
  // other event fish (event_id set).
  r.post('/event/maze-claim', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const out = await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      const claims = await txDb.all(
        "SELECT run FROM event_rewards WHERE user_id=? AND event_id='maze1' ORDER BY run", uid);
      if (claims.length >= 2) return { ok: false, error: 'already claimed twice' };
      const run = claims.length + 1;
      let gender;
      if (run === 1) {
        gender = Math.random() < 0.5 ? 'male' : 'female';
      } else {
        // second play: guaranteed opposite sex of the first reward
        const first = await txDb.get(
          "SELECT gender FROM fish WHERE user_id=? AND species_id='blackleaf' AND event_id='maze1' ORDER BY id LIMIT 1", uid);
        gender = !first || first.gender === 'male' ? 'female' : 'male';
      }
      await txDb.run('INSERT INTO event_rewards(user_id,event_id,run,claimed_at) VALUES(?,?,?,?)', uid, 'maze1', run, t);
      const fish = await Ht.addFish(uid, 'blackleaf', {
        location: 'inventory', origin: 'event', event_id: 'maze1', gender,
        born_at: t - 10 * 86400, // event prize arrives as an adult
      }, t);
      return { ok: true, fish_id: fish.id, species_id: 'blackleaf', gender, run };
    });
    if (!out.ok) return res.status(400).json(out);
    res.json(out);
  }));

  // Claim a per-level reward. Level is 0-based (0 = level 1). The player must
  // have reached that level in the current run. PK prevents double-claims.
  r.post('/event/level-claim', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { event, level } = req.body || {};
    if (!validEvent(event)) return res.status(400).json({ ok: false, error: 'unknown event' });
    const lv = Math.floor(Number(level));
    const rewards = EVENT_LEVEL_REWARDS[event] || [];
    if (!Number.isFinite(lv) || lv < 0 || lv >= rewards.length)
      return res.status(400).json({ ok: false, error: 'invalid level' });
    const out = await db.tx(async (txDb) => {
      const claimed = await runsClaimed(txDb, uid, event);
      const mr = maxRuns(event);
      if (claimed >= mr) return { ok: false, error: 'event finished' };
      const run = claimed + 1;
      const p = await txDb.get('SELECT level FROM event_progress WHERE user_id=? AND event_id=? AND run=?', uid, event, run);
      const reached = p ? p.level : 0;
      if (reached < lv) return { ok: false, error: 'level not reached yet' };
      const already = await txDb.get('SELECT claimed_at FROM event_level_rewards WHERE user_id=? AND event_id=? AND run=? AND level=?', uid, event, run, lv);
      if (already) return { ok: false, error: 'already claimed' };
      await txDb.run('INSERT INTO event_level_rewards(user_id,event_id,run,level,claimed_at) VALUES(?,?,?,?,?)', uid, event, run, lv, t);
      const rw = rewards[lv];
      if (rw.coins) await txDb.run('UPDATE wallets SET coins=coins+? WHERE user_id=?', rw.coins, uid);
      if (rw.gems) await txDb.run('UPDATE wallets SET gems=gems+? WHERE user_id=?', rw.gems, uid);
      return { ok: true, level: lv, reward: rw };
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

  // ================= FRIENDS =================
  // Row (A,B,'pending') = A requested B. Accepted friendship = rows both ways 'accepted'.
  const friendIsGuest = async (uid) => {
    const u = await db.get('SELECT is_guest FROM users WHERE id=?', uid);
    return !u || !!u.is_guest;
  };

  // list friends + incoming/outgoing requests
  r.get('/friends', ah(async (req, res) => {
    const uid = req.user.id;
    const friends = await db.all(
      `SELECT u.id, u.name FROM friends f JOIN users u ON u.id=f.friend_id
       WHERE f.user_id=? AND f.status='accepted' ORDER BY u.name COLLATE NOCASE`, uid);
    const incoming = await db.all(
      `SELECT u.id, u.name FROM friends f JOIN users u ON u.id=f.user_id
       WHERE f.friend_id=? AND f.status='pending' ORDER BY f.created_at DESC`, uid);
    const outgoing = await db.all(
      `SELECT friend_id AS id FROM friends WHERE user_id=? AND status='pending'`, uid);
    res.json({ ok: true, friends, incoming, outgoing: outgoing.map((o) => o.id) });
  }));

  // search players by username
  r.get('/friends/search', ah(async (req, res) => {
    const uid = req.user.id;
    const q = String(req.query.q || '').trim().slice(0, 24);
    if (q.length < 2) return res.json({ ok: true, users: [] });
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const rows = await db.all(
      `SELECT u.id, u.name,
        (SELECT status FROM friends WHERE user_id=? AND friend_id=u.id) AS my_status,
        (SELECT status FROM friends WHERE user_id=u.id AND friend_id=?) AS their_status
       FROM users u
       WHERE u.id != ? AND COALESCE(u.is_guest,0)=0 AND u.name LIKE ? ESCAPE '\\'
       ORDER BY u.name COLLATE NOCASE LIMIT 10`,
      uid, uid, uid, like);
    res.json({ ok: true, users: rows });
  }));

  // send a friend request
  r.post('/friends/request', ah(async (req, res) => {
    const uid = req.user.id;
    if (await friendIsGuest(uid)) return res.status(403).json({ ok: false, error: 'guest_only' });
    const target = Number(req.body && req.body.user_id);
    if (!target || target === uid) return res.status(400).json({ ok: false, error: 'invalid user' });
    const tu = await db.get('SELECT id FROM users WHERE id=? AND COALESCE(is_guest,0)=0', target);
    if (!tu) return res.status(404).json({ ok: false, error: 'user not found' });
    const existing = await db.get(
      'SELECT status FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)',
      uid, target, target, uid);
    if (existing) return res.status(400).json({
      ok: false, error: existing.status === 'accepted' ? 'already friends' : 'request pending',
    });
    await db.run('INSERT INTO friends (user_id,friend_id,status,created_at) VALUES (?,?,?,?)',
      uid, target, 'pending', now());
    res.json({ ok: true });
  }));

  // accept / decline an incoming request
  r.post('/friends/respond', ah(async (req, res) => {
    const uid = req.user.id;
    const from = Number(req.body && req.body.user_id);
    const accept = !!(req.body && req.body.accept);
    const row = await db.get(
      'SELECT status FROM friends WHERE user_id=? AND friend_id=?', from, uid);
    if (!row || row.status !== 'pending') {
      return res.status(404).json({ ok: false, error: 'no request' });
    }
    if (accept) {
      await db.run('UPDATE friends SET status=? WHERE user_id=? AND friend_id=?',
        'accepted', from, uid);
      await db.run('INSERT OR IGNORE INTO friends (user_id,friend_id,status,created_at) VALUES (?,?,?,?)',
        uid, from, 'accepted', now());
    } else {
      await db.run('DELETE FROM friends WHERE user_id=? AND friend_id=?', from, uid);
    }
    res.json({ ok: true, accepted: accept });
  }));

  // remove a friend (or cancel an outgoing request) — both directions
  r.post('/friends/remove', ah(async (req, res) => {
    const uid = req.user.id;
    const fid = Number(req.body && req.body.user_id);
    if (!fid) return res.status(400).json({ ok: false, error: 'invalid user' });
    await db.run('DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)',
      uid, fid, fid, uid);
    res.json({ ok: true });
  }));

  // ================= PROFILE =================
  const TANK_COLS = ['small','medium','large','xl','nursery','small_extra',
    'medium_extra','large_extra','xl_extra','nursery_extra'];
  const profileStats = async (uid) => {
    const fish = await db.get('SELECT COUNT(*) AS n FROM fish WHERE user_id=?', uid);
    const fr = await db.get(
      `SELECT COUNT(*) AS n FROM friends WHERE user_id=? AND status='accepted'`, uid);
    const tk = await db.get(
      `SELECT ${TANK_COLS.join(',')} FROM user_tanks WHERE user_id=?`, uid);
    let tanks = 0;
    if (tk) for (const c of TANK_COLS) tanks += Number(tk[c]) || 0;
    const coll = await db.all(
      'SELECT species_id, count FROM collection WHERE user_id=? ORDER BY count DESC', uid);
    return { fish: fish.n, friends: fr.n, tanks,
      collection: coll.map((c) => ({ species_id: c.species_id, count: c.count })) };
  };
  const avatarUrl = (v) => {
    if (!v) return null;
    // new: data URL stored in DB; legacy: filename under public/uploads/avatars
    return v.startsWith('data:') ? v : '/uploads/avatars/' + v;
  };

  // my own full profile (includes wallet)
  r.get('/profile', ah(async (req, res) => {
    const uid = req.user.id;
    const p = await db.get(
      `SELECT u.id, u.name, u.created_at, u.avatar, u.avatar_cfg, u.bio, w.level, w.xp, w.coins, w.gems
       FROM users u LEFT JOIN wallets w ON w.user_id=u.id WHERE u.id=?`, uid);
    if (!p) return res.status(404).json({ ok: false, error: 'user not found' });
    const s = await profileStats(uid);
    res.json({ ok: true, profile: {
      id: p.id, name: p.name, level: p.level || 1, xp: p.xp || 0,
      created_at: p.created_at, coins: p.coins || 0, gems: p.gems || 0,
      avatar_url: avatarUrl(p.avatar), avatar: parseAvatarCfg(p.avatar_cfg), bio: p.bio || '',
      hearts: await heartCount(uid),
      ...s, mine: true,
    }});
  }));

  // another player's public profile (no wallet)
  r.get('/profile/:id', ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!id || id === req.user.id) {
      return res.status(400).json({ ok: false, error: 'invalid user' });
    }
    const p = await db.get(
      `SELECT u.id, u.name, u.created_at, u.avatar, u.avatar_cfg, u.bio, w.level
       FROM users u LEFT JOIN wallets w ON w.user_id=u.id
       WHERE u.id=? AND COALESCE(u.is_guest,0)=0`, id);
    if (!p) return res.status(404).json({ ok: false, error: 'user not found' });
    const s = await profileStats(id);
    const rel = await db.get(
      'SELECT status FROM friends WHERE user_id=? AND friend_id=?', req.user.id, id);
    res.json({ ok: true, profile: {
      id: p.id, name: p.name, level: p.level || 1, created_at: p.created_at,
      avatar_url: avatarUrl(p.avatar), avatar: parseAvatarCfg(p.avatar_cfg), bio: p.bio || '',
      hearts: await heartCount(id),
      fish: s.fish, friends: s.friends, collection: s.collection, mine: false,
      relation: rel ? rel.status : null,
    }});
  }));

  // rename myself (2–24 chars)
  r.post('/profile/name', ah(async (req, res) => {
    const uid = req.user.id;
    const name = String((req.body && req.body.name) || '').trim().slice(0, 24);
    if (name.length < 2) return res.status(400).json({ ok: false, error: 'name too short' });
    await db.run('UPDATE users SET name=? WHERE id=?', name, uid);
    res.json({ ok: true, name });
  }));

  // update my bio (max 160 chars, empty clears)
  r.post('/profile/bio', ah(async (req, res) => {
    const uid = req.user.id;
    const bio = String((req.body && req.body.bio) || '').trim().slice(0, 160);
    await db.run('UPDATE users SET bio=? WHERE id=?', bio, uid);
    res.json({ ok: true, bio });
  }));

  // upload my profile photo: data URL (png/jpeg/webp, magic-byte validated).
  // Stored in the DB (not the filesystem) because serverless hosts (Vercel)
  // have a read-only disk. Client downscales to <=256px JPEG before sending.
  const AVATAR_MAX_B64 = 400 * 1024;
  function parseAvatar(dataUrl) {
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String((dataUrl || '')).slice(0, AVATAR_MAX_B64 + 100));
    if (!m || m[2].length > AVATAR_MAX_B64) return null;
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 300 * 1024) return null;
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    const isJpg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf.length > 12 && buf.toString('ascii', 8, 12) === 'WEBP';
    if (!((ext === 'png' && isPng) || (ext === 'jpg' && isJpg) || (ext === 'webp' && isWebp))) return null;
    return { dataUrl: `data:image/${m[1]};base64,${m[2]}` };
  }
  r.post('/profile/avatar', ah(async (req, res) => {
    const uid = req.user.id;
    const parsed = parseAvatar(req.body && req.body.image);
    if (!parsed) return res.status(400).json({ ok: false, error: 'bad image' });
    await db.run('UPDATE users SET avatar=? WHERE id=?', parsed.dataUrl, uid);
    res.json({ ok: true, avatar_url: parsed.dataUrl });
  }));

  // visit snapshot: a player's active tank (fish + decor), shaped for TankView.syncState
  r.get('/profile/:id/tank', ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!id || id === req.user.id) {
      return res.status(400).json({ ok: false, error: 'invalid user' });
    }
    const tu = await db.get('SELECT id FROM users WHERE id=? AND COALESCE(is_guest,0)=0', id);
    if (!tu) return res.status(404).json({ ok: false, error: 'user not found' });
    const t = now();
    const tanks = await H.getTanks(id);
    const tier = (tanks && tanks.active) || 'small';
    const tank_num = (tanks && tanks.active_num) || 1;
    const fish = (await db.all(
      `SELECT * FROM fish WHERE user_id=? AND location='tank' AND tank=? AND (tank_num IS NULL OR tank_num=?) ORDER BY id`,
      id, tier, tank_num)).map((f) => H.fishJson(f, t));
    const placements = await db.all(
      'SELECT id,deco_id,tank,tank_num,x,y FROM decor_placements WHERE user_id=? AND tank=? AND tank_num=?',
      id, tier, tank_num);
    res.json({ ok: true, visit: { tier, tank_num, fish, placements,
      hearts: await heartCount(id),
      liked: !!(await db.get('SELECT 1 FROM tank_hearts WHERE visitor_id=? AND owner_id=?', req.user.id, id)),
      bgfx: ((await db.get('SELECT fx_id FROM bgfx_equipped WHERE user_id=? AND tank=?', id, tier)) || {}).fx_id || null,
    } });
  }));

  // ---------- visit guestbook: hearts + short notes on a player's tanks ----------
  const heartCount = (owner_id) =>
    db.get('SELECT COUNT(*) c FROM tank_hearts WHERE owner_id=?', owner_id).then((r) => r.c || 0);
  r.post('/guestbook/heart', ah(async (req, res) => {
    const uid = req.user.id;
    const owner_id = Number(req.body && req.body.owner_id);
    if (!owner_id || owner_id === uid) return res.status(400).json({ ok: false, error: 'invalid user' });
    const tu = await db.get('SELECT id FROM users WHERE id=? AND COALESCE(is_guest,0)=0', owner_id);
    if (!tu) return res.status(404).json({ ok: false, error: 'user not found' });
    const existing = await db.get('SELECT 1 FROM tank_hearts WHERE visitor_id=? AND owner_id=?', uid, owner_id);
    let liked;
    if (existing) {
      await db.run('DELETE FROM tank_hearts WHERE visitor_id=? AND owner_id=?', uid, owner_id);
      liked = false;
    } else {
      await db.run('INSERT INTO tank_hearts (visitor_id, owner_id, created_at) VALUES (?,?,?)', uid, owner_id, now());
      liked = true;
    }
    res.json({ ok: true, liked, hearts: await heartCount(owner_id) });
  }));
  r.post('/guestbook/note', ah(async (req, res) => {
    const uid = req.user.id;
    const owner_id = Number(req.body && req.body.owner_id);
    const message = String((req.body && req.body.message) || '').trim().slice(0, 80);
    if (!owner_id || owner_id === uid) return res.status(400).json({ ok: false, error: 'invalid user' });
    if (!message) return res.status(400).json({ ok: false, error: 'empty note' });
    const tu = await db.get('SELECT id FROM users WHERE id=? AND COALESCE(is_guest,0)=0', owner_id);
    if (!tu) return res.status(404).json({ ok: false, error: 'user not found' });
    const t = now();
    const recent = await db.get(
      'SELECT COUNT(*) c FROM guestbook WHERE visitor_id=? AND owner_id=? AND created_at>?',
      uid, owner_id, t - 86400);
    if ((recent.c || 0) >= 5) return res.status(429).json({ ok: false, error: 'too many notes' });
    await db.run('INSERT INTO guestbook (owner_id, visitor_id, message, created_at) VALUES (?,?,?,?)',
      owner_id, uid, message, t);
    res.json({ ok: true });
  }));
  r.get('/guestbook', ah(async (req, res) => {
    const uid = req.user.id;
    const notes = await db.all(
      `SELECT g.message, g.created_at, u.id AS visitor_id, u.name, u.avatar, u.avatar_cfg
       FROM guestbook g JOIN users u ON u.id=g.visitor_id
       WHERE g.owner_id=? ORDER BY g.created_at DESC LIMIT 30`, uid);
    res.json({ ok: true, hearts: await heartCount(uid),
      notes: notes.map((n) => ({ visitor_id: n.visitor_id, name: n.name,
        avatar_url: avatarUrl(n.avatar), avatar: parseAvatarCfg(n.avatar_cfg), message: n.message, created_at: n.created_at })) });
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

  // ---------- public chat ----------
  const CHAT_LIMIT = 50, CHAT_MAXLEN = 200, CHAT_COOLDOWN = 3;
  // list recent messages; ?after=<id> returns only newer ones (for polling)
  r.get('/chat', ah(async (req, res) => {
    const after = Number(req.query.after) || 0;
    const msgs = await db.all(
      'SELECT id, user_id, name, text, created_at FROM chat_messages WHERE id>? ORDER BY id DESC LIMIT ?',
      after, CHAT_LIMIT);
    msgs.reverse();
    res.json({ ok: true, messages: msgs });
  }));
  // send a message — short text, cooldown between sends
  r.post('/chat/send', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    let text = String((req.body && req.body.text) || '').trim().replace(/\s+/g, ' ');
    if (!text) return res.status(400).json({ ok: false, error: 'empty message' });
    if (text.length > CHAT_MAXLEN) return res.status(400).json({ ok: false, error: 'message too long' });
    const last = await db.get('SELECT created_at FROM chat_messages WHERE user_id=? ORDER BY id DESC LIMIT 1', uid);
    if (last && t - last.created_at < CHAT_COOLDOWN)
      return res.status(429).json({ ok: false, error: 'slow down' });
    const name = req.user.name || ('Player' + uid);
    const r2 = await db.run('INSERT INTO chat_messages(user_id,name,text,created_at) VALUES(?,?,?,?)',
      uid, name, text, t);
    // keep the table small: drop everything older than the newest 500
    await db.run('DELETE FROM chat_messages WHERE id <= (SELECT MAX(id)-500 FROM chat_messages)');
    res.json({ ok: true, id: Number(r2.lastInsertRowid) });
  }));

  // rewarded ad diamonds (CrazyGames portal): client calls this ONLY after
  // the SDK fires adFinished. Rate-limited to prevent abuse.
  r.post('/shop/diamonds/rewarded', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const last = await db.get(
      "SELECT created_at FROM rewarded_ads WHERE user_id=? ORDER BY id DESC LIMIT 1", uid);
    if (last && t - last.created_at < 180)
      return res.status(429).json({ ok: false, error: 'too soon' });
    await db.run('INSERT INTO rewarded_ads(user_id, created_at) VALUES(?,?)', uid, t);
    await addGems(uid, 10);
    const w = await db.get('SELECT gems FROM wallets WHERE user_id=?', uid);
    res.json({ ok: true, gems: w ? w.gems : 0 });
  }));

  // ---------- house (Casa): isometric room ----------
  // Furniture types sold in the house shop for 400 coins. Aquariums are
  // NOT sold here — they link out to AquaNim with its own prices.
  const HOUSE_FURNITURE = new Set([
    'ocean_shell_bed', 'ocean_shell_armchair', 'ocean_vanity', 'ocean_wardrobe',
    'ocean_ottoman', 'ocean_treasure_chest', 'ocean_shell_sofa', 'ocean_coral_table',
    'ocean_jellyfish_lamp', 'ocean_room_divider', 'ocean_bookshelf', 'ocean_nightstand',
    'ocean_standing_mirror', 'ocean_jellyfish_lamp2', 'ocean_snowglobe_table',
    'wood_bed', 'wood_wardrobe', 'wood_sofa', 'wood_bookshelf', 'wood_armchair',
    'wood_chair', 'wood_ottoman', 'wood_coffee_table', 'wood_bench', 'wood_vanity',
    'wood_dresser', 'wood_divider', 'wood_nightstand', 'table_lamp', 'potted_plant',
    'basket', 'storage_box', 'floor_lamp', 'wood_mirror', 'hanging_plant',
    'wood_wall_shelf', 'oval_rug', 'square_rug', 'flower_rug',
  ]);
  const HOUSE_FURNITURE_PRICE = 400;

  // Extract {tier, num} from a house layout aquarium item. tank_tier/tank_num
  // are set at placement time; older items derive the tier from the art type
  // (cube->nursery, medium art->small, large art->large).
  const houseTankOf = (it) => {
    if (!it || typeof it.type !== 'string') return null;
    let tier = it.tank_tier;
    if (!tier) {
      const m = it.type.match(/^aq_aquarium_(cube|medium|large)_/);
      if (!m) return null;
      tier = m[1] === 'cube' ? 'nursery' : m[1] === 'medium' ? 'small' : 'large';
    }
    if (!['nursery', 'small', 'medium', 'large', 'xl'].includes(tier)) return null;
    const num = Math.min(3, Math.max(1, parseInt(it.tank_num) || 1));
    return { tier, num };
  };
  const houseTanksJson = (tk) => ({
    nursery: (tk && tk.nursery) || 0, small: (tk && tk.small) || 0,
    medium: (tk && tk.medium) || 0, large: (tk && tk.large) || 0,
    xl: (tk && tk.xl) || 0,
  });

  // Load the saved house layout + current coin balance + owned tanks.
  r.get('/house', ah(async (req, res) => {
    const uid = req.user.id;
    const row = await db.get('SELECT layout FROM house_layout WHERE user_id=?', uid);
    const w = await H.getWallet(uid);
    const tk = await H.getTanks(uid);
    const u = await db.get('SELECT avatar_cfg FROM users WHERE id=?', uid);
    let layout = null;
    if (row && row.layout) {
      try { layout = JSON.parse(row.layout); } catch (e) { layout = null; }
    }
    // Fish per tank instance, for the house's delete protection.
    const fishRows = await db.all(
      "SELECT tank, tank_num, COUNT(*) c FROM fish WHERE user_id=? AND location='tank' GROUP BY tank, tank_num", uid);
    const tank_fish = {};
    for (const fr of fishRows) tank_fish[fr.tank + ':' + (fr.tank_num || 1)] = fr.c;
    res.json({ ok: true, user_id: uid, layout, coins: (w && w.coins) || 0, tanks: houseTanksJson(tk), tank_fish, avatar: parseAvatarCfg(u && u.avatar_cfg) });
  }));

  // Read-only visit to another player's house. The response mirrors the
  // fields the house page needs for the OWNER's room (layout, owned tanks
  // and fish per tank instance), plus the owner's username for the banner.
  // `visitor_avatar` is intentionally the REQUESTER's avatar config: the
  // visitor's own chibi is the one that walks around the visited room.
  // `owner_avatar` carries the owner's config (e.g. for their presence peer).
  r.get('/house/visit/:id', ah(async (req, res) => {
    const ownerId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(ownerId) || ownerId <= 0)
      return res.status(404).json({ ok: false, error: 'user not found' });
    const owner = await db.get('SELECT id, name, avatar_cfg FROM users WHERE id=?', ownerId);
    if (!owner) return res.status(404).json({ ok: false, error: 'user not found' });
    const row = await db.get('SELECT layout FROM house_layout WHERE user_id=?', ownerId);
    const tk = await H.getTanks(ownerId);
    const visitor = await db.get('SELECT avatar_cfg FROM users WHERE id=?', req.user.id);
    let layout = null;
    if (row && row.layout) {
      try { layout = JSON.parse(row.layout); } catch (e) { layout = null; }
    }
    const fishRows = await db.all(
      "SELECT tank, tank_num, COUNT(*) c FROM fish WHERE user_id=? AND location='tank' GROUP BY tank, tank_num", ownerId);
    const tank_fish = {};
    for (const fr of fishRows) tank_fish[fr.tank + ':' + (fr.tank_num || 1)] = fr.c;
    res.json({
      ok: true, owner_id: owner.id, username: owner.name || '', layout,
      tanks: houseTanksJson(tk), tank_fish,
      owner_avatar: parseAvatarCfg(owner.avatar_cfg),
      visitor_avatar: parseAvatarCfg(visitor && visitor.avatar_cfg),
      visitor_id: req.user.id,
    });
  }));

  // ---------- house multiplayer presence ----------
  // The API is serverless (no WebSocket server), so presence is DB polling:
  // each client heartbeats its avatar state ~every 1.5s and the heartbeat
  // response carries the OTHER players currently in the same house. A row
  // counts as "here" for PRESENCE_STALE seconds after its last heartbeat;
  // stale rows are filtered at read time (no cron) and leaving the page
  // deletes the row immediately via /house/presence/leave.
  const PRESENCE_STALE = 12; // seconds
  const PRESENCE_MAX_CHAT = 140;
  r.post('/house/presence', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const b = req.body || {};
    const houseId = Number.parseInt(b.house_id, 10);
    if (!Number.isInteger(houseId) || houseId <= 0)
      return res.status(404).json({ ok: false, error: 'user not found' });
    const owner = await db.get('SELECT id FROM users WHERE id=?', houseId);
    if (!owner) return res.status(404).json({ ok: false, error: 'user not found' });
    // Avatar state in the house page's tile space (0..10 room coordinates).
    const clampPos = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
    };
    const x = clampPos(b.x), y = clampPos(b.y);
    const dir = Number(b.dir) < 0 ? -1 : 1;
    const north = b.north ? 1 : 0;
    const state = ['idle', 'walk', 'sit'].includes(b.state) ? b.state : 'idle';
    // Sent chat text rides the heartbeat so peers see the same bubble.
    // The expiry is client-provided but clamped to a short future window
    // so a bad clock can't pin a bubble up forever.
    let chatText = null, chatUntil = null;
    if (typeof b.chat_text === 'string') {
      const ct = b.chat_text.trim().slice(0, PRESENCE_MAX_CHAT);
      const cu = Math.floor(Number(b.chat_until));
      if (ct && Number.isFinite(cu) && cu > t) {
        chatText = ct;
        chatUntil = Math.min(cu, t + 15);
      }
    }
    await db.run(`INSERT INTO house_presence
        (user_id, house_id, x, y, dir, north, state, chat_text, chat_until, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET
          house_id=excluded.house_id, x=excluded.x, y=excluded.y,
          dir=excluded.dir, north=excluded.north, state=excluded.state,
          chat_text=excluded.chat_text, chat_until=excluded.chat_until,
          updated_at=excluded.updated_at`,
      uid, houseId, x, y, dir, north, state, chatText, chatUntil, t);
    const rows = await db.all(
      `SELECT p.user_id, u.name AS username, u.avatar_cfg AS avatar_cfg, p.x, p.y, p.dir,
              p.north, p.state, p.chat_text, p.chat_until
         FROM house_presence p JOIN users u ON u.id = p.user_id
        WHERE p.house_id=? AND p.user_id<>? AND p.updated_at>=?
        ORDER BY p.user_id LIMIT 20`, houseId, uid, t - PRESENCE_STALE);
    const players = rows.map((row) => {
      const chatActive = !!(row.chat_text && row.chat_until && row.chat_until > t);
      return {
        user_id: row.user_id, username: row.username || '', avatar: parseAvatarCfg(row.avatar_cfg),
        x: row.x, y: row.y, dir: row.dir < 0 ? -1 : 1, north: !!row.north,
        state: row.state || 'idle',
        chat_text: chatActive ? row.chat_text : null,
        chat_until: chatActive ? row.chat_until : null,
      };
    });
    res.json({ ok: true, players });
  }));

  // Immediate leave (page hide/close); stale-row filtering covers the rest.
  // Body may be empty (sendBeacon) — that's fine.
  r.post('/house/presence/leave', ah(async (req, res) => {
    await db.run('DELETE FROM house_presence WHERE user_id=?', req.user.id);
    res.json({ ok: true });
  }));

  // Auto-save the house layout (client debounces calls). Validates aquarium
  // placement against owned tanks, and blocks removing a tank that has fish.
  r.post('/house/save', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { layout } = req.body || {};
    if (!layout || typeof layout !== 'object' || !Array.isArray(layout.items))
      return res.status(400).json({ ok: false, error: 'bad layout' });
    const tanks = await H.getTanks(uid);
    // Placed aquarium count per tier must not exceed owned count. Instances
    // are keyed by tier:num so the same tank can't be placed twice.
    const seen = {};
    const perTier = {};
    for (const it of layout.items) {
      const hk = houseTankOf(it);
      if (!hk) continue;
      const key = hk.tier + ':' + hk.num;
      if (seen[key]) return res.status(400).json({ ok: false, error: 'duplicate tank instance' });
      seen[key] = true;
      perTier[hk.tier] = (perTier[hk.tier] || 0) + 1;
      if (perTier[hk.tier] > ((tanks && tanks[hk.tier]) || 0))
        return res.status(400).json({ ok: false, error: 'tank not owned' });
    }
    // Fish protection: a removed aquarium whose tank instance has fish
    // cannot be deleted from the room until the tank is empty.
    const oldRow = await db.get('SELECT layout FROM house_layout WHERE user_id=?', uid);
    if (oldRow && oldRow.layout) {
      let oldItems = [];
      try { oldItems = JSON.parse(oldRow.layout).items || []; } catch (e) { /* ignore */ }
      const newKeys = new Set(Object.keys(seen));
      for (const it of oldItems) {
        const hk = houseTankOf(it);
        if (!hk) continue;
        const key = hk.tier + ':' + hk.num;
        if (!newKeys.has(key)) {
          const c = await H.tankFishCount(uid, hk.tier, hk.num);
          if (c > 0) return res.status(400).json({ ok: false, error: 'tank has fish' });
        }
      }
    }
    const text = JSON.stringify(layout).slice(0, 200000); // 200KB cap
    await db.run(`INSERT INTO house_layout (user_id, layout, updated_at) VALUES (?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET layout=excluded.layout, updated_at=excluded.updated_at`,
      uid, text, t);
    res.json({ ok: true });
  }));

  // Buy a furniture piece for the house: 400 coins, server-authoritative.
  r.post('/house/buy', ah(async (req, res) => {
    const uid = req.user.id;
    const { item_type } = req.body || {};
    if (!HOUSE_FURNITURE.has(item_type))
      return res.status(400).json({ ok: false, error: 'unknown item' });
    const w = await H.getWallet(uid);
    if ((w.coins || 0) < HOUSE_FURNITURE_PRICE)
      return res.status(402).json({ ok: false, error: 'not enough coins' });
    await db.run('UPDATE wallets SET coins=coins-? WHERE user_id=?', HOUSE_FURNITURE_PRICE, uid);
    const w2 = await H.getWallet(uid);
    res.json({ ok: true, coins: w2.coins });
  }));

  // Buy a tank from the house: same prices and progression rules as /tanks/buy.
  // Small can't be bought (it's the free default tank).
  r.post('/house/buy-tank', ah(async (req, res) => {
    const uid = req.user.id;
    const { tier } = req.body || {};
    if (!['nursery', 'medium', 'large', 'xl'].includes(tier))
      return res.status(400).json({ ok: false, error: 'invalid tier' });
    const tanks = await H.getTanks(uid);
    const count = (tanks && tanks[tier]) || 0;
    if (count >= 3) return res.status(400).json({ ok: false, error: 'max 3 per tier' });
    if (tier === 'large' && !tanks.medium) return res.status(400).json({ ok: false, error: 'buy medium first' });
    if (tier === 'xl' && !tanks.large) return res.status(400).json({ ok: false, error: 'buy large first' });
    const price = C.TANK_PRICES[tier];
    const w = await H.getWallet(uid);
    if ((w.coins || 0) < price)
      return res.status(402).json({ ok: false, error: 'not enough coins' });
    await db.tx(async (txDb) => {
      await txDb.run('UPDATE wallets SET coins=coins-? WHERE user_id=?', price, uid);
      await txDb.run(`UPDATE user_tanks SET ${tier}=${tier}+1 WHERE user_id=?`, uid);
    });
    const tanks2 = await H.getTanks(uid);
    const w2 = await H.getWallet(uid);
    res.json({ ok: true, count: count + 1, coins: w2.coins, tanks: houseTanksJson(tanks2) });
  }));

  return r;
};
