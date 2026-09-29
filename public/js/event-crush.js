/* event-crush.js — Autumn Crush weekly event game. Mounted by UI.open("event"). */
"use strict";
const EventCrush = (() => {

"use strict";
const TYPES = ["leaf","nut","branch","pearl","shell","tadpole"];
const N = 8;
const LEVELS = [5000, 20000, 35000, 50000, 80000, 100000, 120000, 150000, 200000, 300000];
let board = null, fx = null, R = null;
let grid = [], rocks = [], rocksPlaced = false, selected = null, score = 0, moves = 0, level = 0, busy = false, over = false;

const rnd = n => Math.floor(Math.random() * n);
const fmt = n => n.toLocaleString("pt-BR");
let $score = null, $level = null, $target = null, $plabel = null, $fill = null;

function updateHud() {
  const target = LEVELS[level], base = level === 0 ? 0 : LEVELS[level - 1];
  $score.textContent = fmt(score);
  $target.textContent = fmt(target);
  $level.textContent = t("event.level", { n: level + 1 });
  $fill.style.width = Math.min(100, (score - base) / (target - base) * 100) + "%";
  $plabel.innerHTML = level === LEVELS.length - 1
    ? t("event.level_last", { n: LEVELS.length, target: fmt(target) })
    : t("event.level_goal", { n: level + 1, target: fmt(target) });
}

function toast(msg) {
  const t = R.querySelector("#ev-toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 1800);
}

// ---- SAVE: progresso por conta, no servidor ----
// Returns a promise: true = server accepted the save, false = failed.
// The claim endpoint reads the SERVER score, so endGame must await this
// before declaring victory — otherwise the claim can run before the save lands.
const EVENT_ID = "autumn1";
let _lastSig = "";
function saveProgress(force) {
  if ((!force && over) || typeof Api === "undefined") return Promise.resolve(false);
  const sig = [score, level, moves].join("|");
  if (sig === _lastSig) return Promise.resolve(true);
  _lastSig = sig;
  return Api.eventSave(EVENT_ID, score, level, moves)
    .then((r) => !!(r && r.ok))
    .catch(() => false);
}
async function loadProgress() {
  try {
    const r = await Api.eventProgress(EVENT_ID);
    if (r && r.ok && typeof r.score === "number") return r;
  } catch (e) {}
  return null;
}
function clearProgress() { /* o servidor guarda o recorde; o resgate e separado */ }
function onHideSave() { saveProgress(); }

function checkLevel() {
  if (over) return;
  let leveled = false;
  while (level < LEVELS.length - 1 && score >= LEVELS[level]) { level++; leveled = true; }
  updateHud();
  saveProgress();
  if (leveled) toast(t("event.level_up", { n: level + 1 }));
  if (level >= 4 && !rocksPlaced) {
    rocksPlaced = true;
    placeRocks();
    setTimeout(() => toast(t("event.rocks")), 1300);
  }
  if (score >= LEVELS[LEVELS.length - 1]) endGame(true);
}

function placeRocks() {
  let n = 0, guard = 0;
  while (n < 4 && guard++ < 300) {
    const r = 1 + rnd(6), c = rnd(N);
    if (!rocks[r][c]) {
      rocks[r][c] = true;
      grid[r][c] = -1;
      const old = elAt(r, c);
      if (old) old.remove();
      const d = document.createElement("div");
      d.className = "tok rock spr-rock";
      d.dataset.r = r; d.dataset.c = c;
      placeTok(d, r, c);
      board.appendChild(d);
      n++;
    }
  }
}

function makeTok(r, c, t) {
  const d = document.createElement("div");
  d.className = "tok spr-" + TYPES[t];
  return d;
}
// .tok is 12.5% of board; translate % is relative to the element itself,
// so 100% = exactly one cell.
function placeTok(el, r, c) {
  el.dataset.r = r; el.dataset.c = c;
  el.style.transform = `translate(${c * 100}%, ${r * 100}%)`;
}

function newTypeAvoiding(r, c) {
  for (let tries = 0; tries < 20; tries++) {
    const t = rnd(6);
    if (c >= 2 && grid[r][c-1] === t && grid[r][c-2] === t) continue;
    if (r >= 2 && grid[r-1][c] === t && grid[r-2][c] === t) continue;
    return t;
  }
  return rnd(6);
}

function buildBoard() {
  board.querySelectorAll(".tok").forEach(e => e.remove());
  grid = []; rocks = []; rocksPlaced = false;
  for (let r = 0; r < N; r++) {
    grid[r] = []; rocks[r] = [];
    for (let c = 0; c < N; c++) {
      rocks[r][c] = false;
      const t = newTypeAvoiding(r, c);
      grid[r][c] = t;
      const el = makeTok(r, c, t);
      placeTok(el, r, c);
      el.addEventListener("pointerdown", onTap);
      board.appendChild(el);
    }
  }
  if (!anyMove()) return buildBoard();
}

function elAt(r, c) {
  return board.querySelector(`.tok:not(.rock)[data-r="${r}"][data-c="${c}"]`);
}

function rockElAt(r, c) {
  return board.querySelector(`.rock[data-r="${r}"][data-c="${c}"]`);
}

function onTap(e) {
  if (busy || over) return;
  const el = e.currentTarget;
  const r = +el.dataset.r, c = +el.dataset.c;
  if (!selected) { selected = el; el.classList.add("sel"); return; }
  const sr = +selected.dataset.r, sc = +selected.dataset.c;
  if (sr === r && sc === c) { selected.classList.remove("sel"); selected = null; return; }
  if (Math.abs(sr - r) + Math.abs(sc - c) === 1) {
    const a = selected; selected.classList.remove("sel"); selected = null;
    trySwap(a, el);
  } else {
    selected.classList.remove("sel"); selected = el; el.classList.add("sel");
  }
}

async function trySwap(a, b) {
  busy = true;
  try {
    const ar = +a.dataset.r, ac = +a.dataset.c, br = +b.dataset.r, bc = +b.dataset.c;
    swapCells(ar, ac, br, bc);
    await wait(240);
    const m = findMatches();
    if (!m.groups.length) { swapCells(ar, ac, br, bc); await wait(240); return; }
    moves++;
    await resolveBoard();
    checkLevel();
    if (!over && !anyMove()) { shuffleBoard(); }
  } catch (err) {
    try { rebuildTokens(); } catch (e) { /* never freeze the board */ }
  } finally {
    busy = false; // guarantees taps keep working even if a frame desyncs
  }
}

function swapCells(ar, ac, br, bc) {
  const t = grid[ar][ac]; grid[ar][ac] = grid[br][bc]; grid[br][bc] = t;
  const ea = elAt(ar, ac), eb = elAt(br, bc);
  if (ea) placeTok(ea, br, bc);
  if (eb) placeTok(eb, ar, ac);
}

// Rebuild the token DOM from grid+rocks after an unrecoverable desync,
// so one bad frame can never freeze the board for good.
function rebuildTokens() {
  board.querySelectorAll(".tok").forEach(e => e.remove());
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (rocks[r][c]) {
      const d = document.createElement("div");
      d.className = "tok rock spr-rock";
      placeTok(d, r, c);
      board.appendChild(d);
    } else if (grid[r][c] !== -1) {
      const el = makeTok(r, c, grid[r][c]);
      placeTok(el, r, c);
      el.addEventListener("pointerdown", onTap);
      board.appendChild(el);
    }
  }
}

function findMatches() {
  const groups = [];
  for (let r = 0; r < N; r++) {
    let c = 0;
    while (c < N) {
      const t = grid[r][c];
      if (t === -1) { c++; continue; }
      let c2 = c;
      while (c2 < N && grid[r][c2] === t) c2++;
      if (c2 - c >= 3) {
        const cells = [];
        for (let i = c; i < c2; i++) cells.push([r, i]);
        groups.push({ type: t, cells });
      }
      c = c2;
    }
  }
  for (let c = 0; c < N; c++) {
    let r = 0;
    while (r < N) {
      const t = grid[r][c];
      if (t === -1) { r++; continue; }
      let r2 = r;
      while (r2 < N && grid[r2][c] === t) r2++;
      if (r2 - r >= 3) {
        const cells = [];
        for (let i = r; i < r2; i++) cells.push([i, c]);
        groups.push({ type: t, cells });
      }
      r = r2;
    }
  }
  return { groups };
}

function anyMove() {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (rocks[r][c]) continue;
    for (const [dr, dc] of [[0,1],[1,0]]) {
      const r2 = r + dr, c2 = c + dc;
      if (r2 >= N || c2 >= N || rocks[r2][c2]) continue;
      const a = grid[r][c]; grid[r][c] = grid[r2][c2]; grid[r2][c2] = a;
      const ok = findMatches().groups.length > 0;
      grid[r2][c2] = grid[r][c]; grid[r][c] = a;
      if (ok) return true;
    }
  }
  return false;
}

function shuffleBoard() {
  const cells = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!rocks[r][c]) cells.push([r, c]);
  const flat = cells.map(([r, c]) => grid[r][c]);
  for (let i = flat.length - 1; i > 0; i--) { const j = rnd(i + 1); [flat[i], flat[j]] = [flat[j], flat[i]]; }
  cells.forEach(([r, c], i) => { grid[r][c] = flat[i]; placeTok(elAt(r, c), r, c); });
  if (findMatches().groups.length || !anyMove()) return shuffleBoard();
}

