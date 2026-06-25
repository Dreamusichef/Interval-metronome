# The Ops Daemon

A standalone Node.js service that watches Wei Lung Wong's business — email, finances,
funnels, student pain — on a schedule and emits **one daily brief**, so his attention
goes to teaching rather than monitoring.

> **Where this lives.** The build spec calls for the daemon to run as its own git repo
> at `/opt/ops-daemon/` on the Hetzner VPS, separate from Pulse Bot. It is committed
> here as a self-contained `ops-daemon/` subdirectory so it travels with the project; to
> deploy, lift this directory out into its own repo (or `git subtree split`) and clone it
> to `/opt/ops-daemon/`. Nothing here imports from the rest of the Metronome repo.

It senses; it does **not** act. Every customer- or student-facing or otherwise
hard-to-reverse action (subscriber culls, anything outbound beyond Wei's own brief) is
**proposed and approval-gated** — never executed by the daemon.

---

## Architecture

```
SOURCES                          OPS DAEMON (/opt/ops-daemon, PM2, node-cron, Haiku)   COCKPIT (Arcane Sanctum / Lovable Cloud)
─────────────────────            ───────────────────────────────────────────────       ────────────────────────────────────────
Pulse Bot ─► ops.db (local) ───► Pain-Point Miner ─┐
Kit API ───────────────────────► Email Watch ──────┤
Arcane /daemon-read (snapshot) ► Money Watch ───────┤  each writes a row  ──POST──►  /daemon-ingest ─► tables:
Dojo public JSON ──────────────► Funnel Watch ──────┼─►                                pain_points, email_health,
(ADB 3.0 / Metronome: future) ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤                                   money_alerts, funnel_pulse,
Arcane /daemon-read (quests) ──► Stale-Quest ───────┤                                   review_alerts, daily_brief
                                 The Morning Brief ──┴──► Discord webhook ─► #clawdbot-notifications ─► Wei
```

- The daemon writes refined signal to the cockpit and **reads only two things it must
  not duplicate**: the reconciled money snapshot, and apprentices-due + stale quests.
- It holds its own operational state locally in `ops.db` (SQLite, WAL).
- It has **no Discord credentials** — Pulse owns Discord; the Brief reaches Wei via a
  passive Discord **webhook** POST (not a second bot).
- **Runtime AI auth:** the only LLM calls (the Pain-Point Miner) use a standalone
  `ANTHROPIC_API_KEY` via `@anthropic-ai/sdk` (Haiku 4.5, Batch API). The daemon never
  shells out to `claude` / the Agent SDK / any subscription-authenticated path — that is
  not valid for unattended server automation.

### Module isolation (hard requirement)

Each module is `try/catch`-wrapped, gated by its `MODULE_*_ENABLED` flag, and writes its
own `run_log` row. **One module failing never stops the others or the Brief** — the Brief
composes from whatever succeeded this cycle. Each module has its own toggle, its own log,
and (mostly) its own cockpit table.

---

## Modules

| Module | Cadence | Haiku? | Cockpit table | Notes |
|---|---|---|---|---|
| **Email Watch** — *The Sendings* | daily | no | `email_health` | one row/run; proposes a non-responder cull, **never deletes** |
| **Money Watch** — *Coffer Wards* | daily | no | `money_alerts` | reads reconciled snapshot; quiet when normal |
| **Funnel Watch** — *Gates & Tides* | weekly | no | `funnel_pulse` | Dojo; ADB 3.0 + Metronome are future drop-in sources |
| **Pain-Point Miner** — *Forge Echoes* | daily | **yes (Batch)** | `pain_points` | classify → dedup; handles hashed; verbatim quotes |
| **Review Watch** — *The Testaments* | — | no | `review_alerts` | **scaffold, shipped disabled** |
| **Stale-Quest Resurfacing** | daily | no | — | surfaces cold quests in the Brief only |
| **The Morning Brief** — *The Dawn Auspex* | daily (last) | no | `daily_brief` | composes 3–5 items; posts the webhook once/day |

### Funnel cadence note (design decision)

The spec asks for Funnel on a weekly cadence. So the Brief can include fresh funnel
movement on the day it runs (the Brief composes from in-memory signals, and
`/daemon-read` does not return `funnel_pulse`), Funnel **self-gates to weekly inside the
daily cycle** via a watermark (`funnel:lastrun`) rather than using a second cron that
would race the once-per-day Brief. Net effect is identical — one `funnel_pulse` row per
source per week — with no Brief duplication.

---

## Data stores

### Local — `ops.db` (SQLite, WAL)

VPS-local, gitignored (same trust level as Pulse's `dojo-data.json`). Back up by copying
one file. Tables: `discord_intake`, `watermarks`, `run_log` (see `src/lib/db.js`).

- `discord_intake` — Pulse INSERTs raw messages (raw `author` is fine here — VPS-local).
  The Pain-Point Miner reads `processed=0`, hashes the author when promoting to the
  cockpit, marks rows processed, prunes old rows.
- `watermarks` — one cursor per module (idempotency). The Pain-Point Miner's canonical
  mirror is stored here as JSON (it cannot read `pain_points` back from `/daemon-read`,
  so it maintains accumulation locally and upserts the full computed rows).
- `run_log` — per-run record for debugging; pruned to 30 days.

### Cockpit — Arcane Sanctum tables

Six tables, RLS owner-only, created by the owner via Lovable (see **Setup**). Ingest
payload shapes are documented in `src/lib/cockpit.js` and the modules.

---

## Privacy / guardrails

- **Sense, don't act.** The daemon reports; it never acts on anything customer- or
  student-facing. The cull is proposed (`proposed_cull`, `executed: false`), never run.
- **PII-free cockpit.** A Discord handle never leaves the VPS — only its salted hash
  (`DAEMON_HASH_SALT`) reaches the cockpit, in `pain_points.source_hashes` (distinct
  contributors). Verbatim student quotes are stored **exactly** (the raw message text),
  never paraphrased.
- **No Metronome.** No reads, RPCs, or SQL against the Metronome Supabase. Funnel is built
  so Metronome is a future drop-in source behind the existing toggle — not wired here.
- **Idempotency.** Every module advances a watermark and dedupes on re-run. The Brief
  stores `brief_date` (unique) + a local `brief:posted` watermark so it never double-posts.

---

## Install & run

```bash
cd /opt/ops-daemon
npm install
cp .env.example .env      # then fill in real values (see HUMAN-SETUP.md)
npm test                  # pure-logic unit tests (no native deps needed)
node index.js --once      # run one cycle now and exit (verification / manual trigger)
pm2 start ecosystem.config.js   # first deploy
pm2 reload ops-daemon           # subsequent updates (after git pull)
```

Deploy mirrors Pulse: commit → `git pull` on the VPS → `pm2 reload`. The daemon is its
**own PM2 app**; a slow/hung module can never lag Pulse's live clip tracking.

### Scheduling

`node-cron` fires one daily cycle at `DAILY_CRON` (default `10 23 * * *` in
`DAEMON_TZ=Asia/Singapore`) — just after Pulse's nightly intake (~22:55 SGT; the Dojo day
boundary is 23:00 SGT / 15:00 UTC), so the day's messages are present in `ops.db`.

---

## Tests

`npm test` runs `node --test` over everything (unit + integration). Split runners:
`npm run test:unit` (pure logic) and `npm run test:int` (end-to-end against the stub).

- **Unit** (`tests/*.test.cjs`) — the timing/scoring-style logic (brief composition,
  money/funnel/email analysis, pain taxonomy + dedup, hashing) is kept **pure and
  rendering-agnostic** in `src/domain/` and `src/lib/hash.js`, so it runs with **no native
  dependencies**.
- **Integration** (`tests/integration/*.test.cjs`) — runs real cycles against an
  in-process cockpit stub (`tools/stub-cockpit.js`, a faithful mirror of the
  `/daemon-ingest` + `/daemon-read` contract): per-module round-trips, the full nightly
  cycle (brief composed + posted once, idempotent rerun, weekly funnel gate), the
  Pain-Point Miner (injected Haiku — classify/dedup, PII-free promotion, crash-replay
  determinism), and the Pulse → `ops.db` handoff.

## Local verification (no credentials)

The build spec's verification gates say to exercise the daemon against a **local stub**
before the real Lovable endpoints exist, then re-verify against the live ones. Two ways:

```bash
npm run demo     # start the stub in-process, run ONE real cycle against a seeded
                 # anomaly snapshot, and print every row ingested + the webhook brief.
                 # (Email + Pain-Point Miner are off — they need the Kit / Anthropic APIs.)

npm run stub     # run the stub standalone; it prints ARCANE_INGEST_URL / ARCANE_READ_URL /
                 # DISCORD_BRIEF_WEBHOOK_URL / DAEMON_API_KEY. Point a local .env at those
                 # and `node index.js --once` to drive the daemon against it.
```

When the real endpoints are up, set the env to the live URLs and run `node index.js --once`
— same flow, real cockpit. `sql/cockpit-schema.sql` is the reference DDL for the six tables.

---

## File map

```
index.js                      entry: node-cron scheduler + --once (delegates to src/cycle.js)
ecosystem.config.js           PM2 app definition
.env.example                  env template (copy to gitignored .env on the VPS)
src/cycle.js                  daily-cycle orchestrator (no side effects on require — testable)
src/config.js                 env loader (no dotenv dep) + toggles + per-module validation
src/lib/
  db.js                       ops.db accessor (better-sqlite3, WAL) + schema
  haiku.js                    Anthropic Batch client (Haiku 4.5), cached taxonomy prefix
  cockpit.js                  /daemon-ingest (POST) + /daemon-read (GET), x-daemon-key
  http.js                     native fetch with exponential-backoff retry
  hash.js                     salted handle hashing (HMAC-SHA256)
  watermark.js                per-module cursors
  runlog.js                   per-run record + prune
  runner.js                   module isolation wrapper (flag gate, try/catch, run_log)
  logger.js                   one-JSON-line structured logger
src/domain/                   PURE, unit-tested logic (no I/O):
  brief-compose.js            exception-based 3–5 item selection
  money-analysis.js           anomaly + milestone detection
  funnel-analysis.js          Dojo pulse
  email-analysis.js           flags + proposed cull
  pain/taxonomy.js            taxonomy, Haiku prompts, result parsers
  pain/dedup.js               canonical accumulation (frequency, quotes, source hashes)
src/modules/                  orchestration (source → domain → cockpit → signals):
  email-watch.js  money-watch.js  funnel-watch.js
  painpoint-miner.js  review-watch.js  stale-quest.js  brief.js
pulse-integration/            ONE isolated addition for the Pulse Bot repo (§9):
  ops-intake.js  README.md
tools/                        local verification (no credentials):
  stub-cockpit.js             in-process mirror of the cockpit contract + Dojo feed
  run-local.js                `npm run demo` — one real cycle against the stub
sql/cockpit-schema.sql        reference DDL for the six cockpit tables
tests/                        node:test unit tests (.test.cjs)
tests/integration/            end-to-end tests against the stub (_harness.cjs)
HUMAN-SETUP.md                the human-only setup steps (Lovable, Discord, keys, deploy)
```

See **HUMAN-SETUP.md** for the steps only Wei can do (Lovable endpoints, Discord webhook,
keys, deploy).
