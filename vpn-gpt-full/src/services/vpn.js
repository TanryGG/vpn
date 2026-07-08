const axios = require('axios');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { query, one } = require('../config/db');
const { getSettingsMap } = require('./settings');
const { getActiveVpnSubscription, getActiveWhiteVpnSubscription } = require('./subscriptions');

function cleanRemark(value, fallback = 'AstraGate') {
  const text = String(value || fallback)
    .replace(/[\r\n#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || fallback;
}

function fragmentDescription(text) {
  const value = String(text || '').trim().slice(0, 30);
  return Buffer.from(value, 'utf8').toString('base64');
}

function cleanClientEmail(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || `client-${Date.now()}`;
}

function isGraceActive(existing) {
  if (!existing || !existing.grace_until) return false;
  return new Date(existing.grace_until).getTime() > Date.now();
}

function buildServerName(user, s, accountType = 'main') {
  const icon = '🇵🇱';
  const baseName = accountType === 'white'
    ? cleanRemark(s['white_vpn.display_name'] || 'AstraGate White')
    : cleanRemark(s['vpn.display_name'] || s['vpn.remark'] || s['app.name'] || 'AstraGate VPN');
  const region = accountType === 'white'
    ? cleanRemark(s['white_vpn.region'] || s['vpn.region'] || 'White', '')
    : cleanRemark(s['vpn.region'] || s['vpn.country'] || '', '');
  const suffix = s['vpn.show_user_number'] === 'true' ? ` #${user.id}` : '';
  const name = `${baseName}${region ? ' • ' + region : ''}${suffix}`;
  // Happ показывает иконку локации из первого emoji/символа в названии сервера.
  // Поэтому добавляем аккуратный символ перед названием, без нестандартных VLESS-параметров.
  return cleanRemark(`${icon ? icon + ' ' : ''}${name}`, 'AstraGate VPN');
}

function makeSubToken() { return require('crypto').randomBytes(24).toString('hex'); }
function gbToBytes(gb) { const n = Number(gb || 0); return Number.isFinite(n) && n > 0 ? Math.floor(n * 1024 * 1024 * 1024) : 0; }

function buildVlessUrl(clientId, displayName, s, accountType = 'main') {
  const prefix = accountType === 'white' ? 'white_vpn.' : 'vpn.';
  const host = String(s[prefix+'host'] || s['vpn.host'] || '').trim() || 'vpn.example.com';
  const port = String(s[prefix+'port'] || s['vpn.port'] || '443').trim();
  const params = new URLSearchParams();

  params.set('encryption', s[prefix+'encryption'] || s['vpn.encryption'] || 'none');
  params.set('type', s[prefix+'type'] || s['vpn.type'] || 'tcp');
  params.set('security', s[prefix+'security'] || s['vpn.security'] || 'reality');

  if ((s[prefix+'security'] || s['vpn.security'] || 'reality') === 'reality') {
    params.set('pbk', s[prefix+'public_key'] || s['vpn.public_key'] || '');
    params.set('fp', s[prefix+'fingerprint'] || s['vpn.fingerprint'] || 'chrome');
    params.set('sni', s[prefix+'sni'] || s['vpn.sni'] || 'www.microsoft.com');
    params.set('sid', s[prefix+'short_id'] || s['vpn.short_id'] || '');
    params.set('spx', s[prefix+'spider_x'] || s['vpn.spider_x'] || '/');
  }

  const flow = s[prefix+'flow'] || s['vpn.flow'] || 'xtls-rprx-vision';
  if (flow) params.set('flow', flow);
  if (s['vpn.alpn']) params.set('alpn', s['vpn.alpn']);

  // Happ лучше принимает служебные данные через тело подписки, а не через query VLESS.
  // Нестандартные query-параметры support/icon ломали импорт у части версий Happ.
  const title = encodeURIComponent(cleanRemark(displayName).slice(0, 60));
  return `vless://${clientId}@${host}:${port}?${params.toString()}#${title}`;
}


function localXrayPaths(s) {
  return {
    configPath: String(s['xray.config_path'] || '/etc/vpn-gpt-xray/config.json'),
    service: String(s['xray.service'] || 'vpn-gpt-xray')
  };
}

function localRestart(service) {
  try { execFileSync('systemctl', ['restart', service], { stdio: 'ignore' }); } catch (e) { throw new Error(`Не удалось перезапустить ${service}: ${e.message}`); }
}

function localInboundIndex(cfg, accountType = 'main') {
  const tag = accountType === 'white' ? 'vpn-gpt-white' : 'vpn-gpt-main';
  const idx = (cfg.inbounds || []).findIndex(i => i.tag === tag);
  return idx >= 0 ? idx : 0;
}

function ensureLocalClientInConfig(s, client, accountType = 'main') {
  const { configPath, service } = localXrayPaths(s);
  if (!fs.existsSync(configPath)) throw new Error(`Локальный Xray config не найден: ${configPath}. Запусти /admin/vds → Полная автонастройка.`);
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const idx = localInboundIndex(cfg, accountType);
  if (!cfg.inbounds?.[idx]?.settings?.clients) throw new Error('В Xray config не найден clients для inbound ' + accountType);
  const clients = cfg.inbounds[idx].settings.clients;
  const exists = clients.find(c => c.id === client.id || c.email === client.email);
  if (!exists) {
    clients.push({
      id: client.id,
      email: client.email,
      flow: client.flow || 'xtls-rprx-vision'
    });
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    localRestart(service);
  }
  return true;
}


function removeLocalClientsFromConfig(s, accounts) {
  const { configPath, service } = localXrayPaths(s);
  if (!accounts.length) return 0;
  if (!fs.existsSync(configPath)) return 0;
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const ids = new Set(accounts.map(a => String(a.uuid || '')).filter(Boolean));
  const labels = new Set(accounts.map(a => String(a.email_label || '')).filter(Boolean));
  let removed = 0;
  for (const inbound of (cfg.inbounds || [])) {
    if (!inbound.settings?.clients) continue;
    const before = inbound.settings.clients.length;
    inbound.settings.clients = inbound.settings.clients.filter(c => !ids.has(String(c.id || '')) && !labels.has(String(c.email || '')));
    removed += before - inbound.settings.clients.length;
  }
  if (removed > 0) {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    localRestart(service);
  }
  return removed;
}

async function xuiDeleteClientBestEffort(s, account) {
  const inboundId = Number(s['xui.inbound_id'] || 0);
  if (!inboundId || !account?.uuid) return false;
  const client = await xuiLogin(s);
  const attempts = [
    ['post', `/panel/api/inbounds/${inboundId}/delClient/${account.uuid}`],
    ['post', `/panel/api/inbounds/delClient/${inboundId}/${account.uuid}`],
    ['get', `/panel/api/inbounds/${inboundId}/delClient/${account.uuid}`],
    ['get', `/panel/api/inbounds/delClient/${inboundId}/${account.uuid}`]
  ];
  for (const [method, url] of attempts) {
    try {
      const r = await client[method](url);
      if (r.status < 400 && r.data?.success !== false) return true;
    } catch (e) {}
  }
  return false;
}

async function revokeVpnAccounts(accounts, reasonLabel = 'Подписка не оплачена') {
  if (!accounts || accounts.length === 0) return { total: 0, localRemoved: 0, xuiRemoved: 0 };
  const s = await getSettingsMap();
  let localRemoved = 0;
  let xuiRemoved = 0;
  if (s['xray.local_enabled'] === 'true') {
    localRemoved = removeLocalClientsFromConfig(s, accounts);
  } else if (s['xui.enabled'] === 'true') {
    for (const acc of accounts) {
      try { if (await xuiDeleteClientBestEffort(s, acc)) xuiRemoved += 1; } catch (e) {}
    }
  }
  const label = encodeURIComponent(reasonLabel || s['vpn.expired_label'] || 'Подписка не оплачена');
  const ids = accounts.map(a => Number(a.id)).filter(Boolean);
  if (ids.length) {
    await query(`UPDATE vpn_accounts SET status='disabled', disabled_at=NOW(), grace_until=DATE_ADD(NOW(), INTERVAL 3 DAY), server_label=:plain, vless_url=CONCAT(SUBSTRING_INDEX(vless_url,'#',1),'#',:label) WHERE id IN (${ids.map((_,i)=>`:id${i}`).join(',')})`,
      Object.fromEntries([['plain', decodeURIComponent(label)], ['label', label], ...ids.map((id,i)=>[`id${i}`, id])])
    );
  }
  return { total: accounts.length, localRemoved, xuiRemoved };
}

async function findAccountsWithoutActiveSubscription(accountType = null) {
  const typeSql = accountType ? ' AND v.account_type=:accountType' : '';
  return query(`
    SELECT v.* FROM vpn_accounts v
    LEFT JOIN (
      SELECT DISTINCT s.user_id, CASE WHEN p.white_vpn_enabled=1 THEN 'white' ELSE 'main' END account_type
      FROM subscriptions s
      JOIN plans p ON p.id=s.plan_id
      WHERE s.status='active' AND s.ends_at>NOW() AND p.vpn_enabled=1
    ) a ON a.user_id=v.user_id AND a.account_type=v.account_type
    WHERE v.status='active' AND a.user_id IS NULL ${typeSql}
  `, accountType ? {accountType} : {});
}

async function syncVpnAccess(accountType = null) {
  const expiredAccounts = await findAccountsWithoutActiveSubscription(accountType);
  return revokeVpnAccounts(expiredAccounts, 'Подписка не оплачена');
}

async function revokeUserVpnAccess(userId, mode = 'all') {
  let typeSql = '';
  if (mode === 'vpn') typeSql = " AND account_type='main'";
  if (mode === 'white') typeSql = " AND account_type='white'";
  if (mode === 'gpt') return { total: 0, localRemoved: 0, xuiRemoved: 0 };
  const accounts = await query(`SELECT * FROM vpn_accounts WHERE user_id=:userId AND status='active' ${typeSql}`, { userId });
  return revokeVpnAccounts(accounts, 'Подписка не оплачена');
}

async function testLocalXrayConnection(s) {
  const { configPath, service } = localXrayPaths(s);
  if (!fs.existsSync(configPath)) throw new Error(`Локальный Xray config не найден: ${configPath}`);
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const port = (cfg.inbounds || []).map(i => `${i.tag || 'inbound'}:${i.port}`).join(', ');
  try { execFileSync('systemctl', ['is-active', '--quiet', service]); } catch (e) { throw new Error(`${service} не активен. Открой /admin/vds и запусти полную автонастройку.`); }
  const clients = (cfg.inbounds || []).reduce((n,i)=>n+(i.settings?.clients?.length||0),0);
  return { success: true, local: true, port, clients }; 
}

function getXuiBase(s) {
  const base = String(s['xui.base_url'] || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('3x-ui base URL не настроен');
  return base;
}

async function xuiLogin(s) {
  const base = getXuiBase(s);
  const username = s['xui.username'];
  const password = s['xui.password'];
  if (!username || !password) throw new Error('3x-ui username/password не настроены');

  const jar = axios.create({ baseURL: base, timeout: 20000, validateStatus: () => true });
  const body = new URLSearchParams({ username, password }).toString();
  const r = await jar.post('/login', body, { headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const cookie = r.headers['set-cookie']?.map(c => c.split(';')[0]).join('; ');
  if (!cookie || r.status >= 400 || r.data?.success === false) {
    throw new Error('Не удалось войти в 3x-ui: проверь URL, web base path, логин и пароль. Ответ: ' + JSON.stringify(r.data || r.status));
  }
  jar.defaults.headers.Cookie = cookie;
  return jar;
}

async function xuiAddClient(s, { inboundId, id, clientEmail, expiryTime = 0, totalGB = 0, limitIp = 0 }) {
  const client = await xuiLogin(s);
  const payload = {
    id: Number(inboundId),
    settings: JSON.stringify({
      clients: [{
        id,
        email: clientEmail,
        enable: true,
        flow: s['vpn.flow'] || 'xtls-rprx-vision',
        limitIp: Number(limitIp || s['vpn.limit_ip'] || 0),
        totalGB: Number(totalGB || 0),
        expiryTime: Number(expiryTime || 0),
        tgId: '',
        subId: cleanClientEmail(`sub-${clientEmail}`),
        reset: 0
      }]
    })
  };
  const r = await client.post('/panel/api/inbounds/addClient', payload, { headers: { 'content-type': 'application/json' } });
  if (r.status >= 400 || r.data?.success === false) {
    throw new Error('3x-ui addClient error: ' + JSON.stringify(r.data || r.status));
  }
  return r.data;
}

async function testXuiConnection() {
  const s = await getSettingsMap();
  if (s['xray.local_enabled'] === 'true') return testLocalXrayConnection(s);
  const inboundId = Number(s['xui.inbound_id'] || 0);
  if (!inboundId) throw new Error('xui.inbound_id не настроен');
  const client = await xuiLogin(s);
  const r = await client.get(`/panel/api/inbounds/get/${inboundId}`);
  if (r.status >= 400 || r.data?.success === false) {
    throw new Error('3x-ui inbound не найден или API ответил ошибкой: ' + JSON.stringify(r.data || r.status));
  }
  return r.data;
}

async function createOrGetVpn(user, force = false, accountType = 'main') {
  const sub = accountType === 'white' ? await getActiveWhiteVpnSubscription(user.id) : await getActiveVpnSubscription(user.id, false);
  if (!sub) throw new Error(accountType === 'white' ? 'Нужна активная подписка White VPN' : 'Нужна активная подписка с VPN');

  const s = await getSettingsMap();
  const existing = await one('SELECT * FROM vpn_accounts WHERE user_id=:id AND account_type=:type', { id: user.id, type: accountType });
  if (existing && existing.status === 'active' && !force) return existing;

  const reuseOld = existing && (existing.status === 'active' || isGraceActive(existing));
  const id = reuseOld ? existing.uuid : uuidv4();
  const clientEmail = reuseOld ? existing.email_label : cleanClientEmail(`${accountType === 'white' ? 'white' : 'vpn'}-gpt-u${user.id}-${id.slice(0, 8)}`);
  const subToken = existing?.sub_token || makeSubToken();
  const displayName = buildServerName(user, s, accountType);
  const vless = buildVlessUrl(id, displayName, s, accountType);

  if (s['xray.local_enabled'] === 'true') {
    ensureLocalClientInConfig(s, { id, email: clientEmail, flow: s[accountType === 'white' ? 'white_vpn.flow' : 'vpn.flow'] || s['vpn.flow'] || 'xtls-rprx-vision' }, accountType);
  } else if (s['xui.enabled'] === 'true') {
    const inboundId = Number(s['xui.inbound_id'] || 0);
    if (!inboundId) throw new Error('xui.inbound_id не настроен');
    let expiryTime = 0;
    if (sub.ends_at) expiryTime = new Date(sub.ends_at).getTime();
    if (!existing || existing.status !== 'active' || force) {
      await xuiAddClient(s, { inboundId, id, clientEmail, expiryTime, totalGB: gbToBytes(sub.total_gb || s['vpn.total_gb'] || 0), limitIp: Number(sub.device_limit || 1) });
    }
  }

  if (existing) {
    await query('UPDATE vpn_accounts SET uuid=:uuid, email_label=:label, vless_url=:url, server_label=:serverLabel, sub_token=:subToken, status="active", disabled_at=NULL, grace_until=NULL WHERE user_id=:userId AND account_type=:accountType', {
      userId: user.id, accountType, serverLabel: displayName,
      uuid: id,
      label: clientEmail,
      url: vless,
      subToken
    });
  } else {
    await query('INSERT INTO vpn_accounts(user_id,uuid,email_label,vless_url,account_type,server_label,sub_token,status) VALUES(:userId,:uuid,:label,:url,:accountType,:serverLabel,:subToken,"active")', {
      userId: user.id,
      uuid: id,
      label: clientEmail,
      url: vless,
      accountType,
      serverLabel: displayName,
      subToken
    });
  }
  return one('SELECT * FROM vpn_accounts WHERE user_id=:id AND account_type=:accountType', { id: user.id, accountType });
}

async function rebuildAllVpnLinks(accountType = 'main') {
  const users = await query('SELECT DISTINCT u.id,u.email,u.name FROM users u JOIN vpn_accounts v ON v.user_id=u.id WHERE v.account_type=:type', {type: accountType});
  let ok = 0;
  for (const user of users) {
    await createOrGetVpn(user, true, accountType);
    ok += 1;
  }
  return ok;
}
async function markExpiredLinks() {
  return syncVpnAccess();
}


module.exports = { createOrGetVpn, buildVlessUrl, testXuiConnection, rebuildAllVpnLinks, markExpiredLinks, syncVpnAccess, revokeUserVpnAccess, revokeVpnAccounts };
