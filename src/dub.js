const config = require('./config');

/**
 * Shorten a URL using the dub.co API.
 * Returns the shortened URL string, or null if DUB_API_KEY is not set or the request fails.
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function shortenUrl(url) {
  const apiKey = config.dub.apiKey;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.dub.co/links', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`dub.co shorten failed (${res.status}):`, text);
      return null;
    }

    const data = await res.json();
    return data.shortLink || data.short_link || null;
  } catch (err) {
    console.warn('dub.co shorten error:', err.message || err);
    return null;
  }
}

module.exports = { shortenUrl };
