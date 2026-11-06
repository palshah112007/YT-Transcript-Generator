/**
 * Universal Multi-Language Translation Engine for TranscriptLab Studio.
 *
 * Strategy: Google Translate (free gtx endpoint) as primary, MyMemory as fallback.
 * Smart chunking merges segments to minimize API calls.
 * Controlled concurrency (max 3 parallel) to avoid rate limits.
 */

const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
const GOOGLE_URL = 'https://translate.googleapis.com/translate_a/single';
const MAX_CHUNK_CHARS = 450;
const MAX_CONCURRENT = 3;
const TIMEOUT_MS = 6000;

/**
 * Normalizes ISO language codes to the exact target dialect supported by translation engines.
 * @param {string} lang - Raw language code (e.g., 'zh', 'en', 'es')
 * @returns {string} Normalized code (e.g., 'zh-CN')
 */
function normalizeLang(lang) {
  if (!lang) return 'en';
  const l = lang.toLowerCase().trim();
  return l === 'zh' ? 'zh-CN' : l;
}

async function googleTranslate(text, tl, sl) {
  const body = new URLSearchParams({ client: 'gtx', sl, tl, dt: 't', q: text });
  const res = await fetch(GOOGLE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const out = data[0]?.map((s) => s[0]).join('');
  return out?.trim() || null;
}

async function mymemoryTranslate(text, tl, sl) {
  const langpair = `${sl === 'auto' ? 'autodetect' : sl}|${tl}`;
  const url = `${MYMEMORY_URL}?q=${encodeURIComponent(text.slice(0, 490))}&langpair=${encodeURIComponent(langpair)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;
  const data = await res.json();
  const t = data?.responseData?.translatedText;
  if (!t || t.includes('QUERY LENGTH LIMIT') || t.includes('MYMEMORY WARNING')) return null;
  return t.trim();
}

export async function translateSingle(text, targetLang, sourceLang = 'auto') {
  if (!text?.trim()) return text;
  const tl = normalizeLang(targetLang);
  const sl = sourceLang && sourceLang !== 'auto' ? normalizeLang(sourceLang) : 'auto';
  if (sl !== 'auto' && sl === tl) return text;

  try { const r = await googleTranslate(text, tl, sl); if (r) return r; } catch {}
  try { const r = await mymemoryTranslate(text, tl, sl); if (r) return r; } catch {}
  return text;
}

function cleanText(t) {
  // Caption events can contain embedded newlines; those would break the
  // one-line-per-segment alignment, so collapse all whitespace.
  return String(t || '').replace(/\s+/g, ' ').trim();
}

function buildChunks(segments) {
  const chunks = [];
  let items = [], len = 0;
  for (let i = 0; i < segments.length; i++) {
    const t = cleanText(segments[i].text);
    if (!t) continue;
    const add = len > 0 ? t.length + 1 : t.length;
    if (len + add > MAX_CHUNK_CHARS && items.length > 0) {
      chunks.push(items);
      items = [];
      len = 0;
    }
    items.push({ idx: i, text: t });
    len += len > 0 ? t.length + 1 : t.length;
  }
  if (items.length) chunks.push(items);
  return chunks;
}

async function parallelLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() { while (idx < tasks.length) { const i = idx++; results[i] = await tasks[i](); } }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

const DELIM = '\n___999___\n';
const DELIM_RE = /\s*_{2,}\s*999\s*_{2,}\s*/;

/**
 * Translates `lines` and returns an array of the same length. Entries are a
 * string, or null when that line could not be translated. Never returns a
 * misaligned array: if the engine merges/splits lines the batch is bisected
 * until each line is translated on its own.
 */
async function translateLines(lines, tl, sl) {
  if (lines.length === 1) {
    try { const r = await googleTranslate(lines[0], tl, sl); if (r) return [r]; } catch {}
    try { const r = await mymemoryTranslate(lines[0], tl, sl); if (r) return [r]; } catch {}
    return [null];
  }

  // 1) Newline-joined batch.
  try {
    const r = await googleTranslate(lines.join('\n'), tl, sl);
    if (r) {
      const parts = r.split('\n');
      if (parts.length === lines.length) return parts.map((x) => x.trim());
    }
  } catch {}

  // 2) Explicit-delimiter batch.
  try {
    const r = await googleTranslate(lines.join(DELIM), tl, sl);
    if (r) {
      const parts = r.split(DELIM_RE);
      if (parts.length === lines.length) return parts.map((x) => x.trim());
    }
  } catch {}

  // 3) Alignment lost (or engine failed): bisect, so we never mis-assign text.
  const mid = Math.ceil(lines.length / 2);
  const left = await translateLines(lines.slice(0, mid), tl, sl);
  const right = await translateLines(lines.slice(mid), tl, sl);
  return [...left, ...right];
}

const NOISE_RE = /^[\[(♪♫\s].*[\])♪♫\s]$/u; // [Music], (applause), ♪ ... ♪

function isTranslatable(text) {
  const letters = (text.match(/\p{L}/gu) || []).length;
  return letters >= 4 && !NOISE_RE.test(text);
}

/**
 * Translates transcript segments and reports how much of it really changed.
 * Returns { segments, stats: { total, translated, failed, ratio, skipped } }.
 *  - total      segments that are real speech (letters, not [Music] tags)
 *  - translated segments whose text was changed by the engine
 *  - failed     segments left identical to the source (engine failed / returned input)
 *  - ratio      translated / total  (1 when there is nothing to translate)
 */
export async function translateSegmentsDetailed(segments, targetLang = 'en', sourceLang = 'auto') {
  const emptyStats = { total: 0, translated: 0, failed: 0, ratio: 1, skipped: true };
  if (!Array.isArray(segments) || !segments.length) return { segments, stats: emptyStats };
  if (!targetLang || targetLang === 'auto') return { segments, stats: emptyStats };
  const tl = normalizeLang(targetLang);
  const sl = sourceLang && sourceLang !== 'auto' ? normalizeLang(sourceLang) : 'auto';
  if (sl !== 'auto' && sl.split('-')[0] === tl.split('-')[0]) return { segments, stats: emptyStats };

  const chunks = buildChunks(segments);
  const tasks = chunks.map((items) => () => translateLines(items.map((i) => i.text), tl, sl));
  const chunkResults = await parallelLimit(tasks, MAX_CONCURRENT);

  const result = segments.map((s) => ({ ...s, text: cleanText(s.text) }));
  let total = 0, translated = 0;
  chunks.forEach((items, c) => {
    items.forEach((item, k) => {
      const out = (chunkResults[c]?.[k] || '').trim();
      const countable = isTranslatable(item.text);
      if (countable) total++;
      if (!out) return; // keep source text for this line
      result[item.idx] = { ...segments[item.idx], text: out };
      if (countable && out.toLowerCase() !== item.text.toLowerCase()) translated++;
    });
  });

  return {
    segments: result,
    stats: {
      total,
      translated,
      failed: total - translated,
      ratio: total === 0 ? 1 : translated / total,
      skipped: false,
    },
  };
}

// Back-compat wrapper: returns only the segments array.
export async function translateSegments(segments, targetLang = 'en', sourceLang = 'auto') {
  return (await translateSegmentsDetailed(segments, targetLang, sourceLang)).segments;
}
