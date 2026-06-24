# Ops Daemon — Human-Only Setup (do these, Wei)

These steps require your hands / web UIs and **cannot** be done by the build agent
(Lovable's UI, Discord settings, secret values, the VPS). Do them in order. Each is the
exact text or action you need.

---

## 1. Lovable (Arcane Sanctum) — six tables, a secret, two endpoints

Paste this prompt into Lovable for the **Arcane Sanctum** project:

> Create the backend integration for an external "Ops Daemon" service. It must be
> owner-only (RLS), authenticated by a shared secret header.
>
> **1. Secret.** Add a Cloud → Secrets value named `DAEMON_API_KEY` (no `VITE_` prefix).
> Generate a long random value and keep it — I'll paste the same value into the daemon's
> `.env`.
>
> **2. Tables** (RLS owner-only on all six; `id` uuid primary key default, `created_at`
> timestamptz default now()):
>
> - `pain_points` (label text, category text, intensity_avg numeric, frequency int,
>   first_seen timestamptz, last_seen timestamptz, example_quotes jsonb, source_hashes
>   jsonb, status text). Add a **unique constraint on `label`** (the daemon upserts by
>   label).
> - `email_health` (captured_at timestamptz, summary text, flags jsonb, proposed_cull
>   jsonb, needs_attention boolean).
> - `money_alerts` (captured_at timestamptz, type text, detail text, value numeric,
>   severity text, needs_attention boolean).
> - `funnel_pulse` (captured_at timestamptz, source text, metrics jsonb, delta_note text,
>   needs_attention boolean).
> - `review_alerts` (captured_at timestamptz, source text, rating numeric, excerpt text,
>   needs_reply boolean).
> - `daily_brief` (brief_date date **unique**, items jsonb, summary text, posted_webhook
>   boolean).
>
> **3. `POST /daemon-ingest`** (an edge function / server route). It must:
> - reject unless header `x-daemon-key` equals the `DAEMON_API_KEY` secret;
> - accept body `{ "table": "<name>", "op": "upsert", "rows": [ {…} ] }`;
> - **whitelist** `table` to exactly these six names: `pain_points`, `email_health`,
>   `money_alerts`, `funnel_pulse`, `review_alerts`, `daily_brief` (reject anything else);
> - upsert the rows into the named table using the `SUPABASE_SERVICE_ROLE_KEY` (server-side
>   only — never exposed to the client). Upsert conflict targets: `pain_points` on `label`,
>   `daily_brief` on `brief_date`; the rest are plain inserts.
>
> **4. `GET /daemon-read`** (same `x-daemon-key` check). Return JSON:
> `{ "snapshot": { …reconciled business snapshot… },
>    "apprenticesDue": [ { "name", "lastLesson", "status" } ],
>    "staleQuests": [ { "title", "category", "lastTouched" } ] }`.
> The `snapshot` should reuse the Treasury's existing reconciled numbers (Shopify/PayPal,
> including PayPal dedup) — do not recompute. A useful shape for the daemon's Money Watch
> is: `{ refunds: { amount, trailingWeeklyAvgAmount }, payments: { failed, disputed },
> revenue: { weekToDateAmount, trailingWeeklyAvgAmount }, launch: { label, value } }`
> (all optional — the daemon tolerates missing fields). `launch` is a generic
> product-launch counter — populate it (e.g. `{ label: "Art of Double Bass 3.0",
> value: <sales> }`) whenever you want milestone alerts (50/100/250/500/1000/2500);
> leave it out and no milestone fires.

After Lovable builds it, note the two endpoint URLs — they go in the daemon `.env` as
`ARCANE_INGEST_URL` and `ARCANE_READ_URL`.

> The daemon enforces the same six-table whitelist client-side (`src/lib/cockpit.js`), but
> the endpoint MUST enforce it too — that check is the security boundary.

---

## 2. Discord — webhook for #clawdbot-notifications

In Discord: **#clawdbot-notifications → Edit Channel → Integrations → Webhooks → New
Webhook** → name it (e.g. "Dawn Auspex") → **Copy Webhook URL**. That URL is
`DISCORD_BRIEF_WEBHOOK_URL`. (~1 min. This is a passive POST target, not a bot token.)

---

## 3. Keys into `/opt/ops-daemon/.env`

`cp .env.example .env`, then fill:

| Var | Value |
|---|---|
| `ANTHROPIC_API_KEY` | A **standalone** Anthropic API key (console.anthropic.com → API keys). **Not** the Max subscription. |
| `ARCANE_INGEST_URL` / `ARCANE_READ_URL` | The two URLs from step 1. |
| `DAEMON_API_KEY` | The **same** value as the Lovable `DAEMON_API_KEY` secret. |
| `KIT_API_KEY` | Kit (ConvertKit) API key (read-only use). |
| `DAEMON_HASH_SALT` | A long random string. Rotating it re-buckets student hashes — set once and keep. |
| `DISCORD_BRIEF_WEBHOOK_URL` | The webhook URL from step 2. |

Shopify/PayPal keys are **not** needed — money is read via the reconciled snapshot.

Optional:
- `KIT_COLD_TAG` — the name of your Kit "cold/non-responder" tag. Set it to enable the
  cull **proposal** (the daemon still never deletes). Without it, the cull is skipped.

> **First Stroke is gone** — no longer in development, so there's nothing to configure for
> it. Funnel Watch wires only Dojo today; **Art of Double Bass 3.0** and the Game Metronome
> are future drop-in sources (add a source entry in `funnel-watch.js`). ADB 3.0 launch
> milestones can fire today with zero new credentials by populating `launch` in the
> `/daemon-read` snapshot (step 1).

---

## 4. Deploy on the VPS

```bash
# one-time: clone the daemon repo to /opt/ops-daemon (lifted out of ops-daemon/)
cd /opt/ops-daemon
npm install
# create .env per steps 1–3
node index.js --once            # smoke test: prints a cycle, writes run_log
pm2 start ecosystem.config.js
pm2 save
```

Updates later: `git pull && npm install && pm2 reload ops-daemon`.

---

## 5. Pulse Bot intake addition

The daemon reads `discord_intake` from `ops.db`; **Pulse** fills it. See
`pulse-integration/README.md` for the one isolated, flag-gated file to add to the Pulse
repo and where to call it. Until that's wired, the Pain-Point Miner simply finds an empty
intake (it never touches Discord itself).

---

## 6. Tune thresholds live

After the first few briefs, tune the thresholds (refund spike ratio, revenue dip/spike,
ninja-growth, low-click-rate, cull age, pain intensity) — they're plain options on the
`detect*/analyze*` functions in `src/domain/`. Tell the build agent your preferences and
it will surface them as env-configurable knobs.

---

## Not in scope (deferred)

**Game Metronome** is deliberately excluded — no reads, RPCs, or SQL against the Metronome
Supabase (`mmdmibimpipxckgfmhmz`). It's under review with Azurek (possible Go migration),
so anything built against it could be throwaway. Funnel Watch is built so Metronome is a
trivial future drop-in source behind the existing toggle.
