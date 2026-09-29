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
