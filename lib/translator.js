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

function buildChunks(segments) {
  const chunks = [];
  let texts = [], len = 0, start = 0;
  for (let i = 0; i < segments.length; i++) {
    const t = (segments[i].text || '').trim();
    if (!t) continue;
    const add = len > 0 ? t.length + 1 : t.length;
    if (len + add > MAX_CHUNK_CHARS && texts.length > 0) {
      chunks.push({ startIdx: start, count: texts.length, text: texts.join('\n') });
      texts = [t]; len = t.length; start = i;
    } else {
      texts.push(t); len += add;
    }
  }
  if (texts.length) chunks.push({ startIdx: start, count: texts.length, text: texts.join('\n') });
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
const DELIM_RE = /\s*_{2,}999_{2,}\s*/;

export async function translateSegments(segments, targetLang = 'en', sourceLang = 'auto') {
  if (!Array.isArray(segments) || !segments.length) return segments;
  if (!targetLang || targetLang === 'auto') return segments;
  const tl = normalizeLang(targetLang);
  const sl = sourceLang && sourceLang !== 'auto' ? normalizeLang(sourceLang) : 'auto';
  if (sl !== 'auto' && sl === tl) return segments;

  const chunks = buildChunks(segments);

  const tasks = chunks.map((chunk) => async () => {
    const origLines = chunk.text.split('\n');

    // Try Google with delimiter-joined text for accurate split
    try {
      const joined = origLines.join(DELIM);
      const r = await googleTranslate(joined, tl, sl);
      if (r) {
        const parts = r.split(DELIM_RE);
        if (parts.length === origLines.length) return parts.map(s => s.trim());
        // Fallback: split by newlines
        const nlParts = r.split('\n');
        if (nlParts.length === origLines.length) return nlParts.map(s => s.trim());
      }
    } catch {}

    // Try Google with newline join
    try {
      const r = await googleTranslate(chunk.text, tl, sl);
      if (r) {
        const parts = r.split('\n');
        if (parts.length === origLines.length) return parts.map(s => s.trim());
      }
    } catch {}

    // MyMemory fallback
    try {
      const r = await mymemoryTranslate(chunk.text, tl, sl);
      if (r) {
        const parts = r.split('\n');
        if (parts.length === origLines.length) return parts.map(s => s.trim());
      }
    } catch {}

    return origLines; // untranslated fallback
  });

  const chunkResults = await parallelLimit(tasks, MAX_CONCURRENT);

  const result = [...segments];
  for (let c = 0; c < chunks.length; c++) {
    const lines = chunkResults[c] || [];
    const origLines = chunks[c].text.split('\n');
    let lineIdx = 0;
    for (let s = chunks[c].startIdx; lineIdx < origLines.length && s < segments.length; s++) {
      if (!(segments[s].text || '').trim()) continue;
      result[s] = { ...segments[s], text: (lines[lineIdx] || '').trim() || segments[s].text };
      lineIdx++;
    }
  }
  return result;
}
