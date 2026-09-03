# Game Metronome — Project Brief & Handoff

> Drop-in context for any Claude (Claude Code local/web, claude.ai chat, Cowork).
> This file lives in the repo so the project context travels to every device.

## What this is
A web-based **drum-practice game** built on top of a precision metronome, by Art of
Drumming HQ (AODHQ). Players drum along (kick or snare) via **MIDI e-drums** or
**audio-input** (mic/interface); the app grades timing accuracy and awards ranks
(E→SS), trophies, leaderboards. Currently **v0.9.0 — open Beta**.

- **Live:** https://metronome.artofdrumminghq.com  (also dreamusichef.github.io/Interval-metronome)
- **Repo:** https://github.com/Dreamusichef/Interval-metronome  (deploy branch: `main`)
- **Sandbox:** `/sandbox/preview-reveal.html` — plays the result-reveal sequence + sounds at real timings.

## How it runs & deploys
- **Vanilla JS, no build step, no framework.** Static files served by GitHub Pages.
- **Deploy = merge to `main`.** GitHub Pages auto-publishes ~1 min after `main` changes.
- **CI:** `.github/workflows/test.yml` runs `npm test` (`node --test`) on every PR and on
  pushes to `dev`. VS Code Testing tab: install `connor4312.nodejs-testing` (see
  `.vscode/extensions.json`).
- **`main` is branch-protected** (since 2026-06): direct pushes are blocked, so every change
  goes on a feature branch → **Pull Request → 1 approval from the owner (@Dreamusichef) → merge**.
  CODEOWNERS (`.github/CODEOWNERS`) auto-requests the owner as reviewer. Repo *admins* are exempt
  from the rule, but **automated Claude sessions push via a non-admin token and CANNOT push to
  `main`** — always work on a feature branch and open a PR for the owner to review/merge.
- **Cache-busting:** every script/style is referenced with `?v=...` in index.html/stats.html.
  **Bump the `?v=` when you change a file** or browsers serve stale copies. (JS use
  date-ish tokens like `?v=20260605b`; sfx.js/achievements.js use small integers.)
- **Local preview:** `npx http-server -p 8127 -c-1` (see `.claude/launch.json`), or the
  Claude Code preview tool (server name `metronome`). NOTE: the preview screenshot tool
  tends to hang on index.html (animated canvas) — use `preview_eval` to read state instead.
  **On localhost / 127.0.0.1 the app uses a localStorage mock DB** (`core/js/cloud/mock-backend.js`) instead
  of production Supabase — dev sign-in picker (Alex / Wei / Sam), isolated leaderboards.
  Seed data applies on first load per `STORAGE_KEY` in mock-backend.js; bump that key when
  seed users/runs change (or run `Cloud.resetMockData()` in the console).
  Deployed hosts still use real Supabase + Google OAuth.
- **Validate JS before committing:** `node --check <file>.js`.

## Conventions (follow these)
- **Commit messages end with:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **All changes ship via PR.** `main` is branch-protected (see "How it runs & deploys"): commit
  to a feature branch, push, and open a Pull Request for the owner to review and merge. Do NOT
  attempt to push directly to `main` — it will 403.
- **Database/DDL: Claude does NOT run SQL.** Write the SQL and **paste it in chat** for the
  human to run in the Supabase SQL editor (owner creds required). Pasting in chat is the
  user's stated preference (not a separate .sql file unless asked).
- **Secrets:** the Supabase **anon public key IS committed** in `core/js/cloud/supabase-backend.js` (safe — RLS
  protects data). The **service_role** key must NEVER be committed/shared. Any third-party
  API keys (e.g. Kit) must live server-side (Supabase Edge Function secret), never in client JS.
- `.claude/settings.local.json` is gitignored. Source-art originals (`Rank *.png`,
  `Trophy *.png`, `Game sounds/`) and `_*.py` helpers are gitignored; only processed
  outputs (`assets/img/rank/*.png`, `assets/img/trophy/*.png`, `sounds/*.mp3`) are committed.

