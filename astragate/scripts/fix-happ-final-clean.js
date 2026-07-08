require('dotenv').config();
const { query } = require('../src/config/db');
const { getSettingsMap, setSetting } = require('../src/services/settings');

function cleanBaseVless(url) {
  const input = String(url || '').trim();
  if (!input.startsWith('vless://')) return '';
  return input.split('#')[0]
    .replace(/([?&])(support|icon|serverDescription|subInfo|profile-title|subscription-userinfo|announce)=[^&#]+/gi, '$1')
    .replace(/[?&]$/, '')
    .replace('?&', '?');
}
function withTitle(vless, title) {
  const base = cleanBaseVless(vless);
  return base ? base + '#' + encodeURIComponent(title) : vless;
}
(async () => {
  const s = await getSettingsMap();
  const appUrl = String(s['app.url'] || 'https://astragate.su').replace(/\/+$/, '');
  const flag = '🇵🇱';
  await setSetting('happ.location_icon', flag);
  await setSetting('app.support_text', 'Support: astragate.su');
  await setSetting('app.support_url', appUrl);
  await query(`ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS subscription_url TEXT NULL`);
  await query(`ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS happ_url TEXT NULL`);
  await query(`UPDATE vpn_accounts SET sub_token = LOWER(REPLACE(UUID(), '-', '')) WHERE sub_token IS NULL OR sub_token=''`);
  const rows = await query(`SELECT id, account_type, vless_url FROM vpn_accounts WHERE vless_url IS NOT NULL AND vless_url != ''`);
  for (const r of rows) {
    const title = r.account_type === 'white' ? `${flag} AstraGate White • Premium` : `${flag} AstraGate VPN • Premium`;
    await query(
      `UPDATE vpn_accounts
       SET vless_url=:url,
           server_label=:title,
           subscription_url=CONCAT(:appUrl, '/sub/', sub_token),
           happ_url=CONCAT(:appUrl, '/happ/', account_type),
           updated_at=NOW()
       WHERE id=:id`,
      { id: r.id, url: withTitle(r.vless_url, title), title, appUrl }
    );
  }
  console.log('OK: Happ subscription cleaned, duplicated support text removed, flag title forced.');
})();
