// Static catalog + game constants, mirroring API_CONTRACT.md "Catalog (static...)".
// The frontend must implement these identically.
const fs = require('fs');
const path = require('path');

const GROUPS = {
  goldfish: ['sakura_goldfish', 'azure_tang', 'ember_clownfish', 'lemon_drop_goldfish', 'midnight_moor',
    'twilight_goldfish', 'sunset_goldfish', 'tidepool_goldfish', 'duskfin_goldfish', 'blaze_goldfish',
    'orchid_goldfish', 'cinder_goldfish', 'gilded_goldfish', 'nebula_goldfish', 'ember_night_goldfish'],
  betta: ['autumn_fish', 'fullmoon_betta', 'crowntail_betta', 'veiltail_betta', 'female_betta', 'plakat_betta',
    'maple_rose_betta', 'maple_ember_betta', 'maple_dusk_betta', 'maple_storm_betta',
    'maple_lilac_betta', 'maple_petal_betta', 'maple_tide_betta', 'maple_coral_betta',
    'golden_veil_betta', 'rose_halfmoon_betta', 'ember_crown_betta', 'bloom_maple_betta', 'azure_plakat_betta'],
  shrimp: ['red_shrimp', 'blue_shrimp', 'yellow_shrimp'],
  snail: ['snail'],
  bottom_fish: ['bottom_fish'],
};

// Goldfish hybrid mixes: sorted "speciesA+speciesB" -> blended offspring species.
// Every cross-species goldfish pair has its own mix art (breed-only, not sold in the shop).
const HYBRID_MIXES = {
  'azure_tang+sakura_goldfish': 'twilight_goldfish',
  'lemon_drop_goldfish+sakura_goldfish': 'sunset_goldfish',
  'azure_tang+ember_clownfish': 'tidepool_goldfish',
  'azure_tang+lemon_drop_goldfish': 'duskfin_goldfish',
  'ember_clownfish+sakura_goldfish': 'blaze_goldfish',
  'midnight_moor+sakura_goldfish': 'orchid_goldfish',
  'ember_clownfish+lemon_drop_goldfish': 'cinder_goldfish',
  'lemon_drop_goldfish+midnight_moor': 'gilded_goldfish',
  'azure_tang+midnight_moor': 'nebula_goldfish',
  'ember_clownfish+midnight_moor': 'ember_night_goldfish',
};

// Maple Betta crosses: betta parent species -> the two hybrid offspring (50/50 on hatch).
const MAPLE_CROSSES = {
  fullmoon_betta: ['maple_rose_betta', 'maple_ember_betta'],
  crowntail_betta: ['maple_dusk_betta', 'maple_storm_betta'],
  female_betta: ['maple_lilac_betta', 'maple_petal_betta'],
  plakat_betta: ['maple_tide_betta', 'maple_coral_betta'],
};

// Female Betta crosses: the other betta parent species -> the hybrid offspring.
// (Checked before MAPLE_CROSSES in hatchEgg, so maple x female yields the bloom hybrid.)
const FEMALE_CROSSES = {
  veiltail_betta: 'golden_veil_betta',
  fullmoon_betta: 'rose_halfmoon_betta',
  crowntail_betta: 'ember_crown_betta',
  autumn_fish: 'bloom_maple_betta',
  plakat_betta: 'azure_plakat_betta',
};

