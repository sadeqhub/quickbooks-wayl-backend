/**
 * In-memory token store (keyed by realmId).
 * For production, replace with Redis or a database.
 * Wayl API keys are persisted to data/wayl-keys.json so they survive server restarts.
 */
const fs = require('fs');
const path = require('path');

const tokensByRealm = new Map();
const waylKeysPath = path.join(__dirname, '..', 'data', 'wayl-keys.json');
const noteLangPath = path.join(__dirname, '..', 'data', 'invoice-notes.json');

function loadWaylKeys() {
  const map = new Map();
  try {
    const dir = path.dirname(waylKeysPath);
    if (!fs.existsSync(dir)) return map;
    const raw = fs.readFileSync(waylKeysPath, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      for (const [realmId, key] of Object.entries(obj)) {
        if (realmId && key) map.set(realmId, String(key));
      }
    }
  } catch (_) {
    // file missing or invalid
  }
  return map;
}

function saveWaylKeys(map) {
  const dir = path.dirname(waylKeysPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const obj = Object.fromEntries(map);
  fs.writeFileSync(waylKeysPath, JSON.stringify(obj, null, 2), 'utf8');
}

const waylApiKeysByRealm = loadWaylKeys();

function loadNoteLangs() {
  const map = new Map();
  try {
    const dir = path.dirname(noteLangPath);
    if (!fs.existsSync(dir)) return map;
    const raw = fs.readFileSync(noteLangPath, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      for (const [realmId, lang] of Object.entries(obj)) {
        if (realmId && typeof lang === 'string') map.set(realmId, lang);
      }
    }
  } catch (_) {
    // ignore
  }
  return map;
}

function saveNoteLangs(map) {
  const dir = path.dirname(noteLangPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const obj = Object.fromEntries(map);
  fs.writeFileSync(noteLangPath, JSON.stringify(obj, null, 2), 'utf8');
}

const noteLangByRealm = loadNoteLangs();

const redirectTokensPath = path.join(__dirname, '..', 'data', 'redirect-tokens.json');

function loadRedirectTokens() {
  const map = new Map();
  try {
    const dir = path.dirname(redirectTokensPath);
    if (!fs.existsSync(dir)) return map;
    const raw = fs.readFileSync(redirectTokensPath, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      for (const [token, url] of Object.entries(obj)) {
        if (token && url) map.set(token, String(url));
      }
    }
  } catch (_) {}
  return map;
}

function saveRedirectTokens(map) {
  const dir = path.dirname(redirectTokensPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const obj = Object.fromEntries(map);
  fs.writeFileSync(redirectTokensPath, JSON.stringify(obj, null, 2), 'utf8');
}

const redirectTokens = loadRedirectTokens();

function generateRedirectToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 8; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

function setRedirectUrl(token, url) {
  redirectTokens.set(token, url);
  saveRedirectTokens(redirectTokens);
}

function getRedirectUrl(token) {
  return redirectTokens.get(token) || null;
}

function getToken(realmId) {
  return tokensByRealm.get(realmId) || null;
}

function setToken(realmId, token) {
  tokensByRealm.set(realmId, token);
}

function deleteToken(realmId) {
  tokensByRealm.delete(realmId);
}

function getAllRealms() {
  return Array.from(tokensByRealm.keys());
}

function getWaylApiKey(realmId) {
  return waylApiKeysByRealm.get(realmId) || null;
}

function setWaylApiKey(realmId, apiKey) {
  if (apiKey == null || String(apiKey).trim() === '') {
    waylApiKeysByRealm.delete(realmId);
  } else {
    waylApiKeysByRealm.set(realmId, String(apiKey).trim());
  }
  saveWaylKeys(waylApiKeysByRealm);
}

function deleteWaylApiKey(realmId) {
  waylApiKeysByRealm.delete(realmId);
  saveWaylKeys(waylApiKeysByRealm);
}

function getInvoiceNoteLang(realmId) {
  return noteLangByRealm.get(realmId) || 'both';
}

function setInvoiceNoteLang(realmId, lang) {
  if (!realmId) return;
  if (!lang) {
    noteLangByRealm.delete(realmId);
  } else {
    noteLangByRealm.set(realmId, lang);
  }
  saveNoteLangs(noteLangByRealm);
}

module.exports = {
  getToken,
  setToken,
  deleteToken,
  getAllRealms,
  getWaylApiKey,
  setWaylApiKey,
  deleteWaylApiKey,
  getInvoiceNoteLang,
  setInvoiceNoteLang,
  generateRedirectToken,
  setRedirectUrl,
  getRedirectUrl,
};
