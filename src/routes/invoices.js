const config = require('../config');
const { findInvoices, getInvoice, getInvoicePdf, sendInvoicePdf, updateInvoice } = require('../quickbooks');
const { createPaymentLink, getLink, invalidateLink } = require('../wayl');
const { getToken, getWaylApiKey, getInvoiceNoteLang } = require('../store');
const { isEnabled: isEmailEnabled, sendInvoiceEmail } = require('../email');

/**
 * Shared: resolve totalIQD for an invoice (body totalIQD, or IQD total, or USD_TO_IQD conversion).
 * Returns { totalIQD } or throws / returns null if invalid.
 */
function resolveTotalIQD(inv, body) {
  const invoiceCurrency = inv.CurrencyRef?.value || 'USD';
  const invoiceTotal = Number(inv.TotalAmt) || 0;
  const isIQD = String(invoiceCurrency).toUpperCase() === 'IQD';
  let totalIQD = null;
  if (body?.totalIQD != null && body.totalIQD !== '') {
    totalIQD = Math.round(Number(body.totalIQD));
  } else if (isIQD && invoiceTotal >= 1000) {
    totalIQD = Math.round(invoiceTotal);
  } else if (config.wayl.usdToIqd && config.wayl.usdToIqd > 0) {
    totalIQD = Math.round(invoiceTotal * config.wayl.usdToIqd);
  }
  if (totalIQD == null || totalIQD < 1000) return null;
  return { totalIQD, invoiceCurrency, invoiceTotal };
}

function buildWaylReferenceId(realmId, invoiceId) {
  return `qb-${realmId}-invoice-${invoiceId}`;
}

/**
 * GET /api/invoices?realmId=...
 * List invoices for the connected company.
 */
async function listInvoices(req, res) {
  const realmId = req.query.realmId;
  if (!realmId) {
    return res.status(400).json({ error: 'Missing realmId' });
  }
  if (!getToken(realmId)) {
    return res.status(401).json({ error: 'Not connected. Visit /auth first.' });
  }

  try {
    const result = await findInvoices(realmId, { limit: 50 });
    if (!result) {
      return res.status(401).json({ error: 'Could not connect to QuickBooks. Re-authorize at /auth.' });
    }
    const invoices = result.QueryResponse?.Invoice || [];
    res.json({ invoices });
  } catch (err) {
    console.error('List invoices error:', err);
    res.status(500).json({ error: err.message || 'Failed to list invoices' });
  }
}

/**
 * GET /api/invoices/:id?realmId=...
 * Get one invoice by ID.
 */
async function getOneInvoice(req, res) {
  const { id } = req.params;
  const realmId = req.query.realmId;
  if (!realmId) {
    return res.status(400).json({ error: 'Missing realmId' });
  }
  if (!getToken(realmId)) {
    return res.status(401).json({ error: 'Not connected. Visit /auth first.' });
  }

  try {
    const invoice = await getInvoice(realmId, id);
    if (!invoice) {
      return res.status(401).json({ error: 'Could not connect to QuickBooks.' });
    }
    res.json(invoice);
  } catch (err) {
    console.error('Get invoice error:', err);
    res.status(500).json({ error: err.message || 'Failed to get invoice' });
  }
}

/**
 * Shared: create a Wayl payment link for an invoice and update the invoice's CustomerMemo with the link.
 * Used by POST /api/invoices/:id/send-with-payment-link and by the Intuit webhook (new invoice created).
 * @param {string} realmId
 * @param {string} invoiceId
 * @param {object} [body] - Optional { totalIQD } for non-IQD or small amounts
 * @returns {Promise<{ paymentLink: string, docNumber: string, totalIQD: number, invoiceCurrency: string }>}
 * @throws if not connected, no Wayl key, invoice not found, or total < 1000 IQD
 */
