const { query, one } = require('../config/db');

async function getSetting(key, fallback = '') {
  const row = await one('SELECT value FROM settings WHERE `key` = :key', { key });
  return row ? row.value : fallback;
}
async function setSetting(key, value, isSecret = false) {
  await query(`INSERT INTO settings(\`key\`, value, is_secret) VALUES(:key,:value,:isSecret)
    ON DUPLICATE KEY UPDATE value=VALUES(value), is_secret=VALUES(is_secret)`, { key, value: value ?? '', isSecret: isSecret ? 1 : 0 });
}
async function getSettingsMap() {
  const rows = await query('SELECT `key`, value, is_secret FROM settings ORDER BY `key`');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
async function getPublicSettings() {
  const rows = await query('SELECT `key`, value, is_secret FROM settings ORDER BY `key`');
  return rows.map(r => ({...r, value: r.is_secret ? (r.value ? '********' : '') : r.value}));
}
async function isInstalled() {
  const row = await one("SELECT value FROM settings WHERE `key`='app.installed'");
  return row?.value === 'true';
}
module.exports = { getSetting, setSetting, getSettingsMap, getPublicSettings, isInstalled };
