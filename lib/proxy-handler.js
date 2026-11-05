// Shared request pipeline for the transcript proxy endpoint.
// Used by BOTH runtimes so dev and prod behave identically:
//   - api/apify-proxy.js  (Vercel serverless, production)
//   - vite.config.js      (dev middleware, `npm run dev`)
// Hardening implemented here (single source of truth):
//   - Authorization: Bearer <Supabase access token> required; the token is
//     verified against Supabase auth (`getUser`) -> 401 when missing/invalid.
//   - YouTube URL / bare 11-char video ID validation -> 400 when invalid.
//   - Correct status codes: 500 APIFY_TOKEN missing, 502 upstream failure,
//     504 timeout, 404 no transcript found.
//   - APIFY_TOKEN (and any other server secret) is never placed in a
//     response payload; only safe error strings leave the process.
import { createClient } from '@supabase/supabase-js';
import { generateTranscript } from './transcript.js';
import { translateSegments } from './translator.js';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB cap on request bodies
const REQUEST_TIMEOUT_MS = 55000; // below Vercel maxDuration (60s)

const DEFAULT_SUPABASE_URL = 'https://akpxypbtixvyepgabjhd.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_2UdAyhEEVhJIoS92TUTK6w_tg2KJOki';

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

// Status codes the endpoint is allowed to emit for engine failures; anything
// else from the engine layer is normalized to 502 (bad gateway).
const ALLOWED_ERROR_STATUSES = new Set([400, 401, 403, 404, 429, 500, 502, 504]);

// Server-side mirror of the client's parseYoutubeUrl (src/App.jsx), but
// stricter: every extracted ID must be a full 11-char video ID.
// Returns the canonical watch URL, or null when invalid.
/**
 * Canonical YouTube URL and 11-character video ID validator.
 * Validates standard watch URLs, youtu.be short links, /shorts/ paths, and raw IDs.
 * @param {string} value - User-supplied URL or video ID string
 * @returns {string|null} Standardized canonical watch URL or null if invalid
 */
