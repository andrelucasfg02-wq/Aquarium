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
      // possibly offline: queueable actions / cached state via Offline module
      if (typeof Offline !== "undefined") {
        try {
          const off = await Offline.onNetworkFail(method, path, body);
          if (off) return off;
        } catch (e2) { /* fall through to network error */ }
      }
      return { ok: false, error: "network", message: "No connection to the server 🛜" };
    }
    if (res.status === 401) { onAuthFail(); return { ok: false, error: "auth" }; }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `Server error ${res.status}`;
      return { ok: false, error: msg, status: res.status };
    }
    const out = data || { ok: true };
    // offline support: anchor the monotonic clock + cache full state
    if (typeof Offline !== "undefined") {
      try {
        if (out.server_time) Offline.setAnchor(out.server_time);
        if (path === "/api/state" && out.state) Offline.saveState(out.state);
      } catch (e) { /* non-fatal */ }
    }
    return out;
  }
  const get = (p) => req("GET", p);
  const post = (p, b) => req("POST", p, b || {});

  return {
    onAuthFail(fn) { onAuthFail = fn; },
    register: (name, email, password) => post("/api/register", { name, email, password }),
    login: (email, password) => post("/api/login", { email, password }),
    guest: (guest_token) => post("/api/guest", { guest_token }),
    claim: (name, email, password) => post("/api/claim", { name, email, password }),
    passwordForgot: (email) => post("/api/password/forgot", { email }),
    passwordReset: (token, password) => post("/api/password/reset", { token, password }),
    logout: () => post("/api/logout"),
    changePassword: (current, password) => post("/api/password/change", { current, password }),
    me: () => get("/api/me"),
    state: async () => {
      // flush any queued offline actions first (sync returns fresh state)
      if (typeof Offline !== "undefined") {
        try {
          const s = await Offline.syncIfNeeded();
          if (s && s.ok) return s;
          if (s && s.error === "auth") return s;
        } catch (e) { /* fall through to normal state */ }
      }
      return get("/api/state");
    },
    fishCatalog: () => post("/api/shop/fish"),
    buyFish: (species_id) => post("/api/shop/fish/buy", { species_id }),
    sellFish: (fish_id) => post("/api/fish/sell", { fish_id }),
    feed: (kind) => post("/api/fish/feed", { kind }),
    coryClean: (spotId, fishId) => post("/api/dirt/cory-clean", { spot_id: spotId, fish_id: fishId }),
    tapFish: (fish_id) => post("/api/fish/tap", { fish_id }),
    feedOne: (fish_id) => post("/api/fish/feed-one", { fish_id }),
    treatFish: (fish_id) => post("/api/fish/treat", { fish_id }),
    collectCoins: (fish_id) => post("/api/fish/collect", { fish_id }),
    buyMedicine: (qty) => post("/api/shop/medicine/buy", { qty }),
    buyTank: (tier) => post("/api/tanks/buy", { tier }),
    switchTank: (tier, num) => post("/api/tanks/switch", { tier, num }),
    buyExtraSlot: (tank) => post("/api/tanks/extra-slot", { tank }),
    breedingPartners: (fish_id) => get(`/api/breeding/partners?fish_id=${encodeURIComponent(fish_id)}`),
    breed: (male_id, female_id) => post("/api/breeding/breed", { male_id, female_id }),
    wipeDirt: (ids) => post("/api/dirt/wipe", { ids }),
    filterDirt: () => post("/api/dirt/filter"),
    decorCatalog: () => get("/api/decor/catalog"),
    buyDecor: (deco_id) => post("/api/shop/decor/buy", { deco_id }),
    placeDecor: (deco_id, tank, x, y, tank_num) => post("/api/decor/place", { deco_id, tank, x, y, tank_num }),
    moveDecor: (id, x, y) => post("/api/decor/move", { id, x, y }),
    removeDecor: (id) => post("/api/decor/remove", { id }),
    collectAllDecor: (tank, tank_num) => post("/api/decor/collect-all", { tank, tank_num }),
    claimQuest: (quest_id) => post("/api/quests/claim", { quest_id }),
    buyFood: (qty, kind) => post("/api/shop/food/buy", { qty, kind }),
    buyCoins: (pack) => post("/api/shop/coins/buy", { pack }),
    diamondPrices: () => get("/api/shop/diamonds/prices"),
    diamondCheckout: (gems) => post("/api/shop/diamonds/checkout", { gems }),
    friends: () => get("/api/friends"),
    friendsSearch: (q) => get(`/api/friends/search?q=${encodeURIComponent(q)}`),
    friendRequest: (user_id) => post("/api/friends/request", { user_id }),
    friendRespond: (user_id, accept) => post("/api/friends/respond", { user_id, accept }),
    friendRemove: (user_id) => post("/api/friends/remove", { user_id }),
    saveSettings: (music, sfx, quality) => post("/api/settings", { music, sfx, quality }),
    minigameFinish: (score) => post("/api/minigame/finish", { score }),
    shellStatus: () => get("/api/shell/status"),
    shellPlay: (pick) => post("/api/shell/play", { pick }),
    eventProgress: (event) => get(`/api/event/progress?event=${encodeURIComponent(event)}`),
    eventSave: (event, score, level, moves) => post("/api/event/progress", { event, score, level, moves }),
    eventClaim: (event) => post("/api/event/claim", { event }),
    eventLevelClaim: (event, level) => post("/api/event/level-claim", { event, level }),
    transferFish: (fish_id, tier, num) => post("/api/fish/transfer", { fish_id, tier, num }),
    renameFish: (fish_id, name) => post("/api/fish/rename", { fish_id, name }),
    marketListings: () => get("/api/market/listings"),
    marketList: (fish_id, price_diamonds) => post("/api/market/list", { fish_id, price_diamonds }),
    chatMessages: (after) => get("/api/chat" + (after ? "?after=" + after : "")),
    chatSend: (text) => post("/api/chat/send", { text }),
    marketCancel: (listing_id) => post("/api/market/cancel", { listing_id }),
    marketBuy: (listing_id) => post("/api/market/buy", { listing_id }),
  };
})();
