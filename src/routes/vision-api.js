'use strict';

const express = require('express');
const https   = require('https');

const router = express.Router();

function _openaiVisionRequest(messages) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return reject(new Error('OPENAI_API_KEY not set'));

    const bodyStr = JSON.stringify({ model: 'gpt-4o', messages, max_tokens: 1024 });
    const options = {
      hostname: 'api.openai.com',
      path:     '/v1/chat/completions',
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.error) return reject(new Error(`OpenAI vision error: ${json.error.message}`));
          resolve(json.choices?.[0]?.message?.content || '');
        } catch (e) { reject(new Error(`OpenAI vision parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(new Error('OpenAI vision timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

// POST /api/vision/analyze — analyze images via gpt-4o
router.post('/analyze', async (req, res) => {
  const { imageUrls, prompt } = req.body || {};
  if (!imageUrls?.length) return res.status(400).json({ error: 'imageUrls required' });

  const defaultPrompt = 'Describe this image in detail. Include any text, objects, colours, and context you can see.';
  const userContent = [
    { type: 'text', text: prompt || defaultPrompt },
    ...imageUrls.map(url => ({
      type:      'image_url',
      image_url: { url: typeof url === 'string' ? url : url.url, detail: 'auto' },
    })),
  ];

  try {
    const description = await _openaiVisionRequest([{ role: 'user', content: userContent }]);
    return res.json({ description });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
