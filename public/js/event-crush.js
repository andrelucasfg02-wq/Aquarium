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
  $level.textContent = "Nv " + (level + 1);
  $fill.style.width = Math.min(100, (score - base) / (target - base) * 100) + "%";
  $plabel.innerHTML = level === LEVELS.length - 1
    ? `N&iacute;vel ${LEVELS.length} &mdash; alcance <b>${fmt(target)}</b> e ganhe o <b>Peixe de Outono</b>!`
    : `N&iacute;vel ${level + 1} &mdash; alcance <b>${fmt(target)}</b> pontos!`;
}

function toast(msg) {
  const t = R.querySelector("#ev-toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 1800);
}

// ---- SAVE: progresso por conta, no servidor ----
const EVENT_ID = "autumn1";
let _lastSig = "";
function saveProgress() {
  if (over || typeof Api === "undefined") return;
  const sig = [score, level, moves].join("|");
  if (sig === _lastSig) return;
  _lastSig = sig;
  Api.eventSave(EVENT_ID, score, level, moves).catch(() => {});
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
  if (leveled) toast("Nível " + (level + 1) + "!");
  if (level >= 4 && !rocksPlaced) {
    rocksPlaced = true;
    placeRocks();
    setTimeout(() => toast("Pedras no caminho! Só a pérola quebra!"), 1300);
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
  const ar = +a.dataset.r, ac = +a.dataset.c, br = +b.dataset.r, bc = +b.dataset.c;
  swapCells(ar, ac, br, bc);
  await wait(240);
  const m = findMatches();
  if (!m.groups.length) { swapCells(ar, ac, br, bc); await wait(240); busy = false; return; }
  moves++;
  await resolveBoard();
  busy = false;
  checkLevel();
  if (!over && !anyMove()) { shuffleBoard(); }
}

function swapCells(ar, ac, br, bc) {
  const t = grid[ar][ac]; grid[ar][ac] = grid[br][bc]; grid[br][bc] = t;
  const ea = elAt(ar, ac), eb = elAt(br, bc);
  placeTok(ea, br, bc); placeTok(eb, ar, ac);
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
                const el = elAt(rr, c); placeTok(el, write, c);
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
            placeTok(el, rr - fresh, c);
            el.addEventListener("pointerdown", onTap);
            board.appendChild(el);
            requestAnimationFrame(() => requestAnimationFrame(() => {
              el.style.transition = "";
              el.classList.add("falling");
              placeTok(el, rr, c);
            }));
          }
          segEnd = r - 1;
        }
      }
    }
    await wait(320);
  }
}

async function endGame(win) {
  over = true;
  saveProgress();
  const card = R.querySelector("#ev-card");
  card.innerHTML = `
    <h2>Peixe Desbloqueado!</h2>
    <div id="ev-big-fish" class="spr spr-fish1"></div>
    <p><b>Peixe de Outono</b> &eacute; seu!<br>Voc&ecirc; fez <b>${fmt(score)}</b> pontos em ${moves} jogadas!</p>
    <button class="btn" id="ev-catch-btn">Guardar no invent&aacute;rio</button>
    <p id="ev-claim-msg" style="font-size:13px;min-height:18px"></p>`;
  R.querySelector("#ev-overlay").classList.remove("hidden");
  R.querySelector("#ev-catch-btn").onclick = async () => {
    const btn = R.querySelector("#ev-catch-btn");
    const msg = R.querySelector("#ev-claim-msg");
    btn.disabled = true; btn.textContent = "Guardando...";
    try {
      const r = await Api.eventClaim(EVENT_ID);
      if (r && r.ok) {
        msg.textContent = "Peixe de Outono na sua coleção! 🐟";
        btn.textContent = "Ver na coleção";
        btn.disabled = false;
        if (window.App) App.refresh();
        btn.onclick = () => { if (typeof UI !== "undefined") { UI.close(); UI.open("collection"); } };
      } else {
        msg.textContent = (r && r.error === "already claimed")
          ? "Você já tem o Peixe de Outono! 🐟"
          : ("Não foi possível guardar: " + ((r && r.error) || "tente de novo"));
        btn.disabled = false; btn.textContent = "Guardar no inventário";
      }
    } catch (e) {
      msg.textContent = "Sem conexão — tente de novo 🛜";
      btn.disabled = false; btn.textContent = "Guardar no inventário";
    }
  };
}