async function createPaymentLinkForInvoiceAndUpdateMemo(realmId, invoiceId, body = {}) {
  if (!getToken(realmId)) {
    throw new Error('Not connected. Visit /auth first.');
  }
  const waylApiKey = getWaylApiKey(realmId);
  if (!waylApiKey) {
    throw new Error('Wayl API key not set for this company.');
  }

  const invoice = await getInvoice(realmId, invoiceId);
  if (!invoice) {
    throw new Error('Could not connect to QuickBooks.');
  }
  const inv = invoice?.Invoice || invoice;
  if (!inv || !inv.TotalAmt) {
    throw new Error('Invoice not found');
  }
  const docNumber = inv.DocNumber || invoiceId;
  const referenceId = buildWaylReferenceId(realmId, invoiceId);
  const resolved = resolveTotalIQD(inv, body);
  if (!resolved) {
    const invoiceCurrency = inv.CurrencyRef?.value || 'USD';
    const invoiceTotal = Number(inv.TotalAmt) || 0;
    throw new Error(`Wayl requires total >= 1000 IQD. Invoice is ${invoiceTotal} ${invoiceCurrency}. Set totalIQD or USD_TO_IQD.`);
  }
  const { totalIQD, invoiceCurrency } = resolved;

  const createOptions = {
    referenceId,
    total: totalIQD,
    currency: 'IQD',
    customParameter: docNumber,
    lineItem: [{ label: 'Invoice ' + docNumber, amount: totalIQD, type: 'increase', image: config.wayl.lineItemImage }],
    apiKey: waylApiKey,
  };

  let waylResponse;
  let paymentUrl;
  let effectiveReferenceId = referenceId;
  try {
    waylResponse = await createPaymentLink(createOptions);
    paymentUrl = waylResponse.url || waylResponse.rawResponse?.data?.url;
  } catch (err) {
    if (err && err.status === 409) {
      try {
        await invalidateLink(referenceId, waylApiKey);
      } catch (e) {
        console.warn('Failed to invalidate existing Wayl link for', referenceId, e.message || e);
      }
      effectiveReferenceId = `${referenceId}-${Date.now()}`;
      const retryOptions = { ...createOptions, referenceId: effectiveReferenceId };
      waylResponse = await createPaymentLink(retryOptions);
      paymentUrl = waylResponse.url || waylResponse.rawResponse?.data?.url;
    } else {
      throw err;
    }
  }

  const lang = getInvoiceNoteLang(realmId);
  let noteText;
  if (lang === 'ar') {
    noteText = `\n\nرابط الدفع عبر Wayl:\n${paymentUrl}\n`;
  } else if (lang === 'both') {
    noteText = `\n\nPay online via Wayl using this link / رابط الدفع عبر Wayl:\n${paymentUrl}\n`;
  } else {
    noteText = `\n\nPay online via Wayl using this link:\n${paymentUrl}\n`;
  }
  const updated = {
    ...inv,
    Id: inv.Id,
    SyncToken: inv.SyncToken,
    CustomerMemo: { value: noteText },
  };
  await updateInvoice(realmId, updated);

  return { paymentLink: paymentUrl, docNumber, totalIQD, invoiceCurrency, referenceId: effectiveReferenceId };
}

/**
 * POST /api/invoices/:id/payment-link
 * Body: { realmId }
 * Creates a Wayl payment link for the invoice total and returns the link.
 */
