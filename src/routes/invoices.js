const config = require('../config');
const { findInvoices, getInvoice, sendInvoicePdf, updateInvoice } = require('../quickbooks');
const { createPaymentLink, getLink, invalidateLink } = require('../wayl');
const { getToken, getWaylApiKey, getInvoiceNoteLang } = require('../store');

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
    const referenceId = `qb-invoice-${id}`;
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
    // Wayl requires lineItem array; send single line with total IQD.
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
      // If referenceId already used, invalidate old link and create a fresh one.
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
 * Creates a Wayl payment link, then sends the invoice PDF by email via QuickBooks (to BillEmail or sendTo).
 * Returns the payment link; the customer receives the invoice email from QuickBooks.
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
  const waylApiKey = getWaylApiKey(rId);
  if (!waylApiKey) {
    return res.status(400).json({
      error: 'Wayl API key not set. Add your key via POST /api/settings/wayl first.',
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
    const referenceId = `qb-invoice-${id}`;
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

    // Attach payment link into the invoice memo so it appears in the QB email.
    try {
      const original = inv;
      const lang = getInvoiceNoteLang(rId);
      let noteText;
      if (lang === 'ar') {
        // Arabic label, URL alone on its own line to avoid breaking the link.
        noteText = `\n\nرابط الدفع:\n${paymentUrl}\n`;
      } else if (lang === 'both') {
        // Bilingual label, single URL line (ASCII only) to keep the link intact.
        noteText = `\n\nPayment link / رابط الدفع:\n${paymentUrl}\n`;
      } else {
        // English only.
        noteText = `\n\nPayment link:\n${paymentUrl}\n`;
      }
      const updated = {
        ...original,
        Id: original.Id,
        SyncToken: original.SyncToken,
        // Use a clean, single-purpose memo for the payment link.
        CustomerMemo: {
          value: noteText,
        },
      };
      await updateInvoice(rId, updated);
    } catch (e) {
      console.warn('Failed to update invoice memo with payment link:', e.message || e);
    }

    const sent = await sendInvoicePdf(rId, id, sendTo || undefined);
    if (!sent) {
      return res.status(401).json({ error: 'Could not send invoice. Re-authorize at /auth if needed.' });
    }

    res.json({
      invoiceId: id,
      docNumber,
      totalIQD,
      invoiceCurrency,
      paymentLink: paymentUrl,
      referenceId: effectiveReferenceId,
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
  sendInvoiceWithPaymentLink,
};