async function mount(root) {
  R = root;
  R.innerHTML = '<div id="ev-fish-layer"><div class="swim f1 spr-fish1"></div><div class="swim f2 spr-fish2"></div><div class="swim f3 spr-fish3"></div></div>\n<h1><img class="ico big" src="assets/event/leaf.png" alt="folha"> Autumn Crush</h1>\n<div class="sub">Evento de Outono &middot; Semana 1</div>\n<div id="ev-hud">\n  <div class="chip"><img class="ico" src="assets/event/pearl.png" alt="pontos"> <span id="ev-score">0</span></div>\n  <div class="chip"><img class="ico" src="assets/event/fish1.png" alt="meta"> <span id="ev-target">5.000</span></div>\n  <div class="chip"><img class="ico" src="assets/event/leaf.png" alt="nivel"> <span id="ev-level">Nv 1</span></div>\n</div>\n<div id="ev-progress-wrap"><div id="ev-progress-label"></div><div id="ev-progress-bar"><div id="ev-progress-fill"></div></div></div>\n<div id="ev-board"><div id="ev-fx"></div></div>\n<div id="ev-legend">\n  <div class="leg"><img class="ico" src="assets/event/pearl.png" alt="perola"> = explos&atilde;o grande</div>\n  <div class="leg"><img class="ico" src="assets/event/tadpole.png" alt="girino"> = enxame limpa pe&ccedil;as</div>\n  <div class="leg"><span class="ico spr spr-rock" style="display:inline-block"></span> = s&oacute; a p&eacute;rola quebra (Nv 5+)</div>\n  <div class="leg">Toque 2 pe&ccedil;as vizinhas para trocar</div>\n</div>\n<div id="ev-toast"></div>\n<div id="ev-overlay"><div class="card" id="ev-card"></div></div>';
  board = R.querySelector("#ev-board"); fx = R.querySelector("#ev-fx");
  $score = R.querySelector("#ev-score"); $level = R.querySelector("#ev-level");
  $target = R.querySelector("#ev-target"); $plabel = R.querySelector("#ev-progress-label");
  $fill = R.querySelector("#ev-progress-fill");
  score = 0; level = 0; moves = 0; busy = false; over = false;
  selected = null; grid = []; rocks = []; rocksPlaced = false; _lastSig = "";
  document.addEventListener("visibilitychange", onHideSave);
  window.addEventListener("pagehide", onHideSave);
  const _save = await loadProgress();
  const _has = !!(_save && _save.score > 0);
  R.querySelector("#ev-card").innerHTML = `
  <h2><span class="ico big spr spr-leaf"></span> Autumn Crush</h2>
  <p>Troque pe&ccedil;as vizinhas para fazer <b>3 ou mais iguais</b>.<br>
  <span class="ico spr spr-pearl"></span> <b>P&eacute;rola</b> = <b>explos&atilde;o grande</b>!<br>
  <span class="ico spr spr-tadpole"></span> <b>Girino</b> = <b>enxame</b> que limpa pe&ccedil;as aleat&oacute;rias!<br>
  <span class="ico spr spr-rock"></span> Do <b>Nv 5</b> em diante: <b>pedras</b> bloqueiam o caminho &mdash; s&oacute; a <b>p&eacute;rola</b> quebra!</p>
  <p>10 n&iacute;veis: <b>5k &rarr; 20k &rarr; 35k &rarr; 50k &rarr; 80k &rarr; 100k &rarr; 120k &rarr; 150k &rarr; 200k &rarr; 300k</b><br>
  e desbloqueie o <b>Peixe de Outono</b>!</p>
  ${_save && _save.claimed ? `<p style="font-size:13px">\uD83C\uDFC6 Voc&ecirc; j&aacute; garantiu o Peixe de Outono!</p>` : ``}
  ${_has ? `<button class="btn" id="ev-continue-btn">Continuar &mdash; Nv ${_save.level + 1} (${fmt(_save.score)} pts)</button>` : `<button class="btn" id="ev-start-btn">Come&ccedil;ar</button>`}`;
  updateHud();
  if (_has) R.querySelector("#ev-continue-btn").onclick = () => {
    score = _save.score; level = _save.level; moves = _save.moves;
    R.querySelector("#ev-overlay").classList.add("hidden");
    buildBoard(); updateHud();
    if (level >= 4) { placeRocks(); rocksPlaced = true; }
    toast("Bem-vindo de volta! Nv " + (level + 1));
  };
  const _startBtn = R.querySelector("#ev-start-btn");
  if (_startBtn) _startBtn.onclick = () => {
    score = 0; level = 0; moves = 0; over = false;
    R.querySelector("#ev-overlay").classList.add("hidden");
    buildBoard(); updateHud();
  };
}

function unmount() {
  document.removeEventListener("visibilitychange", onHideSave);
  window.removeEventListener("pagehide", onHideSave);
  over = true; busy = false;
  if (R) R.innerHTML = "";
  R = null; board = null; fx = null;
}
return { mount, unmount };
})();
window.EventCrush = EventCrush;
