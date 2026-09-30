-- Supabase setup for the YouTube Transcript Generator.
-- Run this whole file once in: Supabase Dashboard -> SQL Editor -> New query.
-- It is fully idempotent, so it is safe to run again (e.g. on a new project
-- or to upgrade an older schema).

-- 1. yt_transcripts table -------------------------------------------------
create table if not exists yt_transcripts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  youtube_url text not null,
  title text,
  transcript_text text,
  language text,
  metadata jsonb,
  credits_used int default 1,
  created_at timestamptz default now()
);

-- Upgrade an existing table (created by an older init.sql) to match:
--   a) default user_id to the logged-in user
alter table yt_transcripts
  alter column user_id set default auth.uid();

--   b) add the foreign key to auth.users if missing. There is no
--      "add constraint if not exists" in Postgres, so check pg_constraint.
--      Orphaned rows (their user was deleted) are removed first, otherwise
--      adding the constraint would fail.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'yt_transcripts_user_id_fkey'
      and conrelid = 'yt_transcripts'::regclass
  ) then
    delete from yt_transcripts where user_id not in (select id from auth.users);
    alter table yt_transcripts
      add constraint yt_transcripts_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- 2. profiles table --------------------------------------------------------
-- One row per auth user, created automatically on signup (trigger below).
-- credits starts at 10 and is decremented through use_credit() only.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  credits int not null default 10
);

alter table profiles enable row level security;

-- Owner can read their own credit balance. There is deliberately NO
-- insert/update/delete policy: writes go through use_credit() (security
-- definer) and rows are created by the signup trigger, so clients can never
-- mint or inflate credits directly.
drop policy if exists "Users can read their own profile" on profiles;
create policy "Users can read their own profile"
  on profiles
  for select
  using (auth.uid() = id);

-- 3. Signup trigger: create a profile row for every new user --------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 4. Row Level Security on yt_transcripts ---------------------------------
alter table yt_transcripts enable row level security;

-- Drop policies from every version of this file (old and current names) so
-- re-running never errors and stale policies never linger.
drop policy if exists "Allow logged-in users to insert their own history" on yt_transcripts;
drop policy if exists "Allow logged-in users to select their own history" on yt_transcripts;
drop policy if exists "Users can select their own transcripts" on yt_transcripts;
drop policy if exists "Users can insert their own transcripts" on yt_transcripts;
drop policy if exists "Users can delete their own transcripts" on yt_transcripts;

-- Owner-only policies. UPDATE is intentionally absent: the app never edits
-- saved transcripts, and fewer policies = smaller attack surface.
create policy "Users can select their own transcripts"
  on yt_transcripts
  for select
  using (auth.uid() = user_id);

create policy "Users can insert their own transcripts"
  on yt_transcripts
  for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own transcripts"
  on yt_transcripts
  for delete
  using (auth.uid() = user_id);

-- 5. Performance -----------------------------------------------------------
create index if not exists yt_transcripts_user_created_idx
  on yt_transcripts (user_id, created_at desc);

-- 6. use_credit(): atomic, server-side credit spending ----------------------
-- Decrements the caller's profile.credits by 1 and returns the remaining
-- balance. SECURITY DEFINER lets it write profiles even though RLS gives
-- clients no update policy. The `credits > 0` predicate inside the single
-- UPDATE makes the check-and-decrement atomic: concurrent calls can never
-- drive credits below zero. Raises 'No credits remaining' (SQLSTATE P0001)
-- when the balance is already 0.
create or replace function public.use_credit()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  update public.profiles
     set credits = credits - 1
   where id = auth.uid()
     and credits > 0
  returning credits into remaining;

  if not found then
    raise exception 'No credits remaining' using errcode = 'P0001';
  end if;

  return remaining;
end;
$$;

-- Only logged-in users may spend credits; anon gets nothing.
grant execute on function public.use_credit() to authenticated;
revoke execute on function public.use_credit() from anon;

-- 7. Verify -----------------------------------------------------------------
-- Re-running is safe. Optional checks (run separately if you like):
--   select * from pg_policies where tablename in ('yt_transcripts', 'profiles');
--   select indexname from pg_indexes where tablename = 'yt_transcripts';
--   select proname, prosecdef from pg_proc where proname = 'use_credit';
--   select trigger_name from information_schema.triggers
--     where event_object_table = 'users' and trigger_name = 'on_auth_user_created';

-- 8. Test queries: cross-tenant isolation -----------------------------------
-- Paste into SQL Editor as a single transaction. Replace the two UUIDs with
-- real user ids from `select id, email from auth.users;`.
--
-- begin;
-- set local role authenticated;
--
-- -- Impersonate user A:
-- select set_config(
--   'request.jwt.claims',
--   json_build_object('sub', '00000000-0000-0000-0000-00000000000a', 'role', 'authenticated')::text,
--   true
-- );
-- select * from yt_transcripts;   -- must return ONLY user A's rows
-- select credits from profiles;   -- must return ONLY user A's balance
-- select use_credit();            -- returns remaining credits (e.g. 9)
--
-- -- Impersonate user B:
-- select set_config(
--   'request.jwt.claims',
--   json_build_object('sub', '00000000-0000-0000-0000-00000000000b', 'role', 'authenticated')::text,
--   true
-- );
-- select * from yt_transcripts;   -- must return ONLY user B's rows — A's rows are invisible
-- select credits from profiles;   -- must return ONLY user B's balance
--
-- -- Spent all of B's credits elsewhere first? This now errors with
-- -- 'No credits remaining' (P0001) and credits stay at 0, never negative:
-- -- select use_credit();
--
-- -- Direct credit tampering is blocked (no update policy on profiles):
-- -- update profiles set credits = 1000;  -- 0 rows affected
--
-- rollback;  -- transaction-local impersonation: nothing persisted
