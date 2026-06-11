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
  browsers may serve a stale cached copy.
- **Validate JS before committing:** `node --check yourfile.js` to catch syntax errors.
- **Deploy = push to `main`.** GitHub Pages auto-publishes in ~1 minute. There is no CI.
- **Secrets:** the Supabase **anon public key** is committed in `cloud.js` and is safe
  (Row Level Security protects the data). Never commit a `service_role` key or any other
  API secrets — those belong server-side only.

## How it works

- `index.html` — main app (metronome + Game Mode UI).
- `metronome.js` — Web Audio scheduler (precise tempo/click engine).
- `app.js` — ramp/session engine, metronome controls, keyboard shortcuts.
- `roguelite.js` — Game Mode core (calibration, scoring, ranks, result reveal).
- `cloud.js` — Supabase auth, run saving, leaderboard.
- `stats.js` / `stats.html` — Stats & Leaderboard page.

See `CLAUDE.md` for the full project brief, file map, and backend details.
