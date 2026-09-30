// Component test: the transcript result card's timestamp toggle and the .txt
// download helper. The Supabase client is mocked in GUEST MODE (supabase:
// null) so generation runs without any auth or network — this is the app's
// real no-login path and needs no signed-in state.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';

// Mock the Supabase client module BEFORE importing App: configured = false,
// client = null (guest mode).
vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: null,
  isSupabaseConfigured: false,
  missingSupabaseEnvVars: [],
  pingSupabase: vi.fn().mockResolvedValue('unconfigured'),
}));

import App from '../src/App.jsx';

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve([
        {
          title: 'Test Video',
          transcript_text: 'Hello world',
          transcript: [
            { text: 'Hello', start: 0 },
            { text: 'world', start: 62 },
          ],
        },
      ]),
  });
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

// The transcript output <textarea>. There are two textbox-role elements
// (URL input + textarea), so query by selector instead.
function getTranscriptBox(container) {
  return container.querySelector('textarea.transcript-box');
}

// Drive generation through the public UI: paste a bare video ID and click
// Generate. The fetch mock above returns a canned transcript. Click + settle
// wait inside act so all async state updates flush before assertions.
async function generateTranscript() {
  fireEvent.change(screen.getByPlaceholderText('https://youtu.be/dQw4w9WgXcQ'), {
    target: { value: 'dQw4w9WgXcQ' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate transcript/i }));
    // Wait until the success status appears (or fail fast after 3s).
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (/transcript generated \(guest mode/i.test(document.body.textContent)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  });
}

// Wrap a download click: temporarily intercept Blob construction so we can
// inspect the exact parts the download helper wrote.
function captureNextBlob() {
  const RealBlob = global.Blob;
  const made = [];
  global.Blob = class extends RealBlob {
    constructor(parts, options) {
      super(parts, options);
      made.push({ parts, options });
    }
  };
  return function restoreAndRead() {
    global.Blob = RealBlob;
    return made;
  };
}

describe('App transcript result card', () => {
  it('renders the transcript and toggles timestamps on demand', async () => {
    const { container } = render(<App />);
    await generateTranscript();

    const box = getTranscriptBox(container);
    expect(box.value).toBe('Hello world');

    // Toggle timestamps on.
    fireEvent.click(screen.getByLabelText(/show timestamps/i));
    expect(box.value).toContain('[0:00] Hello');
    expect(box.value).toContain('[1:02] world');

    // Toggle back off.
    fireEvent.click(screen.getByLabelText(/show timestamps/i));
    expect(box.value).toBe('Hello world');
  });

  it('downloads the transcript as a .txt file honoring the timestamp toggle', async () => {
    const { container } = render(<App />);
    await generateTranscript();

    // Download with timestamps OFF -> plain text, text/plain, right filename.
    const restorePlain = captureNextBlob();
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    const plain = restorePlain();
    expect(plain).toHaveLength(1);
    expect(plain[0].parts.join('')).toBe('Hello world');
    expect(plain[0].options).toMatchObject({ type: 'text/plain' });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    // Toggle timestamps ON -> download includes timestamps.
    fireEvent.click(screen.getByLabelText(/show timestamps/i));
    expect(getTranscriptBox(container).value).toContain('[0:00] Hello');

    const restoreStamped = captureNextBlob();
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    const stamped = restoreStamped();
    expect(stamped).toHaveLength(1);
    expect(stamped[0].parts.join('')).toContain('[0:00] Hello');
    expect(stamped[0].parts.join('')).toContain('[1:02] world');
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