function addScore(n, r, c) {
  score += n;
  updateHud();
  if (r !== undefined) {
    const s = document.createElement("div");
    s.className = "float-score"; s.textContent = "+" + n;
    s.style.left = (c * 12.5 + 6.25) + "%"; s.style.top = (r * 12.5 + 6.25) + "%";
    fx.appendChild(s); setTimeout(() => s.remove(), 850);
  }
}

function boomFx(r, c, cls) {
  const b = document.createElement("div");
  b.className = "boom spr " + cls;
  b.style.left = (c * 12.5 + 6.25) + "%"; b.style.top = (r * 12.5 + 6.25) + "%";
  fx.appendChild(b); setTimeout(() => b.remove(), 600);
}

const wait = ms => new Promise(res => setTimeout(res, ms));

async function resolveBoard() {
  let cascade = 0;
  while (true) {
    const { groups } = findMatches();
    if (!groups.length) break;
    cascade++;
    const clearSet = new Map();
    let pearlBoom = null, tadpoleSwarm = false;
    for (const g of groups) {
      for (const [r, c] of g.cells) clearSet.set(r + "," + c, { r, c });
      if (TYPES[g.type] === "pearl" && !pearlBoom) {
        const mr = Math.round(g.cells.reduce((s, x) => s + x[0], 0) / g.cells.length);
        const mc = Math.round(g.cells.reduce((s, x) => s + x[1], 0) / g.cells.length);
        pearlBoom = { r: mr, c: mc };
      }
      if (TYPES[g.type] === "tadpole") tadpoleSwarm = true;
    }
    // PEARL: big explosion 5x5 around the match, with the real pearl art
    if (pearlBoom) {
      board.classList.add("shake");
      boomFx(pearlBoom.r, pearlBoom.c, "spr-pearl");
      for (let r = Math.max(0, pearlBoom.r - 2); r <= Math.min(N - 1, pearlBoom.r + 2); r++)
        for (let c = Math.max(0, pearlBoom.c - 2); c <= Math.min(N - 1, pearlBoom.c + 2); c++)
          clearSet.set(r + "," + c, { r, c });
      setTimeout(() => board.classList.remove("shake"), 450);
    }
    // TADPOLE: a swarm of real tadpoles eats 12 random tokens
    if (tadpoleSwarm) {
      const all = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
        if (!rocks[r][c] && !clearSet.has(r + "," + c)) all.push({ r, c });
      for (let i = all.length - 1; i > 0; i--) { const j = rnd(i + 1); [all[i], all[j]] = [all[j], all[i]]; }
      const eaten = all.slice(0, 12);
      let orr = 3, occ = 3;
      for (const g of groups) if (TYPES[g.type] === "tadpole") { orr = g.cells[0][0]; occ = g.cells[0][1]; break; }
      boomFx(orr, occ, "spr-tadpole");
      eaten.forEach((cell, i) => setTimeout(() => {
        clearSet.set(cell.r + "," + cell.c, cell);
        const el = elAt(cell.r, cell.c);
        if (el) el.classList.add("pop");
      }, 120 + i * 70));
      await wait(120 + eaten.length * 70 + 120);
    }
    const cells = [...clearSet.values()];
    const pts = cells.length * 10 * cascade;
    cells.forEach(({ r, c }) => { const el = rocks[r][c] ? rockElAt(r, c) : elAt(r, c); if (el) el.classList.add("pop"); });
    const cr = Math.round(cells.reduce((s, x) => s + x.r, 0) / cells.length);
    const cc = Math.round(cells.reduce((s, x) => s + x.c, 0) / cells.length);
    addScore(pts, cr, cc);
    await wait(200);
    cells.forEach(({ r, c }) => {
      if (rocks[r][c]) {
        rocks[r][c] = false;
        const rel = rockElAt(r, c); if (rel) rel.remove();
        addScore(200, r, c);
      } else {
        const el = elAt(r, c); if (el) el.remove(); grid[r][c] = -1;
      }
    });
    for (let c = 0; c < N; c++) {
      let segEnd = N - 1;
      for (let r = N - 1; r >= -1; r--) {
        if (r === -1 || rocks[r][c]) {
          let write = segEnd;
          for (let rr = segEnd; rr > r; rr--) {
            if (grid[rr][c] !== -1) {
              if (write !== rr) {
                grid[write][c] = grid[rr][c]; grid[rr][c] = -1;
                const el = elAt(rr, c); if (el) placeTok(el, write, c);
              }
              write--;
            }
          }
          const fresh = write - r;
          for (let rr = write; rr > r; rr--) {
            const t = rnd(6);
            grid[rr][c] = t;
            const el = makeTok(rr, c, t);
            el.style.transition = "none";
            // The logical cell is final NOW (dataset); only the paint starts
            // above the board. Previously dataset stayed stale until the rAF
            // below fired — under jank elAt() then grabbed the WRONG token,
            // desyncing grid/DOM and freezing the board (busy stuck true).
            el.dataset.r = rr; el.dataset.c = c;
            el.style.transform = `translate(${c * 100}%, ${(rr - fresh) * 100}%)`;
            el.addEventListener("pointerdown", onTap);
            board.appendChild(el);
            requestAnimationFrame(() => requestAnimationFrame(() => {
              if (!el.isConnected) return; // cleared by a later cascade meanwhile
              if (+el.dataset.r !== rr || +el.dataset.c !== c) return; // moved meanwhile
              el.style.transition = "";
              el.classList.add("falling");
              el.style.transform = `translate(${c * 100}%, ${rr * 100}%)`;
            }));
          }
          segEnd = r - 1;
        }
      }
    }
    await wait(320);
  }
}

