// UI regression tests for the "Translate to" dropdown: the text on screen must
// always match the language shown in the dropdown, and every translation must
// start from the ORIGINAL transcript (never from a previous translation).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';

vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: null,
  isSupabaseConfigured: false,
  missingSupabaseEnvVars: [],
  pingSupabase: vi.fn().mockResolvedValue('unconfigured'),
}));

import App from '../src/App.jsx';

const ORIGINAL = [
  { text: 'Hello everyone welcome', start: 0, duration: 2 },
  { text: 'to this short video', start: 2, duration: 2 },
];
let translateCalls;
let failLang;

beforeEach(() => {
  translateCalls = [];
  failLang = null;
  global.fetch = vi.fn(async (url, init) => {
    if (String(url).includes('/api/apify-proxy')) {
      return {
        ok: true,
        json: async () => [
          {
            title: 'T',
            transcript_text: ORIGINAL.map((s) => s.text).join(' '),
            transcript: ORIGINAL,
            language: 'en',
            detected_language: 'en',
          },
        ],
      };
    }
    if (String(url).includes('/api/translate')) {
      const body = JSON.parse(init.body);
      translateCalls.push(body);
      if (body.targetLang === failLang) {
        return { ok: false, status: 502, json: async () => ({ message: 'Translation to xx failed' }) };
      }
      const segments = body.segments.map((s) => ({ ...s, text: `[${body.targetLang}] ${s.text}` }));
      return {
        ok: true,
        json: async () => ({
          ok: true,
          segments,
          transcript_text: segments.map((s) => s.text).join(' '),
          stats: { total: 2, translated: 2, failed: 0, ratio: 1 },
          verification: { ok: true, detected: body.targetLang },
        }),
      };
    }
    throw new Error('unexpected fetch ' + url);
  });
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

const box = (c) => c.querySelector('textarea.transcript-box');
const dropdown = () => screen.getByLabelText(/translate to/i);

async function generate() {
  fireEvent.change(screen.getByPlaceholderText('https://youtu.be/dQw4w9WgXcQ'), {
    target: { value: 'dQw4w9WgXcQ' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate transcript/i }));
    await new Promise((r) => setTimeout(r, 100));
  });
}

async function pick(lang) {
  await act(async () => {
    fireEvent.change(dropdown(), { target: { value: lang } });
    await new Promise((r) => setTimeout(r, 60));
  });
}

describe('Translate-to dropdown keeps text and language in sync', () => {
  it('second translation starts from the original, not from the first translation', async () => {
    const { container } = render(<App />);
    await generate();
    await pick('es');
    expect(box(container).value).toContain('[es] Hello everyone');
    await pick('fr');
    expect(box(container).value).toContain('[fr] Hello everyone');
    expect(box(container).value).not.toContain('[es]');
    // The 2nd request must have been sent the English original.
    expect(translateCalls[1].segments[0].text).toBe('Hello everyone welcome');
    expect(translateCalls[1].sourceLang).toBe('en');

    // 3rd language + "Original" tab must still be based on the English original.
    await pick('de');
    expect(box(container).value).toContain('[de] Hello everyone');
    expect(translateCalls[2].segments[0].text).toBe('Hello everyone welcome');
    expect(translateCalls[2].sourceLang).toBe('en');
    fireEvent.click(screen.getByRole('button', { name: /original \(english\)/i }));
    expect(box(container).value).toBe('Hello everyone welcome to this short video');
  });

  it('choosing the video\'s own language (or Original) restores the original text', async () => {
    const { container } = render(<App />);
    await generate();
    await pick('es');
    expect(box(container).value).toContain('[es]');
    await pick('en'); // original language is English
    expect(box(container).value).toBe('Hello everyone welcome to this short video');
    await pick('de');
    await pick('auto');
    expect(box(container).value).toBe('Hello everyone welcome to this short video');
  });

  it('when translation fails the dropdown snaps back to what is really shown', async () => {
    const { container } = render(<App />);
    await generate();
    failLang = 'ja';
    await pick('ja');
    expect(box(container).value).toBe('Hello everyone welcome to this short video');
    expect(dropdown().value).toBe('auto');
  });

  it('failed switch after a good translation falls back to the previous language', async () => {
    const { container } = render(<App />);
    await generate();
    await pick('es');
    failLang = 'de';
    await pick('de');
    expect(box(container).value).toContain('[es]');
    expect(dropdown().value).toBe('es');
  });
});
