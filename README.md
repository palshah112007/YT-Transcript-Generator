# YouTube Transcript Generator

A Gen Z–style React one-page app with Supabase auth, transcript history, and Apify integration.

## Features
- React frontend built with Vite
- Supabase Authentication and Postgres history
- Apify YouTube transcript actor proxy via serverless function
- .env variables for secrets
- Vercel-ready deploy structure
- Transcript timestamps toggle
- Download transcripts as .txt files
- Credits counter and usage tracking
- Account settings modal
- Clickable transcript history

## Setup
1. Copy `.env.example` to `.env`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Set `APIFY_TOKEN` and optionally `APIFY_ACTOR_ID`.
   - Default Apify actor: `starvibe/youtube-video-transcript`
4. Install dependencies:
   ```bash
   npm install
   ```
5. Run locally:
   ```bash
   npm run dev
   ```

> Local dev will run the frontend, but the Apify proxy is available when deploying to Vercel or running `vercel dev`.

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
