const express = require('express');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query, one } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { getActiveSubscription, getActiveVpnSubscription, getActiveWhiteVpnSubscription, getActiveGptSubscription, monthlyUsage, grantSubscription } = require('../services/subscriptions');
const { createOrGetVpn } = require('../services/vpn');
const { sendMessage, ensureChat, getChats, getChatMessages, renameChat, deleteChat, listActiveModels } = require('../services/gpt');
const { createYooMoneyPayment, createCryptoBotPayment } = require('../services/payments');
const { verifyBindCode, unlinkTelegram } = require('../services/telegram');
const { getSettingsMap } = require('../services/settings');
const { sendMail } = require('../services/mailer');
const { sendVerificationCode, confirmVerificationCode, hasClaimedTrial } = require('../services/emailVerification');
const router = express.Router();

const uploadRoot = path.join(process.cwd(), 'uploads', 'chat');
fs.mkdirSync(uploadRoot, { recursive: true });
const upload = multer({
  dest: uploadRoot,
  limits: { fileSize: 50 * 1024 * 1024, files: 10 }
});

function cleanHappTitle(value, fallback = 'AstraGate VPN') {
  const text = String(value || fallback)
    .replace(/[\r\n]/g, ' ')
    .replace(/[#?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || fallback).slice(0, 60);
}
function cleanHappFlag(value) {
  const v = String(value || '🇵🇱').replace(/[\r\n#?]/g, '').trim();
  return v || '🇵🇱';
}
function cleanShortText(value, fallback = '') {
  const text = String(value || fallback).replace(/[\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, 30);
}
function b64(text) { return Buffer.from(String(text || ''), 'utf8').toString('base64'); }
function happServerTitle(settings, accountType) {
  const icon = '🇵🇱';
  const base = accountType === 'white'
    ? String(settings['white_vpn.display_name'] || 'AstraGate White').trim()
    : String(settings['vpn.display_name'] || 'AstraGate VPN').trim();
  const region = accountType === 'white'
    ? String(settings['white_vpn.region'] || '').trim()
    : String(settings['vpn.region'] || 'Premium').trim();
  return cleanHappTitle(`${icon ? icon + ' ' : ''}${base}${region ? ' • ' + region : ''}`, '🇵🇱 AstraGate VPN');
}
function profileTitleForHapp(settings, accountType){
  return accountType === 'white' ? 'AstraGate White' : 'AstraGate';
}
function setVlessFragment(vlessUrl, title, description = '') {
  const base = String(vlessUrl || '').split('#')[0];
  // Для Happ оставляем title в теле подписки в читаемом виде. Так приложение лучше распознаёт emoji/flag как иконку локации.
  const safeTitle = cleanHappTitle(title);
  const desc = b64(cleanShortText(description, 'Наша поддержка: astragate.su'));
  return `${base}#${safeTitle}${desc ? `?serverDescription=${desc}` : ''}`;
}


router.get('/', async (req,res)=>{
  const plans = await query('SELECT * FROM plans WHERE is_active=1 ORDER BY sort_order, price');
  res.render('index',{title:'VPN + GPT', plans});
});
router.get('/dashboard', requireAuth, async (req,res)=>{
  const sub = await getActiveSubscription(req.session.user.id);
  const vpnSub = await getActiveVpnSubscription(req.session.user.id, false);
  const whiteVpnSub = await getActiveWhiteVpnSubscription(req.session.user.id);
  const gptSub = await getActiveGptSubscription(req.session.user.id);
  const vpn = vpnSub ? await one('SELECT * FROM vpn_accounts WHERE user_id=:id AND account_type="main" AND status="active"', {id:req.session.user.id}) : null;
  const whiteVpn = whiteVpnSub ? await one('SELECT * FROM vpn_accounts WHERE user_id=:id AND account_type="white" AND status="active"', {id:req.session.user.id}) : null;
  const profile = await one('SELECT * FROM users WHERE id=:id', {id:req.session.user.id});
  const usage = await monthlyUsage(req.session.user.id);
  const refStats = await one('SELECT COUNT(*) total, SUM(status=\"paid\") paid FROM referral_events WHERE referrer_user_id=:id', {id:req.session.user.id});
  const plans = await query('SELECT * FROM plans WHERE is_active=1 ORDER BY sort_order, price');
  const emailChange = await one('SELECT * FROM email_change_requests WHERE user_id=:id AND status="pending" AND expires_at>NOW() ORDER BY id DESC LIMIT 1', {id:req.session.user.id});
  const trialClaimed = await hasClaimedTrial(req.session.user.id);
  const s = await getSettingsMap();
  const siteBase = String(s['app.url'] || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const vpnSubUrl = vpn?.sub_token ? `${siteBase}/sub/${vpn.sub_token}` : '';
  const whiteVpnSubUrl = whiteVpn?.sub_token ? `${siteBase}/sub/${whiteVpn.sub_token}` : '';
  let qr = null; if(vpnSubUrl || vpn?.vless_url) qr = await QRCode.toDataURL(vpnSubUrl || vpn.vless_url);
  let whiteQr = null; if(whiteVpnSubUrl || whiteVpn?.vless_url) whiteQr = await QRCode.toDataURL(whiteVpnSubUrl || whiteVpn.vless_url);
  
  let telegramProxyConfig = {};
  try {
    const tgFile = '/root/astragate/telegram-proxy.json';
    if (fs.existsSync(tgFile)) telegramProxyConfig = JSON.parse(fs.readFileSync(tgFile, 'utf8'));
  } catch(e) {
    telegramProxyConfig = {};
  }

  res.render('dashboard',{title:'Кабинет', sub, vpnSub, whiteVpnSub, gptSub, vpn, whiteVpn, usage, qr, whiteQr, vpnSubUrl, whiteVpnSubUrl, profile, refStats, plans, emailChange, trialClaimed, telegramProxyConfig});
});

router.post('/email/verification/send', requireAuth, async (req,res)=>{
  try {
    const user = await one('SELECT * FROM users WHERE id=:id', { id:req.session.user.id });
    if(!user) throw new Error('Пользователь не найден');
    if(Number(user.email_verified) === 1) throw new Error('Почта уже подтверждена');
    await sendVerificationCode(user.id);
    req.flash('success','Код подтверждения отправлен на почту. Проверь входящие и спам.');
  } catch(e) { req.flash('error', e.message); }
  res.redirect('/dashboard');
});

router.post('/email/verification/confirm', requireAuth, async (req,res)=>{
  try {
    await confirmVerificationCode(req.session.user.id, req.body.email_code || '');
    req.flash('success','Почта подтверждена. Теперь можно получить пробный VPN + GPT на 1 день.');
  } catch(e) { req.flash('error', e.message); }
  res.redirect('/dashboard');
});

router.post('/trial/claim', requireAuth, async (req,res)=>{
  try {
    const user = await one('SELECT * FROM users WHERE id=:id', { id:req.session.user.id });
    if(!user) throw new Error('Пользователь не найден');
    if(await hasClaimedTrial(user.id)) throw new Error('Пробная подписка уже была получена');

    const settings = await getSettingsMap();
    if(settings['trial.enabled'] === 'false') throw new Error('Пробная подписка временно отключена');

    // Пробный доступ строго только после подтверждения почты.
    // Если почта ещё не подтверждена — код должен быть введён прямо в модальном окне.
    if(Number(user.email_verified) !== 1) {
      if(settings['smtp.enabled'] !== 'true' || !settings['smtp.host'] || !settings['smtp.user']) {
        throw new Error('SMTP не включён или не настроен. Подтверждение почты и пробный доступ недоступны.');
      }
      const emailCode = String(req.body.email_code || '').trim();
      if(!/^\d{6}$/.test(emailCode)) {
        throw new Error('Введи 6-значный код подтверждения из письма');
      }
      await confirmVerificationCode(user.id, emailCode);
    }

    const freshUser = await one('SELECT * FROM users WHERE id=:id', { id:user.id });
    if(Number(freshUser.email_verified) !== 1) throw new Error('Почта не подтверждена');

    const code = settings['trial.plan_code'] || 'trial-combo-day';
    const plan = await one('SELECT * FROM plans WHERE code=:code LIMIT 1', { code });
    if(!plan) throw new Error('Пробный тариф не найден. Запусти npm run seed.');
    await grantSubscription(user.id, plan.id, 'trial_email_verified');
    await query('INSERT INTO user_trial_claims(user_id,plan_id) VALUES(:uid,:pid)', { uid:user.id, pid:plan.id });
    await createOrGetVpn(req.session.user, true, 'main').catch(()=>{});
    req.flash('success','Пробная подписка VPN + GPT на 1 день выдана. VPN-ссылка появилась в разделе VPN.');
  } catch(e) { req.flash('error', e.message); }
  res.redirect('/dashboard#vpn');
});

router.get('/sub/:token', async (req,res)=>{
  const acc = await one(`SELECT v.*, a.ends_at, COALESCE(a.total_gb,0) total_gb
    FROM vpn_accounts v
    LEFT JOIN (
      SELECT s.user_id, s.ends_at, COALESCE(s.total_gb,p.total_gb,0) total_gb, p.white_vpn_enabled
      FROM subscriptions s
      JOIN plans p ON p.id=s.plan_id
      WHERE s.status='active' AND s.ends_at>NOW() AND p.vpn_enabled=1
    ) a ON a.user_id=v.user_id AND ((v.account_type='white' AND a.white_vpn_enabled=1) OR (v.account_type='main' AND COALESCE(a.white_vpn_enabled,0)=0))
    WHERE v.sub_token=:token AND v.status='active'
    ORDER BY a.ends_at DESC LIMIT 1`, {token:req.params.token});
  if(!acc || !acc.vless_url) return res.status(404).send('Subscription not found');

  const settings = await getSettingsMap();
  const supportUrl = String(settings['app.support_url'] || settings['app.url'] || 'https://astragate.su').replace(/\s+/g,'').trim();
  const supportTextFull = String(settings['app.support_text'] || 'Наша техподдержка: astragate.su').replace(/[\r\n]/g,' ').trim();
  const supportDesc = cleanShortText(supportTextFull, 'Наша поддержка: astragate.su');
  const serverTitle = happServerTitle(settings, acc.account_type);
  const profileTitle = profileTitleForHapp(settings, acc.account_type);
  const dynamicVless = setVlessFragment(acc.vless_url, serverTitle, supportDesc);

  const total = Number(acc.total_gb || 0) > 0 ? Math.floor(Number(acc.total_gb) * 1024 * 1024 * 1024) : 0;
  const expire = acc.ends_at ? Math.floor(new Date(acc.ends_at).getTime()/1000) : 0;
  const userinfo = `upload=0; download=0; total=${total}; expire=${expire}`;
  const announce = 'base64:' + b64(supportTextFull.slice(0, 200));

  res.status(200);
  res.type('text/plain; charset=utf-8');
  res.set('cache-control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('pragma','no-cache');
  res.set('expires','0');
  res.set('content-disposition', `attachment; filename="${profileTitle.replace(/[^a-zA-Z0-9_-]/g,'_')}.txt"`);

  // Дублируем параметры и в headers, и в body ровно в формате документации Happ.
  res.set('profile-title', profileTitle);
  res.set('profile-update-interval','1');
  res.set('subscription-userinfo', userinfo);
  res.set('support-url', supportUrl);
  res.set('profile-web-page-url', supportUrl);
  res.set('announce', announce);
  res.set('sub-info-text', supportTextFull.slice(0, 200));
  res.set('sub-info-color', 'blue');
  res.set('sub-info-button-text', 'Поддержка');
  res.set('sub-info-button-link', supportUrl);
  res.set('sub-expire','1');
  res.set('sub-expire-button-link', supportUrl);
  res.set('notification-subs-expire','1');
  res.set('subscriptions-collapse','0');
  res.set('subscriptions-expand-now','1');

  const body = [
    `#profile-title: ${profileTitle}`,
    '#profile-update-interval: 1',
    `#subscription-userinfo: ${userinfo}`,
    `#support-url: ${supportUrl}`,
    `#profile-web-page-url: ${supportUrl}`,
    `#announce: ${announce}`,
    `#sub-info-text: ${supportTextFull.slice(0, 200)}`,
    '#sub-info-color: blue',
    '#sub-info-button-text: Поддержка',
    `#sub-info-button-link: ${supportUrl}`,
    '#sub-expire: 1',
    `#sub-expire-button-link: ${supportUrl}`,
    '#notification-subs-expire: 1',
    '#subscriptions-collapse: 0',
    '#subscriptions-expand-now: 1',
    dynamicVless
  ].join('\n');
  res.send(body + '\n');
});
router.get('/happ/:type', requireAuth, async (req,res)=>{
  const type = req.params.type === 'white' ? 'white' : 'main';
  let acc = await one('SELECT * FROM vpn_accounts WHERE user_id=:id AND account_type=:type AND status="active"', {id:req.session.user.id, type});
  if(!acc?.sub_token){
    try { acc = await createOrGetVpn(req.session.user, true, type); }
    catch(e){ req.flash('error', e.message || 'Сначала создай или восстанови VPN-ссылку'); return res.redirect('/dashboard'); }
  }
  const settings = await getSettingsMap();
  const siteBase = String(settings['app.url'] || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const subUrl = `${siteBase}/sub/${acc.sub_token}`;
  const plainSubUrl = `${siteBase}/sub/${acc.sub_token}/plain`;
  const title = happServerTitle(settings, type);
  const qr = await QRCode.toDataURL(subUrl);
  res.render('happ_connect', { title:'Подключение Happ', subUrl, plainSubUrl, qr, vpnTitle:title });
});

router.post('/profile', requireAuth, async (req,res)=>{
  await query('UPDATE users SET name=:name, phone=:phone, telegram=:telegram, avatar_url=:avatar WHERE id=:id', {
    id:req.session.user.id, name:req.body.name||'', phone:req.body.phone||'', telegram:req.body.telegram||'', avatar:req.body.avatar_url||''
  });
  req.session.user.name = req.body.name || '';
  req.flash('success','Профиль сохранён');
  res.redirect('/dashboard');
});

router.post('/profile/password', requireAuth, async (req,res)=>{
  try {
    const current = String(req.body.current_password || '');
    const next = String(req.body.new_password || '');
    const repeat = String(req.body.repeat_password || '');
    if(next.length < 8) throw new Error('Новый пароль должен быть минимум 8 символов');
    if(next !== repeat) throw new Error('Новые пароли не совпадают');
    const u = await one('SELECT * FROM users WHERE id=:id', {id:req.session.user.id});
    const ok = await bcrypt.compare(current, u.password_hash);
    if(!ok) throw new Error('Старый пароль указан неверно');
    const hash = await bcrypt.hash(next, 12);
    await query('UPDATE users SET password_hash=:hash WHERE id=:id', {hash, id:req.session.user.id});
    req.flash('success','Пароль изменён');
  } catch(e) { req.flash('error', e.message); }
  res.redirect('/dashboard');
});

function makeCode(){ return String(crypto.randomInt(100000, 999999)); }
router.post('/profile/email/request', requireAuth, async (req,res)=>{
  try {
    const newEmail = String(req.body.new_email || '').trim().toLowerCase();
    if(!/^.+@.+\..+$/.test(newEmail)) throw new Error('Укажи корректную новую почту');
    const user = await one('SELECT * FROM users WHERE id=:id', {id:req.session.user.id});
    if(newEmail === String(user.email).toLowerCase()) throw new Error('Новая почта совпадает с текущей');
    const exists = await one('SELECT id FROM users WHERE email=:email AND id<>:id', {email:newEmail, id:user.id});
    if(exists) throw new Error('Эта почта уже используется');
    const oldCode = makeCode();
    const newCode = makeCode();
    await query('UPDATE email_change_requests SET status="cancelled" WHERE user_id=:id AND status="pending"', {id:user.id});
    await query(`INSERT INTO email_change_requests(user_id,old_email,new_email,old_code,new_code,expires_at)
      VALUES(:uid,:oldEmail,:newEmail,:oldCode,:newCode,DATE_ADD(NOW(), INTERVAL 30 MINUTE))`, {uid:user.id, oldEmail:user.email, newEmail, oldCode, newCode});
    await sendMail({userId:user.id, to:user.email, subject:'Код подтверждения смены почты', text:`Код для старой почты: ${oldCode}. Если это были не вы, срочно смените пароль. Код действует 30 минут.`});
    await sendMail({userId:user.id, to:newEmail, subject:'Код подтверждения новой почты', text:`Код для новой почты: ${newCode}. Код действует 30 минут.`});
    req.flash('success','Коды отправлены на старую и новую почту. Введи оба кода ниже.');
  } catch(e) { req.flash('error', e.message); }
  res.redirect('/dashboard');
});
router.post('/profile/email/confirm', requireAuth, async (req,res)=>{
  try {
    const oldCode = String(req.body.old_code || '').trim();
    const newCode = String(req.body.new_code || '').trim();
    const r = await one('SELECT * FROM email_change_requests WHERE user_id=:id AND status="pending" ORDER BY id DESC LIMIT 1', {id:req.session.user.id});
    if(!r) throw new Error('Нет активной заявки на смену почты');
    if(new Date(r.expires_at).getTime() < Date.now()) { await query('UPDATE email_change_requests SET status="expired" WHERE id=:id',{id:r.id}); throw new Error('Коды истекли, запроси новые'); }
    if(oldCode !== r.old_code || newCode !== r.new_code) throw new Error('Один из кодов указан неверно');
    const exists = await one('SELECT id FROM users WHERE email=:email AND id<>:id', {email:r.new_email, id:req.session.user.id});
    if(exists) throw new Error('Эта почта уже используется');
    await query('UPDATE users SET email=:email WHERE id=:id', {email:r.new_email, id:req.session.user.id});
    await query('UPDATE email_change_requests SET status="confirmed", confirmed_at=NOW() WHERE id=:id', {id:r.id});
    req.session.user.email = r.new_email;
    req.flash('success','Почта изменена');
  } catch(e) { req.flash('error', e.message); }
  res.redirect('/dashboard');
});
router.post('/profile/email/cancel', requireAuth, async (req,res)=>{
  await query('UPDATE email_change_requests SET status="cancelled" WHERE user_id=:id AND status="pending"', {id:req.session.user.id});
  req.flash('success','Смена почты отменена');
  res.redirect('/dashboard');
});
router.post('/profile/telegram-bind', requireAuth, async (req,res)=>{
  try {
    await verifyBindCode(req.session.user.id, req.body.telegram_code || '');
    const fresh = await one('SELECT telegram, telegram_chat_id, telegram_linked_at FROM users WHERE id=:id',{id:req.session.user.id});
    req.session.user.telegram = fresh.telegram;
    req.flash('success','Telegram привязан. Бот доступен в личных сообщениях.');
  } catch(e) { req.flash('error', e.message); }
  res.redirect('/dashboard');
});
router.post('/profile/telegram-unlink', requireAuth, async (req,res)=>{
  await unlinkTelegram(req.session.user.id);
  req.flash('success','Telegram отвязан.');
  res.redirect('/dashboard');
});
router.post('/vpn/create', requireAuth, async (req,res)=>{
  try { await createOrGetVpn(req.session.user, false, 'main'); req.flash('success','VPN-ссылка создана'); }
  catch(e){ req.flash('error',e.message); }
  res.redirect('/dashboard');
});
router.post('/vpn/create-white', requireAuth, async (req,res)=>{
  try { await createOrGetVpn(req.session.user, false, 'white'); req.flash('success','White VPN-ссылка создана'); }
  catch(e){ req.flash('error',e.message); }
  res.redirect('/dashboard');
});

async function renderChat(req, res, chatId) {
  const userId = req.session.user.id;
  const chats = await getChats(userId);
  let activeId = chatId || chats[0]?.id;
  let data = activeId ? await getChatMessages(userId, activeId) : null;
  if (!data) {
    const c = await ensureChat(userId, null, 'Новый чат');
    activeId = c.id;
    data = await getChatMessages(userId, activeId);
  }
  const models = await listActiveModels();
  res.render('chat',{ title:'GPT чат', chats, activeChat:data.chat, messages:data.messages, files:data.files, models });
}
router.get('/chat', requireAuth, async (req,res)=>renderChat(req,res,null));
router.post('/chat/new', requireAuth, async (req,res)=>{
  const c = await ensureChat(req.session.user.id, null, 'Новый чат');
  res.redirect(`/chat/${c.id}`);
});
router.get('/chat/:id', requireAuth, async (req,res)=>renderChat(req,res,req.params.id));
router.post('/chat/:id/rename', requireAuth, async (req,res)=>{ await renameChat(req.session.user.id, req.params.id, req.body.title || 'Чат'); res.redirect(`/chat/${req.params.id}`); });
router.post('/chat/:id/delete', requireAuth, async (req,res)=>{ await deleteChat(req.session.user.id, req.params.id); res.redirect('/chat'); });
router.post('/chat/:id', requireAuth, upload.array('files', 5), async (req,res)=>{
  try {
    const result = await sendMessage(req.session.user.id, req.params.id, req.body.message || '', req.files || [], req.body.model_code || '');
    res.redirect(`/chat/${result.chatId}`);
  } catch(e){
    req.flash('error',e.message);
    res.redirect(`/chat/${req.params.id}`);
  }
});
router.get('/files/:id/download', requireAuth, async (req,res)=>{
  const f = await one('SELECT * FROM ai_files WHERE id=:id AND user_id=:userId', { id:req.params.id, userId:req.session.user.id });
  if (!f || !fs.existsSync(f.file_path)) return res.status(404).render('error',{title:'404',message:'Файл не найден'});
  res.download(f.file_path, f.original_name);
});

router.post('/pay/:provider/:planId', requireAuth, async (req,res)=>{
  try{
    const plan = await one('SELECT * FROM plans WHERE id=:id AND is_active=1', {id:req.params.planId});
    if(!plan) throw new Error('Тариф не найден');
    let url;
    const fullUser = await one('SELECT * FROM users WHERE id=:id', {id:req.session.user.id});
    const promoCode = req.body.promo_code || '';
    if(req.params.provider === 'yoomoney') url = await createYooMoneyPayment(fullUser, plan, promoCode);
    else if(req.params.provider === 'cryptobot') url = await createCryptoBotPayment(fullUser, plan, promoCode);
    else throw new Error('Провайдер не поддерживается');
    res.redirect(url);
  }catch(e){req.flash('error',e.message);res.redirect('/');}
});
router.get('/payments/success',(req,res)=>res.render('payment_success',{title:'Оплата'}));
module.exports = router;
