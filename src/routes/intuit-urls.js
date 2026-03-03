const config = require('../config');

/**
 * GET /api/intuit/urls
 * Returns URLs to configure in the Intuit Developer portal (Keys & OAuth / App URLs).
 *
 * - hostDomain: Customer-facing domain, no "https://" (e.g. myapp.com or localhost:8000).
 * - launchUrl: Where customers go after they authenticate (Launch URL). Include "https://".
 * - disconnectUrl: Where customers go when disconnecting from the app. Include "https://".
 * - connectReconnectUrl: Where customers go when connecting or reconnecting. Include "https://".
 */
function getIntuitUrls(req, res) {
  const base = config.appBaseUrl.replace(/^https?:\/\//, '');
  const launchUrl = `${config.appBaseUrl.replace(/\/$/, '')}/app`;
  const disconnectUrl = `${config.appBaseUrl.replace(/\/$/, '')}/disconnected`;
  const connectReconnectUrl = `${config.appBaseUrl.replace(/\/$/, '')}/auth`;

  res.json({
    hostDomain: base,
    launchUrl,
    disconnectUrl,
    connectReconnectUrl,
  });
}

module.exports = {
  getIntuitUrls,
};
