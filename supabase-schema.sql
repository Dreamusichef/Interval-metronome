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
  bpm          int,            -- free modes (60–240); null for gauntlet
  level        int,            -- gauntlet (1–6); null for free modes
  rank         text not null,  -- 'E','D','C','B','A','S','SS'
  green_pct    int  not null,  -- 0–100
  duration_sec int,            -- chosen target / played length (free modes)
  survival_sec int,            -- sudden death: time survived (capped at target)
  cleared      boolean not null default false
);

alter table public.runs enable row level security;

drop policy if exists "users insert own runs" on public.runs;
create policy "users insert own runs"
  on public.runs for insert with check (auth.uid() = user_id);

drop policy if exists "users read own runs" on public.runs;
create policy "users read own runs"
  on public.runs for select using (auth.uid() = user_id);

create index if not exists runs_user_mode_idx on public.runs (user_id, mode, bpm, level);
create index if not exists runs_mode_bpm_idx  on public.runs (mode, bpm);
create index if not exists runs_mode_level_idx on public.runs (mode, level);

-- ── leaderboard: cross-user, best-per-user, ranked ──────────────────────────
-- SECURITY DEFINER so it can read everyone's runs (RLS would otherwise restrict
-- to the caller's own rows) while returning ONLY safe columns (name + metrics —
-- no user_id, no email). Time Trial / Gauntlet rank by green%, tie-broken by a
-- longer duration; Sudden Death ranks by survival time.
drop function if exists public.get_leaderboard(text, int, int);
create function public.get_leaderboard(p_mode text, p_bpm int default null, p_level int default null)
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
      and (p_bpm   is null or r.bpm   = p_bpm)
      and (p_level is null or r.level = p_level)
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

grant execute on function public.get_leaderboard(text, int, int) to anon, authenticated;
