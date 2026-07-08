const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { getSettingsMap } = require('./settings');
const { query, one } = require('../config/db');
const { sendMessage } = require('./gpt');

const ROLE_LEVEL = { user:0, moderator:1, admin_l1:2, admin_l2:3, admin_l3:4, admin:5 };
let pollingStarted = false;
let pollingOffset = 0;
let pollingBusy = false;
let lastToken = '';

function escapeHtml(text='') {
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function truncate(text='', limit=900) {
  const s = String(text || '').trim();
  return s.length > limit ? s.slice(0, limit - 3) + '...' : s;
}
function roleLevel(role){ return ROLE_LEVEL[role] || 0; }
function isStaff(role){ return roleLevel(role) >= 1; }
async function getTelegramSettings() {
  const s = await getSettingsMap();
  return {
    enabled: s['telegram.support_enabled'] === 'true' || s['telegram.enabled'] === 'true',
    token: s['telegram.bot_token'] || '',
    fallbackChatId: s['telegram.chat_id'] || '',
    appUrl: String(s['app.url'] || 'https://astragate.su').replace(/\/+$/, ''),
  };
}
function inlineMenu(site='https://astragate.su') {
  return { reply_markup: { inline_keyboard: [
    [{ text:'✅ Подключить VPN', callback_data:'vpn' }, { text:'💵 Продлить', callback_data:'plans' }],
    [{ text:'🤖 GPT', callback_data:'gpt' }, { text:'💬 Техподдержка', callback_data:'support' }],
    [{ text:'🎁 Промокод', callback_data:'promo' }, { text:'👥 Пригласить', callback_data:'ref' }],
    [{ text:'⚙️ Настройки VPN', callback_data:'vpn_settings' }, { text:'📜 О сервисе', callback_data:'about' }],
    [{ text:'🌐 Наш сайт', url: site }]
  ] } };
}
function backMenu(site) { return { reply_markup: { inline_keyboard: [[{ text:'⬅️ Главное меню', callback_data:'menu' }], [{ text:'🌐 Открыть сайт', url: site }]] } }; }
async function sendToChat(chatId, text, extra={}) {
  const cfg = await getTelegramSettings();
  if (!cfg.enabled) return { skipped:true, reason:'disabled' };
  if (!cfg.token) return { skipped:true, reason:'no_token' };
  if (!chatId) return { skipped:true, reason:'no_chat' };
  const url = `https://api.telegram.org/bot${cfg.token}/sendMessage`;
  const res = await axios.post(url, { chat_id: chatId, text, parse_mode:'HTML', disable_web_page_preview:true, ...extra }, { timeout:12000 });
  return res.data;
}
async function answerCallback(token, callbackId, text='') {
  try { await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { callback_query_id: callbackId, text, show_alert:false }, { timeout:8000 }); } catch(e) {}
}
async function sendTelegramMessage(text, extra={}) {
  const cfg = await getTelegramSettings();
  if (!cfg.fallbackChatId) return { skipped:true, reason:'no_global_chat' };
  return sendToChat(cfg.fallbackChatId, text, extra);
}
async function getLinkedChatIdsByMinLevel(minLevel=1) {
  const rows = await query(`SELECT id,email,name,role,telegram_chat_id FROM users WHERE status='active' AND telegram_chat_id IS NOT NULL`);
  return rows.filter(r => r.telegram_chat_id && roleLevel(r.role) >= minLevel).map(r => ({...r, chat_id:String(r.telegram_chat_id)}));
}
async function sendToRole(minLevel, text, extra={}) {
  const cfg = await getTelegramSettings();
  if (!cfg.enabled) return { skipped:true, reason:'disabled' };
  const staff = await getLinkedChatIdsByMinLevel(minLevel);
  if (!staff.length) {
    if (cfg.fallbackChatId) return sendTelegramMessage(text, extra);
    return { skipped:true, reason:'no_staff_linked' };
  }
  const results=[];
  for (const s of staff) {
    try { results.push(await sendToChat(s.chat_id, text, extra)); }
    catch(e) { results.push({ ok:false, error:e.response?.data?.description || e.message, staff:s.email }); }
  }
  return results;
}
async function sendToStaff(text, extra={}) { return sendToRole(1, text, extra); }
async function sendToPaymentAdmins(text, extra={}) { return sendToRole(2, text, extra); }
async function testTelegram() {
  const cfg = await getTelegramSettings();
  const staff = await getLinkedChatIdsByMinLevel(1);
  if (staff.length) return sendToStaff('AstraGate: тестовое уведомление в личные сообщения привязанным сотрудникам.', inlineMenu(cfg.appUrl));
  if (cfg.fallbackChatId) return sendTelegramMessage('AstraGate: тестовое уведомление в общий chat ID.', inlineMenu(cfg.appUrl));
  throw new Error('Нет привязанных сотрудников и не указан общий Chat ID');
}
async function notifySupportTicketCreated({ ticketId, subject, message, user }) {
  const cfg = await getTelegramSettings();
  const name = user?.name || user?.email || `ID ${user?.id || ''}`;
  return sendToStaff(`<b>Новый тикет #${ticketId}</b>\n<b>Пользователь:</b> ${escapeHtml(name)}\n<b>Тема:</b> ${escapeHtml(subject)}\n<b>Сообщение:</b> ${escapeHtml(truncate(message))}`, inlineMenu(cfg.appUrl));
}
async function notifySupportUserReply({ ticketId, subject, message, user }) {
  const cfg = await getTelegramSettings();
  const name = user?.name || user?.email || `ID ${user?.id || ''}`;
  return sendToStaff(`<b>Ответ пользователя в тикете #${ticketId}</b>\n<b>Пользователь:</b> ${escapeHtml(name)}\n<b>Тема:</b> ${escapeHtml(subject || '')}\n<b>Сообщение:</b> ${escapeHtml(truncate(message))}`, inlineMenu(cfg.appUrl));
}
async function notifySupportStaffReply({ ticketId, subject, message, staff, internal=false }) {
  const cfg = await getTelegramSettings();
  const name = staff?.name || staff?.email || `ID ${staff?.id || ''}`;
  return sendToStaff(`<b>${internal ? 'Внутренняя заметка' : 'Ответ сотрудника'} в тикете #${ticketId}</b>\n<b>Сотрудник:</b> ${escapeHtml(name)}\n<b>Тема:</b> ${escapeHtml(subject || '')}\n<b>Сообщение:</b> ${escapeHtml(truncate(message))}`, inlineMenu(cfg.appUrl));
}
async function notifyPaymentPaid({ payment, user, plan }) {
  const cfg = await getTelegramSettings();
  const amount = `${payment?.amount || ''} ${payment?.currency || ''}`.trim();
  return sendToPaymentAdmins(`<b>Пополнение / оплата</b>\n<b>Пользователь:</b> ${escapeHtml(user?.email || user?.name || ('ID ' + payment.user_id))}\n<b>Тариф:</b> ${escapeHtml(plan?.name || ('ID ' + payment.plan_id))}\n<b>Сумма:</b> ${escapeHtml(amount)}\n<b>Провайдер:</b> ${escapeHtml(payment?.provider || '')}\n<b>ID платежа:</b> ${escapeHtml(payment?.provider_payment_id || payment?.id || '')}`, inlineMenu(cfg.appUrl));
}
function makeBindCode() { return String(crypto.randomInt(100000, 999999)); }
async function createBindCode(chat, from) {
  let code = makeBindCode();
  for (let i=0;i<5;i++) {
    try {
      await query('INSERT INTO telegram_bind_codes(code,chat_id,username,first_name,last_name,expires_at) VALUES(:code,:chat,:username,:first,:last,DATE_ADD(NOW(), INTERVAL 15 MINUTE))', { code, chat:chat.id, username:from?.username || '', first:from?.first_name || '', last:from?.last_name || '' });
      return code;
    } catch(e) { code = makeBindCode(); }
  }
  throw new Error('Не удалось создать код привязки');
}
async function verifyBindCode(userId, code) {
  const rows = await query('SELECT * FROM telegram_bind_codes WHERE code=:code AND used_at IS NULL AND expires_at>NOW() ORDER BY id DESC LIMIT 1', { code:String(code||'').trim() });
  const row = rows[0];
  if (!row) throw new Error('Код неверный или уже истёк. Получи новый код в боте.');
  await query('UPDATE users SET telegram_chat_id=:chat, telegram=:tg, telegram_linked_at=NOW() WHERE id=:uid', { chat:row.chat_id, tg:row.username ? '@'+row.username : String(row.chat_id), uid:userId });
  await query('UPDATE telegram_bind_codes SET used_by_user_id=:uid, used_at=NOW() WHERE id=:id', { uid:userId, id:row.id });
  return row;
}
async function unlinkTelegram(userId) { await query('UPDATE users SET telegram_chat_id=NULL, telegram_linked_at=NULL WHERE id=:uid', { uid:userId }); }
async function answerBot(token, chatId, text, extra={}) {
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id:chatId, text, parse_mode:'HTML', disable_web_page_preview:true, ...extra }, { timeout:12000 });
}
async function getUserByChat(chatId) { return one('SELECT * FROM users WHERE telegram_chat_id=:chat LIMIT 1', { chat:String(chatId) }); }
async function getMainVpnUrl(userId, type='main') {
  const s = await getTelegramSettings();
  const acc = await one('SELECT * FROM vpn_accounts WHERE user_id=:uid AND account_type=:type AND status="active" ORDER BY id DESC LIMIT 1', { uid:userId, type });
  if (!acc?.sub_token) return '';
  return `${s.appUrl}/sub/${acc.sub_token}`;
}
async function sendMainMenu(token, msg, user=null) {
  const cfg = await getTelegramSettings();
  const u = user || await getUserByChat(msg.chat.id);
  if (!u) {
    const code = await createBindCode(msg.chat, msg.from);
    return answerBot(token, msg.chat.id, `<b>AstraGate</b>\n\nКод привязки: <code>${code}</code>\n\nОткрой личный кабинет → Telegram и вставь код. После привязки бот покажет VPN, GPT, продление и поддержку.`, inlineMenu(cfg.appUrl));
  }
  const roleText = isStaff(u.role) ? '\n\nСотрудник: уведомления о тикетах и оплатах приходят сюда автоматически.' : '';
  return answerBot(token, msg.chat.id, `<b>Главное меню AstraGate</b>\nЦентр управления VPN и GPT\n\nАккаунт: ${escapeHtml(u.email)}${roleText}\n\nВыбери действие:`, inlineMenu(cfg.appUrl));
}

