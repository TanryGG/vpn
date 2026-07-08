const express = require('express');
const router = express.Router();
const { one } = require('../config/db');
const { getSettingsMap } = require('../services/settings');

function ascii(v) {
  return String(v || '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\r\n]/g, ' ')
    .trim();
}

function flagFromSettings(settings) {
  const raw = String(settings['happ.location_icon'] || '🇵🇱').trim();
  // Для Happ нужен именно флаг страны первым символом. Если сохранён не флаг — ставим Польшу.
  if (/^[\u{1F1E6}-\u{1F1FF}]{2}/u.test(raw)) return raw.slice(0, 4);
  return '🇵🇱';
}

function titleFor(settings, type) {
  const flag = flagFromSettings(settings);
  const base = type === 'white'
    ? String(settings['white_vpn.display_name'] || 'AstraGate White')
    : String(settings['vpn.display_name'] || 'AstraGate VPN');
  const region = type === 'white'
    ? String(settings['white_vpn.region'] || 'Premium')
    : String(settings['vpn.region'] || 'Premium');
  return `${flag} ${base}${region ? ' • ' + region : ''}`.replace(/[\r\n#?]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanBaseVless(url) {
  const input = String(url || '').trim();
  if (!input.startsWith('vless://')) return '';
  let base = input.split('#')[0];
  // Оставляем только валидные query-параметры VLESS. Никаких support/icon/serverDescription в query.
  base = base
    .replace(/([?&])(support|icon|serverDescription|subInfo|profile-title|subscription-userinfo|announce)=[^&#]+/gi, '$1')
    .replace(/[?&]$/, '')
    .replace('?&', '?');
  return base;
}

function buildVless(url, title) {
  const base = cleanBaseVless(url);
  if (!base) return '';
  // Важно: для флага в Happ флаг должен быть первым символом remark.
  // serverDescription не добавляем: он даёт лишние строки под подпиской и иногда ломает отображение.
  return `${base}#${encodeURIComponent(title)}`;
}

async function buildData(token) {
  const acc = await one(`SELECT * FROM vpn_accounts WHERE sub_token = :token AND status='active' LIMIT 1`, { token });
  if (!acc) return { status: 404, body: 'Subscription not found' };

  const settings = await getSettingsMap();
  const appUrl = String(settings['app.url'] || 'https://astragate.su').replace(/\/+$/, '');
  const supportUrl = String(settings['app.support_url'] || appUrl).replace(/[\r\n\s]/g, '').trim();
  const title = titleFor(settings, acc.account_type);
  const vless = buildVless(acc.vless_url || '', title);
  if (!vless) return { status: 404, body: 'VLESS url not found' };

  const sub = await one(
    `SELECT MAX(s.ends_at) AS ends_at,
            MAX(COALESCE(s.total_gb, p.total_gb, 0)) AS total_gb
     FROM subscriptions s
     LEFT JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id = :uid
       AND s.status = 'active'
       AND s.ends_at > NOW()`,
    { uid: acc.user_id }
  );

  const expire = sub && sub.ends_at ? Math.floor(new Date(sub.ends_at).getTime() / 1000) : 0;
  const totalBytes = sub && Number(sub.total_gb) > 0 ? Math.floor(Number(sub.total_gb) * 1024 * 1024 * 1024) : 0;
  const profileTitle = acc.account_type === 'white' ? 'AstraGate White' : 'AstraGate VPN';
  const userinfo = `upload=0; download=0; total=${totalBytes}; expire=${expire}`;

  return { status: 200, vless, profileTitle, appUrl, supportUrl, userinfo };
}

function setHeaders(res, data) {
  res.status(200);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('profile-title', ascii(data.profileTitle));
  res.setHeader('profile-update-interval', '12');
  res.setHeader('subscription-userinfo', data.userinfo);
  res.setHeader('support-url', ascii(data.supportUrl));
  res.setHeader('profile-web-page-url', ascii(data.appUrl));
  res.setHeader('sub-expire', '1');
  res.setHeader('notification-subs-expire', '1');
  res.setHeader('subscriptions-collapse', '0');
  res.setHeader('subscriptions-expand-now', '1');
}

function bodyWithMeta(data) {
  // Оставляем только одну кнопку "Поддержка". Убираем sub-info-text/announce,
  // чтобы не было дублирующихся строк сверху и снизу.
  return [
    `#profile-title: ${data.profileTitle}`,
    '#profile-update-interval: 12',
    `#subscription-userinfo: ${data.userinfo}`,
    `#support-url: ${data.supportUrl}`,
    `#profile-web-page-url: ${data.appUrl}`,
    '#sub-info-button-text: Поддержка',
    `#sub-info-button-link: ${data.supportUrl}`,
    '#sub-expire: 1',
    `#sub-expire-button-link: ${data.appUrl}/dashboard`,
    '#notification-subs-expire: 1',
    '#subscriptions-collapse: 0',
    '#subscriptions-expand-now: 1',
    data.vless
  ].join('\n') + '\n';
}

router.get('/:token', async (req, res) => {
  try {
    const data = await buildData(String(req.params.token || '').trim());
    if (data.status !== 200) return res.status(data.status).type('text/plain').send(data.body);
    setHeaders(res, data);
    return res.send(bodyWithMeta(data));
  } catch (e) {
    console.error('SUBFIX ERROR:', e);
    return res.status(500).type('text/plain').send('Subscription error: ' + e.message);
  }
});

router.get('/:token/plain', async (req, res) => {
  try {
    const data = await buildData(String(req.params.token || '').trim());
    if (data.status !== 200) return res.status(data.status).type('text/plain').send(data.body);
    setHeaders(res, data);
    return res.send(data.vless + '\n');
  } catch (e) {
    console.error('SUBFIX PLAIN ERROR:', e);
    return res.status(500).type('text/plain').send('Subscription error: ' + e.message);
  }
});

module.exports = router;
