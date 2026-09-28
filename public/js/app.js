/* app.js — boot, auth, nav, state polling, tank-event wiring */
"use strict";

const App = (() => {
  const $ = (id) => document.getElementById(id);
  let state = null;
  let tank = null;
  let pollTimer = null;
  let currentScreen = "home";
  let tapThrottle = 0;
  let decorCatalogLoaded = false;

  /* ---------- boot ---------- */
  async function boot() {
    Api.onAuthFail(showAuth);
    bindAuth();
    bindNav();
    bindHomeButtons();

    const me = await Api.me();
    if (!me.ok || !me.user) { showAuth(); return; }
    enterGame();
  }

  function showAuth() {
    stopPoll();
    $("game").hidden = true;
    $("auth-screen").hidden = false;
  }

  async function enterGame() {
    $("auth-screen").hidden = true;
    $("game").hidden = false;
    if (!tank) {
      tank = new TankView($("tank"));
      wireTank();
    }
    await refresh();
    startPoll();
  }

  /* ---------- state ---------- */
  async function refresh() {
    const r = await Api.state();
    if (!r.ok) {
      if (r.error !== "auth") UI.toast(r.message || r.error || "Couldn't load");
      return;
    }
    state = r.state;
    UI.updateHUD(state);
    tank.syncState(state);
    applySettings(state.settings, true);
    // daily shell game badge on the minigame button
    Api.shellStatus().then((s) => {
      const b = document.getElementById("btn-minigame");
      if (!b) return;
      let dot = b.querySelector(".dot");
      if (s.ok && s.canPlay) {
        if (!dot) { dot = document.createElement("span"); dot.className = "dot"; b.appendChild(dot); }
      } else if (dot) dot.remove();
    });
    // weekly event badge on the event button (shows while the prize is unclaimed)
    Api.eventProgress("autumn1").then((s) => {
      const b = document.getElementById("btn-event");
      if (!b) return;
      let dot = b.querySelector(".dot");
      if (s.ok && !s.claimed) {
        if (!dot) { dot = document.createElement("span"); dot.className = "dot"; b.appendChild(dot); }
      } else if (dot) dot.remove();
    });
    if (!decorCatalogLoaded) {
      // mark loaded only on success so a failed fetch retries on next refresh
      Api.decorCatalog().then((dc) => {
        if (dc.ok) { decorCatalogLoaded = true; setDecoCatalog(dc.items); }
      });
    }
    UI.refreshCurrent();
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(() => refresh(), 30000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function applySettings(s, silent) {
    if (!s) return;
    AudioFX.setSfx(s.sfx !== false);
    AudioFX.setMusic(!!s.music);
    if (tank) tank.setQuality(s.quality || "high");
    if (!silent) UI.toast("Settings saved ✓");
  }

  /* ---------- auth forms ---------- */
  function bindAuth() {
    const showTab = (which) => {
      $("tab-login").classList.toggle("active", which === "login");
      $("tab-register").classList.toggle("active", which === "register");
      $("form-login").hidden = which !== "login";
      $("form-register").hidden = which !== "register";
    };
    $("tab-login").onclick = () => showTab("login");
    $("tab-register").onclick = () => showTab("register");

    $("form-login").onsubmit = async (e) => {
      e.preventDefault();
      const err = $("login-error"); err.hidden = true;
      const r = await Api.login($("login-email").value.trim(), $("login-password").value);
      if (r.ok) { AudioFX.unlock(); enterGame(); }
      else { err.textContent = r.error || r.message || "Login failed"; err.hidden = false; AudioFX.error(); }
    };
    $("form-register").onsubmit = async (e) => {
      e.preventDefault();
      const err = $("reg-error"); err.hidden = true;
      const r = await Api.register(
        $("reg-name").value.trim(), $("reg-email").value.trim(), $("reg-password").value);
      if (r.ok) { AudioFX.unlock(); UI.toast("Welcome to your aquarium! 🐠"); enterGame(); }
      else { err.textContent = r.error || r.message || "Registration failed"; err.hidden = false; AudioFX.error(); }
    };
  }

  /* ---------- nav ---------- */
  function bindNav() {
    document.querySelectorAll(".nav-tab").forEach((b) => b.onclick = () => {
      AudioFX.unlock();
      document.querySelectorAll(".nav-tab").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      currentScreen = b.dataset.screen;
      if (currentScreen === "home") UI.close();
      else UI.open(currentScreen);
    });
    $("screen-close").onclick = () => goHome();
  }
  function goHome() {
    UI.close(true); // silent: avoid close() -> onScreenClosed() -> goHome() loop
    currentScreen = "home";
    document.querySelectorAll(".nav-tab").forEach((x) =>
      x.classList.toggle("active", x.dataset.screen === "home"));
  }
  function onScreenClosed() { goHome(); }

  /* ---------- home buttons ---------- */
  function bindHomeButtons() {
    $("btn-settings").onclick = () => {
      cancelPlace();
      document.querySelectorAll(".nav-tab").forEach((x) => x.classList.remove("active"));
      UI.open("settings");
    };
    $("btn-breed").onclick = () => {
      cancelPlace();
      document.querySelectorAll(".nav-tab").forEach((x) => x.classList.remove("active"));
      UI.open("breeding");
    };
    $("btn-minigame").onclick = () => {
      cancelPlace();
      document.querySelectorAll(".nav-tab").forEach((x) => x.classList.remove("active"));
      UI.open("minigame");
    };
    $("btn-event").onclick = () => {
      cancelPlace();
      document.querySelectorAll(".nav-tab").forEach((x) => x.classList.remove("active"));
      UI.open("event");
    };

    $("btn-feed").onclick = async () => {
      cancelPlace();
      if (!state) return;
      if ((state.wallets.food || 0) <= 0) {
        UI.toast("No food left! Buy more in 🎒 Inventory 🍤");
        AudioFX.error();
        return;
      }
      const r = await Api.feed();
      if (r.ok) {
        tank.feedBurst(r.pellets || 1);
        UI.toast("Yum yum! 🍽️🐠");
      } else {
        AudioFX.error();
        UI.toast(r.error === "no food" ? "No food left! Buy more in 🎒 Inventory 🍤" : (r.error || r.message || "Couldn't feed"));
      }
      await refresh();
    };

    $("btn-clean").onclick = () => {
      cancelPlace();
      const on = tank.mode === "sponge";
      tank.mode = on ? null : "sponge";
      tank.placeDecoId = null;
      UI.toast(on ? "Sponge away 🧽" : "Drag the sponge over dirt spots! 🧽");
    };

    $("btn-filter").onclick = async () => {
      if (!confirm(`Filter the water for 🪙${DATA.FILTER_PRICE}? 🫧`)) return;
      const r = await Api.filterDirt();
      if (r.ok) { tank.bubbleBurst(); UI.toast("Water crystal clear! 🫧✨"); AudioFX.coin(); }
      else { AudioFX.error(); UI.toast(r.error || r.message || "Couldn't filter"); }
      await refresh();
    };

    $("btn-edit").onclick = () => {
      cancelPlace();
      const on = tank.mode === "edit";
      tank.mode = on ? null : "edit";
      tank.placeDecoId = null;
      // exiting edit mode: drop any selection ring and stale drag state
      tank.selectedPlacement = null;
      tank.dragging = null;
      $("btn-remove-deco").disabled = true;
      $("btn-edit").classList.toggle("on", !on);
      $("edit-bar").hidden = on;
      if (!on) UI.toast("Edit mode: drag decorations ✏️");
    };
    $("btn-edit-done").onclick = () => $("btn-edit").onclick();
    $("btn-remove-deco").onclick = async () => {
      const sel = tank.selectedPlacement;
      if (!sel) return;
      const r = await Api.removeDecor(sel.id);
      if (r.ok) { UI.toast("Back to inventory 🎒"); AudioFX.pop(); }
      else UI.toast(r.error || "Couldn't remove");
      tank.selectedPlacement = null;
      $("btn-remove-deco").disabled = true;
      await refresh();
    };
  }

  /* ---------- tank events ---------- */
  async function petFish(fishId) {
    const now = Date.now();
    if (now - tapThrottle < 1500) return; // don't spam the server
    tapThrottle = now;
    await Api.tapFish(fishId);
    // tiny XP may have changed; refresh lightly (no full re-render storm)
    const r = await Api.state();
    if (r.ok) { state = r.state; UI.updateHUD(state); tank.syncState(state); }
  }
  function wireTank() {
    tank.on("fishTap", (fishId) => {
      const f = (state.fish || []).find((x) => x.id === fishId);
      if (f) UI.openFishMenu(f);
    });

    tank.on("wiped", async (ids) => {
      const r = await Api.wipeDirt(ids);
      if (!r.ok && r.error !== "auth") UI.toast(r.error || r.message || "Couldn't wipe");
      await refresh();
    });

    tank.on("decoMoved", async ({ id, x, y }) => {
      // local position is already updated — save quietly, no full refresh
      // (keeps the drag buttery and avoids any flicker/jump)
      tank.selectedPlacement = null;
      $("btn-remove-deco").disabled = true;
      const r = await Api.moveDecor(id, x, y);
      if (!r.ok) { UI.toast(r.error || "Couldn't move"); await refresh(); }
    });

    tank.on("decoSelect", (p) => {
      $("btn-remove-deco").disabled = !p;
    });

    tank.on("placeTap", async ({ deco_id, x, y }) => {
      // clamp with a small default half-size (server clamps too)
      const [cx, cy] = clampToGlass(x, y, 50, 50, state.tanks.active);
      // optimistic: draw it instantly, reconcile with the server after
      const tmp = { id: "tmp-" + Date.now(), deco_id, tank: state.tanks.active, x: cx, y: cy };
      tank.placements.push(tmp);
      AudioFX.pop();
      const r = await Api.placeDecor(deco_id, state.tanks.active, cx, cy);
      tank.placements = tank.placements.filter((p) => p !== tmp);
      if (r.ok) UI.toast("Placed! 🪸");
      else { AudioFX.error(); UI.toast(r.error || r.message || "Couldn't place"); }
      await refresh();
    });
  }

  function beginPlace(deco_id) {
    goHome();
    tank.mode = null;
    tank.selectedPlacement = null;
    tank.dragging = null;
    $("btn-remove-deco").disabled = true;
    $("btn-edit").classList.remove("on");
    $("edit-bar").hidden = true;
    tank.placeDecoId = deco_id;
    UI.toast("Tap the tank to place it 🪸");
  }

  function cancelPlace() {
    if (tank) tank.placeDecoId = null;
  }

  function setDecoCatalog(items) {
    if (tank) tank.setDecoCatalog(items);
    UI.setCatalogs(null, items);
  }

  // cancel place mode when tapping a nav tab / home
  document.addEventListener("pointerdown", (e) => {
    if (tank && tank.placeDecoId && e.target.closest("#bottom-nav")) {
      tank.placeDecoId = null;
    }
  }, true);

  document.addEventListener("DOMContentLoaded", boot);
  return {
    refresh, applySettings, beginPlace, setDecoCatalog, onScreenClosed, petFish,
    get state() { return state; },
  };
})();
// expose for UI callbacks
window.App = App;
