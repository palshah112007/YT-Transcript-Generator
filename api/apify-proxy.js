// Vercel serverless function: returns transcripts for YouTube URLs.
// Primary engine is free (YouTube captions, no credentials). Apify is an
// optional fallback enabled by setting APIFY_TOKEN. Shared logic lives in
// lib/transcript.js so local `npm run dev` (Vite middleware) matches prod.
import { generateTranscript } from '../lib/transcript.js';

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

  const result = await generateTranscript({
    url: body?.url,
    language: body?.language,
    apifyToken: process.env.APIFY_TOKEN,
    apifyActorId: process.env.APIFY_ACTOR_ID,
  });

  if (result.ok) {
    res.status(200).json([result.item]);
    return;
  }
  const payload = { message: result.message };
  if (result.details) payload.details = result.details;
  res.status(502).json(payload);
}
