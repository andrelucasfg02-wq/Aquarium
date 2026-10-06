/* tank.js — Canvas tank renderer: cover-mapped artwork, fish AI, decor, dirt,
   pellets, sponge mode, edit mode. 2D sprite art only. */
"use strict";

const _imgCache = {};
function loadImg(url) {
  if (!_imgCache[url]) {
    const im = new Image();
    im.src = url;
    _imgCache[url] = im;
  }
  return _imgCache[url];
}
function imgReady(im) { return im && im.complete && im.naturalWidth > 0; }

/* Goldfish species with 8 swim frames (1-8); eat/sleep/turn live at 9/10/11.
   All other goldfish: swim 1-4, eat 5, sleep 6, turn 7. */
const SWIM8_IDS = new Set(["ember_clownfish", "lemon_drop_goldfish", "sakura_goldfish", "azure_tang", "midnight_moor"]);
/* Danio, Tetra & Gourami: swim with 2 side frames (1-2) alternating.
   (Frames 3-4 are mirrors — the game already flips via e.dir, so using
   them in the cycle causes constant flip-flopping.) */
const TAILBEAT_IDS = new Set(["danio_zebra", "tetra_neon", "gourami_pearl"]);
const TAILBEAT_SEQ = [1, 2];

/* Schooling: tetras and danios swim together in formation when 2+ share
   a tank — side by side and synchronized, then they split up for a while
   and regroup. They also skip the front pose (idle shows a side frame). */
const SCHOOL_IDS = new Set(["tetra_neon", "danio_zebra"]);
const NO_FRONT_IDS = new Set(["tetra_neon", "danio_zebra"]);

