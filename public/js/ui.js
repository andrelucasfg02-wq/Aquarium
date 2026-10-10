/* ui.js — DOM screens: shops, breeding, collection, inventory, quests, settings, minigame */
"use strict";

const UI = (() => {
  const $ = (id) => document.getElementById(id);
  let state = null;
  let fishCatalog = null;   // [{species_id,name,group,rarity,price_coins,price_gems,desc}]
  let decorCatalog = null;  // [{id,name,file,price}]
  let eggTimer = null;
  let currentScreen = null; // screen currently open (for refreshScreen)
  let invTab = "fishes";    // inventory tab: "fishes" | "furniture"
  let invFilter = "all";    // fishes filter: "all" | "tank" | "inventory"

  function toast(msg, ms) {
    const t = $("toast");
    t.innerHTML = msg;
    t.hidden = false;
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }

  function updateHUD(st) {
    state = st;
    const w = st.wallets, u = st.user;
    const hp = $("hud-player");
    if (u.avatar_url) {
      hp.innerHTML = `<img class="hud-av" src="${esc(u.avatar_url)}" alt=""> ${esc(u.name || t("hud.player"))}`;
    } else {
      hp.textContent = `😊 ${u.name || t("hud.player")}`;
    }
    hp.onclick = () => open("profile");
    hp.style.cursor = "pointer";
    $("hud-level").innerHTML = `<img class="hud-ic" src="assets/icons/icon_level.png" alt=""> ${w.level || 1}`;
    const setChip = (id, val) => { const el = $(id); const s = el && el.querySelector("span"); if (s) s.textContent = val; };
    setChip("hud-coins", fmtCoins(w.coins));
    setChip("hud-gems", fmtCoins(w.gems));
    setChip("hud-food", fmtCoins(w.food));
    const hf = $("hud-food");
    if (hf && !hf._foodBound) { hf._foodBound = true; hf.title = t("hud.buy_food"); hf.onclick = openFoodPop; }
    const filt = $("btn-filter");
    if (st.dirt.green) { filt.classList.remove("hidden"); filt.textContent = t("hud.filter_price", { price: DATA.FILTER_PRICE }); }
    else filt.classList.add("hidden");
    updateTankSwitcher();
  }

  /* ---------- tank switcher (table edge) ---------- */
  function updateTankSwitcher() {
    const sw = $("tank-switcher");
    if (!sw) return;
    const instances = (state.tanks && state.tanks.instances) || [{ tier: "small", num: 1 }];
    const active = (state.tanks && state.tanks.active) || "small";
    const activeNum = (state.tanks && state.tanks.activeNum) || 1;
    // Only show on home screen with multiple tanks
    const onHome = !$("screen-home") || !$("screen-home").hidden;
    if (!onHome || instances.length < 2) {
      sw.hidden = true;
      return;
    }
    sw.hidden = false;
    const T = DATA.TANKS[active];
    const name = tankName(active);
    // Show instance number if multiple of same tier (e.g., "Small 2")
    const tierCount = instances.filter((t) => t.tier === active).length;
    $("tank-name").textContent = tierCount > 1 ? `${name} ${activeNum}` : name;
    $("tank-cap").textContent = T ? T.capacity : "?";
  }

  /* ---------- tank names ---------- */
  function tankName(k) { const key = "tank." + k; const v = t(key); return v === key ? (k || "") : v; }
  const TANK_LABELS = { small: t("tank.small"), medium: t("tank.medium"), large: t("tank.large"), xl: t("tank.xl"), nursery: t("tank.nursery") };

  /* ---------- fish tap menu: status, feed, treat, pet / transfer / breed ---------- */
  function openFishMenu(fish) {
    closeFishMenu();
    const listed = fish.location === "market";
    const hunger = Math.max(0, Math.min(100, fish.hunger == null ? 100 : fish.hunger));
    const hColor = hunger >= 50 ? "#6fbf8f" : hunger >= 25 ? "#f2a54e" : "#e05d5d";
    const mood = fish.mood || "happy";
    const moodIcon = mood === "sick" ? `<img class="emo-ic" src="assets/icons/emote_sick.png" alt="">` : mood === "hungry" ? "😟" : "😊";
    const moodLabel = mood === "sick" ? t("fishmenu.sick") : mood === "hungry" ? t("fishmenu.hungry") : t("fishmenu.happy");
    const lvl = fish.level || 1;
    const stageLabel = fish.stage === "baby" ? t("fishmenu.baby") : fish.stage === "juvenile" ? t("fishmenu.teen") : t("fishmenu.adult");
    const growAt = fish.grow_level || 10;
    // coin farming reward text (diamonds for event fish)
    const gemAmt = fish.gem_pending || fish.gem_amount || 0;
    const rewardTxt = `+${fish.coin_amount || 0} ${CUR_GOLD}${gemAmt ? ` +${gemAmt} ${CUR_GEM}` : ""}`;
    const overlay = document.createElement("div");
    overlay.id = "fish-menu-overlay";
    overlay.innerHTML = `
      <div class="fish-menu">
        <div class="fish-menu-head">${fishImg(fish.species_id, 0, fish.gender)}
          <div><b>${esc(fish.nickname || fish.name || speciesName(fish.species_id))}</b>
          <div class="sub">${fish.gender === "male" ? "♂" : "♀"} ${esc(speciesName(fish.species_id))}</div></div>
          <button class="hud-btn" id="fish-menu-x">\u2715</button>
        </div>
        <div class="fish-stats">
          <div class="stat-row"><span>🍗 ${t("fishmenu.hunger")}</span>
            <div class="hbar"><i style="width:${hunger}%;background:${hColor}"></i></div>
            <b>${hunger}%</b></div>
          <div class="stat-row"><span>${moodIcon} ${t("fishmenu.mood")}</span><b>${moodLabel}</b></div>
          <div class="stat-row"><span><img class="ic-inline" src="assets/icons/icon_level.png" alt=""> ${t("fishmenu.level")}</span><b>${t("fishmenu.level_val", { lvl, stage: stageLabel })}</b></div>
          ${fish.stage !== "adult" ? `<div class="stat-row"><span>🌱 ${t("fishmenu.grows_at")}</span><b>${t("fishmenu.grows_val", { lvl: growAt })}</b></div>` : ""}
          ${fish.location === "tank" ? (fish.coin_pending > 0
            ? `<div class="stat-row"><span>${CUR_GOLD} ${t("fishmenu.coins")}</span><b>${t("fishmenu.coins_ready", { reward: rewardTxt })}</b></div>`
            : `<div class="stat-row"><span>${CUR_GOLD} ${t("fishmenu.coins")}</span><b id="fm-coin-cd">${t("fishmenu.coins_in", { reward: rewardTxt, time: fmtCd(fish.coin_in || 0) })}</b></div>`) : ""}
        </div>
        ${listed ? `
        <div class="fm-note">${t("fishmenu.listed_for", { price: fish.listing_price })}</div>
        <div class="fish-menu-btns">
          <button class="pill-btn" id="fm-mkcancel">\u274C ${t("fishmenu.cancel_listing")}</button>
        </div>` : `
        <div class="fish-menu-btns">
          <button class="pill-btn pink" id="fm-feed"><img class="btn-ic" src="assets/icons/icon_food.png" alt="">${t("fishmenu.feed")}</button>
          ${fish.sick ? `<button class="pill-btn gold" id="fm-treat"><img class="btn-ic" src="assets/icons/icon_medicine.png" alt=""> ${t("fishmenu.treat")}</button>` : ""}
        </div>
        <div id="fm-treat-row" class="fish-menu-btns" hidden>
          <button class="pill-btn gold" id="fm-treat-one"><img class="btn-ic" src="assets/icons/icon_medicine.png" alt="">${t("fishmenu.treat_single")} (${state.wallets.medicine || 0})</button>
          ${fish.location === "tank" ? `<button class="pill-btn pink" id="fm-treat-all"><img class="btn-ic" src="assets/icons/icon_cure_all.jpg" alt="" style="border-radius:6px">${t("fishmenu.treat_all")} · 💎 10</button>` : ""}
        </div>
        <div class="fish-menu-btns">
          <button class="pill-btn pink" id="fm-pet"><img class="btn-ic" src="assets/icons/icon_pet.png" alt="">${t("fishmenu.pet")}</button>
          <button class="pill-btn blue" id="fm-transfer">${fish.location === "inventory" ? "\uD83C\uDFE0 " + t("fishmenu.place_in_tank") : "\uD83D\uDD00 " + t("fishmenu.transfer")}</button>
          ${!(fish.lineage && fish.lineage.hybrid) ? `<button class="pill-btn" id="fm-breed"><img class="btn-ic" src="assets/icons/icon_nav_eggs.png" alt="">${t("fishmenu.breed")}</button>` : ""}
        </div>
        ${fish.tradeable ? `
        <div class="fish-menu-btns">
          <button class="pill-btn gold" id="fm-mksell">\uD83D\uDC8E ${t("fishmenu.sell_on_market")}</button>
        </div>
        <div id="fm-mkrow" class="fish-menu-btns" hidden>
          <input id="fm-mkprice" type="number" min="1" max="999999" placeholder="${t("fishmenu.price_ph")}"
            style="flex:2;padding:10px;border-radius:12px;border:2px solid var(--pink-d)" />
          <button class="pill-btn gold" id="fm-mkok">${t("fishmenu.list_btn")}</button>
        </div>` : `
        <div class="fm-note sub">${esc(fish.trade_lock || t("fishmenu.trade_lock"))}</div>`}`}
        <div class="fish-menu-btns">
          <button class="pill-btn gold" id="fm-rename"><img class="btn-ic" src="assets/icons/icon_edit.png" alt=""> ${t("fishmenu.rename", { gems: DATA.RENAME_GEMS })}</button>
        </div>
        <div id="fm-transfer-row" class="fish-menu-btns" hidden></div>
        <div id="fm-rename-row" class="fish-menu-btns" hidden>
          <input id="fm-rename-input" maxlength="20" placeholder="${t("fishmenu.petname_ph")}"
            style="flex:2;padding:10px;border-radius:12px;border:2px solid var(--pink-d)" />
          <button class="pill-btn gold" id="fm-rename-ok">${t("fishmenu.rename_ok", { gems: DATA.RENAME_GEMS })}</button>
        </div>
      </div>`;
    overlay.onclick = (e) => { if (e.target === overlay) closeFishMenu(); };
    document.body.appendChild(overlay);
    $("fish-menu-x").onclick = closeFishMenu;
    // live coin countdown while the menu is open
    if (fish.location === "tank" && !(fish.coin_pending > 0) && (fish.coin_in || 0) > 0) {
      let left = fish.coin_in;
      coinCdTimer = setInterval(() => {
        left -= 1;
        const el = $("fm-coin-cd");
        if (!el) { clearInterval(coinCdTimer); coinCdTimer = null; return; }
        if (left <= 0) {
          clearInterval(coinCdTimer); coinCdTimer = null;
          el.innerHTML = t("fishmenu.coins_ready", { reward: rewardTxt });
        } else {
          el.innerHTML = t("fishmenu.coins_in", { reward: rewardTxt, time: fmtCd(left) });
        }
      }, 1000);
    }
    if (listed) {
      $("fm-mkcancel").onclick = async () => {
        const r = await Api.marketCancel(fish.listing_id);
        if (r.ok) { AudioFX.coin(); toast(t("toast.listing_cancelled")); }
        else { AudioFX.error(); toast(r.error || t("toast.couldnt_cancel")); }
        closeFishMenu(); await App.refresh(); refreshScreen();
      };
    } else {
      const reopen = async () => {
        closeFishMenu(); await App.refresh(); refreshScreen();
        const nf = (state.fish || []).find((x) => x.id === fish.id);
        if (nf) openFishMenu(nf);
      };
      $("fm-feed").onclick = async () => {
        const r = await Api.feedOne(fish.id);
        if (r.ok) { AudioFX.munch(); toast(t("toast.yummy")); }
        else { AudioFX.error(); toast(r.error === "no food" ? t("toast.no_food") : r.error === "no special food" ? t("toast.no_special_food") : (r.error || t("toast.couldnt_feed"))); }
        await reopen();
      };
      const treatBtn = $("fm-treat");
      if (treatBtn) treatBtn.onclick = () => {
        const row = $("fm-treat-row");
        row.hidden = !row.hidden;
      };
      const treatOne = $("fm-treat-one");
      if (treatOne) treatOne.onclick = async () => {
        let r = await Api.treatFish(fish.id);
        if (!r.ok && r.error === "no medicine") {
          if (!confirm(htmlToText(t("fishmenu.no_medicine", { price: fmtCoins(DATA.MEDICINE_PRICE) })))) return;
          const b = await Api.buyMedicine(1);
          if (!b.ok) { AudioFX.error(); toast(b.error || t("toast.couldnt_buy_medicine")); return; }
          r = await Api.treatFish(fish.id);
        }
        if (r.ok) { AudioFX.coin(); toast(t("toast.all_better")); }
        else { AudioFX.error(); toast(r.error || t("toast.couldnt_treat")); }
        await reopen();
      };
      const treatAll = $("fm-treat-all");
      if (treatAll) treatAll.onclick = async () => {
        const r = await Api.cureAll();
        if (r.ok) { AudioFX.coin(); toast(t("toast.cured_all", { n: r.cured })); }
        else {
          AudioFX.error();
          toast(r.error === "no sick fish" ? t("toast.no_sick")
            : r.error === "not enough gems" ? t("toast.no_gems")
            : (r.error || t("toast.couldnt_treat")));
        }
        await reopen();
      };
      $("fm-pet").onclick = async () => { closeFishMenu(); await App.petFish(fish.id); };
      const fmBreed = $("fm-breed");
      if (fmBreed) fmBreed.onclick = () => { closeFishMenu(); openBreedingWith(fish); };
      $("fm-transfer").onclick = () => {
        const row = $("fm-transfer-row");
        const inInv = fish.location === "inventory";
        const instances = (state.tanks.instances || []).filter((t) =>
          inInv || !(t.tier === fish.tank && t.num === (fish.tank_num || 1)));
        if (!instances.length) { toast(inInv ? t("toast.no_tank_yet") : t("toast.no_other_tank")); return; }
        row.hidden = false;
        row.innerHTML = instances.map((t) => {
          const tierCount = instances.filter((x) => x.tier === t.tier).length;
          const label = tierCount > 1 ? `${TANK_LABELS[t.tier] || t.tier} ${t.num}` : (TANK_LABELS[t.tier] || t.tier);
          return `<button class="pill-btn blue" data-fmto="${t.tier}" data-fmnum="${t.num}">\u2192 ${label}</button>`;
        }).join("");
        row.querySelectorAll("[data-fmto]").forEach((b) => b.onclick = async () => {
          b.disabled = true;
          const r = await Api.transferFish(fish.id, b.dataset.fmto, parseInt(b.dataset.fmnum) || 1);
          if (r.ok) { AudioFX.coin(); toast(inInv ? t("toast.placed", { tank: tankName(b.dataset.fmto) }) : t("toast.moved", { tank: tankName(b.dataset.fmto) })); }
          else { AudioFX.error(); toast(r.error || t("toast.couldnt_transfer")); }
          closeFishMenu();
          await App.refresh(); refreshScreen();
        });
      };
      if ($("fm-mksell")) {
        $("fm-mksell").onclick = () => { const row = $("fm-mkrow"); row.hidden = !row.hidden; };
        $("fm-mkok").onclick = async () => {
          const price = Math.floor(Number($("fm-mkprice").value));
          if (!price || price < 1 || price > 999999) { toast(t("toast.enter_price")); return; }
          if (!confirm(htmlToText(t("fishmenu.confirm_list", { price })))) return;
          const r = await Api.marketList(fish.id, price);
          if (r.ok) { AudioFX.coin(); toast(t("toast.listed")); closeFishMenu(); await App.refresh(); refreshScreen(); }
          else { AudioFX.error(); toast(r.error || t("toast.couldnt_list")); }
        };
      }
    }
    $("fm-rename").onclick = () => {
      const row = $("fm-rename-row");
      row.hidden = !row.hidden;
      const inp = $("fm-rename-input");
      inp.value = fish.nickname || "";
      if (!row.hidden) inp.focus();
    };
    $("fm-rename-ok").onclick = async () => {
      const name = $("fm-rename-input").value.trim();
      if (!name) { toast(t("toast.type_name")); return; }
      const r = await Api.renameFish(fish.id, name);
      if (r.ok) {
        AudioFX.coin(); toast(t("toast.cute_name", { name: r.nickname }));
        closeFishMenu(); await App.refresh(); refreshScreen();
      } else {
        AudioFX.error();
        toast(r.error === "not enough gems" ? t("toast.no_diamonds") : (r.error || t("toast.couldnt_rename")));
      }
    };
  }
  let coinCdTimer = null;
  function fmtCd(s) {
    s = Math.max(0, Math.ceil(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function closeFishMenu() {
    if (coinCdTimer) { clearInterval(coinCdTimer); coinCdTimer = null; }
    const o = $("fish-menu-overlay"); if (o) o.remove();
  }

  /* ---------- quick food buy from the HUD 🍤 counter ---------- */
  function openFoodPop() {
    closeFoodPop();
    const price = DATA.FOOD_PRICE || 10;
    const overlay = document.createElement("div");
    overlay.id = "food-pop-overlay";
    overlay.innerHTML = `
      <div class="food-pop">
        <div style="text-align:center;font-weight:800;margin-bottom:10px">${t("foodpop.title")} <span class="sub">${t("foodpop.each", { price: fmtCoins(price) })}</span></div>
        <div class="fish-menu-btns">
          ${[1, 5, 10].map((q) => `<button class="pill-btn pink" data-foodq="${q}">+${q}<br>${CUR_GOLD}${fmtCoins(price * q)}</button>`).join("")}
        </div>
      </div>`;
    overlay.onclick = (e) => { if (e.target === overlay) closeFoodPop(); };
    document.body.appendChild(overlay);
    overlay.querySelectorAll("[data-foodq]").forEach((b) => b.onclick = async () => {
      b.disabled = true;
      const r = await Api.buyFood(+b.dataset.foodq);
      if (r.ok) { AudioFX.coin(); toast(t("toast.food_bought", { qty: b.dataset.foodq })); }
      else { AudioFX.error(); toast(r.error || t("toast.couldnt_buy_food")); }
      closeFoodPop();
      await App.refresh();
    });
  }
  function closeFoodPop() { const o = $("food-pop-overlay"); if (o) o.remove(); }

  /* ---------- feed button: choose normal or bottom food ---------- */
  function openFeedChoice(nNormal, nBottom, onPick) {
    closeFeedChoice();
    const overlay = document.createElement("div");
    overlay.id = "feed-choice-overlay";
    overlay.className = "food-pop-overlay";
    overlay.innerHTML = `
      <div class="food-pop">
        <div style="text-align:center;font-weight:800;margin-bottom:10px">${t("feedchoice.title")}</div>
        <div class="fish-menu-btns" style="flex-direction:column;gap:10px">
          <button class="pill-btn" data-feedkind="normal" ${nNormal ? "" : "disabled"}>
            <img src="assets/icons/icon_food.png" alt="" style="width:26px;height:26px;vertical-align:-6px;margin-right:6px">${t("feedchoice.normal")}
            <span class="sub"> · ${t("feedchoice.fish", { n: nNormal })}</span>
          </button>
          <button class="pill-btn" data-feedkind="special" ${nBottom ? "" : "disabled"}>
            <img src="assets/icons/food_bottom_jar.png" alt="" style="width:26px;height:26px;vertical-align:-6px;margin-right:6px">${t("feedchoice.bottom")}
            <span class="sub"> · ${t("feedchoice.fish", { n: nBottom })}</span>
          </button>
        </div>
      </div>`;
    overlay.onclick = (e) => { if (e.target === overlay) closeFeedChoice(); };
    document.body.appendChild(overlay);
    overlay.querySelectorAll("[data-feedkind]").forEach((b) => b.onclick = () => {
      const kind = b.dataset.feedkind;
      closeFeedChoice();
      onPick(kind);
    });
  }
  function closeFeedChoice() { const o = $("feed-choice-overlay"); if (o) o.remove(); }

  /* ---------- tank full: offer extra slot (diamonds) or bigger tank (coins) ---------- */
  function showTankFullPopup({ deco_id, x, y }) {
    closeTankFullPopup();
    const active = state.tanks.active;
    const extra = (state.tanks.extra && state.tanks.extra[active]) || 0;
    const maxExtra = (state.tanks.extraMax && state.tanks.extraMax[active]) || 0;
    const slotCost = state.tanks.extraCost || 10;
    const canBuySlot = extra < maxExtra;
    const owned = state.tanks.owned || [];
    const nextBuy = ["medium", "large", "xl", "nursery"].find((t) => !owned.includes(t));
    const nextPrice = nextBuy ? DATA.TANKS[nextBuy].price : 0;

    const overlay = document.createElement("div");
    overlay.id = "tank-full-overlay";
    overlay.className = "food-pop-overlay";
    overlay.innerHTML = `
      <div class="food-pop">
        <div style="text-align:center;font-weight:800;margin-bottom:4px">${t("tankfull.title")}</div>
        <div class="sub" style="text-align:center;margin-bottom:10px">${t("tankfull.desc")}</div>
        <div class="fish-menu-btns">
          ${canBuySlot
            ? `<button class="pill-btn pink" id="tf-slot">${t("deco.slot_btn", { cost: slotCost })}</button>`
            : `<div class="sub" style="text-align:center;width:100%">${t("tankfull.no_more")}</div>`}
          ${nextBuy ? `<button class="pill-btn blue" id="tf-tank">${t("tankfull.get_tank", { tank: tankName(nextBuy), price: fmtCoins(nextPrice) })}</button>` : ""}
        </div>
      </div>`;
    overlay.onclick = (e) => { if (e.target === overlay) closeTankFullPopup(); };
    document.body.appendChild(overlay);

    if (canBuySlot) $("tf-slot").onclick = async () => {
      const r = await Api.buyExtraSlot(active);
      if (!r.ok) {
        AudioFX.error();
        toast(r.error === "not enough diamonds" ? t("toast.no_diamonds") : (r.error || t("toast.couldnt_buy_slot")));
        return;
      }
      AudioFX.coin();
      // retry the placement now that there's a free slot
      const rp = await Api.placeDecor(deco_id, active, x, y);
      if (rp.ok) toast(t("toast.slot_placed"));
      else toast(t("toast.slot_unlocked"));
      closeTankFullPopup();
      await App.refresh();
    };
    if (nextBuy) $("tf-tank").onclick = async () => {
      if (!confirm(htmlToText(t("tankfull.confirm_tank", { tank: tankName(nextBuy), price: fmtCoins(nextPrice) })))) return;
      const r = await Api.buyTank(nextBuy);
      if (!r.ok) {
        AudioFX.error();
        toast(r.error === "not enough coins" ? t("toast.no_coins") : (r.error || t("toast.couldnt_buy_tank")));
        return;
      }
      AudioFX.coin();
      toast(t("toast.new_tank", { tank: tankName(nextBuy) }));
      closeTankFullPopup();
      await App.refresh();
    };
  }
  function closeTankFullPopup() { const o = $("tank-full-overlay"); if (o) o.remove(); }

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
    open("lab", "breeding");
  }

  function open(name, arg) {
    close(true);
    currentScreen = name;
    if (name === "community" && arg) communityTab = arg;
    if (name === "quests" && arg) questsTab = arg;
    if (name === "shop" && arg) shopTab = arg;
    if (name === "lab" && arg) labTab = arg;
    if (name === "profile") profileUserId = arg || null;
    $("screen-title").innerHTML = TITLES[name] || esc(name);
    $("screen-overlay").hidden = false;
    RENDER[name]();
  }
  function refreshScreen() {
    if (currentScreen && !$("screen-overlay").hidden && RENDER[currentScreen]) RENDER[currentScreen]();
  }
  function close(silent) {
    killVisitView();
    if (window.EventCrush) EventCrush.unmount();
    $("screen-overlay").hidden = true;
    $("screen-body").innerHTML = "";
    $("screen-body").classList.remove("maze-body");
    document.querySelectorAll(".chat-screen").forEach((e) => e.classList.remove("chat-screen"));
    currentScreen = null;
    if (eggTimer) { clearInterval(eggTimer); eggTimer = null; }
    if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
    if (!silent && window.App) App.onScreenClosed();
  }
  const ICON = (f) => `<img class="title-ic" src="assets/icons/icon_${f}.png" alt="">`;
  const TITLES = {
    aquariums: ICON("aquariums") + t("nav.aquariums"), shop: ICON("nav_shop") + t("nav.shop"), lab: ICON("lab") + t("nav.lab"),
    collection: ICON("nav_collection") + t("nav.collection"), inventory: ICON("nav_inventory") + t("nav.inventory"), quests: ICON("quests") + t("nav.quests"),
    settings: `<img class="title-ic" src="assets/icons/icon_settings.png" alt=""> ` + t("settings.title"), minigame: "🎮 " + t("mg.title"), event: "🍂 " + t("event.title"),
    maze: `<img class="title-ic" src="assets/event/event_maze_icon.png" alt=""> ` + t("maze.title"),
    market: `<img class="title-ic" src="assets/icons/icon_diamond.png" alt="">` + t("market.title"), chat: ICON("chat") + t("chat.title"),
    community: ICON("community") + t("nav.community"),
    profile: ICON("community") + t("profile.title"),
    visit: "🐠 " + t("profile.visit_title"),
    gemshop: ICON("diamond") + t("gemshop.title"),
    coinshop: ICON("gold") + t("coinshop.title"),
    foodshop: ICON("food") + t("foodshop.title"),
  };

  /* ---------- helpers ---------- */
  function fishImg(speciesId, frame, gender) {
    return `<img class="fish-prev" src="${esc(spriteURL(speciesId, frame || 0, gender))}" alt="" loading="lazy">`;
  }
  function tankFish() {
    const active = state.tanks.active;
    return (state.fish || []).filter((f) => f.tank === active && (!f.location || f.location === "tank"));
  }
  function priceLabel(item) {
    const gems = item.price_gems || 0, coins = item.price_coins || 0;
    if (gems && coins) return `${CUR_GEM}${gems} <span class="sub">${t("shop.or")}</span> ${CUR_GOLD}${fmtCoins(coins)}`;
    if (gems) return `${CUR_GEM}${gems}`;
    return `${CUR_GOLD} ${fmtCoins(coins)}`;
  }

  /* ================= FISH SHOP ================= */
  /* ================= AQUARIUMS ================= */
  async function renderAquariums() {
    const body = $("screen-body");
    const counts = state.tanks.counts || {}, active = state.tanks.active, activeNum = state.tanks.activeNum || 1;
    const instances = state.tanks.instances || [];
    let html = `<button class="pill-btn blue" id="btn-view-tank" style="width:100%;padding:13px;margin-bottom:6px">🐠 ${t("aq.view_tank")}</button>
      <h3>${t("shop.tanks")}</h3>`;
    for (const [tier, T] of Object.entries(DATA.TANKS)) {
      const count = counts[tier] || 0;
      const need = (tier === "large" && !(counts.medium > 0)) || (tier === "xl" && !(counts.large > 0));
      const needTank = tier === "xl" ? "large" : "medium";
      const extraT = (state.tanks.extra && state.tanks.extra[tier]) || 0;
      html += `<div class="row-card"><div class="grow">
        <b style="text-transform:capitalize">${tankName(tier)} <span class="sub">(${count}/3)</span></b>
        <div class="sub">${t("shop.tank_info", { fish: T.capacity, decor: T.decorSlots + extraT })}</div>`;
      // Show each owned instance with switch button
      for (let n = 1; n <= count; n++) {
        const isActive = active === tier && activeNum === n;
        html += `<div style="margin-top:6px">${isActive ? `<span class="tag">${t("shop.active")}</span>`
          : `<button class="pill-btn blue" data-switch="${tier}" data-num="${n}">${tankName(tier)} ${n} — ${t("shop.use")}</button>`}</div>`;
      }
      html += `</div>
        ${count < 3 ? `<button class="pill-btn" data-buytank="${tier}" ${need ? "disabled" : ""}>${CUR_GOLD} ${fmtCoins(T.price)}</button>`
          : `<span class="tag">${t("shop.maxed")}</span>`}
      </div>`;
      if (need) html += `<div class="sub" style="margin:-4px 0 8px">${t("shop.needs_first", { tank: tankName(needTank) })}</div>`;
    }
    body.innerHTML = html;
    $("btn-view-tank").onclick = () => close();
    body.querySelectorAll("[data-buytank]").forEach((b) => b.onclick = async () => {
      const r = await Api.buyTank(b.dataset.buytank);
      if (r.ok) { AudioFX.coin(); toast(t("toast.tank_upgraded")); }
      else { AudioFX.error(); toast(r.error || t("toast.couldnt_buy_tank")); }
      await App.refresh(); renderAquariums();
    });
    body.querySelectorAll("[data-switch]").forEach((b) => b.onclick = () => {
      App.switchTankFast(b.dataset.switch, parseInt(b.dataset.num) || 1); // optimistic: instant switch, server confirms in background
    });
  }

  /* ================= SHOP (fish + decor tabs) ================= */
  let shopTab = "fish";
  async function renderShopScreen() {
    const body = $("screen-body");
    try {
    const banner = (DATA.SCENES && DATA.SCENES.fishstore) ? `<div class="shop-banner"><img src="${DATA.SCENES.fishstore}" alt="Fish Store"></div>` : "";
    body.innerHTML = `${banner}<div class="tabbar comm-tabs">
        <button class="pill-btn${shopTab === "fish" ? " active" : ""}" data-stab="fish"><img src="assets/icons/icon_fish.png" alt=""><span>${t("shop.fish")}</span></button>
        <button class="pill-btn${shopTab === "decor" ? " active" : ""}" data-stab="decor"><img src="assets/icons/icon_decor.png" alt=""><span>${t("deco.title")}</span></button>
      </div><div id="shop-body"></div>`;
    body.querySelectorAll("[data-stab]").forEach((b) => b.onclick = () => { shopTab = b.dataset.stab; renderShopScreen(); });
    const sub = $("shop-body");
    if (shopTab === "decor") renderDecorShop(sub); else renderShopFish(sub);
    } catch (e) {
      body.innerHTML = `<div class="empty">Shop error: ${esc(String(e.message || e))}</div>`;
    }
  }

  async function renderShopFish(root) {
    const body = root || $("screen-body");
    if (!fishCatalog) {
      body.innerHTML = `<div class="empty">${t("common.loading")}</div>`;
      const r = await Api.fishCatalog();
      if (r.ok) fishCatalog = r.items;
    }
    const items = fishCatalog || Object.keys(DATA.SPECIES).map((id) => ({
      species_id: id, name: speciesName(id), group: speciesGroup(id),
      price_coins: (DATA.SPECIES[id] || {}).price || 0,
      price_gems: (DATA.SPECIES[id] || {}).priceGems || 0,
      desc: (DATA.SPECIES[id] || {}).desc || "",
    }));
    const tf = tankFish();
    const active = state.tanks.active;
    let html = `<h3>${t("shop.fish")} <span class="tag">${t("shop.in_tank", { n: tf.length, cap: DATA.TANKS[active].capacity, tank: tankName(active) })}</span></h3>
      <div class="grid2">`;
    for (const it of items) {
      html += `<div class="card">${fishImg(it.species_id)}
        <div class="nm">${esc(it.name)}</div>
        <div class="sub">${esc(it.group)}${it.species_id === "female_betta" ? " · " + t("shop.always_female") : ""} · ${t("shop.grows_at", { lvl: it.grow_level || 10 })}</div>
        ${it.desc ? `<div class="sub" style="color:#2a7a3a;font-weight:600">${esc(it.desc)}</div>` : ""}
        <div class="price">${priceLabel(it)}</div>
        <button class="pill-btn pink" data-buyfish="${esc(it.species_id)}">${t("shop.buy")}</button>
      </div>`;
    }
    html += `</div><div class="empty">${t("shop.sell_hint")}</div>`;
    body.innerHTML = html;
    body.querySelectorAll("[data-buyfish]").forEach((b) => b.onclick = async () => {
      b.disabled = true;
      const r = await Api.buyFish(b.dataset.buyfish);
      if (r.ok) { AudioFX.coin(); toast(t("toast.welcome_fish", { name: esc(r.fish.name || t("toast.little_fish")) })); }
      else { AudioFX.error(); toast(r.error || t("toast.couldnt_buy")); }
      await App.refresh();
      renderShopFish(body);
    });
  }

  /* ================= DIAMOND SHOP (via + on the HUD) ================= */
  async function renderGemShop() {
    const body = $("screen-body");
    // CrazyGames portal build: Stripe packs hidden — rewarded ads only.
    if (typeof CG !== "undefined" && CG.isCGBuild()) { renderGemShopCG(body); return; }
    // Localized prices from the server (geo-priced by country). Falls back
    // to the static list if offline / endpoint unavailable.
    let packs = null;
    try {
      const r = await Api.diamondPrices();
      if (r && r.ok && Array.isArray(r.packs) && r.packs.length) packs = r.packs;
    } catch (e) { /* offline fallback below */ }
    if (!packs) packs = DATA.GEM_PACKS.map((p) => ({ gems: p.gems, display: p.price }));
    let html = `<div class="sub" style="margin:2px 0 12px">${t("gemshop.subtitle")}</div><div class="grid2">`;
    for (const p of packs) {
      html += `<div class="card"><img class="fish-prev" src="assets/icons/icon_diamond.png" alt="" style="width:64px;height:64px">
        <div class="nm">${p.gems} ${t("gemshop.diamonds")}</div>
        <div class="price">${esc(p.display || "")}</div>
        <button class="pill-btn" data-buypack="${p.gems}">${t("shop.buy")}</button>
      </div>`;
    }
    html += `</div>`;
    body.innerHTML = html;
    body.querySelectorAll("[data-buypack]").forEach((b) => b.onclick = () => buyGemPack(b, +b.dataset.buypack));
  }
  async function buyGemPack(btn, gems) {
    btn.disabled = true;
    toast(t("gemshop.redirecting"));
    const r = await Api.diamondCheckout(gems);
    if (r && r.ok && r.url) {
      // Stripe Checkout (same tab); success_url brings the player back.
      window.location.href = r.url;
      return;
    }
    btn.disabled = false;
    toast(t(r && r.error === "payments_not_configured" ? "gemshop.soon" : "gemshop.error"));
  }

  /* CrazyGames portal: diamonds via rewarded ad instead of Stripe. */
  function renderGemShopCG(body) {
    body.innerHTML = `<div class="sub" style="margin:2px 0 12px">${t("gemshop.subtitle")}</div>
      <div class="card" style="text-align:center;padding:24px">
        <img class="fish-prev" src="assets/icons/icon_diamond.png" alt="" style="width:64px;height:64px">
        <div class="nm">10 ${t("gemshop.diamonds")}</div>
        <div class="price">🎬 ${t("gemshop.watch_ad") || "Watch ad"}</div>
        <button class="pill-btn" id="cg-rewarded-btn">▶ ${t("gemshop.watch_ad") || "Watch ad"}</button>
      </div>`;
    const btn = body.querySelector("#cg-rewarded-btn");
    btn.onclick = () => {
      btn.disabled = true;
      if (typeof CG === "undefined") { btn.disabled = false; return; }
      // pause game + mute during ad
      if (typeof CG !== "undefined") CG.gameplayStop();
      const wasMuted = (typeof AudioFX !== "undefined") && AudioFX.muted;
      if (typeof AudioFX !== "undefined" && AudioFX.setMuted) AudioFX.setMuted(true);
      CG.rewarded({
        onFinished: async () => {
          if (typeof AudioFX !== "undefined" && AudioFX.setMuted) AudioFX.setMuted(!!wasMuted);
          if (typeof CG !== "undefined") CG.gameplayStart();
          try {
            const r = await Api.rewardedDiamonds(10);
            if (r && r.ok) { toast(t("gemshop.success")); if (typeof App !== "undefined") App.refresh(); }
            else toast(t("gemshop.error"));
          } catch (e) { toast(t("gemshop.error")); }
          btn.disabled = false;
        },
        onError: () => {
          if (typeof AudioFX !== "undefined" && AudioFX.setMuted) AudioFX.setMuted(!!wasMuted);
          if (typeof CG !== "undefined") CG.gameplayStart();
          toast(t("gemshop.error"));
          btn.disabled = false;
        },
      });
    };
  }

  /* ================= COIN SHOP (via + on the coins HUD chip: diamonds -> coins) ================= */
  async function renderCoinShop() {
    const body = $("screen-body");
    let html = `<div class="sub" style="margin:2px 0 12px">${t("coinshop.subtitle")}</div><div class="grid2">`;
    DATA.COIN_PACKS.forEach((p, i) => {
      html += `<div class="card"><img class="fish-prev" src="assets/icons/icon_gold.png" alt="" style="width:64px;height:64px">
        <div class="nm">+${fmtCoins(p.coins)} ${t("coinshop.coins")}</div>
        <button class="pill-btn" data-coinpack="${i}">${CUR_GEM}${p.gems}</button>
      </div>`;
    });
    html += `</div>`;
    body.innerHTML = html;
    body.querySelectorAll("[data-coinpack]").forEach((b) => b.onclick = async () => {
      b.disabled = true;
      const r = await Api.buyCoins(+b.dataset.coinpack);
      if (r.ok) { AudioFX.coin(); toast(t("coinshop.bought")); }
      else { AudioFX.error(); toast(r.error === "not enough gems" ? t("coinshop.not_enough") : (r.error || t("toast.couldnt_buy_food"))); }
      await App.refresh();
      renderCoinShop();
    });
  }

  /* ================= FOOD SHOP (via + on the food HUD chip: coin packs of food) ================= */
  async function renderFoodShop() {
    const body = $("screen-body");
    const price = DATA.FOOD_PRICE || 10;
    const sprice = DATA.SPECIAL_FOOD_PRICE || 10;
    const w = (App.state && App.state.wallets) || {};
    const packCard = (q, p, kind) => `<div class="card"><img class="fish-prev" src="assets/icons/${kind === "special" ? "food_bottom_jar" : "icon_food"}.png" alt="" style="width:64px;height:64px">
        <div class="nm">+${q} ${t(kind === "special" ? "foodshop.special_food" : "foodshop.food")}</div>
        <button class="pill-btn" data-foodpack="${q}" data-kind="${kind}">${CUR_GOLD}${fmtCoins(p * q)}</button>
      </div>`;
    let html = `<div class="sub" style="margin:2px 0 12px">${t("foodshop.subtitle")}</div>`;
    html += `<div class="sub" style="margin:8px 0 8px"><b>${t("foodshop.have")}:</b> ${w.food || 0} ${t("foodshop.food")}</div><div class="grid2">`;
    for (const q of DATA.FOOD_PACKS) html += packCard(q, price, "normal");
    html += `</div>`;
    html += `<div class="sub" style="margin:14px 0 8px"><b>${t("foodshop.special_title")}</b> — ${t("foodshop.have")}: ${w.food_special || 0}</div><div class="grid2">`;
    for (const q of (DATA.SPECIAL_FOOD_PACKS || [1, 10])) html += packCard(q, sprice, "special");
    html += `</div>`;
    body.innerHTML = html;
    body.querySelectorAll("[data-foodpack]").forEach((b) => b.onclick = async () => {
      b.disabled = true;
      const r = await Api.buyFood(+b.dataset.foodpack, b.dataset.kind);
      if (r.ok) { AudioFX.coin(); toast(t("toast.food_bought", { qty: b.dataset.foodpack })); }
      else { AudioFX.error(); toast(r.error || t("toast.couldnt_buy_food")); }
      await App.refresh();
      renderFoodShop();
    });
  }

  /* ================= LAB (medicine) ================= */
  let labTab = "medicine";
  async function renderLab() {
    const body = $("screen-body");
    body.innerHTML = `<div class="tabbar comm-tabs">
        <button class="pill-btn${labTab === "medicine" ? " active" : ""}" data-ltab="medicine"><img src="assets/icons/icon_medicine.png" alt=""><span>${t("shop.medicine")}</span></button>
        <button class="pill-btn${labTab === "breeding" ? " active" : ""}" data-ltab="breeding"><img src="assets/icons/icon_nav_eggs.png" alt=""><span>${t("breed.title")}</span></button>
      </div><div id="lab-body"></div>`;
    body.querySelectorAll("[data-ltab]").forEach((b) => b.onclick = () => { labTab = b.dataset.ltab; renderLab(); });
    if (labTab === "breeding") renderBreeding(); else renderMedicine($("lab-body"));
  }
  async function renderMedicine(root) {
    const body = root || $("screen-body");
    body.innerHTML = `<div class="row-card"><img src="assets/icons/icon_medicine.png" alt="" style="width:56px;height:56px;object-fit:contain;margin-right:10px;flex:none"><div class="grow"><b>${t("shop.medicine")}</b>
        <div class="sub">${t("shop.medicine_desc", { n: state.wallets.medicine || 0 })}</div></div>
        <button class="pill-btn gold" data-buymed="1">${CUR_GOLD} ${fmtCoins(DATA.MEDICINE_PRICE)}</button>
      </div>
      <div class="row-card"><img src="assets/icons/icon_cure_all.jpg" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:12px;margin-right:10px;flex:none"><div class="grow"><b>${t("lab.cure_all")}</b>
        <div class="sub">${t("lab.cure_all_desc")}</div></div>
        <button class="pill-btn pink" data-cureall="1">💎 10 · ${t("lab.cure_all_use")}</button>
      </div>
      <div class="sub" style="margin-top:10px">${t("lab.hint")}</div>`;
    body.querySelectorAll("[data-buymed]").forEach((b) => b.onclick = async () => {
      b.disabled = true;
      const r = await Api.buyMedicine(+b.dataset.buymed);
      if (r.ok) { AudioFX.coin(); toast(t("toast.medicine_bought", { qty: b.dataset.buymed })); }
      else { AudioFX.error(); toast(r.error || t("toast.couldnt_buy")); }
      await App.refresh();
      renderLab();
    });
    body.querySelectorAll("[data-cureall]").forEach((b) => b.onclick = async () => {
      b.disabled = true;
      const r = await Api.cureAll();
      if (r.ok) { AudioFX.coin(); toast(t("toast.cured_all", { n: r.cured })); }
      else {
        AudioFX.error();
        toast(r.error === "no sick fish" ? t("toast.no_sick")
          : r.error === "not enough gems" ? t("toast.no_gems")
          : (r.error || t("toast.couldnt_buy")));
      }
      await App.refresh();
      renderLab();
    });
  }

  /* ================= DECOR SHOP ================= */
  async function renderDecorShop(root, filter) {
    const body = (typeof root === "string" || !root) ? $("screen-body") : root;
    if (typeof root === "string") filter = root;
    if (!decorCatalog) {
      body.innerHTML = `<div class="empty">${t("common.loading")}</div>`;
      const r = await Api.decorCatalog();
      if (r.ok) { decorCatalog = r.items; App.setDecoCatalog(r.items); }
    }
    const items = decorCatalog || [];
    const ownedMap = {};
    for (const o of (state.decor_owned || [])) ownedMap[o.deco_id] = o.qty;
    const q = (filter || "").toLowerCase();
    const list = items.filter((it) => it.shop !== false && it.event !== "grab" && (!q || it.name.toLowerCase().includes(q)));

    const activeTank = state.tanks.active;
    const baseSlots = DATA.TANKS[activeTank].decorSlots;
    const extraSlots = (state.tanks.extra && state.tanks.extra[activeTank]) || 0;
    const maxExtra = (state.tanks.extraMax && state.tanks.extraMax[activeTank]) || 0;
    const slotCost = state.tanks.extraCost || 10;
    const placedCount = state.placements.filter((p) => p.tank === activeTank).length;
    const buySlotBtn = extraSlots < maxExtra
      ? ` <button class="pill-btn pink" data-buyslot="${esc(activeTank)}">${t("deco.slot_btn", { cost: slotCost })}</button>`
      : "";
    let html = `<input class="search" id="decor-search" placeholder="${t("deco.search_ph")}" value="${esc(filter || "")}">
      <h3>🪸 ${t("deco.title")} <span class="tag">${t("deco.placed", { n: placedCount, total: baseSlots + extraSlots })}</span>${buySlotBtn}</h3>
      <div class="deco-grid">`;
    for (const it of list) {
      const qty = ownedMap[it.id] || 0;
      html += `<div class="deco-card">
        <img src="${esc(it.file)}" alt="" loading="lazy">
        <div class="nm">${esc(it.name)}</div>
        <div class="price">${CUR_GOLD} ${fmtCoins(it.price)}</div>
        <button class="pill-btn pink" data-buydeco="${esc(it.id)}">${t("shop.buy")}</button>
        ${qty ? `<button class="pill-btn blue" data-placedeco="${esc(it.id)}">${t("deco.place", { qty })}</button>` : ""}
      </div>`;
    }
    html += `</div>`;
    if (!list.length) html += `<div class="empty">${t("deco.no_match")}</div>`;
    body.innerHTML = html;

    const si = $("decor-search");
    si.oninput = () => renderDecorShop(body, si.value);
    // keep focus after re-render
    si.focus(); si.setSelectionRange(si.value.length, si.value.length);

    body.querySelectorAll("[data-buydeco]").forEach((b) => b.onclick = async () => {
      const r = await Api.buyDecor(b.dataset.buydeco);
      if (r.ok) { AudioFX.coin(); toast(t("toast.deco_bought")); }
      else { AudioFX.error(); toast(r.error || t("toast.couldnt_buy")); }
      await App.refresh(); renderDecorShop(body, $("decor-search") ? $("decor-search").value : "");
    });
    body.querySelectorAll("[data-placedeco]").forEach((b) => b.onclick = () => {
      close(); App.beginPlace(b.dataset.placedeco);
    });
    body.querySelectorAll("[data-buyslot]").forEach((b) => b.onclick = async () => {
      const tank = b.dataset.buyslot;
      if (!confirm(htmlToText(t("tankfull.confirm_slot", { tank: tankName(tank), cost: slotCost })))) return;
      const r = await Api.buyExtraSlot(tank);
      if (r.ok) { AudioFX.coin(); toast(t("toast.slot_unlocked")); }
      else {
        AudioFX.error();
        toast(r.error === "not enough diamonds" ? t("toast.no_diamonds") : (r.error || t("toast.couldnt_buy_slot")));
      }
      await App.refresh(); renderDecorShop(body, $("decor-search") ? $("decor-search").value : "");
    });
  }

  /* ================= BREEDING ================= */
  let breedMale = null, breedFemale = null, partners = null, partnersFor = null;
  async function renderBreeding() {
    const body = $("lab-body") || $("screen-body");
    // hybrids cannot breed: keep them out of the pick lists entirely
    // show all fish in any tank (not just the active aquarium)
    const tf = (state.fish || []).filter((f) => (!f.location || f.location === "tank") && !(f.lineage && f.lineage.hybrid));
    breedMale = breedMale && tf.find((f) => f.id === breedMale.id) ? breedMale : null;
    breedFemale = breedFemale && tf.find((f) => f.id === breedFemale.id) ? breedFemale : null;

    const pickRow = (list, sel, cls, title) => `
      <h3>${title}</h3><div class="fish-pick">
      ${list.map((f) => `
        <div class="pick ${sel && sel.id === f.id ? "sel" : ""}" data-pick="${cls}" data-id="${f.id}">
          ${fishImg(f.species_id, 0, f.gender)}
          <div><b>${esc(f.name || speciesName(f.species_id))}</b></div>
          <div class="sub">${f.gender === "male" ? "♂" : "♀"} ${esc(speciesName(f.species_id))}</div>
        </div>`).join("") || `<div class="empty">${t("breed.no_fish")}</div>`}
      </div>`;

    let html = `
      <div class="sub" style="margin-bottom:6px">${t("breed.intro", { gems: DATA.BREED_GEMS })}</div>
      ${pickRow(tf.filter((f) => f.gender === "male"), breedMale, "m", "♂ " + t("breed.choose_father"))}
      ${pickRow(partners || tf.filter((f) => f.gender === "female"), breedFemale, "f", "♀ " + t("breed.choose_mother"))}
      <div id="breed-msg" class="sub" style="margin:6px 0"></div>
      <button class="pill-btn pink" id="btn-do-breed" style="width:100%;padding:13px"
        ${breedMale && breedFemale ? "" : "disabled"}>${t("breed.breed_btn", { gems: DATA.BREED_GEMS })}</button>
      <h3>🥚 ${t("breed.egg_nursery")}</h3>
      <div id="egg-list">${eggListHtml()}</div>`;
    body.innerHTML = html;

    body.querySelectorAll("[data-pick]").forEach((el) => el.onclick = async () => {
      const id = +el.dataset.id;
      const f = tf.find((x) => x.id === id);
      if (el.dataset.pick === "m") {
        breedMale = f; partners = null;
        if (f) {
          const r = await Api.breedingPartners(f.id);
          if (r.ok) {
            partners = r.partners; partnersFor = f.id;
            // keep the chosen mother if she's still a valid partner for this male
            if (breedFemale && !partners.some((p) => p.id === breedFemale.id)) breedFemale = null;
          } else breedFemale = null;
        } else breedFemale = null;
      } else breedFemale = f;
      renderBreeding();
    });

    $("btn-do-breed").onclick = async () => {
      if (!breedMale || !breedFemale) return;
      const btn = $("btn-do-breed"); btn.disabled = true;
      const r = await Api.breed(breedMale.id, breedFemale.id);
      if (r.ok) {
        AudioFX.coin(); toast(r.queued ? t("app.breed_queued") : t("toast.egg_laid"));
        breedMale = breedFemale = null; partners = null;
      } else {
        AudioFX.error();
        $("breed-msg").textContent = r.error || t("toast.cant_breed");
        toast(r.error || t("toast.cant_breed"));
      }
      await App.refresh(); renderBreeding();
    };

    startEggTimer();
  }
  function eggListHtml() {
    const eggs = state.eggs || [];
    if (!eggs.length) return `<div class="empty">${t("breed.no_eggs")}</div>`;
    return eggs.map((e) => {
      const sp = e.species || null;
      const icon = (typeof eggIcon === "function") ? eggIcon(sp) : null;
      const name = esc(speciesName(sp) || speciesName(e.variant_a) || e.group);
      return `<div class="row-card egg-card">
        <div class="egg-ic">${icon ? `<img src="${icon}" alt="">` : `🥚`}</div>
        <div class="grow">
          <div class="lineage">${t("tag.gen", { n: e.generation || 1 })} · ${esc(speciesName(e.variant_a) || "")} × ${esc(speciesName(e.variant_b) || "")} ${e.hybrid ? '<span class="tag hybrid">' + t("tag.hybrid") + "</span>" : ""}</div>
        </div>
        <div class="egg-right"><div class="egg-name">${name}</div><div class="countdown" data-hatch="${e.hatch_at * 1000}">…</div></div>
      </div>`;
    }).join("");
  }
  function startEggTimer() {
    if (eggTimer) clearInterval(eggTimer);
    const tick = () => {
      let anyExpired = false;
      document.querySelectorAll("[data-hatch]").forEach((el) => {
        const left = +el.dataset.hatch - Date.now();
        el.textContent = "⏰ " + fmtCountdown(left);
        if (left <= 0) anyExpired = true;
      });
      if (anyExpired) {
        clearInterval(eggTimer); eggTimer = null;
        setTimeout(async () => { await App.refresh(); renderBreeding(); toast(t("toast.egg_hatched")); if (typeof CG !== "undefined") CG.happytime(); }, 2500);
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
    let html = `<h3>📖 ${t("coll.species_log")}</h3><div class="grid2">`;
    for (const [id, sp] of Object.entries(DATA.SPECIES)) {
      const c = seen[id];
      html += `<div class="card" style="${c ? "" : "opacity:.45;filter:grayscale(.8)"}">
        ${c ? fishImg(id) : `<div style="font-size:40px">❓</div>`}
        <div class="nm">${c ? esc(sp.name) : "???"}</div>
        <div class="sub">${esc(sp.group)}${c ? t("coll.seen", { n: c.count }) : t("coll.not_seen")}</div>
      </div>`;
    }
    html += `</div><h3>🧬 ${t("coll.lineage")}</h3>`;
    const bred = (state.fish || []).filter((f) => f.lineage && (f.lineage.mother || f.lineage.father || f.lineage.hybrid));
    html += bred.length ? bred.map((f) => {
      const L = f.lineage;
      return `<div class="row-card"><span style="display:flex;align-items:center">${fishImg(f.species_id, 0, f.gender)}</span><div class="grow">
        <b>${esc(f.nickname || f.name || speciesName(f.species_id))}</b>
        ${L.hybrid ? ' <span class="tag hybrid">' + t("tag.hybrid") + "</span>" : ""}
        <div class="lineage">♂ ${esc(speciesName(L.father) || "?")} × ♀ ${esc(speciesName(L.mother) || "?")} · gen ${L.generation || 1}</div>
      </div></div>`;
    }).join("") : `<div class="empty">${t("coll.no_lineage")}</div>`;
    body.innerHTML = html;
  }

  /* ================= INVENTORY ================= */
  function renderInventory() {
    const body = $("screen-body");
    let html = `<div class="tabbar">
      <button class="pill-btn${invTab === "fishes" ? " active" : ""}" data-invtab="fishes">🐠 ${t("inv.fishes")}</button>
      <button class="pill-btn${invTab === "furniture" ? " active" : ""}" data-invtab="furniture">🪑 ${t("inv.furniture")}</button>
    </div>`;
    html += invTab === "fishes" ? invFishesHtml() : invFurnitureHtml();
    body.innerHTML = html;
    body.querySelectorAll("[data-invtab]").forEach((b) => b.onclick = () => { invTab = b.dataset.invtab; renderInventory(); });
    if (invTab === "fishes") bindInvFishes(body);
    else bindInvFurniture(body);
  }

  function invFishesHtml() {
    const all = state.fish || [];
    const inTank = all.filter((f) => (!f.location || f.location === "tank")).length;
    const inInv = all.filter((f) => f.location === "inventory").length;
    let html = `<div class="tabbar">
      <button class="pill-btn${invFilter === "all" ? " active" : ""}" data-invfilter="all">${t("inv.filter_all", { n: all.length })}</button>
      <button class="pill-btn${invFilter === "tank" ? " active" : ""}" data-invfilter="tank">🏠 ${t("inv.filter_tank", { n: inTank })}</button>
      <button class="pill-btn${invFilter === "inventory" ? " active" : ""}" data-invfilter="inventory">🎒 ${t("inv.filter_stored", { n: inInv })}</button>
    </div>`;
    let list = all;
    if (invFilter === "tank") list = all.filter((f) => !f.location || f.location === "tank");
    if (invFilter === "inventory") list = all.filter((f) => f.location === "inventory");
    if (!list.length) html += `<div class="empty">${invFilter === "inventory" ? t("inv.no_stored") : t("inv.no_fish")}</div>`;
    html += list.map((f) => {
      const locSub = f.location === "market"
        ? t("inv.on_market", { price: f.listing_price })
        : f.location === "inventory" ? t("inv.in_storage") : "🏠 " + t("inv.in_tank", { tank: tankName(f.tank) });
      return `
      <div class="row-card"><span data-fishmenu="${f.id}" style="cursor:pointer;display:flex;align-items:center">${fishImg(f.species_id, 0, f.gender)}</span><div class="grow">
        <b>${esc(f.nickname || f.name || speciesName(f.species_id))}</b>
        ${f.tradeable && f.location !== "market" ? ' <span class="tag">' + CUR_GEM + ' ' + t("inv.tradeable") + "</span>" : ""}
        <div class="sub">${f.gender === "male" ? "♂" : "♀"} · ${esc(f.stage || "adult")} · ${locSub}</div>
      </div>${f.location === "market" ? "" : `<button class="pill-btn" data-sell="${f.id}">${t("inv.sell")}</button>`}</div>`;
    }).join("");
    return html;
  }

  function bindInvFishes(body) {
    body.querySelectorAll("[data-invfilter]").forEach((b) => b.onclick = () => { invFilter = b.dataset.invfilter; renderInventory(); });
    body.querySelectorAll("[data-fishmenu]").forEach((el) => el.onclick = () => {
      const f = (state.fish || []).find((x) => x.id === +el.dataset.fishmenu);
      if (f) openFishMenu(f);
    });
    body.querySelectorAll("[data-sell]").forEach((b) => b.onclick = async () => {
      if (!confirm(t("inv.confirm_sell"))) return;
      const r = await Api.sellFish(+b.dataset.sell);
      if (r.ok) { AudioFX.coin(); toast(t("toast.sold", { coins: fmtCoins(r.coins) })); }
      else toast(r.error || t("toast.couldnt_sell"));
      await App.refresh(); renderInventory();
    });
  }

  function invFurnitureHtml() {
    const w = state.wallets;
    const owned = state.decor_owned || [];
    let html = `
      <h3>🍤 ${t("inv.food")} <span class="tag">${fmtCoins(w.food)}</span></h3>
      <div class="row-card"><div class="grow"><b>${t("inv.fish_food")}</b>
        <div class="sub">${t("inv.food_desc", { price: DATA.FOOD_PRICE })}</div></div>
        <button class="pill-btn" data-food="1">+1</button>
        <button class="pill-btn" data-food="5">+5</button>
        <button class="pill-btn" data-food="10">+10</button>
      </div>
      <h3>🪸 ${t("inv.deco_owned")}</h3>`;
    if (!owned.length) html += `<div class="empty">${t("inv.no_deco")}</div>`;
    for (const o of owned) {
      const it = (decorCatalog || []).find((d) => d.id === o.deco_id);
      const nm = it ? it.name : o.deco_id, file = it ? it.file : "";
      html += `<div class="row-card">
        ${file ? `<img src="${esc(file)}" style="width:56px;height:44px;object-fit:contain" alt="">` : ""}
        <div class="grow"><b>${esc(nm)}</b><div class="sub">×${o.qty}</div></div>
        <button class="pill-btn blue" data-placeinv="${esc(o.deco_id)}">${t("fishmenu.place_in_tank")}</button>
      </div>`;
    }
    return html;
  }

  function bindInvFurniture(body) {
    body.querySelectorAll("[data-food]").forEach((b) => b.onclick = async () => {
      const r = await Api.buyFood(+b.dataset.food);
      if (r.ok) { AudioFX.coin(); toast(t("toast.food_bought", { qty: b.dataset.food })); }
      else { AudioFX.error(); toast(r.error || t("toast.couldnt_buy_food")); }
      await App.refresh(); renderInventory();
    });
    body.querySelectorAll("[data-placeinv]").forEach((b) => b.onclick = () => {
      close(); App.beginPlace(b.dataset.placeinv);
    });
  }

  /* ================= QUESTS ================= */
  /* ================= QUESTS + GAMES ================= */
  let questsTab = "missions";
  function renderQuestsScreen() {
    const body = $("screen-body");
    clearTimeout(MG.timer); MG.shellGen = (MG.shellGen || 0) + 1;
    body.innerHTML = `<div class="tabbar comm-tabs">
        <button class="pill-btn${questsTab === "missions" ? " active" : ""}" data-qtab="missions"><img src="assets/icons/icon_quests.png" alt=""><span>${t("nav.quests")}</span></button>
        <button class="pill-btn${questsTab === "games" ? " active" : ""}" data-qtab="games"><img src="assets/icons/icon_games.png" alt=""><span>${t("mg.title")}</span></button>
      </div><div id="quests-body"></div>`;
    body.querySelectorAll("[data-qtab]").forEach((b) => b.onclick = () => { questsTab = b.dataset.qtab; renderQuestsScreen(); });
    const sub = $("quests-body");
    if (questsTab === "games") renderMinigame(sub); else renderQuests(sub);
  }

  function renderQuests(root) {
    const body = root || $("screen-body");
    const qs = state.quests || [];
    let html = `<div class="sub" style="margin-bottom:8px">${t("quest.reset_info")}</div>`;
    const groups = [["daily", "☀️ " + t("quest.daily")], ["weekly", "📅 " + t("quest.weekly")]];
    for (const [period, label] of groups) {
      html += `<h3>${label}</h3>`;
      const list = qs.filter((q) => q.period === period);
      if (!list.length) html += `<div class="empty">${period === "daily" ? t("quest.no_daily") : t("quest.no_weekly")}</div>`;
      for (const q of list) {
        const pct = Math.min(100, Math.round((q.progress / Math.max(1, q.target)) * 100));
        const done = q.progress >= q.target;
        const qtk = "quest." + q.id + ".title";
        const qtitle = t(qtk) === qtk ? q.title : t(qtk);
        const qdk = "quest." + q.id + ".desc";
        const qdesc = t(qdk) === qdk ? (q.desc || "") : t(qdk);
        html += `<div class="row-card ${q.claimed ? "quest-done" : ""}"><div class="grow">
          <b>${esc(qtitle)}</b>
          <div class="sub">${esc(qdesc)}</div>
          <div class="progress"><i style="width:${pct}%"></i></div>
          <div class="sub">${q.progress}/${q.target}${q.reward_coins ? ` · ${CUR_GOLD}${q.reward_coins}` : ""}${q.reward_gems ? ` · ${CUR_GEM}${q.reward_gems}` : ""}</div>
        </div>
        ${q.claimed ? `<span class="tag">${t("quest.claimed")}</span>`
          : done ? `<button class="pill-btn pink" data-claim="${esc(q.id)}">${t("quest.claim")}</button>`
          : `<span class="tag">${pct}%</span>`}
        </div>`;
      }
    }
    body.innerHTML = html;
    body.querySelectorAll("[data-claim]").forEach((b) => b.onclick = async () => {
      const r = await Api.claimQuest(b.dataset.claim);
      if (r.ok) { AudioFX.coin(); toast(t("toast.quest_done", { coins: fmtCoins(r.coins || 0) }) + (r.gems ? t("toast.quest_done_gems", { gems: r.gems }) : "")); }
      else toast(r.error || t("toast.couldnt_claim"));
      await App.refresh(); renderQuests(body);
    });
  }

  /* ================= SETTINGS ================= */
  function renderSettings() {
    const body = $("screen-body");
    const s = state.settings || { music: false, sfx: true, quality: "high" };
    body.innerHTML = `
      <div class="toggle-row"><div><b>🎵 ${t("settings.music")}</b><div class="sub">${t("settings.music_desc")}</div></div>
        <button class="switch ${s.music ? "on" : ""}" data-set="music"></button></div>
      <div class="toggle-row"><div><b>🔔 ${t("settings.sfx")}</b><div class="sub">${t("settings.sfx_desc")}</div></div>
        <button class="switch ${s.sfx ? "on" : ""}" data-set="sfx"></button></div>
      <div class="toggle-row" style="border:none"><div><b>✨ ${t("settings.quality")}</b><div class="sub">${t("settings.quality_desc")}</div></div></div>
      <select class="sel" id="set-quality">
        <option value="high" ${s.quality === "high" ? "selected" : ""}>${t("settings.q_high")}</option>
        <option value="medium" ${s.quality === "medium" ? "selected" : ""}>${t("settings.q_medium")}</option>
        <option value="low" ${s.quality === "low" ? "selected" : ""}>${t("settings.q_low")}</option>
      </select>
      <div class="toggle-row"><div><b>🌐 ${t("settings.language")}</b></div>
        <div style="display:flex;gap:6px">
          <button class="pill-btn${I18N.lang === "pt" ? " active" : ""}" data-setlang="pt">${t("lang.pt")}</button>
          <button class="pill-btn${I18N.lang === "en" ? " active" : ""}" data-setlang="en">${t("lang.en")}</button>
          <button class="pill-btn${I18N.lang === "es" ? " active" : ""}" data-setlang="es">${t("lang.es")}</button>
        </div></div>
      <h3>👤 ${t("settings.account")}</h3>
      ${state.user.is_guest ? `
      <div class="guest-banner">
        <div><b>🎮 ${t("settings.guest_title")}</b><div class="sub">${t("settings.guest_desc")}</div></div>
        <button class="pill-btn blue" id="btn-claim" style="width:100%;padding:12px;margin-top:8px">💾 ${t("settings.save_progress")}</button>
        <div id="claim-form" hidden style="margin-top:10px">
          <label class="auth-field"><span class="auth-ico">👤</span><input type="text" id="claim-name" placeholder="${t("auth.name")}" autocomplete="name"></label>
          <label class="auth-field"><span class="auth-ico">✉️</span><input type="email" id="claim-email" placeholder="${t("auth.email")}" autocomplete="email"></label>
          <label class="auth-field"><span class="auth-ico">🔒</span><input type="password" id="claim-pass" placeholder="${t("auth.newpass_min")}" autocomplete="new-password" minlength="6"></label>
          <button class="pill-btn blue" id="btn-save-claim" style="width:100%;padding:12px">${t("settings.create_account")}</button>
          <p class="auth-error" id="claim-error" hidden></p>
          <p class="auth-ok" id="claim-ok" hidden></p>
        </div>
      </div>` : ""}
      <div class="row-card"><div class="grow"><b>${esc(state.user.name)}</b><div class="sub">${esc(state.user.email)}</div></div></div>
      <button class="pill-btn" id="btn-change-pass" style="width:100%;padding:13px;margin-bottom:10px">🔑 ${t("settings.change_password")}</button>
      <div id="change-pass-form" hidden style="margin-bottom:10px">
        <label class="auth-field"><span class="auth-ico">🔒</span><input type="password" id="cp-current" placeholder="${t("settings.current_password")}" autocomplete="current-password"></label>
        <label class="auth-field"><span class="auth-ico">🔒</span><input type="password" id="cp-new" placeholder="${t("settings.new_password")}" autocomplete="new-password" minlength="6"></label>
        <label class="auth-field"><span class="auth-ico">🔒</span><input type="password" id="cp-new2" placeholder="${t("settings.repeat_password")}" autocomplete="new-password" minlength="6"></label>
        <button class="pill-btn blue" id="btn-save-pass" style="width:100%;padding:12px">${t("settings.save_password")}</button>
        <p class="auth-error" id="cp-error" hidden></p>
        <p class="auth-ok" id="cp-ok" hidden></p>
      </div>
      <button class="pill-btn" id="btn-tutorial" style="width:100%;padding:13px;background:linear-gradient(135deg,#7fb8e8,#4a7fc9);margin-bottom:10px">🎓 ${t("settings.replay_tutorial")}</button>
      ${typeof InstallPromo !== "undefined" && !InstallPromo.isStandalone() ? `<button class="pill-btn" id="btn-install-app" style="width:100%;padding:13px;background:linear-gradient(135deg,#5ccb52,#2f9e44);margin-bottom:10px">📲 ${t("settings.install_app")}</button>` : ""}
      <button class="pill-btn" id="btn-logout" style="width:100%;padding:13px;background:linear-gradient(135deg,#e08a9b,#c05a7a)">🚪 ${t("settings.logout")}</button>
      <div class="empty">${t("settings.footer")}</div>
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
    body.querySelectorAll("[data-setlang]").forEach((b) => b.onclick = () => I18N.setLang(b.dataset.setlang));
    $("set-quality").onchange = save;
    // Change password
    $("btn-change-pass").onclick = () => {
      const f = $("change-pass-form");
      f.hidden = !f.hidden;
    };
    $("btn-save-pass").onclick = async () => {
      const err = $("cp-error"), ok = $("cp-ok");
      err.hidden = true; ok.hidden = true;
      const current = $("cp-current").value, np = $("cp-new").value, np2 = $("cp-new2").value;
      if (np.length < 6) { err.textContent = t("settings.pass_min"); err.hidden = false; return; }
      if (np !== np2) { err.textContent = t("settings.pass_mismatch"); err.hidden = false; return; }
      const r = await Api.changePassword(current, np);
      if (r.ok) {
        ok.textContent = t("settings.pass_changed"); ok.hidden = false;
        $("cp-current").value = ""; $("cp-new").value = ""; $("cp-new2").value = "";
        setTimeout(() => { $("change-pass-form").hidden = true; ok.hidden = true; }, 2000);
      } else {
        err.textContent = r.error || t("settings.pass_failed"); err.hidden = false;
      }
    };
    $("btn-logout").onclick = async () => {
      // Guests get a dialog: create account to save, stay, or leave (loses progress)
      if (state.user.is_guest) {
        const choice = await UI.guestLeaveDialog();
        if (choice === "stay") return;
        if (choice === "create") {
          // scroll to the claim form in settings
          const cf = $("claim-form");
          if (cf) { cf.hidden = false; cf.scrollIntoView({ behavior: "smooth", block: "center" }); }
          return;
        }
        localStorage.removeItem("aquanim_guest_token");
      }
      await Api.logout();
      if (typeof Offline !== "undefined") Offline.clearAll();
      location.reload();
    };
    // Guest -> real account
    if ($("btn-claim")) {
      $("btn-claim").onclick = () => { $("claim-form").hidden = !$("claim-form").hidden; };
      $("btn-save-claim").onclick = async () => {
        const err = $("claim-error"), ok = $("claim-ok");
        err.hidden = true; ok.hidden = true;
        const name = $("claim-name").value.trim(), email = $("claim-email").value.trim(), pass = $("claim-pass").value;
        if (!name) { err.textContent = t("auth.err.name"); err.hidden = false; return; }
        if (pass.length < 6) { err.textContent = t("settings.pass_min"); err.hidden = false; return; }
        const r = await Api.claim(name, email, pass);
        if (r.ok) {
          localStorage.removeItem("aquanim_guest_token");
          ok.textContent = t("settings.claim_done"); ok.hidden = false;
          setTimeout(() => App.refresh(), 1500);
        } else {
          err.textContent = r.error || t("settings.claim_failed"); err.hidden = false;
        }
      };
    }
    $("btn-tutorial").onclick = () => {
      if (typeof Tutorial !== "undefined") Tutorial.start();
    };
    const btnInstall = $("btn-install-app");
    if (btnInstall) btnInstall.onclick = () => {
      if (typeof InstallPromo !== "undefined") InstallPromo.show(true);
    };
  }

  /* ================= MINIGAME ================= */
  const MG = { round: 0, times: [], shownAt: 0, timer: null, active: false };
  /* ---------- daily shell game: find the pearl, win 10 diamonds ---------- */
  async function renderShellGame(area) {
    if (!area) return;
    const st = await Api.shellStatus();
    if (!st.ok) { area.innerHTML = `<div class="sub">${st.error || st.message || t("mg.couldnt_load")}</div>`; return; }
    if (!st.canPlay) {
      const ms = Math.max(0, (st.nextAt * 1000) - Date.now());
      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
      area.innerHTML = `<div class="sub">${t("mg.next_in", { h, m })}</div>`;
      return;
    }
    area.innerHTML = `<button class="pill-btn blue" id="shell-start" style="width:100%;padding:12px">${t("mg.play_today")}</button>`;
    $("shell-start").onclick = () => {
      area.innerHTML = `
        <div class="sub" style="text-align:center">${t("mg.watch")}</div>
        <div id="shell-row"></div>
        <div class="shell-result" id="shell-msg"></div>`;
      const row = $("shell-row"), msg = $("shell-msg");
      row.innerHTML = [0, 1, 2].map((i) =>
        `<button class="shell shuffling" data-i="${i}" disabled><img src="assets/minigame/shell_closed.png" alt="🐚"></button>`).join("");
      const shells = [...row.querySelectorAll(".shell")];
      AudioFX.pop();
      // pure theater: the pearl's hiding spot is decided server-side on tap
      setTimeout(() => {
        shells.forEach((s) => { s.classList.remove("shuffling"); s.disabled = false; });
        msg.textContent = t("mg.tap_shell");
        AudioFX.pop();
      }, 1500);
      shells.forEach((s) => s.onclick = async () => {
        const pick = Number(s.dataset.i);
        shells.forEach((x) => { x.disabled = true; x.classList.remove("picked"); });
        s.classList.add("picked");
        msg.textContent = t("mg.opening");
        AudioFX.munch();
        const r = await Api.shellPlay(pick);
        if (!r.ok) {
          msg.textContent = r.error || r.message || t("mg.couldnt_play");
          if (r.nextAt) { const g = MG.shellGen; setTimeout(() => { if (MG.shellGen === g) renderShellGame(area); }, 1500); }
          return;
        }
        shells.forEach((x, i) => {
          x.classList.remove("picked");
          const img = x.querySelector("img");
          if (i === r.winning) {
            if (img) img.src = "assets/minigame/shell_open_pearl.png";
            x.classList.add("reveal");
          } else {
            if (img) img.src = "assets/minigame/shell_open_empty.png";
            x.classList.add("dim");
          }
        });
        if (r.win) {
          AudioFX.coin();
          msg.innerHTML = t("mg.found_pearl", { gems: r.gems });
          toast(t("toast.pearl_found", { gems: r.gems }));
        } else {
          AudioFX.error();
          msg.textContent = t("mg.no_pearl");
        }
        if (window.App && App.refresh) await App.refresh();
      });
    };
  }

  /* ================= WEEKLY EVENT: AUTUMN CRUSH ================= */
  function renderEvent() {
    // Nao reconstruir no meio da partida: App.refresh() (poll de 30s + volta pra aba)
    // chama refreshCurrent(), que remontaria o jogo e mostraria a tela de
    // "Continuar" do nada. Se o jogo ja esta montado, mantem como esta.
    if (window.EventCrush && EventCrush.isMounted && EventCrush.isMounted()) return;
    const body = $("screen-body");
    body.innerHTML = `<div id="ev-root"></div>`;
    if (window.EventCrush) EventCrush.mount(body.querySelector("#ev-root"));
    else body.innerHTML = `<div class="empty">${t("event.couldnt_load")}</div>`;
  }

  /* ================= MAZE EVENT: HELP THE BABY DARKLEAF SCAPE ================= */
  function renderMaze() {
    const body = $("screen-body");
    // Nao reconstruir no meio da partida: App.refresh() (poll de 30s) chama
    // refreshCurrent(), que remontaria o iframe e resetaria o jogo do nada.
    if (body.querySelector("iframe.maze-frame")) return;
    body.classList.add("maze-body");
    body.innerHTML = `<iframe class="maze-frame" src="event-maze/index.html" title="maze" allow="fullscreen"></iframe>`;
  }

  function renderMinigame(root) {
    const body = root || $("screen-body");
    MG.round = 0; MG.times = []; MG.active = false;
    body.innerHTML = `
      <div class="shell-box">
        <div class="shell-title">🐚 ${t("mg.shell_title")}</div>
        <div class="sub">${t("mg.shell_desc")}</div>
        <div id="shell-area" style="margin-top:8px"></div>
      </div>
      <div class="sub" style="margin:10px 0 8px;font-weight:800">🎮 ${t("mg.title")}</div>
      <div class="sub" style="margin-bottom:8px">${t("mg.tapfish_desc")}</div>
      <div class="mg-hud"><span>${t("mg.round")} <b id="mg-round">0</b>/8</span><span id="mg-last"></span></div>
      <div id="mg-stage"><img id="mg-fish" alt="🐟"></div>
      <div class="big-score" id="mg-result"></div>
      <button class="pill-btn pink" id="mg-start" style="width:100%;padding:13px">▶ ${t("mg.start")}</button>`;
    renderShellGame($("shell-area"));
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
      $("mg-result").innerHTML = t("mg.result", { avg: Math.round(avg), score });
      $("mg-start").textContent = "↻ " + t("mg.play_again");
      const r = await Api.minigameFinish(score);
      if (r.ok) {
        AudioFX.coin();
        $("mg-result").innerHTML += t("mg.coins_won", { coins: fmtCoins(r.coins) });
        toast(t("toast.mg_coins", { coins: fmtCoins(r.coins) }));
      } else toast(r.error || t("toast.score_not_saved"));
      await App.refresh();
    }
    $("mg-start").onclick = () => {
      MG.active = true; MG.round = 0; MG.times = [];
      $("mg-result").innerHTML = ""; $("mg-last").textContent = "";
      $("mg-start").style.display = "none";
      nextRound();
    };
  }

  /* ================= COMMUNITY (chat + user market tabs) ================= */
  let communityTab = "chat";
  function renderCommunity() {
    const body = $("screen-body");
    if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
    body.classList.toggle("chat-screen", communityTab === "chat");
    body.innerHTML = `<div class="tabbar comm-tabs">
        <button class="pill-btn${communityTab === "chat" ? " active" : ""}" data-ctab="chat">${ICON("chat")}<span>${t("chat.title")}</span></button>
        <button class="pill-btn${communityTab === "friends" ? " active" : ""}" data-ctab="friends">${ICON("community")}<span>${t("friends.title")}</span></button>
        <button class="pill-btn${communityTab === "market" ? " active" : ""}" data-ctab="market"><img src="assets/icons/icon_diamond.png" alt=""><span>${t("market.title")}</span></button>
      </div><div id="comm-body"></div>`;
    body.querySelectorAll("[data-ctab]").forEach((b) => b.onclick = () => { communityTab = b.dataset.ctab; renderCommunity(); });
    const sub = $("comm-body");
    if (communityTab === "chat") renderChat(sub);
    else if (communityTab === "friends") renderFriends(sub);
    else renderMarket(sub);
  }

  /* ================= FRIENDS ================= */
  async function renderFriends(root) {
    const body = root || $("screen-body");
    if (state.user && state.user.is_guest) {
      body.innerHTML = `<div class="empty">${t("friends.guest_only")}</div>`;
      return;
    }
    body.innerHTML = `<div class="empty">${t("friends.loading")}</div>`;
    const r = await Api.friends();
    if (!r.ok) { body.innerHTML = `<div class="empty">${t("friends.couldnt_load")}</div>`; return; }
    const incoming = r.incoming || [], friends = r.friends || [];
    let html = `
      <div class="friend-search">
        <input id="fq" maxlength="24" placeholder="${t("friends.search_ph")}" autocomplete="off">
        <button class="pill-btn" id="fq-go">${t("friends.search")}</button>
      </div>
      <div id="fq-results"></div>`;
    if (incoming.length) {
      html += `<div class="sec-title">${t("friends.requests")} (${incoming.length})</div>` +
        incoming.map((u) => `<div class="row-card"><button class="prof-link grow" data-prof="${u.id}">${esc(u.name)}</button>
          <button class="pill-btn" data-acc="${u.id}">${t("friends.accept")}</button>
          <button class="pill-btn" data-dec="${u.id}">${t("friends.decline")}</button></div>`).join("");
    }
    html += `<div class="sec-title">${t("friends.title")} (${friends.length})</div>`;
    html += friends.length
      ? friends.map((u) => `<div class="row-card"><button class="prof-link grow" data-prof="${u.id}">${esc(u.name)}</button>
          <button class="pill-btn" data-rm="${u.id}">${t("friends.remove")}</button></div>`).join("")
      : `<div class="empty">${t("friends.empty")}</div>`;
    body.innerHTML = html;

    const doSearch = async () => {
      const q = $("fq").value.trim();
      const box = $("fq-results");
      if (q.length < 2) { box.innerHTML = ""; return; }
      const s = await Api.friendsSearch(q);
      if (!s.ok || !s.users.length) {
        box.innerHTML = `<div class="empty">${t("friends.no_results")}</div>`; return;
      }
      box.innerHTML = s.users.map((u) => {
        const st = u.my_status || u.their_status;
        let right;
        if (st === "accepted") right = `<span class="muted">${t("friends.is_friend")}</span>`;
        else if (u.my_status === "pending") right = `<button class="pill-btn" data-cancel="${u.id}">${t("friends.cancel")}</button>`;
        else if (u.their_status === "pending") right = `<span class="muted">${t("friends.requested_you")}</span>`;
        else right = `<button class="pill-btn" data-add="${u.id}">${t("friends.add")}</button>`;
        return `<div class="row-card"><button class="prof-link grow" data-prof="${u.id}">${esc(u.name)}</button>${right}</div>`;
      }).join("");
      box.querySelectorAll("[data-add]").forEach((b) => b.onclick = async () => {
        b.disabled = true;
        const rr = await Api.friendRequest(+b.dataset.add);
        if (rr.ok) { toast(t("friends.req_sent")); doSearch(); }
        else { b.disabled = false; toast(rr.error || t("friends.error")); }
      });
      box.querySelectorAll("[data-cancel]").forEach((b) => b.onclick = async () => {
        await Api.friendRemove(+b.dataset.cancel); doSearch();
      });
      box.querySelectorAll("[data-prof]").forEach((b) => b.onclick = () => open("profile", +b.dataset.prof));
    };
    $("fq-go").onclick = doSearch;
    $("fq").onkeydown = (e) => { if (e.key === "Enter") doSearch(); };
    body.querySelectorAll("[data-prof]").forEach((b) => b.onclick = () => open("profile", +b.dataset.prof));
    body.querySelectorAll("[data-acc]").forEach((b) => b.onclick = async () => {
      b.disabled = true;
      const rr = await Api.friendRespond(+b.dataset.acc, true);
      if (rr.ok) { toast(t("friends.now_friends")); renderFriends(body); }
      else { b.disabled = false; toast(rr.error || t("friends.error")); }
    });
    body.querySelectorAll("[data-dec]").forEach((b) => b.onclick = async () => {
      await Api.friendRespond(+b.dataset.dec, false); renderFriends(body);
    });
    body.querySelectorAll("[data-rm]").forEach((b) => b.onclick = async () => {
      b.disabled = true;
      await Api.friendRemove(+b.dataset.rm);
      toast(t("friends.removed")); renderFriends(body);
    });
  }

  /* ================= PROFILE ================= */
  let profileUserId = null; // null = my own profile
  let visitId = null, visitName = "";
  function memberSince(ts) {
    try {
      return new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short" });
    } catch (e) { return ""; }
  }
  function downscaleImage(file, maxSize) {
    // profile photos: shrink to <=maxSize px, JPEG — keeps uploads tiny
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const sc = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * sc));
        const h = Math.max(1, Math.round(img.height * sc));
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL("image/jpeg", .82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  function avatarHtml(p, cls) {
    if (p.avatar_url) return `<img class="${cls || "prof-avatar"}" src="${esc(p.avatar_url)}" alt="">`;
    return `<div class="${cls || "prof-avatar"}">${esc((p.name || "?").trim().charAt(0).toUpperCase())}</div>`;
  }
  async function renderProfile() {
    const body = $("screen-body");
    body.innerHTML = `<div class="empty">${t("profile.loading")}</div>`;
    const r = profileUserId ? await Api.profileOf(profileUserId) : await Api.profile();
    if (!r.ok || !r.profile) {
      body.innerHTML = `<div class="empty">${t("profile.couldnt_load")}</div>`; return;
    }
    const p = r.profile;
    const stats = [
      { ic: "🐠", v: p.fish, l: t("profile.fish") },
      { ic: "👥", v: p.friends, l: t("profile.friends") },
    ];
    if (p.mine) {
      stats.push({ ic: "🪑", v: p.tanks, l: t("profile.tanks") });
      stats.push({ ic: "🪙", v: fmtCoins(p.coins), l: t("profile.coins") });
      stats.push({ ic: "💎", v: fmtCoins(p.gems), l: t("profile.gems") });
      stats.push({ ic: "✨", v: fmtCoins(p.xp), l: t("profile.xp") });
    }
    const coll = (p.collection || []).slice(0, 24);
    let html = `
      <div class="prof-head">
        <div class="prof-avwrap">${avatarHtml(p)}
          ${p.mine ? `<button class="prof-cam" id="prof-photo" title="${t("profile.photo")}">📷</button>
          <input type="file" id="prof-file" accept="image/png,image/jpeg,image/webp" hidden>` : ``}
        </div>
        <div class="prof-id">
          <div class="prof-name">${esc(p.name)}</div>
          <div class="prof-sub"><span class="lvl-chip">${t("profile.level")} ${p.level}</span>
            <span class="muted"> · ${t("profile.since")} ${memberSince(p.created_at)}</span></div>
        </div>
      </div>
      ${p.bio ? `<div class="prof-bio">${esc(p.bio)}</div>` : ``}
      ${p.mine ? `<div class="prof-edit">
          <input id="prof-bio" maxlength="160" value="${esc(p.bio || "")}" placeholder="${t("profile.bio_ph")}" autocomplete="off">
          <button class="pill-btn" id="prof-biosave">${t("profile.save")}</button>
        </div>` : ``}
      <div class="prof-grid">` +
      stats.map((s) => `<div class="card prof-stat"><div class="pv-ic">${s.ic}</div><div class="pv">${s.v}</div><div class="sub">${s.l}</div></div>`).join("") +
      `</div>
      <div class="sec-title">🐟 ${t("profile.collection")} (${(p.collection || []).length})</div>
      <div class="prof-coll">` +
      (coll.length ? coll.map((c) => `<div class="prof-fish">${fishImg(c.species_id)}<span>${c.count > 1 ? "×" + c.count : ""}</span></div>`).join("")
        : `<div class="empty">${t("profile.no_collection")}</div>`) +
      `</div>`;
    if (p.mine) {
      html += `<div class="prof-edit">
          <input id="prof-name" maxlength="24" value="${esc(p.name)}" autocomplete="off">
          <button class="pill-btn" id="prof-save">${t("profile.save_name")}</button>
        </div>`;
    } else {
      html += `<div class="prof-actions">
          <button class="pill-btn" id="prof-visit">🐠 ${t("profile.visit")}</button>`;
      if (p.relation === "accepted") html += `<button class="pill-btn" id="prof-rm">${t("friends.remove")}</button>`;
      html += `</div>`;
    }
    body.innerHTML = html;
    if (p.mine) {
      $("prof-save").onclick = async () => {
        const nm = $("prof-name").value.trim();
        const rr = await Api.profileRename(nm);
        if (rr.ok) { toast(t("profile.name_saved")); await App.refresh(); renderProfile(); }
        else toast(rr.error || t("profile.error"));
      };
      $("prof-biosave").onclick = async () => {
        const b = $("prof-bio").value.trim();
        const rr = await Api.profileBio(b);
        if (rr.ok) { toast(t("profile.bio_saved")); renderProfile(); }
        else toast(rr.error || t("profile.error"));
      };
      $("prof-photo").onclick = () => $("prof-file").click();
      $("prof-file").onchange = async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const dataUrl = await downscaleImage(f, 256);
        if (!dataUrl) { toast(t("profile.error")); return; }
        toast(t("profile.uploading"));
        const rr = await Api.profileAvatar(dataUrl);
        if (rr.ok) { toast(t("profile.photo_saved")); await App.refresh(); renderProfile(); }
        else toast(rr.error || t("profile.error"));
      };
    } else {
      $("prof-visit").onclick = () => { visitId = p.id; visitName = p.name; open("visit"); };
      const b = $("prof-rm");
      if (b) b.onclick = async () => {
        b.disabled = true;
        await Api.friendRemove(p.id);
        toast(t("friends.removed"));
        open("community", "friends");
      };
    }
  }

  /* ================= VISIT A FRIEND'S AQUARIUM (read-only) ================= */
  let visitView = null;
  function killVisitView() {
    if (visitView) { try { visitView.destroy(); } catch (e) { /* ignore */ } visitView = null; }
  }
  async function renderVisit() {
    killVisitView();
    const body = $("screen-body");
    body.innerHTML = `<div class="visit-bar">
        <button class="pill-btn" id="visit-back">← ${esc(visitName)}</button>
      </div><div class="empty">${t("profile.visit_loading")}</div>`;
    $("visit-back").onclick = () => open("profile", visitId);
    const r = await Api.visitTank(visitId);
    if (!r.ok || !r.visit) {
      body.querySelector(".empty").textContent = t("profile.couldnt_load"); return;
    }
    body.innerHTML = `<div class="visit-bar">
        <button class="pill-btn" id="visit-back">← ${esc(visitName)}</button>
        <span class="muted">${t("profile.visit_hint")}</span>
      </div><canvas id="visit-canvas" class="visit-canvas"></canvas>`;
    $("visit-back").onclick = () => open("profile", visitId);
    visitView = new TankView($("visit-canvas"));
    visitView.setReadOnly(true);
    const dc = await Api.decorCatalog();
    if (dc.ok && dc.items) visitView.setDecoCatalog(dc.items);
    visitView.syncState({
      tanks: { active: r.visit.tier, activeNum: r.visit.tank_num },
      fish: r.visit.fish || [],
      placements: r.visit.placements || [],
      dirt: { spots: [], green: false },
    });
  }

  async function renderMarket(root) {
    const body = root || $("screen-body");
    body.innerHTML = `<div class="empty">${t("market.loading")}</div>`;
    const r = await Api.marketListings();
    if (!r.ok) { body.innerHTML = `<div class="empty">${t("market.couldnt_load")}</div>`; return; }
    const me = state.user && state.user.id;
    let html = `<div class="sub" style="margin-bottom:8px">${t("market.intro")}</div>
    <button class="pill-btn gold" id="mk-add" style="margin-bottom:8px">${t("market.add_fish")}</button>`;
    if (!r.listings.length) {
      html += `<div class="empty">${t("market.empty")}</div>`;
    }
    for (const l of r.listings) {
      const f = l.fish, lin = f.lineage || {};
      const tags = [];
      if (lin.hybrid) tags.push("✨ " + t("tag.hybrid"));
      if (lin.generation) tags.push(t("tag.gen", { n: lin.generation }));
      if (f.origin === "event") tags.push("🏆 " + t("tag.event"));
      if (f.origin === "bred" && !lin.hybrid) tags.push("🧬 " + t("tag.bred"));
      const own = l.seller_id === me;
      html += `<div class="row-card">${fishImg(f.species_id, 0, f.gender)}<div class="grow">
        <b>${esc(f.nickname || f.name)}</b>
        <span class="tag">${f.gender === "male" ? "♂" : "♀"}</span>${tags.map((t) => ` <span class="tag">${t}</span>`).join("")}
        <div class="sub">${esc(f.name)} · ${t("market.seller", { name: esc(l.seller_name || t("market.player")) })}</div></div>
        <div style="text-align:right;flex-shrink:0">
          <div class="mk-price">${CUR_GEM} ${l.price_diamonds}</div>
          ${own
            ? `<button class="pill-btn" data-mkcancel="${l.listing_id}">${t("market.cancel")}</button>`
            : `<button class="pill-btn gold" data-mkbuy="${l.listing_id}">${t("shop.buy")}</button>`}
        </div></div>`;
    }
    body.innerHTML = html;
    $("mk-add").onclick = () => renderMarketAdd(body);
    body.querySelectorAll("[data-mkbuy]").forEach((b) => b.onclick = async () => {
      const id = Number(b.dataset.mkbuy);
      if (!confirm(htmlToText(t("market.confirm_buy")))) return;
      b.disabled = true;
      const r2 = await Api.marketBuy(id);
      if (r2.ok) { AudioFX.coin(); toast(t("toast.fish_bought")); await App.refresh(); renderMarket(body); }
      else { AudioFX.error(); toast(r2.error || t("toast.buy_failed")); b.disabled = false; }
    });
    body.querySelectorAll("[data-mkcancel]").forEach((b) => b.onclick = async () => {
      const r2 = await Api.marketCancel(Number(b.dataset.mkcancel));
      if (r2.ok) { toast(t("toast.listing_cancelled")); await App.refresh(); renderMarket(body); }
      else toast(r2.error || t("toast.cancel_failed"));
    });
  }

  /* ---------- market: add fish (event + hybrid only) ---------- */
  function renderMarketAdd(root) {
    const body = root || $("screen-body");
    const cands = (state.fish || []).filter((f) =>
      f.tradeable && f.location !== "market" &&
      (f.origin === "event" || (f.lineage && f.lineage.hybrid)));
    let html = `<button class="pill-btn" id="mk-back">← ${t("market.back")}</button>
      <div class="fm-note" style="margin:8px 0">${t("market.only_tradable")}</div>`;
    if (!cands.length) {
      html += `<div class="empty">${t("market.no_tradable")}</div>`;
    }
    for (const f of cands) {
      const tags = [];
      if (f.origin === "event") tags.push("🏆 " + t("tag.event"));
      if (f.lineage && f.lineage.hybrid) tags.push("✨ " + t("tag.hybrid"));
      html += `<div class="row-card">${fishImg(f.species_id, 0, f.gender)}<div class="grow">
        <b>${esc(f.nickname || f.name)}</b>
        <span class="tag">${f.gender === "male" ? "♂" : "♀"}</span>${tags.map((t) => ` <span class="tag">${t}</span>`).join("")}
        <div class="sub">${esc(speciesName(f.species_id))}</div></div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
          <input id="mkp-${f.id}" type="number" min="1" max="999999" placeholder="💎"
            style="width:90px;padding:10px;border-radius:12px;border:2px solid var(--pink-d)" />
          <button class="pill-btn gold" data-mkadd="${f.id}">${t("market.list")}</button>
        </div></div>`;
    }
    body.innerHTML = html;
    $("mk-back").onclick = () => renderMarket(body);
    body.querySelectorAll("[data-mkadd]").forEach((b) => b.onclick = async () => {
      const id = Number(b.dataset.mkadd);
      const price = Math.floor(Number($(`mkp-${id}`).value));
      if (!price || price < 1 || price > 999999) { toast(t("toast.enter_price")); return; }
      if (!confirm(htmlToText(t("fishmenu.confirm_list", { price })))) return;
      b.disabled = true;
      const r = await Api.marketList(id, price);
      if (r.ok) { AudioFX.coin(); toast(t("toast.listed")); await App.refresh(); renderMarketAdd(body); }
      else { AudioFX.error(); toast(r.error || t("toast.couldnt_list")); b.disabled = false; }
    });
  }

  // ---------- public chat ----------
  let chatTimer = null, chatLastId = 0, chatBusy = false;
  function chatMsgHtml(m) {
    const mine = state.user && m.user_id === state.user.id;
    const time = new Date(m.created_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `<div class="chat-msg${mine ? " mine" : ""}"><div class="chat-bubble">` +
      `<div class="chat-name">${esc(m.name)}</div>` +
      `<div class="chat-text">${esc(m.text)}</div>` +
      `<div class="chat-time">${time}</div></div></div>`;
  }
  async function renderChat(root) {
    const body = root || $("screen-body");
    if (body === $("screen-body")) body.classList.add("chat-screen");
    body.innerHTML = `<div id="chat-list" class="chat-list"><div class="empty">${t("chat.loading")}</div></div>
      <div class="chat-input-row">
        <input id="chat-input" maxlength="200" placeholder="${esc(t("chat.placeholder"))}" autocomplete="off" />
        <button class="pill-btn pink" id="chat-send">➤</button>
      </div>`;
    const list = $("chat-list"), input = $("chat-input");
    chatLastId = 0;
    const scrollDown = () => { list.scrollTop = list.scrollHeight; };
    const load = async (after) => {
      if (chatBusy || $("screen-overlay").hidden) return;
      chatBusy = true;
      try {
        const r = await Api.chatMessages(after);
        if (r.ok && r.messages) {
          if (!after) list.innerHTML = "";
          let added = false;
          for (const m of r.messages) {
            if (m.id <= chatLastId) continue;
            chatLastId = Math.max(chatLastId, m.id);
            list.insertAdjacentHTML("beforeend", chatMsgHtml(m));
            added = true;
          }
          if (!after && !added) list.innerHTML = `<div class="empty">${t("chat.empty")}</div>`;
          if (added) scrollDown();
        }
      } catch (e) { /* keep polling */ }
      chatBusy = false;
    };
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      const r = await Api.chatSend(text);
      if (r.ok) load(chatLastId);
      else {
        toast(r.error === "slow down" ? t("chat.slow_down") : (r.error || t("toast.error")));
        input.value = text;
      }
    };
    $("chat-send").onclick = send;
    input.onkeydown = (e) => { if (e.key === "Enter") send(); };
    await load(0);
    if (chatTimer) clearInterval(chatTimer);
    chatTimer = setInterval(() => load(chatLastId), 10000);
  }

  const RENDER = {
    aquariums: renderAquariums, shop: renderShopScreen, lab: renderLab,
    collection: renderCollection, inventory: renderInventory, quests: renderQuestsScreen,
    settings: renderSettings, minigame: renderMinigame, event: renderEvent,
    maze: renderMaze,
    market: renderMarket, chat: renderChat, community: renderCommunity,
    gemshop: renderGemShop,
    coinshop: renderCoinShop,
    foodshop: renderFoodShop,
    profile: renderProfile,
    visit: renderVisit,
  };

  function guestLeaveDialog() {
    return new Promise((resolve) => {
      const ov = document.createElement("div");
      ov.className = "guest-leave-overlay";
      ov.innerHTML = `
        <div class="guest-leave-card">
          <div class="guest-leave-title">⚠️ ${t("settings.guest_leave_title")}</div>
          <p>${t("settings.guest_leave_warn")}</p>
          <button class="pill-btn blue" data-choice="create" style="width:100%;padding:13px;margin-bottom:8px">💾 ${t("settings.guest_leave_create")}</button>
          <button class="pill-btn" data-choice="stay" style="width:100%;padding:13px;margin-bottom:8px;background:linear-gradient(135deg,#5ccb52,#2f9e44)">▶️ ${t("settings.guest_leave_stay")}</button>
          <button class="pill-btn" data-choice="leave" style="width:100%;padding:13px;background:linear-gradient(135deg,#e08a9b,#c05a7a)">🚪 ${t("settings.guest_leave_yes")}</button>
        </div>`;
      const done = (choice) => { ov.remove(); resolve(choice); };
      ov.querySelectorAll("[data-choice]").forEach((b) => b.onclick = () => done(b.dataset.choice));
      ov.onclick = (e) => { if (e.target === ov) done("stay"); };
      document.body.appendChild(ov);
    });
  }

  // Gentle non-blocking nudge for guests: small banner, dismissible.
  // onCreate: called when the user taps "save progress".
  function guestNudge(onCreate) {
    document.querySelector(".guest-nudge")?.remove();
    const el = document.createElement("div");
    el.className = "guest-nudge";
    el.innerHTML = `
      <div class="guest-nudge-text">💾 ${t("settings.guest_nudge")}</div>
      <button class="pill-btn blue guest-nudge-btn">${t("settings.guest_nudge_btn")}</button>
      <button class="guest-nudge-x" aria-label="×">×</button>`;
    el.querySelector(".guest-nudge-x").onclick = () => el.remove();
    el.querySelector(".guest-nudge-btn").onclick = () => { el.remove(); onCreate && onCreate(); };
    // auto-dismiss after 30s
    setTimeout(() => el.remove(), 30000);
    document.body.appendChild(el);
  }

  return {
    toast, updateHUD, updateTankSwitcher, open, close, showTankFullPopup, closeTankFullPopup,
    openFishMenu, closeFishMenu, openBreedingWith, openFeedChoice, closeFeedChoice, guestLeaveDialog,
    guestNudge,
    setCatalogs(f, d) { fishCatalog = f; decorCatalog = d; },
    get decorCatalog() { return decorCatalog; },
    refreshCurrent() {
      if (currentScreen && !$("screen-overlay").hidden && RENDER[currentScreen]) RENDER[currentScreen]();
    },
  };
})();
