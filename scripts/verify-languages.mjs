#!/usr/bin/env node
// End-to-end language check: for one YouTube video, generate the transcript,
// then translate it into every language in the app's "Translate to" menu and
// verify that the output is REALLY in the chosen language.
//
//   node scripts/verify-languages.mjs [youtubeUrl] [--base http://localhost:5173] [--langs hi,es,ja]
//
// Default mode calls the engines directly (needs internet: YouTube + Google Translate).
// With --base it goes through the running app's HTTP endpoints
// (/api/apify-proxy and /api/translate), i.e. the exact path the UI uses
// (start it with `npm run dev`, or point --base at your Vercel URL).
//
// Exit code 0 = every language PASS, 1 = at least one FAIL. A markdown report
// is written to verify-report.md.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { detectLanguage, verifyLanguage } from '../lib/lang-check.js';

export const ALL_LANGS = {
  en: 'English', hi: 'Hindi', es: 'Spanish', fr: 'French', de: 'German',
  ja: 'Japanese', ru: 'Russian', ar: 'Arabic',
};
const DEFAULT_URL = 'https://youtu.be/n7lRyI_mQfM';
const MIN_RATIO = 0.6;

const textOf = (segs) => segs.map((s) => s.text).join(' ');

/**
 * Core checker (I/O injected so it is unit-testable).
 * getOriginal(): -> { segments, language, title }
 * translate(segments, targetLang, sourceLang): -> { segments, stats? }
 */
export async function verifyAll({ getOriginal, translate, langs = Object.keys(ALL_LANGS), pauseMs = 0, log = () => {} }) {
  const original = await getOriginal();
  const origText = textOf(original.segments);
  const origDet = detectLanguage(origText);
  const origCode = (original.language || origDet.lang || 'auto').toLowerCase().split('-')[0];
  const rows = [];

  for (const lang of langs) {
    const row = { lang, name: ALL_LANGS[lang] || lang, status: 'FAIL', detected: '-', ratio: null, note: '', sample: '' };
    try {
      let segs;
      if (lang === origCode) {
        // Choosing the video's own language must give the original text back.
        segs = original.segments;
        row.note = 'original language (no translation needed)';
      } else {
        const out = await translate(original.segments, lang, origCode);
        segs = out.segments;
        row.ratio = out.stats ? out.stats.ratio : null;
      }
      const text = textOf(segs);
      const v = verifyLanguage(text, lang);
      row.detected = v.detected;
      row.sample = text.slice(0, 70).replace(/\s+/g, ' ');

      const problems = [];
      if (!v.ok) problems.push(`output looks like "${v.detected}", not "${lang}"`);
      if (segs.length !== original.segments.length) problems.push(`segment count ${segs.length} != ${original.segments.length}`);
      else if (segs.some((s, i) => s.start !== original.segments[i].start)) problems.push('timestamps changed');
      if (lang !== origCode && text.trim() === origText.trim()) problems.push('text identical to original');
      if (row.ratio !== null && row.ratio < MIN_RATIO) problems.push(`only ${Math.round(row.ratio * 100)}% translated`);

      row.status = problems.length ? 'FAIL' : 'PASS';
      if (problems.length) row.note = problems.join('; ');
    } catch (err) {
      row.note = `error: ${err.message}`;
    }
    rows.push(row);
    log(row);
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return { original: { title: original.title, language: origCode, detected: origDet.lang, segments: original.segments.length }, rows };
}

export function renderReport(url, result) {
  const pass = result.rows.filter((r) => r.status === 'PASS').length;
  const lines = [
    `# Language verification — ${url}`,
    '',
    `Video: ${result.original.title || '?'} · original language: **${result.original.language}** (detected: ${result.original.detected}) · ${result.original.segments} segments`,
    '',
    `**${pass}/${result.rows.length} languages PASS**`,
    '',
    '| Chosen | Result | Detected in output | Translated | Note | Output starts with |',
    '|---|---|---|---|---|---|',
    ...result.rows.map((r) =>
      `| ${r.name} (${r.lang}) | ${r.status} | ${r.detected} | ${r.ratio === null ? '-' : Math.round(r.ratio * 100) + '%'} | ${r.note || ''} | ${r.sample.replace(/\|/g, '/')} |`
    ),
  ];
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- CLI ----
async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const url = args.find((a) => /^https?:\/\//.test(a) && a !== flag('--base')) || DEFAULT_URL;
  const base = flag('--base')?.replace(/\/$/, '');
  const langs = flag('--langs')?.split(',').map((s) => s.trim()).filter(Boolean);

  let getOriginal, translate;
  if (base) {
    getOriginal = async () => {
      const r = await fetch(`${base}/api/apify-proxy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, language: 'auto' }),
      });
      if (!r.ok) throw new Error(`apify-proxy ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const item = (await r.json())[0];
      return { segments: item.transcript, language: item.detected_language || item.language, title: item.title };
    };
    translate = async (segments, targetLang, sourceLang) => {
      const r = await fetch(`${base}/api/translate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments, targetLang, sourceLang }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.message || `translate ${r.status}`);
      return { segments: j.segments, stats: j.stats };
    };
  } else {
    const { generateTranscript } = await import('../lib/transcript.js');
    const { translateSegmentsDetailed } = await import('../lib/translator.js');
    getOriginal = async () => {
      const r = await generateTranscript({ url, language: 'auto' });
      if (!r.ok) throw new Error(r.message);
      return { segments: r.item.transcript, language: r.item.detected_language, title: r.item.title };
    };
    translate = (segments, targetLang, sourceLang) => translateSegmentsDetailed(segments, targetLang, sourceLang);
  }

  console.log(`Verifying ${url} ${base ? `via ${base}` : '(direct engines)'}\n`);
  const result = await verifyAll({
    getOriginal, translate, langs, pauseMs: 500,
    log: (r) => console.log(`${r.status === 'PASS' ? '✅' : '❌'} ${r.name.padEnd(11)} detected=${String(r.detected).padEnd(8)} ${r.ratio === null ? '' : Math.round(r.ratio * 100) + '% '}${r.note}`),
  });
  writeFileSync('verify-report.md', renderReport(url, result));
  const failed = result.rows.filter((r) => r.status !== 'PASS').length;
  console.log(`\n${result.rows.length - failed}/${result.rows.length} PASS — report: verify-report.md`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
