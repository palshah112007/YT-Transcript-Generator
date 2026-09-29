import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { generateTranscript } from './lib/transcript.js';
import { readEnvValue } from './lib/env.js';

// Dev middleware so POST /api/apify-proxy works with `npm run dev`,
// matching the Vercel serverless function (api/apify-proxy.js) in production.
// Secrets are read per-request (lib/env.js) so editing .env hot-reloads.
// Transcript generation works without any token: the free captions engine
// (lib/transcript.js) is primary; Apify is only an optional fallback.
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

        const result = await generateTranscript({
          url: body?.url,
          language: body?.language,
          apifyToken: readEnvValue('APIFY_TOKEN'),
          apifyActorId: readEnvValue('APIFY_ACTOR_ID'),
        });

        if (result.ok) {
          reply(200, [result.item]);
          return;
        }
        const payload = { message: result.message };
        if (result.details) payload.details = result.details;
        reply(502, payload);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apifyProxyDevPlugin()],
});
