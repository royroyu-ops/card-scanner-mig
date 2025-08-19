// /api/ocr.js  (Vercel Serverless Function - CommonJS)
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ error: 'Method not allowed' });
  }

  try {
    const body = await readJson(req);
    const imageBase64 = body?.imageBase64;
    if (!imageBase64) {
      res.statusCode = 400;
      return res.json({ error: 'imageBase64 required' });
    }

    const endpoint = process.env.OPTIIC_API_ENDPOINT || 'https://api.optiic.dev/ocr';
    const apiKey   = process.env.OPTIIC_API_KEY;

    if (!apiKey) {
      res.statusCode = 500;
      return res.json({ error: 'Missing OPTIIC_API_KEY env' });
    }

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Sesetengah OCR guna Authorization Bearer, sesetengah "x-api-key".
        // Tukar jika perlu ikut docs Optiic anda.
        'x-api-key': apiKey,
        // 'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ image: imageBase64 }),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      res.statusCode = upstream.status || 502;
      return res.json({ error: 'Optiic error', raw: data });
    }

    // Normalise field text
    const text = data.text || data.ocr || data.result || data.data?.text || '';
    return res.json({ text, raw: data });
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    return res.json({ error: 'Server error', detail: String(err) });
  }
};

// ---- helpers ----
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
