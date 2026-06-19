-- ============================================================================
-- Run anti-cheat (beta minimum) — submit_run RPC + validation columns
-- Paste into Supabase → SQL Editor → Run (after base schema is applied).
-- Safe to re-run (idempotent drops/replaces).
-- ============================================================================

-- ── new columns ─────────────────────────────────────────────────────────────
alter table public.runs add column if not exists run_id uuid;
alter table public.runs add column if not exists started_at timestamptz;
alter table public.runs add column if not exists played_sec int;
alter table public.runs add column if not exists valid boolean not null default true;
alter table public.runs add column if not exists reject_reason text;

create unique index if not exists runs_user_run_id_idx
  on public.runs (user_id, run_id) where run_id is not null;

create index if not exists runs_user_created_idx
  on public.runs (user_id, created_at desc);

-- ── lock down direct inserts ────────────────────────────────────────────────
drop policy if exists "users insert own runs" on public.runs;

-- ── submit_run: dedup + temporal checks only (bot detection deferred to Go) ───
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
  v_grace_sec    int := 25;   -- count-in + between-set rest overhead (tune here)
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

  -- Check 1 — dedup (no second insert; first row already stored)
  if p_run_id is null then
    return jsonb_build_object('valid', false, 'reject_reason', 'missing_run_id');
  end if;
  if exists (select 1 from public.runs where user_id = v_uid and run_id = p_run_id) then
    return jsonb_build_object('valid', false, 'reject_reason', 'duplicate_run');
  end if;

  -- Check 2 — started_at clock sanity
  if p_started_at is null
     or p_started_at > v_now + interval '30 seconds'
     or p_started_at < v_now - interval '24 hours' then
    v_valid := false;
    v_reason := 'invalid_started_at';
  end if;

  -- Check 3 — played_sec bounds
  if v_valid then
    if p_played_sec is null or p_played_sec < 1 then
      v_valid := false;
      v_reason := 'invalid_played_sec';
    else
      if p_mode = 'gauntlet' then
        -- 5 × 1-min sets + 4 × 10s rests + grace
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

  -- Check 3b — impossible back-to-back / overlapping runs
  if v_valid then
    select * into v_prev
    from public.runs
    where user_id = v_uid
    order by created_at desc
    limit 1;

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

-- ── leaderboard: exclude invalid runs ─────────────────────────────────────────
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