function startFreshRun() {
  score = 0; level = 0; moves = 0; over = false; busy = false;
  selected = null; grid = []; rocks = []; rocksPlaced = false; _lastSig = "";
  R.querySelector("#ev-overlay").classList.add("hidden");
  buildBoard(); updateHud();
}

async function endGame(win) {
  over = true;
  const card = R.querySelector("#ev-card");
  const overlay = R.querySelector("#ev-overlay");
  overlay.classList.remove("hidden");
  // The server is the source of truth for the claim: confirm the final score
  // landed there before declaring victory (the save is async).
  card.innerHTML = `
    <h2>${t("event.syncing")}</h2>
    <p style="font-size:13px">${t("event.confirming")}</p>`;
  _lastSig = ""; // force the final save through (the over-guard would skip it)
  const saved = await saveProgress(true);
  let sp = null;
  try { sp = await loadProgress(); } catch (e) {}
  const goal = LEVELS[LEVELS.length - 1];
  if (!saved || !sp || sp.score < goal) {
    card.innerHTML = `
      <h2>${t("event.almost_there")}</h2>
      <p>${t("event.no_confirm")}<br>
      <span style="font-size:13px">${t("event.check_conn")}</span></p>
      <button class="btn" id="ev-retry-btn">${t("event.retry")}</button>`;
    R.querySelector("#ev-retry-btn").onclick = () => endGame(true);
    return;
  }
  const alreadyClaimed = !!sp.claimed;
  card.innerHTML = `
    <h2>${t("event.fish_unlocked")}</h2>
    <div id="ev-big-fish" class="spr spr-fish1"></div>
    <p>${t("event.you_made", { score: fmt(score), moves })}</p>
    ${alreadyClaimed
      ? `<p style="font-size:13px">${t("event.already_have")}</p>`
      : `<button class="btn" id="ev-catch-btn">${t("event.save_inv")}</button>
         <p id="ev-claim-msg" style="font-size:13px;min-height:18px"></p>`}`;
  if (alreadyClaimed) return;
  R.querySelector("#ev-catch-btn").onclick = async () => {
    const btn = R.querySelector("#ev-catch-btn");
    const msg = R.querySelector("#ev-claim-msg");
    btn.disabled = true; btn.textContent = t("event.saving");
    try {
      const r = await Api.eventClaim(EVENT_ID);
      if (r && r.ok) {
        msg.textContent = t("event.claimed_ok");
        btn.textContent = t("event.view_collection");
        btn.disabled = false;
        if (window.App) App.refresh();
        btn.onclick = () => { if (typeof UI !== "undefined") { UI.close(); UI.open("collection"); } };
        // second (and last) run available? offer a fresh playthrough from zero
        try {
          const sp2 = await loadProgress();
          const _runs2 = (sp2 && sp2.runs_claimed) || 0;
          const _max2 = (sp2 && sp2.max_runs) || 1;
          if (sp2 && _runs2 < _max2) {
            const again = document.createElement("button");
            again.className = "btn"; again.style.marginTop = "8px";
            again.innerHTML = t("event.play_again");
            again.onclick = () => { startFreshRun(); toast(t("event.last_chance")); };
            msg.after(again);
          } else if (sp2) {
            const done = document.createElement("p");
            done.style.fontSize = "13px";
            done.innerHTML = t("event.completed_2");
            msg.after(done);
          }
        } catch (e) {}
      } else {
        msg.textContent = (r && r.error === "already claimed")
          ? t("event.have_it")
          : t("event.claim_fail", { err: (r && r.error) || t("event.try_again_short") });
        btn.disabled = false; btn.textContent = t("event.save_inv");
      }
    } catch (e) {
      msg.textContent = t("event.offline");
      btn.disabled = false; btn.textContent = t("event.save_inv");
    }
  };
}

