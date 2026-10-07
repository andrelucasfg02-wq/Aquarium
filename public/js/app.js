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
  function hideLoading() {
    const el = document.getElementById("loading-screen");
    if (el) el.classList.add("hidden");
  }

  async function boot() {
    // translate static HTML (auth screen etc.) before first paint
    if (typeof I18N !== "undefined") I18N.applyI18n();
    // if the server is cold (Render wake-up), show a hint after 8s
    const wakeTimer = setTimeout(() => {
      const sub = document.getElementById("loading-sub");
      if (sub) sub.classList.add("show");
    }, 8000);
    // iOS Safari ignores viewport user-scalable=no — block pinch zoom explicitly
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("gesturechange", (e) => e.preventDefault());
    // block double-tap zoom (iOS fires it even with maximum-scale=1); CSS
    // touch-action:manipulation is the primary guard, this is the fallback
    document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
    Api.onAuthFail(showAuth);
    bindAuth();
    bindNav();
    bindHomeButtons();

    const me = await Api.me();
    clearTimeout(wakeTimer);
    hideLoading();
    // opened from a password-reset email: show the reset form, not the game
    // (check before the session, so it works even if already logged in)
    if (new URLSearchParams(location.search).get("reset")) { showAuth(); return; }
    if (!me.ok || !me.user) { showAuth(); return; }
    enterGame();
    // returning from Stripe Checkout: ?shop=success | ?shop=cancelled
    const shopResult = new URLSearchParams(location.search).get("shop");
    if (shopResult === "success" || shopResult === "cancelled") {
      history.replaceState(null, "", location.pathname);
      setTimeout(() => {
        UI.toast(t(shopResult === "success" ? "gemshop.success" : "gemshop.cancelled"));
        if (shopResult === "success") refresh();
      }, 900);
    }
  }

  function showAuth() {
    stopPoll();
    $("game").hidden = true;
    $("auth-screen").hidden = false;
  }

  let promoShown = false;
  function showPromo() {
    if (promoShown) return;
    promoShown = true;
    const ov = $("promo-overlay");
    if (!ov) return;
    ov.hidden = false;
    $("promo-x").onclick = () => { ov.hidden = true; };
    ov.onclick = (e) => { if (e.target === ov) ov.hidden = true; };
    $("promo-img").onclick = () => { ov.hidden = true; UI.open("event"); };
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
    // guest reminders: nudge to create an account — first at 5min, then every 10min
    startGuestNudges();
    // first-run tutorial takes precedence over the promos this once
    const tutStarted = (typeof Tutorial !== "undefined") && Tutorial.maybeAutoStart();
    if (!tutStarted) showPromo();
    // install-as-app promo (browser tab only, at most once a week)
    if (!tutStarted && typeof InstallPromo !== "undefined") InstallPromo.maybeShow(4000);
  }

  let guestNudgeTimers = [];
  function startGuestNudges() {
    guestNudgeTimers.forEach(clearTimeout);
    guestNudgeTimers = [];
    if (!state || !state.user || !state.user.is_guest) return;
    const nudge = () => {
      // stop if no longer a guest (claimed account)
      if (!state || !state.user || !state.user.is_guest) return;
      UI.guestNudge(() => {
        // open settings with the claim form visible
        if (typeof UI !== "undefined" && UI.open) {
          UI.open("settings");
          setTimeout(() => {
            const cf = document.getElementById("claim-form");
            if (cf) { cf.hidden = false; cf.scrollIntoView({ behavior: "smooth", block: "center" }); }
          }, 300);
        }
      });
    };
    // first at 5 min, then every 10 min
    guestNudgeTimers.push(setTimeout(function tick() {
      nudge();
      guestNudgeTimers.push(setTimeout(tick, 10 * 60 * 1000));
    }, 5 * 60 * 1000));
  }

  /* ---------- state ---------- */
  async function refresh() {
    const r = await Api.state();
    if (!r.ok) {
      if (r.error !== "auth") UI.toast(r.message || r.error || t("app.err_load"));
      return;
    }
    state = r.state;
    UI.updateHUD(state);
    tank.syncState(state);
    if (r.synced) UI.toast(t("app.synced") + (r.failed ? ` (${r.failed} ⚠️)` : ""));
    if (typeof Offline !== "undefined") Offline.updateBadge();
    applySettings(state.settings, true);
    // daily shell game badge on the quests nav tab (games live under Quests now)
    Api.shellStatus().then((s) => {
      const b = document.querySelector('.nav-tab[data-screen="quests"]');
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
    if (!silent) UI.toast(t("app.settings_saved"));
  }

  /* ---------- auth forms ---------- */
  function bindAuth() {
    let resetToken = null;
    const showTab = (which) => {
      $("tab-login").classList.toggle("active", which === "login");
      $("tab-register").classList.toggle("active", which === "register");
      $("form-login").hidden = which !== "login";
      $("form-register").hidden = which !== "register";
      $("form-forgot").hidden = which !== "forgot";
      $("form-reset").hidden = which !== "reset";
    };
    $("tab-login").onclick = () => showTab("login");
    $("tab-register").onclick = () => showTab("register");
    // show/hide password toggles
    document.querySelectorAll(".auth-eye").forEach((btn) => {
      btn.onclick = () => {
        const inp = $(btn.dataset.eye);
        if (!inp) return;
        const show = inp.type === "password";
        inp.type = show ? "text" : "password";
        btn.textContent = show ? "🙈" : "👁️";
        btn.setAttribute("aria-label", show ? t("auth.hide_pass") : t("auth.show_pass"));
      };
    });
    $("link-forgot").onclick = (e) => { e.preventDefault(); showTab("forgot"); };
    $("link-back-login").onclick = (e) => { e.preventDefault(); showTab("login"); };

    $("form-login").onsubmit = async (e) => {
      e.preventDefault();
      const err = $("login-error"); err.hidden = true;
      const r = await Api.login($("login-email").value.trim(), $("login-password").value);
      if (r.ok) { AudioFX.unlock(); enterGame(); }
      else { err.textContent = r.error || r.message || t("auth.err.login"); err.hidden = false; AudioFX.error(); }
    };
    $("btn-guest").onclick = async () => {
      const err = $("login-error"); err.hidden = true;
      $("btn-guest").disabled = true;
      try {
        const saved = localStorage.getItem("aquanim_guest_token");
        const r = await Api.guest(saved || undefined);
        if (r.ok) {
          if (r.guest_token) localStorage.setItem("aquanim_guest_token", r.guest_token);
          AudioFX.unlock(); enterGame();
        } else {
          err.textContent = r.error || t("auth.err.login"); err.hidden = false; AudioFX.error();
        }
      } catch (e) {
        err.textContent = t("auth.err.login"); err.hidden = false; AudioFX.error();
      }
      $("btn-guest").disabled = false;
    };
    $("form-register").onsubmit = async (e) => {
      e.preventDefault();
      const err = $("reg-error"); err.hidden = true;
      const r = await Api.register(
        $("reg-name").value.trim(), $("reg-email").value.trim(), $("reg-password").value);
      if (r.ok) { AudioFX.unlock(); UI.toast(t("app.welcome")); enterGame(); }
      else { err.textContent = r.error || r.message || t("auth.err.register"); err.hidden = false; AudioFX.error(); }
    };
    $("form-forgot").onsubmit = async (e) => {
      e.preventDefault();
      const err = $("forgot-error"), ok = $("forgot-ok");
      err.hidden = true; ok.hidden = true;
      const r = await Api.passwordForgot($("forgot-email").value.trim());
      if (r.ok) {
        ok.textContent = t("auth.forgot_sent2");
        ok.hidden = false;
      } else { err.textContent = r.error || t("auth.err.send"); err.hidden = false; }
    };
    $("form-reset").onsubmit = async (e) => {
      e.preventDefault();
      const err = $("reset-error"), okm = $("reset-ok");
      err.hidden = true; okm.hidden = true;
      const p1 = $("reset-password").value, p2 = $("reset-password2").value;
      if (p1 !== p2) { err.textContent = t("auth.err.match"); err.hidden = false; return; }
      const r = await Api.passwordReset(resetToken, p1);
      if (r.ok) {
        okm.textContent = t("auth.reset_ok"); okm.hidden = false;
        history.replaceState(null, "", location.pathname); // drop the token from the URL
        setTimeout(() => showTab("login"), 1800);
      } else { err.textContent = r.error || t("auth.err.reset"); err.hidden = false; AudioFX.error(); }
    };
    // opened from a reset email? show the new-password form
    resetToken = new URLSearchParams(location.search).get("reset");
    if (resetToken) showTab("reset");
  }

  /* ---------- nav ---------- */
  function bindNav() {
    document.querySelectorAll(".nav-tab").forEach((b) => b.onclick = () => {
      AudioFX.unlock();
      const scr = b.dataset.screen;
      // tapping the aquariums tab while its screen is open goes back to the tank
      if (scr === "aquariums" && currentScreen === "aquariums") { goHome(); return; }
      document.querySelectorAll(".nav-tab").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      currentScreen = scr;
      UI.open(scr);
    });
    $("screen-close").onclick = () => goHome();
  }
  function goHome() {
    UI.close(true); // silent: avoid close() -> onScreenClosed() -> goHome() loop
    currentScreen = "home";
    document.querySelectorAll(".nav-tab").forEach((x) =>
      x.classList.toggle("active", x.dataset.screen === "aquariums"));
  }
  function onScreenClosed() { goHome(); }

  /* ---------- home buttons ---------- */
  function bindHomeButtons() {
    $("btn-settings").onclick = () => {
      cancelPlace();
      document.querySelectorAll(".nav-tab").forEach((x) => x.classList.remove("active"));
      UI.open("settings");
    };
    $("btn-event").onclick = () => {
      cancelPlace();
      document.querySelectorAll(".nav-tab").forEach((x) => x.classList.remove("active"));
      UI.open("event");
    };
    $("btn-maze").onclick = () => {
      cancelPlace();
      document.querySelectorAll(".nav-tab").forEach((x) => x.classList.remove("active"));
      UI.open("maze");
    };
    $("btn-zoom").onclick = () => {
      cancelPlace();
      // toggle zoom into the aquarium (small tank only)
      tank.userZoom = tank.userZoom === 1 ? 2.2 : 1;
      tank.camX = 0; tank.camY = 0;
    };
    // tank switcher arrows (table edge) — cycles through all tank instances
    const cycleTank = (dir) => {
      const instances = (state.tanks && state.tanks.instances) || [{ tier: "small", num: 1 }];
      const active = (state.tanks && state.tanks.active) || "small";
      const activeNum = (state.tanks && state.tanks.activeNum) || 1;
      if (instances.length < 2) return;
      const idx = instances.findIndex((t) => t.tier === active && t.num === activeNum);
      const next = instances[(idx + dir + instances.length) % instances.length];
      switchTankFast(next.tier, next.num);
    };
    $("tank-prev").onclick = () => cycleTank(-1);
    $("tank-next").onclick = () => cycleTank(1);
    $("btn-gems-plus").onclick = () => {
      cancelPlace();
      document.querySelectorAll(".nav-tab").forEach((x) => x.classList.remove("active"));
      UI.open("gemshop");
    };
    $("btn-coins-plus").onclick = () => {
      cancelPlace();
      document.querySelectorAll(".nav-tab").forEach((x) => x.classList.remove("active"));
      UI.open("coinshop");
    };
    $("btn-food-plus").onclick = () => {
      cancelPlace();
      document.querySelectorAll(".nav-tab").forEach((x) => x.classList.remove("active"));
      UI.open("foodshop");
    };

    $("btn-feed").onclick = () => {
      cancelPlace();
      if (!state) return;
      // the feed button now asks which food to drop: normal or bottom food
      const tankFish = (state.fish || []).filter((f) => f.location === "tank" && f.tank === state.tanks.active);
      const nBottom = tankFish.filter((f) => f.group === "bottom_fish").length;
      const nNormal = tankFish.length - nBottom;
      UI.openFeedChoice(nNormal, nBottom, feedKind);
    };

    const feedKind = async (kind) => {
      cancelPlace();
      if (!state) return;
      const r = await Api.feed(kind);
      if (r.ok) {
        tank.feedBurst(r.pellets || 1, r.kind || kind);
        UI.toast(t("app.yum"));
      } else {
        AudioFX.error();
        UI.toast(r.error === "no food" || r.error === "no special food"
          ? t("toast.no_food")
          : (r.error || r.message || t("app.err_feed")));
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
      if (!confirm(htmlToText(`Filter the water for ${CUR_GOLD}${DATA.FILTER_PRICE}? 🫧`))) return;
      const r = await Api.filterDirt();
      if (r.ok) { tank.bubbleBurst(); UI.toast(t("app.water_clear")); AudioFX.coin(); }
      else { AudioFX.error(); UI.toast(r.error || r.message || t("app.err_filter")); }
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
      if (!on) UI.toast(t("app.edit_mode"));
    };
    $("btn-edit-done").onclick = () => $("btn-edit").onclick();
    $("btn-remove-deco").onclick = async () => {
      const sel = tank.selectedPlacement;
      if (!sel) return;
      const r = await Api.removeDecor(sel.id);
      if (r.ok) { UI.toast(t("app.back_inv")); AudioFX.pop(); }
      else UI.toast(r.error || t("app.err_remove"));
      tank.selectedPlacement = null;
      $("btn-remove-deco").disabled = true;
      await refresh();
    };
    $("btn-collect-all-deco").onclick = async () => {
      if (!confirm(t("editbar.collect_all_confirm"))) return;
      const r = await Api.collectAllDecor(state.tanks.active, state.tanks.activeNum || 1);
      if (r.ok && r.collected > 0) { UI.toast(t("editbar.collected", { n: r.collected })); AudioFX.pop(); }
      else if (r.ok) UI.toast(t("editbar.nothing_to_collect"));
      else UI.toast(r.error || t("app.err_remove"));
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

    tank.on("coinTap", (fishId) => {
      // instant feedback already played in tank.js; bank the coins in the
      // background so rapid taps on many fish each resolve independently
      Api.collectCoins(fishId).then(async (r) => {
        if (!r.ok && r.error !== "nothing to collect") {
          AudioFX.error(); UI.toast(r.error || t("app.err_collect"));
        }
        const s = await Api.state();
        if (s.ok) { state = s.state; UI.updateHUD(state); tank.syncState(state); }
      });
    });

    tank.on("wiped", async (ids) => {
      const r = await Api.wipeDirt(ids);
      if (!r.ok && r.error !== "auth") UI.toast(r.error || r.message || t("app.err_wipe"));
      await refresh();
    });

    tank.on("coryCleaned", async ({ spotId, fishId }) => {
      // the cory already sucked the spot up locally; the server confirms it
      // (1/hour per fish) and deletes the spot for real
      try {
        const r = await Api.coryClean(spotId, fishId);
        if (!r.ok && r.error !== "spot gone") UI.toast(r.error || r.message || t("app.err_wipe"));
      } catch (e) { /* offline: the spot comes back on next sync */ }
      await refresh();
    });

    tank.on("decoMoved", async ({ id, x, y }) => {
      // local position is already updated — save quietly, no full refresh
      // (keeps the drag buttery and avoids any flicker/jump)
      tank.selectedPlacement = null;
      $("btn-remove-deco").disabled = true;
      const r = await Api.moveDecor(id, x, y);
      if (!r.ok) { UI.toast(r.error || t("app.err_move")); await refresh(); }
    });

    tank.on("decoSelect", (p) => {
      $("btn-remove-deco").disabled = !p;
    });

    tank.on("placeTap", async ({ deco_id, x, y }) => {
      // clamp with a small default half-size (server clamps too)
      const [cx, cy] = clampToGlass(x, y, 50, 50, state.tanks.active);
      // optimistic: draw it instantly, reconcile with the server after
      const tmp = { id: "tmp-" + Date.now(), deco_id, tank: state.tanks.active, tank_num: state.tanks.activeNum || 1, x: cx, y: cy };
      tank.placements.push(tmp);
      AudioFX.pop();
      const r = await Api.placeDecor(deco_id, state.tanks.active, cx, cy, state.tanks.activeNum || 1);
      tank.placements = tank.placements.filter((p) => p !== tmp);
      if (r.ok) UI.toast(t("app.placed"));
      else if (r.error === "no free decor slots") {
        AudioFX.error();
        UI.showTankFullPopup({ deco_id, x: cx, y: cy });
      }
      else { AudioFX.error(); UI.toast(r.error || r.message || t("app.err_place")); }
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
    UI.toast(t("app.tap_place"));
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

  /* ---------- fast tank switching (optimistic) ---------- */
  let switchingTank = false;
  async function switchTankFast(tier, num) {
    const tankNum = num || 1;
    if (switchingTank) return { ok: false };
    if (!state || !state.tanks) return { ok: false };
    if (state.tanks.active === tier && (state.tanks.activeNum || 1) === tankNum) return { ok: true };
    const instances = state.tanks.instances || [];
    if (!instances.some((t) => t.tier === tier && t.num === tankNum)) return { ok: false };
    switchingTank = true;
    const prev = state.tanks.active, prevNum = state.tanks.activeNum || 1;
    state.tanks.active = tier; // optimistic: switch locally first
    state.tanks.activeNum = tankNum;
    UI.updateHUD(state); // syncs UI state + HUD
    if (tank) tank.syncState(state); // re-render the tank view immediately
    UI.close();
    try {
      const r = await Api.switchTank(tier, tankNum);
      if (!r.ok) throw new Error(r.error || "switch failed");
      UI.toast(t("toast.tank_switched"));
      refresh(); // background reconcile; UI is already correct
    } catch (e) {
      state.tanks.active = prev; // revert on failure
      state.tanks.activeNum = prevNum;
      UI.updateHUD(state);
      if (tank) tank.syncState(state);
      UI.toast(t("toast.couldnt_switch"));
      return { ok: false };
    } finally {
      switchingTank = false;
    }
    return { ok: true };
  }

  document.addEventListener("DOMContentLoaded", boot);
  return {
    refresh, applySettings, beginPlace, setDecoCatalog, onScreenClosed, petFish,
    switchTankFast,
    get state() { return state; },
  };
})();
// expose for UI callbacks
window.App = App;
