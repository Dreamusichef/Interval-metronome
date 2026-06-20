-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION: user-initiated account deletion (30-day grace or immediate).
-- Adds account_deletion_requests + self-service RPCs used by Settings →
-- Profile management → Delete account and data.
-- Run this whole block in Supabase → SQL Editor (safe to re-run; idempotent).
--
-- After merge, schedule a daily job (pg_cron or Supabase cron) to run:
--   select public.process_due_account_deletions();
-- Do NOT grant that function to authenticated — admin/cron only.
-- ════════════════════════════════════════════════════════════════════════════

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
