const crypto = require('crypto');
const config = require('../config');
const { getInvoice, createPayment } = require('../quickbooks');
const { getAllRealms } = require('../store');

function verifyWaylSignature(rawBody, signatureHeader) {
  const secret = config.wayl.webhookSecret;
  if (!secret || !signatureHeader) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expectedHex = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const received = Buffer.from(String(signatureHeader), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(received, expected);
}

async function resolveInvoiceFromReference(referenceId) {
  if (!referenceId || typeof referenceId !== 'string') return null;

  // New format: qb-<realmId>-invoice-<invoiceId>
  const m = referenceId.match(/^qb-([^-]+)-invoice-(.+)$/);
  if (m) {
    return { realmId: m[1], invoiceId: m[2] };
  }

  // Legacy format: qb-invoice-<invoiceId> (realmId not encoded)
  const legacy = referenceId.match(/^qb-invoice-(.+)$/);
  if (!legacy) return null;

  const invoiceId = legacy[1];
  const realms = getAllRealms();
  for (const realmId of realms) {
    try {
      const inv = await getInvoice(realmId, invoiceId);
      if (inv) {
        const core = inv.Invoice || inv;
        if (core && String(core.Id) === String(invoiceId)) {
          return { realmId, invoiceId };
        }
      }
    } catch (_) {
      // ignore and try next realm
    }
  }

  return null;
}

async function handleWaylWebhook(req, res) {
  const rawBody = req.body;
  const signature = req.headers['x-wayl-signature-256'] || req.headers['X-WAYL-SIGNATURE-256'];

  if (!rawBody || rawBody.length === 0) {
    return res.status(400).send('Missing body');
  }

  if (config.wayl.webhookSecret && !verifyWaylSignature(rawBody, signature)) {
    console.warn('Wayl webhook: invalid or missing signature');
    return res.status(401).send('Invalid signature');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).send('Invalid JSON');
  }

  const referenceId =
    payload.referenceId ||
    payload.referenceid ||
    (payload.data && (payload.data.referenceId || payload.data.referenceid)) ||
    null;

  const statusRaw =
    payload.status ||
    payload.paymentStatus ||
    payload.transactionStatus ||
    (payload.data && payload.data.status) ||
    '';
  const status = String(statusRaw || '').toLowerCase();
  const isPaid =
    status &&
    ['success', 'succeeded', 'paid', 'completed'].includes(status);

  if (!referenceId) {
    console.warn('Wayl webhook: missing referenceId in payload');
    return res.status(200).send(); // acknowledge to avoid retries, but log for investigation
  }

  if (!isPaid) {
    console.log('Wayl webhook: non-paid status', { referenceId, status });
    return res.status(200).send();
  }

  const identity = await resolveInvoiceFromReference(referenceId);
  if (!identity) {
    console.warn('Wayl webhook: could not resolve invoice from referenceId', referenceId);
    return res.status(200).send();
  }

  const { realmId, invoiceId } = identity;

  try {
    const invoice = await getInvoice(realmId, invoiceId);
    if (!invoice) {
      throw new Error('Invoice not found in QuickBooks');
    }
    const inv = invoice.Invoice || invoice;
    const balance = Number(inv.Balance || 0);
    if (balance === 0) {
      console.log('Wayl webhook: invoice already paid', { realmId, invoiceId });
      return res.status(200).send();
    }

    const totalAmt = Number(inv.TotalAmt || 0);
    if (!totalAmt) {
      throw new Error('Invoice TotalAmt is missing or zero');
    }

    const paymentRef =
      payload.orderId ||
      payload.orderid ||
      payload.transactionId ||
      payload.transactionid ||
      null;

    const paymentPayload = {
      CustomerRef: inv.CustomerRef,
      TotalAmt: totalAmt,
      Line: [
        {
          Amount: totalAmt,
          LinkedTxn: [{ TxnId: inv.Id, TxnType: 'Invoice' }],
        },
      ],
      PrivateNote: 'Paid via Wayl',
    };
    if (paymentRef) {
      paymentPayload.PaymentRefNum = String(paymentRef);
    }

    await createPayment(realmId, paymentPayload);
    console.log('Wayl webhook: marked invoice as paid via payment', {
      realmId,
      invoiceId,
      referenceId,
      status,
    });
  } catch (err) {
    console.warn('Wayl webhook: failed to mark invoice paid', {
      referenceId,
      error: err.message || String(err),
    });
  }

  res.status(200).send();
}

module.exports = {
  handleWaylWebhook,
};

