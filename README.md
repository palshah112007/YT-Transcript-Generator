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
- Live Supabase connection status indicator with restore guide

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

### Connection status indicator

The topbar shows a live Supabase status pill:

| Status | Meaning |
| --- | --- |
| 🟢 `Supabase: Online` | Project reachable — login, history, credits active |
| 🔴 `Supabase: Offline` | Project unreachable — likely paused or deleted; **click the pill for a restore guide** (also opens automatically) |
| 🟡 `Supabase: Checking` | Probe in progress (on page load) |
| ⚪ `Supabase: Not set up` | No `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — guest mode |

The app probes `GET /auth/v1/health` on page load, on window focus, and every 60 seconds, so the pill turns green by itself once a paused project is restored.

Note: free projects pause after ~1 week of inactivity and are deleted after ~90 days. When a project is deleted, its URL/keys cannot be recovered — create a new project and update `.env`.

### Testing the auth flow

With credentials configured, verify the whole auth chain (reachability, auth service sanity, signup, login) without the browser:

```bash
node scripts/test-auth.mjs
```

The script creates a throwaway test account (`test-<timestamp>@example.com`) and prints a ✓/✗ report. If email confirmation is enabled (the Supabase default), login is expected to return `Email not confirmed` — that still counts as a pass since it proves the flow works end-to-end.

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
1. Check the Supabase status pill in the topbar (green = login available; red = click for the restore guide)
2. Sign up or log in with Supabase auth
3. Paste a YouTube URL or video ID
4. Select language and generate transcript
5. Toggle timestamps on/off in the result
6. Copy or download the transcript
7. View history by clicking saved items
8. Check credits usage in account settings
