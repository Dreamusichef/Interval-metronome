-- ============================================================================
-- MIGRATION: add per-drum (instrument) dimension to runs + leaderboard.
-- Run this once in Supabase → SQL Editor (safe to re-run; idempotent).
-- Existing rows are backfilled to 'kick' (the game was kick-only before).
-- ============================================================================

alter table public.runs
  add column if not exists instrument text not null default 'kick'
  check (instrument in ('kick', 'snare'));

create index if not exists runs_mode_instr_idx on public.runs (mode, instrument, bpm, level);

-- Replace the leaderboard function with an instrument-aware version.
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
    where r.mode = p_mode
      and (p_bpm        is null or r.bpm        = p_bpm)
      and (p_level      is null or r.level      = p_level)
      and (p_instrument is null or r.instrument = p_instrument)
  ),
  best_per_user as (
    select *,
      row_number() over (
        partition by user_id
        order by
          case when p_mode = 'suddendeath' then survival_sec else green_pct end desc nulls last,
          duration_sec desc nulls last,
          created_at asc
      ) as rn
    from slice
  )
  select dname, aurl, rank, green_pct, duration_sec, survival_sec, created_at
  from best_per_user
  where rn = 1
  order by
    case when p_mode = 'suddendeath' then survival_sec else green_pct end desc nulls last,
    duration_sec desc nulls last,
    created_at asc
  limit 100;
$$;

grant execute on function public.get_leaderboard(text, int, int, text) to anon, authenticated;
