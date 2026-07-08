#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const { setSetting } = require('../src/services/settings');

async function main(){
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) throw new Error('detected json not found');
  const d = JSON.parse(fs.readFileSync(file,'utf8'));
  const map = {
    public_ip: 'vpn.host',
    xui_base_url: 'xui.base_url',
    xui_username: 'xui.username',
    xui_password: 'xui.password',
    xui_inbound_id: 'xui.inbound_id',
    xui_web_base_path: 'xui.web_base_path',
    vpn_port: 'vpn.port',
    vpn_public_key: 'vpn.public_key',
    vpn_private_key: 'vpn.private_key',
    vpn_short_id: 'vpn.short_id',
    vpn_sni: 'vpn.sni',
    vpn_display_name: 'vpn.display_name',
    vpn_region: 'vpn.region',
    white_vpn_host: 'white_vpn.host',
    white_vpn_port: 'white_vpn.port',
    white_vpn_public_key: 'white_vpn.public_key',
    white_vpn_private_key: 'white_vpn.private_key',
    white_vpn_short_id: 'white_vpn.short_id',
    white_vpn_sni: 'white_vpn.sni',
    white_vpn_display_name: 'white_vpn.display_name',
    white_vpn_region: 'white_vpn.region',
    xray_config_path: 'xray.config_path',
    xray_service: 'xray.service'
  };
  const secret = new Set(['xui.password','vpn.private_key','white_vpn.private_key']);
  await setSetting('xray.local_enabled', String(d.xray_local_enabled || 'true'), false);
  await setSetting('xui.enabled', 'false', false);
  await setSetting('vpn.security','reality',false);
  await setSetting('vpn.type','tcp',false);
  await setSetting('vpn.encryption','none',false);
  await setSetting('vpn.flow', d.vpn_flow || 'xtls-rprx-vision', false);
  await setSetting('vpn.fingerprint', d.vpn_fingerprint || 'chrome', false);
  await setSetting('vpn.spider_x', d.vpn_spider_x || '/', false);
  await setSetting('vpn.limit_ip', d.vpn_limit_ip || '0', false);
  await setSetting('vpn.total_gb', d.vpn_total_gb || '0', false);
  await setSetting('white_vpn.security','reality',false);
  await setSetting('white_vpn.type','tcp',false);
  await setSetting('white_vpn.encryption','none',false);
  await setSetting('white_vpn.flow', d.white_vpn_flow || d.vpn_flow || 'xtls-rprx-vision', false);
  await setSetting('white_vpn.fingerprint', d.white_vpn_fingerprint || d.vpn_fingerprint || 'chrome', false);
  await setSetting('white_vpn.spider_x', d.white_vpn_spider_x || d.vpn_spider_x || '/', false);
  for (const [src, key] of Object.entries(map)) {
    if (d[src] !== undefined && d[src] !== null && String(d[src]).trim() !== '') await setSetting(key, String(d[src]), secret.has(key));
  }
  console.log('Detected settings synced');
  process.exit(0);
}
main().catch(e=>{ console.error(e); process.exit(1); });
