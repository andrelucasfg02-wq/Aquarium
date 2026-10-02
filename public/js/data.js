/* data.js — static catalog, glass bounds, remap math. No DOM here. */
"use strict";

const DATA = {
  TANKS: {
    small:  { file: "assets/tanks/tank_small.jpg",  w: 1125, h: 1125, price: 0,     capacity: 12, decorSlots: 10, fishScale: 1 },
    medium: { file: "assets/tanks/tank_medium.jpg",  w: 1125, h: 634,  price: 5000,  capacity: 22, decorSlots: 20, fishScale: .7 },
    large:  { file: "assets/tanks/tank_large.jpg",   w: 1125, h: 750,  price: 10000, capacity: 35, decorSlots: 30, fishScale: .5 },
  },
  // measured glass rectangles, fractions of artwork (per API_CONTRACT.md §Glass)
  GLASS: {
    small:  { left: .1076, right: .8924, top: .0951, bottom: .8978 },
    medium: { left: .0880, right: .9156, top: .1230, bottom: .8959 },
    large:  { left: .1378, right: .8622, top: .2387, bottom: .8293 },
  },
  // species → {group, name, folder sprite path builder, price fallback, base size in artwork px}
  SPECIES: {
    sakura_goldfish:      { group:"goldfish", name:"Sakura Goldfish",   folder:"pink",   price:800 },
    azure_tang:            { group:"goldfish", name:"Azure Tang",        folder:"blue",   price:800 },
    ember_clownfish:       { group:"goldfish", name:"Ember Goldfish",   folder:"orange", price:800 },
    lemon_drop_goldfish:   { group:"goldfish", name:"Lemon Drop Goldfish",folder:"yellow",price:800 },
    midnight_moor:         { group:"goldfish", name:"Midnight Moor",     folder:"black",  price:800 },
    autumn_fish:            { group:"betta", name:"Maple Betta" },
    fullmoon_betta:        { group:"betta", name:"Halfmoon Betta",  price:1000 },
    crowntail_betta:       { group:"betta", name:"Crown-tail Betta", price:1000 },
    veiltail_betta:        { group:"betta", name:"Veil Tail Betta",  price:1400, priceGems:8 },
    female_betta:          { group:"betta", name:"Female Betta",     price:1000 },
    plakat_betta:          { group:"betta", name:"Plakat Betta",     price:1400, priceGems:8 },
    maple_rose_betta:      { group:"betta", name:"Rose Maple Betta" },
    maple_ember_betta:     { group:"betta", name:"Ember Maple Betta" },
    maple_dusk_betta:      { group:"betta", name:"Dusk Maple Betta" },
    maple_storm_betta:     { group:"betta", name:"Storm Maple Betta" },
    maple_lilac_betta:     { group:"betta", name:"Lilac Maple Betta" },
    maple_petal_betta:     { group:"betta", name:"Petal Maple Betta" },
    maple_tide_betta:      { group:"betta", name:"Tide Maple Betta" },
    maple_coral_betta:     { group:"betta", name:"Coral Maple Betta" },
    golden_veil_betta:     { group:"betta", name:"Golden Veil Betta" },
    rose_halfmoon_betta:   { group:"betta", name:"Rose Halfmoon Betta" },
    ember_crown_betta:     { group:"betta", name:"Ember Crown Betta" },
    bloom_maple_betta:     { group:"betta", name:"Bloom Maple Betta" },
    azure_plakat_betta:    { group:"betta", name:"Azure Plakat Betta" },
    twilight_goldfish:     { group:"goldfish", name:"Twilight Goldfish",    folder:"twilight" },
    sunset_goldfish:       { group:"goldfish", name:"Sunset Goldfish",      folder:"sunset" },
    tidepool_goldfish:     { group:"goldfish", name:"Tidepool Goldfish",    folder:"tidepool" },
    duskfin_goldfish:      { group:"goldfish", name:"Duskfin Goldfish",     folder:"duskfin" },
    blaze_goldfish:        { group:"goldfish", name:"Blaze Goldfish",       folder:"blaze" },
    orchid_goldfish:       { group:"goldfish", name:"Orchid Goldfish",      folder:"orchid" },
    cinder_goldfish:       { group:"goldfish", name:"Cinder Goldfish",      folder:"cinder" },
    gilded_goldfish:       { group:"goldfish", name:"Gilded Goldfish",      folder:"gilded" },
    nebula_goldfish:       { group:"goldfish", name:"Nebula Goldfish",      folder:"nebula" },
    ember_night_goldfish:  { group:"goldfish", name:"Ember Night Goldfish", folder:"ember_night" },
    red_shrimp:            { group:"shrimp", name:"Red Shrimp",   price:200 },
    blue_shrimp:           { group:"shrimp", name:"Blue Shrimp",  price:200 },
    yellow_shrimp:         { group:"shrimp", name:"Yellow Shrimp",price:200 },
    snail:                 { group:"snail",  name:"Snail",        price:250 },
    bottom_fish:           { group:"bottom_fish", name:"Cory Fish", price:3000 },
  },
  GROUP_BASE_PX: { goldfish: 150, betta: 140, shrimp: 85, snail: 95, bottom_fish: 130 },
  GROUP_SPEED:  { goldfish: .055, betta: .05, shrimp: .05, snail: .008, bottom_fish: .035 }, // fractions/sec
  STAGE_SCALE: { baby: .4, juvenile: .7, adult: 1 },
  FOOD_PRICE: 10,
  SPECIAL_FOOD_PRICE: 20,
  MEDICINE_PRICE: 250,
  FILTER_PRICE: 100,
  BREED_GEMS: 2,
  RENAME_GEMS: 3,
  GEM_PACKS: [
    { gems: 50, price: "R$ 4,99" },
    { gems: 100, price: "R$ 8,99" },
    { gems: 300, price: "R$ 24,99" },
    { gems: 600, price: "R$ 44,99" },
    { gems: 1000, price: "R$ 69,99" },
  ],
  COIN_PACKS: [
    { gems: 10,  coins: 1200  },
    { gems: 25,  coins: 3250  },
    { gems: 50,  coins: 7000  },
    { gems: 100, coins: 15000 },
    { gems: 200, coins: 32000 },
  ],
  FOOD_PACKS: [1, 5, 10, 20, 50],
  SPECIAL_FOOD_PACKS: [1, 10],
};