const SPECIES_NAMES = {
  sakura_goldfish: 'Sakura Goldfish', azure_tang: 'Azure Tang', ember_clownfish: 'Ember Goldfish',
  lemon_drop_goldfish: 'Lemon Drop Goldfish', midnight_moor: 'Midnight Moor',
  autumn_fish: 'Maple Betta',
  fullmoon_betta: 'Halfmoon Betta', crowntail_betta: 'Crown-tail Betta', veiltail_betta: 'Veil Tail Betta',
  female_betta: 'Female Betta', plakat_betta: 'Plakat Betta',
  maple_rose_betta: 'Rose Maple Betta', maple_ember_betta: 'Ember Maple Betta',
  maple_dusk_betta: 'Dusk Maple Betta', maple_storm_betta: 'Storm Maple Betta',
  maple_lilac_betta: 'Lilac Maple Betta', maple_petal_betta: 'Petal Maple Betta',
  maple_tide_betta: 'Tide Maple Betta', maple_coral_betta: 'Coral Maple Betta',
  golden_veil_betta: 'Golden Veil Betta', rose_halfmoon_betta: 'Rose Halfmoon Betta',
  ember_crown_betta: 'Ember Crown Betta', bloom_maple_betta: 'Bloom Maple Betta',
  azure_plakat_betta: 'Azure Plakat Betta',
  twilight_goldfish: 'Twilight Goldfish', sunset_goldfish: 'Sunset Goldfish',
  tidepool_goldfish: 'Tidepool Goldfish', duskfin_goldfish: 'Duskfin Goldfish',
  blaze_goldfish: 'Blaze Goldfish', orchid_goldfish: 'Orchid Goldfish',
  cinder_goldfish: 'Cinder Goldfish', gilded_goldfish: 'Gilded Goldfish',
  nebula_goldfish: 'Nebula Goldfish', ember_night_goldfish: 'Ember Night Goldfish',
  red_shrimp: 'Red Shrimp', blue_shrimp: 'Blue Shrimp', yellow_shrimp: 'Yellow Shrimp',
  snail: 'Snail', bottom_fish: 'Cory Fish',
};

// price_coins / price_gems(null if not purchasable with gems)
// species with BOTH null are event-exclusive: never sold in the shop.
const SPECIES_PRICES = {
  sakura_goldfish: { coins: 800, gems: null }, azure_tang: { coins: 800, gems: null },
  ember_clownfish: { coins: 800, gems: null }, lemon_drop_goldfish: { coins: 800, gems: null },
  midnight_moor: { coins: 800, gems: null },
  autumn_fish: { coins: null, gems: null },
  red_shrimp: { coins: 200, gems: null }, blue_shrimp: { coins: 200, gems: null },
  yellow_shrimp: { coins: 200, gems: null },
  snail: { coins: 250, gems: null }, bottom_fish: { coins: 3000, gems: null },
  fullmoon_betta: { coins: 1000, gems: null }, crowntail_betta: { coins: 1000, gems: null },
  female_betta: { coins: 1000, gems: null },
  veiltail_betta: { coins: 1400, gems: 8 }, plakat_betta: { coins: 1400, gems: 8 },
  // maple hybrids: bred-only, never sold in the shop
  maple_rose_betta: { coins: null, gems: null }, maple_ember_betta: { coins: null, gems: null },
  maple_dusk_betta: { coins: null, gems: null }, maple_storm_betta: { coins: null, gems: null },
  maple_lilac_betta: { coins: null, gems: null }, maple_petal_betta: { coins: null, gems: null },
  maple_tide_betta: { coins: null, gems: null }, maple_coral_betta: { coins: null, gems: null },
  // female hybrids: bred-only, never sold in the shop
  golden_veil_betta: { coins: null, gems: null }, rose_halfmoon_betta: { coins: null, gems: null },
  ember_crown_betta: { coins: null, gems: null }, bloom_maple_betta: { coins: null, gems: null },
  azure_plakat_betta: { coins: null, gems: null },
  // goldfish hybrids: bred-only, never sold in the shop
  twilight_goldfish: { coins: null, gems: null }, sunset_goldfish: { coins: null, gems: null },
  tidepool_goldfish: { coins: null, gems: null }, duskfin_goldfish: { coins: null, gems: null },
  blaze_goldfish: { coins: null, gems: null }, orchid_goldfish: { coins: null, gems: null },
  cinder_goldfish: { coins: null, gems: null }, gilded_goldfish: { coins: null, gems: null },
  nebula_goldfish: { coins: null, gems: null }, ember_night_goldfish: { coins: null, gems: null },
};

