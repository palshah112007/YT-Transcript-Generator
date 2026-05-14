-- Create this table in your Supabase project to store transcript history and metadata.
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

-- Enable row-level security and allow authenticated users to only see their own transcripts.
alter table yt_transcripts enable row level security;

create policy "Allow logged-in users to insert their own history" on yt_transcripts
  for insert with check (auth.uid() = user_id);

create policy "Allow logged-in users to select their own history" on yt_transcripts
  for select using (auth.uid() = user_id);
