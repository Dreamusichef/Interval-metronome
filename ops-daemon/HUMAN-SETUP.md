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
> revenue: { weekToDateAmount, trailingWeeklyAvgAmount }, firstStroke: { preorders } }`
> (all optional — the daemon tolerates missing fields).

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
| `FIRSTSTROKE_SUPABASE_URL` / `FIRSTSTROKE_ANON_KEY` | First Stroke project (see step 4). |

Shopify/PayPal keys are **not** needed — money is read via the reconciled snapshot.

Optional:
- `KIT_COLD_TAG` — the name of your Kit "cold/non-responder" tag. Set it to enable the
  cull **proposal** (the daemon still never deletes). Without it, the cull is skipped.
- `FIRSTSTROKE_PREORDER_PATH` / `FIRSTSTROKE_PREORDER_KEY` — see step 4.

---

## 4. Confirm the First Stroke preorder-counter read method

The daemon needs to read the First Stroke preorder count, but the read method is **not
assumed** — tell it where the number is:

- Set `FIRSTSTROKE_PREORDER_PATH` to a path under `FIRSTSTROKE_SUPABASE_URL` that returns
  JSON when fetched with the anon key (e.g. a PostgREST view/RPC like
  `/rest/v1/preorder_count?select=count` or `/rest/v1/rpc/preorder_total`).
- Set `FIRSTSTROKE_PREORDER_KEY` to the dotted path to the number in that JSON
  (e.g. `0.count` or `preorders`; default `preorders`).

If you'd rather, tell the build agent the exact First Stroke table/column and it will wire
`fetchFirstStroke()` directly. Until configured, Funnel Watch **skips** First Stroke (it
won't guess a schema) and still reports Dojo.

---

## 5. Deploy on the VPS

```bash
# one-time: clone the daemon repo to /opt/ops-daemon (lifted out of ops-daemon/)
cd /opt/ops-daemon
npm install
# create .env per steps 1–4
node index.js --once            # smoke test: prints a cycle, writes run_log
pm2 start ecosystem.config.js
pm2 save
```

Updates later: `git pull && npm install && pm2 reload ops-daemon`.

---

## 6. Pulse Bot intake addition

The daemon reads `discord_intake` from `ops.db`; **Pulse** fills it. See
`pulse-integration/README.md` for the one isolated, flag-gated file to add to the Pulse
repo and where to call it. Until that's wired, the Pain-Point Miner simply finds an empty
intake (it never touches Discord itself).

---

## 7. Tune thresholds live

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
