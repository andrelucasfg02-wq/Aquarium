/* audio.js — blip SFX (WebAudio) + tema do jogo em loop ("Amber in the Aquarium"). */
"use strict";

const AudioFX = (() => {
  let ctx = null, sfxOn = true, musicOn = false;
  let songEl = null, songKickArmed = false;
  const GAME_SONG = "assets/amber-in-the-aquarium.mp3";

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function blip(freq, dur, type, vol) {
    if (!sfxOn) return;
    const c = ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || .12, c.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, c.currentTime + (dur || .12));
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + (dur || .12));
  }

  function songKick() {
    songKickArmed = false;
    document.removeEventListener("pointerdown", songKick);
    startMusic();
  }
  function armSongKick() {
    if (songKickArmed) return;
    songKickArmed = true;
    document.addEventListener("pointerdown", songKick);
  }
  function disarmSongKick() {
    songKickArmed = false;
    document.removeEventListener("pointerdown", songKick);
  }

  // Tema do jogo em loop. Se o autoplay for bloqueado, arma para comecar
  // no primeiro toque do usuario.
  function startMusic() {
    if (!musicOn) return;
    if (songEl && !songEl.paused) return;
    if (!songEl) {
      songEl = new Audio(GAME_SONG);
      songEl.loop = true;
      songEl.volume = 0.5;
      songEl.preload = "auto";
    }
    const p = songEl.play();
    if (p && p.catch) p.catch(() => armSongKick());
  }
  function stopMusic() {
    disarmSongKick();
    if (songEl) { try { songEl.pause(); } catch (e) {} }
  }

  return {
    unlock() { ensure(); startMusic(); }, // call on first user gesture
    setSfx(on) { sfxOn = !!on; },
    setMusic(on) {
      musicOn = !!on;
      if (on) startMusic(); else stopMusic();
    },
    get musicOn() { return musicOn; },
    pop()   { blip(620, .09, "triangle", .10); },
    plop()  { blip(300, .12, "sine", .14); },
    munch() { blip(180, .07, "square", .05); setTimeout(() => blip(220, .07, "square", .05), 70); },
    coin()  { blip(880, .08, "sine", .10); setTimeout(() => blip(1320, .12, "sine", .10), 80); },
    bubble(){ blip(500 + Math.random() * 500, .06, "sine", .05); },
    error() { blip(160, .2, "sawtooth", .06); },
  };
})();
