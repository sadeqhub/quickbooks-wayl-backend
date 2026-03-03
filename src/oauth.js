const OAuthClient = require('intuit-oauth');
const config = require('./config');
const { getToken, setToken } = require('./store');

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
 * Get authorization URL to redirect the user to Intuit sign-in.
 */
function getAuthUrl(state = 'qb_wayl_state') {
  const client = getOAuthClient();
  return client.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state,
  });
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
