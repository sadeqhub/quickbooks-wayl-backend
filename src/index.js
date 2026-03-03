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
const { getWaylApiKey } = require('./store');
const { verifyAuth } = require('./wayl');

const app = express();
app.use(express.json());

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

// Wayl webhook: receives payment completion callbacks (default webhookUrl in link creation).
app.post('/api/webhook/wayl', (req, res) => {
  const signature = req.headers['x-wayl-signature-256'];
  // Optionally verify signature with WAYL_WEBHOOK_SECRET; for now acknowledge receipt.
  console.log('Wayl webhook received', signature ? '(signature present)' : '(no signature)');
  res.status(200).json({ received: true });
});

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
