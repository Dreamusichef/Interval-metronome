'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   GAME SFX — result-screen reward sounds.

   window.GameSfx(key)            play a sound by event key (no-op if unknown)
   window.GameSfx.preloadAll()    eagerly fetch every clip
   window.GameSfx.setEnabled(b)   mute / unmute
   window.GameSfx.completeKey(mode, suddenDeath, rank)  → the right "complete" key

   Files live in sounds/ (mono 256kbps mp3). Ranks D/C/B share one reveal clip.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  const BASE = 'sounds/';
  const V = '1';   // cache-bust — bump if a clip is re-exported
  const MANIFEST = {
    // Rank-reveal flourish (fires when the emblem bursts in)
    rankE: 'rank-e.mp3',
    rankD: 'rank-dcb.mp3', rankC: 'rank-dcb.mp3', rankB: 'rank-dcb.mp3',
    rankA: 'rank-a.mp3', rankS: 'rank-s.mp3', rankSS: 'rank-ss.mp3',
    // Run-complete stingers (fire when the result overlay appears)
    'completeTT-E': 'complete-tt-e.mp3',
    'completeTT-DCBA': 'complete-tt-dcba.mp3',
    'completeTT-SSS': 'complete-tt-sss.mp3',
    completeSD: 'complete-sd.mp3',
    completeGauntlet: 'complete-gauntlet.mp3',
    // Fail stinger (sudden death death / gauntlet fail)
    fail: 'fail.mp3',
    // Each trophy pop
    trophyPop: 'trophy.mp3',
  };

  const cache = {};
  let enabled = true;
  const LEVEL = 0.63;   // −4 dB (10^(−4/20)) — trims the reward sounds vs the click

  function get(key) {
    const file = MANIFEST[key];
    if (!file) return null;
    if (!cache[file]) {
      const a = new Audio(BASE + file + '?v=' + V);
      a.preload = 'auto';
      a.volume = LEVEL;
      cache[file] = a;
    }
    return cache[file];
  }

  function play(key) {
    if (!enabled) return;
    const a = get(key);
    if (!a) return;
    try { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }

  play.preloadAll = () => Object.keys(MANIFEST).forEach(get);
  play.setEnabled = (b) => { enabled = !!b; };
  play.manifest = MANIFEST;
  // Pick the run-complete stinger for a cleared run.
  play.completeKey = (mode, suddenDeath, rank) => {
    if (mode === 'gauntlet') return 'completeGauntlet';
    if (suddenDeath) return 'completeSD';
    if (rank === 'S' || rank === 'SS') return 'completeTT-SSS';
    if (rank === 'E') return 'completeTT-E';
    return 'completeTT-DCBA';   // D · C · B · A
  };

  window.GameSfx = play;

  // Warm the cache on the first user gesture (also unlocks audio on mobile).
  const warm = () => {
    play.preloadAll();
    window.removeEventListener('pointerdown', warm);
    window.removeEventListener('keydown', warm);
  };
  window.addEventListener('pointerdown', warm, { once: true });
  window.addEventListener('keydown', warm, { once: true });
})();