## File map
- `index.html` — main app (metronome + Game Mode UI, settings panel, beta gate, result overlay).
- `stats.html` — Stats & Leaderboard page (Personal / Global / Trophies).
- `core/` — **vendored `@dreamusichef/core`** (see `core/README.md`). Engines, MIDI/audio/cal, timing math,
  session chrome, Cloud auth/`getClient()`, FAQ/patch-notes format helpers, tokens, brand logo.
  Dual `window.*` + `module.exports` for browser + Node tests. Upgrade: `npm run upgrade-core -- X.Y.Z`.
- `core/js/metronome-engine.js` — **MetronomeEngine** (Web Audio scheduler, sounds, cues). Top-level `const`
  (a global lexical binding) — reference it **bare** as `MetronomeEngine`, NOT `window.MetronomeEngine`.
- `core/js/session-engine.js` / `session-controls.js` — ramp/set/rest engine + `mount()` chrome; app
  exposes `window.AppRamp = SessionEngine.publicApi`.
- `core/js/timing-math.js` — pure timing/scoring math (`TimingMath` / `RL_TimingMath`).
- `core/js/midi-input.js`, `audio-input.js`, `onset-detector.js`, `calibrator.js` — input + two-pass cal.
- `core/js/cloud/` — auth facade (`auth.js`), mode, profile-validation, supabase/mock backends.
- `assets/css/style.css` — game app stylesheet (tokens come from `core/css/tokens.css`).
- `assets/js/app.js` — app shell: mounts session controls, stopwatch, keyboard shortcuts.
- `assets/js/main.js` — bootstrap: remounts input/cal chrome helpers after core scripts load.
- `assets/js/roguelite.js` — **Game Mode** shell: run gating/scoring, ranks, result reveal, beta gate,
  latency compensation; consumes core MidiInput/Calibrator/TimingMath. (Biggest game file.)
- `assets/js/achievements.js` — trophy definitions + evaluation (shared by game + stats pages).
- `assets/js/sfx.js` — result-screen reward sounds (`window.GameSfx`), per-key volume, mp3 manifest.
- `assets/js/cloud-game.js` — game Cloud APIs (`submitRun`, `leaderboard`, beta) mixed onto `window.Cloud`.
- `assets/js/stats.js` — stats page logic.
- `assets/js/sounds.js` — base64 metronome/cue samples (large; lazy-loaded).
- `assets/js/settings.js` — top-right gear panel (wake lock, latency-comp toggle, shortcuts list).
- `assets/img/` — rank emblems (`rank/*.png`), trophy art (`trophy/*.png`). Logo: `core/brand/logo.png`.
- `sounds/` — mp3 reward clips.
- `sql/supabase-schema.sql` — canonical DB schema (tables, RLS, get_leaderboard RPC).
- `sandbox/` — dev sandboxes (`preview-reveal.html`, `vs-sandbox.html`).
- `tests/roguelite.test.cjs` — timing-math unit tests (`node:test`) against `core/js/timing-math.js`.
- `tests/achievements.test.cjs` — trophy metric / tier / retroactive-diff unit tests (`node:test`).

## Core package consumption
- Source of truth: `AODB-Core` → GitHub Package `@dreamusichef/core`.
- This repo pins the version in `package.json`, vendors into committed `core/` (`npm run sync-core`).
- One-shot upgrade: `npm run upgrade-core -- X.Y.Z` (install + sync + cache-bust + `npm test`).
- Do not hand-edit `core/` to mirror unpublished Core changes — release Core, then upgrade the pin.
- Keep timing/scoring math (`TimingMath`) pure & rendering-agnostic so it ports to a future engine.
- Additional practice apps: consume the same package (own tables, same Supabase Auth).

## Backend (Supabase) — project ref `mmdmibimpipxckgfmhmz`
- Tables: `profiles`, `runs`, `beta_members`, `beta_allowlist`, `beta_waitlist`. RLS on all.
- RPCs (SECURITY DEFINER): `get_leaderboard(mode,bpm,level,instrument)`, `claim_beta_spot()`.
- **Google OAuth** consent screen is **In Production** (non-sensitive scopes only → no cap,
  persistent logins). Auth = Google sign-in; sessions persist (Supabase localStorage).