/** Frame roles: 0 idle, 1-4 swim, 5 eat (only while eating), 6 sleep, 7 rear/turn */
// Bump SPRITE_V whenever shipped art changes so phones don't keep stale cached PNGs.
const SPRITE_V = 37;
// Species with a custom hybrid egg icon (assets/eggs/<species_id>.png).
const EGG_V = 3;
const EGG_ART = {
  maple_rose_betta: 1, maple_ember_betta: 1, maple_dusk_betta: 1, maple_storm_betta: 1,
  maple_lilac_betta: 1, maple_petal_betta: 1, maple_tide_betta: 1, maple_coral_betta: 1,
  golden_veil_betta: 1, rose_halfmoon_betta: 1, ember_crown_betta: 1, bloom_maple_betta: 1,
  azure_plakat_betta: 1,
  twilight_goldfish: 1, sunset_goldfish: 1, tidepool_goldfish: 1, duskfin_goldfish: 1,
  blaze_goldfish: 1, orchid_goldfish: 1, cinder_goldfish: 1, gilded_goldfish: 1,
  nebula_goldfish: 1, ember_night_goldfish: 1,
};
function eggIcon(speciesId) {
  return (speciesId && EGG_ART[speciesId]) ? `assets/eggs/${speciesId}.png?v=${EGG_V}` : null;
}
function spriteURL(speciesId, frame, gender) {
  const s = DATA.SPECIES[speciesId];
  if (!s) return "";
  // female Maple Bettas use their own art set
  const sid = (speciesId === "autumn_fish" && gender === "female") ? "autumn_fish_female" : speciesId;
  if (s.folder) return `assets/sprites/${s.folder}/frame${frame}.png?v=${SPRITE_V}`;
  return `assets/new_critters/${sid}_${String(frame + 1).padStart(2, "0")}.png?v=${SPRITE_V}`; // _01.._10 → frames 0..9
}
function speciesName(id) { return (DATA.SPECIES[id] || {}).name || id; }
function speciesGroup(id) { return (DATA.SPECIES[id] || {}).group || "goldfish"; }

/**
 * Cover-style mapping: artwork fills viewport edge-to-edge, no letterboxing.
 * Returns {s, ox, oy} so fraction→css-px is  x = ox + fx*artW*s.
 */
function coverView(cssW, cssH, artW, artH) {
  const s = Math.max(cssW / artW, cssH / artH);
  return { s, ox: (cssW - artW * s) / 2, oy: (cssH - artH * s) / 2 };
}
function fracToPx(fx, fy, view, artW, artH) {
  return [view.ox + fx * artW * view.s, view.oy + fy * artH * view.s];
}
function pxToFrac(px, py, view, artW, artH) {
  return [(px - view.ox) / (artW * view.s), (py - view.oy) / (artH * view.s)];
}

/** Clamp a center fraction using the item's rendered half-size (in artwork px). */
function clampToGlass(fx, fy, halfWPx, halfHPx, tier) {
  const T = DATA.TANKS[tier], g = DATA.GLASS[tier];
  const hw = halfWPx / T.w, hh = halfHPx / T.h;
  return [
    Math.min(Math.max(fx, g.left + hw), g.right - hw),
    Math.min(Math.max(fy, g.top + hh), g.bottom - hh),
  ];
}

function fmtCoins(n) { return Number(n || 0).toLocaleString("en-US"); }
function fmtCountdown(ms) {
  if (ms <= 0) return "hatching…";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}
function esc(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
/* currency icons (inline <img>, usable in any innerHTML template) */
const CUR_GOLD = `<img class="cur-ic" src="assets/icons/icon_gold.png" alt="">`;
const CUR_GEM = `<img class="cur-ic" src="assets/icons/icon_diamond.png" alt="">`;
/* native dialogs (confirm) can't render HTML: turn currency <img> back into text */
function htmlToText(html) {
  return String(html)
    .replace(/<img[^>]*icon_gold\.png[^>]*>/g, "🪙")
    .replace(/<img[^>]*icon_diamond\.png[^>]*>/g, "💎")
    .replace(/<[^>]+>/g, "");
}
