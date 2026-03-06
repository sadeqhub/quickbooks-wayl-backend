const express = require('express');
const config = require('./config');
const { auth, callback, connected } = require('./routes/auth');
const {
  listInvoices,
  getOneInvoice,
  createInvoicePaymentLink,
  sendInvoiceWithPaymentLink,
} = require('./routes/invoices');
const { getWaylSettings, setWaylSettings, setWaylNoteSettings } = require('./routes/settings');
const { getIntuitUrls } = require('./routes/intuit-urls');
const { handleIntuitWebhook } = require('./routes/webhook-intuit');
const { handleWaylWebhook } = require('./routes/webhook-wayl');
const { getWaylApiKey } = require('./store');
const { verifyAuth } = require('./wayl');

const app = express();

// QuickBooks webhook: new/updated invoices etc. (use raw body for signature verification).
// This MUST be registered before express.json(), otherwise the body will already be parsed.
app.post('/api/webhook/intuit', express.raw({ type: 'application/json' }), handleIntuitWebhook);

// Wayl webhook: receives payment completion callbacks (use raw body for signature verification).
app.post('/api/webhook/wayl', express.raw({ type: 'application/json' }), handleWaylWebhook);

// JSON body parsing for all non-webhook routes.
app.use(express.json());

// Allow browser calls from the hosted frontend (Netlify) and local dev.
// Adjust FRONTEND_ORIGIN in env if you deploy to a different domain.
const allowedOrigin =
  process.env.FRONTEND_ORIGIN ||
  'https://quickbooks-wayl.netlify.app';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', allowedOrigin);
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// OAuth
app.get('/auth', auth);
app.get('/callback', callback);
app.get('/connected', connected);

// API (require realmId for QB operations)
app.get('/api/invoices', listInvoices);
app.get('/api/invoices/:id', getOneInvoice);
app.post('/api/invoices/:id/payment-link', createInvoicePaymentLink);
app.get('/api/invoices/:id/payment-link', (req, res, next) => {
  req.body = { realmId: req.query.realmId };
  createInvoicePaymentLink(req, res, next);
});
app.post('/api/invoices/:id/send-with-payment-link', sendInvoiceWithPaymentLink);

app.get('/api/settings/wayl', getWaylSettings);
app.post('/api/settings/wayl', setWaylSettings);
app.post('/api/settings/wayl/notes', setWaylNoteSettings);
app.get('/api/intuit/urls', getIntuitUrls);

app.get('/api/wayl/verify', async (req, res) => {
  const realmId = req.query.realmId;
  const apiKey = realmId ? getWaylApiKey(realmId) : null;
  if (realmId && !apiKey) {
    return res.status(400).json({ ok: false, error: 'No Wayl API key set for this merchant. Use POST /api/settings/wayl first.' });
  }
  try {
    const result = await verifyAuth(apiKey);
    res.json({ ok: true, wayl: result });
  } catch (err) {
    res.status(401).json({ ok: false, error: err.message });
  }
});

// API-only backend; frontend is in a separate repo (quickbooks-wayl-frontend).
app.get('/', (req, res) => {
  res.json({ name: 'quickbooks-wayl-backend', docs: 'See README for API routes.' });
});

app.listen(config.port, () => {
  console.log(`Server running at http://localhost:${config.port}`);
  if (!config.intuit.clientId || !config.intuit.clientSecret) {
    console.warn('Set INTUIT_CLIENT_ID and INTUIT_CLIENT_SECRET in .env');
  }
  console.log('Merchants provide their own Wayl API key via POST /api/settings/wayl');
});
