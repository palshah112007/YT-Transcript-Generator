import { describe, expect, it, vi } from 'vitest';
import { handleTranscriptRequest, validateYoutubeUrl } from '../lib/proxy-handler.js';

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, val) {
      res.headers[name] = val;
    },
    end(data) {
      res.body = data;
    },
  };
  return res;
}

describe('validateYoutubeUrl', () => {
  it('validates 11-char bare ID', () => {
    expect(validateYoutubeUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('validates youtu.be link', () => {
    expect(validateYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
  });

  it('validates /shorts/ link', () => {
    expect(validateYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
  });

  it('rejects invalid urls', () => {
    expect(validateYoutubeUrl('not-valid')).toBeNull();
    expect(validateYoutubeUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
});

describe('handleTranscriptRequest proxy endpoint', () => {
  it('returns 405 for non-POST method', async () => {
    const req = { method: 'GET' };
    const res = createMockRes();
    await handleTranscriptRequest(req, res, { getEnv: () => undefined });
    expect(res.statusCode).toBe(405);
    expect(JSON.parse(res.body)).toEqual({ message: 'Method not allowed' });
  });

  it('returns 400 for invalid YouTube URL', async () => {
    const req = {
      method: 'POST',
      body: { url: 'not-a-youtube-url' },
    };
    const res = createMockRes();
    await handleTranscriptRequest(req, res, { getEnv: () => undefined });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/Invalid YouTube URL/i);
  });

  it('returns 401 if invalid Bearer token is provided when Supabase is configured', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Invalid token' }),
    });

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer invalid-token' },
      body: { url: 'https://youtube.com/watch?v=dQw4w9WgXcQ' },
    };
    const res = createMockRes();
    const getEnv = (k) => {
      if (k === 'VITE_SUPABASE_URL') return 'https://test.supabase.co';
      if (k === 'VITE_SUPABASE_ANON_KEY') return 'anon-key-test';
      return undefined;
    };
    try {
      await handleTranscriptRequest(req, res, { getEnv });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).message).toMatch(/Invalid or expired/i);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
