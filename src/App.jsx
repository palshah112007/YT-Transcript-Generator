import { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabaseClient.js';

const OFFER_DURATION_DAYS = 7;

function formatRelativeDate(date) {
  const diff = Math.max(0, Math.round((date - Date.now()) / 1000));
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  return `${days}d ${hours}h`;
}

function parseYoutubeUrl(value) {
  if (!value) return null;
  const trimmed = value.trim();
  const withProtocol = trimmed.match(/^https?:\/\//i) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    const hostname = url.hostname.replace('www.', '');
    if (hostname === 'youtu.be') {
      const id = url.pathname.slice(1);
      return id ? `https://www.youtube.com/watch?v=${id}` : null;
    }
    if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      if (url.searchParams.has('v')) {
        return `https://www.youtube.com/watch?v=${url.searchParams.get('v')}`;
      }
      if (url.pathname.startsWith('/shorts/')) {
        const id = url.pathname.split('/')[2];
        return id ? `https://www.youtube.com/watch?v=${id}` : null;
      }
      if (url.pathname.startsWith('/watch')) {
        return trimmed;
      }
    }
  } catch (error) {
    return null;
  }
  return null;
}

function transcriptTextFromItem(item) {
  if (!item) return '';
  if (item.transcript_text) return item.transcript_text;
  if (Array.isArray(item.transcript)) {
    return item.transcript.map((segment) => segment.text).join(' ');
  }
  if (Array.isArray(item.searchResult)) {
    return item.searchResult.map((segment) => segment.text).join(' ');
  }
  if (typeof item.text === 'string') return item.text;
  return JSON.stringify(item, null, 2);
}

function formatTranscriptWithTimestamps(item) {
  if (!item) return '';
  if (Array.isArray(item.transcript)) {
    return item.transcript.map((segment) => {
      const start = segment.start || segment.start_time || 0;
      const minutes = Math.floor(start / 60);
      const seconds = Math.floor(start % 60);
      const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      return `[${timeStr}] ${segment.text}`;
    }).join('\n\n');
  }
  return transcriptTextFromItem(item);
}

