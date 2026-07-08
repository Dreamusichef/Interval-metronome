'use strict';

/* Canonical game-mode subdivision registry. IDs match MetronomeEngine SUBDIVISION_TICKS keys. */

const GameSubdivisions = (() => {
  const DEFAULT = 'sixteenth';

  const GAME_SUBDIVISIONS = {
    quarter:   { ticks: 1, label: 'Quarters',           playLabel: 'quarters',            icon: '♩' },
    eighth:    { ticks: 2, label: '8th notes',          playLabel: '8ths',                icon: '♪' },
    triplet:   { ticks: 3, label: '8th-note triplets',  playLabel: '8th-note triplets',   icon: '♪³' },
    sixteenth: { ticks: 4, label: '16th notes',         playLabel: '16ths',               icon: '♬' },
    sextuplet: { ticks: 6, label: '16th-note triplets', playLabel: '16th-note triplets',  icon: '♬⁶' },
  };

  const MODE_ALLOWED = {
    timetrial:   ['quarter', 'eighth', 'triplet', 'sixteenth', 'sextuplet'],
    suddendeath: ['quarter', 'eighth', 'triplet', 'sixteenth', 'sextuplet'],
    gauntlet:    ['triplet', 'sixteenth', 'sextuplet'],
  };

  function isValid(id) {
    return id != null && Object.prototype.hasOwnProperty.call(GAME_SUBDIVISIONS, id);
  }

  function ticksFor(id) {
    const d = GAME_SUBDIVISIONS[id];
    return d ? d.ticks : GAME_SUBDIVISIONS[DEFAULT].ticks;
  }

  function labelFor(id) {
    const d = GAME_SUBDIVISIONS[id];
    return d ? d.label : GAME_SUBDIVISIONS[DEFAULT].label;
  }

  function playLabelFor(id) {
    const d = GAME_SUBDIVISIONS[id];
    return d ? d.playLabel : GAME_SUBDIVISIONS[DEFAULT].playLabel;
  }

  function playBanner(id) {
    return 'Play ' + playLabelFor(id);
  }

  function iconFor(id) {
    const d = GAME_SUBDIVISIONS[id];
    return d ? d.icon : '';
  }

  function allowedForMode(mode) {
    return MODE_ALLOWED[mode] || MODE_ALLOWED.timetrial;
  }

  function clampForMode(id, mode) {
    const allowed = allowedForMode(mode);
    if (id && allowed.includes(id)) return id;
    if (allowed.includes(DEFAULT)) return DEFAULT;
    return allowed[0];
  }

  function allIds() {
    return Object.keys(GAME_SUBDIVISIONS);
  }

  return {
    DEFAULT,
    GAME_SUBDIVISIONS,
    MODE_ALLOWED,
    isValid,
    ticksFor,
    labelFor,
    playLabelFor,
    playBanner,
    iconFor,
    allowedForMode,
    clampForMode,
    allIds,
  };
})();

if (typeof window !== 'undefined') window.GameSubdivisions = GameSubdivisions;
if (typeof module !== 'undefined' && module.exports) module.exports = GameSubdivisions;
