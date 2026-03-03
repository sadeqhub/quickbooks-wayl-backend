const { getWaylApiKey, setWaylApiKey, getInvoiceNoteLang, setInvoiceNoteLang } = require('../store');
const { verifyAuth } = require('../wayl');

/**
 * GET /api/settings/wayl?realmId=...
 * Returns whether the merchant has set a Wayl API key (never returns the key).
 * Does not require QB token so the saved key is visible after server restart.
 */
function getWaylSettings(req, res) {
  const realmId = req.query.realmId;
  if (!realmId) {
    return res.status(400).json({ error: 'Missing realmId' });
  }
  const hasKey = !!getWaylApiKey(realmId);
  res.json({ configured: hasKey, noteLang: getInvoiceNoteLang(realmId) });
}

/**
 * POST /api/settings/wayl
 * Body: { realmId, apiKey }
 * Store the merchant's Wayl API key. Optionally verifies the key with Wayl before storing.
 * Query ?verify=true to verify the key before saving.
 * Does not require QB token so the key can be saved and persists across restarts.
 */
async function setWaylSettings(req, res) {
  const realmId = (req.body && req.body.realmId) || req.query.realmId;
  const apiKey = req.body && req.body.apiKey;
  if (!realmId) {
    return res.status(400).json({ error: 'Missing realmId' });
  }

  const key = apiKey != null ? String(apiKey).trim() : '';
  if (key === '') {
    setWaylApiKey(realmId, null);
    return res.json({ configured: false, message: 'Wayl API key removed.' });
  }

  const verify = req.query.verify === 'true' || req.query.verify === '1';
  if (verify) {
    try {
      await verifyAuth(key);
    } catch (err) {
      return res.status(400).json({
        error: 'Wayl API key is invalid or could not be verified.',
        details: err.message,
      });
    }
  }

  setWaylApiKey(realmId, key);
  res.json({ configured: true, message: 'Wayl API key saved.' });
}

/**
 * POST /api/settings/wayl/notes
 * Body: { realmId, noteLang } where noteLang is 'ar' | 'en' | 'both'
 */
function setWaylNoteSettings(req, res) {
  const realmId = (req.body && req.body.realmId) || req.query.realmId;
  const noteLang = req.body && req.body.noteLang;
  if (!realmId) {
    return res.status(400).json({ error: 'Missing realmId' });
  }
  const allowed = ['ar', 'en', 'both'];
  const lang = allowed.includes(noteLang) ? noteLang : 'both';
  setInvoiceNoteLang(realmId, lang);
  res.json({ noteLang: lang });
}

module.exports = {
  getWaylSettings,
  setWaylSettings,
  setWaylNoteSettings,
};
