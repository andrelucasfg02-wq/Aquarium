/* grab.js — Grab Machine (claw machine) for the event.
   30 diamonds per play. Server rolls the prize; the claw animates the grab.
   The case is full of colorful surprise eggs; the won prize is revealed after. */
"use strict";

const GrabMachine = (() => {
  const W = 360, H = 600;                          // logical canvas size
  const CASE = { x: 14, y: 66, w: 332, h: 320 };   // glass case
  const FLOOR = CASE.y + CASE.h - 14;              // where eggs rest
  const CHUTE = { x: CASE.x + CASE.w - 52, y: FLOOR - 58, w: 44, h: 50 };
  const GRAB_BTN = { x: 282, y: 498, r: 44 };      // canvas GRAB button
  const COST = 30;

  const EGG_COLORS = ["#ff6b9d", "#4aa8ff", "#5ed66b", "#ffb84d", "#b678ff", "#ffe14d", "#ff8a5c"];

  let overlay = null, canvas = null, ctx = null, raf = 0;
  let prizes = [];        // server prize list {kind,name,file,...} (for grid + reveal)
  let eggs = [];          // visual pile in the case
  let claw = null;        // {x, y, prong (0 open..1 closed), state}
  let heldEgg = null;     // visual egg being carried
  let busy = false;
  let swayT = 0;

  function mulberry(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  async function open() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "food-pop-overlay";
    overlay.id = "grab-overlay";
    overlay.innerHTML = `
      <div class="grab-box">
        <div class="grab-head">
          <b>🪝 ${t("grab.title")}</b>
          <span class="grab-tag">${t("grab.example")}</span>
          <button class="grab-x grab-help" id="grab-help">?</button>
          <button class="grab-x" id="grab-close">✕</button>
        </div>
        <canvas id="grab-canvas" width="${W}" height="${H}"></canvas>
        <div class="grab-prizes">
          <div class="grab-prize-title">🌿 ${t("grab.prizes")} 🌿</div>
          <div class="tabbar comm-tabs" style="margin-bottom:6px">
            <button class="pill-btn active" data-gtab="decor">🗿 ${t("grab.tab_decor")}</button>
            <button class="pill-btn" data-gtab="eggs">🥚 ${t("grab.tab_eggs")}</button>
          </div>
          <div class="grab-grid" id="grab-grid"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    $("grab-close").onclick = close;
    $("grab-help").onclick = () => toast(t("grab.howto"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay && !busy) close(); });
    canvas = $("grab-canvas");
    ctx = canvas.getContext("2d");
    fitCanvas();
    window.addEventListener("resize", fitCanvas);
    canvas.addEventListener("click", onCanvasClick);

    const r = await Api.grabPrizes();
    if (r.ok) { prizes = r.prizes || []; }
    renderGrid("decor");
    overlay.querySelectorAll("[data-gtab]").forEach((b) => b.onclick = () => {
      overlay.querySelectorAll("[data-gtab]").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      renderGrid(b.dataset.gtab);
    });

    buildEggs();
    claw = { x: W / 2, y: CASE.y + 16, prong: 0, state: "sway", targetX: W / 2 };
    swayT = 0;
    loop();
  }

  function fitCanvas() {
    const boxW = Math.min(window.innerWidth - 32, 400);
    canvas.style.width = boxW + "px";
    canvas.style.height = (boxW * H / W) + "px";
  }

  function onCanvasClick(e) {
    const rc = canvas.getBoundingClientRect();
    const x = (e.clientX - rc.left) * W / rc.width;
    const y = (e.clientY - rc.top) * H / rc.height;
    const d = Math.hypot(x - GRAB_BTN.x, y - GRAB_BTN.y);
    if (d <= GRAB_BTN.r + 6) play();
  }

  function buildEggs() {
    eggs = [];
    const rnd = mulberry((Math.random() * 1e9) | 0);
    const rows = 4, per = 8;
    const x0 = CASE.x + 30, x1 = CHUTE.x - 14;
    for (let row = 0; row < rows; row++) {
      const y = FLOOR - 16 - row * 29;
      for (let i = 0; i < per; i++) {
        const x = x0 + i * ((x1 - x0) / (per - 1)) + (rnd() - .5) * 10 + (row % 2 ? 8 : -8);
        eggs.push({
          x, y, r: 15 + rnd() * 3,
          c: EGG_COLORS[(i * 3 + row * 2 + ((rnd() * 7) | 0)) % EGG_COLORS.length],
          wob: rnd() * 6.28, top: row === rows - 1,
        });
      }
    }
  }

  function renderGrid(tab) {
    const g = $("grab-grid");
    if (!g) return;
    const list = prizes.filter((p) => (tab === "eggs" ? p.kind === "egg" : p.kind === "decor"));
    g.innerHTML = list.map((p, i) => `
      <div class="grab-cell">
        ${p.kind === "egg"
          ? `<div class="grab-eggdot" style="background:${EGG_COLORS[i % EGG_COLORS.length]}"></div>`
          : `<img src="${p.file}" alt="" loading="lazy">`}
        <div class="grab-cell-name">${esc(p.name)}</div>
      </div>`).join("");
  }

  async function play() {
    if (busy) return;
    if (!confirm(t("grab.confirm"))) return;
    busy = true;
    const r = await Api.grabPlay();
    if (!r.ok) {
      toast(r.error === "not enough diamonds" ? t("grab.no_gems") : (r.error || t("toast.couldnt_buy_food")));
      AudioFX.error();
      busy = false;
      return;
    }
    AudioFX.coin();
    // pick a random egg from the top row as the visual grab target
    const top = eggs.filter((e) => e.top);
    const target = top.length ? top[(Math.random() * top.length) | 0] : eggs[0];
    heldEgg = null;
    claw.state = "glide"; claw.targetX = target.x; claw.target = target; claw.won = r.prize;
    await App.refresh();
  }

  function close() {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", fitCanvas);
    if (overlay) overlay.remove();
    overlay = null; busy = false;
  }

  /* ---------------- drawing ---------------- */
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function leaf(x, y, s, a) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
    ctx.fillStyle = "#3fa34d";
    ctx.beginPath(); ctx.ellipse(0, 0, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#2b7a35"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.stroke();
    ctx.restore();
  }

  function bubble(x, y, r) {
    ctx.strokeStyle = "rgba(220,245,255,.8)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.beginPath(); ctx.arc(x - r * .3, y - r * .3, r * .25, 0, Math.PI * 2); ctx.fill();
  }

  function drawSign() {
    const x = 30, y = 8, w = W - 60, h = 44;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "#a9743a"); g.addColorStop(1, "#7a4f22");
    ctx.fillStyle = g; roundRect(x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = "#5d3a17"; ctx.lineWidth = 3; roundRect(x, y, w, h, 12); ctx.stroke();
    // leaves + bubbles at the corners
    leaf(x + 4, y + 6, 1, -.5); leaf(x + 16, y + 2, .8, -.2);
    leaf(x + w - 4, y + 6, 1, .5); leaf(x + w - 16, y + 2, .8, .2);
    leaf(x + 6, y + h - 4, .9, -.9); leaf(x + w - 6, y + h - 4, .9, .9);
    bubble(x - 8, y + 30, 5); bubble(x + w + 8, y + 12, 4); bubble(x + w + 4, y + 34, 6);
    // title: "Grab" yellow + "Machine" green
    ctx.font = "bold 25px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const w1 = ctx.measureText("Grab ").width, w2 = ctx.measureText("Machine").width;
    const tx = x + (w - w1 - w2) / 2, ty = y + h / 2 + 1;
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(60,35,5,.55)";
    ctx.strokeText("Grab ", tx, ty); ctx.strokeText("Machine", tx + w1, ty);
    ctx.fillStyle = "#ffd75e"; ctx.fillText("Grab ", tx, ty);
    ctx.fillStyle = "#7de08a"; ctx.fillText("Machine", tx + w1, ty);
    ctx.textBaseline = "alphabetic";
  }

  function drawCaseBg() {
    const { x, y, w, h } = CASE;
    // water
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "#2fa8c8"); g.addColorStop(.55, "#1b7fa0"); g.addColorStop(1, "#14607c");
    ctx.fillStyle = g; roundRect(x, y, w, h, 14); ctx.fill();
    ctx.save();
    roundRect(x, y, w, h, 14); ctx.clip();
    // light rays
    ctx.fillStyle = "rgba(255,255,255,.10)";
    for (let i = 0; i < 3; i++) {
      const rx = x + 40 + i * 100;
      ctx.beginPath();
      ctx.moveTo(rx, y); ctx.lineTo(rx + 44, y);
      ctx.lineTo(rx + 10, y + h); ctx.lineTo(rx - 34, y + h);
      ctx.closePath(); ctx.fill();
    }
    // plant silhouettes at the sides
    ctx.fillStyle = "rgba(18,90,70,.55)";
    for (const px of [x + 12, x + w - 12]) {
      for (let i = 0; i < 5; i++) {
        const bx = px + (i - 2) * 9, bh = 60 + ((i * 37) % 50);
        ctx.beginPath();
        ctx.moveTo(bx - 7, y + h);
        ctx.quadraticCurveTo(bx - 10, y + h - bh * .6, bx + Math.sin(swayT + i) * 8, y + h - bh);
        ctx.quadraticCurveTo(bx + 10, y + h - bh * .6, bx + 7, y + h);
        ctx.closePath(); ctx.fill();
      }
    }
    // rising bubbles
    for (let i = 0; i < 7; i++) {
      const bx = x + 30 + ((i * 47) % (w - 60));
      const by = y + h - 20 - ((swayT * 22 + i * 53) % (h - 40));
      bubble(bx, by, 3 + (i % 3));
    }
    // sand floor
    ctx.fillStyle = "#e6d194";
    ctx.fillRect(x, FLOOR, w, h - (FLOOR - y));
    ctx.fillStyle = "rgba(0,0,0,.08)";
    ctx.fillRect(x, FLOOR, w, 5);
    ctx.restore();
    // gold frame
    const fg = ctx.createLinearGradient(x, y, x + w, y);
    fg.addColorStop(0, "#8a6d3b"); fg.addColorStop(.5, "#e8c34a"); fg.addColorStop(1, "#8a6d3b");
    ctx.strokeStyle = fg; ctx.lineWidth = 7;
    roundRect(x, y, w, h, 14); ctx.stroke();
  }

  function drawEggShape(e, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(e.x, e.y);
    ctx.rotate(Math.sin(swayT * 2 + e.wob) * .07);
    const rx = e.r, ry = e.r * 1.18;
    const g = ctx.createLinearGradient(0, -ry, 0, ry);
    g.addColorStop(0, "#ffffff"); g.addColorStop(.35, e.c); g.addColorStop(1, e.c);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    // shine
    ctx.fillStyle = "rgba(255,255,255,.65)";
    ctx.beginPath(); ctx.ellipse(-rx * .35, -ry * .4, rx * .22, ry * .3, -.4, 0, Math.PI * 2); ctx.fill();
    // polka dots
    ctx.fillStyle = "rgba(255,255,255,.5)";
    ctx.beginPath(); ctx.arc(rx * .3, ry * .15, rx * .16, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-rx * .1, ry * .45, rx * .13, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawChute() {
    const g = ctx.createLinearGradient(0, CHUTE.y, 0, CHUTE.y + CHUTE.h);
    g.addColorStop(0, "#0d2b33"); g.addColorStop(1, "#06181d");
    ctx.fillStyle = g; roundRect(CHUTE.x, CHUTE.y, CHUTE.w, CHUTE.h, 8); ctx.fill();
    ctx.strokeStyle = "#c9a227"; ctx.lineWidth = 2.5; roundRect(CHUTE.x, CHUTE.y, CHUTE.w, CHUTE.h, 8); ctx.stroke();
    ctx.fillStyle = "#e8c34a"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("★", CHUTE.x + CHUTE.w / 2, CHUTE.y + CHUTE.h / 2 + 6);
  }

  function diamond(x, y, s) {
    const g = ctx.createLinearGradient(x, y - s, x, y + s);
    g.addColorStop(0, "#bfe9ff"); g.addColorStop(.5, "#4aa8ff"); g.addColorStop(1, "#2a6fd6");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.lineTo(x + s * .8, y - s * .15);
    ctx.lineTo(x, y + s); ctx.lineTo(x - s * .8, y - s * .15);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s * .8, y - s * .15); ctx.lineTo(x + s * .8, y - s * .15); ctx.stroke();
  }

  function drawClaw() {
    const c = claw;
    // rail
    ctx.fillStyle = "#6e5626";
    roundRect(CASE.x + 8, CASE.y + 6, CASE.w - 16, 10, 5); ctx.fill();
    ctx.fillStyle = "#e8c34a";
    roundRect(CASE.x + 8, CASE.y + 6, CASE.w - 16, 4, 2); ctx.fill();
    // piston
    const pg = ctx.createLinearGradient(c.x - 7, 0, c.x + 7, 0);
    pg.addColorStop(0, "#8a6d3b"); pg.addColorStop(.5, "#f0d878"); pg.addColorStop(1, "#8a6d3b");
    ctx.fillStyle = pg;
    roundRect(c.x - 7, CASE.y + 10, 14, Math.max(4, c.y - 18 - (CASE.y + 10)), 5); ctx.fill();
    // accordion hose
    ctx.strokeStyle = "#3d3d3d"; ctx.lineWidth = 3;
    const hy0 = CASE.y + 12, hy1 = c.y - 22;
    for (let yy = hy0; yy < hy1; yy += 7) {
      ctx.beginPath(); ctx.arc(c.x - 11, yy + 3, 4, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
    }
    const hubY = c.y;
    // hub
    const hg = ctx.createRadialGradient(c.x - 7, hubY - 9, 5, c.x, hubY, 28);
    hg.addColorStop(0, "#f4e2a0"); hg.addColorStop(.6, "#d4a93f"); hg.addColorStop(1, "#8a6d3b");
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(c.x, hubY, 25, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#6e5626"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(c.x, hubY, 25, 0, Math.PI * 2); ctx.stroke();
    // green medallion with fish
    ctx.fillStyle = "#1e7a4f";
    ctx.beginPath(); ctx.arc(c.x, hubY, 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#c9f0d8"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(c.x, hubY, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#ffe9a8";
    ctx.beginPath(); ctx.ellipse(c.x - 1, hubY, 7, 4.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(c.x + 6, hubY); ctx.lineTo(c.x + 12, hubY - 5); ctx.lineTo(c.x + 12, hubY + 5); ctx.closePath(); ctx.fill();
    // prongs
    const open = (1 - c.prong) * .85 + .12;   // spread angle
    for (let k = -1; k <= 1; k++) {
      const spread = k * open;
      const bx = c.x + k * 14, by = hubY + 17;                       // joint
      const mx = c.x + Math.sin(spread) * 34, my = hubY + 40;       // mid
      const tx = c.x + Math.sin(spread) * 38, ty = hubY + 62 - c.prong * 16; // tip curls in when closed
      const grad = ctx.createLinearGradient(bx, by, tx, ty);
      grad.addColorStop(0, "#e8c34a"); grad.addColorStop(1, "#9a7a2e");
      ctx.strokeStyle = grad; ctx.lineWidth = 11; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(mx, my, tx, ty); ctx.stroke();
      ctx.strokeStyle = "rgba(90,60,10,.6)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(mx, my, tx, ty); ctx.stroke();
      // claw tip
      ctx.fillStyle = "#cfd6dd";
      ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#7a828c"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawPanel() {
    const x = 8, y = 402, w = W - 16, h = 158;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "#12707e"); g.addColorStop(1, "#0a4a55");
    ctx.fillStyle = g; roundRect(x, y, w, h, 18); ctx.fill();
    ctx.strokeStyle = "#c9a227"; ctx.lineWidth = 3; roundRect(x, y, w, h, 18); ctx.stroke();
    ctx.fillStyle = "rgba(232,195,74,.85)";
    roundRect(x + 6, y + 4, w - 12, 5, 2.5); ctx.fill();
    // side decorations: leaves + bubbles
    leaf(x + 26, y + h - 22, 1.1, -.4); leaf(x + 40, y + h - 14, .9, -.1); leaf(x + 16, y + h - 12, .9, -.8);
    leaf(x + w - 26, y + h - 22, 1.1, .4); leaf(x + w - 40, y + h - 14, .9, .1); leaf(x + w - 16, y + h - 12, .8, .8);
    bubble(x + 52, y + h - 26, 6); bubble(x + 62, y + h - 40, 4);
    bubble(x + w - 52, y + h - 30, 5); bubble(x + w - 64, y + h - 18, 7);
    // joystick
    const jx = 78, jy = y + 108;
    ctx.fillStyle = "rgba(0,0,0,.4)";
    ctx.beginPath(); ctx.ellipse(jx, jy, 34, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#e8c34a"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(jx, jy, 30, 11, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#8a5a2b";
    roundRect(jx - 6, jy - 52, 12, 52, 6); ctx.fill();
    ctx.strokeStyle = "#5d3a17"; ctx.lineWidth = 2;
    roundRect(jx - 6, jy - 52, 12, 52, 6); ctx.stroke();
    const bg2 = ctx.createRadialGradient(jx - 6, jy - 66, 4, jx, jy - 58, 22);
    bg2.addColorStop(0, "#a5f0b5"); bg2.addColorStop(.6, "#3fa34d"); bg2.addColorStop(1, "#1e6b32");
    ctx.fillStyle = bg2;
    ctx.beginPath(); ctx.arc(jx, jy - 58, 20, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#14522a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(jx, jy - 58, 20, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.5)";
    ctx.beginPath(); ctx.arc(jx - 6, jy - 64, 5, 0, Math.PI * 2); ctx.fill();
    // cost pill
    ctx.fillStyle = "rgba(0,0,0,.45)";
    roundRect(138, y + 62, 104, 42, 21); ctx.fill();
    diamond(164, y + 83, 11);
    ctx.fillStyle = "#fff"; ctx.font = "bold 21px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(`${COST}`, 182, y + 91);
    ctx.textAlign = "center";
    // GRAB button
    const b = GRAB_BTN, by = y + 96;
    const og = ctx.createRadialGradient(b.x - 10, by - 12, 8, b.x, by, b.r);
    og.addColorStop(0, "#f4d878"); og.addColorStop(1, "#b8912a");
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(b.x, by, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#7a5f1a"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(b.x, by, b.r, 0, Math.PI * 2); ctx.stroke();
    const ig = ctx.createRadialGradient(b.x - 8, by - 10, 6, b.x, by, b.r - 9);
    ig.addColorStop(0, "#8ce89e"); ig.addColorStop(1, "#2e9e5b");
    ctx.fillStyle = ig;
    ctx.beginPath(); ctx.arc(b.x, by, b.r - 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "bold 20px sans-serif";
    ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 3; ctx.shadowOffsetY = 2;
    ctx.fillText(t("grab.play"), b.x, by + 7);
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    GRAB_BTN.y = by;
  }

  function drawGlassShine() {
    const { x, y, w, h } = CASE;
    ctx.fillStyle = "rgba(255,255,255,.14)";
    ctx.beginPath();
    ctx.moveTo(x + 22, y + 10); ctx.lineTo(x + 62, y + 10);
    ctx.lineTo(x + 30, y + h - 10); ctx.lineTo(x + 8, y + h - 10);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.08)";
    ctx.beginPath();
    ctx.moveTo(x + w - 40, y + 10); ctx.lineTo(x + w - 22, y + 10);
    ctx.lineTo(x + w - 54, y + h - 10); ctx.lineTo(x + w - 66, y + h - 10);
    ctx.closePath(); ctx.fill();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawSign();
    drawCaseBg();
    for (const e of eggs) drawEggShape(e);
    drawChute();
    if (heldEgg) drawEggShape(heldEgg);
    drawClaw();
    drawGlassShine();
    drawPanel();
  }

  /* ---------------- animation ---------------- */
  function loop() {
    swayT += 1 / 60;
    const c = claw;
    if (c.state === "sway") {
      c.x = W / 2 + Math.sin(swayT * 1.4) * (CASE.w / 2 - 52);
      c.prong += (0 - c.prong) * .2;
    } else if (c.state === "glide") {
      c.x += (c.targetX - c.x) * .12;
      if (Math.abs(c.targetX - c.x) < 3) { c.state = "drop"; AudioFX.plop(); }
    } else if (c.state === "drop") {
      c.y += 8;
      c.prong += (0 - c.prong) * .2;
      if (c.y >= c.target.y - 14) { c.state = "grab"; c.grabT = 0; }
    } else if (c.state === "grab") {
      c.grabT += 1 / 60;
      c.prong += (1 - c.prong) * .25;
      if (c.grabT > .5) {
        heldEgg = c.target;
        const i = eggs.indexOf(c.target);
        if (i >= 0) eggs.splice(i, 1);
        c.state = "lift"; AudioFX.unlock();
      }
    } else if (c.state === "lift") {
      c.y -= 8;
      if (heldEgg) { heldEgg.x = c.x; heldEgg.y = c.y + 52; }
      if (c.y <= CASE.y + 16) { c.state = "deliver"; }
    } else if (c.state === "deliver") {
      const tx = CHUTE.x + CHUTE.w / 2;
      c.x += (tx - c.x) * .12;
      if (heldEgg) { heldEgg.x = c.x; heldEgg.y = c.y + 52; }
      if (Math.abs(tx - c.x) < 3) { c.state = "release"; c.relT = 0; }
    } else if (c.state === "release") {
      c.relT += 1 / 60;
      c.prong += (0 - c.prong) * .25;
      if (heldEgg) heldEgg.y += 10;
      if (c.relT > .5) {
        const won = c.won;
        heldEgg = null;
        c.state = "sway"; c.y = CASE.y + 16;
        busy = false;
        AudioFX.coin();
        reveal(won);
      }
    }
    draw();
    raf = requestAnimationFrame(loop);
  }

  function prizeImgHtml(prize) {
    if (prize.kind === "egg") {
      return `<div class="grab-won-egg"></div>`;
    }
    return prize.file ? `<img src="${prize.file}" alt="">` : "";
  }

  function reveal(prize) {
    const d = document.createElement("div");
    d.className = "food-pop-overlay";
    d.style.zIndex = 400;
    d.innerHTML = `
      <div class="food-pop grab-won">
        <div class="grab-won-title">🎉 ${t("grab.you_won")}</div>
        ${prizeImgHtml(prize)}
        <b>${esc(prize.name)}</b>
        <div class="sub">${t("grab.to_inventory")}</div>
        <button class="pill-btn pink" id="grab-won-ok" style="margin-top:10px;width:100%">OK</button>
      </div>`;
    document.body.appendChild(d);
    $("grab-won-ok").onclick = () => d.remove();
    d.addEventListener("click", (e) => { if (e.target === d) d.remove(); });
  }

  return { open, close };
})();
