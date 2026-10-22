/* Chibi avatar system — shared by the main game (profiles) and the house
 * (in-room character + editor modal). Ported faithfully from the Chibi
 * Avatar Studio / Room Decorator test version the user approved.
 *
 * A config is a flat object:
 *   { skin, hairStyle, hairColor, eyes, mouth, blush, topStyle, topColor,
 *     bottomStyle, bottomColor, shoeColor, extra, extraColor }
 * The allowed sets and the default look match server/avatar.js exactly.
 * Rendering: the character is built as SVG parts in a 400x400 space;
 * `chibiInner(cfg, back)` is the markup, `makeImages` rasterizes front/back
 * for canvas use, and `portraitHTML` gives a static DOM portrait.
 */
(function (global) {
  'use strict';

  var SKINS = ['#ffe3c9', '#ffd3a8', '#f2b183', '#d98e5f', '#a96a3f', '#7a4a26'];
  var HAIR_COLORS = ['#3a2a20', '#6b4226', '#a9743f', '#e8b04b', '#f2e3c6', '#ff8fb3', '#ff6f61', '#7c5cff', '#4fc3e8', '#53c98a', '#c0c6ce'];
  var TOP_COLORS = ['#ff6fa5', '#7c5cff', '#4fc3e8', '#53c98a', '#ffb84d', '#ff6f61', '#3a2b45', '#ffffff'];
  var BOTTOM_COLORS = ['#5b7fd4', '#3a2b45', '#8a5a3b', '#ff8fb3', '#53c98a', '#e8e3f5', '#ff6f61'];
  var SHOE_COLORS = ['#ffffff', '#ff6f61', '#3a2b45', '#ffb84d', '#7c5cff', '#4fc3e8'];
  var EXTRA_COLORS = ['#ff8fb3', '#ffb84d', '#7c5cff', '#4fc3e8', '#53c98a', '#3a2b45', '#ffffff'];
  var HAIR_STYLES = ['short', 'spiky', 'long', 'twintails', 'bun', 'mohawk', 'bald'];
  var EYE_STYLES = ['happy', 'round', 'star', 'sleepy', 'wink'];
  var MOUTH_STYLES = ['smile', 'cat', 'open', 'grin', 'o'];
  var TOP_STYLES = ['tee', 'hoodie', 'sweater', 'dress', 'tank'];
  var BOTTOM_STYLES = ['shorts', 'pants', 'skirt', 'none'];
  var EXTRAS = ['none', 'catears', 'starclip', 'cap', 'bow', 'glasses'];

  var DEFAULT = {
    skin: SKINS[1],
    hairStyle: 'short', hairColor: '#6b4226',
    eyes: 'happy', mouth: 'cat', blush: true,
    topStyle: 'hoodie', topColor: '#7c5cff',
    bottomStyle: 'shorts', bottomColor: '#5b7fd4',
    shoeColor: '#ffffff',
    extra: 'catears', extraColor: '#ff8fb3'
  };

  var COLOR_FIELDS = {
    skin: SKINS, hairColor: HAIR_COLORS, topColor: TOP_COLORS,
    bottomColor: BOTTOM_COLORS, shoeColor: SHOE_COLORS, extraColor: EXTRA_COLORS
  };
  var STYLE_FIELDS = {
    hairStyle: HAIR_STYLES, eyes: EYE_STYLES, mouth: MOUTH_STYLES,
    topStyle: TOP_STYLES, bottomStyle: BOTTOM_STYLES, extra: EXTRAS
  };

  function cloneDefault() {
    var o = {}, k;
    for (k in DEFAULT) o[k] = DEFAULT[k];
    return o;
  }
  // Lenient: any missing/unknown value falls back per-field to the default.
  function sanitize(input) {
    var out = cloneDefault(), f;
    if (!input || typeof input !== 'object') return out;
    for (f in COLOR_FIELDS) if (COLOR_FIELDS[f].indexOf(input[f]) >= 0) out[f] = input[f];
    for (f in STYLE_FIELDS) if (STYLE_FIELDS[f].indexOf(input[f]) >= 0) out[f] = input[f];
    if (typeof input.blush === 'boolean') out.blush = input.blush;
    return out;
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function randomConfig() {
    return {
      skin: pick(SKINS),
      hairStyle: pick(HAIR_STYLES), hairColor: pick(HAIR_COLORS),
      eyes: pick(EYE_STYLES), mouth: pick(MOUTH_STYLES), blush: Math.random() < .7,
      topStyle: pick(TOP_STYLES), topColor: pick(TOP_COLORS),
      bottomStyle: pick(BOTTOM_STYLES), bottomColor: pick(BOTTOM_COLORS),
      shoeColor: pick(SHOE_COLORS),
      extra: pick(EXTRAS), extraColor: pick(EXTRA_COLORS)
    };
  }

  function shade(hex, amt) {
    var c = hex.replace('#', '');
    var n = parseInt(c, 16), r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return '#' + (b | (g << 8) | (r << 16)).toString(16).padStart(6, '0');
  }

  /* ===== SVG part builders (same geometry as the studio) ===== */
  function hairBackSVG(style, color) {
    if (style === 'long') return '<path d="M134 120 q-14 90 6 150 l26 0 q-8 -70 -4 -140z M266 120 q14 90 -6 150 l-26 0 q8 -70 4 -140z" fill="' + color + '"/>';
    if (style === 'twintails') return '<path d="M140 96 q-34 10 -30 62 q2 30 18 44 q10 -34 16 -66z M260 96 q34 10 30 62 q-2 30 -18 44 q-10 -34 -16 -66z" fill="' + color + '"/>';
    return '';
  }
  function hairFrontSVG(style, color) {
    var s = '';
    switch (style) {
      case 'short':
        s = '<path d="M138 126 q-4 -58 62 -60 q66 2 62 60 q-2 -26 -20 -34 q4 12 -2 18 q-14 -20 -40 -20 q-28 0 -42 20 q-4 -8 -2 -16 q-16 8 -18 32z" fill="' + color + '"/>';
        break;
      case 'spiky':
        s = '<path d="M140 122 l-8 -22 l20 8 l-2 -26 l22 14 l6 -28 l18 20 l14 -24 l12 24 l20 -16 l4 26 l20 -6 l-6 24 q4 16 -2 24 q-6 -30 -58 -32 q-50 2 -58 32 q-4 -10 -2 -22z" fill="' + color + '"/>';
        break;
      case 'long':
        s = '<path d="M136 128 q-6 -62 64 -64 q70 2 64 64 q-4 -30 -24 -38 q2 14 -4 20 q-12 -22 -36 -22 q-26 0 -38 22 q-6 -8 -4 -18 q-18 10 -22 36z" fill="' + color + '"/>';
        break;
      case 'twintails':
        s = '<path d="M138 124 q-2 -56 62 -58 q64 2 62 58 q-4 -26 -22 -34 q2 12 -2 18 q-14 -20 -38 -20 q-26 0 -40 20 q-4 -8 -2 -16 q-16 8 -20 32z" fill="' + color + '"/>'
          + '<circle cx="140" cy="98" r="10" fill="' + color + '"/><circle cx="260" cy="98" r="10" fill="' + color + '"/>';
        break;
      case 'bun':
        s = '<circle cx="200" cy="52" r="20" fill="' + color + '"/>'
          + '<path d="M140 122 q-2 -52 60 -54 q62 2 60 54 q-4 -24 -22 -32 q0 12 -4 16 q-12 -18 -34 -18 q-24 0 -36 18 q-4 -6 -4 -14 q-16 8 -20 30z" fill="' + color + '"/>';
        break;
      case 'mohawk':
        s = '<path d="M188 108 q-6 -44 12 -52 q18 8 12 52 q-12 -8 -24 0z" fill="' + color + '"/>';
        break;
      case 'bald': s = ''; break;
    }
    return s;
  }
  function eyesSVG(style) {
    var L = '', R = '';
    function eye(cx, inner) { return '<g class="eye"><ellipse cx="' + cx + '" cy="132" rx="8" ry="11" fill="#33243d"/>' + inner(cx) + '</g>'; }
    function spark(cx) { return '<circle cx="' + (cx + 3) + '" cy="127" r="3" fill="#fff"/><circle cx="' + (cx - 2) + '" cy="136" r="1.6" fill="#fff"/>'; }
    function star(cx) {
      var p = '', i, a, x, y;
      for (i = 0; i < 10; i++) { a = -Math.PI / 2 + i * Math.PI / 5; var r = (i % 2 === 0) ? 10 : 4.4; x = cx + r * Math.cos(a); y = 132 + r * Math.sin(a); p += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1); }
      return '<path d="' + p + 'Z" fill="#ffb84d" stroke="#e8930c" stroke-width="1.4"/>';
    }
    switch (style) {
      case 'happy':
        L = '<path d="M164 134 q8 -10 16 0" stroke="#33243d" stroke-width="4.5" fill="none" stroke-linecap="round"/>';
        R = '<path d="M220 134 q8 -10 16 0" stroke="#33243d" stroke-width="4.5" fill="none" stroke-linecap="round"/>';
        break;
      case 'round': L = eye(172, spark); R = eye(228, spark); break;
      case 'star': L = star(172); R = star(228); break;
      case 'sleepy':
        L = '<path d="M164 132 q8 7 16 0" stroke="#33243d" stroke-width="4.5" fill="none" stroke-linecap="round"/>';
        R = '<path d="M220 132 q8 7 16 0" stroke="#33243d" stroke-width="4.5" fill="none" stroke-linecap="round"/>';
        break;
      case 'wink':
        L = eye(172, spark);
        R = '<path d="M220 132 q8 6 16 0" stroke="#33243d" stroke-width="4.5" fill="none" stroke-linecap="round"/>';
        break;
    }
    return L + R;
  }
  function mouthSVG(style) {
    switch (style) {
      case 'smile': return '<path d="M190 156 q10 9 20 0" stroke="#33243d" stroke-width="4" fill="none" stroke-linecap="round"/>';
      case 'cat': return '<path d="M186 154 q7 8 14 1 q7 7 14 -1" stroke="#33243d" stroke-width="4" fill="none" stroke-linecap="round"/>';
      case 'open': return '<path d="M188 152 q12 16 24 0 q-2 14 -12 14 q-10 0 -12 -14z" fill="#8a3b4d"/><path d="M193 161 q7 5 14 0 q-2 5 -7 5 q-5 0 -7 -5z" fill="#ff9db1"/>';
      case 'grin': return '<path d="M184 151 q16 13 32 0 l-3 10 q-13 7 -26 0z" fill="#fff" stroke="#33243d" stroke-width="3.4" stroke-linejoin="round"/>';
      case 'o': return '<ellipse cx="200" cy="158" rx="6" ry="8" fill="#8a3b4d"/>';
    }
    return '';
  }
  function topSVG(style, color) {
    var body = '<path d="M158 232 q42 -14 84 0 l8 62 q2 16 -12 16 l-76 0 q-14 0 -12 -16z" fill="' + color + '"/>';
    if (style === 'hoodie') {
      return body
        + '<path d="M176 224 q24 -12 48 0 l-4 14 q-20 -8 -40 0z" fill="' + shade(color, -18) + '"/>'
        + '<rect x="182" y="272" width="36" height="24" rx="8" fill="' + shade(color, -14) + '"/>'
        + '<path d="M188 240 l-4 12 M212 240 l4 12" stroke="' + shade(color, -30) + '" stroke-width="4" stroke-linecap="round"/>';
    }
    if (style === 'sweater') {
      return body
        + '<path d="M160 258 l84 0 M162 278 l80 0" stroke="' + shade(color, -16) + '" stroke-width="5" stroke-linecap="round" opacity=".55"/>'
        + '<path d="M178 226 q22 -10 44 0 l0 10 q-22 -8 -44 0z" fill="' + shade(color, -20) + '"/>';
    }
    if (style === 'dress') {
      return '<path d="M160 230 q40 -13 80 0 l4 22 q26 34 30 62 q1 10 -10 10 l-128 0 q-11 0 -10 -10 q4 -28 30 -62z" fill="' + color + '"/>'
        + '<path d="M186 226 q14 10 28 0 l-3 16 q-11 6 -22 0z" fill="#fff" opacity=".85"/>'
        + '<circle cx="200" cy="262" r="4" fill="#fff" opacity=".7"/><circle cx="182" cy="288" r="4" fill="#fff" opacity=".7"/><circle cx="218" cy="288" r="4" fill="#fff" opacity=".7"/>';
    }
    if (style === 'tank') {
      return '<path d="M170 230 l14 -4 q3 14 16 14 q13 0 16 -14 l14 4 l6 66 q1 14 -12 14 l-48 0 q-13 0 -12 -14z" fill="' + color + '"/>';
    }
    /* tee */
    return body + '<path d="M184 228 q16 9 32 0 l-2 12 q-14 6 -28 0z" fill="#fff" opacity=".8"/>'
      + '<circle cx="200" cy="268" r="11" fill="#fff" opacity=".55"/>';
  }
  function bottomSVG(cfg, style, color) {
    if (style === 'none' || cfg.topStyle === 'dress') return '';
    if (style === 'shorts') return '<path d="M158 302 l84 0 l4 26 q1 8 -8 8 l-24 0 q-8 0 -10 -8 l-4 -12 l-4 12 q-2 8 -10 8 l-24 0 q-9 0 -8 -8z" fill="' + color + '"/>';
    if (style === 'pants') return '<path d="M158 300 l84 0 l3 44 q0 8 -9 8 l-22 0 q-8 0 -9 -8 l-5 -30 l-5 30 q-1 8 -9 8 l-22 0 q-9 0 -9 -8z" fill="' + color + '"/>';
    if (style === 'skirt') return '<path d="M156 300 l88 0 q10 22 12 34 q1 8 -9 8 l-94 0 q-10 0 -9 -8 q2 -12 12 -34z" fill="' + color + '"/><path d="M156 300 l88 0 l2 10 l-92 0z" fill="' + shade(color, -16) + '"/>';
    return '';
  }
  function extraSVG(kind, color) {
    switch (kind) {
      case 'catears':
        return '<path d="M152 84 q-8 -34 8 -44 q16 12 20 34 q-14 8 -28 10z" fill="' + color + '"/>'
          + '<path d="M248 84 q8 -34 -8 -44 q-16 12 -20 34 q14 8 28 10z" fill="' + color + '"/>'
          + '<path d="M157 76 q-3 -18 4 -26 q9 8 12 20 q-8 5 -16 6z" fill="#ffd7e6"/>'
          + '<path d="M243 76 q3 -18 -4 -26 q-9 8 -12 20 q8 5 16 6z" fill="#ffd7e6"/>';
      case 'starclip':
        return '<path d="M238 92 l4.4 9 9.9 1.4 -7.2 7 1.7 9.8 -8.8 -4.6 -8.8 4.6 1.7 -9.8 -7.2 -7 9.9 -1.4z" fill="#ffb84d" stroke="#e8930c" stroke-width="1.6" stroke-linejoin="round"/>';
      case 'cap':
        return '<path d="M142 108 q4 -44 58 -44 q54 0 58 44 l22 4 q6 1 4 7 q-1 5 -8 5 l-152 0 q-7 0 -8 -5 q-2 -6 4 -7z" fill="' + color + '"/>'
          + '<circle cx="200" cy="62" r="7" fill="' + shade(color, -20) + '"/>';
      case 'bow':
        return '<path d="M246 78 q-20 -14 -26 0 q6 14 26 0z M246 78 q20 -14 26 0 q-6 14 -26 0z" fill="' + color + '"/>'
          + '<circle cx="246" cy="78" r="7" fill="' + shade(color, -18) + '"/>';
      case 'glasses':
        return '<g stroke="#33243d" stroke-width="4" fill="rgba(255,255,255,.14)"><circle cx="172" cy="132" r="19"/><circle cx="228" cy="132" r="19"/></g>'
          + '<path d="M191 130 q9 -5 18 0" stroke="#33243d" stroke-width="4" fill="none"/>';
    }
    return '';
  }
  // Full character markup in the studio's 400x400 space. In back view the
  // face is hidden and the head is covered by hair (the back of the head).
  function chibiInner(cfg, back) {
    cfg = sanitize(cfg);
    var s = '';
    s += '<g transform="translate(0,16)">' + hairBackSVG(cfg.hairStyle, cfg.hairColor) + '</g>';
    s += '<rect x="187" y="196" width="26" height="42" rx="11" fill="' + cfg.skin + '"/>';
    s += '<rect x="176" y="308" width="17" height="30" rx="8" fill="' + cfg.skin + '"/>'
      + '<path d="M170 336 q14 -8 26 0 q4 10 -3 13 l-20 0 q-8 -3 -3 -13z" fill="' + cfg.shoeColor + '"/>';
    s += '<rect x="207" y="308" width="17" height="30" rx="8" fill="' + cfg.skin + '"/>'
      + '<path d="M204 336 q12 -8 26 0 q5 10 -3 13 l-20 0 q-7 -3 -3 -13z" fill="' + cfg.shoeColor + '"/>';
    s += '<g>' + bottomSVG(cfg, cfg.bottomStyle, cfg.bottomColor) + '</g>';
    s += '<g>' + topSVG(cfg.topStyle, cfg.topColor) + '</g>';
    var sleeve = cfg.topStyle === 'tank' ? cfg.skin : cfg.topColor;
    s += '<path d="M172 238 q-34 4 -44 30 q-6 16 4 22 q11 6 18 -6 q10 -18 12 -30 q2 -12 10 -16z" fill="' + sleeve + '"/>'
      + '<circle cx="141" cy="293" r="10" fill="' + cfg.skin + '"/>';
    s += '<path d="M228 238 q34 4 44 30 q6 16 -4 22 q-11 6 -18 -6 q-10 -18 -12 -30 q-2 -12 -10 -16z" fill="' + sleeve + '"/>'
      + '<circle cx="259" cy="293" r="10" fill="' + cfg.skin + '"/>';
    s += '<g transform="translate(0,16)">';
    s += '<circle cx="158" cy="128" r="13" fill="' + cfg.skin + '"/>'
      + '<circle cx="242" cy="128" r="13" fill="' + cfg.skin + '"/>'
      + '<circle cx="200" cy="128" r="62" fill="' + cfg.skin + '"/>';
    if (back) {
      if (cfg.hairStyle !== 'bald') s += '<circle cx="200" cy="128" r="63" fill="' + cfg.hairColor + '"/>';
    } else {
      var face = eyesSVG(cfg.eyes) + mouthSVG(cfg.mouth);
      if (cfg.blush) face += '<ellipse cx="152" cy="152" rx="11" ry="6.5" fill="#ff9db1" opacity=".75"/><ellipse cx="248" cy="152" rx="11" ry="6.5" fill="#ff9db1" opacity=".75"/>';
      s += '<g>' + face + '</g>';
      s += '<g>' + hairFrontSVG(cfg.hairStyle, cfg.hairColor) + '</g>';
    }
    if (!(back && cfg.extra === 'glasses')) s += '<g>' + extraSVG(cfg.extra, cfg.extra === 'cap' ? cfg.topColor : cfg.extraColor) + '</g>';
    s += '</g>';
    return s;
  }
  function svgString(cfg, back) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="480" height="480">' + chibiInner(cfg, back) + '</svg>';
  }
  // Rasterize a config (front + back) for canvas drawing. onload fires per
  // image once it is drawable; callers keep the old image meanwhile.
  function makeImages(cfg, onload) {
    var out = { front: null, back: null };
    [['front', false], ['back', true]].forEach(function (pair) {
      var img = new Image();
      img.onload = function () { out[pair[0]] = img; if (onload) onload(); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString(cfg, pair[1]));
    });
    return out;
  }
  // Static DOM portrait (profile headers, guestbook rows): the studio stage
  // crop of the front view. `slice` fills square/circular frames.
  function portraitHTML(cfg, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="95 28 210 334" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Avatar" xmlns="http://www.w3.org/2000/svg">'
      + '<rect x="95" y="28" width="210" height="334" fill="#ffe9f4"/>'
      + '<ellipse cx="200" cy="350" rx="92" ry="13" fill="rgba(60,30,50,.13)"/>'
      + chibiInner(cfg, false) + '</svg>';
  }

  /* ===== Editor (the 🧍 Avatar modal) ===== */
  var GROUPS = {
    pt: { skin: 'Tom de pele', hairStyle: 'Estilo de cabelo', hairColor: 'Cor do cabelo', eyes: 'Olhos', mouth: 'Boca', blush: 'Bochecha', blushOn: 'Com bochecha', blushOff: 'Sem bochecha', topStyle: 'Parte de cima', topColor: 'Cor da parte de cima', bottomStyle: 'Parte de baixo', bottomColor: 'Cor da parte de baixo', shoes: 'Cor dos sapatos', extra: 'Extra da cabeça', extraColor: 'Cor do extra (orelhas, laço, presilha)' },
    en: { skin: 'Skin tone', hairStyle: 'Hair style', hairColor: 'Hair color', eyes: 'Eyes', mouth: 'Mouth', blush: 'Blush', blushOn: 'Blush on', blushOff: 'No blush', topStyle: 'Top style', topColor: 'Top color', bottomStyle: 'Bottom style', bottomColor: 'Bottom color', shoes: 'Shoe color', extra: 'Head extra', extraColor: 'Extra color (ears, bow, clip)' },
    es: { skin: 'Tono de piel', hairStyle: 'Estilo de pelo', hairColor: 'Color de pelo', eyes: 'Ojos', mouth: 'Boca', blush: 'Mejillas', blushOn: 'Con mejillas', blushOff: 'Sin mejillas', topStyle: 'Parte de arriba', topColor: 'Color de arriba', bottomStyle: 'Parte de abajo', bottomColor: 'Color de abajo', shoes: 'Color de zapatos', extra: 'Extra de la cabeza', extraColor: 'Color del extra (orejas, lazo, pinza)' }
  };
  var NAMES = {
    pt: {
      hair: { short: 'Curto', spiky: 'Espetado', long: 'Longo', twintails: 'Maria-chiquinha', bun: 'Coque', mohawk: 'Moicano', bald: 'Careca' },
      eyes: { happy: 'Feliz', round: 'Redondos', star: 'Estrela', sleepy: 'Sonolento', wink: 'Piscando' },
      mouth: { smile: 'Sorriso', cat: 'Boca de gato', open: 'Sorriso aberto', grin: 'Sorrisão', o: 'Surpreso' },
      top: { tee: 'Camiseta', hoodie: 'Moletom', sweater: 'Suéter', dress: 'Vestido', tank: 'Regata' },
      bottom: { shorts: 'Bermuda', pants: 'Calça', skirt: 'Saia', none: 'Nenhum (vestido)' },
      extra: { none: 'Nenhum', catears: 'Orelhas de gato', starclip: 'Presilha estrela', cap: 'Boné', bow: 'Laço', glasses: 'Óculos' }
    },
    en: {
      hair: { short: 'Short', spiky: 'Spiky', long: 'Long', twintails: 'Twin tails', bun: 'Bun', mohawk: 'Mohawk', bald: 'Bald' },
      eyes: { happy: 'Happy', round: 'Round', star: 'Star eyes', sleepy: 'Sleepy', wink: 'Wink' },
      mouth: { smile: 'Smile', cat: 'Cat mouth', open: 'Open smile', grin: 'Big grin', o: 'Surprised' },
      top: { tee: 'T-shirt', hoodie: 'Hoodie', sweater: 'Sweater', dress: 'Dress', tank: 'Tank top' },
      bottom: { shorts: 'Shorts', pants: 'Pants', skirt: 'Skirt', none: 'None (dress)' },
      extra: { none: 'None', catears: 'Cat ears', starclip: 'Star clip', cap: 'Cap', bow: 'Bow', glasses: 'Glasses' }
    },
    es: {
      hair: { short: 'Corto', spiky: 'De punta', long: 'Largo', twintails: 'Dos coletas', bun: 'Moño', mohawk: 'Mohicano', bald: 'Calvo' },
      eyes: { happy: 'Felices', round: 'Redondos', star: 'Estrella', sleepy: 'Dormidos', wink: 'Guiño' },
      mouth: { smile: 'Sonrisa', cat: 'Boca de gato', open: 'Sonrisa abierta', grin: 'Sonrisota', o: 'Sorpresa' },
      top: { tee: 'Camiseta', hoodie: 'Sudadera', sweater: 'Suéter', dress: 'Vestido', tank: 'Camiseta de tirantes' },
      bottom: { shorts: 'Pantalón corto', pants: 'Pantalón', skirt: 'Falda', none: 'Ninguno (vestido)' },
      extra: { none: 'Ninguno', catears: 'Orejas de gato', starclip: 'Pinza estrella', cap: 'Gorra', bow: 'Lazo', glasses: 'Gafas' }
    }
  };
  var TABS = [
    { id: 'body', pt: 'Corpo', en: 'Body', es: 'Cuerpo' },
    { id: 'hair', pt: 'Cabelo', en: 'Hair', es: 'Pelo' },
    { id: 'face', pt: 'Rosto', en: 'Face', es: 'Rostro' },
    { id: 'outfit', pt: 'Roupa', en: 'Outfit', es: 'Ropa' },
    { id: 'extras', pt: 'Extras', en: 'Extras', es: 'Extras' }
  ];

  // createEditor({ stageEl, panelsEl, tabEls, lang, cfg, onChange })
  // tabEls: array of buttons with data-avtab. lang: 'pt'|'en'|'es' or a
  // function returning one. onChange(cfg) fires after every edit.
  function createEditor(opts) {
    var cfg = sanitize(opts.cfg);
    var tab = 'body';
    function lang() {
      var l = typeof opts.lang === 'function' ? opts.lang() : opts.lang;
      return GROUPS[l] ? l : 'en';
    }
    function groupEl(title, children) {
      var g = document.createElement('div'); g.className = 'av-group';
      var h = document.createElement('h4'); h.textContent = title; g.appendChild(h);
      children.forEach(function (ch) { g.appendChild(ch); });
      return g;
    }
    function changed() { render(); if (opts.onChange) opts.onChange(JSON.parse(JSON.stringify(cfg))); }
    function swatchRow(colors, get, set) {
      var row = document.createElement('div'); row.className = 'av-swatches';
      colors.forEach(function (col) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'av-sw'; b.style.background = col;
        b.setAttribute('aria-label', col); b.setAttribute('aria-pressed', get() === col ? 'true' : 'false');
        b.addEventListener('click', function () { set(col); changed(); });
        row.appendChild(b);
      });
      return row;
    }
    function miniHead(inner) { return '<svg viewBox="120 30 160 160">' + inner + '</svg>'; }
    function tileRow(items, names, get, set, drawFn) {
      var row = document.createElement('div'); row.className = 'av-tiles';
      items.forEach(function (it) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'av-tile';
        b.setAttribute('aria-label', names[it] || it); b.title = names[it] || it;
        b.setAttribute('aria-pressed', get() === it ? 'true' : 'false');
        b.innerHTML = drawFn(it);
        b.addEventListener('click', function () { set(it); changed(); });
        row.appendChild(b);
      });
      return row;
    }
    function optRow(items, names, get, set) {
      var row = document.createElement('div'); row.className = 'av-opts';
      items.forEach(function (it) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'av-opt'; b.textContent = names[it] || it;
        b.setAttribute('aria-pressed', get() === it ? 'true' : 'false');
        b.addEventListener('click', function () { set(it); changed(); });
        row.appendChild(b);
      });
      return row;
    }
    function buildPanels() {
      var panels = opts.panelsEl;
      panels.innerHTML = '';
      (opts.tabEls || []).forEach(function (tb) {
        var on = tb.dataset.avtab === tab;
        tb.classList.toggle('active', on); tb.setAttribute('aria-selected', on ? 'true' : 'false');
        var tl = TABS.filter(function (x) { return x.id === tb.dataset.avtab; })[0];
        if (tl) tb.textContent = tl[lang()] || tl.en;
      });
      var G = GROUPS[lang()], N = NAMES[lang()];
      if (tab === 'body') {
        panels.appendChild(groupEl(G.skin, [
          swatchRow(SKINS, function () { return cfg.skin; }, function (v) { cfg.skin = v; })
        ]));
      } else if (tab === 'hair') {
        panels.appendChild(groupEl(G.hairStyle, [
          tileRow(HAIR_STYLES, N.hair, function () { return cfg.hairStyle; }, function (v) { cfg.hairStyle = v; },
            function (st) { return miniHead('<circle cx="200" cy="128" r="62" fill="' + cfg.skin + '"/>' + hairBackSVG(st, cfg.hairColor) + hairFrontSVG(st, cfg.hairColor)); })
        ]));
        panels.appendChild(groupEl(G.hairColor, [
          swatchRow(HAIR_COLORS, function () { return cfg.hairColor; }, function (v) { cfg.hairColor = v; })
        ]));
      } else if (tab === 'face') {
        panels.appendChild(groupEl(G.eyes, [
          tileRow(EYE_STYLES, N.eyes, function () { return cfg.eyes; }, function (v) { cfg.eyes = v; },
            function (st) { return miniHead('<circle cx="200" cy="128" r="62" fill="' + cfg.skin + '"/>' + eyesSVG(st)); })
        ]));
        panels.appendChild(groupEl(G.mouth, [
          tileRow(MOUTH_STYLES, N.mouth, function () { return cfg.mouth; }, function (v) { cfg.mouth = v; },
            function (st) { return '<svg viewBox="160 130 80 50">' + mouthSVG(st) + '</svg>'; })
        ]));
        panels.appendChild(groupEl(G.blush, [
          optRow(['on', 'off'], { on: G.blushOn, off: G.blushOff }, function () { return cfg.blush ? 'on' : 'off'; }, function (v) { cfg.blush = (v === 'on'); })
        ]));
      } else if (tab === 'outfit') {
        panels.appendChild(groupEl(G.topStyle, [
          optRow(TOP_STYLES, N.top, function () { return cfg.topStyle; }, function (v) { cfg.topStyle = v; })
        ]));
        panels.appendChild(groupEl(G.topColor, [
          swatchRow(TOP_COLORS, function () { return cfg.topColor; }, function (v) { cfg.topColor = v; })
        ]));
        panels.appendChild(groupEl(G.bottomStyle, [
          optRow(BOTTOM_STYLES, N.bottom, function () { return cfg.bottomStyle; }, function (v) { cfg.bottomStyle = v; })
        ]));
        panels.appendChild(groupEl(G.bottomColor, [
          swatchRow(BOTTOM_COLORS, function () { return cfg.bottomColor; }, function (v) { cfg.bottomColor = v; })
        ]));
        panels.appendChild(groupEl(G.shoes, [
          swatchRow(SHOE_COLORS, function () { return cfg.shoeColor; }, function (v) { cfg.shoeColor = v; })
        ]));
      } else if (tab === 'extras') {
        panels.appendChild(groupEl(G.extra, [
          tileRow(EXTRAS, N.extra, function () { return cfg.extra; }, function (v) { cfg.extra = v; },
            function (ex) {
              if (ex === 'none') return '<span class="av-none-label">' + N.extra.none + '</span>';
              return miniHead('<circle cx="200" cy="128" r="62" fill="' + cfg.skin + '"/>' + hairFrontSVG(cfg.hairStyle, cfg.hairColor) + extraSVG(ex, ex === 'cap' ? cfg.topColor : cfg.extraColor));
            })
        ]));
        panels.appendChild(groupEl(G.extraColor, [
          swatchRow(EXTRA_COLORS, function () { return cfg.extraColor; }, function (v) { cfg.extraColor = v; })
        ]));
      }
    }
    function render() {
      if (opts.stageEl) {
        opts.stageEl.innerHTML = '<svg viewBox="95 28 210 334" role="img" aria-label="Avatar"><rect x="95" y="28" width="210" height="334" rx="20" fill="#ffe9f4"/><ellipse cx="200" cy="350" rx="92" ry="13" fill="rgba(60,30,50,.13)"/>' + chibiInner(cfg, false) + '</svg>';
      }
      buildPanels();
    }
    (opts.tabEls || []).forEach(function (tb) {
      tb.addEventListener('click', function () { tab = tb.dataset.avtab; buildPanels(); });
    });
    return {
      render: render,
      getConfig: function () { return JSON.parse(JSON.stringify(cfg)); },
      setConfig: function (next) { cfg = sanitize(next); render(); },
      randomize: function () { cfg = randomConfig(); changed(); }
    };
  }

  global.AvatarSystem = {
    SKINS: SKINS, HAIR_COLORS: HAIR_COLORS, TOP_COLORS: TOP_COLORS,
    BOTTOM_COLORS: BOTTOM_COLORS, SHOE_COLORS: SHOE_COLORS, EXTRA_COLORS: EXTRA_COLORS,
    HAIR_STYLES: HAIR_STYLES, EYE_STYLES: EYE_STYLES, MOUTH_STYLES: MOUTH_STYLES,
    TOP_STYLES: TOP_STYLES, BOTTOM_STYLES: BOTTOM_STYLES, EXTRAS: EXTRAS,
    DEFAULT: DEFAULT,
    sanitize: sanitize, randomConfig: randomConfig, shade: shade,
    chibiInner: chibiInner, svgString: svgString, makeImages: makeImages,
    portraitHTML: portraitHTML, createEditor: createEditor,
    GROUPS: GROUPS, NAMES: NAMES, TABS: TABS
  };
})(typeof window !== 'undefined' ? window : this);
