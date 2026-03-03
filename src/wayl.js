const config = require('./config');

/**
 * Wayl API client — https://api.thewayl.com/reference
 * Auth: X-WAYL-AUTHENTICATION header. Amounts in IQD.
 * When apiKey is passed, it is used instead of the global config key (for per-merchant keys).
 */
const WAYL_API_BASE = config.wayl.apiBase || 'https://api.thewayl.com';

function getHeaders(apiKey) {
  const key = apiKey != null ? apiKey : config.wayl.apiKey;
  const headers = {
    'Content-Type': 'application/json',
  };
  if (key) {
    headers['X-WAYL-AUTHENTICATION'] = key;
  }
  return headers;
}

/**
 * Low-level request to Wayl API.
 * @param {string} [apiKey] - Merchant's Wayl API key; if omitted, uses WAYL_API_KEY from config (optional fallback).
 */
async function waylRequest(method, path, body = null, apiKey = null) {
  const url = path.startsWith('http') ? path : `${WAYL_API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: getHeaders(apiKey),
    ...(body != null && { body: JSON.stringify(body) }),
  });

  if (!res.ok) {
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = null;
    }
    const err = new Error(`Wayl API error ${res.status}: ${text}`);
    err.status = res.status;
    err.body = parsed || text;
    throw err;
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

/**
 * Verify that a Wayl API key is valid.
 * GET /api/v1/verify-auth-key
 * @param {string} [apiKey] - Key to verify; if omitted, uses config key.
 */
async function verifyAuth(apiKey = null) {
  return waylRequest('GET', '/api/v1/verify-auth-key', null, apiKey);
}

/**
 * Create a payment link (Wayl "Link").
 * POST /api/v1/links
 * Wayl only supports IQD; total is in IQD (minimum 1000).
 *
 * @param {object} options
 * @param {string} options.referenceId - Unique id for this link (max 255 chars)
 * @param {number} options.total - Total amount in IQD (min 1000)
 * @param {string} [options.apiKey] - Merchant's Wayl API key (for per-merchant keys)
 * @param {string} [options.currency='IQD'] - Must be IQD
 * @param {string} [options.customParameter] - Optional tracking/display
 * @param {Array<{label:string, amount:number, type:'increase', image?:string}>} [options.lineItem] - Line items; sum must equal total
 * @param {string} [options.webhookUrl] - URL for payment status webhooks
 * @param {string} [options.webhookSecret] - 10–255 chars, for webhook verification
 * @param {string} [options.redirectionUrl] - Redirect after success; referenceId and orderid appended as query params
 * @returns {Promise<{url: string, referenceId: string, ...}>} - data object including payment link url
 */
async function createPaymentLink(options) {
  const {
    referenceId,
    total,
    apiKey,
    currency = 'IQD',
    customParameter,
    lineItem,
    webhookUrl,
    webhookSecret,
    redirectionUrl,
  } = options;

  const totalNum = Math.round(Number(total));
  if (totalNum < 1000) {
    throw new Error('Wayl link total must be at least 1000 IQD');
  }

  // Wayl API requires lineItem (array), webhookUrl, webhookSecret, redirectionUrl.
  const baseLineItems = Array.isArray(lineItem) && lineItem.length > 0
    ? lineItem
    : [{ label: 'Invoice total', amount: totalNum, type: 'increase' }];
  const lineItems = baseLineItems.map((li) => ({
    ...li,
    image: li && typeof li.image === 'string' ? li.image : (config.wayl.lineItemImage || ''),
  }));
  const body = {
    referenceId: String(referenceId),
    total: totalNum,
    currency: (currency || 'IQD').toUpperCase(),
    lineItem: lineItems,
    webhookUrl: webhookUrl || config.wayl.webhookUrl || '',
    webhookSecret: webhookSecret || config.wayl.webhookSecret || '',
    redirectionUrl: redirectionUrl || config.wayl.redirectionUrl || '',
  };
  if (customParameter != null) body.customParameter = String(customParameter);

  const response = await waylRequest('POST', '/api/v1/links', body, apiKey);
  const data = response.data || response;
  return { ...data, rawResponse: response };
}

/**
 * Get a link by reference ID.
 * GET /api/v1/links/{referenceId}
 * @param {string} [apiKey] - Merchant's Wayl API key.
 */
async function getLink(referenceId, apiKey = null) {
  const response = await waylRequest('GET', `/api/v1/links/${encodeURIComponent(referenceId)}`, null, apiKey);
  return response.data || response;
}

/**
 * Invalidate a link (cancel unpaid).
 * POST /api/v1/links/{referenceId}/invalidate
 * @param {string} [apiKey] - Merchant's Wayl API key.
 */
async function invalidateLink(referenceId, apiKey = null) {
  const response = await waylRequest('POST', `/api/v1/links/${encodeURIComponent(referenceId)}/invalidate`, null, apiKey);
  return response.data || response;
}

module.exports = {
  waylRequest,
  verifyAuth,
  createPaymentLink,
  getLink,
  invalidateLink,
};
