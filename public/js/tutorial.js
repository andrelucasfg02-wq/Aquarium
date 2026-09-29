/* tutorial.js — first-run guided tour (coach marks) over the real game UI.
   Auto-starts once per device; replayable from Settings. */
"use strict";

const Tutorial = (() => {
  const KEY = "chibi_tut_done_v1";

  const STEPS = [
    {
      icon: "👋", title: "Welcome!",
      text: "This is your aquarium — your fish live here, grow up, and make coins for you.",
      target: null,
    },
    {
      icon: "🐟", title: "Tap a fish",
      text: "Tap any fish to open its menu: feed it, pet it, check its mood, level and coin timer.",
      target: "#tank",
    },
    {
      icon: "💰", title: "Collect coins",
      text: "Fish make coins over time. When you see 💰 floating over a fish, tap it to collect!",
      target: "#tank",
    },
    {
      icon: "🍽️", title: "Feed your fish",
      text: "Hungry fish get sick! Tap 🍽️ to feed everyone at once. Buy more food in 🎒 Inventory.",
      target: "#btn-feed",
    },
    {
      icon: "🧽", title: "Keep it clean",
      text: "Dirt spots appear every hour. Tap 🧽, then drag the sponge over them to wipe them away.",
      target: "#btn-clean",
    },
    {
      icon: "🛍️", title: "Grow your tank",
      text: "Buy new fish in the 🐟 Fish Shop below, breed them with 🥚, and decorate with 🪸!",
      target: '.nav-tab[data-screen="fishshop"]',
    },
    {
      icon: "🎉", title: "You're ready!",
      text: "That's the basics — have fun! You can replay this tour anytime from ⚙️ Settings.",
      target: null,
    },
  ];

  let overlay = null, spot = null, card = null, dots = null, nextBtn = null;
  let idx = 0;

  function done() {
    try { localStorage.setItem(KEY, "1"); } catch (e) { /* private mode */ }
  }
  function isDone() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }

  function build() {
    overlay = document.createElement("div");
    overlay.id = "tut-overlay";
    overlay.innerHTML =
      '<div id="tut-dim"></div>' +
      '<div id="tut-spot" hidden></div>' +
      '<div id="tut-card">' +
        '<div id="tut-icon"></div><h3 id="tut-title"></h3><p id="tut-text"></p>' +
        '<div id="tut-dots"></div>' +
        '<div id="tut-btns"><button id="tut-skip" class="tut-btn ghost">Skip</button>' +
        '<button id="tut-next" class="tut-btn primary">Next →</button></div>' +
      "</div>";
    document.body.appendChild(overlay);
    spot = overlay.querySelector("#tut-spot");
    card = overlay.querySelector("#tut-card");
    dots = overlay.querySelector("#tut-dots");
    nextBtn = overlay.querySelector("#tut-next");
    overlay.querySelector("#tut-skip").addEventListener("click", finish);
    nextBtn.addEventListener("click", () => {
      if (idx >= STEPS.length - 1) finish();
      else { idx++; render(); }
    });
    window.addEventListener("resize", place);
  }

  function render() {
    const st = STEPS[idx];
    overlay.querySelector("#tut-icon").textContent = st.icon;
    overlay.querySelector("#tut-title").textContent = st.title;
    overlay.querySelector("#tut-text").textContent = st.text;
    dots.textContent = STEPS.map((_, i) => (i === idx ? "●" : "○")).join(" ");
    nextBtn.textContent = idx >= STEPS.length - 1 ? "Done ✓" : "Next →";
    place();
  }

  function place() {
    if (!overlay) return;
    const st = STEPS[idx];
    let rect = null;
    if (st.target) {
      try {
        const el = document.querySelector(st.target);
        if (el && el.getBoundingClientRect) rect = el.getBoundingClientRect();
      } catch (e) { rect = null; }
    }
    const vw = window.innerWidth || 400, vh = window.innerHeight || 700;
    if (rect && rect.width > 0 && rect.height > 0) {
      const pad = 10;
      spot.hidden = false;
      spot.style.left = Math.max(4, rect.left - pad) + "px";
      spot.style.top = Math.max(4, rect.top - pad) + "px";
      spot.style.width = rect.width + pad * 2 + "px";
      spot.style.height = rect.height + pad * 2 + "px";
      // card: below the spotlight if it fits, else above, else centered
      card.style.left = "50%";
      card.style.transform = "translateX(-50%)";
      const estH = 260;
      let top = rect.bottom + 14;
      if (top + estH > vh - 12) top = rect.top - estH - 14;
      if (top < 12) top = Math.max(12, (vh - estH) / 2);
      card.style.top = top + "px";
      void vw;
    } else {
      spot.hidden = true;
      card.style.left = "50%";
      card.style.top = "50%";
      card.style.transform = "translate(-50%,-50%)";
    }
  }

  function finish() {
    done();
    if (overlay) {
      window.removeEventListener("resize", place);
      overlay.remove();
      overlay = null; spot = null; card = null; dots = null; nextBtn = null;
    }
    idx = 0;
  }

  function start() {
    if (overlay) return false; // already open
    idx = 0;
    build();
    render();
    return true;
  }

  function maybeAutoStart() {
    if (isDone()) return false;
    return start();
  }

  return { start, maybeAutoStart, isDone, finish, steps: () => STEPS.length };
})();
