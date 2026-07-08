-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION: private ramp favourite presets (cross-device sync when signed in).
-- Paste this whole block into Supabase → SQL Editor → Run (idempotent).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.ramp_presets (
  user_id    uuid primary key references auth.users on delete cascade,
  presets    jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.ramp_presets enable row level security;

drop policy if exists "users read own ramp presets" on public.ramp_presets;
create policy "users read own ramp presets"
  on public.ramp_presets for select using (auth.uid() = user_id);

drop policy if exists "users insert own ramp presets" on public.ramp_presets;
create policy "users insert own ramp presets"
  on public.ramp_presets for insert with check (auth.uid() = user_id);

drop policy if exists "users update own ramp presets" on public.ramp_presets;
create policy "users update own ramp presets"
  on public.ramp_presets for update using (auth.uid() = user_id);

drop policy if exists "users delete own ramp presets" on public.ramp_presets;
create policy "users delete own ramp presets"
  on public.ramp_presets for delete using (auth.uid() = user_id);
