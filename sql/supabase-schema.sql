-- ============================================================================
-- Interval Metronome — Game progress + leaderboard schema
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to re-run (idempotent: drops/replaces policies + functions).
-- ============================================================================

-- ── profiles: public display name + avatar (from Google) ────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by everyone" on public.profiles;
create policy "profiles are readable by everyone"
  on public.profiles for select using (true);

drop policy if exists "users manage own profile (insert)" on public.profiles;
create policy "users manage own profile (insert)"
  on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "users manage own profile (update)" on public.profiles;
create policy "users manage own profile (update)"
  on public.profiles for update using (auth.uid() = id);

-- ── runs: one row per completed game run (everything derives from this) ──────
create table if not exists public.runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  created_at   timestamptz not null default now(),
  mode         text not null check (mode in ('timetrial','suddendeath','gauntlet')),
  instrument   text not null default 'kick' check (instrument in ('kick','snare')),
  bpm          int,            -- free modes (60–240); null for gauntlet
  level        int,            -- gauntlet (1–6); null for free modes
  rank         text not null,  -- 'E','D','C','B','A','S','SS'
  green_pct    int  not null,  -- 0–100
  duration_sec int,            -- chosen target / played length (free modes)
  survival_sec int,            -- sudden death: time survived (capped at target)
  cleared      boolean not null default false,
  run_id       uuid,           -- client UUID at run start (dedup key)
  started_at   timestamptz,    -- wall-clock when gated play began
  played_sec   int,            -- actual gated elapsed seconds
  valid        boolean not null default true,
  reject_reason text
);

alter table public.runs enable row level security;

-- Inserts go through submit_run() only (see below); users may read their own rows.
drop policy if exists "users insert own runs" on public.runs;

drop policy if exists "users read own runs" on public.runs;
create policy "users read own runs"
  on public.runs for select using (auth.uid() = user_id);

create index if not exists runs_user_mode_idx on public.runs (user_id, mode, bpm, level);
create index if not exists runs_mode_bpm_idx  on public.runs (mode, bpm);
create index if not exists runs_mode_level_idx on public.runs (mode, level);
create unique index if not exists runs_user_run_id_idx
  on public.runs (user_id, run_id) where run_id is not null;
create index if not exists runs_user_created_idx on public.runs (user_id, created_at desc);

-- ── submit_run: validated insert (dedup + temporal checks) ───────────────────
drop function if exists public.submit_run(
  uuid, timestamptz, int, text, text, int, int, text, int, int, int, boolean
);
create function public.submit_run(
  p_run_id         uuid,
  p_started_at     timestamptz,
  p_played_sec     int,
  p_mode           text,
  p_instrument     text,
  p_bpm            int,
  p_level          int,
  p_rank           text,
  p_green_pct      int,
  p_duration_sec   int,
  p_survival_sec   int,
  p_cleared        boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grace_sec    int := 25;
  v_uid          uuid := auth.uid();
  v_now          timestamptz := now();
  v_valid        boolean := true;
  v_reason       text := null;
  v_prev         record;
  v_elapsed_sec  numeric;
  v_max_played   int;
begin
  if v_uid is null then
    return jsonb_build_object('valid', false, 'reject_reason', 'unauthenticated');
  end if;
  if p_run_id is null then
    return jsonb_build_object('valid', false, 'reject_reason', 'missing_run_id');
  end if;
  if exists (select 1 from public.runs where user_id = v_uid and run_id = p_run_id) then
    return jsonb_build_object('valid', false, 'reject_reason', 'duplicate_run');
  end if;
  if p_started_at is null
     or p_started_at > v_now + interval '30 seconds'
     or p_started_at < v_now - interval '24 hours' then
    v_valid := false;
    v_reason := 'invalid_started_at';
  end if;
  if v_valid then
    if p_played_sec is null or p_played_sec < 1 then
      v_valid := false;
      v_reason := 'invalid_played_sec';
    else
      if p_mode = 'gauntlet' then
        v_max_played := 5 * 60 + 4 * 10 + v_grace_sec;
      elsif p_duration_sec is not null then
        v_max_played := p_duration_sec + v_grace_sec;
      else
        v_max_played := 3600 + v_grace_sec;
      end if;
      if p_played_sec > v_max_played then
        v_valid := false;
        v_reason := 'invalid_played_sec';
      end if;
    end if;
  end if;
  if v_valid then
    select * into v_prev from public.runs where user_id = v_uid order by created_at desc limit 1;
    if v_prev.id is not null then
      v_elapsed_sec := extract(epoch from (v_now - v_prev.created_at));
      if v_elapsed_sec < (p_played_sec - v_grace_sec) then
        v_valid := false;
        v_reason := 'impossible_timing';
      elsif v_prev.started_at is not null and v_prev.played_sec is not null then
        if p_started_at < v_prev.started_at
           + ((greatest(v_prev.played_sec - v_grace_sec, 0)) * interval '1 second') then
          v_valid := false;
          v_reason := 'overlapping_run';
        end if;
      end if;
    end if;
  end if;
  insert into public.runs (
    user_id, created_at, run_id, started_at, played_sec, valid, reject_reason,
    mode, instrument, bpm, level, rank, green_pct, duration_sec, survival_sec, cleared
  ) values (
    v_uid, v_now, p_run_id, p_started_at, p_played_sec, v_valid, v_reason,
    p_mode, coalesce(p_instrument, 'kick'), p_bpm, p_level, p_rank, p_green_pct,
    p_duration_sec, p_survival_sec, coalesce(p_cleared, false)
  );
  return jsonb_build_object('valid', v_valid, 'reject_reason', v_reason);
end;
$$;

grant execute on function public.submit_run(
  uuid, timestamptz, int, text, text, int, int, text, int, int, int, boolean
) to authenticated;

-- ── leaderboard: cross-user, best-per-user, ranked ──────────────────────────
-- SECURITY DEFINER so it can read everyone's runs (RLS would otherwise restrict
-- to the caller's own rows) while returning ONLY safe columns (name + metrics —
-- no user_id, no email). Time Trial / Gauntlet rank by green%, tie-broken by a
-- longer duration; Sudden Death ranks by survival time.
drop function if exists public.get_leaderboard(text, int, int);
drop function if exists public.get_leaderboard(text, int, int, text);
create function public.get_leaderboard(
  p_mode text,
  p_bpm int default null,
  p_level int default null,
  p_instrument text default null
)
returns table (
  display_name text,
  avatar_url   text,
  rank         text,
  green_pct    int,
  duration_sec int,
  survival_sec int,
  cleared      boolean,
  achieved_at  timestamptz
)
language sql
security definer
set search_path = public
as $$
  with slice as (
    select r.*, coalesce(p.display_name, 'Drummer') as dname, p.avatar_url as aurl
    from runs r
    left join profiles p on p.id = r.user_id
    where r.valid = true
      and r.mode = p_mode
      and (p_bpm        is null or r.bpm        = p_bpm)
      and (p_level      is null or r.level      = p_level)
      and (p_instrument is null or r.instrument = p_instrument)
  ),
  best_per_user as (
    select *,
      row_number() over (
        partition by user_id
        order by
          -- Gauntlet: a cleared run always ranks above an uncleared one.
          case when p_mode = 'gauntlet' and cleared then 1 else 0 end desc,
          case when p_mode = 'suddendeath' then survival_sec else green_pct end desc nulls last,
          duration_sec desc nulls last,
          created_at asc
      ) as rn
    from slice
  )
  select dname, aurl, rank, green_pct, duration_sec, survival_sec, cleared, created_at
  from best_per_user
  where rn = 1
  order by
    case when p_mode = 'gauntlet' and cleared then 1 else 0 end desc,
    case when p_mode = 'suddendeath' then survival_sec else green_pct end desc nulls last,
    duration_sec desc nulls last,
    created_at asc
  limit 100;
