import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase, isSupabaseConfigured, missingSupabaseEnvVars, pingSupabase } from './lib/supabaseClient.js';
import {
  getLocalHistory,
  saveLocalHistoryEntry,
  clearLocalHistory,
  deleteLocalHistoryEntry,
  makeLocalEntry,
} from './lib/localHistory.js';
import { ToastContainer } from './components/Toast.jsx';
import { ShortcutsModal } from './components/ShortcutsModal.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';

const OFFER_DURATION_DAYS = 7;

const LANG_NAMES = {
  en: 'English', hi: 'Hindi', es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', it: 'Italian', ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', ru: 'Russian', ar: 'Arabic', nl: 'Dutch', tr: 'Turkish',
};

function formatRelativeDate(date) {
  const diff = Math.max(0, Math.round((date - Date.now()) / 1000));
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  return `${days}d ${hours}h`;
}

export function extractVideoId(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const withProtocol = trimmed.match(/^https?:\/\//i) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    const hostname = url.hostname.replace(/^www\./, '');
    if (hostname === 'youtu.be') {
      const id = url.pathname.slice(1);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      if (url.searchParams.has('v')) {
        const id = url.searchParams.get('v') || '';
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }
      if (url.pathname.startsWith('/shorts/')) {
        const id = url.pathname.split('/')[2] || '';
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function formatSrtTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const s = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const m = totalMins % 60;
  const h = Math.floor(totalMins / 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

export function formatTranscriptAsSRT(item) {
  if (!item) return '';
  const segments = Array.isArray(item.transcript)
    ? item.transcript
    : Array.isArray(item.transcriptText)
      ? item.transcriptText
      : null;

  if (!segments || segments.length === 0) {
    const plain = transcriptTextFromItem(item);
    if (!plain) return '';
    return `1\n00:00:00,000 --> 00:00:05,000\n${plain}\n`;
  }

  return segments
    .map((seg, index) => {
      const start = Number(seg.start ?? seg.start_time ?? 0) || 0;
      let dur = Number(seg.duration ?? seg.dur ?? 0) || 0;
      if (dur <= 0) {
        const next = segments[index + 1];
        if (next && (next.start ?? next.start_time) !== undefined) {
          const nextStart = Number(next.start ?? next.start_time) || 0;
          dur = Math.max(0.5, nextStart - start);
        } else {
          dur = 3;
        }
      }
      const end = start + dur;
      return `${index + 1}\n${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}\n${seg.text}`;
    })
    .join('\n\n') + '\n';
}

export function calculateTranscriptStats(text, item) {
  const clean = (text || '').trim();
  const wordCount = clean ? clean.split(/\s+/).filter(Boolean).length : 0;
  const charCount = clean.length;
  const readingTimeMin = Math.max(1, Math.ceil(wordCount / 200));

  let totalDurationSec = 0;
  const segments = Array.isArray(item?.transcript) ? item.transcript : null;
  if (segments && segments.length > 0) {
    const last = segments[segments.length - 1];
    const lastStart = Number(last.start ?? last.start_time ?? 0) || 0;
    const lastDur = Number(last.duration ?? 0) || 2;
    totalDurationSec = Math.round(lastStart + lastDur);
  }

  return {
    wordCount,
    charCount,
    readingTimeMin,
    readingTimeStr: `${readingTimeMin} min read`,
    durationStr: totalDurationSec > 0 ? formatTimestamp(totalDurationSec) : null,
  };
}

// Pure helpers are exported for unit tests; exporting them has no effect on
// app behavior.
export function parseYoutubeUrl(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return `https://www.youtube.com/watch?v=${trimmed}`;
  }
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
  } catch {
    return null;
  }
  return null;
}

export function transcriptTextFromItem(item) {
  if (!item) return '';
  if (item.transcript_text) return item.transcript_text;
  if (Array.isArray(item.transcript)) {
    return item.transcript.map((segment) => segment.text).join(' ');
  }
  if (Array.isArray(item.transcriptText)) {
    return item.transcriptText.map((segment) => segment.text).join(' ');
  }
  if (typeof item.transcriptText === 'string') return item.transcriptText;
  if (Array.isArray(item.searchResult)) {
    return item.searchResult.map((segment) => segment.text).join(' ');
  }
  if (typeof item.text === 'string') return item.text;
  return '';
}

export function formatTranscriptWithTimestamps(item) {
  if (!item) return '';
  if (Array.isArray(item.transcript)) {
    return item.transcript.map((segment) => {
      const start = Number(segment.start ?? segment.start_time ?? 0) || 0;
      const minutes = Math.floor(start / 60);
      const seconds = Math.floor(start % 60);
      const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      return `[${timeStr}] ${segment.text}`;
    }).join('\n\n');
  }
  return transcriptTextFromItem(item);
}

export function formatTimestamp(seconds) {
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

function describeAuthError(error) {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.message === 'Failed to fetch' || /fetch failed|networkerror|load failed/i.test(error.message ?? '')) {
    return 'Cannot reach Supabase — project may be paused. Restore it at supabase.com/dashboard.';
  }
  return error.message;
}

const SIGNUP_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSignupFields(emailValue, passwordValue) {
  if (!SIGNUP_EMAIL_PATTERN.test(emailValue.trim())) {
    return 'Enter a valid email address (e.g. you@example.com).';
  }
  if (passwordValue.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  return '';
}

export function mapSignupError(error) {
  const code = error?.code ?? '';
  const raw = error?.message ?? '';
  if (code === 'user_already_exists' || /already registered|already exists/i.test(raw)) {
    return 'An account with this email already exists. Try logging in instead.';
  }
  if (code === 'weak_password' || /at least \d+ characters|weak password/i.test(raw)) {
    return 'Password is too weak. Please use at least 6 characters.';
  }
  if (
    code === 'validation_failed' ||
    /invalid email|unable to validate email|email.*invalid format/i.test(raw)
  ) {
    return 'That email address looks invalid. Please check it and try again.';
  }
  if (/rate limit|over_email_send_rate_limit/i.test(raw) || code === 'over_email_send_rate_limit') {
    return 'Email send rate limit reached on Supabase free tier.';
  }
  if (raw === 'Failed to fetch' || /fetch failed|networkerror|load failed/i.test(raw)) {
    return 'Cannot reach the signup service. Check your internet connection or Supabase status.';
  }
  return 'Signup failed. Please try again in a moment.';
}

export function mapLoginError(error) {
  const code = error?.code ?? '';
  const raw = error?.message ?? '';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(raw)) {
    return 'Incorrect email or password. Please try again.';
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(raw)) {
    return 'Please confirm your email first — check your inbox for the confirmation link.';
  }
  if (raw === 'Failed to fetch' || /fetch failed|networkerror|load failed/i.test(raw)) {
    return describeAuthError(error);
  }
  return 'Login failed. Please try again in a moment.';
}

function mapResetPasswordError(error) {
  const raw = error?.message ?? '';
  if (raw === 'Failed to fetch' || /fetch failed|networkerror|load failed/i.test(raw)) {
    return 'Cannot reach Supabase — check your internet connection.';
  }
  if (/invalid|validation/i.test(raw)) {
    return 'That email address looks invalid. Please check it and try again.';
  }
  return 'Could not send the reset email. Please try again in a moment.';
}

export function AppContent() {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [showAuth, setShowAuth] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authErrorDetail, setAuthErrorDetail] = useState('');
  const [authErrorHint, setAuthErrorHint] = useState('');
  const [dbStatus, setDbStatus] = useState(
    isSupabaseConfigured ? 'checking' : 'unconfigured'
  );
  const [showRestoreGuide, setShowRestoreGuide] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [input, setInput] = useState('');
  const [language, setLanguage] = useState('auto');
  const [status, setStatus] = useState('Paste a YouTube link or ID to start.');
  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState(null);
  const [history, setHistory] = useState([]);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [creditsUsed, setCreditsUsed] = useState(0);
  const [historySearch, setHistorySearch] = useState('');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [languageTab, setLanguageTab] = useState('active');
  const [copied, setCopied] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [translating, setTranslating] = useState(false);
  const [translateProgress, setTranslateProgress] = useState(0);
  const [translationCache, setTranslationCache] = useState({}); // { [lang]: { segments, text } }

  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('transcriptlab_theme') || 'dark';
    }
    return 'dark';
  });

  const urlInputRef = useRef(null);

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, message, type, duration }]);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Sync theme changes with DOM and localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('transcriptlab_theme', theme);
    } catch {}
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    addToast(`Switched to ${next} theme`, 'info', 2000);
  };

  const trial = useMemo(() => buildTrialMetadata(user), [user]);
  const trialActive = trial ? trial.expires > new Date() : false;
  const trialCountdown = trial ? formatRelativeDate(trial.expires) : '7d 0h';

  const detectedVideoId = useMemo(() => extractVideoId(input), [input]);
  const transcriptStats = useMemo(() => {
    if (!transcript?.item && !transcript?.text) return null;
    return calculateTranscriptStats(transcript.text, transcript.item);
  }, [transcript]);

  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return history;
    const q = historySearch.toLowerCase();
    return history.filter(
      (item) =>
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.youtube_url && item.youtube_url.toLowerCase().includes(q)) ||
        (item.language && item.language.toLowerCase().includes(q))
    );
  }, [history, historySearch]);

  const currentItem = useMemo(() => {
    if (!transcript) return null;
    if (languageTab === 'original' && transcript.item?.original_transcript) {
      return {
        ...transcript.item,
        transcript: transcript.item.original_transcript,
        transcript_text: transcript.item.original_transcript_text || transcript.text,
      };
    }
    return transcript.item;
  }, [transcript, languageTab]);

  const displayedTranscriptText = useMemo(() => {
    if (!transcript) return '';
    const it = currentItem || transcript.item;
    return showTimestamps
      ? formatTranscriptWithTimestamps(it)
      : (transcriptTextFromItem(it) || transcript.text || '');
  }, [transcript, currentItem, showTimestamps]);

  const transcriptSearchMatchCount = useMemo(() => {
    if (!transcriptSearch.trim() || !displayedTranscriptText) return 0;
    const escaped = transcriptSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const matches = displayedTranscriptText.match(regex);
    return matches ? matches.length : 0;
  }, [transcriptSearch, displayedTranscriptText]);

  useEffect(() => {
    if (!user) {
      const local = getLocalHistory();
      setHistory(local);
      setCreditsUsed(local.length);
    }
  }, [user]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    async function initSession() {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (error) {
          console.error('Session restore failed:', error.message);
        }
        setSession(session ?? null);
        setUser(session?.user ?? null);
      } catch (error) {
        console.error('Session restore failed:', error?.message ?? error);
      }
    }

    initSession();
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadHistory(session.user.id);
      }
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) loadHistory(user.id);
  }, [user]);

  // Connection status indicator
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    async function probe() {
      const status = await pingSupabase();
      if (cancelled) return;
      setDbStatus(status);
      if (status === 'offline') setShowRestoreGuide(true);
    }
    probe();
    window.addEventListener('focus', probe);
    const interval = setInterval(probe, 60000);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', probe);
      clearInterval(interval);
    };
  }, []);

  // Global Keyboard shortcuts listener
  useEffect(() => {
    function handleKeyDown(e) {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);

      // Esc closes open modals
      if (e.key === 'Escape') {
        setShowAuth(false);
        setShowRestoreGuide(false);
        setShowSettings(false);
        setShowShortcuts(false);
        setTranscriptSearch('');
        return;
      }

      // Cmd/Ctrl + Enter triggers generation
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleGenerate();
        return;
      }

      // Cmd/Ctrl + K focuses input
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        urlInputRef.current?.focus();
        return;
      }

      // Cmd/Ctrl + Shift + C copies transcript
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopy();
        return;
      }

      // ? opens shortcuts guide when not inside an input
      if (e.key === '?' && !isInput) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [input, language, session, transcript, showTimestamps]);

  async function loadHistory(userId) {
    if (!userId || !supabase) return;
    const { data, error } = await supabase
      .from('yt_transcripts')
      .select('id, youtube_url, title, transcript_text, created_at, language')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      console.error('History load failed:', error.message);
      return;
    }
    setHistory(data ?? []);
    setCreditsUsed(data?.length || 0);
  }

  async function updateTrialMetadataIfNeeded() {
    if (!user || !supabase) return;
    if (user.user_metadata?.trialStart) return;
    await supabase.auth.updateUser({ data: { trialStart: new Date().toISOString() } });
    const { data: updatedSession } = await supabase.auth.getSession();
    setUser(updatedSession?.session?.user ?? user);
  }

  async function handleSignup() {
    if (!supabase || !isSupabaseConfigured) {
      const msg = 'Signup is unavailable: Supabase is not configured.';
      const detail = `Missing environment variables in .env: ${missingSupabaseEnvVars.join(', ') || 'VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY'}`;
      const hint = 'Copy .env.example to .env, paste your Supabase URL & anon key, then restart the dev server.';
      setStatus(msg);
      setAuthError(msg);
      setAuthErrorDetail(detail);
      setAuthErrorHint(hint);
      addToast('Supabase is not configured yet', 'error');
      return;
    }
    if (loading) return;

    const validationError = validateSignupFields(email, password);
    if (validationError) {
      setStatus(validationError);
      setAuthError(validationError);
      setAuthErrorDetail('Validation check failed: check email format and minimum 6 characters password.');
      setAuthErrorHint('Enter a valid email (e.g. name@example.com) and a password with at least 6 characters.');
      addToast(validationError, 'warning');
      return;
    }

    setLoading(true);
    setAuthError('');
    setAuthErrorDetail('');
    setAuthErrorHint('');
    setStatus('Creating your account...');
    try {
      const { data, error } = await supabase.auth.signUp(
        { email: email.trim(), password },
        { data: { trialStart: new Date().toISOString() } }
      );
      if (error) {
        const message = mapSignupError(error);
        setStatus(message);
        setAuthError(message);
        setAuthErrorDetail(error.message || error.code || 'Signup request failed');
        if (error.code === 'user_already_exists' || /already/i.test(error.message || '')) {
          setAuthErrorHint('Try logging in with this email instead, or click "Forgot password?" if you cannot remember your password.');
        } else if (/rate limit|over_email_send_rate_limit/i.test(error.message || '')) {
          setAuthErrorHint('Supabase free tier limits confirmation emails to ~3 per hour. To fix this immediately: In Supabase Dashboard -> Authentication -> Providers -> Email -> toggle OFF "Confirm email", then click Create account again for instant login!');
        } else if (/network|fetch/i.test(error.message || '')) {
          setAuthErrorHint('Check your internet connection and verify that your Supabase project is active (not paused) in your dashboard.');
        } else {
          setAuthErrorHint('Verify your Supabase project settings and make sure Email Auth is enabled under Authentication -> Providers.');
        }
        addToast(message, 'error');
        return;
      }
      if (!data?.session) {
        const msg = 'Check your email to confirm your account, then log in.';
        setStatus(msg);
        addToast(msg, 'info', 6000);
        setAuthError('Email confirmation required');
        setAuthErrorDetail('Supabase created the account, but requires email verification before logging in.');
        setAuthErrorHint('Check your inbox (or spam) for the confirmation link. Tip: You can disable "Confirm email" in Supabase Dashboard -> Authentication -> Providers -> Email -> toggle off "Confirm email" to allow instant login.');
        return;
      }
      setStatus('Account created. You are logged in.');
      addToast('Welcome to TranscriptLab! You are logged in.', 'success');
      setShowAuth(false);
    } catch (err) {
      const raw = err?.message || 'Unexpected signup failure';
      setStatus(raw);
      setAuthError('Unexpected error occurred during signup');
      setAuthErrorDetail(raw);
      setAuthErrorHint('Check the browser developer console for network details.');
      addToast('Signup error occurred', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    if (!supabase || !isSupabaseConfigured) {
      const msg = 'Login is unavailable: Supabase is not configured.';
      const detail = `Missing environment variables in .env: ${missingSupabaseEnvVars.join(', ') || 'VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY'}`;
      const hint = 'Add your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file, then restart the server.';
      setStatus(msg);
      setAuthError(msg);
      setAuthErrorDetail(detail);
      setAuthErrorHint(hint);
      addToast('Supabase is not configured yet', 'error');
      return;
    }
    if (loading) return;
    setLoading(true);
    setAuthError('');
    setAuthErrorDetail('');
    setAuthErrorHint('');
    setStatus('Signing you in...');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        const message = mapLoginError(error);
        setStatus(message);
        setAuthError(message);
        setAuthErrorDetail(error.message || error.code || 'Sign in rejected');
        if (error.code === 'email_not_confirmed' || /email not confirmed/i.test(error.message || '')) {
          setAuthErrorHint('Click the confirmation link sent to your email. (Or in Supabase Dashboard -> Authentication -> Users, find your user and click "Confirm email").');
        } else if (error.code === 'invalid_credentials' || /invalid login/i.test(error.message || '')) {
          setAuthErrorHint('Double-check your email and password. If you don\'t have an account yet, click "Need an account? Sign up" below.');
        } else if (/network|fetch/i.test(error.message || '')) {
          setAuthErrorHint('Could not reach Supabase. Check your internet connection or verify if your project is active at supabase.com/dashboard.');
        } else {
          setAuthErrorHint('Check that VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env are accurate.');
        }
        addToast(message, 'error');
        return;
      }
      await updateTrialMetadataIfNeeded();
      setStatus('Welcome back! Ready to generate transcripts.');
      addToast('Welcome back! Ready to generate transcripts.', 'success');
      setShowAuth(false);
    } catch (err) {
      const raw = err?.message || 'Login failed';
      setStatus(raw);
      setAuthError('Unexpected error during login');
      setAuthErrorDetail(raw);
      addToast('Login error occurred', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!supabase || !isSupabaseConfigured) {
      const msg = 'Password reset is unavailable: Supabase is not configured.';
      setStatus(msg);
      setAuthError(msg);
      setAuthErrorDetail(`Missing environment variables: ${missingSupabaseEnvVars.join(', ')}`);
      setAuthErrorHint('Configure Supabase in your .env file to enable password recovery.');
      return;
    }
    if (loading) return;
    if (!SIGNUP_EMAIL_PATTERN.test(email.trim())) {
      const message = 'Enter a valid email address (e.g. you@example.com).';
      setStatus(message);
      setAuthError(message);
      setAuthErrorDetail('Email format is invalid');
      setAuthErrorHint('Please check the spelling of your email address.');
      addToast(message, 'warning');
      return;
    }
    setLoading(true);
    setAuthError('');
    setAuthErrorDetail('');
    setAuthErrorHint('');
    setStatus('Sending password reset email...');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/`,
      });
      if (error) {
        const message = mapResetPasswordError(error);
        setStatus(message);
        setAuthError(message);
        setAuthErrorDetail(error.message || 'Reset password request failed');
        setAuthErrorHint('Make sure an account with this email exists in your Supabase project.');
        addToast(message, 'error');
        return;
      }
      setStatus('Password reset email sent. Check your inbox for the link.');
      addToast('Password reset link sent to your inbox.', 'info');
      setAuthMode('login');
    } catch (err) {
      const raw = err?.message || 'Password reset failed';
      setStatus(raw);
      setAuthError('Could not send password reset');
      setAuthErrorDetail(raw);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch (error) {
        console.error('Sign out failed:', error?.message ?? error);
      }
    }
    setUser(null);
    setSession(null);
    setTranscript(null);
    const local = getLocalHistory();
    setHistory(local);
    setCreditsUsed(local.length);
    addToast('Logged out. Switched to guest mode.', 'info');
  }

  async function handleGenerate() {
    const url = parseYoutubeUrl(input);
    if (!url) {
      const msg = 'Enter a valid YouTube URL, ID, or shared link.';
      setStatus(msg);
      addToast(msg, 'warning');
      return;
    }
    if (user) {
      await updateTrialMetadataIfNeeded();
    }
    setShowLoginPrompt(false);
    setLoading(true);
    setTranslationCache({});
    setLanguageTab('active');
    setStatus('Fetching captions... please wait.');
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      const response = await fetch('/api/apify-proxy', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url, language: 'auto' }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Request failed (${response.status})`);
      }
      const payload = await response.json();
      const item = Array.isArray(payload) ? payload[0] : payload?.[0] ?? payload;
      const transcriptText = transcriptTextFromItem(item);
      if (!transcriptText) {
        throw new Error(
          'No transcript found for this video. It may have captions disabled or be unavailable.'
        );
      }
      const title = item.title || 'YouTube Transcript';
      const detectedLang = item.detected_language || item.language || 'auto';

      if (!supabase || !user) {
        const entry = makeLocalEntry({ url, title, transcriptText, language: detectedLang, item });
        saveLocalHistoryEntry(entry);
        const updated = getLocalHistory();
        setHistory(updated);
        setCreditsUsed(updated.length);
        setTranscript({ title, text: transcriptText, url, item });
        setStatus('Transcript ready! (guest mode)');
        addToast('Transcript ready! Saved to local history.', 'success');
      } else {
        const { error: insertError } = await supabase.from('yt_transcripts').insert([
          {
            user_id: user.id,
            youtube_url: url,
            title,
            transcript_text: transcriptText,
            language: detectedLang,
            metadata: item,
            credits_used: 1,
          },
        ]);
        if (insertError) {
          console.error('History save failed:', insertError.message);
        }
        await loadHistory(user.id);
        setTranscript({ title, text: transcriptText, url, item });
        setStatus('Transcript generated successfully.');
        addToast('Transcript generated and cloud synced!', 'success');
      }

      // If user selected a specific language different from detected, auto-translate
      if (
        language &&
        language !== 'auto' &&
        detectedLang &&
        !detectedLang.toLowerCase().startsWith(language.toLowerCase())
      ) {
        // Don't await — let it run in background while user sees original
        handleTranslate(item, language, detectedLang);
      }
    } catch (error) {
      console.error(error);
      const errMsg = error.message ?? 'Something went wrong while generating the transcript.';
      setStatus(errMsg);
      addToast(errMsg, 'error');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Translate the current transcript's segments to targetLang.
   * Runs as a background operation with progress updates.
   */
  async function handleTranslate(item, targetLang, sourceLang) {
    if (!item?.transcript || !targetLang) return;
    if (translating) return; // prevent double-trigger

    // Check cache first
    if (translationCache[targetLang]) {
      applyTranslation(targetLang);
      return;
    }

    setTranslating(true);
    setTranslateProgress(0);
    setStatus(`Translating to ${LANG_NAMES[targetLang] || targetLang.toUpperCase()}...`);
    addToast(`Translating transcript... this may take a moment.`, 'info', 4000);

    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: item.transcript,
          targetLang,
          sourceLang: sourceLang || item.detected_language || item.language || 'auto',
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'Translation request failed');
      }

      const result = await response.json();
      if (result.ok && result.segments) {
        setTranslationCache((prev) => ({
          ...prev,
          [targetLang]: {
            segments: result.segments,
            text: result.transcript_text,
          },
        }));

        // Update transcript with translated version
        setTranscript((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            item: {
              ...prev.item,
              original_transcript: prev.item.transcript,
              original_transcript_text: prev.item.transcript_text || prev.text,
              original_language: prev.item.detected_language || prev.item.language,
              transcript: result.segments,
              transcript_text: result.transcript_text,
              language: targetLang,
            },
            text: result.transcript_text,
          };
        });
        setLanguageTab('active');
        setStatus(`Translated to ${LANG_NAMES[targetLang] || targetLang.toUpperCase()} ✓`);
        addToast(`Translation complete!`, 'success');
      }
    } catch (err) {
      console.error('Translation failed:', err);
      addToast(`Translation failed: ${err.message}`, 'error');
      setStatus('Translation failed — showing original transcript.');
    } finally {
      setTranslating(false);
      setTranslateProgress(0);
    }
  }

  function applyTranslation(lang) {
    const cached = translationCache[lang];
    if (!cached) return;
    setTranscript((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        item: {
          ...prev.item,
          original_transcript: prev.item.original_transcript || prev.item.transcript,
          original_transcript_text: prev.item.original_transcript_text || prev.item.transcript_text || prev.text,
          original_language: prev.item.original_language || prev.item.detected_language || prev.item.language,
          transcript: cached.segments,
          transcript_text: cached.text,
          language: lang,
        },
        text: cached.text,
      };
    });
    setLanguageTab('active');
  }

  async function handleCopy() {
    if (!transcript) return;
    const it = currentItem || transcript.item;
    const content = showTimestamps
      ? formatTranscriptWithTimestamps(it)
      : (transcriptTextFromItem(it) || transcript.text || '');
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setStatus('Transcript copied to clipboard.');
      addToast('Transcript copied to clipboard!', 'success');
    } catch {
      setStatus('Could not copy to clipboard.');
      addToast('Could not copy to clipboard.', 'error');
    }
  }

  function handleDownload(format = 'txt') {
    if (!transcript) return;
    const it = currentItem || transcript.item;
    let content = '';
    let mimeType = 'text/plain';
    let ext = 'txt';

    if (format === 'srt') {
      content = formatTranscriptAsSRT(it);
      mimeType = 'text/plain';
      ext = 'srt';
    } else if (format === 'json') {
      const exportData = {
        title: transcript.title,
        url: transcript.url,
        language: languageTab === 'original' ? (transcript.item?.original_language || language) : language,
        text: transcriptTextFromItem(it) || transcript.text,
        segments: it?.transcript || [],
        exported_at: new Date().toISOString(),
      };
      content = JSON.stringify(exportData, null, 2);
      mimeType = 'application/json';
      ext = 'json';
    } else {
      content = showTimestamps ? formatTranscriptWithTimestamps(it) : (transcriptTextFromItem(it) || transcript.text || '');
      ext = 'txt';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${transcript.title || 'transcript'}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus(`Transcript downloaded as .${ext}`);
    addToast(`Downloaded as .${ext}`, 'success');
  }

  function handleSelectHistory(item) {
    if (!item) return;
    setTranscript({
      title: item.title || item.youtube_url,
      text: item.transcript_text || '',
      url: item.youtube_url,
      item: item.metadata || item,
    });
    setStatus('Loaded saved transcript from history.');
    addToast('Loaded from history', 'info', 2000);
  }

  async function handleDeleteHistory(id, event) {
    if (event) event.stopPropagation();
    if (!user || !supabase) {
      const updated = deleteLocalHistoryEntry(id);
      setHistory(updated);
      setCreditsUsed(updated.length);
      setStatus('Deleted local transcript from history.');
      addToast('Deleted from local storage', 'info');
      return;
    }
    const { error } = await supabase
      .from('yt_transcripts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    if (!error) {
      await loadHistory(user.id);
      setStatus('Deleted transcript from history.');
      addToast('Deleted from cloud history', 'info');
    }
  }

  async function handleClearAllHistory() {
    if (!user || !supabase) {
      clearLocalHistory();
      setHistory([]);
      setCreditsUsed(0);
      setStatus('Local history cleared.');
      addToast('All local history cleared', 'info');
      return;
    }
    const { error } = await supabase
      .from('yt_transcripts')
      .delete()
      .eq('user_id', user.id);
    if (!error) {
      setHistory([]);
      setCreditsUsed(0);
      setStatus('History cleared.');
      addToast('All history cleared', 'info');
    }
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {missingSupabaseEnvVars.length > 0 && process.env.NODE_ENV === 'development' ? (
        <div className="env-warning" role="alert">
          <strong>Developer notice:</strong> missing environment{' '}
          variable{missingSupabaseEnvVars.length > 1 ? 's' : ''}{' '}
          <code>{missingSupabaseEnvVars.join(', ')}</code>. Login and cloud sync are disabled
          (local guest mode active).
        </div>
      ) : null}

      <header className="topbar">
        <div className="brand">
          <div className="brand-logo-title">
            <span className="brand-badge-icon">🎬</span>
            <strong>TranscriptLab</strong>
            <span className="version-pill">PRO</span>
          </div>
          <span className="brand-tagline">Professional YouTube Transcript &amp; Subtitle Studio</span>
        </div>
        <div className="top-actions">
          <button
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          <button
            className="keyboard-shortcut-trigger-btn"
            onClick={() => setShowShortcuts(true)}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            ⌨ <span className="desktop-only-text">Shortcuts</span>
          </button>

          <span
            className={`db-status db-${dbStatus}`}
            role={dbStatus === 'offline' ? 'button' : undefined}
            onClick={dbStatus === 'offline' ? () => setShowRestoreGuide(true) : undefined}
            title={
              dbStatus === 'online' ? 'Supabase connected' :
              dbStatus === 'offline' ? 'Supabase unreachable — click for restore guide' :
              dbStatus === 'checking' ? 'Checking connection...' :
              'Guest mode active — local storage'
            }>
            <span className="db-dot" />
            {dbStatus === 'online' ? 'Cloud: Online' :
             dbStatus === 'offline' ? 'Cloud: Offline' :
             dbStatus === 'checking' ? 'Connecting...' : 'Guest Mode'}
          </span>

          <span className="promo-chip">⚡ Free &amp; Unlimited</span>

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
            <button className="primary-btn" onClick={() => {
              setAuthError('');
              setShowAuth(true);
            }}>
              Login / Signup
            </button>
          )}
        </div>
      </header>

      <main className="page-grid">
        <section className="hero-card">
          <div>
            <p className="eyebrow">Enterprise-Grade Video Transcription Studio</p>
            <h1>Extract Clean YouTube Transcripts &amp; Subtitles Instantly.</h1>
            <p className="hero-copy">
              Convert any YouTube video into readable text, SubRip (.SRT) captions, or JSON data.
              Includes automatic language support, video timestamps, reading time analytics,
              and seamless privacy-first local storage.
            </p>
          </div>
          <div className="hero-info">
            <div>
              <span>Accessibility</span>
              <strong>100% Free Guest Mode</strong>
            </div>
            <div>
              <span>Export Ready</span>
              <strong>TXT, SRT, JSON</strong>
            </div>
            <div>
              <span>Smart Search</span>
              <strong>Instant Keyword Filter</strong>
            </div>
          </div>
        </section>

        <section className="generator-card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Instant Extraction</p>
              <h2>Paste the video link or ID</h2>
            </div>
            <div className={`status-pill ${loading ? 'status-pill-loading' : ''}`}>
              {loading ? 'Transcribing...' : 'Ready'}
            </div>
          </div>

          <div className="form-grid">
            <label className="input-group">
              <span>Video URL or ID <kbd className="hint-kbd">⌘K</kbd></span>
              <input
                ref={urlInputRef}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  if (!user && event.target.value.length > 5) setShowLoginPrompt(true);
                }}
                placeholder="https://youtu.be/dQw4w9WgXcQ"
              />
            </label>

            <label className="input-group">
              <span>Translate to</span>
              <select value={language} onChange={(event) => {
                const newLang = event.target.value;
                setLanguage(newLang);
                // If we already have a transcript, trigger translation
                if (transcript?.item && newLang !== 'auto') {
                  const detLang = transcript.item.detected_language || transcript.item.original_language || transcript.item.language;
                  if (detLang && !detLang.toLowerCase().startsWith(newLang.toLowerCase())) {
                    handleTranslate(transcript.item.original_transcript ? { ...transcript.item, transcript: transcript.item.original_transcript } : transcript.item, newLang, detLang);
                  }
                } else if (newLang === 'auto' && transcript?.item?.original_transcript) {
                  // Revert to original
                  setTranscript((prev) => {
                    if (!prev?.item?.original_transcript) return prev;
                    return {
                      ...prev,
                      item: {
                        ...prev.item,
                        transcript: prev.item.original_transcript,
                        transcript_text: prev.item.original_transcript_text || prev.text,
                        language: prev.item.original_language || prev.item.detected_language,
                      },
                      text: prev.item.original_transcript_text || prev.text,
                    };
                  });
                  setLanguageTab('active');
                  addToast('Showing original transcript', 'info', 2000);
                }
              }}>
                <option value="auto">Original Language (No Translation)</option>
                <option value="en">English</option>
                <option value="hi">Hindi (हिन्दी)</option>
                <option value="es">Spanish (Español)</option>
                <option value="fr">French (Français)</option>
                <option value="de">German (Deutsch)</option>
                <option value="pt">Portuguese (Português)</option>
                <option value="it">Italian (Italiano)</option>
                <option value="ja">Japanese (日本語)</option>
                <option value="ko">Korean (한국어)</option>
                <option value="zh">Chinese (中文)</option>
                <option value="ru">Russian (Русский)</option>
                <option value="ar">Arabic (العربية)</option>
                <option value="nl">Dutch (Nederlands)</option>
                <option value="tr">Turkish (Türkçe)</option>
              </select>
            </label>
          </div>

          {detectedVideoId ? (
            <div className="video-preview-box">
              <img
                src={`https://img.youtube.com/vi/${detectedVideoId}/mqdefault.jpg`}
                alt="Video thumbnail"
                className="video-thumb"
              />
              <div className="video-thumb-details">
                <span className="video-id-tag">YouTube Video ID: {detectedVideoId}</span>
                <a
                  href={`https://www.youtube.com/watch?v=${detectedVideoId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="video-watch-link"
                >
                  Watch on YouTube ↗
                </a>
              </div>
            </div>
          ) : null}

          {showLoginPrompt && !user ? (
            <div className="alert-card">
              <strong>Free Guest Mode Active</strong>
              <p>You can generate transcripts right away! Sign in or create an account if you want cloud backup, sync across devices, and Apify fallback.</p>
              <button className="primary-btn" onClick={() => setShowAuth(true)}>
                Login / Signup
              </button>
            </div>
          ) : null}

          <button
            className="generate-btn"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? (
              <span className="loading-btn-content">
                <span className="spinner-dots" />
                Generating...
              </span>
            ) : (
              'Generate Transcript'
            )}
          </button>

          <p className="status-text">{status}</p>
        </section>

        {loading ? (
          <section className="result-card skeleton-card" aria-label="Loading transcript preview">
            <div className="skeleton-line skeleton-title" />
            <div className="skeleton-pills-row">
              <div className="skeleton-pill" />
              <div className="skeleton-pill" />
              <div className="skeleton-pill" />
            </div>
            <div className="skeleton-box" />
          </section>
        ) : null}

        {transcript ? (
          <section className="result-card">
            <div className="result-header">
              <div>
                <p className="eyebrow">Transcript output</p>
                <h3>{transcript.title}</h3>
                {translating ? (
                  <div className="translate-progress-bar">
                    <span className="spinner-dots" /> Translating to {LANG_NAMES[language] || language}...
                  </div>
                ) : null}
                {transcript.item?.original_language &&
                transcript.item?.original_transcript &&
                transcript.item?.original_language !== transcript.item?.language ? (
                  <div className="lang-switcher-row">
                    <button
                      type="button"
                      className={`lang-tab-pill ${languageTab === 'active' ? 'active' : ''}`}
                      onClick={() => setLanguageTab('active')}
                    >
                      🌐 {LANG_NAMES[transcript.item?.language] || transcript.item?.language?.toUpperCase()} (Translated)
                    </button>
                    <button
                      type="button"
                      className={`lang-tab-pill ${languageTab === 'original' ? 'active' : ''}`}
                      onClick={() => setLanguageTab('original')}
                    >
                      Original ({LANG_NAMES[transcript.item?.original_language] || transcript.item?.original_language?.toUpperCase()})
                    </button>
                  </div>
                ) : null}
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
                <button className="secondary-btn" onClick={() => handleDownload('txt')}>
                  Download
                </button>
                <button className="secondary-btn export-srt-btn" onClick={() => handleDownload('srt')}>
                  Export .SRT
                </button>
                <button className="ghost-btn export-json-btn" onClick={() => handleDownload('json')}>
                  .JSON
                </button>
                <button className={`secondary-btn copy-btn ${copied ? 'copied-active' : ''}`} onClick={handleCopy}>
                  {copied ? '✓ Copied!' : 'Copy Transcript'}
                </button>
              </div>
            </div>

            {transcriptStats ? (
              <div className="transcript-stats-bar">
                <span className="stat-pill"><strong>{transcriptStats.wordCount.toLocaleString()}</strong> words</span>
                <span className="stat-pill"><strong>{transcriptStats.readingTimeStr}</strong></span>
                <span className="stat-pill"><strong>{transcriptStats.charCount.toLocaleString()}</strong> chars</span>
                {transcriptStats.durationStr ? (
                  <span className="stat-pill">Duration: <strong>{transcriptStats.durationStr}</strong></span>
                ) : null}
              </div>
            ) : null}

            <div className="transcript-search-bar">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="transcript-search-input"
                placeholder="Search within this transcript..."
                value={transcriptSearch}
                onChange={(e) => setTranscriptSearch(e.target.value)}
              />
              {transcriptSearch ? (
                <span className="search-match-badge">
                  {transcriptSearchMatchCount} {transcriptSearchMatchCount === 1 ? 'match' : 'matches'}
                </span>
              ) : null}
            </div>

            <textarea
              className="transcript-box"
              readOnly
              value={displayedTranscriptText}
            />
          </section>
        ) : null}

        <section className="history-card">
          <div className="history-header">
            <div>
              <p className="eyebrow">History</p>
              <h3>Recent transcript jobs</h3>
            </div>
            <div className="history-actions">
              {user ? (
                <span className="cloud-badge" title="Saved to Supabase database">☁️ Cloud Synced</span>
              ) : (
                <span className="local-badge" title="Saved to local browser storage">💾 Browser Storage</span>
              )}
              {history.length > 0 ? (
                <button className="ghost-btn clear-btn" onClick={handleClearAllHistory}>
                  Clear all
                </button>
              ) : null}
            </div>
          </div>
          {history.length > 0 ? (
            <div className="history-filter-wrap">
              <input
                type="text"
                className="history-search-input"
                placeholder="Filter history by title, URL, or language..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />
            </div>
          ) : null}
          {filteredHistory.length === 0 ? (
            <div className="history-empty">
              <p>{history.length === 0 ? 'No transcripts saved yet.' : 'No matching transcripts found.'}</p>
            </div>
          ) : (
            <ul className="history-list">
              {filteredHistory.map((item) => (
                <li key={item.id} onClick={() => handleSelectHistory(item)}>
                  <div className="history-info">
                    <strong>{item.title || item.youtube_url}</strong>
                    <span>{new Date(item.created_at).toLocaleString()}</span>
                  </div>
                  <div className="history-item-actions">
                    <span className="lang-tag">{item.language?.toUpperCase() || 'EN'}</span>
                    <button
                      className="delete-item-btn"
                      title="Delete item"
                      onClick={(e) => handleDeleteHistory(item.id, e)}
                    >
                      ✕
                    </button>
                  </div>
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

      <footer className="product-footer">
        <div className="footer-content">
          <div className="footer-left">
            <strong>TranscriptLab Studio</strong>
            <span>Privacy-first • Zero cookies tracking • Instant export</span>
          </div>
          <div className="footer-center">
            <button className="footer-shortcut-btn" onClick={() => setShowShortcuts(true)}>
              ⌨ Keyboard Shortcuts <kbd>?</kbd>
            </button>
          </div>
          <div className="footer-right">
            <span className="footer-version">v2.1.0 Production</span>
          </div>
        </div>
      </footer>

      <ShortcutsModal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {showAuth ? (
        <div className="modal-overlay" onClick={() => setShowAuth(false)}>
          <div className="modal-card auth-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">
                  {authMode === 'login' ? 'Welcome back' : authMode === 'signup' ? 'Create your account' : 'Reset password'}
                </p>
                <h2>
                  {authMode === 'login' ? 'Sign in' : authMode === 'signup' ? 'Sign up' : 'Forgot password'}
                </h2>
              </div>
              <button className="ghost-btn" onClick={() => {
                setAuthError('');
                setAuthErrorDetail('');
                setAuthErrorHint('');
                setShowAuth(false);
              }}>
                Close
              </button>
            </div>

            {!isSupabaseConfigured ? (
              <div className="auth-unconfigured-banner" role="alert">
                <div className="auth-banner-header">
                  <span className="auth-banner-icon">⚙️</span>
                  <strong>Supabase Setup Needed</strong>
                </div>
                <p>
                  To use Login, Signup, and Cloud Sync, Supabase credentials must be added to your <code>.env</code> file.
                </p>
                <div className="env-status-tags">
                  <span className="env-status-tag tag-missing">VITE_SUPABASE_URL: Not set</span>
                  <span className="env-status-tag tag-missing">VITE_SUPABASE_ANON_KEY: Not set</span>
                </div>
                <button
                  type="button"
                  className="setup-guide-link-btn"
                  onClick={() => setShowRestoreGuide(true)}
                >
                  📖 View Step-by-Step Supabase Setup Guide →
                </button>
              </div>
            ) : null}

            <label className="input-group">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setAuthError('');
                }}
                placeholder="you@example.com"
              />
            </label>
            {authMode !== 'forgot' ? (
              <label className="input-group">
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setAuthError('');
                  }}
                  placeholder="Enter a strong password (min 6 chars)"
                />
              </label>
            ) : null}

            {authError ? (
              <div className="auth-error-card" role="alert">
                <div className="auth-error-title-row">
                  <span className="auth-error-icon">⚠️</span>
                  <strong className="auth-error-title">{authError}</strong>
                </div>
                {authErrorDetail && authErrorDetail !== authError ? (
                  <div className="auth-error-detail-box">
                    <span className="detail-label">Details:</span>
                    <code>{authErrorDetail}</code>
                  </div>
                ) : null}
                {authErrorHint ? (
                  <p className="auth-error-hint">
                    💡 <strong>Solution:</strong> {authErrorHint}
                  </p>
                ) : null}
              </div>
            ) : null}

            <button
              className="primary-btn"
              onClick={
                authMode === 'login'
                  ? handleLogin
                  : authMode === 'signup'
                    ? handleSignup
                    : handleForgotPassword
              }
              disabled={loading}
            >
              {loading
                ? 'Processing...'
                : authMode === 'login'
                  ? 'Login'
                  : authMode === 'signup'
                    ? 'Create account'
                    : 'Send reset link'}
            </button>
            {authMode === 'login' ? (
              <button className="ghost-btn" onClick={() => {
                setAuthError('');
                setAuthErrorDetail('');
                setAuthErrorHint('');
                setAuthMode('forgot');
              }}>
                Forgot password?
              </button>
            ) : null}
            {authMode !== 'forgot' ? (
              <button className="secondary-btn" onClick={() => {
                setAuthError('');
                setAuthErrorDetail('');
                setAuthErrorHint('');
                setAuthMode(authMode === 'login' ? 'signup' : 'login');
              }}>
                {authMode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
              </button>
            ) : (
              <button className="secondary-btn" onClick={() => {
                setAuthError('');
                setAuthErrorDetail('');
                setAuthErrorHint('');
                setAuthMode('login');
              }}>
                Back to log in
              </button>
            )}
            <p className="small-text">
              {isSupabaseConfigured
                ? 'Credentials are encrypted and authenticated via Supabase.'
                : 'Tip: You can use the app without login — transcripts save to browser storage!'}
            </p>
          </div>
        </div>
      ) : null}

      {showRestoreGuide ? (
        <div className="modal-overlay" onClick={() => setShowRestoreGuide(false)}>
          <div className="modal-card guide-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Supabase Integration Guide</p>
                <h2>Setup &amp; Connection Guide</h2>
              </div>
              <button className="ghost-btn" onClick={() => setShowRestoreGuide(false)}>
                Close
              </button>
            </div>
            <p className="hero-copy">
              Follow these simple steps to connect Supabase database &amp; auth to TranscriptLab:
            </p>
            <ol className="guide-list">
              <li>
                <strong>Create a free Supabase Project</strong>: Open{' '}
                <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
                  supabase.com/dashboard
                </a>{' '}
                and click <em>New project</em>.
              </li>
              <li>
                <strong>Copy API Keys</strong>: In your Supabase Dashboard, navigate to{' '}
                <strong>Project Settings → API</strong>. Copy your <strong>Project URL</strong> and{' '}
                <strong>anon public key</strong>.
              </li>
              <li>
                <strong>Paste in <code>.env</code> file</strong>: Open the <code>.env</code> file in this project root and add:
                <pre className="code-snippet-box">
{`VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
                </pre>
              </li>
              <li>
                <strong>Create Database Tables</strong>: Open <strong>SQL Editor</strong> in Supabase, paste all contents of{' '}
                <code>supabase/init.sql</code>, and click <strong>Run</strong> (creates <code>yt_transcripts</code> table and security policies).
              </li>
              <li>
                <strong>(Optional) Instant Login without Email Confirmation</strong>: In Supabase, go to{' '}
                <strong>Authentication → Providers → Email</strong> and toggle OFF <em>Confirm email</em> if you want immediate logins without email verification links.
              </li>
              <li>
                <strong>Restart Dev Server</strong>: In terminal, press <code>Ctrl+C</code> and run <code>npm run dev</code>. The indicator will turn green: <strong>Cloud: Online</strong>!
              </li>
            </ol>
            <button className="primary-btn" onClick={() => setShowRestoreGuide(false)}>
              Got it, thanks!
            </button>
          </div>
        </div>
      ) : null}

      {showSettings ? (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
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

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
