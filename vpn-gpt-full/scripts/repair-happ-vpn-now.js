require('dotenv').config();
const fs = require('fs');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { query } = require('../src/config/db');
const { getSettingsMap, setSetting } = require('../src/services/settings');

function findXray() {
  const bins = ['/usr/local/bin/vpn-gpt-xray','/usr/local/bin/xray','/usr/bin/xray','/usr/local/x-ui/bin/xray-linux-amd64'];
  for (const b of bins) if (fs.existsSync(b)) return b;
  throw new Error('Xray binary not found. Запусти автонастройку VDS или установи Xray/3x-ui.');
}
function genKeys(bin) {
  const out = execFileSync(bin, ['x25519'], { encoding: 'utf8' });
  const privateKey = (out.match(/Private key:\s*([A-Za-z0-9_-]+)/i) || out.match(/PrivateKey:\s*([A-Za-z0-9_-]+)/i) || [])[1];
  const publicKey = (out.match(/Public key:\s*([A-Za-z0-9_-]+)/i) || out.match(/PublicKey:\s*([A-Za-z0-9_-]+)/i) || [])[1];
  if (!privateKey || !publicKey) throw new Error('Cannot parse x25519 output: ' + out);
  return { privateKey, publicKey };
}
function sid(){ return crypto.randomBytes(4).toString('hex'); }
function host(v){ return String(v||'astragate.su').replace(/^https?:\/\//,'').replace(/\/.*$/,'').trim(); }
function titleFor(type){ return type === 'white' ? '🇵🇱 AstraGate White • Premium' : '🇵🇱 AstraGate VPN • Premium'; }
function build({uuid, host, port, publicKey, shortId, sni, title}){
  const params = new URLSearchParams({ encryption:'none', type:'tcp', security:'reality', pbk:publicKey, fp:'chrome', sni, sid:shortId, spx:'/', flow:'xtls-rprx-vision' });
  return `vless://${uuid}@${host}:${port}?${params.toString()}#${encodeURIComponent(title)}`;
}
async function main(){
  const s = await getSettingsMap();
  const bin = findXray();
  const appUrl = String(s['app.url'] || 'https://astragate.su').replace(/\/+$/,'');
  const h = host(s['vpn.host'] || s['white_vpn.host'] || 'astragate.su');
  let mainPort = Number(s['vpn.port'] || 8443);
  let whitePort = Number(s['white_vpn.port'] || 8444);
  if (!Number.isFinite(mainPort) || mainPort <= 0) mainPort = 8443;
  if (!Number.isFinite(whitePort) || whitePort <= 0) whitePort = 8444;
  if (whitePort === mainPort) whitePort = mainPort === 8443 ? 8444 : mainPort + 1;
  const sni = s['vpn.sni'] || 'www.microsoft.com';
  const mainKeys = genKeys(bin), whiteKeys = genKeys(bin);
  const mainSid=sid(), whiteSid=sid();

  await setSetting('app.url', appUrl);
  await setSetting('app.support_text', 'Support: astragate.su');
  await setSetting('app.support_url', appUrl);
  await setSetting('happ.location_icon', '🇵🇱');
  await setSetting('vpn.display_name', 'AstraGate VPN');
  await setSetting('vpn.region', 'Premium');
  await setSetting('white_vpn.display_name', 'AstraGate White');
  await setSetting('white_vpn.region', 'Premium');
  await setSetting('vpn.host', h); await setSetting('vpn.port', String(mainPort)); await setSetting('vpn.public_key', mainKeys.publicKey); await setSetting('vpn.private_key', mainKeys.privateKey, true); await setSetting('vpn.short_id', mainSid); await setSetting('vpn.sni', sni);
  await setSetting('white_vpn.host', h); await setSetting('white_vpn.port', String(whitePort)); await setSetting('white_vpn.public_key', whiteKeys.publicKey); await setSetting('white_vpn.private_key', whiteKeys.privateKey, true); await setSetting('white_vpn.short_id', whiteSid); await setSetting('white_vpn.sni', sni);
  await setSetting('xray.local_enabled', 'true');
  await setSetting('xray.config_path', '/etc/vpn-gpt-xray/config.json');
  await setSetting('xray.service', 'vpn-gpt-xray');

  await query(`ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS subscription_url TEXT NULL`);
  await query(`ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS happ_url TEXT NULL`);
  await query(`ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS expires_at DATETIME NULL`);
  await query(`ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS total_gb INT NULL DEFAULT 0`);
  await query(`UPDATE vpn_accounts SET sub_token = LOWER(REPLACE(UUID(), '-', '')) WHERE sub_token IS NULL OR sub_token=''`);
  const accounts = await query(`SELECT * FROM vpn_accounts WHERE status='active' ORDER BY id ASC`);
  const mainClients=[], whiteClients=[];
  for (const acc of accounts) {
    const isWhite=acc.account_type === 'white';
    const vless=build({ uuid:acc.uuid, host:h, port:isWhite?whitePort:mainPort, publicKey:isWhite?whiteKeys.publicKey:mainKeys.publicKey, shortId:isWhite?whiteSid:mainSid, sni, title:titleFor(isWhite?'white':'main') });
    await query(`UPDATE vpn_accounts SET vless_url=:vless, server_label=:label, subscription_url=:sub, happ_url=:happ, updated_at=NOW() WHERE id=:id`, { id: acc.id, vless, label:titleFor(isWhite?'white':'main'), sub:`${appUrl}/sub/${acc.sub_token}`, happ:`${appUrl}/happ/${isWhite?'white':'main'}` });
    const client={ id: acc.uuid, flow:'xtls-rprx-vision', email:`${isWhite?'white':'main'}-${acc.user_id}-${acc.id}` };
    (isWhite?whiteClients:mainClients).push(client);
  }
  const config={ log:{loglevel:'warning'}, inbounds:[
    { tag:'vpn-gpt-main', listen:'0.0.0.0', port:mainPort, protocol:'vless', settings:{clients:mainClients,decryption:'none'}, streamSettings:{network:'tcp',security:'reality',realitySettings:{show:false,dest:`${sni}:443`,xver:0,serverNames:[sni],privateKey:mainKeys.privateKey,shortIds:[mainSid]}} },
    { tag:'vpn-gpt-white', listen:'0.0.0.0', port:whitePort, protocol:'vless', settings:{clients:whiteClients,decryption:'none'}, streamSettings:{network:'tcp',security:'reality',realitySettings:{show:false,dest:`${sni}:443`,xver:0,serverNames:[sni],privateKey:whiteKeys.privateKey,shortIds:[whiteSid]}} }
  ], outbounds:[{protocol:'freedom',tag:'direct'},{protocol:'blackhole',tag:'blocked'}] };
  fs.mkdirSync('/etc/vpn-gpt-xray',{recursive:true});
  fs.writeFileSync('/etc/vpn-gpt-xray/config.json', JSON.stringify(config,null,2));
  fs.writeFileSync('/etc/systemd/system/vpn-gpt-xray.service', `[Unit]\nDescription=AstraGate Xray Service\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=${bin} run -config /etc/vpn-gpt-xray/config.json\nRestart=always\nRestartSec=3\nLimitNOFILE=1048576\n\n[Install]\nWantedBy=multi-user.target\n`);
  console.log('OK repair completed');
  console.log(`Main ${h}:${mainPort} clients=${mainClients.length}`);
  console.log(`White ${h}:${whitePort} clients=${whiteClients.length}`);
}
main().then(()=>process.exit(0)).catch(e=>{ console.error(e); process.exit(1); });
