import { describe, expect, it } from 'vitest';
import { verifyAll, ALL_LANGS } from '../scripts/verify-languages.mjs';
import { SAMPLES } from './fixtures/samples.js';

const original = {
  title: 'Demo',
  language: 'en',
  segments: [{ text: SAMPLES.en, start: 0 }, { text: SAMPLES.en, start: 5 }],
};

describe('verify-languages harness', () => {
  it('PASSes a correct translator for all 14 languages', async () => {
    const translate = async (segs, lang) => ({
      segments: segs.map((s) => ({ ...s, text: SAMPLES[lang] })),
      stats: { ratio: 1 },
    });
    const { rows } = await verifyAll({ getOriginal: async () => original, translate });
    expect(rows).toHaveLength(Object.keys(ALL_LANGS).length);
    expect(rows.filter((r) => r.status !== 'PASS')).toEqual([]);
  });

  it('FAILs languages where output is in the wrong language (the reported bug)', async () => {
    // Broken translator: Hindi and English ok, everything else returns Spanish.
    const translate = async (segs, lang) => ({
      segments: segs.map((s) => ({ ...s, text: lang === 'hi' ? SAMPLES.hi : SAMPLES.es })),
      stats: { ratio: 1 },
    });
    const { rows } = await verifyAll({ getOriginal: async () => original, translate });
    const byLang = Object.fromEntries(rows.map((r) => [r.lang, r]));
    expect(byLang.en.status).toBe('PASS'); // original language
    expect(byLang.hi.status).toBe('PASS');
    expect(byLang.es.status).toBe('PASS'); // Spanish output is correct for 'es'
    for (const l of ['fr', 'de', 'ja', 'ru', 'ar']) {
      expect(byLang[l].status).toBe('FAIL');
      expect(byLang[l].note).toMatch(/looks like/);
    }
  });

  it('FAILs when the translator silently returns the untranslated source', async () => {
    const translate = async (segs) => ({ segments: segs, stats: { ratio: 1 } });
    const { rows } = await verifyAll({ getOriginal: async () => original, translate, langs: ['es', 'hi'] });
    expect(rows.every((r) => r.status === 'FAIL')).toBe(true);
  });
});
