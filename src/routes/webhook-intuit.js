const crypto = require('crypto');
const config = require('../config');
const { createPaymentLinkForInvoiceAndUpdateMemo } = require('./invoices');

/**
 * Verify Intuit webhook payload using the verifier token and intuit-signature header.
 * Intuit sends: Base64(HMAC-SHA256(verifierToken, rawBody)).
 */
function verifyIntuitSignature(rawBody, signatureHeader) {
  const token = config.intuit.webhookVerifierToken;
  if (!token || !signatureHeader) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expectedB64 = crypto.createHmac('sha256', token).update(raw).digest('base64');
  const received = Buffer.from(signatureHeader, 'base64');
  const expected = Buffer.from(expectedB64, 'base64');
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(received, expected);
}

/**
 * POST /api/webhook/intuit
 * QuickBooks webhook: invoice created/updated, etc.
 * - Set Webhook URL in developer.intuit.com to: {BACKEND_BASE_URL}/api/webhook/intuit
 * - Set INTUIT_WEBHOOK_VERIFIER_TOKEN (or QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN) to the verifier token from the portal.
 * req.body is the raw body (Buffer) when using express.raw() for this route.
 */
async function handleIntuitWebhook(req, res) {
  const rawBody = req.body;
  const signature = req.headers['intuit-signature'] || req.headers['Intuit-Signature'];

  if (!rawBody || rawBody.length === 0) {
    return res.status(400).send('Missing body');
  }

  if (config.intuit.webhookVerifierToken && !verifyIntuitSignature(rawBody, signature)) {
    console.warn('Intuit webhook: invalid or missing signature');
    return res.status(401).send('Invalid signature');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).send('Invalid JSON');
  }

  // eventNotifications (legacy) or CloudEvents array
  const events = payload.eventNotifications || (Array.isArray(payload) ? payload : [payload]);
  for (const ev of events) {
    const realmId = ev.realmId || ev.intuitaccountid;
    const dataChange = ev.dataChangeEvent || ev.data;
    const entityList = (dataChange && dataChange.entities) || (ev.data && (ev.data.entities || (ev.data.entity && [ev.data.entity]))) || [];
    const evType = (ev.type || (dataChange && 'dataChangeEvent') || '').toLowerCase();
    console.log('Intuit webhook:', { realmId, type: evType, entityCount: entityList.length });

    const invoiceCreates = [];
    if (entityList.length > 0) {
      for (const ent of entityList) {
        const name = ent.name || ent.entity;
        const id = ent.id || ent.entityId;
        const op = (ent.operation || ent.eventType || '').toLowerCase();
        const isInvoice = name === 'Invoice' || (ent.entity && ent.entity === 'Invoice');
        if (isInvoice && id && realmId && (op === 'create' || op === 'insert')) {
          invoiceCreates.push({ realmId, id: String(id) });
        }
      }
    } else if (evType.includes('invoice') && evType.includes('creat') && (ev.intuitentityid || ev.data?.intuitentityid) && realmId) {
      // CloudEvents: type like qbo.invoice.created.v1, entity id at top level
      invoiceCreates.push({ realmId, id: String(ev.intuitentityid || ev.data?.intuitentityid) });
    }

    for (const { realmId: rId, id: invoiceId } of invoiceCreates) {
      try {
        const result = await createPaymentLinkForInvoiceAndUpdateMemo(rId, invoiceId, {});
        console.log('Webhook: payment link added to invoice', { realmId: rId, invoiceId, docNumber: result.docNumber });
      } catch (err) {
        console.warn('Webhook: could not add payment link to invoice', { realmId: rId, invoiceId, error: err.message });
      }
    }
  }

  res.status(200).send();
}

module.exports = {
  handleIntuitWebhook,
};