class TankView {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.tier = "small";
    this.bg = null;
    this.fish = new Map();      // id -> entity
    this.placements = [];       // {id, deco_id, file, x, y}
    this.decoFiles = {};        // deco_id -> file
    this.spots = [];            // dirt {id,x,y,dying}
    this.green = false;
    this.pellets = [];
    this.emotes = [];
    this.particles = [];
    this.mode = null;           // null | 'sponge' | 'edit'
    this.placeDecoId = null;    // deco_id being placed (tap to place)
    this.sponge = { x: 0, y: 0, down: false };
    this.wipeIds = new Set();
    this.selectedPlacement = null;
    this.dragging = null;
    this.camX = 0; this.camY = 0;   // camera pan (css px) — swipe to look around
    this._panId = null; this._panning = false;
    this._panSX = 0; this._panSY = 0; this._panCX = 0; this._panCY = 0;
    this.userZoom = 1;  // 1 = normal, >1 = zoomed into aquarium (via zoom button)
    this.quality = "high";
    this.handlers = {};
    this.lastT = 0;
    this.ambientT = 0;

    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 200));
    // Android Chrome's URL bar / gesture bar can resize the visual viewport
    // without a window resize event — keep the tap mapping in sync.
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => this.resize());
    }
    this.bindPointer();
    requestAnimationFrame((t) => this.loop(t));
  }

  on(evt, fn) { this.handlers[evt] = fn; }
  emit(evt, data) { const f = this.handlers[evt]; if (f) f(data); }

  setQuality(q) { this.quality = q || "high"; this.resize(); }
  particleMul() { return this.quality === "low" ? .3 : this.quality === "medium" ? .6 : 1; }

  resize() {
    const dprCap = this.quality === "low" ? 1 : this.quality === "medium" ? 1.5 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    // Use the canvas's ACTUAL rendered size (not window.innerWidth/Height):
    // on Android Chrome the URL bar / edge-to-edge gesture bar can make the
    // layout viewport disagree with the element box, which would offset every
    // tap mapping. Fall back to window dims when hidden (rect = 0).
    const r = this.cv.getBoundingClientRect();
    const w = Math.floor(r.width) || Math.floor(window.innerWidth);
    const h = Math.floor(r.height) || Math.floor(window.innerHeight);
    this.cssW = w; this.cssH = h; this.dpr = dpr;
    this.cv.width = Math.floor(w * dpr);
    this.cv.height = Math.floor(h * dpr);
    this.camX = 0; this.camY = 0; // recentre camera on resize / rotation
  }

  setTank(tier) {
    const changed = this.tier !== tier;
    this.tier = tier;
    this.camX = 0; this.camY = 0;
    const T = DATA.TANKS[tier];
    this.bg = loadImg(T.file);
    this.bgBlur = null; // rebuilt lazily once the art loads
    // When switching tiers, fish positions (artwork fractions) may fall
    // outside the new glass — clamp them inside so fish don't render
    // "flying" outside the tank.
    if (changed) {
      const g = DATA.GLASS[tier];
      if (g) {
        const cx = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
        for (const e of this.fish.values()) {
          e.px = cx(e.px, g.left, g.right);
          e.py = cx(e.py, g.top, g.bottom);
          e.tx = cx(e.tx, g.left, g.right);
          e.ty = cx(e.ty, g.top, g.bottom);
        }
      }
    }
  }

  /* Low-res blurred copy of the tank art, used as a full-screen backdrop for
     contain-fit tanks so the letterbox area feels complete instead of empty. */
  ensureBlur() {
    if (this.bgBlur || !imgReady(this.bg)) return;
    const c = document.createElement("canvas");
    c.width = 96; c.height = 84;
    const x = c.getContext("2d");
    x.drawImage(this.bg, 0, 0, c.width, c.height);
    this.bgBlur = c;
  }

  view() {
    const T = DATA.TANKS[this.tier];
    const v = fitView(this.cssW, this.cssH, T.w, T.h, T.fit || "cover");
    // per-tank zoom (e.g. small contain-fit would look too far otherwise)
    if (T.zoom && T.zoom !== 1) {
      const cx = this.cssW / 2, cy = this.cssH / 2;
      v.s *= T.zoom;
      v.ox = cx - (cx - v.ox) * T.zoom;
      v.oy = cy - (cy - v.oy) * T.zoom;
    }
    // user zoom (zoom button): focus on the aquarium for all tiers
    if (this.userZoom !== 1) {
      const cx = this.cssW / 2, cy = this.cssH / 2;
      // tank center in artwork fractions (for each tier)
      const focus = {
        small:  { fx: 0.5, fy: 0.661 },  // tank at (137,851) 850x529 on 1125x1688
        medium: { fx: 0.5, fy: 0.588 },  // tank at (62,635) 1000x715 on 1125x1688
        large:  { fx: 0.5, fy: 0.604 },  // tank at (2,690) 1120x660 on 1125x1688
        xl:     { fx: 0.5, fy: 0.551 },  // tank at (2,510) 1120x840 on 1125x1688
        nursery: { fx: 0.5, fy: 0.617 },  // tank at (162,703) 800x677 on 1125x1688
      };
      const f = focus[this.tier] || { fx: 0.5, fy: 0.5 };
      v.s *= this.userZoom;
      // position so the tank center (fx,fy) lands at screen center
      v.ox = cx - f.fx * T.w * v.s;
      v.oy = cy - f.fy * T.h * v.s;
    }
    v.ox += this.camX; v.oy += this.camY;
    return v;
  }
  /* max pan (css px) that still keeps the artwork covering the screen */
  panLimits() {
    const T = DATA.TANKS[this.tier];
    const v = fitView(this.cssW, this.cssH, T.w, T.h, T.fit || "cover");
    if (T.zoom && T.zoom !== 1) {
      const cx = this.cssW / 2, cy = this.cssH / 2;
      v.s *= T.zoom;
      v.ox = cx - (cx - v.ox) * T.zoom;
      v.oy = cy - (cy - v.oy) * T.zoom;
    }
    // include user zoom (zoom button) so panning works when zoomed in
    if (this.userZoom !== 1) {
      const cx = this.cssW / 2, cy = this.cssH / 2;
      const focus = {
        small:  { fx: 0.5, fy: 0.624 },
        medium: { fx: 0.5, fy: 0.616 },
        large:  { fx: 0.5, fy: 0.643 },
      };
      const f = focus[this.tier] || { fx: 0.5, fy: 0.5 };
      v.s *= this.userZoom;
      v.ox = cx - f.fx * T.w * v.s;
      v.oy = cy - f.fy * T.h * v.s;
    }
    return { x: Math.max(0, -v.ox), y: Math.max(0, -v.oy) };
  }
  setCam(x, y) {
    const L = this.panLimits();
    this.camX = Math.min(L.x, Math.max(-L.x, x));
    this.camY = Math.min(L.y, Math.max(-L.y, y));
  }
  toScreen(fx, fy) {
    const T = DATA.TANKS[this.tier];
    return fracToPx(fx, fy, this.view(), T.w, T.h);
  }
  toFraction(px, py) {
    const T = DATA.TANKS[this.tier];
    return pxToFrac(px, py, this.view(), T.w, T.h);
  }
  glass() { return DATA.GLASS[this.tier]; }

  /* ---------- state sync ---------- */
  syncState(state) {
    if (!state) return;
    this.setTank(state.tanks.active);
    this.activeNum = state.tanks.activeNum || 1;
    // fish
    const seen = new Set();
    for (const f of (state.fish || [])) {
      if (f.tank && f.tank !== state.tanks.active) continue;
      if (f.tank_num && (f.tank_num || 1) !== this.activeNum) continue;
      if (f.location && f.location !== "tank") continue;
      seen.add(f.id);
      let e = this.fish.get(f.id);
      if (!e) {
        e = this.newFish(f);
        this.fish.set(f.id, e);
      } else {
        e.data = f;
      }
    }
    for (const id of [...this.fish.keys()]) if (!seen.has(id)) this.fish.delete(id);
    // decor (decoFiles is static id->file catalog data; never cleared here —
    // it is filled once via setDecoCatalog and must survive state syncs,
    // otherwise decorations turn invisible after any refresh)
    this.placements = (state.placements || [])
      .filter((p) => p.tank === state.tanks.active && (p.tank_num || 1) === this.activeNum)
      .map((p) => ({ ...p }));
    // dirt
    const prevIds = new Set(this.spots.map((s) => s.id));
    this.spots = (state.dirt.spots || []).map((s) => ({ ...s, dying: 0 }));
    this.green = !!state.dirt.green;
    void prevIds;
  }
  setDecoCatalog(items) {
    for (const it of items) this.decoFiles[it.id] = it.file;
  }

  newFish(f) {
    const group = f.group || speciesGroup(f.species_id);
    const g = this.glass();
    // If server position is outside the glass (stale from old tank art), use random inside
    const px = (f.x != null && f.x >= g.left && f.x <= g.right) ? f.x : g.left + Math.random() * (g.right - g.left);
    const py = (f.y != null && f.y >= g.top && f.y <= g.bottom) ? f.y : g.top + Math.random() * (g.bottom - g.top);
    return {
      data: f, group,
      px, py, tx: px, ty: py,
      dir: Math.random() < .5 ? 1 : -1,
      state: "idle", stateT: Math.random() * 3,
      animT: Math.random() * 10,
      frame: 0, faceT: 0, eatT: 0, turnT: 0,
      emoteCd: 0,
      // schooling (tetra/danio): alternate together/apart phases
      schoolMode: "together", schoolT: 8 + Math.random() * 10, schoolFollow: false,
      // cleaning: cory 1 dirt/hour, pleco 4 dirt/hour, blackleaf 1 dirt/3 hours
      cleanCd: f.clean_at ? Math.max(0, (f.species_id === "pleco" ? 900 : f.species_id === "blackleaf" ? 10800 : 3600) - (Date.now() / 1000 - f.clean_at)) : 0,
      cleanT: 0, cleanSpot: null,
    };
  }

  nearestSpot(e) {
    let best = null, bd = 1e9;
    for (const s of this.spots) {
      if (s.dying) continue;
      const d = Math.hypot(s.x - e.px, s.y - e.py);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  pickTarget(e) {
    const g = this.glass();
    const padX = .025, padY = .04;
    if (e.group === "snail") {
      e.tx = g.left + padX + Math.random() * (g.right - g.left - padX * 2);
      e.ty = g.bottom - .012 - Math.random() * .02;
    } else if (e.group === "bottom_fish") {
      e.tx = g.left + padX + Math.random() * (g.right - g.left - padX * 2);
      const band = (g.bottom - g.top) * .22;
      e.ty = g.bottom - .02 - Math.random() * band;
    } else if (e.data && SCHOOL_IDS.has(e.data.species_id)) {
      // schooling fish (tetra/danio) prefer the surface — top 30% of the tank
      e.tx = g.left + padX + Math.random() * (g.right - g.left - padX * 2);
      const surfaceBand = (g.bottom - g.top) * .30;
      e.ty = g.top + padY + Math.random() * surfaceBand;
    } else {
      e.tx = g.left + padX + Math.random() * (g.right - g.left - padX * 2);
      e.ty = g.top + padY + Math.random() * (g.bottom - g.top - padY * 2);
      // keep swimmers off the floor a bit
      e.ty = Math.min(e.ty, g.bottom - .06);
    }
  }

  // Schooling: the first fish of the species in the tank leads; the rest
  // follow in formation. Phases alternate between together and apart.
  schoolLeader(e) {
    let first = null;
    for (const o of this.fish) {
      if (o.data && o.data.species_id === e.data.species_id) {
        if (!first) first = o;
        if (o === e) break; // e comes after first → first is the leader
      }
    }
    // e is the leader itself (or alone) → no one to follow
    if (!first || first === e) return null;
    return (first.state === "swim" || first.state === "idle") ? first : null;
  }

  updateSchool(e, dt) {
    if (!e.data || !SCHOOL_IDS.has(e.data.species_id)) return;
    e.schoolT -= dt;
    if (e.schoolT <= 0) {
      e.schoolMode = e.schoolMode === "together" ? "apart" : "together";
      // together 15-25s, apart 8-15s
      e.schoolT = e.schoolMode === "together" ? 15 + Math.random() * 10 : 8 + Math.random() * 7;
      // when splitting up, pick a fresh independent target
      if (e.schoolMode === "apart" && (e.state === "swim" || e.state === "idle")) {
        this.pickTarget(e);
        if (e.state === "idle") e.state = "swim";
      }
    }
    if (e.schoolMode !== "together") { e.schoolFollow = false; return; }
    if (e.state !== "swim" && e.state !== "idle") { e.schoolFollow = false; return; } // don't interrupt eat/sleep/chase/etc
    const leader = this.schoolLeader(e);
    if (!leader) { e.schoolFollow = false; return; } // I'm the leader (or alone) — swim normally
    e.schoolFollow = true;
    // formation: line up beside/behind the leader, staggered
    const mates = this.fish.filter((o) => o.data && o.data.species_id === e.data.species_id);
    const idx = mates.indexOf(e);
    const slot = Math.ceil(idx / 2);            // 1,1,2,2,3,3...
    const side = (idx % 2 === 0 ? 1 : -1);      // alternate sides
    // behind and to the side of the leader, relative to swim direction
    e.tx = leader.px - leader.dir * slot * .045 + side * .02;
    e.ty = leader.py + side * .025;
    const g = this.glass();
    e.tx = Math.max(g.left + .03, Math.min(g.right - .03, e.tx));
    e.ty = Math.max(g.top + .04, Math.min(g.bottom - .06, e.ty));
    if (e.state === "idle") { e.state = "swim"; e.stateT = 0; }
  }

  /* ---------- per-frame ---------- */
  loop(t) {
    const dt = Math.min(.05, (t - this.lastT) / 1000 || .016);
    this.lastT = t;
    this.update(dt);
    this.draw();
    requestAnimationFrame((tt) => this.loop(tt));
  }

  update(dt) {
    const now = performance.now() / 1000;
    for (const e of this.fish.values()) {
      if (e.cleanCd > 0) e.cleanCd -= dt;
      this.updateFish(e, dt, now);
    }
    // cory cleaning: when a dirt spot shows up, an off-duty cory hurries over
    // and sucks it up (server enforces 1/hour per fish)
    for (const e of this.fish.values()) {
      if (e.group !== "bottom_fish" || e.cleanCd > 0) continue;
      if (e.state !== "idle" && e.state !== "swim" && e.state !== "sleep") continue;
      const spot = this.nearestSpot(e);
      if (spot) {
        e.state = "clean"; e.cleanSpot = spot; e.cleanT = 0;
        e.tx = spot.x; e.ty = spot.y;
      }
    }
    // pellets sink
    for (const p of this.pellets) {
      p.y += p.vy * dt;
      p.age += dt;
      // bottom food lands on the floor and waits for the cory
      if ((p.kind || "normal") === "special") {
        const g = this.glass();
        if (p.y >= g.bottom - .02) { p.y = g.bottom - .02; p.vy = 0; }
      }
      if (p.age > 15) p.gone = true;
    }
    this.pellets = this.pellets.filter((p) => !p.gone);
    // fish chase pellets
    if (this.pellets.length) {
      for (const e of this.fish.values()) {
        if (e.state === "eat" || e.state === "clean" || e.group === "snail") continue;
        // corys only eat green bottom pellets; everyone else eats normal food
        const wantKind = e.group === "bottom_fish" ? "special" : "normal";
        let best = null, bd = 1e9;
        for (const p of this.pellets) {
          if ((p.kind || "normal") !== wantKind) continue;
          const d = Math.hypot(p.x - e.px, p.y - e.py);
          if (d < bd) { bd = d; best = p; }
        }
        if (best && bd < .45) {
          // corys stay on the bottom: only chase pellets already near the floor
          // (they still swim up for dirt spots — see the clean state)
          if (e.group === "bottom_fish") {
            const g = this.glass();
            if (best.y < g.bottom - .1) best = null;
          }
          if (best) { e.state = "chase"; e.chasePellet = best; e.tx = best.x; e.ty = best.y; }
        }
      }
    }
    // emotes / particles
    this.emotes = this.emotes.filter((m) => now - m.t0 < m.dur);
    for (const pt of this.particles) {
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt;
      pt.vy -= pt.buoy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    // ambient bubbles
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = 2 + Math.random() * 4;
      if (Math.random() < this.particleMul()) {
        const g = this.glass();
        const fx = g.left + Math.random() * (g.right - g.left);
        this.spawnBubble(fx, g.bottom - .02, .5);
      }
    }
  }

  updateFish(e, dt, now) {
    const speed = (DATA.GROUP_SPEED[e.group] || .05) * (e.group === "snail" ? 1 : 1);
    e.animT += dt;
    e.emoteCd -= dt;
    if (e.faceT > 0) e.faceT -= dt;
    this.updateSchool(e, dt);
    // sick fish keep emoting 🤒 until treated
    if (e.data && e.data.sick && e.emoteCd <= 0) {
      this.addEmoteImg(e.px, e.py - .03, "assets/icons/emote_sick.png", 2.2); e.emoteCd = 2.4;
    }

    const dx = e.tx - e.px, dy = e.ty - e.py;
    const dist = Math.hypot(dx, dy);
    const wantDir = dx >= 0 ? 1 : -1;

    // Ember, Lemon Drop & Sakura Goldfish have 8 swim frames (1-8); their eat/sleep/turn move to 9/10/11.
    // Every other goldfish keeps swim 1-4, eat 5, sleep 6, turn 7.
    const isSwim8 = e.data && SWIM8_IDS.has(e.data.species_id);
    const swimN = isSwim8 ? 8 : 4;
    const F_EAT = isSwim8 ? 9 : 5;
    const F_SLEEP = isSwim8 ? 10 : 6;
    const F_TURN = isSwim8 ? 11 : 7;
    // danio/tetra/gourami: alternate their 2 side frames; the tail flex below
    // provides the visible wag since the frames are very similar.
    const isTailbeat = e.data && TAILBEAT_IDS.has(e.data.species_id);
    const pickSwim = (rate) => isTailbeat
      ? TAILBEAT_SEQ[Math.floor(e.animT * rate) % TAILBEAT_SEQ.length]
      : 1 + Math.floor(e.animT * rate) % swimN;
    switch (e.state) {
      case "idle":
        // Goldfish, tetras and danios don't use front pose (0) — use swim frame 1 instead
        e.frame = (e.group === "goldfish" || (e.data && NO_FRONT_IDS.has(e.data.species_id))) ? 1 : 0;
        e.stateT -= dt;
        if (e.stateT <= 0) {
          if (Math.random() < .22) {
            // Bedtime: swim to the bottom or a furniture piece, then sleep there
            const g = this.glass();
            let sx, sy;
            if (this.placements.length && Math.random() < .5) {
              const p = this.placements[Math.floor(Math.random() * this.placements.length)];
              sx = p.x + (Math.random() - .5) * .08;
              sy = p.y - .02 - Math.random() * .03;
            } else {
              sx = g.left + Math.random() * (g.right - g.left);
              sy = g.bottom - .015 - Math.random() * .03;
            }
            e.tx = Math.min(g.right, Math.max(g.left, sx));
            e.ty = Math.min(g.bottom - .01, Math.max(g.top, sy));
            e.state = "goto_sleep";
          }
          else { this.pickTarget(e); e.state = "swim"; }
        }
        break;
      case "goto_sleep":
        e.frame = pickSwim(7);
        this.moveToward(e, speed * .8, dt);
        if (Math.hypot(e.tx - e.px, e.ty - e.py) <= .008) {
          e.state = "sleep"; e.stateT = 6 + Math.random() * 8;
        }
        break;
      case "sleep":
        e.frame = F_SLEEP;
        e.stateT -= dt;
        if (e.emoteCd <= 0) { this.addEmote(e.px, e.py - .03, "💤", 2.2); e.emoteCd = 2.4; }
        if (e.stateT <= 0) { this.pickTarget(e); e.state = "swim"; }
        break;
      case "turn":
        // cory curls around (7); bettas have no back pose (2); others show the top (7/11)
        e.frame = e.group === "betta" ? 2 : F_TURN;
        e.turnT -= dt;
        if (e.turnT <= 0) { e.dir = wantDir; e.state = "swim"; }
        break;
      case "chase": {
        const p = e.chasePellet;
        if (!p || p.gone) { e.state = "swim"; this.pickTarget(e); break; }
        e.tx = p.x; e.ty = p.y;
        e.frame = pickSwim(10);
        if (wantDir !== e.dir) { e.dir = wantDir; }
        this.moveToward(e, speed * 2.4, dt);
        if (Math.hypot(p.x - e.px, p.y - e.py) < .028) {
          p.gone = true; e.state = "eat"; e.eatT = .9;
          this.addEmoteImg(e.px, e.py - .035, "assets/icons/emote_love.png", 1.4);
          AudioFX.munch();
        }
        break;
      }
      case "eat":
        if (e.group === "bottom_fish") {
          // the sand-digging pose only when munching at the very bottom
          const g = this.glass();
          e.frame = (e.py >= g.bottom - .035) ? 8 : 5;
        } else e.frame = F_EAT; // munch frame
        e.eatT -= dt;
        if (e.eatT <= 0) { e.state = "idle"; e.stateT = 1 + Math.random() * 2; }
        break;
      case "clean": {
        const s = e.cleanSpot;
        if (!s || s.dying) { e.state = "swim"; this.pickTarget(e); break; }
        e.tx = s.x; e.ty = s.y;
        const cd = Math.hypot(s.x - e.px, s.y - e.py);
        if (cd > .03) {
          e.frame = pickSwim(10); // hurry over
          if (wantDir !== e.dir) e.dir = wantDir;
          this.moveToward(e, speed * 2.2, dt);
        } else {
          e.frame = 9; // sucking the dirt off the glass
          e.cleanT += dt;
          if (e.cleanT > 2.2) {
            s.dying = 1;
            this.popAt(s.x, s.y);
            this.spots = this.spots.filter((o) => !o.dying);
            this.emit("coryCleaned", { spotId: s.id, fishId: e.data.id });
            e.cleanCd = e.data.species_id === "pleco" ? 900 : e.data.species_id === "blackleaf" ? 10800 : 3600;
            e.cleanSpot = null; e.cleanT = 0;
            e.state = "idle"; e.stateT = 1 + Math.random() * 2;
          }
        }
        break;
      }
      case "swim":
      default:
        e.frame = pickSwim(7);
        if (dist > .004 && wantDir !== e.dir) {
          e.state = "turn"; e.turnT = .32;
          e.frame = e.group === "betta" ? 2 : F_TURN;
          break;
        }
        this.moveToward(e, speed, dt);
        if (dist <= .006 && !e.schoolFollow) {
          e.state = "idle"; e.stateT = 2 + Math.random() * 5;
          e.frame = (e.group === "goldfish" || (e.data && NO_FRONT_IDS.has(e.data.species_id))) ? 1 : 0;
        }
        break;
    }
  }

  moveToward(e, speed, dt) {
    const dx = e.tx - e.px, dy = e.ty - e.py;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    const step = Math.min(d, speed * dt);
    e.px += (dx / d) * step;
    e.py += (dy / d) * step;
    if (e.group === "snail") {
      const g = this.glass();
      e.py = Math.min(e.py, g.bottom - .008);
    }
  }

  addEmote(fx, fy, text, dur) {
    this.emotes.push({ fx, fy, text, t0: performance.now() / 1000, dur: dur || 1.5 });
  }
  addEmoteImg(fx, fy, url, dur) {
    this.emotes.push({ fx, fy, img: url, t0: performance.now() / 1000, dur: dur || 1.5 });
  }
  drawRichEmote(ctx, text, x, y, px) {
    // "+50 🪙 +2 💎" -> text runs + currency icon images, drawn centered
    const coinIm = loadImg("assets/icons/icon_gold.png");
    const gemIm = loadImg("assets/icons/icon_diamond.png");
    const parts = String(text).split(/([🪙💎])/gu).filter(Boolean);
    ctx.font = `${px}px serif`;
    const prevAlign = ctx.textAlign; ctx.textAlign = "left";
    const prevBase = ctx.textBaseline; ctx.textBaseline = "middle";
    let total = 0;
    for (const p of parts) {
      total += (p === "🪙" || p === "💎") ? px * 1.15 : ctx.measureText(p).width;
    }
    let cx = x - total / 2;
    for (const p of parts) {
      const im = p === "🪙" ? coinIm : p === "💎" ? gemIm : null;
      if (im) {
        if (imgReady(im)) ctx.drawImage(im, cx, y - px * .575, px * 1.15, px * 1.15);
        cx += px * 1.15;
      } else { ctx.fillText(p, cx, y); cx += ctx.measureText(p).width; }
    }
    ctx.textAlign = prevAlign; ctx.textBaseline = prevBase;
  }
  spawnBubble(fx, fy, scale) {
    this.particles.push({
      kind: "bubble", x: fx, y: fy,
      vx: (Math.random() - .5) * .01, vy: -.06 - Math.random() * .05,
      life: 3 + Math.random() * 2, buoy: 0, r: .006 * (scale || 1),
    });
  }
  popAt(fx, fy) {
    const n = Math.max(3, Math.round(8 * this.particleMul()));
    for (let i = 0; i < n; i++) {
      this.particles.push({
        kind: "pop", x: fx, y: fy,
        vx: (Math.random() - .5) * .12, vy: (Math.random() - .5) * .12,
        life: .5 + Math.random() * .3, buoy: 0, r: .004,
      });
    }
    AudioFX.pop();
  }
  bubbleBurst() {
    const g = this.glass();
    const n = Math.round(60 * this.particleMul());
    for (let i = 0; i < n; i++) {
      this.spawnBubble(
        g.left + Math.random() * (g.right - g.left),
        g.top + Math.random() * (g.bottom - g.top), 1.4);
    }
    for (let i = 0; i < 8; i++) AudioFX.bubble();
  }

  feedBurst(n, kind) {
    const g = this.glass();
    for (let i = 0; i < n; i++) {
      // bottom food sinks fast so corys can eat it on the floor
      const fast = kind === "special";
      this.pellets.push({
        x: g.left + .05 + Math.random() * (g.right - g.left - .1),
        y: g.top + .02 + Math.random() * .1,
        vy: fast ? .07 + Math.random() * .02 : .018 + Math.random() * .012,
        age: 0, gone: false, kind: kind || "normal",
      });
    }
    // wake sleepers — dinner time!
    for (const e of this.fish.values()) {
      if (e.state === "sleep" || e.state === "idle" || e.state === "goto_sleep") { this.pickTarget(e); e.state = "swim"; }
    }
    AudioFX.plop();
  }
}
Object.assign(TankView.prototype, {

  /* ---------- drawing ---------- */
  draw() {
    const { ctx, cssW, cssH } = this;
    const T = DATA.TANKS[this.tier];
    const v = this.view();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // tank artwork: cover fills edge-to-edge; contain shows the whole tank
    // over a blurred full-screen backdrop (no empty black bars)
    if ((T.fit || "cover") === "contain") {
      this.ensureBlur();
      if (this.bgBlur) {
        const bs = Math.max(cssW / this.bgBlur.width, cssH / this.bgBlur.height);
        const bw = this.bgBlur.width * bs, bh = this.bgBlur.height * bs;
        ctx.drawImage(this.bgBlur, (cssW - bw) / 2, (cssH - bh) / 2, bw, bh);
        ctx.fillStyle = "rgba(2,8,16,.62)";
        ctx.fillRect(0, 0, cssW, cssH);
      } else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, cssW, cssH);
      }
    }
    if (imgReady(this.bg)) {
      ctx.drawImage(this.bg, v.ox, v.oy, T.w * v.s, T.h * v.s);
    } else {
      const gr = ctx.createLinearGradient(0, 0, 0, cssH);
      gr.addColorStop(0, "#aee3ff"); gr.addColorStop(1, "#5fb3dd");
      ctx.fillStyle = gr; ctx.fillRect(0, 0, cssW, cssH);
    }

    // green water tint
    if (this.green) {
      ctx.fillStyle = "rgba(46,125,50,.30)";
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.fillStyle = "rgba(30,90,35,.12)";
      ctx.fillRect(0, 0, cssW, cssH);
    }

    // decorations (behind fish)
    for (const p of this.placements) this.drawPlacement(p, v, T);

    // dirt spots
    for (const s of this.spots) {
      if (s.dying) continue;
      const [x, y] = fracToPx(s.x, s.y, v, T.w, T.h);
      const r = Math.max(5, .016 * T.w * v.s);
      ctx.fillStyle = "rgba(101,67,33,.55)";
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.25, r * .8, .4, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(70,45,20,.5)";
      ctx.beginPath(); ctx.ellipse(x - r * .3, y - r * .2, r * .5, r * .32, 0, 0, 7); ctx.fill();
    }

    // pellets
    const greenPelletIm = loadImg("assets/icons/pellet_green.png");
    for (const p of this.pellets) {
      const [x, y] = fracToPx(p.x, p.y, v, T.w, T.h);
      const fade = p.age > 13 ? Math.max(0, 1 - (p.age - 13) / 2) : 1;
      ctx.globalAlpha = fade;
      if ((p.kind || "normal") === "special" && imgReady(greenPelletIm)) {
        const s = Math.max(9, .022 * T.w * v.s);
        ctx.drawImage(greenPelletIm, x - s / 2, y - s / 2, s, s);
      } else {
        ctx.fillStyle = (p.kind || "normal") === "special" ? "#4d8a3f" : "#c98a4b";
        ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, .006 * T.w * v.s), 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // fish
    for (const e of this.fish.values()) this.drawFish(e, v, T);

    // emotes
    const now = performance.now() / 1000;
    ctx.textAlign = "center";
    for (const m of this.emotes) {
      const [x, y] = fracToPx(m.fx, m.fy, v, T.w, T.h);
      const k = (now - m.t0) / m.dur;
      ctx.globalAlpha = 1 - k * k;
      const px = Math.max(14, .028 * T.w * v.s);
      if (m.img) {
        const im = loadImg(m.img);
        if (imgReady(im)) {
          const s = px * 2.6;
          ctx.drawImage(im, x - s / 2, y - k * 26 - s / 2, s, s);
        }
      }
      else if (/[🪙💎]/u.test(m.text)) this.drawRichEmote(ctx, m.text, x, y - k * 26, px);
      else { ctx.font = `${px}px serif`; ctx.fillText(m.text, x, y - k * 26); }
      ctx.globalAlpha = 1;
    }

    // particles
    for (const pt of this.particles) {
      const [x, y] = fracToPx(pt.x, pt.y, v, T.w, T.h);
      const r = Math.max(1.5, pt.r * T.w * v.s);
      if (pt.kind === "bubble") {
        ctx.globalAlpha = Math.min(1, pt.life) * .55;
        ctx.strokeStyle = "#eaf9ff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = Math.min(1, pt.life * 2);
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // sponge cursor
    if (this.mode === "sponge") {
      const sim = loadImg("assets/icons/icon_sponge.png");
      ctx.globalAlpha = .95;
      if (imgReady(sim)) {
        const sw = 46, sh = 46 * sim.naturalHeight / sim.naturalWidth;
        ctx.drawImage(sim, this.sponge.x - sw / 2, this.sponge.y - sh / 2, sw, sh);
      } else {
        ctx.font = "34px serif"; ctx.textAlign = "center";
        ctx.fillText("🧽", this.sponge.x, this.sponge.y + 10);
      }
      ctx.globalAlpha = 1;
      if (this.placeDecoId) { /* not used together */ }
    }

    // place-mode hint crosshair
    if (this.placeDecoId) {
      ctx.font = "15px sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 3;
      const msg = t("tank.place_hint");
      ctx.strokeText(msg, cssW / 2, 86); ctx.fillText(msg, cssW / 2, 86);
    }
  },

  drawFish(e, v, T) {
    const f = e.data;
    const stage = f.stage || "adult";
    let scale = DATA.STAGE_SCALE[stage] || 1;
    if (stage === "adult" && e.group === "goldfish") scale *= 0.85; // adult goldfish run a bit smaller
    const sp = DATA.SPECIES[f.species_id] || {};
    const base0 = (sp.size || DATA.GROUP_BASE_PX[e.group] || 130) * scale * (T.fishScale || 1);
    // Goldfish don't use the front pose (0) — show side swim frame instead when facing
    const frame = (e.faceT > 0 && e.group !== "goldfish") ? 0 : e.frame;
    // betta front (0) renders 20% smaller (female_betta 30% smaller) and sleeping (6) 15% smaller; goldfish sleeping (6) renders 20% smaller;
    // cory eating (5) renders 30% smaller
    let base = base0;
    if (e.group === "betta" && frame === 0) base = base0 * (f.species_id === "female_betta" ? 0.7 : 0.8);
    else if (e.group === "betta" && frame === 6) base = base0 * 0.85;
    else if (e.group === "goldfish" && (frame === 6 || (SWIM8_IDS.has(f.species_id) && frame === 10))) base = base0 * 0.8;
    else if (e.group === "goldfish" && (frame === 11 || (!SWIM8_IDS.has(f.species_id) && frame === 7))) base = base0 * 0.8;
    else if (e.group === "bottom_fish" && (frame === 0 || frame === 5)) base = base0 * 0.7;
    const im = loadImg(spriteURL(f.species_id, frame, f.gender));
    const [x, y] = fracToPx(e.px, e.py, v, T.w, T.h);
    const w = base * v.s;
    const h = imgReady(im) ? w * (im.naturalHeight / im.naturalWidth) : w * .7;

    // soft shadow
    this.ctx.save();
    this.ctx.globalAlpha = .15;
    this.ctx.fillStyle = "#1a3a55";
    this.ctx.beginPath();
    this.ctx.ellipse(x, y + h * .42, w * .34, h * .09, 0, 0, 7);
    this.ctx.fill();
    this.ctx.restore();

    if (!imgReady(im)) return;
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.scale(e.dir, 1);
    if (e.state === "swim" && (f.species_id === "veiltail_betta" || f.species_id === "fullmoon_betta" || f.species_id === "plakat_betta" || f.species_id === "azure_plakat_betta" || f.species_id === "maple_rose_betta" || f.species_id === "maple_coral_betta" || f.species_id === "maple_ember_betta" || f.species_id === "autumn_fish" || f.species_id === "rose_halfmoon_betta" || f.species_id === "maple_veil_betta" || f.species_id === "danio_zebra" || f.species_id === "tetra_neon" || f.species_id === "gourami_pearl")) {
      // tail-beat: a shear anchored at the head, so the tail and fins flex
      // side to side while the head stays steady — reads as natural swimming
      // instead of a rigid sprite sliding around.
      const ph = (e.animT || 0) * 9;
      const flex = 0.11 * Math.sin(ph);
      this.ctx.translate(w / 2, 0);            // head to origin
      this.ctx.transform(1, -flex, 0, 1, 0, 0); // shear: tail swings, head steady
      this.ctx.translate(-w / 2, 0);
      this.ctx.rotate(0.045 * Math.sin(ph - 1.2)); // gentle body roll, phase-lagged
    }
    this.ctx.drawImage(im, -w / 2, -h / 2, w, h);
    this.ctx.restore();

    // persistent coin badge: fish with coins ready keep a badge above them until collected
    // (diamond icon for event fish with diamonds banked, gold coin otherwise)
    if (f.coin_pending > 0) {
      const badgeImg = loadImg(f.gem_pending > 0 ? "assets/icons/icon_diamond.png" : "assets/icons/icon_gold.png");
      const bob = Math.sin((e.animT || 0) * 3) * 4;
      const cs = Math.max(16, .032 * T.w * v.s);
      const ctx2 = this.ctx;
      const by = y - h / 2 - cs * .7 + bob;
      ctx2.save();
      // soft golden halo so it pops against any background
      ctx2.globalAlpha = .35 + .15 * Math.sin((e.animT || 0) * 3);
      ctx2.fillStyle = "#ffd75e";
      ctx2.beginPath();
      ctx2.arc(x, by, cs * .62, 0, 7);
      ctx2.fill();
      ctx2.globalAlpha = 1;
      if (imgReady(badgeImg)) ctx2.drawImage(badgeImg, x - cs * .55, by - cs * .55, cs * 1.1, cs * 1.1);
      ctx2.restore();
    }

    // edit-selection ring never applies to fish
  },

  drawPlacement(p, v, T) {
    const file = this.decoFiles[p.deco_id];
    if (!file) return;
    const im = loadImg(file);
    if (!imgReady(im)) return;
    const [x, y] = fracToPx(p.x, p.y, v, T.w, T.h);
    const w = im.naturalWidth * v.s, h = im.naturalHeight * v.s;
    if (this.selectedPlacement && this.selectedPlacement.id === p.id) {
      this.ctx.save();
      this.ctx.strokeStyle = "#ff8fb5"; this.ctx.lineWidth = 3;
      this.ctx.setLineDash([8, 6]);
      this.ctx.strokeRect(x - w / 2 - 6, y - h / 2 - 6, w + 12, h + 12);
      this.ctx.restore();
    }
    this.ctx.drawImage(im, x - w / 2, y - h / 2, w, h);
    p._rw = w; p._rh = h; // cache rendered size for hit-testing
  },

  /* ---------- pointer ---------- */
  bindPointer() {
    const el = this.cv;
    const pos = (ev) => {
      const r = el.getBoundingClientRect();
      // Self-heal: if the element's rendered size drifted meaningfully from the
      // cached cssW/cssH (Android Chrome URL bar / gesture bar can resize the
      // visual viewport without firing reliable resize events), sync the cached
      // dims WITHOUT resetting the camera, so tap mapping stays accurate.
      // Threshold of 3px avoids jitter from subpixel rounding; backing store is
      // left alone (next real resize() fixes it) to avoid canvas clears/flicker.
      const w = Math.floor(r.width), h = Math.floor(r.height);
      if (w && Math.abs(w - this.cssW) > 3) this.cssW = w;
      if (h && Math.abs(h - this.cssH) > 3) this.cssH = h;
      return [ev.clientX - r.left, ev.clientY - r.top];
    };
    let downAt = 0, downPos = null, moved = false;

    el.addEventListener("pointerdown", (ev) => {
      AudioFX.unlock();
      if (ev.isPrimary === false) return; // ignore second finger
      const [x, y] = pos(ev);
      downAt = performance.now(); downPos = [x, y]; moved = false;
      // camera pan: press-and-drag in normal mode (not sponge/edit/placing)
      this._panId = ev.pointerId;
      this._panSX = x; this._panSY = y;
      this._panCX = this.camX; this._panCY = this.camY;
      this._panning = !this.mode && !this.placeDecoId;
      if (this.mode === "sponge") {
        this.sponge.x = x; this.sponge.y = y; this.sponge.down = true;
        this.wipeCheck(x, y);
      } else if (this.mode === "edit") {
        const hit = this.hitPlacement(x, y);
        this.selectedPlacement = hit || null;
        if (hit) { this.dragging = hit; this.emit("decoSelect", hit); }
        else this.emit("decoSelect", null);
      }
      el.setPointerCapture(ev.pointerId);
    });

    el.addEventListener("pointermove", (ev) => {
      const [x, y] = pos(ev);
      if (downPos && Math.hypot(x - downPos[0], y - downPos[1]) > 8) moved = true;
      if (this._panning && ev.pointerId === this._panId) {
        this.setCam(this._panCX + (x - this._panSX), this._panCY + (y - this._panSY));
      }
      if (this.mode === "sponge") {
        this.sponge.x = x; this.sponge.y = y;
        if (this.sponge.down) this.wipeCheck(x, y);
      } else if (this.mode === "edit" && this.dragging) {
        const T = DATA.TANKS[this.tier];
        let [fx, fy] = this.toFraction(x, y);
        const im = loadImg(this.decoFiles[this.dragging.deco_id] || "");
        const hw = imgReady(im) ? im.naturalWidth / 2 : 40;
        const hh = imgReady(im) ? im.naturalHeight / 2 : 40;
        [fx, fy] = clampToGlass(fx, fy, hw, hh, this.tier);
        this.dragging.x = fx; this.dragging.y = fy;
      }
    });

    const up = (ev) => {
      const [x, y] = pos(ev);
      const quick = performance.now() - downAt < 400 && !moved;
      if (this.mode === "sponge") {
        this.sponge.down = false;
        if (this.wipeIds.size) { this.emit("wiped", [...this.wipeIds]); this.wipeIds.clear(); }
      } else if (this.mode === "edit") {
        if (this.dragging) {
          const d = this.dragging; this.dragging = null;
          // Only emit decoMoved if actually dragged (not a simple tap to select)
          if (moved) {
            this.emit("decoMoved", { id: d.id, x: d.x, y: d.y });
          }
        }
      } else if (quick) {
        this.tapAt(x, y);
      }
      downPos = null;
      this._panId = null; this._panning = false;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", () => { this.sponge.down = false; this.dragging = null; downPos = null; this._panId = null; this._panning = false; });
  },

  hitPlacement(x, y) {
    // topmost first
    for (let i = this.placements.length - 1; i >= 0; i--) {
      const p = this.placements[i];
      const T = DATA.TANKS[this.tier];
      const [px, py] = this.toScreen(p.x, p.y);
      const w = (p._rw || 80) / 2 + 14, h = (p._rh || 80) / 2 + 14;
      if (Math.abs(x - px) < w && Math.abs(y - py) < h) return p;
    }
    return null;
  },

  wipeCheck(x, y) {
    const T = DATA.TANKS[this.tier];
    const [fx, fy] = this.toFraction(x, y);
    const R = .055;
    for (const s of this.spots) {
      if (s.dying || this.wipeIds.has(s.id)) continue;
      if (Math.hypot(s.x - fx, s.y - fy) < R) {
        s.dying = 1;
        this.wipeIds.add(s.id);
        this.popAt(s.x, s.y);
        this.spots = this.spots.filter((o) => !o.dying);
      }
    }
  },

  tapAt(x, y) {
    const T = DATA.TANKS[this.tier];
    const [fx, fy] = this.toFraction(x, y);

    // place-mode: tap drops the decoration here
    if (this.placeDecoId) {
      const decoId = this.placeDecoId;
      this.placeDecoId = null;
      this.emit("placeTap", { deco_id: decoId, x: fx, y: fy });
      return;
    }

    // fish tap: nearest within threshold (generous: finger taps are imprecise,
    // especially on Android where the touch centroid can sit off the visual target)
    let best = null, bd = .10;
    for (const e of this.fish.values()) {
      const d = Math.hypot(e.px - fx, e.py - fy);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      // coin-ready fish: tap collects instead of opening the menu.
      // Feedback is instant (sound + floating "+N 🪙" + badge clears now);
      // the server banks the coins in the background (see app.js coinTap).
      if (best.data && best.data.coin_pending > 0) {
        const amt = best.data.coin_pending;
        const gems = best.data.gem_pending || 0;
        AudioFX.coin();
        this.addEmote(best.px, best.py - .04, `+${amt} 🪙${gems ? ` +${gems} 💎` : ""}`, 1.6);
        best.data.coin_pending = 0;
        best.data.gem_pending = 0;
        this.emit("coinTap", best.data.id);
        return;
      }
      best.faceT = 1.4;
      best.dir = fx >= best.px ? 1 : -1;
      if (best.state === "sleep" || best.state === "idle" || best.state === "goto_sleep") { this.pickTarget(best); best.state = "swim"; }
      this.addEmoteImg(best.px, best.py - .04, "assets/icons/emote_love.png", 1.4);
      AudioFX.pop();
      this.emit("fishTap", best.data.id);
    }
  },
});
