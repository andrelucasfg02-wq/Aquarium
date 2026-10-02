/* install.js — "Instalar como app" promo.
 *
 * Shows a one-tap install prompt: on Android/Chrome it uses beforeinstallprompt
 * so tapping "Instalar app" opens the native install dialog directly; on iOS
 * (no programmatic install API) it shows the Share → Add to Home Screen steps.
 * Only shows when the game runs in a browser tab (not already installed) and
 * at most once a week after dismissal.
 */
"use strict";

const InstallPromo = (() => {
  const DISMISS_KEY = "aquanim_install_dismissed";
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  let deferredPrompt = null;

  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  const isStandalone = () =>
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    navigator.standalone === true;

  function shouldShow() {
    if (isStandalone()) return false;
    try {
      const d = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (d && Date.now() - d < WEEK_MS) return false;
    } catch (e) { /* ignore */ }
    return true;
  }

  function dismiss(forever) {
    const ov = document.getElementById("install-overlay");
    if (ov) ov.hidden = true;
    try {
      localStorage.setItem(DISMISS_KEY, String(forever ? Date.now() + 365 * 24 * 3600 * 1000 : Date.now()));
    } catch (e) { /* ignore */ }
  }

  function show() {
    if (!shouldShow()) return;
    let ov = document.getElementById("install-overlay");
    if (!ov) { ov = build(); document.body.appendChild(ov); }
    // iOS gets instructions; Android/others get the one-tap button (enabled
    // when beforeinstallprompt fired, otherwise same instructions fallback)
    const btn = document.getElementById("install-go");
    const steps = document.getElementById("install-ios-steps");
    const andSteps = document.getElementById("install-android-steps");
    andSteps.hidden = true;
    if (isIOS()) {
      btn.hidden = true;
      steps.hidden = false;
    } else {
      btn.hidden = false;
      steps.hidden = true;
      btn.querySelector("span").textContent = t("install.btn");
    }
    ov.hidden = false;
  }

  function build() {
    const ov = document.createElement("div");
    ov.id = "install-overlay";
    ov.hidden = true;
    ov.innerHTML = `
      <div class="install-card">
        <button class="install-x" aria-label="✕">✕</button>
        <img class="install-icon" src="assets/icons/icon-192.png" alt="AquaNim">
        <h2>${t("install.title")}</h2>
        <p>${t("install.text")}</p>
        <button id="install-go" class="pill-btn install-cta"><span>${t("install.btn")}</span> 📲</button>
        <p id="install-ios-steps" class="install-steps" hidden>${t("install.ios_steps")}</p>
        <p id="install-android-steps" class="install-steps" hidden>${t("install.android_steps")}</p>
        <button id="install-later" class="install-later">${t("install.later")}</button>
      </div>`;
    ov.addEventListener("click", (e) => { if (e.target === ov) dismiss(false); });
    ov.querySelector(".install-x").onclick = () => dismiss(false);
    ov.querySelector("#install-later").onclick = () => dismiss(false);
    ov.querySelector("#install-go").onclick = doInstall;
    return ov;
  }

  async function doInstall() {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === "accepted") {
          dismiss(true);
          if (typeof UI !== "undefined" && UI.toast) UI.toast(t("install.done"));
        }
      } catch (e) { /* ignore */ }
      deferredPrompt = null;
      return;
    }
    // no native prompt available (e.g. Firefox Android): show manual steps
    document.getElementById("install-go").hidden = true;
    document.getElementById("install-android-steps").hidden = false;
  }

  function maybeShow(delayMs) {
    setTimeout(() => {
      // preview hook: ?installpreview=1 forces the modal (for screenshots)
      const force = new URLSearchParams(location.search).get("installpreview") === "1";
      if (force) { show(); return; }
      if (!shouldShow()) return;
      // don't stack over the event promo if it's open
      const promo = document.getElementById("promo-overlay");
      if (promo && !promo.hidden) return;
      show();
    }, delayMs == null ? 4000 : delayMs);
  }

  if (typeof window !== "undefined") {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
    });
    window.addEventListener("appinstalled", () => dismiss(true));
  }

  return { show, maybeShow, shouldShow, isStandalone, isIOS };
})();
