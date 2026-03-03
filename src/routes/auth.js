const { getAuthUrl, exchangeCodeAndStore } = require('../oauth');

/**
 * GET /auth
 * Redirect user to Intuit to authorize the app.
 */
function auth(req, res) {
  const authUrl = getAuthUrl();
  res.redirect(authUrl);
}

/**
 * GET /callback
 * Intuit redirects here with ?code=...&realmId=...&state=...
 * Exchange code for tokens and store by realmId.
 */
async function callback(req, res) {
  try {
    const redirectUrl = req.originalUrl; // e.g. /callback?code=...&realmId=...
    const { realmId } = await exchangeCodeAndStore(redirectUrl);
    res.redirect(`/app?realmId=${encodeURIComponent(realmId)}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send(`Authorization failed: ${err.message || err.originalMessage || 'Unknown error'}`);
  }
}

/**
 * GET /connected?realmId=...
 * Simple success page after connect (optional; can be your front end).
 */
function connected(req, res) {
  const realmId = req.query.realmId || '';
  res.send(`
    <h1>Connected to QuickBooks</h1>
    <p>Company (realm) ID: <code>${realmId}</code></p>
    <p>You can now use the API to list invoices and create Wayl payment links.</p>
    <p><a href="/api/invoices?realmId=${encodeURIComponent(realmId)}">List invoices</a></p>
  `);
}

module.exports = {
  auth,
  callback,
  connected,
};
