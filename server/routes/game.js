// All authenticated /api game routes. Every query is filtered by user_id.
// All DB access is async (libSQL facade).
const { Router } = require('express');
const { ah } = require('../async');
const C = require('../catalog');

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

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
    return {
      id: row.id, species_id: row.species_id, group: row.grp, variant: row.variant,
      name: C.SPECIES_NAMES[row.species_id] || row.species_id,
      nickname: row.nickname || null,
      gender: row.gender, location: row.location, tank: row.tank,
      x: row.x, y: row.y, born_at: row.born_at,
      stage: C.growthStage(row.grp, !!lineage.hybrid, row.born_at, now),
      fed_at: row.fed_at, lineage,
    };
  };

  const addFish = async (uid, speciesId, opts, now) => {
    const grp = C.speciesGroup(speciesId);
    const tank = opts.tank || await activeTank(uid);
    const pos = (opts.x != null) ? { x: opts.x, y: opts.y } : C.randomPointInGlass(tank);
    const gender = opts.gender || (speciesId === 'female_betta' ? 'female' : (Math.random() < 0.5 ? 'male' : 'female'));
    const lineage = opts.lineage || { mother: null, father: null, hybrid: 0, generation: 0 };
    const info = await db.run(
      `INSERT INTO fish (user_id,species_id,grp,variant,gender,location,tank,x,y,born_at,fed_at,lineage)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      uid, speciesId, grp, opts.variant || speciesId, gender,
      opts.location || 'tank', tank, pos.x, pos.y,
      opts.born_at || now, opts.fed_at || now, JSON.stringify(lineage));
    await db.run(`INSERT INTO collection (user_id,species_id,count) VALUES (?,?,1)
                ON CONFLICT(user_id,species_id) DO UPDATE SET count=count+1`, uid, speciesId);
    await questProgressMax(uid, 'own_8_fish', await totalFishCount(uid), now);
    return db.get('SELECT * FROM fish WHERE id=?', info.lastInsertRowid);
  };

  const hatchEgg = async (uid, egg, now) => {
    const hybrid = !!egg.hybrid;
    const variant = egg.variant_a === egg.variant_b
      ? egg.variant_a
      : (Math.random() < 0.5 ? egg.variant_a : egg.variant_b); // cross-variant inherits one parent's look
    const tank = await activeTank(uid);
    const location = await tankFishCount(uid, tank) < C.TANK_CAPACITY[tank] ? 'tank' : 'inventory';
    const fish = await addFish(uid, variant, {
      variant, tank, location, born_at: now,
      lineage: { mother: egg.variant_b, father: egg.variant_a, hybrid: hybrid ? 1 : 0, generation: egg.generation },
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
    const user = await db.get(
      `SELECT u.id,u.name,u.email,w.level,w.xp,w.coins,w.gems,w.food
       FROM users u JOIN wallets w ON w.user_id=u.id WHERE u.id=?`, uid);
    const tanks = await H.getTanks(uid);
    const fish = (await db.all('SELECT * FROM fish WHERE user_id=? ORDER BY id', uid))
      .map((f) => H.fishJson(f, t));
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
        wallets: { coins: user.coins, gems: user.gems, food: user.food, xp: user.xp, level: user.level },
        tanks: {
          owned: ['small', 'medium', 'large'].filter((k) => tanks[k]),
          active: tanks.active,
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
  r.post('/shop/fish', ah(async (req, res) => res.json({ ok: true, items: C.fishCatalog() })));

  r.post('/shop/fish/buy', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { species_id } = req.body || {};
    const item = C.fishCatalog().find((i) => i.species_id === species_id);
    if (!item) return res.status(400).json({ ok: false, error: 'unknown species' });

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

  r.post('/fish/tap', ah(async (req, res) => {
    const uid = req.user.id; const t = now();
    const { fish_id } = req.body || {};
    const fish = await db.get('SELECT id FROM fish WHERE id=? AND user_id=?', fish_id, uid);
    if (!fish) return res.status(404).json({ ok: false, error: 'fish not found' });
    await db.tx(async (txDb) => {
      const Ht = helpers(txDb);
      await txDb.run('UPDATE fish SET fed_at=? WHERE id=? AND user_id=?', t, fish_id, uid);
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

  // ---------- transfer a fish to another owned tank ----------
  r.post('/fish/transfer', ah(async (req, res) => {
    const uid = req.user.id;
    const { fish_id, tier } = req.body || {};
    if (!['small', 'medium', 'large'].includes(tier)) {
      return res.status(400).json({ ok: false, error: 'invalid tank' });
    }
    const fish = await db.get(
      "SELECT id, tank FROM fish WHERE id=? AND user_id=? AND location='tank'", fish_id, uid);
    if (!fish) return res.status(404).json({ ok: false, error: 'fish not found' });
    if (fish.tank === tier) return res.status(400).json({ ok: false, error: 'already in that tank' });
    const tanks = await H.getTanks(uid);
    if (!tanks[tier]) return res.status(400).json({ ok: false, error: 'tank not owned' });
    if (await H.tankFishCount(uid, tier) >= C.TANK_CAPACITY[tier]) {
      return res.status(400).json({ ok: false, error: 'target tank is full' });
    }
    await db.run('UPDATE fish SET tank=?, x=?, y=? WHERE id=? AND user_id=?',
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
        `INSERT INTO eggs (user_id,grp,variant_a,variant_b,hybrid,generation,hatch_at,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        uid, male.grp, male.species_id, female.species_id, hybrid ? 1 : 0,
        generation, t + hatchHours * 3600, t);
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
    if (placed >= C.DECOR_SLOTS[tank]) return res.status(400).json({ ok: false, error: 'no free decor slots' });

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

  return r;
};
