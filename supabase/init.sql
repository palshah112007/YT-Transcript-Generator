-- Supabase setup for the YouTube Transcript Generator.
-- Run this whole file once in: Supabase Dashboard -> SQL Editor -> New query.
-- It is fully idempotent, so it is safe to run again (e.g. on a new project).

-- 1. Table ---------------------------------------------------------------
create table if not exists yt_transcripts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  youtube_url text not null,
  title text,
  transcript_text text,
  language text,
  metadata jsonb,
  credits_used int default 1,
  created_at timestamptz default now()
);

-- 2. Row Level Security ---------------------------------------------------
alter table yt_transcripts enable row level security;

-- Policies use drop-if-exists first so re-running this file never errors.
drop policy if exists "Allow logged-in users to insert their own history"
  on yt_transcripts;
drop policy if exists "Allow logged-in users to select their own history"
  on yt_transcripts;

create policy "Allow logged-in users to insert their own history"
  on yt_transcripts
  for insert
  with check (auth.uid() = user_id);

create policy "Allow logged-in users to select their own history"
  on yt_transcripts
  for select
  using (auth.uid() = user_id);

-- 3. Performance ----------------------------------------------------------
create index if not exists yt_transcripts_user_created_idx
  on yt_transcripts (user_id, created_at desc);

-- 4. Verify ---------------------------------------------------------------
-- Re-running is safe. Optional checks (run separately if you like):
--   select * from pg_policies where tablename = 'yt_transcripts';
--   select indexname from pg_indexes where tablename = 'yt_transcripts';
