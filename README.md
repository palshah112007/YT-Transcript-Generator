<div align="center">

# 🎬 TranscriptLab Studio

**Enterprise-Ready YouTube Video Transcription, Captioning & Multi-Language Studio**

Extract clean, synchronized transcripts and subtitles from any YouTube URL or video ID in seconds with high-accuracy translation into 8 essential languages.

🌐 **Live Demo:** [https://yt-transcript-generator.vercel.app](https://yt-transcript-generator.vercel.app)

[![Production Build](https://img.shields.io/badge/Build-Passing-emerald?style=for-the-badge&logo=vite)](https://github.com/palshah112007/YT-Transcript-Generator)
[![Tests Passing](https://img.shields.io/badge/Tests-91%2F91%20Passing-indigo?style=for-the-badge&logo=vitest)](https://github.com/palshah112007/YT-Transcript-Generator)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-Installable-purple?style=for-the-badge&logo=pwa)](https://github.com/palshah112007/YT-Transcript-Generator)

</div>

---

## ⚡ What makes TranscriptLab a Product, not just a Project?

TranscriptLab is built from the ground up to provide a frictionless, professional-grade user experience for content creators, researchers, journalists, and developers:

- 🚀 **Zero Friction / 100% Free Guest Mode**: Transcribe immediately without mandatory logins or API keys.
- 💾 **Dual-Tier Storage Architecture**:
  - **Local-First Privacy**: Guest sessions persist automatically in browser `localStorage`.
  - **Cloud Sync**: Logged-in users get encrypted PostgreSQL persistence with Supabase Row Level Security (RLS).
- 🎞️ **Multi-Format Export Suite**:
  - **`.txt`**: Plain text format with instant timestamp toggle `[MM:SS]`.
  - **`.srt`**: SubRip subtitle format with millisecond precision, ready for Premiere Pro, DaVinci Resolve, Final Cut, CapCut, and YouTube Studio.
  - **`.json`**: Structured JSON data with full segment metadata.
- 📊 **Reading Analytics**: Live word counter, character count, video duration, and calculated reading time (`X min read`).
- 🔍 **Instant Search-Within-Transcript**: Find keywords inside transcripts with match count highlights.
- 🌓 **Dynamic Theme Engine**: Automatic dark/light theme switching with persistence.
- ⌨ **Pro Keyboard Shortcuts**: Power-user navigation with `⌘K`, `⌘+Enter`, `⌘+Shift+C`, `Esc`, and `?`.
- 🔔 **Animated Toast Notification System**: Real-time feedback for copy, export, and status events.
- 🛡️ **Fault-Tolerant Dual-Engine Backend**:
  1. Primary: High-speed, free built-in YouTube caption scraper.
  2. Fallback: Authenticated Apify Actor proxy for enterprise resilience.
- 📱 **Installable PWA**: Web manifest and SVG icon ready for desktop and mobile installation.

---

## ⌨ Keyboard Shortcuts Reference

| Shortcut | Action |
| --- | --- |
| `Ctrl / ⌘ + Enter` | Generate transcript from current URL or ID |
| `Ctrl / ⌘ + K` | Focus URL / Video ID input |
| `Ctrl / ⌘ + Shift + C` | Instant 1-click copy transcript |
| `Ctrl / ⌘ + S` | Download transcript file |
| `Esc` | Close active dialog / clear search |
| `?` | Open keyboard shortcuts reference |

---

## 🚀 Quick Start (Zero Configuration)

TranscriptLab runs immediately without configuring any external services:

```bash
# Clone the repository
git clone https://github.com/palshah112007/YT-Transcript-Generator.git
cd YT-Transcript-Generator

# Install dependencies
npm install

# Start the Vite development server
npm run dev
```

Visit `http://localhost:5173` to start transcribing videos!

---

## 🛠️ Production Build & Verification

```bash
# Run unit and integration tests (91 tests)
npm test

# Verify all supported languages end-to-end
npm run verify:langs

# Build production bundle
npm run build

# Preview production build locally
npm run preview
```

---

## 🌐 Supabase & Cloud Sync (Optional)

To enable user accounts, multi-device synchronization, and cloud storage:

1. Create a project at [supabase.com](https://supabase.com).
2. Copy `.env.example` to `.env`:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
3. Run `supabase/init.sql` in your Supabase SQL Editor.
4. Restart your dev server. The connection indicator will turn green: `Cloud: Online`.

---

## 📁 Architecture Overview

```text
├── api/
│   ├── apify-proxy.js          # Vercel Serverless Function proxy (Captions)
│   └── translate.js            # Vercel Serverless Function (Translation)
├── lib/
│   ├── env.js                  # Runtime environment reader
│   ├── lang-check.js           # Offline script & stopword language verification
│   ├── proxy-handler.js        # Dual-tier auth, transcript & translate handler
│   ├── transcript.js           # Instant YouTube caption extractor
│   └── translator.js           # Universal multi-language translation engine (bisection)
├── scripts/
│   └── verify-languages.mjs    # End-to-end multi-language test CLI
├── src/
│   ├── components/
│   │   ├── ErrorBoundary.jsx   # Crash-resilient fallback boundary
│   │   ├── ShortcutsModal.jsx  # Interactive shortcut cheat-sheet
│   │   └── Toast.jsx           # Animated floating notifications
│   ├── lib/
│   │   ├── localHistory.js     # Collision-free LocalStorage engine
│   │   └── supabaseClient.js   # Cloud Supabase client with health probes
│   ├── App.jsx                 # Core product studio application
│   ├── main.jsx                # Application entrypoint
│   └── styles.css              # Custom property design system (Dark & Light)
├── public/
│   ├── icon.svg                # Scalable brand vector icon
│   └── manifest.json           # Web app manifest for PWA installation
└── tests/
    ├── app-component.test.jsx  # Component UI integration tests
    ├── app-helpers.test.jsx    # Helper functions & formatter tests
    ├── lang-check.test.js      # Heuristic language detector tests
    ├── product-features.test.jsx # Phase 2 product suite tests
    ├── proxy-handler.test.js   # Proxy routing & security tests
    ├── translation-flow.test.jsx # Translation UI flow & regression tests
    ├── translator.test.js      # Bisection alignment & chunking tests
    └── verify-languages.test.js# Harness test suite
```

---

## 🌐 Supported Translation Languages

TranscriptLab supports high-accuracy translation between 8 curated global languages:

- 🇬🇧 English (`en`)
- 🇮🇳 Hindi (`hi`)
- 🇪🇸 Spanish (`es`)
- 🇫🇷 French (`fr`)
- 🇩🇪 German (`de`)
- 🇯🇵 Japanese (`ja`)
- 🇷🇺 Russian (`ru`)
- 🇸🇦 Arabic (`ar`)

---

## 📄 License

MIT © [Pal Shah](https://github.com/palshah112007)
