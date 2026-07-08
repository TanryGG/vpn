#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const { execFileSync } = require('child_process');
const { query } = require('../src/config/db');
const { getSettingsMap, setSetting } = require('../src/services/settings');
const { createOrGetVpn, syncVpnAccess } = require('../src/services/vpn');

function sh(cmd, args, opts={}) { return execFileSync(cmd, args, { encoding:'utf8', stdio:['ignore','pipe','pipe'], ...opts }); }
function findXrayBin(){
  const bins=['/usr/local/bin/vpn-gpt-xray','/usr/local/x-ui/bin/xray-linux-amd64','/usr/local/x-ui/bin/xray','/usr/bin/xray','/usr/local/bin/xray'];
  for(const b of bins){ try{ if(fs.existsSync(b) && fs.statSync(b).mode & 0o111) return b; }catch(e){} }
  throw new Error('Xray binary не найден. Запусти автонастройку VDS.');
}
function genKeys(bin){
  const out=sh(bin,['x25519']);
  console.log(out.trim());
  const priv=(out.match(/Private\s*key:\s*([A-Za-z0-9_-]+)/i)||out.match(/PrivateKey:\s*([A-Za-z0-9_-]+)/i)||[])[1];
  const pub=(out.match(/Public\s*key:\s*([A-Za-z0-9_-]+)/i)||out.match(/PublicKey:\s*([A-Za-z0-9_-]+)/i)||[])[1];
  if(!priv || !pub) throw new Error('Не смог распарсить Reality keys из вывода Xray');
  return {priv,pub};
}
function randShort(){ return sh('openssl',['rand','-hex','4']).trim(); }
function inbound(tag, port, privateKey, sni, shortId, clients){
  return {
    tag, listen:'0.0.0.0', port:Number(port), protocol:'vless',
    settings:{ clients, decryption:'none' },
    streamSettings:{ network:'tcp', security:'reality', realitySettings:{ show:false, dest:`${sni}:443`, xver:0, serverNames:[sni], privateKey, minClient:'', maxClient:'', maxTimediff:0, shortIds:[shortId] }},
    sniffing:{ enabled:true, destOverride:['http','tls','quic'], metadataOnly:false, routeOnly:false }
  };
}
async function activeAccounts(type){
  return query(`
    SELECT v.*, u.id user_id2, u.email user_email, u.name user_name
    FROM vpn_accounts v
    JOIN users u ON u.id=v.user_id
    JOIN subscriptions sub ON sub.user_id=u.id AND sub.status='active' AND sub.ends_at>NOW()
    JOIN plans p ON p.id=sub.plan_id AND p.vpn_enabled=1
    WHERE v.account_type=:type AND ((:type='white' AND p.white_vpn_enabled=1) OR (:type='main' AND IFNULL(p.white_vpn_enabled,0)=0))
    GROUP BY v.id
  `,{type});
}
async function main(){
  const mode=process.argv[2]||'repair';
  const s=await getSettingsMap();
  const host=s['vpn.host']||s['public_ip']||process.env.PUBLIC_IP||'';
  const mainPort=Number(s['vpn.port']||8443);
  const whitePort=Number(s['white_vpn.port']||8444);
  if(mainPort===whitePort) throw new Error('Обычный VPN и White VPN не могут быть на одном порту. Поставь 8443 и 8444.');
  const sni=s['vpn.sni']||s['white_vpn.sni']||'www.microsoft.com';
  const bin=findXrayBin();
  console.log('Xray:',bin);
  let mainPriv=s['vpn.private_key']||'';
  let mainPub=s['vpn.public_key']||'';
  let whitePriv=s['white_vpn.private_key']||'';
  let whitePub=s['white_vpn.public_key']||'';
  if(!mainPriv || !mainPub){ console.log('Генерирую ключи обычного VPN'); const k=genKeys(bin); mainPriv=k.priv; mainPub=k.pub; }
  if(!whitePriv || !whitePub){ console.log('Генерирую ключи White VPN'); const k=genKeys(bin); whitePriv=k.priv; whitePub=k.pub; }
  let mainSid=s['vpn.short_id']||randShort();
  let whiteSid=s['white_vpn.short_id']||randShort();
  await setSetting('xray.local_enabled','true');
  await setSetting('xui.enabled','false');
  if(host) { await setSetting('vpn.host',host); await setSetting('white_vpn.host',host); }
  await setSetting('vpn.port',String(mainPort));
  await setSetting('white_vpn.port',String(whitePort));
  await setSetting('vpn.private_key',mainPriv,true); await setSetting('vpn.public_key',mainPub); await setSetting('vpn.short_id',mainSid); await setSetting('vpn.sni',sni);
  await setSetting('white_vpn.private_key',whitePriv,true); await setSetting('white_vpn.public_key',whitePub); await setSetting('white_vpn.short_id',whiteSid); await setSetting('white_vpn.sni',sni);
  await setSetting('vpn.flow','xtls-rprx-vision'); await setSetting('white_vpn.flow','xtls-rprx-vision');
  await setSetting('vpn.fingerprint','chrome'); await setSetting('white_vpn.fingerprint','chrome');
  await setSetting('vpn.spider_x','/'); await setSetting('white_vpn.spider_x','/');
  await setSetting('xray.config_path','/etc/vpn-gpt-xray/config.json'); await setSetting('xray.service','vpn-gpt-xray');

  fs.mkdirSync('/etc/vpn-gpt-xray',{recursive:true});
  try{ fs.copyFileSync(bin,'/usr/local/bin/vpn-gpt-xray'); fs.chmodSync('/usr/local/bin/vpn-gpt-xray',0o755); }catch(e){}

  const mainAccounts=await activeAccounts('main');
  const whiteAccounts=await activeAccounts('white');
  const clientsMain=mainAccounts.map(a=>({id:a.uuid,email:a.email_label,flow:s['vpn.flow']||'xtls-rprx-vision'}));
  const clientsWhite=whiteAccounts.map(a=>({id:a.uuid,email:a.email_label,flow:s['white_vpn.flow']||'xtls-rprx-vision'}));
  const cfg={log:{loglevel:'warning'},inbounds:[inbound('vpn-gpt-main',mainPort,mainPriv,sni,mainSid,clientsMain),inbound('vpn-gpt-white',whitePort,whitePriv,sni,whiteSid,clientsWhite)],outbounds:[{protocol:'freedom',tag:'direct'},{protocol:'blackhole',tag:'block'}]};
  fs.writeFileSync('/etc/vpn-gpt-xray/config.json',JSON.stringify(cfg,null,2));
  fs.writeFileSync('/etc/systemd/system/vpn-gpt-xray.service',`[Unit]\nDescription=VPN+GPT managed Xray Reality server\nAfter=network.target nss-lookup.target\n\n[Service]\nUser=root\nExecStart=/usr/local/bin/vpn-gpt-xray run -config /etc/vpn-gpt-xray/config.json\nRestart=on-failure\nRestartSec=3\nLimitNOFILE=1048576\n\n[Install]\nWantedBy=multi-user.target\n`);
  try{ sh('ufw',['allow',`${mainPort}/tcp`]); sh('ufw',['allow',`${whitePort}/tcp`]); }catch(e){}
  sh('systemctl',['daemon-reload']);
  sh('systemctl',['enable','vpn-gpt-xray']);
  sh('systemctl',['restart','vpn-gpt-xray']);
  try{ sh('systemctl',['is-active','--quiet','vpn-gpt-xray']); }catch(e){ console.error(sh('journalctl',['-u','vpn-gpt-xray','-n','100','--no-pager'])); throw new Error('vpn-gpt-xray не запустился'); }

  // Пересобираем ссылки тем, у кого есть активные подписки, и синхронизируем отключённых.
  const mainUsers=await query(`SELECT DISTINCT u.id,u.email,u.name FROM users u JOIN subscriptions sub ON sub.user_id=u.id AND sub.status='active' AND sub.ends_at>NOW() JOIN plans p ON p.id=sub.plan_id WHERE p.vpn_enabled=1 AND IFNULL(p.white_vpn_enabled,0)=0`);
  for(const u of mainUsers) await createOrGetVpn(u,true,'main');
  const whiteUsers=await query(`SELECT DISTINCT u.id,u.email,u.name FROM users u JOIN subscriptions sub ON sub.user_id=u.id AND sub.status='active' AND sub.ends_at>NOW() JOIN plans p ON p.id=sub.plan_id WHERE p.vpn_enabled=1 AND p.white_vpn_enabled=1`);
  for(const u of whiteUsers) await createOrGetVpn(u,true,'white');
  await syncVpnAccess();
  console.log('OK');
  console.log(`Обычный VPN: ${host}:${mainPort} clients=${mainUsers.length}`);
  console.log(`White VPN: ${host}:${whitePort} clients=${whiteUsers.length}`);
  process.exit(0);
}
main().catch(e=>{console.error('ERROR:',e.message); process.exit(1);});
