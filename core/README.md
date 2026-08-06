# AOD Core (vendored)

Committed snapshot of **`@dreamusichef/core`** for this static app. Source of truth: the [AODB-Core](https://github.com/Dreamusichef/AODB-Core) repo / GitHub Package — do not hand-edit files here to “catch up” with unpublished Core.

## Upgrade

From the Interval repo root (needs GitHub Packages auth):

```bash
npm run upgrade-core -- X.Y.Z
```

That installs the pin, copies `js/` `css/` `brand/` into this folder, bumps `?v=` cache-bust tokens, and runs `npm test`.

Manual equivalent:

```bash
npm install @dreamusichef/core@X.Y.Z --save-exact
npm run sync-core
npm run cache-bust-core -- X.Y.Z
npm test
```

`package.json` should list `"@dreamusichef/core": "X.Y.Z"`. `node_modules/` stays gitignored; **this `core/` tree is committed**.

## What belongs here

Anything a metronome-based practice app needs to detect hits and play in time:

- Metronome engine, session/ramp engine + shared controls chrome
- MIDI + audio input, pad learn, onset detector
- Timing math, two-pass calibration (quarter + 16th), calibration store + chrome
- Brand tokens / logo
- Cloud **auth** + profile + `getClient()` (same Supabase project; apps add their own tables)
- FAQ / patch-notes **markdown format** + Storage fetch/semver helpers

## What does **not** belong here

Game Mode (Time Trial / Sudden Death / Gauntlet), ranks, result reveal, trophies, `GameSfx`, leaderboards, beta gate, run-submit validation, product page layout.

## Loading

Modules use dual export: `window.*` in the browser and `module.exports` for Node tests. Load only the scripts you need via `<script>` tags (or a page bootstrap).

```html
<link rel="stylesheet" href="core/css/tokens.css">
<script src="core/js/metronome-engine.js"></script>
<script src="core/js/timing-math.js"></script>
<!-- … -->
```

Chrome modules expose `mount(rootEl, options)` where applicable. Options may include:

- `theme: { accent, cyan, … }` — sets CSS variables on `rootEl`
- `layout: 'default' | 'compact'`
- `selectors` — bind to existing markup under `root` instead of injecting a template

## Shared DB (future apps)

Use the same Supabase project and Auth/`profiles` identity. New apps create **new tables with no FK to game `runs`**. Access via `Cloud.getClient()` from the auth facade.

## Public surface (files)

| Path | Role |
|------|------|
| `js/metronome-engine.js` | Web Audio metronome scheduler |
| `js/timing-math.js` | Clock sync, classify hits, ranks, endurance |
| `js/midi-input.js` | MIDI devices, note-on, debounce, pad learn |
| `js/audio-input.js` | Mic/interface → onset events |
| `js/onset-detector.js` | AudioWorklet processor (URL for `addModule`) |
| `js/input-controls.js` | `mount()` input chrome |
| `js/calibrator.js` | Two-pass calibration orchestration |
| `js/calibration-controls.js` | `mount()` calibration chrome |
| `js/calibration-store.js` | Per-device calibration persistence |
| `js/session-engine.js` | Ramp/set/rest logic |
| `js/session-controls.js` | `mount()` metronome + ramp controls |
| `js/game-subdivisions.js` | Subdivision registry |
| `js/faq-markdown.js` | Shared FAQ/patch-notes markdown schema |
| `js/patch-notes-storage.js` | Patch notes Storage list/fetch/semver/seen |
| `js/cloud/*` | Auth facade + backends |
| `css/tokens.css` | Design tokens |
| `css/*-controls.css` / `auth-bar.css` | Shared chrome styles |
| `brand/logo.png` | Shared mark |
