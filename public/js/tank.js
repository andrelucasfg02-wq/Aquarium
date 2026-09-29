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
    this.quality = "high";
    this.handlers = {};
    this.lastT = 0;
    this.ambientT = 0;

    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 200));
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
    const w = Math.floor(window.innerWidth), h = Math.floor(window.innerHeight);
    this.cssW = w; this.cssH = h; this.dpr = dpr;
    this.cv.width = Math.floor(w * dpr);
    this.cv.height = Math.floor(h * dpr);
  }

  setTank(tier) {
    this.tier = tier;
    const T = DATA.TANKS[tier];
    this.bg = loadImg(T.file);
  }

  view() {
    const T = DATA.TANKS[this.tier];
    return coverView(this.cssW, this.cssH, T.w, T.h);
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
    // fish
    const seen = new Set();
    for (const f of (state.fish || [])) {
      if (f.tank && f.tank !== state.tanks.active) continue;
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
      .filter((p) => p.tank === state.tanks.active)
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
    const px = (f.x != null ? f.x : g.left + Math.random() * (g.right - g.left));
    const py = (f.y != null ? f.y : g.top + Math.random() * (g.bottom - g.top));
    return {
      data: f, group,
      px, py, tx: px, ty: py,
      dir: Math.random() < .5 ? 1 : -1,
      state: "idle", stateT: Math.random() * 3,
      animT: Math.random() * 10,
      frame: 0, faceT: 0, eatT: 0, turnT: 0,
      emoteCd: 0,
    };
  }

  pickTarget(e) {
    const g = this.glass();
    const pad = .04;
    if (e.group === "snail") {
      e.tx = g.left + pad + Math.random() * (g.right - g.left - pad * 2);
      e.ty = g.bottom - .012 - Math.random() * .02;
    } else if (e.group === "bottom_fish") {
      e.tx = g.left + pad + Math.random() * (g.right - g.left - pad * 2);
      const band = (g.bottom - g.top) * .22;
      e.ty = g.bottom - .02 - Math.random() * band;
    } else {
      e.tx = g.left + pad + Math.random() * (g.right - g.left - pad * 2);
      e.ty = g.top + pad + Math.random() * (g.bottom - g.top - pad * 2);
      // keep swimmers off the floor a bit
      e.ty = Math.min(e.ty, g.bottom - .06);
    }
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
    for (const e of this.fish.values()) this.updateFish(e, dt, now);
    // pellets sink
    for (const p of this.pellets) {
      p.y += p.vy * dt;
      p.age += dt;
      if (p.age > 15) p.gone = true;
    }
    this.pellets = this.pellets.filter((p) => !p.gone);
    // fish chase pellets
    if (this.pellets.length) {
      for (const e of this.fish.values()) {
        if (e.state === "eat" || e.group === "snail") continue;
        let best = null, bd = 1e9;
        for (const p of this.pellets) {
          const d = Math.hypot(p.x - e.px, p.y - e.py);
          if (d < bd) { bd = d; best = p; }
        }
        if (best && bd < .45) {
          e.state = "chase"; e.chasePellet = best;
          e.tx = best.x; e.ty = best.y;
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

    const dx = e.tx - e.px, dy = e.ty - e.py;
    const dist = Math.hypot(dx, dy);
    const wantDir = dx >= 0 ? 1 : -1;

    switch (e.state) {
      case "idle":
        e.frame = 0;
        e.stateT -= dt;
        if (e.stateT <= 0) {
          if (Math.random() < .22) { e.state = "sleep"; e.stateT = 6 + Math.random() * 8; }
          else { this.pickTarget(e); e.state = "swim"; }
        }
        break;
      case "sleep":
        e.frame = 6;
        e.stateT -= dt;
        if (e.emoteCd <= 0) { this.addEmote(e.px, e.py - .03, "💤", 2.2); e.emoteCd = 2.4; }
        if (e.stateT <= 0) { this.pickTarget(e); e.state = "swim"; }
        break;
      case "turn":
        e.frame = 7;
        e.turnT -= dt;
        if (e.turnT <= 0) { e.dir = wantDir; e.state = "swim"; }
        break;
      case "chase": {
        const p = e.chasePellet;
        if (!p || p.gone) { e.state = "swim"; this.pickTarget(e); break; }
        e.tx = p.x; e.ty = p.y;
        e.frame = 1 + Math.floor(e.animT * 10) % 4;
        if (wantDir !== e.dir) { e.dir = wantDir; }
        this.moveToward(e, speed * 2.4, dt);
        if (Math.hypot(p.x - e.px, p.y - e.py) < .028) {
          p.gone = true; e.state = "eat"; e.eatT = .9;
          this.addEmote(e.px, e.py - .035, "💕", 1.4);
          AudioFX.munch();
        }
        break;
      }
      case "eat":
        e.frame = 5; // munch frame
        e.eatT -= dt;
        if (e.eatT <= 0) { e.state = "idle"; e.stateT = 1 + Math.random() * 2; }
        break;
      case "swim":
      default:
        e.frame = 1 + Math.floor(e.animT * 7) % 4;
        if (dist > .004 && wantDir !== e.dir) {
          e.state = "turn"; e.turnT = .32; e.frame = 7;
          break;
        }
        this.moveToward(e, speed, dt);
        if (dist <= .006) {
          e.state = "idle"; e.stateT = 2 + Math.random() * 5; e.frame = 0;
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

  feedBurst(n) {
    const g = this.glass();
    for (let i = 0; i < n; i++) {
      this.pellets.push({
        x: g.left + .05 + Math.random() * (g.right - g.left - .1),
        y: g.top + .02 + Math.random() * .1,
        vy: .018 + Math.random() * .012,
        age: 0, gone: false,
      });
    }
    // wake sleepers — dinner time!
    for (const e of this.fish.values()) {
      if (e.state === "sleep" || e.state === "idle") { this.pickTarget(e); e.state = "swim"; }
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

    // tank artwork, cover
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
    for (const p of this.pellets) {
      const [x, y] = fracToPx(p.x, p.y, v, T.w, T.h);
      const fade = p.age > 13 ? Math.max(0, 1 - (p.age - 13) / 2) : 1;
      ctx.globalAlpha = fade;
      ctx.fillStyle = "#c98a4b";
      ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, .006 * T.w * v.s), 0, 7); ctx.fill();
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
      ctx.font = `${Math.max(14, .028 * T.w * v.s)}px serif`;
      ctx.fillText(m.text, x, y - k * 26);
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
      ctx.font = "34px serif"; ctx.textAlign = "center";
      ctx.globalAlpha = .95;
      ctx.fillText("🧽", this.sponge.x, this.sponge.y + 10);
      ctx.globalAlpha = 1;
      if (this.placeDecoId) { /* not used together */ }
    }

    // place-mode hint crosshair
    if (this.placeDecoId) {
      ctx.font = "15px sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 3;
      const msg = "Tap the tank to place · ✕ cancels";
      ctx.strokeText(msg, cssW / 2, 86); ctx.fillText(msg, cssW / 2, 86);
    }
  },

  drawFish(e, v, T) {
    const f = e.data;
    const stage = f.stage || "adult";
    const scale = DATA.STAGE_SCALE[stage] || 1;
    const base = (DATA.GROUP_BASE_PX[e.group] || 130) * scale;
    const frame = (e.faceT > 0) ? 0 : e.frame;
    const im = loadImg(spriteURL(f.species_id, frame));
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
    if (e.state === "swim") {
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
      return [ev.clientX - r.left, ev.clientY - r.top];
    };
    let downAt = 0, downPos = null, moved = false;

    el.addEventListener("pointerdown", (ev) => {
      AudioFX.unlock();
      const [x, y] = pos(ev);
      downAt = performance.now(); downPos = [x, y]; moved = false;
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
          this.emit("decoMoved", { id: d.id, x: d.x, y: d.y });
        }
      } else if (quick) {
        this.tapAt(x, y);
      }
      downPos = null;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", () => { this.sponge.down = false; this.dragging = null; downPos = null; });
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

    // fish tap: nearest within threshold
    let best = null, bd = .075;
    for (const e of this.fish.values()) {
      const d = Math.hypot(e.px - fx, e.py - fy);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      best.faceT = 1.4;
      best.dir = fx >= best.px ? 1 : -1;
      if (best.state === "sleep" || best.state === "idle") { this.pickTarget(best); best.state = "swim"; }
      this.addEmote(best.px, best.py - .04, "💕", 1.4);
      AudioFX.pop();
      this.emit("fishTap", best.data.id);
    }
  },
});