$$;

grant execute on function public.get_leaderboard(text, int, int, text) to anon, authenticated;

-- ── account deletion: user-initiated self-service (30-day grace or immediate) ─
-- Incremental deploy: sql/supabase-migration-account-deletion.sql
create table if not exists public.account_deletion_requests (
  user_id       uuid primary key references auth.users on delete cascade,
  requested_at  timestamptz not null default now(),
  scheduled_for timestamptz not null
);

alter table public.account_deletion_requests enable row level security;

drop policy if exists "users read own deletion request" on public.account_deletion_requests;
create policy "users read own deletion request"
  on public.account_deletion_requests for select using (auth.uid() = user_id);

-- Inserts/updates/deletes go through RPCs only.

create or replace function public.delete_user_account(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  delete from public.account_deletion_requests where user_id = p_uid;
  -- beta_members / runs / profiles cascade when auth.users row is removed.
  delete from auth.users where id = p_uid;
end;
$$;

drop function if exists public.request_account_deletion(boolean);
create function public.request_account_deletion(p_immediate boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_scheduled timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  if coalesce(p_immediate, false) then
    perform public.delete_user_account(v_uid);
    return jsonb_build_object('ok', true, 'immediate', true);
  end if;

  v_scheduled := now() + interval '30 days';
  insert into public.account_deletion_requests (user_id, scheduled_for)
  values (v_uid, v_scheduled)
  on conflict (user_id) do update set
    requested_at = now(),
    scheduled_for = excluded.scheduled_for;

  return jsonb_build_object(
    'ok', true,
    'immediate', false,
    'scheduled_for', v_scheduled
  );
end;
$$;

grant execute on function public.request_account_deletion(boolean) to authenticated;

drop function if exists public.cancel_account_deletion();
create function public.cancel_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  delete from public.account_deletion_requests where user_id = v_uid;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.cancel_account_deletion() to authenticated;

drop function if exists public.get_account_deletion_status();
create function public.get_account_deletion_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.account_deletion_requests%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('pending', false);
  end if;
  select * into v_row
  from public.account_deletion_requests
  where user_id = v_uid and scheduled_for > now();
  if not found then
    return jsonb_build_object('pending', false);
  end if;
  return jsonb_build_object(
    'pending', true,
    'scheduled_for', v_row.scheduled_for
  );
end;
$$;

grant execute on function public.get_account_deletion_status() to authenticated;

-- Run daily via pg_cron or Supabase scheduled Edge Function (service role):
--   select public.process_due_account_deletions();
drop function if exists public.process_due_account_deletions();
create function public.process_due_account_deletions()
returns int
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row record;
  v_count int := 0;
begin
  for v_row in
    select user_id from public.account_deletion_requests
    where scheduled_for <= now()
  loop
    perform public.delete_user_account(v_row.user_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
-- Do NOT grant to authenticated — invoke from cron / admin only.