## Current feature state (built & live)
- Game Mode: Time Trial, Sudden Death, Gauntlet (6 levels). Kick/Snare. 50–250 BPM (step 5).
- MIDI + audio-input detection; per-set 2-bar count-in; calibration (+ manual offset).
- **Scoring:** Time Trial = accuracy (green%); **Sudden Death/Gauntlet = ENDURANCE**
  (beats survived ÷ beats in full run; clear = SS) — accuracy is meaningless there.
- **Trophies:** 16, 10-rung ladder (Iron→Grandmaster); shown on Stats + as result popups.
- **Result reveal:** results → rank emblem bursts in @950ms → trophies pop @2250ms; sounds
  via GameSfx (completion stinger by mode/band, rank flourish, trophy pop), all −4 dB base.
- **Rank emblems** E→SS (`assets/img/rank/*.png`), **trophy art** (`assets/img/trophy/*.png`).
- **Beta gate** (Game Mode only): sign-in + `claim_beta_spot()` (250 cap, students allowlisted,
  waitlist when full). Flag `BETA_GATE` in roguelite.js. Plain metronome stays free.
- **Settings:** screen wake-lock, **auto latency correction** (opt-in, eases ±50ms, off by
  default), keyboard-shortcuts table.
- Perf: result reveal optimized (no animated filters); audio is mp3.

## Known gotchas
- **Cloud auth timing:** `index.html` / `stats.html` load cloud scripts **async** (mock or
  Supabase CDN → backend → `core/js/cloud/auth.js` → `cloud-game.js`), while `stats.js` /
  `roguelite.js` run on `defer` and may subscribe **after** `getSession()` resolves. UI must
  use `Cloud.onAuth(fn)`, never a one-shot `currentUser()` on load. Backends must set
  `ready = true` **before** the first `onAuthChange` call (`supabase-backend.js` getSession,
  `mock-backend.js` init); `auth.js` `onAuth` also re-checks `backend.isReady()` for late
  registrants. Breaking this leaves Stats stuck on the signed-out screen even when a Google
  session exists.
- **iOS/iPadOS: no Web MIDI** in any browser → MIDI mode can't work there; use audio-input.
  Web MIDI works on desktop (Chrome/Edge/Firefox) + Android Chrome.
- **Laptop audio latency drifts** (power state) → 20–30ms calibration swings; the latency-comp
  setting and/or a USB interface/eDRUMin fixes it. Dedicated interface = stable.
- Preview **screenshot** tool hangs on index.html; prefer `preview_eval`.

## Pending / next up
- **Run pending SQL** (human, in Supabase): the `get_leaderboard` update that adds the
  `cleared` column (fixes Global Gauntlet "Cleared" showing "—"). See chat history / schema.
- Seed student emails into `beta_allowlist`.
- **Waitlist → Kit (ConvertKit):** route `beta_waitlist` signups into Kit via a Supabase Edge
  Function (Kit API key as a Supabase secret — never client-side). Cuts out Tally.
- **Multi-pad game modes** (2 pads for hand rudiments, 2 kicks, eventually full kit) — natural
  next gameplay step; higher value than graphics. Keep timing/scoring math (`TimingMath`)
  pure & rendering-agnostic so it ports to a future engine.
- **Hardware bundle** (sell-with): eDRUMin 4 (~$149, USB-MIDI, 4 inputs) + single mesh pad,
  or eDRUMin + acoustic trigger (Yamaha DT50K/Roland RT-30K, single-zone). Research in chat history.
- Future: native/engine version (Unity/Godot) for the gamified vision; web stays the lite/funnel.

## Working from anywhere
The repo is the source of truth. To continue on another machine: clone it — this file
auto-loads in Claude Code. From mobile/browser: use **Claude Code on the web** (connect this
GitHub repo) for real commits, or **claude.ai chat** for planning/research/SQL (then commit via
the GitHub web editor). See the chat handoff for the full recommendation.
