// Unified transcript engine.
// Primary: free YouTube captions fetch (no token needed, youtube-transcript).
// Fallback: Apify actor (optional, used when APIFY_TOKEN is configured and
// the free fetch fails, e.g. YouTube blocks the request).
import { YoutubeTranscript } from 'youtube-transcript';
import { fetchTranscriptFromApify } from './apify.js';

/**
 * Decodes HTML entities commonly present in raw YouTube caption tracks.
 * @param {string} text - Raw caption string with HTML entities
 * @returns {string} Sanitized plain text string
 */
function decodeEntities(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchVideoTitle(url) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      signal: AbortSignal.timeout(3500),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.title) return data.title;
    }
  } catch {}
  return 'YouTube Transcript';
}

/**
 * Returns { ok: true, engine, item } on success, or
 * { ok: false, message, details? } on failure.
 * item is normalized so the frontend treats both engines alike:
 * { title, transcript_text, transcript: [{ text, start }], language }
 *
 * IMPORTANT: This function now returns the NATIVE captions instantly
 * WITHOUT any translation. Translation is handled separately by /api/translate.
 */
export async function generateTranscript({ url, language, apifyToken, apifyActorId }) {
  // 1) Free engine (no credentials required).
  let freeError;
  try {
    // Always fetch native captions first (fastest path).
    // If the user requested a specific language and YouTube has that caption
    // track natively, use it. Otherwise fall back to whatever is available.
    let segments;
    let nativeLang = 'auto';

    if (language && language !== 'auto') {
      try {
        segments = await YoutubeTranscript.fetchTranscript(url, { lang: language });
        nativeLang = language;
      } catch {
        // Requested language track doesn't exist — fall back to default
        segments = await YoutubeTranscript.fetchTranscript(url);
      }
    } else {
      segments = await YoutubeTranscript.fetchTranscript(url);
    }

    if (Array.isArray(segments) && segments.length > 0) {
      const detectedLang = segments[0]?.lang || nativeLang || 'auto';
      const normalizedSegments = segments.map((s) => ({
        text: decodeEntities(s.text),
        start: (Number(s.offset) || 0) / 1000,
        duration: (Number(s.duration) || 0) / 1000,
      }));

      const title = await fetchVideoTitle(url);
      const needsTranslation =
        language &&
        language !== 'auto' &&
        (!detectedLang || !detectedLang.toLowerCase().startsWith(language.toLowerCase()));

      return {
        ok: true,
        engine: 'free',
        item: {
          title,
          transcript_text: normalizedSegments.map((s) => s.text).join(' '),
          transcript: normalizedSegments,
          language: detectedLang,
          detected_language: detectedLang,
          requested_language: language || 'auto',
          needs_translation: needsTranslation,
        },
      };
    }
  } catch (error) {
    freeError = error;
  }

  // 2) Apify fallback (only when a real token is configured).
  const hasRealApifyToken = Boolean(apifyToken) && !/^your-|^changeme/i.test(apifyToken);
  if (hasRealApifyToken) {
    const result = await fetchTranscriptFromApify({
      url,
      language,
      token: apifyToken,
      actorId: apifyActorId,
    });
    if (result.ok && result.items.length > 0) {
      return { ok: true, engine: 'apify', item: result.items[0] };
    }
    if (!result.ok && result.status !== 500) {
      return { ok: false, message: result.message, details: result.details };
    }
    // status 500 = local config problem; fall through so the user sees the
    // free engine's real error (e.g. "no captions in requested language").
  }

  const langHint =
    language && language !== 'auto' && language !== 'en'
      ? ` No ${language.toUpperCase()} captions were found — the video may only have captions in other languages.`
      : '';
  return {
    ok: false,
    message:
      'No transcript found for this video. It may have captions disabled, be unavailable, or YouTube temporarily blocked the request — try again shortly.' +
      langHint,
    details: freeError?.message,
  };
}
