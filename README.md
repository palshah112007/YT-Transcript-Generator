# YouTube Transcript Generator

A Gen Z–style React one-page app with Supabase auth (optional), transcript history, and a free built-in transcript engine.

## Features
- React frontend built with Vite
- **Works out of the box**: free YouTube captions engine — no API keys needed
- Optional Apify actor fallback (only if `APIFY_TOKEN` is set)
- Optional Supabase auth + Postgres history (app runs in guest mode without it)
- Transcript timestamps toggle
- Download transcripts as .txt files
- Credits counter and usage tracking
- Account settings modal
- Clickable transcript history

## Setup
1. (Optional) Copy `.env.example` to `.env`.
2. Transcript generation works with **zero configuration** — just run:
   ```bash
   npm install
   npm run dev
   ```
3. Optional: set `APIFY_TOKEN` (and `APIFY_ACTOR_ID`) to enable the Apify fallback when the free engine is blocked.
4. Optional: set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` and run `supabase/init.sql` to enable login, history, and credits. Without these the app runs in guest mode.

## Supabase Setup (new project)
1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Pick a name, a strong database password, and a region near you. Wait for provisioning.
3. Open **Project Settings → API** and copy the **Project URL** and **anon public key**.
4. Paste them into `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Open **SQL Editor → New query**, paste all of `supabase/init.sql`, and run it. It is idempotent — safe to re-run.
6. Optional check in SQL Editor:
   ```sql
   select * from pg_policies where tablename = 'yt_transcripts';
   ```
   You should see the two policies (insert + select, owner-only).

## Supabase Database
Create a table called `yt_transcripts` with this schema:

```sql
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
```

Grant access to authenticated users using Supabase Row Level Security.

## Vercel Deploy
- Deploy the project root to Vercel.
- Add environment variables in Vercel dashboard:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `APIFY_TOKEN`
  - `APIFY_ACTOR_ID`
- Optional: install the Vercel CLI and run `vercel dev` for local serverless function testing.

The API proxy function is available at `/api/apify-proxy`.

## Usage
1. Sign up or log in with Supabase auth
2. Paste a YouTube URL or video ID
3. Select language and generate transcript
4. Toggle timestamps on/off in the result
5. Copy or download the transcript
6. View history by clicking saved items
7. Check credits usage in account settings
