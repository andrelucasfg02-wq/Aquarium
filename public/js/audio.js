/* audio.js — tiny offline WebAudio: soft ambient pad (music) + blip SFX. No assets. */
"use strict";

const AudioFX = (() => {
  let ctx = null, musicNodes = [], sfxOn = true, musicOn = false, evTrack = null;

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

  // gentle looping pad: two detuned sines through a slow LFO, very quiet
  function startMusic() {
    const c = ensure(); if (!c || musicNodes.length) return;
    const g = c.createGain(); g.gain.value = .028; g.connect(c.destination);
    const notes = [220, 277.18, 329.63, 440];
    notes.forEach((f, i) => {
      const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const lfo = c.createOscillator(); lfo.frequency.value = .07 + i * .03;
      const lg = c.createGain(); lg.gain.value = f * .004;
      lfo.connect(lg); lg.connect(o.frequency);
      o.connect(g); o.start(); lfo.start();
      musicNodes.push(o, lfo);
    });
    musicNodes.push(g);
  }
  function stopMusic() {
    musicNodes.forEach((n) => { try { n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} });
    musicNodes = [];
  }

  // Event song (ex: tema do Autumn Crush): pausa o pad ambiente enquanto toca.
  // Resolve com o <audio> se o autoplay foi bloqueado (quem chama tenta de novo
  // no proximo gesto do usuario), ou null.
  function setEventTrack(url) {
    if (evTrack) { try { evTrack.pause(); } catch (e) {} evTrack = null; }
    if (url && musicOn) {
      stopMusic();
      evTrack = new Audio(url);
      evTrack.loop = true;
      evTrack.volume = 0.5;
      evTrack.preload = "auto";
      return evTrack.play().then(() => null).catch(() => evTrack);
    }
    if (musicOn) startMusic();
    return Promise.resolve(null);
  }

  return {
    unlock() { ensure(); }, // call on first user gesture
    setSfx(on) { sfxOn = !!on; },
    setMusic(on) {
      musicOn = !!on;
      if (on) { if (evTrack) evTrack.play().catch(() => {}); else startMusic(); }
      else { stopMusic(); if (evTrack) { try { evTrack.pause(); } catch (e) {} } }
    },
    setEventTrack,
    get musicOn() { return musicOn; },
    pop()   { blip(620, .09, "triangle", .10); },
    plop()  { blip(300, .12, "sine", .14); },
    munch() { blip(180, .07, "square", .05); setTimeout(() => blip(220, .07, "square", .05), 70); },
    coin()  { blip(880, .08, "sine", .10); setTimeout(() => blip(1320, .12, "sine", .10), 80); },
    bubble(){ blip(500 + Math.random() * 500, .06, "sine", .05); },
    error() { blip(160, .2, "sawtooth", .06); },
  };
})();
