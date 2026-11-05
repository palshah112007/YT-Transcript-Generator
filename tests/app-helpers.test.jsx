import { describe, expect, it } from 'vitest';
import {
  calculateTranscriptStats,
  extractVideoId,
  formatSrtTimestamp,
  formatTimestamp,
  formatTranscriptAsSRT,
  formatTranscriptWithTimestamps,
  mapLoginError,
  mapSignupError,
  parseYoutubeUrl,
  transcriptTextFromItem,
  validateSignupFields,
} from '../src/App.jsx';
import {
  clearLocalHistory,
  deleteLocalHistoryEntry,
  getLocalHistory,
  makeLocalEntry,
  saveLocalHistoryEntry,
} from '../src/lib/localHistory.js';

// --- parseYoutubeUrl ------------------------------------------------------

describe('parseYoutubeUrl', () => {
  it('accepts a bare 11-char video ID', () => {
    expect(parseYoutubeUrl('dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
  });

  it('rejects an ID that is not exactly 11 chars', () => {
    expect(parseYoutubeUrl('shortid123')).toBeNull();
    expect(parseYoutubeUrl('dQw4w9WgXcQQ')).toBeNull();
  });

  it('parses youtube.com/watch?v= links', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
  });

  it('parses youtu.be short links', () => {
    expect(parseYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
  });

  it('parses /shorts/ links', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
  });

  it('adds a protocol when missing', () => {
    expect(parseYoutubeUrl('youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
  });

  it('rejects non-YouTube hosts', () => {
    expect(parseYoutubeUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('rejects empty, missing, and garbage input', () => {
    expect(parseYoutubeUrl('')).toBeNull();
    expect(parseYoutubeUrl(null)).toBeNull();
    expect(parseYoutubeUrl(undefined)).toBeNull();
    expect(parseYoutubeUrl('not a url !!!')).toBeNull();
  });
});

// --- validateSignupFields -------------------------------------------------

describe('validateSignupFields', () => {
  it('accepts a valid email and 6+ char password', () => {
    expect(validateSignupFields('you@example.com', 'hunter2')).toBe('');
  });

  it('rejects an invalid email', () => {
    expect(validateSignupFields('not-an-email', 'hunter2')).toMatch(/valid email/i);
    expect(validateSignupFields('a@b', 'hunter2')).toMatch(/valid email/i);
    expect(validateSignupFields('', 'hunter2')).toMatch(/valid email/i);
  });

  it('rejects a short password (min 6 chars)', () => {
    expect(validateSignupFields('you@example.com', '12345')).toMatch(/at least 6/i);
  });

  it('accepts exactly 6 chars', () => {
    expect(validateSignupFields('you@example.com', '123456')).toBe('');
  });
});

// --- mapSignupError / mapLoginError ---------------------------------------

describe('mapSignupError', () => {
  it('maps user_already_exists by code and by message', () => {
    expect(mapSignupError({ code: 'user_already_exists' })).toMatch(/already exists/i);
    expect(mapSignupError({ message: 'User already registered' })).toMatch(
      /already exists/i
    );
  });

  it('maps weak_password', () => {
    expect(mapSignupError({ code: 'weak_password' })).toMatch(/too weak/i);
    expect(mapSignupError({ message: 'Password should be at least 6 characters.' })).toMatch(
      /too weak/i
    );
  });

  it('maps invalid email', () => {
    expect(mapSignupError({ code: 'validation_failed' })).toMatch(/invalid/i);
    expect(mapSignupError({ message: 'Unable to validate email address' })).toMatch(
      /invalid/i
    );
  });

  it('maps network errors', () => {
    expect(mapSignupError({ message: 'Failed to fetch' })).toMatch(/cannot reach/i);
  });

  it('never returns the raw error message', () => {
    const raw = 'Internal server error XYZ-private-detail';
    expect(mapSignupError({ message: raw })).not.toContain(raw);
  });
});

describe('mapLoginError', () => {
  it('maps invalid credentials distinctly', () => {
    const msg = mapLoginError({ code: 'invalid_credentials', message: 'Invalid login credentials' });
    expect(msg).toMatch(/incorrect email or password/i);
  });

  it('maps email not confirmed distinctly', () => {
    const msg = mapLoginError({ code: 'email_not_confirmed', message: 'Email not confirmed' });
    expect(msg).toMatch(/confirm your email/i);
  });

  it('gives different messages for the two cases', () => {
    expect(mapLoginError({ code: 'invalid_credentials' })).not.toBe(
      mapLoginError({ code: 'email_not_confirmed' })
    );
  });

  it('maps network errors', () => {
    expect(mapLoginError({ message: 'Failed to fetch' })).toMatch(/cannot reach/i);
  });

  it('never returns the raw error message', () => {
    const raw = 'some leaked internal detail';
    expect(mapLoginError({ message: raw })).not.toContain(raw);
  });
});

// --- transcript helpers ---------------------------------------------------

const SEGMENTS = [
  { text: 'Hello', start: 0 },
  { text: 'world', start: 62 },
];

describe('transcriptTextFromItem', () => {
  it('prefers transcript_text', () => {
    expect(transcriptTextFromItem({ transcript_text: 'plain' })).toBe('plain');
  });

  it('joins transcript segments', () => {
    expect(transcriptTextFromItem({ transcript: SEGMENTS })).toBe('Hello world');
  });

  it('returns empty for null/unknown shapes', () => {
    expect(transcriptTextFromItem(null)).toBe('');
    expect(transcriptTextFromItem({})).toBe('');
  });
});

describe('formatTimestamp / formatTranscriptWithTimestamps', () => {
  it('formats m:ss', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(62)).toBe('1:02');
  });

  it('prefixes each segment with its timestamp', () => {
    const out = formatTranscriptWithTimestamps({ transcript: SEGMENTS });
    expect(out).toContain('[0:00] Hello');
    expect(out).toContain('[1:02] world');
  });

  it('falls back to plain text when no segments exist', () => {
    expect(formatTranscriptWithTimestamps({ transcript_text: 'plain' })).toBe('plain');
  });
});

// --- extractVideoId --------------------------------------------------------

describe('extractVideoId', () => {
  it('extracts bare 11-char ID', () => {
    expect(extractVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from watch URL', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('youtube.com/watch?v=dQw4w9WgXcQ&t=10s')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from youtu.be short link', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from /shorts/ link', () => {
    expect(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for invalid inputs', () => {
    expect(extractVideoId('')).toBeNull();
    expect(extractVideoId('invalid-id')).toBeNull();
    expect(extractVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
});

// --- formatSrtTimestamp & formatTranscriptAsSRT ---------------------------

describe('formatSrtTimestamp', () => {
  it('formats zero seconds', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
  });

  it('formats seconds with milliseconds', () => {
    expect(formatSrtTimestamp(62.5)).toBe('00:01:02,500');
    expect(formatSrtTimestamp(3665.123)).toBe('01:01:05,123');
  });
});

describe('formatTranscriptAsSRT', () => {
  it('converts segments to SRT format with index and timing blocks', () => {
    const srt = formatTranscriptAsSRT({ transcript: SEGMENTS });
    expect(srt).toContain('1\n00:00:00,000 --> 00:01:02,000\nHello');
    expect(srt).toContain('2\n00:01:02,000 --> 00:01:05,000\nworld');
  });

  it('falls back to single SRT block for raw text without segments', () => {
    const srt = formatTranscriptAsSRT({ transcript_text: 'Fallback raw subtitle' });
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:05,000\nFallback raw subtitle');
  });

  it('returns empty string for null item', () => {
    expect(formatTranscriptAsSRT(null)).toBe('');
  });
});

// --- calculateTranscriptStats ---------------------------------------------

describe('calculateTranscriptStats', () => {
  it('calculates word count, char count, and estimated reading time', () => {
    const text = 'This is a test transcript with eight words.';
    const stats = calculateTranscriptStats(text, { transcript: SEGMENTS });
    expect(stats.wordCount).toBe(8);
    expect(stats.charCount).toBe(text.length);
    expect(stats.readingTimeStr).toBe('1 min read');
    expect(stats.durationStr).toBe('1:04');
  });

  it('handles empty text gracefully', () => {
    const stats = calculateTranscriptStats('', null);
    expect(stats.wordCount).toBe(0);
    expect(stats.charCount).toBe(0);
    expect(stats.readingTimeStr).toBe('1 min read');
    expect(stats.durationStr).toBeNull();
  });
});

// --- localHistory helpers -------------------------------------------------

describe('localHistory module', () => {
  it('saves, retrieves, and deletes local history entries', () => {
    clearLocalHistory();
    expect(getLocalHistory()).toEqual([]);

    const entry1 = makeLocalEntry({
      url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley',
      transcriptText: 'Never gonna give you up',
      language: 'en',
    });
    const entry2 = makeLocalEntry({
      url: 'https://youtube.com/watch?v=abcdefghijk',
      title: 'Another Video',
      transcriptText: 'Second transcript',
      language: 'es',
    });

    saveLocalHistoryEntry(entry1);
    saveLocalHistoryEntry(entry2);

    let history = getLocalHistory();
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe(entry2.id); // unshifted to top

    deleteLocalHistoryEntry(entry1.id);
    history = getLocalHistory();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(entry2.id);

    clearLocalHistory();
    expect(getLocalHistory()).toEqual([]);
  });
});
