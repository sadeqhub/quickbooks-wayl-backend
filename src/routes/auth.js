const { getAuthUrl, exchangeCodeAndStore } = require('../oauth');
const { appBaseUrl } = require('../config');

/**
 * GET /auth
 * Redirect user to Intuit to authorize the app.
 * Requires INTUIT_CLIENT_ID (or QUICKBOOKS_CLIENT_ID) and INTUIT_REDIRECT_URI in the environment.
 */
function auth(req, res) {
  try {
    const authUrl = getAuthUrl();
    res.redirect(authUrl);
  } catch (err) {
    console.error('OAuth auth URL error:', err.message);
    res.status(500).send(
      `Authorization misconfiguration: ${err.message} Check your server environment variables (e.g. INTUIT_CLIENT_ID, INTUIT_REDIRECT_URI or QUICKBOOKS_*).`
    );
  }
}

/**
 * GET /callback
 * Intuit redirects here with ?code=...&realmId=...&state=...
 * Exchange code for tokens and store by realmId.
 * After successful auth, redirect the browser back to the frontend app
 * (APP_BASE_URL in config) so the user lands on /app with realmId.
 */
async function callback(req, res) {
  try {
    const redirectUrl = req.originalUrl; // e.g. /callback?code=...&realmId=...
    const { realmId } = await exchangeCodeAndStore(redirectUrl);
    const target = `${appBaseUrl}/app?realmId=${encodeURIComponent(realmId)}`;
    res.redirect(target);
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
