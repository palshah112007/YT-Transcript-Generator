import { describe, expect, it } from 'vitest';
import { detectLanguage, verifyLanguage } from '../lib/lang-check.js';
import { SAMPLES } from './fixtures/samples.js';


describe('lang-check', () => {
  it.each(Object.keys(SAMPLES))('detects %s', (lang) => {
    expect(detectLanguage(SAMPLES[lang]).lang).toBe(lang);
    expect(verifyLanguage(SAMPLES[lang], lang).ok).toBe(true);
  });

  it('flags a mismatch (Spanish text claimed to be Hindi / English)', () => {
    expect(verifyLanguage(SAMPLES.es, 'hi').ok).toBe(false);
    expect(verifyLanguage(SAMPLES.es, 'en').ok).toBe(false);
    expect(verifyLanguage(SAMPLES.en, 'fr').ok).toBe(false);
  });

  it('flags Japanese vs Chinese correctly', () => {
    expect(verifyLanguage(SAMPLES.ja, 'zh').ok).toBe(false);
    expect(verifyLanguage(SAMPLES.zh, 'ja').ok).toBe(false);
  });

  it('returns unknown for empty / tiny text', () => {
    expect(detectLanguage('').lang).toBe('unknown');
    expect(verifyLanguage('ok', 'en').ok).toBe(false);
  });
});
