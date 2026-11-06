// Unified transcript engine.
// Primary: High-speed InnerTube caption extractor with JSON3 and XML parsers.
// Secondary: YoutubeTranscript fallback scraper.
// Tertiary: Apify actor (optional, used when APIFY_TOKEN is configured).
import { YoutubeTranscript } from 'youtube-transcript';
import { fetchTranscriptFromApify } from './apify.js';

const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const INNERTUBE_CLIENT_VERSION = '20.10.38';
const INNERTUBE_CONTEXT = {
  client: {
    clientName: 'ANDROID',
    clientVersion: INNERTUBE_CLIENT_VERSION,
  },
};
const INNERTUBE_USER_AGENT = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`;

const TIMEDTEXT_MAX_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetch with retry + exponential backoff for transient blocks.
// YouTube's timedtext endpoint intermittently answers 429/5xx (or an HTML
// "Sorry, automated queries" block page) on bursts of requests. Retrying
// after a short backoff recovers those runs without user-visible errors.
async function fetchWithRetry(url, { attempts = TIMEDTEXT_MAX_ATTEMPTS, headers, timeoutMs = 6000, ...init } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      // 429/5xx are transient: back off and try again.
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`upstream ${res.status}`);
        if (attempt < attempts) {
          await sleep(700 * attempt + Math.floor(Math.random() * 300));
          continue;
        }
        return null;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await sleep(700 * attempt + Math.floor(Math.random() * 300));
        continue;
      }
    }
  }
  if (lastError) throw lastError;
  return null;
}

/**
 * Extracts the 11-character YouTube video ID from any URL format or bare ID.
 * Supports /watch?v=, youtu.be/, /shorts/, /live/, /embed/, /v/, and mobile links.
 */
export function extractCleanVideoId(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(/(?:v=|\/shorts\/|\/live\/|\/embed\/|youtu\.be\/|\/v\/|^)([a-zA-Z0-9_-]{11})(?:[?&/#]|$)/);
  return match ? match[1] : null;
}

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
 * Scores a caption track against the requested language so the best available
 * variant wins instead of always tracks[0]. Exact match > regional variant
 * prefix (hi -> hi-IN) > base-language fallback; manual captions outrank ASR.
 * @param {object} track - caption track ({ languageCode, kind })
 * @param {string} requestedLang - lowercase 2-letter language code
 * @returns {number} Match score; 0 means no usable match
 */
function trackLanguageScore(track, requestedLang) {
  if (!requestedLang) return 0;
  const code = String(track?.languageCode || '').toLowerCase();
  if (!code) return 0;
  const base = code.split('-')[0];
  let score = 0;
  if (code === requestedLang) score = 4;
  else if (base === requestedLang) score = 3;
  else return 0;
  if (track?.kind === 'asr') score -= 0.5; // prefer human-made captions
  return score;
}

/**
 * Direct InnerTube caption fetcher.
 * Uses Android player context to fetch official caption tracks with zero browser CAPTCHA walls.
 */
async function fetchDirectInnerTube(videoId, requestedLang) {
  try {
    const resp = await fetchWithRetry(INNERTUBE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': INNERTUBE_USER_AGENT,
      },
      timeoutMs: 6000,
      body: JSON.stringify({
        context: INNERTUBE_CONTEXT,
        videoId,
      }),
    });
    if (!resp?.ok) return null;
    const data = await resp.json();
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return null;

    // Select the best language track for the request instead of defaulting to
    // tracks[0]; a requested language that only exists as a regional variant
    // (e.g. hi vs hi-IN) still wins over the first track.
    let track = tracks[0];
    if (requestedLang && requestedLang !== 'auto') {
      const requested = requestedLang.toLowerCase();
      let bestScore = trackLanguageScore(tracks[0], requested);
      for (const t of tracks.slice(1)) {
        const s = trackLanguageScore(t, requested);
        if (s > bestScore) {
          bestScore = s;
          track = t;
        }
      }
      if (bestScore === 0) track = tracks[0]; // no native match: keep default
    }

    if (!track?.baseUrl) return null;

    // 1) Try JSON3 format first (fastest, cleanest structure)
    try {
      const jsonUrl = track.baseUrl.replace(/&fmt=srv\d/g, '') + '&fmt=json3';
      const jsonRes = await fetchWithRetry(jsonUrl, { timeoutMs: 6000 });
      if (jsonRes?.ok) {
        const json = await jsonRes.json();
        const segments = [];
        for (const evt of json.events || []) {
          if (!evt.segs) continue;
          const text = decodeEntities(evt.segs.map((s) => s.utf8 || '').join('')).trim();
          if (!text) continue;
          segments.push({
            text,
            start: (Number(evt.tStartMs) || 0) / 1000,
            duration: (Number(evt.dDurationMs) || 0) / 1000,
          });
        }
        if (segments.length > 0) {
          return { segments, lang: track.languageCode || 'auto' };
        }
      }
    } catch {}

    // 2) Fallback to XML format (srv3 or classic text)
    try {
      const xmlRes = await fetchWithRetry(track.baseUrl, { timeoutMs: 6000 });
      if (xmlRes?.ok) {
        const xml = await xmlRes.text();
        // Blocked request pages come back as HTML with no caption tags; skip
        // parsing so the fallback engines below still get a chance.
        if (/<html/i.test(xml.slice(0, 200))) return null;
        const segments = [];
        // srv3: <p t="1000" d="2000"><s>text</s></p>
        const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
        let match;
        while ((match = pRegex.exec(xml)) !== null) {
          const startMs = parseInt(match[1], 10);
          const durMs = parseInt(match[2], 10);
          const rawText = match[3].replace(/<[^>]+>/g, '').trim();
          const text = decodeEntities(rawText);
          if (text) {
            segments.push({
              text,
              start: startMs / 1000,
              duration: durMs / 1000,
            });
          }
        }

        // classic: <text start="1.5" dur="2.0">text</text>
        if (segments.length === 0) {
          const textRegex = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
          let tMatch;
          while ((tMatch = textRegex.exec(xml)) !== null) {
            const start = parseFloat(tMatch[1]);
            const dur = parseFloat(tMatch[2]);
            const text = decodeEntities(tMatch[3].replace(/<[^>]+>/g, '').trim());
            if (text) {
              segments.push({ text, start, duration: dur });
            }
          }
        }

        if (segments.length > 0) {
          return { segments, lang: track.languageCode || 'auto' };
        }
      }
    } catch {}
  } catch (err) {
    // Surface the upstream failure so the caller can distinguish "no captions"
    // from "YouTube blocked us" for its user-facing error hint.
    return { error: err?.message ?? String(err) };
  }
  return null;
}

/**
 * Returns { ok: true, engine, item } on success, or
 * { ok: false, message, details? } on failure.
 * item is normalized so the frontend treats both engines alike:
 * { title, transcript_text, transcript: [{ text, start }], language }
 */
export async function generateTranscript({ url, language, apifyToken, apifyActorId }) {
  const videoId = extractCleanVideoId(url) || url;
  let freeError;

  // 1) Primary: Direct InnerTube Engine (sub-second, official Android API, zero CAPTCHA walls)
  let directResult = null;
  try {
    directResult = await fetchDirectInnerTube(videoId, language);
    if (directResult?.error) {
      freeError = new Error(`InnerTube: ${directResult.error}`);
      directResult = null;
    }
    if (directResult && directResult.segments.length > 0) {
      const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const title = await fetchVideoTitle(canonicalUrl);
      const detectedLang = directResult.lang || 'auto';
      const needsTranslation =
        language &&
        language !== 'auto' &&
        (!detectedLang || !detectedLang.toLowerCase().startsWith(language.toLowerCase()));

      return {
        ok: true,
        engine: 'free',
        item: {
          title,
          transcript_text: directResult.segments.map((s) => s.text).join(' '),
          transcript: directResult.segments,
          language: detectedLang,
          detected_language: detectedLang,
          requested_language: language || 'auto',
          needs_translation: needsTranslation,
        },
      };
    }
  } catch (err) {
    freeError = err;
  }

  // 2) Secondary: YoutubeTranscript package scraper. Also retried once so a
  // single transient block does not surface as "no transcript found" to users.
  try {
    let segments;
    let nativeLang = 'auto';

    if (language && language !== 'auto') {
      try {
        segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: language });
        nativeLang = language;
      } catch {
        segments = await YoutubeTranscript.fetchTranscript(videoId);
      }
    } else {
      segments = await YoutubeTranscript.fetchTranscript(videoId);
    }

    if (Array.isArray(segments) && segments.length > 0) {
      const detectedLang = segments[0]?.lang || nativeLang || 'auto';
      const normalizedSegments = segments.map((s) => ({
        text: decodeEntities(s.text),
        start: (Number(s.offset) || 0) / 1000,
        duration: (Number(s.duration) || 0) / 1000,
      }));

      const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const title = await fetchVideoTitle(canonicalUrl);
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
    if (!freeError) freeError = error;
  }

  // 3) Tertiary: Apify fallback (only when a real token is configured).
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
  }

  const langHint =
    language && language !== 'auto' && language !== 'en'
      ? ` No ${language.toUpperCase()} captions were found — the video may only have captions in other languages.`
      : '';

  return {
    ok: false,
    message:
      'No captions found for this video. Captions may be disabled by the creator, not yet generated, or unavailable on YouTube.' +
      langHint,
    details: freeError?.message,
  };
}