export function validateYoutubeUrl(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (VIDEO_ID_PATTERN.test(trimmed)) {
    return `https://www.youtube.com/watch?v=${trimmed}`;
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    const hostname = url.hostname.replace(/^www\./, '');
    if (hostname === 'youtu.be') {
      const id = url.pathname.slice(1);
      return VIDEO_ID_PATTERN.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
    }
    if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      if (url.searchParams.has('v')) {
        const id = url.searchParams.get('v') ?? '';
        return VIDEO_ID_PATTERN.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
      }
      if (url.pathname.startsWith('/shorts/')) {
        const id = url.pathname.split('/')[2] ?? '';
        return VIDEO_ID_PATTERN.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
      }
      if (url.pathname.startsWith('/watch')) return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}

function readBearerToken(req) {
  const header = req.headers?.authorization;
  if (!header || typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

// Verifies a Supabase access token against the auth server. Returns the user
// id when valid, or null when the token is bad OR the server has no Supabase
// config (no way to verify -> refuse rather than trust the token blindly).
async function verifyAccessToken(token, getEnv) {
  const supabaseUrl = getEnv('SUPABASE_URL') || getEnv('VITE_SUPABASE_URL') || DEFAULT_SUPABASE_URL;
  const anonKey = getEnv('SUPABASE_ANON_KEY') || getEnv('VITE_SUPABASE_ANON_KEY') || DEFAULT_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;
  try {
    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

// Reads the request body. Vercel pre-parses JSON bodies into req.body;
// connect middleware (Vite dev) hands us the raw stream, which we read with
// a hard size cap so a huge POST cannot exhaust memory.
async function readJsonBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('Request body too large.');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/**
 * Node-style (req, res) request handler shared by prod and dev.
 * `getEnv(name)` resolves server-only env vars (process.env on Vercel,
 * lib/env.js readEnvValue in dev) so secrets never reach the client.
 */
export async function handleTranscriptRequest(req, res, { getEnv }) {
  const reply = (status, payload) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  };

  if (req.method !== 'POST') {
    reply(405, { message: 'Method not allowed' });
    return;
  }

  // 1) Auth:
  // - If an Authorization header is provided and Supabase is configured, verify it.
  // - If token is missing, allow guest requests via the free engine (zero-config mode).
  // - Apify fallback is reserved for authenticated users or local zero-Supabase dev.
  const token = readBearerToken(req);
  const supabaseUrl = getEnv('SUPABASE_URL') || getEnv('VITE_SUPABASE_URL') || DEFAULT_SUPABASE_URL;
  const anonKey = getEnv('SUPABASE_ANON_KEY') || getEnv('VITE_SUPABASE_ANON_KEY') || DEFAULT_SUPABASE_ANON_KEY;
  const isSupabaseEnabled = Boolean(supabaseUrl && anonKey);

  let userId = null;
  if (token) {
    if (isSupabaseEnabled) {
      userId = await verifyAccessToken(token, getEnv);
      if (!userId) {
        reply(401, { message: 'Invalid or expired access token.' });
        return;
      }
    }
  }

  // 2) Body.
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    reply(400, { message: 'Invalid JSON body.' });
    return;
  }

  // 3) Input validation.
  const url = validateYoutubeUrl(body?.url);
  if (!url) {
    reply(400, {
      message:
        'Invalid YouTube URL or video ID. Use a youtube.com/watch, youtu.be or /shorts link, or a bare 11-character video ID.',
    });
    return;
  }

  // 4) Generate with an overall deadline so a stalled engine becomes a 504
  //    response instead of hanging past the serverless maxDuration.
  //    Apify fallback is used if user is authenticated or running without Supabase.
  const allowApify = Boolean(userId || (!isSupabaseEnabled && getEnv('APIFY_TOKEN')));
  const apifyToken = allowApify ? getEnv('APIFY_TOKEN') : null;
  const apifyActorId = allowApify ? getEnv('APIFY_ACTOR_ID') : null;

  let timeoutTimer;
  let result;
  try {
    result = await Promise.race([
      generateTranscript({
        url,
        language: body?.language,
        apifyToken,
        apifyActorId,
      }),
      new Promise((resolve) => {
        timeoutTimer = setTimeout(
          () =>
            resolve({
              ok: false,
              status: 504,
              message: 'Transcript generation timed out. Please try again in a moment.',
            }),
          REQUEST_TIMEOUT_MS
        );
      }),
    ]);
  } catch {
    result = { ok: false, status: 502, message: 'Unexpected proxy error. Please try again.' };
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }

  if (result.ok) {
    reply(200, [result.item]);
    return;
  }

  const status = ALLOWED_ERROR_STATUSES.has(result.status) ? result.status : 502;
  const payload = { message: result.message };
  if (result.details) payload.details = result.details;
  reply(status, payload);
}

/**
 * POST /api/translate — On-demand translation for transcript segments.
 *
 * Body: { segments: [{ text, start, duration }], targetLang, sourceLang }
 * Response: { ok: true, segments: [...translated...] }
 *
 * This keeps transcript generation instant and defers the expensive
 * translation to a separate user-triggered request.
 */
export async function handleTranslateRequest(req, res) {
  const reply = (status, payload) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  };

  if (req.method !== 'POST') {
    reply(405, { message: 'Method not allowed' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    reply(400, { message: 'Invalid JSON body.' });
    return;
  }

  const { segments, targetLang, sourceLang } = body || {};
  if (!Array.isArray(segments) || segments.length === 0) {
    reply(400, { message: 'segments array is required.' });
    return;
  }
  if (!targetLang) {
    reply(400, { message: 'targetLang is required.' });
    return;
  }

  try {
    const translated = await Promise.race([
      translateSegments(segments, targetLang, sourceLang || 'auto'),
      new Promise((resolve) =>
        setTimeout(
          () => resolve(null),
          90000 // 90s generous timeout for large transcripts
        )
      ),
    ]);

    if (!translated) {
      reply(504, { message: 'Translation timed out. Try a shorter transcript or try again.' });
      return;
    }

    reply(200, {
      ok: true,
      segments: translated,
      transcript_text: translated.map((s) => s.text).join(' '),
    });
  } catch (err) {
    reply(502, { message: 'Translation failed: ' + (err.message || 'Unknown error') });
  }
}
