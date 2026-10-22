// Chibi avatar system (ported from the Chibi Avatar Studio / Room
// Decorator test version): the canonical avatar config shape, the allowed
// option sets, the default look, and validation.
//
// A config is a flat object:
//   { skin, hairStyle, hairColor, eyes, mouth, blush, topStyle, topColor,
//     bottomStyle, bottomColor, shoeColor, extra, extraColor }
// Colors must come from the fixed palettes below (they are hex strings);
// styles must be one of the listed keys; blush is a boolean.
//
// Storage: users.avatar_cfg holds the config as JSON text. The uploaded
// profile PHOTO lives in users.avatar (a different, older column) — do not
// confuse the two. API responses expose the config under the `avatar` key.

const SKINS = ['#ffe3c9', '#ffd3a8', '#f2b183', '#d98e5f', '#a96a3f', '#7a4a26'];
const HAIR_COLORS = ['#3a2a20', '#6b4226', '#a9743f', '#e8b04b', '#f2e3c6', '#ff8fb3', '#ff6f61', '#7c5cff', '#4fc3e8', '#53c98a', '#c0c6ce'];
const TOP_COLORS = ['#ff6fa5', '#7c5cff', '#4fc3e8', '#53c98a', '#ffb84d', '#ff6f61', '#3a2b45', '#ffffff'];
const BOTTOM_COLORS = ['#5b7fd4', '#3a2b45', '#8a5a3b', '#ff8fb3', '#53c98a', '#e8e3f5', '#ff6f61'];
const SHOE_COLORS = ['#ffffff', '#ff6f61', '#3a2b45', '#ffb84d', '#7c5cff', '#4fc3e8'];
const EXTRA_COLORS = ['#ff8fb3', '#ffb84d', '#7c5cff', '#4fc3e8', '#53c98a', '#3a2b45', '#ffffff'];
const HAIR_STYLES = ['short', 'spiky', 'long', 'twintails', 'bun', 'mohawk', 'bald'];
const EYE_STYLES = ['happy', 'round', 'star', 'sleepy', 'wink'];
const MOUTH_STYLES = ['smile', 'cat', 'open', 'grin', 'o'];
const TOP_STYLES = ['tee', 'hoodie', 'sweater', 'dress', 'tank'];
const BOTTOM_STYLES = ['shorts', 'pants', 'skirt', 'none'];
const EXTRAS = ['none', 'catears', 'starclip', 'cap', 'bow', 'glasses'];

// The test version's default look: pink cat ears + purple hoodie + cat mouth.
const DEFAULT_AVATAR = {
  skin: SKINS[1],
  hairStyle: 'short', hairColor: '#6b4226',
  eyes: 'happy', mouth: 'cat', blush: true,
  topStyle: 'hoodie', topColor: '#7c5cff',
  bottomStyle: 'shorts', bottomColor: '#5b7fd4',
  shoeColor: '#ffffff',
  extra: 'catears', extraColor: '#ff8fb3',
};

const COLOR_FIELDS = {
  skin: SKINS, hairColor: HAIR_COLORS, topColor: TOP_COLORS,
  bottomColor: BOTTOM_COLORS, shoeColor: SHOE_COLORS, extraColor: EXTRA_COLORS,
};
const STYLE_FIELDS = {
  hairStyle: HAIR_STYLES, eyes: EYE_STYLES, mouth: MOUTH_STYLES,
  topStyle: TOP_STYLES, bottomStyle: BOTTOM_STYLES, extra: EXTRAS,
};

const cloneDefault = () => ({ ...DEFAULT_AVATAR });

// Lenient read path: any missing/unknown value falls back per-field to the
// default, so a stored or hand-edited config can never break rendering.
function sanitizeAvatar(input) {
  const out = cloneDefault();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [field, allowed] of Object.entries(COLOR_FIELDS)) {
    if (allowed.includes(input[field])) out[field] = input[field];
  }
  for (const [field, allowed] of Object.entries(STYLE_FIELDS)) {
    if (allowed.includes(input[field])) out[field] = input[field];
  }
  if (typeof input.blush === 'boolean') out.blush = input.blush;
  return out;
}

// Parse a stored users.avatar_cfg value (JSON text or null) into a config.
function parseAvatarCfg(text) {
  if (!text) return cloneDefault();
  try { return sanitizeAvatar(JSON.parse(text)); } catch (e) { return cloneDefault(); }
}

// Strict-ish save path for POST /api/me/avatar: the payload must be a plain
// object, and every KNOWN field it carries must hold an allowed value —
// otherwise the whole save is rejected with 400 (no partial/garbled looks).
// Missing fields fall back to the default; unknown keys are ignored.
function validateAvatarForSave(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false };
  for (const [field, allowed] of Object.entries(COLOR_FIELDS)) {
    if (input[field] !== undefined && !allowed.includes(input[field])) return { ok: false };
  }
  for (const [field, allowed] of Object.entries(STYLE_FIELDS)) {
    if (input[field] !== undefined && !allowed.includes(input[field])) return { ok: false };
  }
  if (input.blush !== undefined && typeof input.blush !== 'boolean') return { ok: false };
  return { ok: true, avatar: sanitizeAvatar(input) };
}

module.exports = {
  SKINS, HAIR_COLORS, TOP_COLORS, BOTTOM_COLORS, SHOE_COLORS, EXTRA_COLORS,
  HAIR_STYLES, EYE_STYLES, MOUTH_STYLES, TOP_STYLES, BOTTOM_STYLES, EXTRAS,
  DEFAULT_AVATAR, sanitizeAvatar, parseAvatarCfg, validateAvatarForSave,
};
