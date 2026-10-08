/* cg-sdk.js — CrazyGames SDK v3 platform adapter for AquaNim.
 *
 * Single integration point for the CrazyGames portal build. When the game
 * runs on crazygames.com the SDK is initialized and gameplay/ad events fire;
 * everywhere else (aquanimgame.com, localhost) every method is a silent
 * no-op, so the main build is completely unaffected.
 *
 * Usage:
 *   <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
 *   <script src="js/cg-sdk.js"></script>
 *   await CG.init();          // call once on the loading screen
 *   CG.gameplayStart();       // player reaches the tank
 *   CG.gameplayStop();        // pause / menu / maze enter / before an ad
 *   CG.happytime();           // exciting moments (maze win, rare hatch...)
 *   CG.isPortal()             // true only inside CrazyGames
 */
"use strict";

const CG = (() => {
  let sdk = null;
  let ready = false;
  let initPromise = null;

  function getSDK() {
    try { return window.CrazyGames && window.CrazyGames.SDK ? window.CrazyGames.SDK : null; }
    catch (e) { return null; }
  }

  /** Resolve once on boot. Safe to call multiple times. Waits for the
   *  async SDK script (up to ~8s) before falling back to no-op mode. */
  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      for (let i = 0; i < 40; i++) {
        sdk = getSDK();
        if (sdk) break;
        await new Promise(r => setTimeout(r, 200));
      }
      if (!sdk) return false;
      try {
        await sdk.init();
        ready = true;
        return true;
      } catch (e) {
        sdk = null;
        return false;
      }
    })();
    return initPromise;
  }

  /** True only when actually running inside the CrazyGames portal. */
  function isPortal() {
    if (!ready || !sdk) return false;
    try { return sdk.environment === "crazygames"; } catch (e) { return false; }
  }

  /** True in portal OR with ?cg=1 (local testing of the portal build). */
  function isCGBuild() {
    if (isPortal()) return true;
    try { return new URLSearchParams(location.search).get("cg") === "1"; }
    catch (e) { return false; }
  }

  function call(fn) {
    if (!isPortal()) return;
    try { fn(sdk); } catch (e) { /* never break the game for ads */ }
  }

  // ---- gameplay lifecycle (required events) ----
  function loadingStart()  { call(s => s.game.loadingStart()); }
  function loadingStop()   { call(s => s.game.loadingStop()); }
  function gameplayStart() { call(s => s.game.gameplayStart()); }
  function gameplayStop()  { call(s => s.game.gameplayStop()); }
  function happytime()     { call(s => s.game.happytime()); }

  // ---- ads ----
  function hasAdblock() {
    if (!isPortal()) return Promise.resolve(false);
    try { return Promise.resolve(sdk.ad.hasAdblock()); }
    catch (e) { return Promise.resolve(false); }
  }

  /**
   * Request an ad. type: "midgame" | "rewarded".
   * Callbacks: { onStarted, onFinished, onError } — all optional.
   * Rewarded rewards must ONLY be granted in onFinished, never onError.
   */
  function requestAd(type, cb) {
    cb = cb || {};
    if (!isPortal()) { if (cb.onFinished) cb.onFinished(); return; }
    try {
      sdk.ad.requestAd(type, {
        adStarted: () => { if (cb.onStarted) cb.onStarted(); },
        adFinished: () => { if (cb.onFinished) cb.onFinished(); },
        adError: (err) => { if (cb.onError) cb.onError(err); },
      });
    } catch (e) {
      if (cb.onError) cb.onError(e);
    }
  }

  function rewarded(cb) { requestAd("rewarded", cb); }
  function midgame(cb)  { requestAd("midgame", cb); }

  // ---- user (Full Launch account linking) ----
  async function getUserToken() {
    if (!isPortal()) return null;
    try { return await sdk.user.getUserToken(); } catch (e) { return null; }
  }

  return {
    init, isPortal, isCGBuild,
    loadingStart, loadingStop, gameplayStart, gameplayStop, happytime,
    hasAdblock, requestAd, rewarded, midgame,
    getUserToken,
  };
})();

if (typeof window !== "undefined") window.CG = CG;
