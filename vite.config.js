import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { handleTranscriptRequest } from './lib/proxy-handler.js';
import { readEnvValue } from './lib/env.js';

// Dev middleware so POST /api/apify-proxy works with `npm run dev`,
// matching the Vercel serverless function (api/apify-proxy.js) in production.
// All request logic (bearer-token auth, URL validation, status codes,
// timeout) lives in lib/proxy-handler.js — shared, not duplicated.
// Secrets are read per-request (lib/env.js) so editing .env hot-reloads and
// are only used server-side; nothing is ever sent back to the client.
function apifyProxyDevPlugin() {
  return {
    name: 'apify-proxy-dev',
    configureServer(server) {
      server.middlewares.use('/api/apify-proxy', (req, res) =>
        handleTranscriptRequest(req, res, {
          getEnv: (name) => readEnvValue(name),
        })
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), apifyProxyDevPlugin()],
  // Vitest configuration (npm test). jsdom for component tests; the dev
  // middleware plugin above is a no-op under test.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.{test,spec}.{js,jsx}'],
  },
});
