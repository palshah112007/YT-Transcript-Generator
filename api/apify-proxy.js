// Vercel serverless function: proxies transcript requests to the Apify actor.
// Shared logic lives in lib/apify.js so local `npm run dev` (Vite middleware)
// behaves exactly the same as production.
import { fetchTranscriptFromApify } from '../lib/apify.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (error) {
    res.status(400).json({ message: 'Invalid JSON body.' });
    return;
  }

  const result = await fetchTranscriptFromApify({
    url: body?.url,
    language: body?.language,
    token: process.env.APIFY_TOKEN,
    actorId: process.env.APIFY_ACTOR_ID,
  });

  if (!result.ok) {
    const payload = { message: result.message };
    if (result.details) payload.details = result.details;
    res.status(result.status).json(payload);
    return;
  }

  res.status(200).json(result.items);
}
