'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   SESSION CONTROLS — mount(root, options) for metronome + ramp chrome.
   Binds existing element IDs under root (or document). Applies options.theme
   as CSS variables on root; supports options.layout ('default' | 'compact').
   Requires SessionEngine + MetronomeEngine (bare lexical global).
   ════════════════════════════════════════════════════════════════════════════ */

const SessionControls = (() => {
  const MODE_CYCLE = ['accent', 'click', 'silent'];
  const DEFAULT_IDS = {
    bpmValue: 'bpmValue',
    bpmSlider: 'bpmSlider',
    startStopBtn: 'startStopBtn',
    tapBtn: 'tapBtn',
    soundModeBtn: 'soundModeBtn',
    beatCountDec: 'beatCountDec',
    beatCountInc: 'beatCountInc',
    beatCountDisplay: 'beatCountDisplay',
    beatIndicators: 'beatIndicators',
    intervalToggle: 'intervalToggle',
    intervalConfig: 'intervalConfig',
    intervalStatus: 'intervalStatus',
    numSets: 'numSets',
    setMins: 'setMins',
    setSecs: 'setSecs',
    startBpm: 'startBpm',
    bpmIncrement: 'bpmIncrement',
    restMins: 'restMins',
    restSecs: 'restSecs',
    statusPhase: 'statusPhase',
    statusSet: 'statusSet',
    statusBpm: 'statusBpm',
    statusCountdown: 'statusCountdown',
    progressBar: 'progressBar',
    statusNext: 'statusNext',
    doneOverlay: 'doneOverlay',
    doneSummary: 'doneSummary',
    doneBtn: 'doneBtn',
    pauseBtn: 'pauseBtn',
    countInRow: 'countInRow',
  };

  function applyTheme(root, theme) {
    if (!root || !root.style || !theme || typeof theme !== 'object') return;
    Object.keys(theme).forEach((key) => {
      const prop = key.startsWith('--') ? key : '--' + key;
      root.style.setProperty(prop, theme[key]);
    });
  }

  function resolveEl(scope, id) {
    if (!id) return null;
    if (scope && scope.querySelector) {
      // IDs in this app are alphanumeric / known-safe for #id selectors.
      const local = scope.querySelector('#' + id);
      if (local) return local;
    }
    return (typeof document !== 'undefined') ? document.getElementById(id) : null;
  }

  function parseIntVal(el, fallback) {
    if (!el) return fallback;
    const v = parseInt(el.value, 10);
    return isNaN(v) ? fallback : v;
  }

  function safeHandler(label, fn) {
    return function (ev) {
      try { return fn.call(this, ev); }
      catch (e) {
        const msg = '[' + label + '] ' + (e && e.message ? e.message : String(e));
        console.error(msg, e);
        if (typeof window !== 'undefined' && window.__showError) window.__showError(msg);
      }
    };
  }

  /**
   * @param {Element|Document|null} root
   * @param {object} [options]
   * @param {object} [options.theme] CSS variables applied on root
   * @param {'default'|'compact'|string} [options.layout]
   * @param {object} [options.selectors] override default element IDs
   * @param {object} [options.engine] SessionEngine instance (default window.SessionEngine)
   * @param {object} [options.metronome] MetronomeEngine (default bare MetronomeEngine)
   * @returns {{ destroy: Function, els: object, setDisplayBpm: Function, readRampConfig: Function, applyRampConfig: Function }}
   */
  function mount(root, options) {
    options = options || {};
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) throw new Error('SessionControls.mount: no root/document');

    if (root && root.nodeType === 1) {
      if (options.theme) applyTheme(root, options.theme);
      if (options.layout) {
        root.dataset.sessionLayout = options.layout;
        root.classList.toggle('session-layout-compact', options.layout === 'compact');
      }
    }

    const engine = options.engine ||
      (typeof window !== 'undefined' ? window.SessionEngine : null);
    if (!engine) throw new Error('SessionControls.mount: SessionEngine required');

    const ME = options.metronome != null
      ? options.metronome
      : ((typeof MetronomeEngine !== 'undefined') ? MetronomeEngine : null);

    const ids = Object.assign({}, DEFAULT_IDS, options.selectors || {});
    const els = {};
    Object.keys(ids).forEach((key) => { els[key] = resolveEl(scope, ids[key]); });

    const subBtns = scope.querySelectorAll
      ? scope.querySelectorAll('.sub-btn')
      : [];
    const bpmButtons = scope.querySelectorAll
      ? scope.querySelectorAll('.bpm-btn')
      : [];
    const countInBtns = els.countInRow
      ? els.countInRow.querySelectorAll('.ci-btn')
      : (scope.querySelectorAll ? scope.querySelectorAll('#countInRow .ci-btn') : []);

    let currentBeats = engine.getBeatsPerMeasure ? engine.getBeatsPerMeasure() : 4;
    const listeners = []; // { target, type, fn, opts }

    function on(target, type, fn, opts) {
      if (!target) return;
      target.addEventListener(type, fn, opts);
      listeners.push({ target, type, fn, opts });
    }

    function setDisplayBpm(val) {
      const clamped = engine.clampBpm(val);
      if (els.bpmValue) els.bpmValue.value = clamped;
      if (els.bpmSlider) els.bpmSlider.value = clamped;
      ME?.setBpm(clamped);
      return clamped;
    }

    function flashBeat(beatIndex, soundType) {
      const el = resolveEl(scope, 'beat' + beatIndex);
      if (!el || soundType === 'silent') return;
      el.classList.remove('flash-accent', 'flash-click');
      void el.offsetWidth;
      el.classList.add('flash-' + soundType);
      setTimeout(() => el.classList.remove('flash-accent', 'flash-click'), 90);
    }

    function renderBeatIndicators(count) {
      const container = els.beatIndicators;
      if (!container) return;
      const modes = ME ? ME.getBeatModes() : Array(count).fill('click').fill('accent', 0, 1);
      container.innerHTML = '';
      for (let i = 0; i < count; i++) {
        const mode = modes[i] !== undefined ? modes[i] : (i === 0 ? 'accent' : 'click');
        const el = document.createElement('div');
        el.className = 'beat-indicator';
        el.id = 'beat' + i;
        el.dataset.beat = String(i);
        el.dataset.mode = mode;
        el.innerHTML = '<span class="beat-num">' + (i + 1) + '</span><span class="beat-pip"></span>';
        el.addEventListener('click', () => {
          const next = MODE_CYCLE[(MODE_CYCLE.indexOf(el.dataset.mode) + 1) % MODE_CYCLE.length];
          el.dataset.mode = next;
          ME?.setBeatMode(i, next);
        });
        container.appendChild(el);
      }
    }

    function readRampConfig() {
      return {
        totalSets: Math.max(1, parseIntVal(els.numSets, 1)),
        setDurationSecs:
          Math.max(0, parseIntVal(els.setMins, 0)) * 60 + Math.max(0, parseIntVal(els.setSecs, 0)),
        restDurationSecs:
          Math.max(0, parseIntVal(els.restMins, 0)) * 60 + Math.max(0, parseIntVal(els.restSecs, 0)),
        startBpm: engine.clampBpm(parseIntVal(els.startBpm, 80)),
        bpmIncrement: parseIntVal(els.bpmIncrement, 0),
        // Favourite-preset shape (also used by app favourites):
        startBpmRaw: parseIntVal(els.startBpm, 80),
        numSets: parseIntVal(els.numSets, 4),
        setMins: parseIntVal(els.setMins, 2),
        setSecs: parseIntVal(els.setSecs, 0),
        restMins: parseIntVal(els.restMins, 0),
        restSecs: parseIntVal(els.restSecs, 30),
        countInBars: engine.getCountInBars(),
      };
    }

    function applyRampConfig(c) {
      if (!c) return;
      if (els.startBpm) els.startBpm.value = c.startBpm;
      if (els.numSets) els.numSets.value = c.numSets;
      if (els.setMins) els.setMins.value = c.setMins;
      if (els.setSecs) els.setSecs.value = c.setSecs;
      if (els.bpmIncrement) els.bpmIncrement.value = c.bpmIncrement;
      if (els.restMins) els.restMins.value = c.restMins;
      if (els.restSecs) els.restSecs.value = c.restSecs;
      if (typeof c.countInBars === 'number') {
        syncCountInUi(engine.setCountInBars(Math.max(0, Math.min(4, c.countInBars))));
      } else if (typeof c.countIn === 'boolean') {
        syncCountInUi(engine.setCountInBars(c.countIn ? 1 : 0));
      }
    }

    function syncCountInUi(n) {
      countInBtns.forEach((b) => {
        b.classList.toggle('active', parseInt(b.dataset.cibars, 10) === n);
      });
    }

    function applyRampToggleState() {
      if (!els.intervalConfig || !els.intervalToggle) return;
      els.intervalConfig.classList.toggle('visible', !!els.intervalToggle.checked);
    }

    function updateStatusDisplay(snap) {
      if (!snap) snap = engine.getStatusSnapshot();
      if (els.statusPhase) {
        els.statusPhase.textContent = snap.phaseLabel;
        els.statusPhase.className = 'status-phase' +
          (snap.phase === 'rest' ? ' rest' : snap.phase === 'countin' ? ' countin' : '');
      }
      if (els.statusSet) els.statusSet.textContent = 'Set ' + snap.currentSet + ' of ' + snap.totalSets;
      if (els.statusBpm) els.statusBpm.textContent = 'BPM: ' + snap.currentBpm;
      if (els.statusCountdown) els.statusCountdown.textContent = snap.countdownLabel;
      if (els.progressBar) {
        els.progressBar.style.width = snap.progressPct + '%';
        els.progressBar.classList.toggle('rest-mode', snap.phase === 'rest');
      }
      if (els.statusNext) els.statusNext.textContent = snap.nextLabel;
    }

    function setConfigDisabled(disabled) {
      [els.numSets, els.setMins, els.setSecs, els.startBpm,
        els.bpmIncrement, els.restMins, els.restSecs, els.intervalToggle]
        .forEach((el) => { if (el) el.disabled = disabled; });
    }

    function applyRunningUi(info) {
      if (!info) return;
      if (els.startStopBtn) {
        if (info.resetButtons || !info.running) {
          els.startStopBtn.textContent = 'START';
          els.startStopBtn.classList.remove('running');
        } else if (info.running) {
          els.startStopBtn.textContent = 'STOP';
          els.startStopBtn.classList.add('running');
        }
      }
      if (els.pauseBtn) {
        if (info.showPause) {
          els.pauseBtn.classList.add('visible');
          if (info.paused) {
            els.pauseBtn.textContent = 'RESUME';
            els.pauseBtn.classList.add('resuming');
          } else {
            els.pauseBtn.textContent = 'PAUSE';
            els.pauseBtn.classList.remove('resuming');
          }
        } else {
          els.pauseBtn.classList.remove('visible', 'resuming');
        }
      }
      if (els.intervalStatus) {
        els.intervalStatus.classList.toggle('visible', !!info.showStatus);
      }
    }

    // Wire engine hooks
    engine.configure({
      getMetronome() { return ME; },
      getConfig() {
        const c = readRampConfig();
        return {
          totalSets: c.totalSets,
          setDurationSecs: c.setDurationSecs,
          restDurationSecs: c.restDurationSecs,
          startBpm: c.startBpm,
          bpmIncrement: c.bpmIncrement,
        };
      },
      getBeatsPerMeasure() { return currentBeats; },
      ensureRampEnabled() {
        if (els.intervalToggle && !els.intervalToggle.checked) {
          els.intervalToggle.checked = true;
          applyRampToggleState();
        }
      },
      onBpmDisplay(bpm) { setDisplayBpm(bpm); },
      onStatus(snap) { updateStatusDisplay(snap); },
      onRunningUi(info) { applyRunningUi(info); },
      onConfigDisabled(disabled) { setConfigDisabled(disabled); },
      onDone(summary) {
        if (els.doneSummary) els.doneSummary.textContent = summary;
        if (els.doneOverlay) els.doneOverlay.classList.add('visible');
      },
    });

    // Ensure AppRamp points at engine public API
    if (typeof window !== 'undefined' && engine.publicApi) {
      window.AppRamp = engine.publicApi;
    }

    ME?.onBeat(flashBeat);

    // ── Sound mode ──────────────────────────────────────────────────────────
    on(els.soundModeBtn, 'click', () => {
      const current = ME?.getSoundMode() ?? 'click';
      const next = current === 'click' ? 'cowbell' : 'click';
      ME?.setSoundMode(next);
      els.soundModeBtn.textContent = next === 'cowbell' ? 'COWBELL' : 'CLICK';
      els.soundModeBtn.classList.toggle('cowbell', next === 'cowbell');
    });

    // ── Beat count ──────────────────────────────────────────────────────────
    on(els.beatCountDec, 'click', () => {
      if (currentBeats <= 1) return;
      currentBeats--;
      if (els.beatCountDisplay) els.beatCountDisplay.textContent = String(currentBeats);
      engine.setBeatsPerMeasure(currentBeats);
      ME?.setBeatsPerMeasure(currentBeats);
      renderBeatIndicators(currentBeats);
    });
    on(els.beatCountInc, 'click', () => {
      if (currentBeats >= 16) return;
      currentBeats++;
      if (els.beatCountDisplay) els.beatCountDisplay.textContent = String(currentBeats);
      engine.setBeatsPerMeasure(currentBeats);
      ME?.setBeatsPerMeasure(currentBeats);
      renderBeatIndicators(currentBeats);
    });
    renderBeatIndicators(currentBeats);

    // ── Tap tempo ───────────────────────────────────────────────────────────
    const tapTimes = [];
    const TAP_RESET_MS = 2500;
    let tapResetTimer = null;
    on(els.tapBtn, 'click', () => {
      const now = Date.now();
      if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > TAP_RESET_MS) tapTimes.length = 0;
      tapTimes.push(now);
      if (tapTimes.length >= 4) {
        let total = 0;
        for (let i = 1; i < tapTimes.length; i++) total += tapTimes[i] - tapTimes[i - 1];
        setDisplayBpm(engine.clampBpm(Math.round(60000 / (total / (tapTimes.length - 1)))));
      }
      if (tapTimes.length > 8) tapTimes.shift();
      clearTimeout(tapResetTimer);
      tapResetTimer = setTimeout(() => { tapTimes.length = 0; }, TAP_RESET_MS);
    });

    // ── BPM controls ────────────────────────────────────────────────────────
    on(els.bpmSlider, 'input', () => setDisplayBpm(parseInt(els.bpmSlider.value, 10)));
    bpmButtons.forEach((btn) => {
      on(btn, 'click', () => {
        const base = parseInt(els.bpmValue?.value, 10) || 120;
        setDisplayBpm(engine.clampBpm(base + parseInt(btn.dataset.delta, 10)));
      });
    });
    on(els.bpmValue, 'input', () => {
      const val = parseInt(els.bpmValue.value, 10);
      if (!isNaN(val)) {
        if (els.bpmSlider) els.bpmSlider.value = String(Math.max(20, Math.min(400, val)));
        ME?.setBpm(val);
      }
    });
    on(els.bpmValue, 'change', () => setDisplayBpm(parseInt(els.bpmValue.value, 10) || 120));
    on(els.bpmValue, 'focus', () => els.bpmValue.select());

    subBtns.forEach((btn) => {
      if (typeof GameSubdivisions !== 'undefined') {
        btn.title = GameSubdivisions.labelFor(btn.dataset.mode);
      }
      on(btn, 'click', () => {
        subBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        ME?.setSubdivision(btn.dataset.mode);
      });
    });

    // ── Start / Stop ────────────────────────────────────────────────────────
    on(els.startStopBtn, 'click', safeHandler('startStop', () => {
      if (engine.isRunning()) { engine.stop(); return; }
      if (els.intervalToggle && els.intervalToggle.checked) {
        engine.startIntervalSession();
      } else {
        engine.startPlain(parseInt(els.bpmValue?.value, 10) || 120);
      }
    }));

    on(els.pauseBtn, 'click', safeHandler('pause', () => { engine.togglePause(); }));

    // ── Ramp toggle ─────────────────────────────────────────────────────────
    on(els.intervalToggle, 'change', safeHandler('rampChange', applyRampToggleState));
    on(els.intervalToggle, 'input', safeHandler('rampInput', applyRampToggleState));
    const rampLabel = els.intervalToggle && els.intervalToggle.closest
      ? els.intervalToggle.closest('.toggle-switch')
      : null;
    if (rampLabel) {
      on(rampLabel, 'click', safeHandler('rampLabelClick', () => {
        setTimeout(applyRampToggleState, 0);
      }));
    }

    // ── Count-in ────────────────────────────────────────────────────────────
    syncCountInUi(engine.getCountInBars());
    countInBtns.forEach((b) => {
      on(b, 'click', () => {
        syncCountInUi(engine.setCountInBars(parseInt(b.dataset.cibars, 10)));
      });
    });

    on(els.doneBtn, 'click', () => {
      if (els.doneOverlay) els.doneOverlay.classList.remove('visible');
    });

    function destroy() {
      listeners.forEach(({ target, type, fn, opts }) => {
        target.removeEventListener(type, fn, opts);
      });
      listeners.length = 0;
      clearTimeout(tapResetTimer);
    }

    return {
      destroy,
      els,
      subBtns,
      bpmButtons,
      setDisplayBpm,
      readRampConfig,
      applyRampConfig,
      applyRampToggleState,
      getCurrentBeats() { return currentBeats; },
      cycleSubdivision() {
        const btns = [...subBtns];
        const i = btns.findIndex((b) => b.classList.contains('active'));
        const next = btns[(i + 1) % btns.length];
        if (next) next.click();
      },
    };
  }

  return { mount, applyTheme };
})();

if (typeof window !== 'undefined') window.SessionControls = SessionControls;
if (typeof module !== 'undefined' && module.exports) module.exports = SessionControls;
