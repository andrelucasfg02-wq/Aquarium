/* api.js — fetch wrapper + all endpoints per API_CONTRACT.md */
"use strict";

const Api = (() => {
  let onAuthFail = () => {};

  async function req(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      return { ok: false, error: "network", message: "No connection to the server 🛜" };
    }
    if (res.status === 401) { onAuthFail(); return { ok: false, error: "auth" }; }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `Server error ${res.status}`;
      return { ok: false, error: msg, status: res.status };
    }
    return data || { ok: true };
  }
  const get = (p) => req("GET", p);
  const post = (p, b) => req("POST", p, b || {});

  return {
    onAuthFail(fn) { onAuthFail = fn; },
    register: (name, email, password) => post("/api/register", { name, email, password }),
    login: (email, password) => post("/api/login", { email, password }),
    passwordForgot: (email) => post("/api/password/forgot", { email }),
    passwordReset: (token, password) => post("/api/password/reset", { token, password }),
    logout: () => post("/api/logout"),
    me: () => get("/api/me"),
    state: () => get("/api/state"),
    fishCatalog: () => post("/api/shop/fish"),
    buyFish: (species_id) => post("/api/shop/fish/buy", { species_id }),
    sellFish: (fish_id) => post("/api/fish/sell", { fish_id }),
    feed: () => post("/api/fish/feed"),
    tapFish: (fish_id) => post("/api/fish/tap", { fish_id }),
    feedOne: (fish_id) => post("/api/fish/feed-one", { fish_id }),
    treatFish: (fish_id) => post("/api/fish/treat", { fish_id }),
    collectCoins: (fish_id) => post("/api/fish/collect", { fish_id }),
    buyMedicine: (qty) => post("/api/shop/medicine/buy", { qty }),
    buyTank: (tier) => post("/api/tanks/buy", { tier }),
    switchTank: (tier) => post("/api/tanks/switch", { tier }),
    buyExtraSlot: (tank) => post("/api/tanks/extra-slot", { tank }),
    breedingPartners: (fish_id) => get(`/api/breeding/partners?fish_id=${encodeURIComponent(fish_id)}`),
    breed: (male_id, female_id) => post("/api/breeding/breed", { male_id, female_id }),
    wipeDirt: (ids) => post("/api/dirt/wipe", { ids }),
    filterDirt: () => post("/api/dirt/filter"),
    decorCatalog: () => get("/api/shop/decor"),
    buyDecor: (deco_id) => post("/api/shop/decor/buy", { deco_id }),
    placeDecor: (deco_id, tank, x, y) => post("/api/decor/place", { deco_id, tank, x, y }),
    moveDecor: (id, x, y) => post("/api/decor/move", { id, x, y }),
    removeDecor: (id) => post("/api/decor/remove", { id }),
    claimQuest: (quest_id) => post("/api/quests/claim", { quest_id }),
    buyFood: (qty) => post("/api/shop/food/buy", { qty }),
    buyCoins: (pack) => post("/api/shop/coins/buy", { pack }),
    saveSettings: (music, sfx, quality) => post("/api/settings", { music, sfx, quality }),
    minigameFinish: (score) => post("/api/minigame/finish", { score }),
    shellStatus: () => get("/api/shell/status"),
    shellPlay: (pick) => post("/api/shell/play", { pick }),
    eventProgress: (event) => get(`/api/event/progress?event=${encodeURIComponent(event)}`),
    eventSave: (event, score, level, moves) => post("/api/event/progress", { event, score, level, moves }),
    eventClaim: (event) => post("/api/event/claim", { event }),
    transferFish: (fish_id, tier) => post("/api/fish/transfer", { fish_id, tier }),
    renameFish: (fish_id, name) => post("/api/fish/rename", { fish_id, name }),
    marketListings: () => get("/api/market/listings"),
    marketList: (fish_id, price_diamonds) => post("/api/market/list", { fish_id, price_diamonds }),
    chatMessages: (after) => get("/api/chat" + (after ? "?after=" + after : "")),
    chatSend: (text) => post("/api/chat/send", { text }),
    marketCancel: (listing_id) => post("/api/market/cancel", { listing_id }),
    marketBuy: (listing_id) => post("/api/market/buy", { listing_id }),
  };
})();
