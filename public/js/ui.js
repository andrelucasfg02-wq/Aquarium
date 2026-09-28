/* ui.js — DOM screens: shops, breeding, collection, inventory, quests, settings, minigame */
"use strict";

const UI = (() => {
  const $ = (id) => document.getElementById(id);
  let state = null;
  let fishCatalog = null;   // [{species_id,name,group,rarity,price_coins,price_gems,desc}]
  let decorCatalog = null;  // [{id,name,file,price}]
  let eggTimer = null;

  function toast(msg, ms) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }

  function updateHUD(st) {
    state = st;
    const w = st.wallets, u = st.user;
    $("hud-player").textContent = `😊 ${u.name || "Player"}`;
    $("hud-level").textContent = `⭐ ${w.level || 1}`;
    $("hud-coins").textContent = `🪙 ${fmtCoins(w.coins)}`;
    $("hud-gems").textContent = `💎 ${fmtCoins(w.gems)}`;
    $("hud-food").textContent = `🍤 ${fmtCoins(w.food)}`;
    const filt = $("btn-filter");
    if (st.dirt.green) { filt.classList.remove("hidden"); filt.textContent = `🫧 Filtrar (${DATA.FILTER_PRICE})`; }
    else filt.classList.add("hidden");
    renderTankTabs();
  }

  /* ---------- tank quick-switch tabs (home screen) ---------- */
  const TANK_LABELS = { small: "🥣 Small", medium: "🪣 Medium", large: "🌊 Large" };
  function renderTankTabs() {
    const bar = $("tank-tabs");
    if (!bar || !state || !state.tanks) return;
    const owned = state.tanks.owned || [], active = state.tanks.active;
    if (owned.length < 2) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = owned.map((t) =>
      `<button class="tank-tab${t === active ? " active" : ""}" data-tanktab="${t}">${TANK_LABELS[t] || t}</button>`
    ).join("");
    bar.querySelectorAll("[data-tanktab]").forEach((b) => b.onclick = async () => {
      if (b.dataset.tanktab === state.tanks.active) return;
      const r = await Api.switchTank(b.dataset.tanktab);
      if (r.ok) { toast("Switched tank 🏠"); await App.refresh(); }
      else { AudioFX.error(); toast(r.error || "Couldn't switch"); }
    });
  }

  /* ---------- fish tap menu: Pet / Transfer / Breed ---------- */
  function openFishMenu(fish) {
    closeFishMenu();
    const overlay = document.createElement("div");
    overlay.id = "fish-menu-overlay";
    overlay.innerHTML = `
      <div class="fish-menu">
        <div class="fish-menu-head">${fishImg(fish.species_id)}
          <div><b>${esc(fish.nickname || fish.name || speciesName(fish.species_id))}</b>
          <div class="sub">${fish.gender === "male" ? "♂" : "♀"} ${esc(speciesName(fish.species_id))}</div></div>
          <button class="hud-btn" id="fish-menu-x">✕</button>
        </div>
        <div class="fish-menu-btns">
          <button class="pill-btn pink" id="fm-pet">💕 Pet</button>
          <button class="pill-btn blue" id="fm-transfer">🔀 Transfer</button>
          <button class="pill-btn" id="fm-breed">🥚 Breed</button>
        </div>
        <div class="fish-menu-btns">
          <button class="pill-btn gold" id="fm-rename">✏️ Name (💎${DATA.RENAME_GEMS})</button>
        </div>
        <div id="fm-transfer-row" class="fish-menu-btns" hidden></div>
        <div id="fm-rename-row" class="fish-menu-btns" hidden>
          <input id="fm-rename-input" maxlength="20" placeholder="Pet name..."
            style="flex:2;padding:10px;border-radius:12px;border:2px solid var(--pink-d)" />
          <button class="pill-btn gold" id="fm-rename-ok">OK 💎${DATA.RENAME_GEMS}</button>
        </div>
      </div>`;
    overlay.onclick = (e) => { if (e.target === overlay) closeFishMenu(); };
    document.body.appendChild(overlay);
    $("fish-menu-x").onclick = closeFishMenu;
    $("fm-pet").onclick = async () => { closeFishMenu(); await App.petFish(fish.id); };
    $("fm-breed").onclick = () => { closeFishMenu(); openBreedingWith(fish); };
    $("fm-rename").onclick = () => {
      const row = $("fm-rename-row");
      row.hidden = !row.hidden;
      const inp = $("fm-rename-input");
      inp.value = fish.nickname || "";
      if (!row.hidden) inp.focus();
    };
    $("fm-rename-ok").onclick = async () => {
      const name = $("fm-rename-input").value.trim();
      if (!name) { toast("Type a name first ✏️"); return; }
      const r = await Api.renameFish(fish.id, name);
      if (r.ok) {
        AudioFX.coin(); toast(`"${r.nickname}" — what a cute name! 💎`);
        closeFishMenu(); await App.refresh();
      } else {
        AudioFX.error();
        toast(r.error === "not enough gems" ? "Not enough diamonds 💎" : (r.error || "Couldn't rename"));
      }
    };
    $("fm-transfer").onclick = () => {
      const row = $("fm-transfer-row");
      const owned = (state.tanks.owned || []).filter((t) => t !== fish.tank);
      if (!owned.length) { toast("No other tank owned yet 🏠"); return; }
      row.hidden = false;
      row.innerHTML = owned.map((t) =>
        `<button class="pill-btn blue" data-fmto="${t}">→ ${TANK_LABELS[t] || t}</button>`).join("");
      row.querySelectorAll("[data-fmto]").forEach((b) => b.onclick = async () => {
        b.disabled = true;
        const r = await Api.transferFish(fish.id, b.dataset.fmto);
        if (r.ok) { AudioFX.coin(); toast(`Moved to the ${b.dataset.fmto} tank 🔀🐠`); }
        else { AudioFX.error(); toast(r.error || "Couldn't transfer"); }
        closeFishMenu();
        await App.refresh();
      });
    };
  }
  function closeFishMenu() { const o = $("fish-menu-overlay"); if (o) o.remove(); }

  async function openBreedingWith(fish) {
    const tf = (state.fish || []).filter((f) =>
      f.tank === state.tanks.active && (!f.location || f.location === "tank"));
    const f = tf.find((x) => x.id === fish.id) || fish;
    if (f.gender === "male") {
      breedMale = f; breedFemale = null; partners = null; partnersFor = null;
      const r = await Api.breedingPartners(f.id);
      if (r.ok) { partners = r.partners; partnersFor = f.id; }
    } else {
      breedFemale = f; breedMale = null; partners = null; partnersFor = null;
    }
    open("breeding");
  }

  function open(name) {
    close(true);
    $("screen-title").textContent = TITLES[name] || name;
    $("screen-overlay").hidden = false;
    RENDER[name]();
  }
  function close(silent) {
    $("screen-overlay").hidden = true;
    $("screen-body").innerHTML = "";
    if (eggTimer) { clearInterval(eggTimer); eggTimer = null; }
    if (!silent && window.App) App.onScreenClosed();
  }
  const TITLES = {
    fishshop: "🐟 Fish Shop", decor: "🪸 Decoration Shop", breeding: "🥚 Breeding",
    collection: "📖 Collection", inventory: "🎒 Inventory", quests: "🎯 Quests",
    settings: "⚙️ Settings", minigame: "🎮 Tap-the-Fish",
  };

  /* ---------- helpers ---------- */
  function fishImg(speciesId, frame) {
    return `<img class="fish-prev" src="${esc(spriteURL(speciesId, frame || 0))}" alt="" loading="lazy">`;
  }
  function tankFish() {
    const active = state.tanks.active;
    return (state.fish || []).filter((f) => f.tank === active && (!f.location || f.location === "tank"));
  }
  function priceLabel(item) {
    if (item.price_gems) return `💎${item.price_gems} <span class="sub">or</span> 🪙${fmtCoins(item.price_coins)}`;
    return `🪙 ${fmtCoins(item.price_coins)}`;
  }

  /* ================= FISH SHOP ================= */
  async function renderFishShop() {
    const body = $("screen-body");
    if (!fishCatalog) {
      body.innerHTML = `<div class="empty">Loading… 🫧</div>`;
      const r = await Api.fishCatalog();
      if (r.ok) fishCatalog = r.items;
    }
    const items = fishCatalog || Object.keys(DATA.SPECIES).map((id) => ({
      species_id: id, name: speciesName(id), group: speciesGroup(id),
      price_coins: (DATA.SPECIES[id] || {}).price || 0,
      price_gems: (DATA.SPECIES[id] || {}).priceGems || 0,
    }));
    const tf = tankFish();
    const owned = state.tanks.owned, active = state.tanks.active;

    let tanksHtml = `<h3>🏠 Tanks</h3>`;
    for (const [tier, T] of Object.entries(DATA.TANKS)) {
      const isOwned = owned.includes(tier), isActive = active === tier;
      const need = tier === "large" && !owned.includes("medium");
      tanksHtml += `<div class="row-card"><div class="grow">
        <b style="text-transform:capitalize">${tier}</b>
        <div class="sub">🐟 ${T.capacity} fish · 🪸 ${T.decorSlots} decor</div></div>
        ${isActive ? `<span class="tag">active</span>`
          : isOwned ? `<button class="pill-btn blue" data-switch="${tier}">Use</button>`
          : `<button class="pill-btn" data-buytank="${tier}" ${need ? "disabled" : ""}>🪙 ${fmtCoins(T.price)}</button>`}
      </div>`;
      if (need) tanksHtml += `<div class="sub" style="margin:-4px 0 8px">Needs Medium first</div>`;
    }

    let html = `${tanksHtml}
      <h3>🐟 Fish <span class="tag">${tf.length}/${DATA.TANKS[active].capacity} in ${active} tank</span></h3>
      <div class="grid2">`;
    for (const it of items) {
      const sp = DATA.SPECIES[it.species_id] || {};
      html += `<div class="card">${fishImg(it.species_id)}
        <div class="nm">${esc(it.name)}</div>
        <div class="sub">${esc(it.group)}${it.species_id === "female_betta" ? " · ♀ always" : ""}</div>
        <div class="price">${priceLabel(it)}</div>
        <button class="pill-btn pink" data-buyfish="${esc(it.species_id)}">Buy</button>
      </div>`;
    }
    html += `</div><div class="empty">Sell fish from the Collection tab 💰</div>`;
    body.innerHTML = html;

    body.querySelectorAll("[data-buyfish]").forEach((b) => b.onclick = async () => {
      b.disabled = true;
      const r = await Api.buyFish(b.dataset.buyfish);
      if (r.ok) { AudioFX.coin(); toast(`Welcome, ${esc(r.fish.name || "little fish")}! 🐠`); }
      else { AudioFX.error(); toast(r.error || "Couldn't buy"); }
      await App.refresh();
      renderFishShop();
    });
    body.querySelectorAll("[data-buytank]").forEach((b) => b.onclick = async () => {
      const r = await Api.buyTank(b.dataset.buytank);
      if (r.ok) { AudioFX.coin(); toast("Tank upgraded! 🏠✨"); }
      else { AudioFX.error(); toast(r.error || "Couldn't buy tank"); }
      await App.refresh(); renderFishShop();
    });
    body.querySelectorAll("[data-switch]").forEach((b) => b.onclick = async () => {
      const r = await Api.switchTank(b.dataset.switch);
      if (r.ok) toast("Tank switched 🏠");
      else toast(r.error || "Couldn't switch");
      await App.refresh(); close();
    });
  }

  /* ================= DECOR SHOP ================= */
  async function renderDecorShop(filter) {
    const body = $("screen-body");
    if (!decorCatalog) {
      body.innerHTML = `<div class="empty">Loading… 🫧</div>`;
      const r = await Api.decorCatalog();
      if (r.ok) { decorCatalog = r.items; App.setDecoCatalog(r.items); }
    }
    const items = decorCatalog || [];
    const ownedMap = {};
    for (const o of (state.decor_owned || [])) ownedMap[o.deco_id] = o.qty;
    const q = (filter || "").toLowerCase();
    const list = items.filter((it) => !q || it.name.toLowerCase().includes(q));

    let html = `<input class="search" id="decor-search" placeholder="🔍 Search 93 decorations…" value="${esc(filter || "")}">
      <h3>🪸 Decorations <span class="tag">${state.placements.filter((p) => p.tank === state.tanks.active).length}/${DATA.TANKS[state.tanks.active].decorSlots} placed</span></h3>
      <div class="deco-grid">`;
    for (const it of list) {
      const qty = ownedMap[it.id] || 0;
      html += `<div class="deco-card">
        <img src="${esc(it.file)}" alt="" loading="lazy">
        <div class="nm">${esc(it.name)}</div>
        <div class="price">🪙 ${fmtCoins(it.price)}</div>
        <button class="pill-btn pink" data-buydeco="${esc(it.id)}">Buy</button>
        ${qty ? `<button class="pill-btn blue" data-placedeco="${esc(it.id)}">Place (${qty})</button>` : ""}
      </div>`;
    }
    html += `</div>`;
    if (!list.length) html += `<div class="empty">No decorations match 🔍</div>`;
    body.innerHTML = html;

    const si = $("decor-search");
    si.oninput = () => renderDecorShop(si.value);
    // keep focus after re-render
    si.focus(); si.setSelectionRange(si.value.length, si.value.length);

    body.querySelectorAll("[data-buydeco]").forEach((b) => b.onclick = async () => {
      const r = await Api.buyDecor(b.dataset.buydeco);
      if (r.ok) { AudioFX.coin(); toast("Decoration bought! 🪸"); }
      else { AudioFX.error(); toast(r.error || "Couldn't buy"); }
      await App.refresh(); renderDecorShop($("decor-search") ? $("decor-search").value : "");
    });
    body.querySelectorAll("[data-placedeco]").forEach((b) => b.onclick = () => {
      close(); App.beginPlace(b.dataset.placedeco);
    });
  }

  /* ================= BREEDING ================= */
  let breedMale = null, breedFemale = null, partners = null, partnersFor = null;
  async function renderBreeding() {
    const body = $("screen-body");
    const tf = tankFish();
    breedMale = breedMale && tf.find((f) => f.id === breedMale.id) ? breedMale : null;
    breedFemale = breedFemale && tf.find((f) => f.id === breedFemale.id) ? breedFemale : null;

    const pickRow = (list, sel, cls, title) => `
      <h3>${title}</h3><div class="fish-pick">
      ${list.map((f) => `
        <div class="pick ${sel && sel.id === f.id ? "sel" : ""}" data-pick="${cls}" data-id="${f.id}">
          ${fishImg(f.species_id)}
          <div><b>${esc(f.name || speciesName(f.species_id))}</b></div>
          <div class="sub">${f.gender === "male" ? "♂" : "♀"} ${esc(speciesName(f.species_id))}</div>
        </div>`).join("") || `<div class="empty">No fish in this tank yet 🐠</div>`}
      </div>`;

    let html = `
      <div class="sub" style="margin-bottom:6px">Breeding costs 💎${DATA.BREED_GEMS}. Babies hatch from eggs below ⏳</div>
      ${pickRow(tf.filter((f) => f.gender === "male"), breedMale, "m", "♂ Choose father")}
      ${pickRow(partners || tf.filter((f) => f.gender === "female"), breedFemale, "f", "♀ Choose mother")}
      <div id="breed-msg" class="sub" style="margin:6px 0"></div>
      <button class="pill-btn pink" id="btn-do-breed" style="width:100%;padding:13px"
        ${breedMale && breedFemale ? "" : "disabled"}>💕 Breed (💎${DATA.BREED_GEMS})</button>
      <h3>🥚 Egg nursery</h3>
      <div id="egg-list">${eggListHtml()}</div>`;
    body.innerHTML = html;

    body.querySelectorAll("[data-pick]").forEach((el) => el.onclick = async () => {
      const id = +el.dataset.id;
      const f = tf.find((x) => x.id === id);
      if (el.dataset.pick === "m") {
        breedMale = f; breedFemale = null; partners = null;
        if (f) {
          const r = await Api.breedingPartners(f.id);
          if (r.ok) { partners = r.partners; partnersFor = f.id; }
        }
      } else breedFemale = f;
      renderBreeding();
    });

    $("btn-do-breed").onclick = async () => {
      if (!breedMale || !breedFemale) return;
      const btn = $("btn-do-breed"); btn.disabled = true;
      const r = await Api.breed(breedMale.id, breedFemale.id);
      if (r.ok) {
        AudioFX.coin(); toast("🥚 Egg laid! Check the nursery ⏳");
        breedMale = breedFemale = null; partners = null;
      } else {
        AudioFX.error();
        $("breed-msg").textContent = r.error || "These species can't breed together";
        toast(r.error || "These species can't breed together");
      }
      await App.refresh(); renderBreeding();
    };

    startEggTimer();
  }
  function eggListHtml() {
    const eggs = state.eggs || [];
    if (!eggs.length) return `<div class="empty">No eggs yet — breed two fish to start 🥚</div>`;
    return eggs.map((e) => `
      <div class="row-card egg-card"><div class="grow">
        <b>🥚 ${esc(speciesName(e.variant_a) || e.group)} ${e.hybrid ? '<span class="tag hybrid">hybrid</span>' : ""}</b>
        <div class="lineage">gen ${e.generation || 1} · ${esc(speciesName(e.variant_a) || "")} × ${esc(speciesName(e.variant_b) || "")}</div>
      </div><div class="countdown" data-hatch="${e.hatch_at * 1000}">…</div></div>`).join("");
  }
  function startEggTimer() {
    if (eggTimer) clearInterval(eggTimer);
    const tick = () => {
      let anyExpired = false;
      document.querySelectorAll("[data-hatch]").forEach((el) => {
        const left = +el.dataset.hatch - Date.now();
        el.textContent = "⏳ " + fmtCountdown(left);
        if (left <= 0) anyExpired = true;
      });
      if (anyExpired) {
        clearInterval(eggTimer); eggTimer = null;
        setTimeout(async () => { await App.refresh(); renderBreeding(); toast("🐣 An egg hatched!"); }, 2500);
      }
    };
    tick();
    eggTimer = setInterval(tick, 1000);
  }

  /* ================= COLLECTION ================= */
  function renderCollection() {
    const body = $("screen-body");
    const seen = {};
    for (const c of (state.collection || [])) seen[c.species_id] = c;
    let html = `<h3>📖 Species log</h3><div class="grid2">`;
    for (const [id, sp] of Object.entries(DATA.SPECIES)) {
      const c = seen[id];
      html += `<div class="card" style="${c ? "" : "opacity:.45;filter:grayscale(.8)"}">
        ${c ? fishImg(id) : `<div style="font-size:40px">❓</div>`}
        <div class="nm">${c ? esc(sp.name) : "???"}</div>
        <div class="sub">${esc(sp.group)}${c ? ` · seen ×${c.count}` : " · not seen"}</div>
      </div>`;
    }
    html += `</div><h3>🧬 Lineage</h3>`;
    const bred = (state.fish || []).filter((f) => f.lineage && (f.lineage.mother || f.lineage.father || f.lineage.hybrid));
    html += bred.length ? bred.map((f) => {
      const L = f.lineage;
      return `<div class="row-card"><div class="grow">
        <b>${esc(f.name || speciesName(f.species_id))}</b>
        ${L.hybrid ? ' <span class="tag hybrid">hybrid</span>' : ""}
        <div class="lineage">♂ ${esc(L.father || "?")} × ♀ ${esc(L.mother || "?")} · gen ${L.generation || 1}</div>
      </div>
      <button class="pill-btn" data-sell="${f.id}">Sell</button></div>`;
    }).join("") : `<div class="empty">No bred fish yet — lineage appears here 🧬</div>`;

    html += `<h3>🐠 My fish (tap to sell)</h3>`;
    html += (state.fish || []).map((f) => `
      <div class="row-card">${fishImg(f.species_id)}<div class="grow">
        <b>${esc(f.nickname || f.name || speciesName(f.species_id))}</b>
        <div class="sub">${f.gender === "male" ? "♂" : "♀"} · ${esc(f.stage || "adult")} · ${f.location === "inventory" ? "🎒 inventory" : "🏠 " + esc(f.tank || "")} tank</div>
      </div><button class="pill-btn" data-sell="${f.id}">Sell</button></div>`).join("")
      || `<div class="empty">No fish yet</div>`;
    body.innerHTML = html;
    body.querySelectorAll("[data-sell]").forEach((b) => b.onclick = async () => {
      if (!confirm("Sell this fish? 💰")) return;
      const r = await Api.sellFish(+b.dataset.sell);
      if (r.ok) { AudioFX.coin(); toast(`Sold for 🪙${fmtCoins(r.coins)}`); }
      else toast(r.error || "Couldn't sell");
      await App.refresh(); renderCollection();
    });
  }

  /* ================= INVENTORY ================= */
  function renderInventory() {
    const body = $("screen-body");
    const w = state.wallets;
    const owned = state.decor_owned || [];
    let html = `
      <h3>🍤 Food <span class="tag">${fmtCoins(w.food)}</span></h3>
      <div class="row-card"><div class="grow"><b>Fish food</b>
        <div class="sub">🪙 ${DATA.FOOD_PRICE} each · feeding drops ≥1 pellet per fish</div></div>
        <button class="pill-btn" data-food="1">+1</button>
        <button class="pill-btn" data-food="5">+5</button>
        <button class="pill-btn" data-food="10">+10</button>
      </div>
      <h3>🪸 Decorations owned</h3>`;
    if (!owned.length) html += `<div class="empty">No decorations yet — visit the Decor shop 🪸</div>`;
    for (const o of owned) {
      const it = (decorCatalog || []).find((d) => d.id === o.deco_id);
      const nm = it ? it.name : o.deco_id, file = it ? it.file : "";
      html += `<div class="row-card">
        ${file ? `<img src="${esc(file)}" style="width:56px;height:44px;object-fit:contain" alt="">` : ""}
        <div class="grow"><b>${esc(nm)}</b><div class="sub">×${o.qty}</div></div>
        <button class="pill-btn blue" data-placeinv="${esc(o.deco_id)}">Place in tank</button>
      </div>`;
    }
    body.innerHTML = html;
    body.querySelectorAll("[data-food]").forEach((b) => b.onclick = async () => {
      const r = await Api.buyFood(+b.dataset.food);
      if (r.ok) { AudioFX.coin(); toast(`+${b.dataset.food} food 🍤`); }
      else { AudioFX.error(); toast(r.error || "Couldn't buy food"); }
      await App.refresh(); renderInventory();
    });
    body.querySelectorAll("[data-placeinv]").forEach((b) => b.onclick = () => {
      close(); App.beginPlace(b.dataset.placeinv);
    });
  }

  /* ================= QUESTS ================= */
  function renderQuests() {
    const body = $("screen-body");
    const qs = state.quests || [];
    let html = `<div class="sub" style="margin-bottom:8px">Daily quests reset at midnight UTC · weekly on Mondays 🎯</div>`;
    const groups = [["daily", "☀️ Daily"], ["weekly", "📅 Weekly"]];
    for (const [period, label] of groups) {
      html += `<h3>${label}</h3>`;
      const list = qs.filter((q) => q.period === period);
      if (!list.length) html += `<div class="empty">No ${period} quests right now</div>`;
      for (const q of list) {
        const pct = Math.min(100, Math.round((q.progress / Math.max(1, q.target)) * 100));
        const done = q.progress >= q.target;
        html += `<div class="row-card ${q.claimed ? "quest-done" : ""}"><div class="grow">
          <b>${esc(q.title)}</b>
          <div class="sub">${esc(q.desc || "")}</div>
          <div class="progress"><i style="width:${pct}%"></i></div>
          <div class="sub">${q.progress}/${q.target}${q.reward_coins ? ` · 🪙${q.reward_coins}` : ""}${q.reward_gems ? ` · 💎${q.reward_gems}` : ""}</div>
        </div>
        ${q.claimed ? `<span class="tag">claimed ✓</span>`
          : done ? `<button class="pill-btn pink" data-claim="${esc(q.id)}">Claim</button>`
          : `<span class="tag">${pct}%</span>`}
        </div>`;
      }
    }
    html += `<button class="pill-btn blue" id="btn-play-mg2" style="width:100%;padding:13px;margin-top:10px">🎮 Play minigame</button>`;
    body.innerHTML = html;
    body.querySelectorAll("[data-claim]").forEach((b) => b.onclick = async () => {
      const r = await Api.claimQuest(b.dataset.claim);
      if (r.ok) { AudioFX.coin(); toast(`Quest complete! 🪙${fmtCoins(r.coins || 0)}${r.gems ? ` 💎${r.gems}` : ""}`); }
      else toast(r.error || "Couldn't claim");
      await App.refresh(); renderQuests();
    });
    $("btn-play-mg2").onclick = () => open("minigame");
  }

  /* ================= SETTINGS ================= */
  function renderSettings() {
    const body = $("screen-body");
    const s = state.settings || { music: false, sfx: true, quality: "high" };
    body.innerHTML = `
      <div class="toggle-row"><div><b>🎵 Music</b><div class="sub">gentle underwater pad</div></div>
        <button class="switch ${s.music ? "on" : ""}" data-set="music"></button></div>
      <div class="toggle-row"><div><b>🔔 Sound effects</b><div class="sub">pops, munches, coins</div></div>
        <button class="switch ${s.sfx ? "on" : ""}" data-set="sfx"></button></div>
      <div class="toggle-row" style="border:none"><div><b>✨ Graphics quality</b><div class="sub">lower = smoother on old phones</div></div></div>
      <select class="sel" id="set-quality">
        <option value="high" ${s.quality === "high" ? "selected" : ""}>High</option>
        <option value="medium" ${s.quality === "medium" ? "selected" : ""}>Medium</option>
        <option value="low" ${s.quality === "low" ? "selected" : ""}>Low</option>
      </select>
      <h3>👤 Account</h3>
      <div class="row-card"><div class="grow"><b>${esc(state.user.name)}</b><div class="sub">${esc(state.user.email)}</div></div></div>
      <button class="pill-btn" id="btn-logout" style="width:100%;padding:13px;background:linear-gradient(135deg,#e08a9b,#c05a7a)">🚪 Log out</button>
      <div class="empty">Chibi Aquarium · hand-drawn-style 2D sprite art 🐠<br>No accounts are shared · your tank is yours alone</div>
    `;
    const save = async () => {
      const music = body.querySelector('[data-set="music"]').classList.contains("on");
      const sfx = body.querySelector('[data-set="sfx"]').classList.contains("on");
      const quality = $("set-quality").value;
      await Api.saveSettings(music, sfx, quality);
      App.applySettings({ music, sfx, quality });
      await App.refresh();
    };
    body.querySelectorAll("[data-set]").forEach((sw) => sw.onclick = async () => {
      sw.classList.toggle("on"); AudioFX.unlock(); await save();
    });
    $("set-quality").onchange = save;
    $("btn-logout").onclick = async () => {
      await Api.logout();
      location.reload();
    };
  }

  /* ================= MINIGAME ================= */
  const MG = { round: 0, times: [], shownAt: 0, timer: null, active: false };
  function renderMinigame() {
    const body = $("screen-body");
    MG.round = 0; MG.times = []; MG.active = false;
    body.innerHTML = `
      <div class="sub" style="margin-bottom:8px">A fish pops up — tap it as fast as you can! 8 rounds ⚡</div>
      <div class="mg-hud"><span>Round <b id="mg-round">0</b>/8</span><span id="mg-last"></span></div>
      <div id="mg-stage"><img id="mg-fish" alt="🐟"></div>
      <div class="big-score" id="mg-result"></div>
      <button class="pill-btn pink" id="mg-start" style="width:100%;padding:13px">▶ Start</button>`;
    const stage = $("mg-stage"), fish = $("mg-fish");
    const species = ["sakura_goldfish", "azure_tang", "ember_clownfish", "fullmoon_betta", "red_shrimp"];

    function nextRound() {
      if (MG.round >= 8) return finish();
      MG.round++;
      $("mg-round").textContent = MG.round;
      fish.src = spriteURL(species[Math.floor(Math.random() * species.length)], 2);
      const r = stage.getBoundingClientRect();
      fish.style.left = (12 + Math.random() * 76) + "%";
      fish.style.top = (14 + Math.random() * 72) + "%";
      fish.style.display = "block";
      // random delay before it becomes tappable (reaction!)
      fish.style.opacity = ".35"; fish.style.pointerEvents = "none";
      clearTimeout(MG.timer);
      MG.timer = setTimeout(() => {
        fish.style.opacity = "1"; fish.style.pointerEvents = "auto";
        MG.shownAt = performance.now(); AudioFX.pop();
      }, 400 + Math.random() * 1200);
    }
    fish.onclick = () => {
      if (!MG.active || fish.style.pointerEvents !== "auto") return;
      const ms = performance.now() - MG.shownAt;
      MG.times.push(ms);
      $("mg-last").textContent = `${Math.round(ms)}ms ⚡`;
      AudioFX.munch();
      fish.style.display = "none";
      setTimeout(nextRound, 350);
    };
    async function finish() {
      MG.active = false;
      const avg = MG.times.reduce((a, b) => a + b, 0) / Math.max(1, MG.times.length);
      const score = Math.max(5, Math.min(100, Math.round(110 - avg / 12)));
      $("mg-result").innerHTML = `⚡ Avg ${Math.round(avg)}ms<br>Score: <b>${score}</b>/100`;
      $("mg-start").textContent = "↻ Play again";
      const r = await Api.minigameFinish(score);
      if (r.ok) {
        AudioFX.coin();
        $("mg-result").innerHTML += `<br><span class="tag">+🪙${fmtCoins(r.coins)} coins!</span>`;
        toast(`+🪙${fmtCoins(r.coins)} from the minigame! 🎮`);
      } else toast(r.error || "Score not saved");
      await App.refresh();
    }
    $("mg-start").onclick = () => {
      MG.active = true; MG.round = 0; MG.times = [];
      $("mg-result").innerHTML = ""; $("mg-last").textContent = "";
      $("mg-start").style.display = "none";
      nextRound();
    };
  }

  const RENDER = {
    fishshop: renderFishShop, decor: renderDecorShop, breeding: renderBreeding,
    collection: renderCollection, inventory: renderInventory, quests: renderQuests,
    settings: renderSettings, minigame: renderMinigame,
  };

  return {
    toast, updateHUD, open, close,
    openFishMenu, closeFishMenu, openBreedingWith, renderTankTabs,
    setCatalogs(f, d) { fishCatalog = f; decorCatalog = d; },
    get decorCatalog() { return decorCatalog; },
    refreshCurrent() {
      if (!$("screen-overlay").hidden) {
        const t = $("screen-title").textContent;
        const name = Object.keys(TITLES).find((k) => TITLES[k] === t);
        if (name && RENDER[name]) RENDER[name]();
      }
    },
  };
})();
