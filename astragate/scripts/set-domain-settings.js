#!/usr/bin/env node
require('dotenv').config();
const { setSetting } = require('../src/services/settings');
const { rebuildAllVpnLinks } = require('../src/services/vpn');
async function main(){
  const domain = String(process.argv[2] || '').trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'');
  if(!domain) throw new Error('domain required');
  const appUrl = `https://${domain}`;
  await setSetting('app.url', appUrl);
  await setSetting('app.domain', domain);
  await setSetting('app.icon_url', `${appUrl}/img/app-icon.png`);
  await setSetting('vpn.host', domain);
  await setSetting('white_vpn.host', domain);
  await setSetting('vpn.display_name', 'AstraGate VPN');
  await setSetting('white_vpn.display_name', 'AstraGate White');
  try { await rebuildAllVpnLinks('main'); } catch(e) { console.error('rebuild main warning:', e.message); }
  try { await rebuildAllVpnLinks('white'); } catch(e) { console.error('rebuild white warning:', e.message); }
  console.log('Domain settings saved and VPN links rebuilt');
  process.exit(0);
}
main().catch(e=>{ console.error(e); process.exit(1); });
