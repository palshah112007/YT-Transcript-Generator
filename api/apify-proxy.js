// Vercel serverless function: returns transcripts for YouTube URLs.
// All hardening (bearer-token auth, URL validation, status-code mapping,
// timeout) lives in lib/proxy-handler.js so this thin adapter and the Vite
// dev middleware (vite.config.js) behave identically.
// Env vars used here: SUPABASE_URL/VITE_SUPABASE_URL + SUPABASE_ANON_KEY/
// VITE_SUPABASE_ANON_KEY (token verification), APIFY_TOKEN, APIFY_ACTOR_ID.
// Secrets are read from process.env only and never appear in any response.
import { handleTranscriptRequest } from '../lib/proxy-handler.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  await handleTranscriptRequest(req, res, {
    getEnv: (name) => process.env[name],
  });
}
