import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fetchTranscriptFromApify } from './lib/apify.js';
import { readEnvValue } from './lib/env.js';

// Dev middleware so POST /api/apify-proxy works with `npm run dev`,
// matching the Vercel serverless function (api/apify-proxy.js) in production.
// Secrets are read per-request (lib/env.js) so editing .env hot-reloads —
// no dev-server restart needed.
function apifyProxyDevPlugin() {
  return {
    name: 'apify-proxy-dev',
    configureServer(server) {
      server.middlewares.use('/api/apify-proxy', async (req, res) => {
        const reply = (status, payload) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        if (req.method !== 'POST') {
          reply(405, { message: 'Method not allowed' });
          return;
        }

        let body;
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch (error) {
          reply(400, { message: 'Invalid JSON body.' });
          return;
        }

        const result = await fetchTranscriptFromApify({
          url: body?.url,
          language: body?.language,
          token: readEnvValue('APIFY_TOKEN'),
          actorId: readEnvValue('APIFY_ACTOR_ID'),
        });

        const payload = result.ok
          ? result.items
          : { message: result.message, ...(result.details ? { details: result.details } : {}) };
        reply(result.ok ? 200 : result.status, payload);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apifyProxyDevPlugin()],
});