async function mount(root) {
  R = root;
  R.innerHTML = '<div id="ev-fish-layer"><div class="swim f1 spr-fish1"></div><div class="swim f2 spr-fish2"></div><div class="swim f3 spr-fish3"></div></div>\n<h1><img class="ico big" src="assets/event/leaf.png" alt="leaf" data-i18n-alt="event.alt_leaf"> Autumn Crush</h1>\n<div class="sub" data-i18n="event.subtitle">Autumn event &middot; Week 1</div>\n<div id="ev-hud">\n  <div class="chip"><img class="ico" src="assets/event/pearl.png" alt="points" data-i18n-alt="event.alt_points"> <span id="ev-score">0</span></div>\n  <div class="chip"><img class="ico" src="assets/event/fish1.png" alt="goal" data-i18n-alt="event.alt_goal"> <span id="ev-target">5.000</span></div>\n  <div class="chip"><img class="ico" src="assets/event/leaf.png" alt="level" data-i18n-alt="event.alt_level"> <span id="ev-level">Lv 1</span></div>\n</div>\n<div id="ev-progress-wrap"><div id="ev-progress-label"></div><div id="ev-progress-bar"><div id="ev-progress-fill"></div></div></div>\n<div id="ev-board"><div id="ev-fx"></div></div>\n<div id="ev-legend">\n  <div class="leg"><img class="ico" src="assets/event/pearl.png" alt="pearl" data-i18n-alt="event.alt_pearl"> <span data-i18n="event.leg_boom">= big explosion</span></div>\n  <div class="leg"><img class="ico" src="assets/event/tadpole.png" alt="tadpole" data-i18n-alt="event.alt_tadpole"> <span data-i18n="event.leg_swarm">= swarm clears pieces</span></div>\n  <div class="leg"><span class="ico spr spr-rock" style="display:inline-block"></span> <span data-i18n="event.leg_rock">= only the pearl breaks it (Lv 5+)</span></div>\n  <div class="leg" data-i18n="event.leg_how">Tap 2 neighboring pieces to swap</div>\n</div>\n<div id="ev-toast"></div>\n<div id="ev-overlay"><div class="card" id="ev-card"></div></div>';
  board = R.querySelector("#ev-board"); fx = R.querySelector("#ev-fx");
  $score = R.querySelector("#ev-score"); $level = R.querySelector("#ev-level");
  $target = R.querySelector("#ev-target"); $plabel = R.querySelector("#ev-progress-label");
  $fill = R.querySelector("#ev-progress-fill");
  if (typeof I18N !== "undefined") I18N.applyI18n(R);
  score = 0; level = 0; moves = 0; busy = false; over = false;
  selected = null; grid = []; rocks = []; rocksPlaced = false; _lastSig = "";
  document.addEventListener("visibilitychange", onHideSave);
  window.addEventListener("pagehide", onHideSave);
  const _save = await loadProgress();
  const _has = !!(_save && _save.score > 0);
  const _runs = (_save && _save.runs_claimed) || 0;
  const _max = (_save && _save.max_runs) || 1;
  const _done = _runs >= _max;            // both Maple Bettas claimed
  const _second = !_done && _runs > 0;     // on the second (last) run
  R.querySelector("#ev-card").innerHTML = `
  <h2><span class="ico big spr spr-leaf"></span> Autumn Crush</h2>
  <p>${t("event.intro_1")}<br>
  <span class="ico spr spr-pearl"></span> ${t("event.intro_pearl")}<br>
  <span class="ico spr spr-tadpole"></span> ${t("event.intro_tadpole")}<br>
  <span class="ico spr spr-rock"></span> ${t("event.intro_rocks")}</p>
  <p>${t("event.levels")}<br>
  ${t("event.unlock_line")}</p>
  ${_done ? `<p style="font-size:13px">${t("event.done_card")}</p>`
    : _second && !_has ? `<p style="font-size:13px">${t("event.second_chance")}</p>`
    : _second ? `<p style="font-size:13px">${t("event.last_chance_card")}</p>` : ``}
  ${_done ? `` : _has ? `<button class="btn" id="ev-continue-btn">${t("event.continue")}</button>` : `<button class="btn" id="ev-start-btn">${_second ? t("event.start_over") : t("event.start")}</button>`}`;
  updateHud();
  if (_has) R.querySelector("#ev-continue-btn").onclick = () => {
    score = _save.score; level = _save.level; moves = _save.moves;
    R.querySelector("#ev-overlay").classList.add("hidden");
    buildBoard(); updateHud();
    if (level >= 4) { placeRocks(); rocksPlaced = true; }
    toast(t("event.welcome_back", { n: level + 1 }));
  };
  const _startBtn = R.querySelector("#ev-start-btn");
  if (_startBtn) _startBtn.onclick = () => { startFreshRun(); };
}

function unmount() {
  document.removeEventListener("visibilitychange", onHideSave);
  window.removeEventListener("pagehide", onHideSave);
  over = true; busy = false;
  if (R) R.innerHTML = "";
  R = null; board = null; fx = null;
}
return { mount, unmount, isMounted: () => !!R };
})();
window.EventCrush = EventCrush;
