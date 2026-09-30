// Local (browser) transcript history for guest mode.
// The Supabase table remains the source of truth for logged-in users; this
// store keeps the last 20 transcripts per browser so history, reload
// persistence, and the credits counter work without any backend.
const KEY = 'transcriptlab:history';
const MAX_ITEMS = 20;

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or unavailable (private mode) — history is best-effort.
  }
}

export function getLocalHistory() {
  return readAll();
}

export function saveLocalHistoryEntry(entry) {
  const items = readAll().filter((item) => item.id !== entry.id);
  items.unshift(entry);
  writeAll(items.slice(0, MAX_ITEMS));
}

export function clearLocalHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function makeLocalEntry({ url, title, transcriptText, language, item }) {
  return {
    id: `local-${Date.now()}`,
    user_id: null,
    youtube_url: url,
    title,
    transcript_text: transcriptText,
    language,
    metadata: item ?? null,
    credits_used: 1,
    created_at: new Date().toISOString(),
    _local: true,
  };
}
