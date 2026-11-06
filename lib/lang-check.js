// Lightweight offline language verifier for the 14 languages the app offers.
// Used (a) by /api/translate to report whether output really is in the
// requested language and (b) by scripts/verify-languages.mjs.
//
// Non-Latin languages are checked by Unicode script share; Latin-script
// languages by stop-word frequency. It is a heuristic for whole transcripts
// (dozens+ of words), not for single words.

const SCRIPT_RE = {
  hi: /[\u0900-\u097F]/gu,
  ko: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/gu,
  ru: /[\u0400-\u04FF]/gu,
  ar: /[\u0600-\u06FF\u0750-\u077F]/gu,
  kana: /[\u3040-\u30FF]/gu,
  han: /[\u3400-\u4DBF\u4E00-\u9FFF]/gu,
  latin: /[A-Za-z\u00C0-\u024F]/gu,
};

const STOPWORDS = {
  en: 'the and is are was were of to in that it for you this with on not have be as at but they we what your can will from or by an so if my all one there their about just like out when which would how',
  es: 'el la los las de que y en un una es por con para no se su al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos mi estoy tiene',
  fr: 'le la les des du de et en un une est que qui dans pour pas sur au avec ce il elle nous vous ils sont ne se plus par mais ou comme je tu mon ma tout très être avoir fait cette ces aux leur',
  de: 'der die das und ist nicht ein eine zu den dem mit sich auf für von es im auch auf dass sie wir ich er aber wie noch nach bei oder wenn nur um aus über so hat sind wird kann werden schon dann',
  pt: 'o a os as de que e em um uma é para com não se por mais mas como foi ao ele ela seu sua ou já você eu nós isso esta este muito também tem são na no nos das dos quando até pelo pela',
  it: 'il lo la i gli le di che e in un una è per con non si da come ma più al del della dei delle sono questo questa anche ho hai ha noi voi loro suo sua molto quando perché se tutto nel nella',
  nl: 'de het een en van ik te dat die in is niet op aan met als voor had er maar om hem dan zou of wat mijn men dit zo ze zich bij ook tot je mij uit der haar naar heb hoe nog wel dus',
  tr: 'bir bu ve de da için ile ne ama çok daha gibi ben sen o biz siz onlar var yok mi mu değil en kadar sonra ya ki her şey olarak olan ise bunu şu çünkü hem ancak bana sana',
};

const STOP_SETS = Object.fromEntries(
  Object.entries(STOPWORDS).map(([lang, words]) => [lang, new Set(words.split(/\s+/))])
);

function count(text, re) {
  return (text.match(re) || []).length;
}

function latinScores(text) {
  const tokens = (text.toLowerCase().match(/\p{L}+/gu) || []);
  const scores = {};
  for (const [lang, set] of Object.entries(STOP_SETS)) {
    let hits = 0;
    for (const t of tokens) if (set.has(t)) hits++;
    scores[lang] = tokens.length ? hits / tokens.length : 0;
  }
  return { scores, tokens: tokens.length };
}

/**
 * Best-guess language of `text` among the app's 14 languages.
 * Returns { lang, confidence (0..1), scores? } — lang is 'unknown' for very short / symbol-only text.
 */
export function detectLanguage(text) {
  const t = String(text || '');
  const kana = count(t, SCRIPT_RE.kana);
  const han = count(t, SCRIPT_RE.han);
  const hi = count(t, SCRIPT_RE.hi);
  const ko = count(t, SCRIPT_RE.ko);
  const ru = count(t, SCRIPT_RE.ru);
  const ar = count(t, SCRIPT_RE.ar);
  const latin = count(t, SCRIPT_RE.latin);
  const letters = kana + han + hi + ko + ru + ar + latin;
  if (letters < 5) return { lang: 'unknown', confidence: 0 };

  const shares = [
    ['hi', hi], ['ko', ko], ['ru', ru], ['ar', ar],
    ['ja', kana + (kana > 0 ? han : 0)],
    ['zh', kana === 0 ? han : 0],
  ];
  const [topScriptLang, topScriptCount] = shares.sort((a, b) => b[1] - a[1])[0];
  if (topScriptCount / letters >= 0.5) {
    return { lang: topScriptLang, confidence: topScriptCount / letters };
  }

  const { scores, tokens } = latinScores(t);
  if (tokens < 5) return { lang: 'unknown', confidence: 0 };
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestLang, bestScore] = ranked[0];
  const second = ranked[1][1];
  if (bestScore < 0.03) return { lang: 'unknown', confidence: 0, scores };
  // Confidence = how clearly the winner beats the runner-up.
  return { lang: bestLang, confidence: Math.min(1, (bestScore - second) / Math.max(bestScore, 0.001)), scores };
}

/**
 * Does `text` look like it is written in `lang`?
 * Returns { ok, detected, confidence, reason }.
 */
export function verifyLanguage(text, lang) {
  const expected = String(lang || '').toLowerCase().split('-')[0];
  const det = detectLanguage(text);
  if (det.lang === 'unknown') {
    return { ok: false, detected: 'unknown', confidence: 0, reason: 'Text too short or has no recognisable letters.' };
  }
  const ok = det.lang === expected;
  return {
    ok,
    detected: det.lang,
    confidence: Number(det.confidence.toFixed(2)),
    reason: ok ? 'Matches requested language.' : `Text looks like "${det.lang}", requested "${expected}".`,
  };
}
