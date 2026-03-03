const OAuthClient = require('intuit-oauth');
const config = require('./config');
const { getToken, setToken } = require('./store');

const INTUIT_AUTHORIZE_ENDPOINT = 'https://appcenter.intuit.com/connect/oauth2';
const OAUTH_SCOPES = [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId];

let oauthClient = null;

function getOAuthClient() {
  if (!oauthClient) {
    oauthClient = new OAuthClient({
      clientId: config.intuit.clientId,
      clientSecret: config.intuit.clientSecret,
      environment: config.intuit.environment,
      redirectUri: config.intuit.redirectUri,
      logging: process.env.NODE_ENV !== 'production',
    });
  }
  return oauthClient;
}

/**
 * Build the QuickBooks OAuth authorization URL with all required query parameters.
 * Ensures client_id, response_type, scope, redirect_uri, and state are always present.
 */
function getAuthUrl(state = 'qb_wayl_state') {
  const { clientId, redirectUri } = config.intuit;

  if (!clientId || String(clientId).trim() === '') {
    throw new Error(
      'QuickBooks client_id is missing. Set INTUIT_CLIENT_ID or QUICKBOOKS_CLIENT_ID in your environment (e.g. .env or Porter/Netlify).'
    );
  }
  if (!redirectUri || String(redirectUri).trim() === '') {
    throw new Error(
      'QuickBooks redirect_uri is missing. Set INTUIT_REDIRECT_URI or QUICKBOOKS_REDIRECT_URI (must match the redirect URL in the QuickBooks developer portal).'
    );
  }

  const scope = OAUTH_SCOPES.join(' ');
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope,
    redirect_uri: redirectUri,
    state: state || 'qb_wayl_state',
  });

  return `${INTUIT_AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens and store by realmId.
 * @param {string} redirectUrl - Full redirect URL (e.g. req.url from callback)
 * @returns {Promise<{ realmId: string, token: object }>}
 */
async function exchangeCodeAndStore(redirectUrl) {
  const client = getOAuthClient();
  const authResponse = await client.createToken(redirectUrl);
  const token = authResponse.getToken();
  const realmId = token.realmId;
  const tokenData = {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_in: token.expires_in,
    x_refresh_token_expires_in: token.x_refresh_token_expires_in,
    token_type: token.token_type || 'bearer',
    realmId: token.realmId,
    createdAt: token.createdAt || Date.now(),
  };
  setToken(realmId, tokenData);
  return { realmId, token: tokenData };
}

/**
 * Get stored token for a realm; refresh if expired.
 */
async function getValidToken(realmId) {
  const stored = getToken(realmId);
  if (!stored) return null;

  const client = getOAuthClient();
  client.setToken({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    expires_in: stored.expires_in,
    x_refresh_token_expires_in: stored.x_refresh_token_expires_in,
    token_type: stored.token_type,
    realmId: stored.realmId,
    createdAt: stored.createdAt,
  });

  if (!client.isAccessTokenValid()) {
    const authResponse = await client.refresh();
    const token = authResponse.getToken();
    const tokenData = {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
      x_refresh_token_expires_in: token.x_refresh_token_expires_in,
      token_type: token.token_type || 'bearer',
      realmId: token.realmId,
      createdAt: token.createdAt || Date.now(),
    };
    setToken(realmId, tokenData);
    return tokenData;
  }

  return stored;
}

module.exports = {
  getOAuthClient,
  getAuthUrl,
  exchangeCodeAndStore,
  getValidToken,
};
