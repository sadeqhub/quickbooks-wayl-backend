require('dotenv').config();

// Base URL for the app (customer-facing). No trailing slash. Used for Intuit Launch/Disconnect/Connect URLs.
// e.g. https://myapp.example.com or http://localhost:8000
const appBaseUrl = process.env.APP_BASE_URL || (process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:8000');

// Intuit/QuickBooks: support both INTUIT_* and QUICKBOOKS_* env vars (e.g. for Porter/Netlify)
const intuit = {
  clientId: process.env.INTUIT_CLIENT_ID || process.env.QUICKBOOKS_CLIENT_ID,
  clientSecret: process.env.INTUIT_CLIENT_SECRET || process.env.QUICKBOOKS_CLIENT_SECRET,
  redirectUri: process.env.INTUIT_REDIRECT_URI || process.env.QUICKBOOKS_REDIRECT_URI || `${appBaseUrl}/callback`,
  environment: process.env.INTUIT_ENVIRONMENT || process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox',
  // Webhook: verifier token from developer.intuit.com → your app → Webhooks (used to verify payload signature).
  webhookVerifierToken: process.env.INTUIT_WEBHOOK_VERIFIER_TOKEN || process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN || '',
};

module.exports = {
  appBaseUrl,
  intuit,
  wayl: {
    apiBase: process.env.WAYL_API_BASE || 'https://api.thewayl.com',
    apiKey: process.env.WAYL_API_KEY,
    // Wayl API requires these for link creation. Defaults use app URL; set in .env for production.
    webhookUrl: process.env.WAYL_WEBHOOK_URL || `${appBaseUrl}/api/webhook/wayl`,
    webhookSecret: process.env.WAYL_WEBHOOK_SECRET || 'wayl-webhook-secret-change-in-production',
    redirectionUrl: process.env.WAYL_REDIRECTION_URL || `${appBaseUrl}/app`,
    // Wayl API currently requires lineItem[*].image (string). Default served by this app.
    lineItemImage: process.env.WAYL_LINE_ITEM_IMAGE || `${appBaseUrl}/img/invoice.svg`,
    // Convert non-IQD invoice total to IQD for Wayl (1 USD = 1320 IQD by default). Set USD_TO_IQD in .env to override.
    usdToIqd: process.env.USD_TO_IQD ? parseFloat(process.env.USD_TO_IQD, 10) : 1320,
  },
  port: parseInt(process.env.PORT || '8000', 10),
};
