const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const OpenAI = require('openai');
const { getSetting } = require('./settings');
const { query, one } = require('../config/db');
const { getActiveGptSubscription, monthlyUsage } = require('./subscriptions');

const MAX_HISTORY = 30;
const MAX_INLINE_FILE_BYTES = 18 * 1024 * 1024;
const MAX_ARCHIVE_TEXT_BYTES = 600000;
const TEXT_MIMES = new Set(['text/plain','text/markdown','text/csv','application/json','application/xml','text/xml','application/javascript','text/javascript','text/html','text/css']);
function safeTitle(text) { const t = String(text || '').replace(/\s+/g, ' ').trim(); return (t || 'Новый чат').slice(0, 80); }
function dataUri(file) { const data = fs.readFileSync(file.path).toString('base64'); return `data:${file.mimetype || 'application/octet-stream'};base64,${data}`; }
function readTextFile(file) { try { const data = fs.readFileSync(file.path); if (data.length > 500000) return data.subarray(0, 500000).toString('utf8') + '\n\n[Файл обрезан до 500 KB текста]'; return data.toString('utf8'); } catch { return ''; } }
function readZipSummary(file) {
  try {
    const zip = new AdmZip(file.path);
    const entries = zip.getEntries().filter(e => !e.isDirectory).slice(0, 30);
    let out = `[Архив: ${file.originalname}]\nФайлов внутри: ${entries.length}\n`;
    let used = 0;
    for (const e of entries) {
      out += `\n--- ${e.entryName} (${e.header.size} bytes) ---\n`;
      if (/\.(txt|md|csv|json|xml|html|css|js|ts|log|py|php|java|go|rs|cpp|c|sql|yaml|yml)$/i.test(e.entryName)) {
        const txt = e.getData().toString('utf8');
        const chunk = txt.slice(0, Math.max(0, 120000 - used));
        out += chunk + (txt.length > chunk.length ? '\n[Файл внутри архива обрезан]' : '') + '\n';
        used += Buffer.byteLength(chunk);
        if (used > MAX_ARCHIVE_TEXT_BYTES) { out += '\n[Архив обрезан по общему лимиту текста]\n'; break; }
      } else {
        out += '[Бинарный файл: содержимое не вставлено, но имя и размер переданы модели]\n';
      }
    }
    return out;
  } catch (e) { return `[Архив ${file.originalname} не удалось прочитать: ${e.message}]`; }
}
function buildFileParts(files) {
  const parts = [];
  for (const file of files || []) {
    const mime = file.mimetype || 'application/octet-stream';
    const name = file.originalname || '';
    if (/\.zip$/i.test(name) || mime === 'application/zip' || mime === 'application/x-zip-compressed') {
      parts.push({ type: 'text', text: readZipSummary(file) });
      continue;
    }
    if (file.size > MAX_INLINE_FILE_BYTES) { parts.push({ type: 'text', text: `[Файл ${name} не отправлен в модель: размер больше лимита]` }); continue; }
    if (mime.startsWith('image/')) parts.push({ type: 'image_url', image_url: { url: dataUri(file) } });
    else if (TEXT_MIMES.has(mime) || /\.(txt|md|csv|json|xml|html|css|js|ts|log|sql|yaml|yml|py|php|java|go|rs|cpp|c)$/i.test(name)) parts.push({ type: 'text', text: `\n\n[Файл: ${name}]\n${readTextFile(file)}` });
    else parts.push({ type: 'file', file: { filename: name, file_data: dataUri(file) } });
  }
  return parts;
}
async function listActiveModels() { return await query('SELECT * FROM ai_models WHERE is_active=1 ORDER BY sort_order, id'); }
async function getModelByCode(code) {
  let m = code ? await one('SELECT * FROM ai_models WHERE code=:code AND is_active=1', { code }) : null;
  if (!m) {
    const def = await getSetting('ai.default_model_code','gpt-5.4-mini');
    m = await one('SELECT * FROM ai_models WHERE code=:code AND is_active=1', { code: def });
  }
  if (!m) m = await one('SELECT * FROM ai_models WHERE is_active=1 ORDER BY sort_order LIMIT 1');
  return m;
}
async function ensureChat(userId, chatId, firstMessage='') {
  if (chatId) { const row = await one('SELECT * FROM ai_chats WHERE id=:id AND user_id=:userId', { id: chatId, userId }); if (row) return row; }
  const title = safeTitle(firstMessage);
  const r = await query('INSERT INTO ai_chats(user_id,title) VALUES(:userId,:title)', { userId, title });
  return await one('SELECT * FROM ai_chats WHERE id=:id AND user_id=:userId', { id: r.insertId, userId });
}
async function getChats(userId) { return await query(`SELECT c.*, (SELECT content FROM ai_messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) last_message FROM ai_chats c WHERE c.user_id=:userId ORDER BY c.updated_at DESC, c.id DESC`, { userId }); }
async function getChatMessages(userId, chatId) {
  const chat = await one('SELECT * FROM ai_chats WHERE id=:chatId AND user_id=:userId', { chatId, userId }); if (!chat) return null;
  const messages = await query('SELECT * FROM ai_messages WHERE chat_id=:chatId AND user_id=:userId ORDER BY id ASC', { chatId, userId });
  const files = await query('SELECT * FROM ai_files WHERE chat_id=:chatId AND user_id=:userId ORDER BY id ASC', { chatId, userId });
  return { chat, messages, files };
}
async function renameChat(userId, chatId, title) { await query('UPDATE ai_chats SET title=:title WHERE id=:chatId AND user_id=:userId', { title: safeTitle(title), chatId, userId }); }
async function deleteChat(userId, chatId) { await query('DELETE FROM ai_chats WHERE id=:chatId AND user_id=:userId', { chatId, userId }); }
async function saveUploadedFiles({ userId, chatId, messageId, files }) { for (const f of files || []) await query(`INSERT INTO ai_files(chat_id,message_id,user_id,role,original_name,stored_name,mime_type,size_bytes,file_path) VALUES(:chatId,:messageId,:userId,'user',:original,:stored,:mime,:size,:path)`, { chatId, messageId, userId, original: f.originalname, stored: path.basename(f.path), mime: f.mimetype || '', size: f.size || 0, path: f.path }); }
async function makeAssistantDownload({ userId, chatId, messageId, content }) {
  const dir = path.join(process.cwd(), 'uploads', 'answers', String(userId)); fs.mkdirSync(dir, { recursive: true });
  const stored = `answer-${messageId}.txt`; const filePath = path.join(dir, stored); fs.writeFileSync(filePath, content || '', 'utf8');
  await query(`INSERT INTO ai_files(chat_id,message_id,user_id,role,original_name,stored_name,mime_type,size_bytes,file_path) VALUES(:chatId,:messageId,:userId,'assistant',:original,:stored,'text/plain',:size,:path)`, { chatId, messageId, userId, original: stored, stored, size: Buffer.byteLength(content || ''), path: filePath });
}
async function sendMessage(userId, chatId, message, files=[], modelCode='') {
  const sub = await getActiveGptSubscription(userId); if (!sub) throw new Error('Нужна активная подписка с GPT');
  const aiModel = await getModelByCode(modelCode); if (!aiModel) throw new Error('Нет активных AI-моделей');
  const used = await monthlyUsage(userId);
  if (used >= sub.gpt_monthly_tokens) throw new Error('Месячный лимит GPT исчерпан');
  const multiplier = Number(aiModel.token_multiplier || 1);
  const apiKey = await getSetting('ai.api_key');
  const baseURL = await getSetting('ai.base_url', 'https://api.aitunnel.ru/v1/');
  const model = aiModel.model_id;
  const maxTokens = Number(aiModel.max_output_tokens || await getSetting('ai.max_tokens', '2000'));
  if (!apiKey) throw new Error('AI API key не настроен в админке');
  const chatRow = await ensureChat(userId, chatId, message);
  const userMsgResult = await query('INSERT INTO ai_messages(chat_id,user_id,role,content,model,ai_model_id) VALUES(:chatId,:userId,"user",:content,:model,:mid)', { chatId: chatRow.id, userId, content: message || '', model: aiModel.name, mid: aiModel.id });
  const userMessageId = userMsgResult.insertId; await saveUploadedFiles({ userId, chatId: chatRow.id, messageId: userMessageId, files });
  const historyRows = await query('SELECT role,content FROM ai_messages WHERE chat_id=:chatId AND user_id=:userId ORDER BY id DESC LIMIT 30', { chatId: chatRow.id, userId });
  const history = historyRows.reverse().filter(m => m.content).map(m => ({ role: m.role, content: m.content }));
  const fileParts = buildFileParts(files);
  const currentContent = fileParts.length ? [{ type: 'text', text: message || 'Посмотри прикреплённые файлы.' }, ...fileParts] : (message || '');
  if (history.length) history.pop();
  const messages = [{ role: 'system', content: 'Ты полезный русскоязычный ассистент внутри VPN+GPT сервиса. Отвечай без эмодзи, спокойно и по делу.' }, ...history, { role: 'user', content: currentContent }];
  const client = new OpenAI({ apiKey, baseURL });
  let result;
  try { result = await client.chat.completions.create({ model, max_tokens: maxTokens, messages }); }
  catch (e) {
    const fallback = (files || []).map(f => `[Прикреплён файл: ${f.originalname}, ${f.mimetype}, ${f.size} bytes]`).join('\n');
    result = await client.chat.completions.create({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: 'Ты полезный русскоязычный ассистент внутри VPN+GPT сервиса. Отвечай без эмодзи, спокойно и по делу.' }, ...history, { role: 'user', content: `${message || ''}\n\n${fallback}` }] });
  }
  const usage = result.usage || {};
  const rawTotal = Number(usage.total_tokens || ((usage.prompt_tokens||0)+(usage.completion_tokens||0)) || 0);
  const charged = Math.ceil(rawTotal * multiplier);
  const answer = result.choices?.[0]?.message?.content || 'Пустой ответ';
  await query('INSERT INTO gpt_usage(user_id,model,prompt_tokens,completion_tokens,total_tokens,charged_tokens,ai_model_id) VALUES(:userId,:model,:p,:c,:t,:charged,:mid)', { userId, model: aiModel.name, p: usage.prompt_tokens || 0, c: usage.completion_tokens || 0, t: rawTotal, charged, mid: aiModel.id });
  const assistantResult = await query(`INSERT INTO ai_messages(chat_id,user_id,role,content,model,prompt_tokens,completion_tokens,total_tokens,charged_tokens,ai_model_id) VALUES(:chatId,:userId,'assistant',:content,:model,:p,:c,:t,:charged,:mid)`, { chatId: chatRow.id, userId, content: answer, model: aiModel.name, p: usage.prompt_tokens || 0, c: usage.completion_tokens || 0, t: rawTotal, charged, mid: aiModel.id });
  await makeAssistantDownload({ userId, chatId: chatRow.id, messageId: assistantResult.insertId, content: answer });
  await query('UPDATE ai_chats SET updated_at=NOW() WHERE id=:id', { id: chatRow.id });
  return { chatId: chatRow.id, answer };
}
module.exports = { sendMessage, ensureChat, getChats, getChatMessages, renameChat, deleteChat, listActiveModels };
