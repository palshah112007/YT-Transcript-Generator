import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Supabase is optional: without valid config the app runs in guest mode
// (transcripts still generate; login/history/credits are disabled).
export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey
);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Startup check: missing/empty VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is
// almost always a .env mistake (file absent, vars renamed, not copied from
// .env.example). Log it loudly so the cause is obvious in the console.
export const missingSupabaseEnvVars = [
  !supabaseUrl && 'VITE_SUPABASE_URL',
  !supabaseAnonKey && 'VITE_SUPABASE_ANON_KEY',
].filter(Boolean);

if (!isSupabaseConfigured) {
  console.error(
    `[TranscriptLab] Missing Supabase environment variables: ${missingSupabaseEnvVars.join(', ')}. ` +
      'Auth, history, and credits are disabled. ' +
      'Copy .env.example to .env and fill in the values from Supabase Dashboard -> Settings -> API, then restart the dev server.'
  );
}

// Dev-only connection check (runs once on load). Logs whether auth and a
// minimal table read actually work with the current env config, so setup
// mistakes surface in the console instead of as silent failures in the UI.
//
// "auth check" (supabase.auth.getSession) — possible error causes:
//   - Invalid API key (VITE_SUPABASE_ANON_KEY wrong/rotated): supabase-js
//     throws / rejects with "Invalid API key" before any network session read.
//   - Network: "Failed to fetch" / TypeError — Supabase URL unreachable
//     (project paused, deleted, wrong VITE_SUPABASE_URL, DNS/firewall blocked,
//     or offline).
//   - Corrupt local storage (tampered/malformed session token): error thrown
//     while reading or decoding the cached session.
//
// "db check" (select id ... limit 1 on yt_transcripts) — possible error causes:
//   - Invalid API key: PostgREST returns 401 with message
//     "Invalid API key" (anon key wrong or project config changed).
//   - RLS blocking: 0 rows returned with NO error when no user is logged in —
//     RLS filters out every row for anonymous requests (expected, not a
//     failure). A real error would only appear if a policy referenced a
//     missing helper function, which surfaces as a 4xx with its message.
//   - Table missing: relation "yt_transcripts" does not exist — init.sql not
//     run (or run against a different project); PostgREST error code 42P01.
//   - Network: "Failed to fetch" / TypeError — same connectivity causes as
//     the auth check (paused/deleted project, wrong URL, offline).
if (import.meta.env.DEV && isSupabaseConfigured) {
  (async () => {
    try {
      const { error } = await supabase.auth.getSession();
      console.log(`[dev check] auth check: ${error ? 'FAIL' : 'ok'}${error ? ` — ${error.message}` : ''}`);
    } catch (error) {
      console.log(`[dev check] auth check: FAIL — ${error?.message ?? error}`);
    }
    try {
      const { error } = await supabase
        .from('yt_transcripts')
        .select('id')
        .limit(1);
      console.log(`[dev check] db check: ${error ? 'FAIL' : 'ok'}${error ? ` — ${error.message}` : ''}`);
    } catch (error) {
      console.log(`[dev check] db check: FAIL — ${error?.message ?? error}`);
    }
  })();
}

// Lightweight reachability probe for the status indicator on the main page.
// Hits the auth health endpoint directly (works even when the project is
// paused/deleted — the fetch itself fails, which is exactly what we detect).
export async function pingSupabase(timeoutMs = 8000) {
  if (!isSupabaseConfigured) return 'unconfigured';
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: supabaseAnonKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok ? 'online' : 'offline';
  } catch {
    return 'offline';
  }
}
