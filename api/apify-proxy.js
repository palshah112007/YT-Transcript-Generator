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

  const { url, language = 'en' } = body || {};
  const token = process.env.APIFY_TOKEN;
  const actorId = process.env.APIFY_ACTOR_ID || 'starvibe/youtube-video-transcript';

  if (!token) {
    res.status(500).json({ message: 'Apify token is not configured.' });
    return;
  }

  if (!url) {
    res.status(400).json({ message: 'Missing YouTube URL.' });
    return;
  }

  const runUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(token)}&waitForFinish=1&timeout=120000`;

  try {
    const startResponse = await fetch(runUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtube_url: url, language, include_transcript_text: true }),
    });

    if (!startResponse.ok) {
      const errorPayload = await startResponse.text();
      res.status(502).json({ message: 'Apify actor request failed.', details: errorPayload });
      return;
    }

    const runData = await startResponse.json();
    const datasetId = runData.defaultDatasetId;

    if (!datasetId) {
      res.status(502).json({ message: 'No dataset available from Apify run.' });
      return;
    }

    const dataResponse = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?clean=1&format=json&token=${encodeURIComponent(token)}`);
    if (!dataResponse.ok) {
      const errorPayload = await dataResponse.text();
      res.status(502).json({ message: 'Unable to fetch Apify dataset items.', details: errorPayload });
      return;
    }

    const items = await dataResponse.json();
    res.status(200).json(items);
  } catch (error) {
    res.status(500).json({ message: error.message ?? 'Unexpected error' });
  }
}
