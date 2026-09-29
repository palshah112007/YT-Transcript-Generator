// Unified transcript engine.
// Primary: free YouTube captions fetch (no token needed, youtube-transcript).
// Fallback: Apify actor (optional, used when APIFY_TOKEN is configured and
// the free fetch fails, e.g. YouTube blocks the request).
import { YoutubeTranscript } from 'youtube-transcript';
import { fetchTranscriptFromApify } from './apify.js';

function decodeEntities(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Returns { ok: true, engine, item } on success, or
 * { ok: false, message, details? } on failure.
 * item is normalized so the frontend treats both engines alike:
 * { title, transcript_text, transcript: [{ text, start }], language }
 */
export async function generateTranscript({ url, language, apifyToken, apifyActorId }) {
  // 1) Free engine (no credentials required).
  let freeError;
  try {
    const options = {};
    if (language && language !== 'auto') options.lang = language;
    const segments = await YoutubeTranscript.fetchTranscript(url, options);
    if (Array.isArray(segments) && segments.length > 0) {
      return {
        ok: true,
        engine: 'free',
        item: {
          title: 'YouTube Transcript',
          transcript_text: segments.map((s) => decodeEntities(s.text)).join(' '),
          transcript: segments.map((s) => ({
            text: decodeEntities(s.text),
            start: (Number(s.offset) || 0) / 1000,
          })),
          language: segments[0]?.lang ?? language ?? 'en',
        },
      };
    }
  } catch (error) {
    freeError = error;
  }

  // 2) Apify fallback (only when a token is configured).
  if (apifyToken) {
    const result = await fetchTranscriptFromApify({
      url,
      language,
      token: apifyToken,
      actorId: apifyActorId,
    });
    if (result.ok && result.items.length > 0) {
      return { ok: true, engine: 'apify', item: result.items[0] };
    }
    if (!result.ok) {
      return { ok: false, message: result.message, details: result.details };
    }
  }

  return {
    ok: false,
    message:
      'No transcript found for this video. It may have captions disabled, be unavailable, or YouTube temporarily blocked the request — try again shortly.',
    details: freeError?.message,
  };
}
