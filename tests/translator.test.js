// Translator regression tests. Google/MyMemory are mocked so these run offline.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateSegments, translateSegmentsDetailed } from '../lib/translator.js';
import { handleTranslateRequest } from '../lib/proxy-handler.js';

const SEGS = Array.from({ length: 12 }, (_, i) => ({
  text: `This is sentence number ${i + 1} of the video`,
  start: i * 3,
  duration: 3,
}));

// Fake gtx endpoint. `mode` controls how badly it misbehaves.
function mockGoogle(mode) {
  global.fetch = vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes('translate.googleapis.com')) {
      if (mode === 'down') return { ok: false, json: async () => ({}) };
      const q = new URLSearchParams(init.body).get('q');
      const tl = new URLSearchParams(init.body).get('tl');
      let out;
      if (mode === 'merge-lines' && q.includes('\n')) {
        // Real-world failure: the engine merges lines / eats the delimiter.
        out = `[${tl}] ` + q.replace(/\n(___999___\n)?/g, ' ');
      } else {
        out = q.split('\n').map((l) => (/^_+999_+$/.test(l) ? l : `[${tl}] ${l}`)).join('\n');
      }
      return { ok: true, json: async () => [[[out, q]]] };
    }
    return { ok: false, json: async () => ({}) }; // MyMemory unreachable
  });
}

afterEach(() => vi.restoreAllMocks());

describe('translateSegments', () => {
  it('translates every segment even when the engine merges lines', async () => {
    mockGoogle('merge-lines');
    const out = await translateSegments(SEGS, 'es', 'en');
    expect(out).toHaveLength(SEGS.length);
    out.forEach((s, i) => {
      expect(s.text.startsWith('[es] ')).toBe(true);
      expect(s.text).toContain(`number ${i + 1} of`);
      expect(s.start).toBe(SEGS[i].start);
    });
  });

  it('keeps segments aligned when a caption contains an embedded newline', async () => {
    mockGoogle('ok');
    const segs = [
      { text: 'first line\nsecond line of caption', start: 0 },
      { text: 'another caption here', start: 4 },
    ];
    const out = await translateSegments(segs, 'fr', 'en');
    expect(out[0].text).toBe('[fr] first line second line of caption');
    expect(out[1].text).toBe('[fr] another caption here');
  });

  it('reports failure (ratio 0) instead of silently returning source text', async () => {
    mockGoogle('down');
    const { stats, segments } = await translateSegmentsDetailed(SEGS, 'de', 'en');
    expect(stats.ratio).toBe(0);
    expect(stats.failed).toBe(SEGS.length);
    expect(segments[0].text).toBe(SEGS[0].text); // source kept, but flagged
  });

  it('skips work when source and target language are the same', async () => {
    mockGoogle('ok');
    const { stats } = await translateSegmentsDetailed(SEGS, 'en', 'en');
    expect(stats.skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

function callTranslate(body) {
  return new Promise((resolve) => {
    const req = { method: 'POST', body, headers: {} };
    const res = {
      statusCode: 0,
      setHeader() {},
      end(payload) { resolve({ status: res.statusCode, json: JSON.parse(payload) }); },
    };
    handleTranslateRequest(req, res);
  });
}

describe('POST /api/translate', () => {
  it('returns 200 with stats + verification when translation worked', async () => {
    mockGoogle('ok');
    const { status, json } = await callTranslate({ segments: SEGS, targetLang: 'es', sourceLang: 'en' });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.stats.ratio).toBe(1);
    expect(json.verification).toBeTruthy();
  });

  it('returns 502 (not ok:true) when the engine could not translate', async () => {
    mockGoogle('down');
    const { status, json } = await callTranslate({ segments: SEGS, targetLang: 'es', sourceLang: 'en' });
    expect(status).toBe(502);
    expect(json.ok).toBeUndefined();
    expect(json.message).toMatch(/failed/i);
  });
});