const SPECIES_RARITY = {
  sakura_goldfish: 'rare', azure_tang: 'rare', ember_clownfish: 'rare',
  lemon_drop_goldfish: 'rare', midnight_moor: 'rare',
  autumn_fish: 'legendary',
  fullmoon_betta: 'epic', crowntail_betta: 'epic', veiltail_betta: 'epic',
  female_betta: 'epic', plakat_betta: 'epic',
  maple_rose_betta: 'legendary', maple_ember_betta: 'legendary',
  maple_dusk_betta: 'legendary', maple_storm_betta: 'legendary',
  maple_lilac_betta: 'legendary', maple_petal_betta: 'legendary',
  maple_tide_betta: 'legendary', maple_coral_betta: 'legendary',
  golden_veil_betta: 'legendary', rose_halfmoon_betta: 'legendary',
  ember_crown_betta: 'legendary', bloom_maple_betta: 'legendary',
  azure_plakat_betta: 'legendary',
  twilight_goldfish: 'epic', sunset_goldfish: 'epic', tidepool_goldfish: 'epic',
  duskfin_goldfish: 'epic', blaze_goldfish: 'epic', orchid_goldfish: 'epic',
  cinder_goldfish: 'epic', gilded_goldfish: 'epic', nebula_goldfish: 'epic',
  ember_night_goldfish: 'epic',
  red_shrimp: 'common', blue_shrimp: 'common', yellow_shrimp: 'common',
  snail: 'common', bottom_fish: 'uncommon',
};

function speciesGroup(speciesId) {
  for (const [g, list] of Object.entries(GROUPS)) if (list.includes(speciesId)) return g;
  return null;
}

function fishCatalog() {
  const items = [];
  for (const [group, list] of Object.entries(GROUPS)) {
    for (const species_id of list) {
      const p = SPECIES_PRICES[species_id] || {};
      items.push({
        species_id,
        name: SPECIES_NAMES[species_id] || species_id,
        group,
        rarity: SPECIES_RARITY[species_id] || 'common',
        grow_level: growLevel(species_id),
        price_coins: p.coins,
        price_gems: p.gems,
        desc: `${SPECIES_NAMES[species_id] || species_id} — ${group.replace('_', ' ')}.`,
      });
    }
  }
  return items;
}

// ---- breeding: hatch hours / growth days per stage ----
const HATCH_HOURS = { goldfish: 1, shrimp: 2, betta: 3, snail: 4, bottom_fish: 5 };
const GROWTH_DAYS = { goldfish: 1, betta: 2, bottom_fish: 3, shrimp: 1, snail: 1 };
const HYBRID_HATCH_HOURS = 24;
const HYBRID_GROWTH_DAYS = 3;

// ---- growth: the level at which each critter becomes a grown adult ----
// Small critters grow fast, rare/legendary ones take longer.
const GROW_LEVEL = {
  red_shrimp: 4, blue_shrimp: 4, yellow_shrimp: 4, snail: 4,
  bottom_fish: 5,
  sakura_goldfish: 6, azure_tang: 6, ember_clownfish: 6,
  lemon_drop_goldfish: 6, midnight_moor: 6,
  twilight_goldfish: 7, sunset_goldfish: 7, tidepool_goldfish: 7, duskfin_goldfish: 7,
  blaze_goldfish: 7, orchid_goldfish: 7, cinder_goldfish: 7, gilded_goldfish: 7,
  nebula_goldfish: 7, ember_night_goldfish: 7,
  fullmoon_betta: 7, crowntail_betta: 7, veiltail_betta: 7,
  female_betta: 7, plakat_betta: 7,
  maple_rose_betta: 8, maple_ember_betta: 8, maple_dusk_betta: 8, maple_storm_betta: 8,
  maple_lilac_betta: 8, maple_petal_betta: 8, maple_tide_betta: 8, maple_coral_betta: 8,
  golden_veil_betta: 8, rose_halfmoon_betta: 8, ember_crown_betta: 8,
  bloom_maple_betta: 8, azure_plakat_betta: 8,
  autumn_fish: 10, // Maple Betta — the rarest takes the full journey
};
function growLevel(speciesId) { return GROW_LEVEL[speciesId] || 10; }

