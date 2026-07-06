-- ============================================================================
-- MIGRATION: add subdivision dimension to runs + leaderboard.
-- Run this once in Supabase → SQL Editor (safe to re-run; idempotent).
-- Existing rows are backfilled to 'sixteenth' (the prior implicit default).
-- ============================================================================

alter table public.runs
  add column if not exists subdivision text not null default 'sixteenth'
  check (subdivision in ('quarter', 'eighth', 'triplet', 'sixteenth', 'sextuplet'));

update public.runs set subdivision = 'sixteenth' where subdivision is null;

create index if not exists runs_mode_instr_subdiv_idx
  on public.runs (mode, instrument, subdivision, bpm, level);

-- Replace submit_run with subdivision parameter.
drop function if exists public.submit_run(
  uuid, timestamptz, int, text, text, int, int, text, int, int, int, boolean
);
drop function if exists public.submit_run(
  uuid, timestamptz, int, text, text, int, int, text, int, int, int, boolean, text
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
  p_cleared        boolean,
  p_subdivision    text default 'sixteenth'
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
  v_subdivision  text := coalesce(p_subdivision, 'sixteenth');
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
  if v_subdivision not in ('quarter', 'eighth', 'triplet', 'sixteenth', 'sextuplet') then
    v_subdivision := 'sixteenth';
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
    mode, instrument, subdivision, bpm, level, rank, green_pct, duration_sec, survival_sec, cleared
  ) values (
    v_uid, v_now, p_run_id, p_started_at, p_played_sec, v_valid, v_reason,
    p_mode, coalesce(p_instrument, 'kick'), v_subdivision, p_bpm, p_level, p_rank, p_green_pct,
    p_duration_sec, p_survival_sec, coalesce(p_cleared, false)
  );
  return jsonb_build_object('valid', v_valid, 'reject_reason', v_reason);
end;
$$;

grant execute on function public.submit_run(
  uuid, timestamptz, int, text, text, int, int, text, int, int, int, boolean, text
) to authenticated;

-- Replace get_leaderboard with subdivision filter.
drop function if exists public.get_leaderboard(text, int, int);
drop function if exists public.get_leaderboard(text, int, int, text);
drop function if exists public.get_leaderboard(text, int, int, text, text);
create function public.get_leaderboard(
  p_mode text,
  p_bpm int default null,
  p_level int default null,
  p_instrument text default null,
  p_subdivision text default null
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
      and (p_subdivision is null or r.subdivision = p_subdivision)
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

grant execute on function public.get_leaderboard(text, int, int, text, text) to anon, authenticated;
