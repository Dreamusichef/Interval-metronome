# Interval-metronome

Game metronome for drummers to practice with bpm and interval times.

**Live:** https://metronome.artofdrumminghq.com

## Running locally

No build step — this is vanilla HTML/JS/CSS served as static files.

1. **Clone the repo:**
   ```bash
   git clone https://github.com/Dreamusichef/Interval-metronome.git
   cd Interval-metronome
   ```

2. **Serve it** with any static file server. Don't open the HTML files directly
   (`file://`) — some features need to be served over `http://`. Easiest option
   (requires [Node.js](https://nodejs.org/)):
   ```bash
   npx http-server -p 8127 -c-1
   ```
   `-c-1` disables caching so you always see your latest edits.

3. **Open** http://localhost:8127 in your browser.

Edit any `.js` / `.html` / `.css` file, refresh the browser, and your change is live.

## Project conventions

- **Cache-busting:** every script/style tag in `index.html` / `stats.html` is
  referenced with a `?v=...` token. Bump that version when you change a file, or
  browsers may serve a stale cached copy. Core package upgrades stamp `core/`
  refs via `npm run cache-bust-core`.
- **Core package:** practice kit is `@dreamusichef/core` (GitHub Packages),
  vendored into committed `core/`. Upgrade with `npm run upgrade-core -- X.Y.Z`
  (requires Packages auth). See `core/README.md`.
- **Validate JS before committing:** `node --check yourfile.js` to catch syntax errors.
- **Unit tests:** `npm test` runs Node's built-in test runner (`node:test`) over
  `tests/*.test.cjs` (timing math + trophy evaluation). CI runs this on every PR
  and on pushes to `dev`. For the VS Code Testing tab, install the
  [node:test runner](https://marketplace.visualstudio.com/items?itemName=connor4312.nodejs-testing)
  extension (recommended via `.vscode/extensions.json`).
- **Deploy = push to `main`.** GitHub Pages auto-publishes in ~1 minute.
- **Secrets:** the Supabase **anon public key** is committed in
  `core/js/cloud/supabase-backend.js` and is safe (Row Level Security protects the
  data). Never commit a `service_role` key or any other API secrets — those belong
  server-side only.

## Project layout

```
index.html, stats.html     — entry pages (root, for GitHub Pages)
core/                      — vendored @dreamusichef/core (engines, input, cal, auth, tokens)
  README.md                — public surface + upgrade instructions
  js/                      — metronome, timing math, MIDI/audio, session, cloud auth…
  css/                     — tokens + shared chrome styles
  brand/                   — shared logo
scripts/sync-core.mjs      — copy package → core/
scripts/cache-bust-core.mjs — bump ?v= on core/ refs
scripts/upgrade-core.mjs   — install pin + sync + cache-bust + test
assets/css/                — app (game) stylesheets
assets/js/                 — game-only scripts (roguelite, achievements, cloud-game…)
assets/img/                — rank/ and trophy/ emblem art
sounds/                    — mp3 reward clips
sql/                       — Supabase schema & migrations
sandbox/                   — dev sandboxes (preview-reveal, vs-sandbox)
tests/                     — unit tests (timing math + achievements + validation)
```

## How it works

- `index.html` — main app (metronome + Game Mode UI).
- `core/js/metronome-engine.js` — Web Audio scheduler (precise tempo/click engine).
- `core/js/session-engine.js` + `session-controls.js` — ramp/session + shared chrome.
- `assets/js/app.js` — app shell (mounts session, stopwatch, shortcuts).
- `assets/js/roguelite.js` — Game Mode shell (run loop, ranks, result reveal, beta).
- `core/js/cloud/auth.js` — auth/profile/`getClient()`; `assets/js/cloud-game.js` — runs/leaderboard/beta.
- `assets/js/stats.js` / `stats.html` — Stats & Leaderboard page.

See `core/README.md` for the shared-kit surface and upgrade flow. See `CLAUDE.md` for the full
project brief. Additional practice apps should consume `@dreamusichef/core` the same way
(own tables, same Supabase Auth).
