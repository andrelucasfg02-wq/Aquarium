/* offline.js — AquaNim offline mode.
 *
 * How it works:
 * - Every successful /api/state or /api/sync response is cached in IndexedDB,
 *   together with a monotonic clock anchor {serverTime, perfNow}.
 * - The monotonic clock estimates server time as
 *     serverTime + (performance.now() - perfNow) / 1000
 *   performance.now() never jumps when the phone's wall clock changes, so
 *   changing the device clock cannot forge action timestamps.
 * - While offline, queueable actions (feed, feed-one, treat, collect, tap,
 *   breed) are stored with monotonic timestamps and applied optimistically
 *   to the cached state so the UI keeps working.
 * - On reconnect, POST /api/sync replays the queue server-side with the same
 *   validation as the live endpoints, then returns fresh state.
 * Anti-cheat is enforced server-side (see POST /sync in server/routes/game.js):
 * coin collects only pay server-banked coin_pending, breed RNG rolls at sync.
 */
"use strict";

const Offline = (() => {
  const DB_NAME = "aquanim-offline";
  const STORE = "kv";
  let dbPromise = null;
  let mem = { state: null, queue: null, clock: null, queueUser: null };
  let onlineTestOverride = null; // tests only

  function idb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    });
    return dbPromise;
  }

  async function kvGet(key) {
    if (mem[key] !== undefined && mem[key] !== null) return mem[key];
    try {
      const db = await idb();
      const v = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const r = tx.objectStore(STORE).get(key);
        r.onsuccess = () => resolve(r.result === undefined ? null : r.result);
        r.onerror = () => reject(r.error);
      });
      mem[key] = v;
      return v;
    } catch (e) { return mem[key]; }
  }

  async function kvSet(key, val) {
    mem[key] = val;
    try {
      const db = await idb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { /* memory-only fallback */ }
  }

  /* ---------- monotonic clock (server-time estimate, seconds) ---------- */
  function now() {
    const c = mem.clock;
    if (!c || !c.serverTime) return Math.floor(Date.now() / 1000);
    return Math.floor(c.serverTime + (performance.now() - c.perfNow) / 1000);
  }

  function setAnchor(serverTime) {
    if (!serverTime) return;
    mem.clock = { serverTime: Math.floor(serverTime), perfNow: performance.now() };
    kvSet("clock", mem.clock);
  }

  /* ---------- state cache ---------- */
  async function saveState(state) {
    await kvSet("state", state);
  }
  async function cachedState() {
    return kvGet("state");
  }

  /* ---------- action queue (per user) ---------- */
  async function getQueue() {
    const q = await kvGet("queue");
    return Array.isArray(q) ? q : [];
  }
  async function queueLen() {
    return (await getQueue()).length;
  }

  function isOnline() {
    if (onlineTestOverride !== null) return onlineTestOverride;
    return typeof navigator === "undefined" || navigator.onLine !== false;
  }

  /* hunger formula mirrors server/catalog.js hungerPct (display only) */
  function hungerPct(fedAt, t) {
    if (!fedAt) return 0;
    const age = t - fedAt;
    if (age <= 6 * 3600) return 100;
    if (age >= 24 * 3600) return 0;
    return Math.round(100 * (1 - (age - 6 * 3600) / (18 * 3600)));
  }
  function moodOf(sick, hunger) {
    if (sick) return "sick";
    return hunger < 30 ? "hungry" : "happy";
  }

  /* Optimistically patch the cached state so the UI reflects a queued action.
   * Returns {ok:true} or {ok:false, error} (local validation, e.g. no food). */
  async function applyPatch(type, p) {
    const st = await cachedState();
    if (!st) return { ok: false, error: "no cache" };
    const t = now();
    const W = st.wallets || {};
    const fish = st.fish || [];
    const byId = (id) => fish.find((f) => f.id === Number(id));
    const activeTank = st.tanks && st.tanks.active;

    if (type === "feed") {
      const kind = p.kind === "special" ? "special" : "normal";
      const targets = fish.filter((f) =>
        f.location === "tank" && f.tank === activeTank &&
        ((kind === "special") === (f.group === "bottom_fish")));
      if (!targets.length) return { ok: true };
      if (kind === "special") {
        if ((W.food_special || 0) < targets.length) return { ok: false, error: "no special food" };
        W.food_special -= targets.length;
      } else {
        if ((W.food || 0) < targets.length) return { ok: false, error: "no food" };
        W.food -= targets.length;
      }
      for (const f of targets) {
        f.fed_at = t; f.hunger = 100; f.sick = false; f.mood = moodOf(false, 100);
      }
      W.xp = (W.xp || 0) + 2;
      return { ok: true, pellets: targets.length, kind };
    }
    if (type === "feed-one") {
      const f = byId(p.fish_id);
      if (!f) return { ok: false, error: "fish not found" };
      const bottom = f.group === "bottom_fish";
      if (bottom) {
        if ((W.food_special || 0) < 1) return { ok: false, error: "no special food" };
        W.food_special -= 1;
      } else {
        if ((W.food || 0) < 1) return { ok: false, error: "no food" };
        W.food -= 1;
      }
      f.fed_at = t; f.hunger = 100; f.sick = false; f.mood = moodOf(false, 100);
      return { ok: true };
    }
    if (type === "treat") {
      const f = byId(p.fish_id);
      if (!f) return { ok: false, error: "fish not found" };
      if (!f.sick) return { ok: false, error: "not sick" };
      if ((W.medicine || 0) < 1) return { ok: false, error: "no medicine" };
      W.medicine -= 1;
      f.sick = false; f.fed_at = t; f.hunger = 100; f.mood = moodOf(false, 100);
      return { ok: true };
    }
    if (type === "collect") {
      const f = byId(p.fish_id);
      if (!f) return { ok: false, error: "fish not found" };
      if (!f.coin_pending || f.coin_pending <= 0) return { ok: false, error: "nothing to collect" };
      W.coins = (W.coins || 0) + f.coin_pending;
      W.gems = (W.gems || 0) + (f.gem_pending || 0);
      f.coin_pending = 0; f.gem_pending = 0;
      return { ok: true, collected: true };
    }
    if (type === "tap") {
      const f = byId(p.fish_id);
      if (!f) return { ok: false, error: "fish not found" };
      W.xp = (W.xp || 0) + 1;
      return { ok: true };
    }
    if (type === "breed") {
      if ((W.gems || 0) < 2) return { ok: false, error: "not enough gems" };
      W.gems -= 2;
      // the egg itself is created server-side at sync (RNG rolls there)
      return { ok: true, pendingEgg: true };
    }
    return { ok: false, error: "unknown action" };
  }

  async function enqueue(type, params) {
    const st = await cachedState();
    const uid = st && st.user && st.user.id;
    let q = await getQueue();
    const qu = await kvGet("queueUser");
    if (qu && uid && qu !== uid) { q = []; } // different user: drop stale queue
    if (uid) await kvSet("queueUser", uid);
    const patch = await applyPatch(type, params);
    if (!patch.ok) return patch;
    q.push({ type, ...params, t: now() });
    await kvSet("queue", q);
    await saveState(st); // persist the optimistic patch
    updateBadge();
    return { ok: true, queued: true, ...patch };
  }

  /* Map a failed API call to a queueable offline action. Returns the API-style
   * response or null when the endpoint isn't offline-capable. */
  async function onNetworkFail(method, path, body) {
    if (method === "GET" && path === "/api/state") {
      const st = await cachedState();
      if (st) return { ok: true, state: st, offline: true };
      return null;
    }
    if (method === "GET" && path === "/api/me") {
      const st = await cachedState();
      if (st && st.user) return { ok: true, user: { id: st.user.id, name: st.user.name, email: st.user.email }, offline: true };
      return null;
    }
    if (method !== "POST") return null;
    const b = body || {};
    if (path === "/api/fish/feed") return enqueue("feed", { kind: b.kind });
    if (path === "/api/fish/feed-one") return enqueue("feed-one", { fish_id: b.fish_id });
    if (path === "/api/fish/treat") return enqueue("treat", { fish_id: b.fish_id });
    if (path === "/api/fish/collect") return enqueue("collect", { fish_id: b.fish_id });
    if (path === "/api/fish/tap") return enqueue("tap", { fish_id: b.fish_id });
    if (path === "/api/breeding/breed") return enqueue("breed", { male_id: b.male_id, female_id: b.female_id });
    return null;
  }

  /* Push the queue to the server. Returns {ok, state,...} on success,
   * null when there's nothing to sync or we're offline. */
  async function syncIfNeeded() {
    const q = await getQueue();
    if (!q.length) return null;
    if (!isOnline()) return null;
    const clock = mem.clock || await kvGet("clock");
    if (!clock || !clock.serverTime) return null;
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_time: clock.serverTime, actions: q }),
      });
      if (res.status === 401) return { ok: false, error: "auth" };
      const data = await res.json().catch(() => null);
      if (!data || !data.ok) return null;
      await kvSet("queue", []);
      if (data.state) await saveState(data.state);
      setAnchor(data.server_time);
      updateBadge();
      const failed = (data.results || []).filter((r) => !r.ok).length;
      return { ok: true, state: data.state, server_time: data.server_time, synced: q.length, failed };
    } catch (e) {
      return null; // still offline
    }
  }

  /* ---------- offline banner ---------- */
  function updateBadge() {
    queueLen().then((n) => {
      const el = document.getElementById("offline-badge");
      if (!el) return;
      if (!isOnline() || n > 0) {
        el.hidden = false;
        const label = typeof t === "function" ? t("app.offline_badge", { n }) : `Offline · ${n} na fila`;
        el.querySelector("span").textContent = !isOnline() ? label : (typeof t === "function" ? t("app.queue_badge", { n }) : `${n} na fila ⏳`);
      } else {
        el.hidden = true;
      }
    });
  }

  async function clearAll() {
    mem = { state: null, queue: null, clock: null, queueUser: null };
    try {
      const db = await idb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { /* best effort */ }
  }

  function tickOnline() {
    updateBadge();
    window.dispatchEvent(new CustomEvent("aquanim-online", { detail: { online: isOnline() } }));
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => { tickOnline(); syncIfNeeded(); });
    window.addEventListener("offline", tickOnline);
    // warm the memory cache early
    kvGet("clock"); kvGet("queue"); kvGet("queueUser");
  }

  return {
    now, setAnchor, saveState, cachedState,
    enqueue, getQueue, queueLen, onNetworkFail, syncIfNeeded,
    isOnline, updateBadge, clearAll,
    _test: { setOnlineOverride: (v) => { onlineTestOverride = v; } },
  };
})();