// stage is driven by the fish's level vs its own grow level
function growthStage(speciesId, level) {
  const grow = growLevel(speciesId);
  if (level >= grow) return 'adult';
  if (level >= Math.max(2, Math.ceil(grow / 2))) return 'juvenile';
  return 'baby';
}

// ---- fish care: hunger, mood, sickness, levels ----
const HUNGER_FULL_SECS = 6 * 3600;   // hunger stays 100% for 6h after feeding
const HUNGER_EMPTY_SECS = 24 * 3600;  // hunger hits 0% 24h after feeding
const SICK_AFTER_SECS = 36 * 3600;   // fish gets sick 36h after last feeding
const MEDICINE_PRICE = 250;          // coins per medicine
const SPECIAL_FOOD_PRICE = 20;      // coins per special food (bottom fish)
const SPECIAL_FOOD_PACKS = [1, 10];   // only packs sold for bottom food

// ---- coin farming: fish earn coins over time; a finished cycle waits until
// collected, then restarts. stage -> {coins, secs}
const COIN_FARM = {
  baby:     { coins: 50,  secs: 60 * 60 },
  juvenile: { coins: 75,  secs: 60 * 60 },
  adult:    { coins: 100, secs: 60 * 60 },
};
// event fish: 1 diamond per day (banked on its own daily cycle, separate from coins);
// gold farming stays hourly like every other fish (COIN_FARM above)
const EVENT_DIAMOND_DAILY = 1;
const EVENT_DIAMOND_SECS = 24 * 60 * 60;

function hungerPct(fedAt, now) {
  if (!fedAt) return 100;
  const age = now - fedAt;
  if (age <= HUNGER_FULL_SECS) return 100;
  if (age >= HUNGER_EMPTY_SECS) return 0;
  return Math.round(100 * (1 - (age - HUNGER_FULL_SECS) / (HUNGER_EMPTY_SECS - HUNGER_FULL_SECS)));
}

function fishMood(sick, hunger) {
  if (sick) return 'sick';
  if (hunger < 30) return 'hungry';
  return 'happy';
}

// level 1-10 from age: 1-4 baby, 5-9 teen, 10 adult
function fishLevel(grp, hybrid, bornAt, now) {
  const daysPerStage = hybrid ? HYBRID_GROWTH_DAYS : (GROWTH_DAYS[grp] || 1);
  const ageDays = Math.max(0, (now - bornAt) / 86400);
  return 1 + Math.floor(9 * Math.min(1, ageDays / (2 * daysPerStage)));
}

// ---- tanks ----
const TANK_CAPACITY = { small: 12, medium: 22, large: 35 };
const DECOR_SLOTS = { small: 10, medium: 20, large: 30 };
const TANK_PRICES = { medium: 5000, large: 10000 };
// extra decor slots per tank, bought with diamonds (10 each)
const DECOR_EXTRA_SLOT_MAX = { small: 30, medium: 60, large: 100 };
const DECOR_EXTRA_SLOT_COST = 10; // diamonds per extra slot

// Glass bounds (fractions of artwork)
const GLASS = {
  small:  { left: 0.1076, right: 0.8924, top: 0.0951, bottom: 0.8978 },
  medium: { left: 0.0880, right: 0.9156, top: 0.1230, bottom: 0.8959 },
  large:  { left: 0.1378, right: 0.8622, top: 0.2387, bottom: 0.8293 },
};