async function downloadTelegramAttachment(token, msg) {
  const file = msg.document || (msg.photo && msg.photo.length ? msg.photo[msg.photo.length - 1] : null);
  if (!file) return null;
  const fileId = file.file_id;
  const info = await axios.get(`https://api.telegram.org/bot${token}/getFile`, { params:{ file_id:fileId }, timeout:10000 });
  const filePath = info.data?.result?.file_path;
  if (!filePath) return null;
  const ext = path.extname(file.file_name || filePath) || (msg.photo ? '.jpg' : '.bin');
  const outPath = path.join(os.tmpdir(), `astragate-tg-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const res = await axios.get(url, { responseType:'arraybuffer', timeout:30000 });
  fs.writeFileSync(outPath, Buffer.from(res.data));
  return {
    path: outPath,
    originalname: file.file_name || (msg.photo ? 'telegram-photo.jpg' : path.basename(filePath)),
    mimetype: file.mime_type || (msg.photo ? 'image/jpeg' : 'application/octet-stream'),
    size: file.file_size || Buffer.byteLength(res.data)
  };
}
async function answerGptInTelegram(token, msg, user) {
  const text = String(msg.text || msg.caption || '').trim();
  const files = [];
  const f = await downloadTelegramAttachment(token, msg).catch(e => null);
  if (f) files.push(f);
  if (!text && !files.length) return false;
  await answerBot(token, msg.chat.id, 'GPT думает...');
  const result = await sendMessage(user.id, null, text || 'Посмотри прикреплённый файл.', files, '');
  const answer = truncate(result.answer || result.content || String(result), 3500);
  await answerBot(token, msg.chat.id, `<b>GPT</b>

${escapeHtml(answer)}`, inlineMenu((await getTelegramSettings()).appUrl));
  for (const x of files) { try { fs.unlinkSync(x.path); } catch(e) {} }
  return true;
}

async function sendSection(token, chatId, user, section) {
  const cfg = await getTelegramSettings();
  const site = cfg.appUrl;
  if (section === 'vpn') {
    const main = await getMainVpnUrl(user.id, 'main');
    const white = await getMainVpnUrl(user.id, 'white');
    const rows=[];
    if (main) rows.push([{ text:'Подключить обычный VPN', url: main }]);
    if (white) rows.push([{ text:'Подключить White VPN', url: white }]);
    rows.push([{ text:'Кабинет VPN', url: `${site}/dashboard` }], [{ text:'⬅️ Главное меню', callback_data:'menu' }]);
    let body = '<b>VPN</b>\n\n';
    if (main) body += `Обычный VPN:\n<code>${main}</code>\n\n`;
    if (white) body += `White VPN:\n<code>${white}</code>\n\n`;
    if (!main && !white) body += 'Активной VPN-ссылки нет. Продли подписку или создай VPN в кабинете.\n';
    return answerBot(token, chatId, body, { reply_markup:{ inline_keyboard: rows } });
  }
  if (section === 'plans') return answerBot(token, chatId, '<b>Продление подписки</b>\nВыбери тариф в кабинете. Там же можно ввести промокод и оплатить YooMoney/CryptoBot.', { reply_markup:{ inline_keyboard:[[{text:'Открыть тарифы', url:`${site}/dashboard`}], [{text:'⬅️ Главное меню', callback_data:'menu'}]] } });
  if (section === 'gpt') return answerBot(token, chatId, '<b>GPT</b>\nОткрывай чат, выбирай модель и отправляй файлы.', { reply_markup:{ inline_keyboard:[[{text:'Открыть GPT', url:`${site}/chat`}], [{text:'⬅️ Главное меню', callback_data:'menu'}]] } });
  if (section === 'support') return answerBot(token, chatId, '<b>Техподдержка</b>\nСоздай тикет или посмотри ответы поддержки.', { reply_markup:{ inline_keyboard:[[{text:'Открыть поддержку', url:`${site}/support`}], [{text:'⬅️ Главное меню', callback_data:'menu'}]] } });
  if (section === 'promo') return answerBot(token, chatId, '<b>Промокод</b>\nПромокод вводится в окне оплаты выбранного тарифа.', backMenu(site));
  if (section === 'ref') return answerBot(token, chatId, `<b>Рефералка</b>\nТвоя ссылка:\n<code>${site}/register?ref=${encodeURIComponent(user.referral_code || user.id)}</code>`, backMenu(site));
  if (section === 'vpn_settings') return answerBot(token, chatId, '<b>Настройки VPN</b>\nУправление подключением, QR и Happ-ссылкой находится в кабинете.', { reply_markup:{ inline_keyboard:[[{text:'Открыть кабинет', url:`${site}/dashboard`}], [{text:'⬅️ Главное меню', callback_data:'menu'}]] } });
  if (section === 'about') return answerBot(token, chatId, '<b>AstraGate</b> — сервис для VPN, GPT, подписок, файлов и поддержки.', backMenu(site));
}
async function handleUpdate(token, update) {
  const cb = update.callback_query;
  if (cb) {
    await answerCallback(token, cb.id);
    const msg = cb.message;
    const user = await getUserByChat(cb.from.id) || await getUserByChat(msg.chat.id);
    if (cb.data === 'menu') return sendMainMenu(token, msg, user);
    if (!user) return sendMainMenu(token, msg, null);
    return sendSection(token, msg.chat.id, user, cb.data);
  }
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat || !msg.from) return;
  const text = String(msg.text || '').trim();
  if (text.startsWith('/id')) return answerBot(token, msg.chat.id, `Ваш chat ID: <code>${msg.chat.id}</code>`);
  if (text.startsWith('/code')) {
    const code = await createBindCode(msg.chat, msg.from);
    return answerBot(token, msg.chat.id, `Код привязки AstraGate: <code>${code}</code>\nКод действует 15 минут.`, inlineMenu((await getTelegramSettings()).appUrl));
  }
  if (text.startsWith('/start') || text.startsWith('/menu')) return sendMainMenu(token, msg);
  const user = await getUserByChat(msg.chat.id);
  if (user) {
    if (text || msg.caption || msg.photo || msg.document) {
      try { return await answerGptInTelegram(token, msg, user); }
      catch(e) { return answerBot(token, msg.chat.id, 'GPT ошибка: ' + escapeHtml(e.message || 'неизвестная ошибка'), inlineMenu((await getTelegramSettings()).appUrl)); }
    }
    return sendMainMenu(token, msg, user);
  }
}
async function pollOnce() {
  const cfg = await getTelegramSettings();
  if (!cfg.token) return;
  if (lastToken && lastToken !== cfg.token) pollingOffset = 0;
  lastToken = cfg.token;
  const res = await axios.get(`https://api.telegram.org/bot${cfg.token}/getUpdates`, { params:{ timeout:1, offset: pollingOffset ? pollingOffset + 1 : undefined }, timeout:6000 });
  for (const upd of res.data?.result || []) {
    pollingOffset = Math.max(pollingOffset, upd.update_id);
    try { await handleUpdate(cfg.token, upd); } catch(e) { console.error('Telegram update error:', e.response?.data || e.message); }
  }
}
function startTelegramBotPolling() {
  if (pollingStarted) return;
  pollingStarted = true;
  setInterval(async()=>{
    if (pollingBusy) return;
    pollingBusy = true;
    try { await pollOnce(); }
    catch(e) { if (e.response?.data?.error_code !== 409) console.error('Telegram polling error:', e.response?.data || e.message); }
    finally { pollingBusy = false; }
  }, 3500);
  console.log('Telegram bot polling enabled inside vpn-gpt-full process');
}
module.exports = { sendTelegramMessage, sendToStaff, sendToChat, testTelegram, notifySupportTicketCreated, notifySupportUserReply, notifySupportStaffReply, notifyPaymentPaid, startTelegramBotPolling, verifyBindCode, unlinkTelegram };
