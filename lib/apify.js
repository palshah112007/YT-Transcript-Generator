// Shared Apify logic: used by api/apify-proxy.js (Vercel) and the Vite dev
// middleware in vite.config.js so local `npm run dev` behaves the same.

const DEFAULT_ACTOR = 'starvibe/youtube-video-transcript';

function normalizeActorId(actorId) {
  // Accept both "owner/name" and "owner~name" forms of the actor id.
  return (actorId || DEFAULT_ACTOR).replace('/', '~');
}

export function buildActorInput(url, language) {
  // Actor input schema: youtube_url + optional 2-letter ISO language code.
  // "auto" must be omitted, otherwise the actor rejects the run.
  const input = { youtube_url: url, include_transcript_text: true };
  if (language && /^[a-z]{2}$/i.test(language)) {
    input.language = language.toLowerCase();
  }
  return input;
}

/**
 * Runs the Apify transcript actor and returns its dataset items.
 * Returns { ok: true, items } on success, or
 * { ok: false, status, message, details? } on failure.
 */
export async function fetchTranscriptFromApify({ url, language, token, actorId }) {
  // Treat README placeholders as "not configured" so they never hit the API.
  if (!token || /^your-|^changeme/i.test(token)) {
    return { ok: false, status: 500, message: 'Apify token is not configured (APIFY_TOKEN).' };
  }
  if (!url) {
    return { ok: false, status: 400, message: 'Missing YouTube URL.' };
  }

  const id = normalizeActorId(actorId);
  // run-sync-get-dataset-items starts the actor and returns the finished
  // run's dataset items directly, so there is no race with a still-running job.
  const runUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(id)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=55`;

  try {
    const response = await fetch(runUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildActorInput(url, language)),
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      const message =
        response.status === 401
          ? 'Apify token is invalid or expired.'
          : response.status === 404
            ? 'Apify actor not found. Check APIFY_ACTOR_ID.'
            : 'Apify actor request failed.';
      return { ok: false, status: 502, message, details };
    }

    const items = await response.json();
    return { ok: true, items: Array.isArray(items) ? items : [items] };
  } catch (error) {
    return { ok: false, status: 500, message: error?.message ?? 'Unexpected error' };
  }
}
