-- Ops Daemon — cockpit (Arcane Sanctum / Lovable Cloud) reference schema.
--
-- The six tables the daemon writes to. These are normally created by prompting Lovable
-- (see HUMAN-SETUP.md §1); this file is the canonical reference DDL so the owner can
-- sanity-check what Lovable builds. RLS is owner-only on all six. The /daemon-ingest and
-- /daemon-read endpoints are Lovable edge functions (NOT SQL) — they enforce the
-- x-daemon-key check, the six-table whitelist, and the upsert conflict targets noted below.
--
-- Conventions: id uuid default gen_random_uuid(); created_at timestamptz default now().

-- "Forge Echoes" — rising student pains (upsert by label).
create table if not exists pain_points (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,
  category       text,
  intensity_avg  numeric,
  frequency      int,
  first_seen     timestamptz,
  last_seen      timestamptz,
  example_quotes jsonb,            -- verbatim student quotes (cap ~10)
  source_hashes  jsonb,            -- salted author hashes only (PII-free), distinct contributors
  status         text,
  created_at     timestamptz default now()
);
-- /daemon-ingest upserts pain_points on this unique key:
create unique index if not exists pain_points_label_key on pain_points (label);

-- "The Sendings" — Kit/email health (one row per run).
create table if not exists email_health (
  id              uuid primary key default gen_random_uuid(),
  captured_at     timestamptz,
  summary         text,
  flags           jsonb,
  proposed_cull   jsonb,           -- PROPOSAL only; the daemon never deletes subscribers
  needs_attention boolean,
  created_at      timestamptz default now()
);

-- "Coffer Wards" — money anomalies / milestones (only on genuine signal).
create table if not exists money_alerts (
  id              uuid primary key default gen_random_uuid(),
  captured_at     timestamptz,
  type            text,
  detail          text,
  value           numeric,
  severity        text,
  needs_attention boolean,
  created_at      timestamptz default now()
);

-- "Gates & Tides" — funnel pulse (one row per source per weekly run).
create table if not exists funnel_pulse (
  id              uuid primary key default gen_random_uuid(),
  captured_at     timestamptz,
  source          text,            -- 'dojo' today; 'adb3' / 'metronome' are future drop-ins
  metrics         jsonb,
  delta_note      text,
  needs_attention boolean,
  created_at      timestamptz default now()
);

-- "The Testaments" — review alerts (PARKED; module shipped disabled).
create table if not exists review_alerts (
  id          uuid primary key default gen_random_uuid(),
  captured_at timestamptz,
  source      text,
  rating      numeric,
  excerpt     text,
  needs_reply boolean,
  created_at  timestamptz default now()
);

-- "The Dawn Auspex" — the daily brief (upsert by brief_date; one per day).
create table if not exists daily_brief (
  id             uuid primary key default gen_random_uuid(),
  brief_date     date not null,
  items          jsonb,
  summary        text,
  posted_webhook boolean,
  created_at     timestamptz default now()
);
-- /daemon-ingest upserts daily_brief on this unique key (never two rows for one day):
create unique index if not exists daily_brief_brief_date_key on daily_brief (brief_date);

-- RLS owner-only on all six (illustrative — adapt the owner predicate to your auth).
alter table pain_points    enable row level security;
alter table email_health   enable row level security;
alter table money_alerts   enable row level security;
alter table funnel_pulse   enable row level security;
alter table review_alerts  enable row level security;
alter table daily_brief    enable row level security;

-- The daemon writes via the service_role key inside the /daemon-ingest edge function
-- (RLS-bypassing, server-side only). Owner-facing reads in the app are gated by RLS, e.g.:
--   create policy owner_read on pain_points for select using (auth.uid() = '<owner-uuid>');
-- Repeat per table for the owner's UID. The service_role key must NEVER reach client JS.
