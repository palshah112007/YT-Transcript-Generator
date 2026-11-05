// Vercel serverless function: on-demand transcript translation.
import { handleTranslateRequest } from '../lib/proxy-handler.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  await handleTranslateRequest(req, res);
}