function clamp01(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Clamp decor center into the glass rect. Server doesn't know each PNG's
// rendered size, so use a 0.03 margin when size is unknown (per contract).
function clampDecor(tank, x, y, halfW = 0.03, halfH = 0.03) {
  const g = GLASS[tank] || GLASS.small;
  return {
    x: clamp01(Number(x) || 0, g.left + halfW, g.right - halfW),
    y: clamp01(Number(y) || 0, g.top + halfH, g.bottom - halfH),
  };
}

function randomPointInGlass(tank, margin = 0.05) {
  const g = GLASS[tank] || GLASS.small;
  const x = g.left + margin + Math.random() * Math.max(0.01, (g.right - g.left) - margin * 2);
  const y = g.top + margin + Math.random() * Math.max(0.01, (g.bottom - g.top) - margin * 2);
  return { x, y };
}

// ---- decor catalog: 93 items from public/assets/furniture/manifest.json ----
// Price = tiered by manifest order: idx 0-30 -> 120, 31-61 -> 300, 62-92 -> 600.
let _decorCache = null;
function decorCatalog() {
  if (_decorCache) return _decorCache;
  const manifestPath = path.resolve(process.cwd(), 'public/assets/furniture/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  _decorCache = manifest.items.map((it, idx) => ({
    id: it.id,
    name: it.name,
    file: `assets/furniture/${it.file}`,
    price: idx <= 30 ? 120 : idx <= 61 ? 300 : 600,
    index: idx,
    event: it.event || null,
  }));
  return _decorCache;
}
function decorItem(decoId) {
  return decorCatalog().find((d) => d.id === decoId) || null;
}

// ---- quests ----
const QUEST_DEFS = [
  { id: 'feed_3',       title: 'Feed your fish 3 times', desc: 'Use the Feed button 3 times.',   period: 'daily',  target: 3, reward_coins: 100, reward_gems: 0 },
  { id: 'wipe_5',       title: 'Wipe 5 dirt spots',      desc: 'Clean 5 dirt spots with the sponge.', period: 'daily',  target: 5, reward_coins: 80,  reward_gems: 0 },
  { id: 'minigame_1',   title: 'Play the minigame',      desc: 'Finish a minigame round.',       period: 'daily',  target: 1, reward_coins: 50,  reward_gems: 0 },
  { id: 'breed_1',      title: 'Breed a pair',           desc: 'Breed any compatible pair once.', period: 'weekly', target: 1, reward_coins: 0,   reward_gems: 5 },
  { id: 'buy_decor_1',  title: 'Buy 1 decoration',       desc: 'Buy any item from the Decoration Shop.', period: 'weekly', target: 1, reward_coins: 200, reward_gems: 0 },
  { id: 'own_8_fish',   title: 'Own 8 fish',             desc: 'Have 8 fish at once.',           period: 'weekly', target: 8, reward_coins: 300, reward_gems: 0 },
];

// Diamond -> coin exchange packs (server-authoritative; bulk bonus grows with size)
const COIN_PACKS = [
  { gems: 10,  coins: 1200  },
  { gems: 25,  coins: 3250  },
  { gems: 50,  coins: 7000  },
  { gems: 100, coins: 15000 },
  { gems: 200, coins: 32000 },
];

function periodKey(period, nowSec) {
  const d = new Date(nowSec * 1000);
  const ymd = d.toISOString().slice(0, 10);
  if (period === 'daily') return ymd;
  // weekly: Monday (UTC) of the current week
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
  return monday.toISOString().slice(0, 10);
}

module.exports = {
  GROUPS, MAPLE_CROSSES, FEMALE_CROSSES, HYBRID_MIXES, SPECIES_NAMES, SPECIES_PRICES, SPECIES_RARITY,
  speciesGroup, fishCatalog,
  HATCH_HOURS, GROWTH_DAYS, HYBRID_HATCH_HOURS, HYBRID_GROWTH_DAYS, growthStage,
  GROW_LEVEL, growLevel,
  HUNGER_FULL_SECS, HUNGER_EMPTY_SECS, SICK_AFTER_SECS, MEDICINE_PRICE, SPECIAL_FOOD_PRICE,
  SPECIAL_FOOD_PACKS,
  hungerPct, fishMood, fishLevel, COIN_FARM, EVENT_DIAMOND_DAILY, EVENT_DIAMOND_SECS,
  TANK_CAPACITY, DECOR_SLOTS, TANK_PRICES, DECOR_EXTRA_SLOT_MAX, DECOR_EXTRA_SLOT_COST,
  GLASS, clampDecor, randomPointInGlass,
  decorCatalog, decorItem,
  QUEST_DEFS, periodKey,
  COIN_PACKS,
};