function formatTimestamp(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function buildTrialMetadata(user) {
  const start = user?.user_metadata?.trialStart ? new Date(user.user_metadata.trialStart) : null;
  if (!start) return null;
  const expires = new Date(start.getTime() + OFFER_DURATION_DAYS * 24 * 60 * 60 * 1000);
  return { start, expires };
}

export default function App() {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [showAuth, setShowAuth] = useState(false);
  const [input, setInput] = useState('');
  const [language, setLanguage] = useState('en');
  const [status, setStatus] = useState('Paste a YouTube link or ID to start.');
  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState(null);
  const [history, setHistory] = useState([]);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [creditsUsed, setCreditsUsed] = useState(0);

  const trial = useMemo(() => buildTrialMetadata(user), [user]);
  const trialActive = trial ? trial.expires > new Date() : false;
  const trialCountdown = trial ? formatRelativeDate(trial.expires) : '7d 0h';

  useEffect(() => {
    async function initSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setSession(session);
      setUser(session?.user ?? null);
    }

    initSession();
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadHistory();
      }
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) loadHistory();
  }, [user]);

  async function loadHistory() {
    const { data, error } = await supabase
      .from('yt_transcripts')
      .select('id, youtube_url, title, transcript_text, created_at, language')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      console.error(error);
      return;
    }
    setHistory(data ?? []);
    setCreditsUsed(data?.length || 0);
  }

  async function updateTrialMetadataIfNeeded() {
    if (!user) return;
    if (user.user_metadata?.trialStart) return;
    await supabase.auth.updateUser({ data: { trialStart: new Date().toISOString() } });
    const { data: updatedSession } = await supabase.auth.getSession();
    setUser(updatedSession?.session?.user ?? user);
  }

  async function handleSignup() {
    setLoading(true);
    setStatus('Creating your account...');
    const { error } = await supabase.auth.signUp({ email, password }, { data: { trialStart: new Date().toISOString() } });
    if (error) {
      setStatus(error.message);
      setLoading(false);
      return;
    }
    setStatus('Signup successful! Check your email to verify, then log in.');
    setAuthMode('login');
    setLoading(false);
  }

  async function handleLogin() {
    setLoading(true);
    setStatus('Signing you in...');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus(error.message);
      setLoading(false);
      return;
    }
    await updateTrialMetadataIfNeeded();
    setStatus('Welcome back! Ready to generate transcripts.');
    setLoading(false);
    setShowAuth(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setTranscript(null);
    setHistory([]);
  }

  async function handleGenerate() {
    const url = parseYoutubeUrl(input);
    if (!url) {
      setStatus('Enter a valid YouTube URL, ID, or shared link.');
      return;
    }
    if (!user) {
      setShowLoginPrompt(true);
      setStatus('Your first generation is free, but you need to log in first.');
      return;
    }
    await updateTrialMetadataIfNeeded();
    setShowLoginPrompt(false);
    setLoading(true);
    setStatus('Generating transcript from Apify... please wait.');
    try {
      const response = await fetch('/api/apify-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, language }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Apify request failed');
      }
      const payload = await response.json();
      const item = Array.isArray(payload) ? payload[0] : payload?.[0] ?? payload;
      const transcriptText = transcriptTextFromItem(item);
      if (!transcriptText) {
        throw new Error('No transcript was returned by the scraper.');
      }
      const title = item.title || 'YouTube Transcript';
      await supabase.from('yt_transcripts').insert([
        {
          user_id: user.id,
          youtube_url: url,
          title,
          transcript_text: transcriptText,
          language,
          metadata: item,
          credits_used: 1,
        },
      ]);
      await loadHistory();
      setTranscript({ title, text: transcriptText, url, item });
      setStatus('Transcript generated successfully. Copy, edit, or share it now.');
    } catch (error) {
      console.error(error);
      setStatus(error.message ?? 'Something went wrong while generating the transcript.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!transcript?.text) return;
    await navigator.clipboard.writeText(transcript.text);
    setStatus('Transcript copied to clipboard.');
  }

  function handleDownload() {
    if (!transcript?.text) return;
    const content = showTimestamps ? formatTranscriptWithTimestamps(transcript.item) : transcript.text;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${transcript.title || 'transcript'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus('Transcript downloaded.');
  }

  function handleSelectHistory(item) {
    if (!item) return;
    setTranscript({
      title: item.title || item.youtube_url,
      text: item.transcript_text || '',
      url: item.youtube_url,
      item,
    });
    setStatus('Loaded saved transcript from history.');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>TranscriptLab</strong>
          <span>Gen Z YouTube transcript studio</span>
        </div>
        <div className="top-actions">
          <span className="promo-chip">7-day unlimited launch offer</span>
          {user ? (
            <>
              <button className="secondary-btn" onClick={() => setShowSettings(true)}>
                Account
              </button>
              <button className="ghost-btn" onClick={handleSignOut}>
                Log out
              </button>
            </>
          ) : (
            <button className="primary-btn" onClick={() => setShowAuth(true)}>
              Login / Signup
            </button>
          )}
        </div>
      </header>

      <main className="page-grid">
        <section className="hero-card">
          <div>
            <p className="eyebrow">Modern. Fast. Supabase-powered.</p>
            <h1>Create transcripts from any YouTube URL in seconds.</h1>
            <p className="hero-copy">
              Paste a YouTube video link or ID, sign in, and generate clean transcript
              output powered by Apify. Your account keeps history, credits, and billing
              info in Supabase.
            </p>
          </div>
          <div className="hero-info">
            <div>
              <span>First generation</span>
              <strong>Free for logged-in users</strong>
            </div>
            <div>
              <span>Offer expires in</span>
              <strong>{trialActive ? trialCountdown : 'Soon'}</strong>
            </div>
            <div>
              <span>Auth</span>
              <strong>Supabase email/password</strong>
            </div>
          </div>
        </section>

        <section className="generator-card">
          <div className="card-header">
            <div>
              <p className="eyebrow">YouTube transcript</p>
              <h2>Paste the video link or ID</h2>
            </div>
            <div className="status-pill">{loading ? 'Working...' : 'Ready'}</div>
          </div>

          <div className="form-grid">
            <label className="input-group">
              <span>Video URL or ID</span>
              <input
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  if (!user) setShowLoginPrompt(true);
                }}
                placeholder="https://youtu.be/dQw4w9WgXcQ"
              />
            </label>

            <label className="input-group">
              <span>Language</span>
              <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="auto">Auto-detect</option>
              </select>
            </label>
          </div>

          {showLoginPrompt && !user ? (
            <div className="alert-card">
              <strong>Your first generation is free</strong>
              <p>Log in or sign up to unlock generation, transcript history, and account credits.</p>
              <button className="primary-btn" onClick={() => setShowAuth(true)}>
                Login / Signup
              </button>
            </div>
          ) : null}

          <button className="generate-btn" onClick={handleGenerate} disabled={loading}>
            {loading ? 'Generating...' : 'Generate Transcript'}
          </button>

          <p className="status-text">{status}</p>
        </section>

        {transcript ? (
          <section className="result-card">
            <div className="result-header">
              <div>
                <p className="eyebrow">Transcript output</p>
                <h3>{transcript.title}</h3>
              </div>
              <div className="result-actions">
                <label className="toggle-group">
                  <input
                    type="checkbox"
                    checked={showTimestamps}
                    onChange={(e) => setShowTimestamps(e.target.checked)}
                  />
                  <span>Show timestamps</span>
                </label>
                <button className="secondary-btn" onClick={handleDownload}>
                  Download
                </button>
                <button className="secondary-btn" onClick={handleCopy}>
                  Copy Transcript
                </button>
              </div>
            </div>
            <textarea
              className="transcript-box"
              readOnly
              value={showTimestamps ? formatTranscriptWithTimestamps(transcript.item) : transcript.text || ''}
            />
          </section>
        ) : null}

        <section className="history-card">
          <div className="history-header">
            <div>
              <p className="eyebrow">History</p>
              <h3>Recent transcript jobs</h3>
            </div>
            {user ? null : <span className="small-text">Login to save history.</span>}
          </div>
          {history.length === 0 ? (
            <div className="history-empty">
              <p>No transcripts saved yet.</p>
            </div>
          ) : (
            <ul className="history-list">
              {history.map((item) => (
                <li key={item.id} onClick={() => handleSelectHistory(item)}>
                  <div>
                    <strong>{item.title || item.youtube_url}</strong>
                    <span>{new Date(item.created_at).toLocaleString()}</span>
                  </div>
                  <div>{item.language?.toUpperCase() || 'EN'}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {user ? (
          <section className="account-card">
            <div className="account-header">
              <p className="eyebrow">Account</p>
              <h3>{user.email}</h3>
            </div>
            <div className="account-grid">
              <div>
                <span>Billing plan</span>
                <strong>{trialActive ? 'Launch Trial' : 'Free plan'}</strong>
              </div>
              <div>
                <span>Credits used</span>
                <strong>{creditsUsed} / {trialActive ? 'Unlimited' : '1'}</strong>
              </div>
              <div>
                <span>Offer status</span>
                <strong>{trialActive ? `Expires in ${trialCountdown}` : 'Expired'}</strong>
              </div>
              <div>
                <span>API backend</span>
                <strong>Apify + Supabase</strong>
              </div>
            </div>
          </section>
        ) : null}
      </main>

      {showAuth ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <p className="eyebrow">{authMode === 'login' ? 'Welcome back' : 'Create your account'}</p>
                <h2>{authMode === 'login' ? 'Sign in' : 'Sign up'}</h2>
              </div>
              <button className="ghost-btn" onClick={() => setShowAuth(false)}>
                Close
              </button>
            </div>

            <label className="input-group">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            <label className="input-group">
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter a strong password" />
            </label>
            <button className="primary-btn" onClick={authMode === 'login' ? handleLogin : handleSignup} disabled={loading}>
              {authMode === 'login' ? 'Login' : 'Create account'}
            </button>
            <button className="secondary-btn" onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>
              {authMode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
            </button>
            <p className="small-text">Your credentials are stored securely in Supabase.</p>
          </div>
        </div>
      ) : null}

      {showSettings ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Account settings</p>
                <h2>{user?.email || 'Your account'}</h2>
              </div>
              <button className="ghost-btn" onClick={() => setShowSettings(false)}>
                Close
              </button>
            </div>
            <div className="settings-grid">
              <div>
                <span>Email</span>
                <strong>{user?.email}</strong>
              </div>
              <div>
                <span>Plan</span>
                <strong>{trialActive ? 'Launch Trial' : 'Free plan'}</strong>
              </div>
              <div>
                <span>Offer status</span>
                <strong>{trialActive ? `Expires in ${trialCountdown}` : 'Expired'}</strong>
              </div>
              <div>
                <span>Credits used</span>
                <strong>{creditsUsed} / {trialActive ? 'Unlimited' : '1'}</strong>
              </div>
            </div>
            <div className="alert-card">
              <strong>How it works</strong>
              <p>
                Your first generation is free after login. History is saved to Supabase and transcripts are generated via Apify.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