async function createInvoicePaymentLink(req, res) {
  const { id } = req.params;
  const { realmId } = req.body || req.query;
  const rId = realmId || req.query.realmId;
  if (!rId) {
    return res.status(400).json({ error: 'Missing realmId' });
  }
  if (!getToken(rId)) {
    return res.status(401).json({ error: 'Not connected. Visit /auth first.' });
  }
  const waylApiKey = getWaylApiKey(rId);
  if (!waylApiKey) {
    return res.status(400).json({
      error: 'Wayl API key not set. Add your key via POST /api/settings/wayl with body { realmId, apiKey }. Get your key from the Wayl merchant dashboard.',
    });
  }

  try {
    const invoice = await getInvoice(rId, id);
    if (!invoice) {
      return res.status(401).json({ error: 'Could not connect to QuickBooks.' });
    }
    const inv = invoice?.Invoice || invoice;
    if (!inv || !inv.TotalAmt) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const docNumber = inv.DocNumber || id;
    const resolved = resolveTotalIQD(inv, req.body);
    if (!resolved) {
      const invoiceCurrency = inv.CurrencyRef?.value || 'USD';
      const invoiceTotal = Number(inv.TotalAmt) || 0;
      return res.status(400).json({
        error: 'Wayl requires total >= 1000 IQD. Invoice is ' + invoiceTotal + ' ' + invoiceCurrency + '. Set totalIQD in the request body, or add USD_TO_IQD in .env to convert.',
        invoiceTotal,
        invoiceCurrency,
      });
    }
    const { totalIQD, invoiceCurrency } = resolved;
    const referenceId = buildWaylReferenceId(rId, id);
    const createOptions = {
      referenceId,
      total: totalIQD,
      currency: 'IQD',
      customParameter: docNumber,
      lineItem: [{ label: 'Invoice ' + docNumber, amount: totalIQD, type: 'increase', image: config.wayl.lineItemImage }],
      apiKey: waylApiKey,
    };

    let waylResponse;
    let paymentUrl;
    let effectiveReferenceId = referenceId;
    try {
      waylResponse = await createPaymentLink(createOptions);
      paymentUrl = waylResponse.url || waylResponse.rawResponse?.data?.url;
    } catch (err) {
      if (err && err.status === 409) {
        try {
          await invalidateLink(referenceId, waylApiKey);
        } catch (e) {
          console.warn('Failed to invalidate existing Wayl link for', referenceId, e.message || e);
        }
        effectiveReferenceId = `${referenceId}-${Date.now()}`;
        const retryOptions = { ...createOptions, referenceId: effectiveReferenceId };
        waylResponse = await createPaymentLink(retryOptions);
        paymentUrl = waylResponse.url || waylResponse.rawResponse?.data?.url;
      } else {
        throw err;
      }
    }

    res.json({
      invoiceId: id,
      docNumber,
      totalIQD,
      invoiceCurrency,
      paymentLink: paymentUrl,
      referenceId: effectiveReferenceId,
      waylResponse: waylResponse.rawResponse || waylResponse,
    });
  } catch (err) {
    console.error('Create payment link error:', err);
    res.status(500).json({ error: err.message || 'Failed to create payment link' });
  }
}

/**
 * POST /api/invoices/:id/send-with-payment-link
 * Body: { realmId, totalIQD?, sendTo? }
 * Creates a Wayl payment link, updates the invoice memo with the link, then sends the invoice PDF by email via QuickBooks.
 */
async function sendInvoiceWithPaymentLink(req, res) {
  const { id } = req.params;
  const { realmId, sendTo } = req.body || req.query;
  const rId = realmId || req.query.realmId;
  if (!rId) {
    return res.status(400).json({ error: 'Missing realmId' });
  }
  if (!getToken(rId)) {
    return res.status(401).json({ error: 'Not connected. Visit /auth first.' });
  }
  if (!getWaylApiKey(rId)) {
    return res.status(400).json({
      error: 'Wayl API key not set. Add your key via POST /api/settings/wayl first.',
    });
  }

  try {
    const { paymentLink, docNumber, totalIQD, invoiceCurrency, referenceId } =
      await createPaymentLinkForInvoiceAndUpdateMemo(rId, id, req.body || {});

    let sent = false;
    if (isEmailEnabled()) {
      try {
        const pdfBuffer = await getInvoicePdf(rId, id);
        if (pdfBuffer) {
          const invoice = await getInvoice(rId, id);
          const inv = invoice?.Invoice || invoice;
          const to = sendTo || inv?.BillEmail?.Address || inv?.BillEmail?.PlainAddress;
          if (to) {
            sent = await sendInvoiceEmail({ to, docNumber, paymentLink, pdfBuffer });
          }
        }
      } catch (e) {
        console.warn('Custom invoice email failed, falling back to QuickBooks send:', e.message || e);
      }
    }
    if (!sent) {
      sent = await sendInvoicePdf(rId, id, sendTo || undefined);
    }
    if (!sent) {
      return res.status(401).json({ error: 'Could not send invoice. Re-authorize at /auth if needed.' });
    }

    res.json({
      invoiceId: id,
      docNumber,
      totalIQD,
      invoiceCurrency,
      paymentLink,
      referenceId,
      sent: true,
      message: 'Invoice sent by email. Share the payment link with your customer.',
    });
  } catch (err) {
    console.error('Send invoice with payment link error:', err);
    res.status(500).json({ error: err.message || 'Failed to send invoice' });
  }
}

module.exports = {
  listInvoices,
  getOneInvoice,
  createInvoicePaymentLink,
  createPaymentLinkForInvoiceAndUpdateMemo,
  sendInvoiceWithPaymentLink,
};
