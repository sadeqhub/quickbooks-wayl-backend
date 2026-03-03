const QuickBooks = require('node-quickbooks');
const config = require('./config');
const { getValidToken } = require('./oauth');

/**
 * Create a node-quickbooks client for the given realm.
 * Uses stored tokens and refreshes if needed.
 * @param {string} realmId - QuickBooks company (realm) ID
 * @returns {Promise<QuickBooks|null>} - QuickBooks instance or null if not connected
 */
async function getQuickBooksClient(realmId) {
  const token = await getValidToken(realmId);
  if (!token) return null;

  const useSandbox = config.intuit.environment === 'sandbox';
  const qbo = new QuickBooks(
    config.intuit.clientId,
    config.intuit.clientSecret,
    token.access_token,
    false, // no token secret for OAuth 2.0
    realmId,
    useSandbox,
    false, // debug
    null,  // minorversion
    '2.0',
    token.refresh_token
  );

  return qbo;
}

/**
 * Promisify a node-quickbooks callback-style method.
 */
function promisifyQb(qbo, method, ...args) {
  return new Promise((resolve, reject) => {
    qbo[method](...args, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

/**
 * Fetch a single invoice by ID.
 */
async function getInvoice(realmId, invoiceId) {
  const qbo = await getQuickBooksClient(realmId);
  if (!qbo) return null;
  return promisifyQb(qbo, 'getInvoice', invoiceId);
}

/**
 * Query invoices (optional criteria).
 */
async function findInvoices(realmId, criteria = {}) {
  const qbo = await getQuickBooksClient(realmId);
  if (!qbo) return null;
  return promisifyQb(qbo, 'findInvoices', criteria);
}

/**
 * Update an invoice (requires Id and SyncToken).
 * Common use: add a note or custom field before emailing.
 * @param {string} realmId
 * @param {object} invoicePayload - Full invoice object to send to QB
 */
async function updateInvoice(realmId, invoicePayload) {
  const qbo = await getQuickBooksClient(realmId);
  if (!qbo) return null;
  return promisifyQb(qbo, 'updateInvoice', invoicePayload);
}

/**
 * Send invoice PDF by email via QuickBooks.
 * @param {string} realmId - Company (realm) ID
 * @param {string} invoiceId - Invoice ID
 * @param {string} [sendTo] - Optional email; if omitted, QB uses Invoice.BillEmail
 * @returns {Promise<object>} - Invoice object returned by QB
 */
async function sendInvoicePdf(realmId, invoiceId, sendTo) {
  const qbo = await getQuickBooksClient(realmId);
  if (!qbo) return null;
  return promisifyQb(qbo, 'sendInvoicePdf', invoiceId, sendTo || null);
}

module.exports = {
  getQuickBooksClient,
  getInvoice,
  findInvoices,
  updateInvoice,
  sendInvoicePdf,
  promisifyQb,
};
