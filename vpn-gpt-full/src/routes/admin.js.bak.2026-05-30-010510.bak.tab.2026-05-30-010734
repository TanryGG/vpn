const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { requireAdmin, requireLevel, getRoleLevel } = require('../middleware/auth');
const { query, one } = require('../config/db');
const { getSettingsMap, setSetting } = require('../services/settings');
const { grantSubscription, cancelSubscription, cancelUserSubscriptions, listUserSubscriptions } = require('../services/subscriptions');
const { createOrGetVpn, testXuiConnection, rebuildAllVpnLinks, syncVpnAccess, revokeUserVpnAccess } = require('../services/vpn');
const { finalizePayment } = require('../services/payments');
const { sendMail } = require('../services/mailer');
const { testTelegram, notifySupportStaffReply } = require('../services/telegram');
const router = express.Router();
router.use(requireAdmin);
function canManageRole(actor,targetRole){ return getRoleLevel(actor) >= 4 || getRoleLevel(actor) > getRoleLevel({role:targetRole}); }

const updateDir = process.env.UPDATE_DIR || '/var/www/vpn-gpt-updates';
fs.mkdirSync(updateDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, updateDir),
  filename: (req, file, cb) => cb(null, `upload-${Date.now()}-${String(file.originalname || 'update.zip').replace(/[^a-zA-Z0-9._-]/g,'_')}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!String(file.originalname || '').toLowerCase().endsWith('.zip')) return cb(new Error('Можно загружать только ZIP-архив'));
    cb(null, true);
  }
});
function writeLog(file, chunks){ fs.writeFileSync(file, chunks.filter(Boolean).join('\n')); }
function appendLog(file, text){ fs.appendFileSync(file, text + '\n'); }
function spawnDetached(command, args, logFile, cwd){
  const out = fs.openSync(logFile, 'a');
  const child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', out, out] });
  child.unref();
}

function detectedPath(){ return path.join(updateDir, 'vds-detected.json'); }
function readDetected(){
  try { return JSON.parse(fs.readFileSync(detectedPath(), 'utf8')); } catch(e) { return {}; }
}
async function saveDetectedToSettings(detected){
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
    xray_config_path: 'xray.config_path',
    xray_service: 'xray.service'
  };
  const secretKeys = new Set(['xui.password','smtp.password','vpn.private_key']);
  await setSetting('xray.local_enabled', String(detected.xray_local_enabled || 'true'), false);
  await setSetting('xui.enabled', 'false', false);
  await setSetting('vpn.security', 'reality', false);
  await setSetting('vpn.type', 'tcp', false);
  await setSetting('vpn.encryption', 'none', false);
  await setSetting('vpn.flow', detected.vpn_flow || 'xtls-rprx-vision', false);
  await setSetting('vpn.fingerprint', detected.vpn_fingerprint || 'chrome', false);
  await setSetting('vpn.spider_x', detected.vpn_spider_x || '/', false);
  await setSetting('vpn.limit_ip', detected.vpn_limit_ip || '0', false);
  await setSetting('vpn.total_gb', detected.vpn_total_gb || '0', false);
  for (const [src, key] of Object.entries(map)) {
    const value = detected[src];
    if (value !== undefined && value !== null && String(value).trim() !== '') await setSetting(key, String(value), secretKeys.has(key));
  }
}
function randomPassword(){ return crypto.randomBytes(12).toString('base64url'); }

router.get('/', async (req,res)=>{
  const stats = {
    users: (await one('SELECT COUNT(*) c FROM users')).c,
    usersToday: (await one("SELECT COUNT(*) c FROM users WHERE DATE(created_at)=CURDATE()")).c,
    activeSubs: (await one("SELECT COUNT(*) c FROM subscriptions WHERE status='active' AND ends_at>NOW()") ).c,
    paid: (await one("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='paid'")).s,
    paidToday: (await one("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='paid' AND DATE(paid_at)=CURDATE()")).s,
    paidMonth: (await one("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='paid' AND paid_at>=DATE_FORMAT(NOW(),'%Y-%m-01')")).s,
    yoomoneyPaid: (await one("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='paid' AND provider='yoomoney'")).s,
    cryptoPaid: (await one("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='paid' AND provider='cryptobot'")).s,
    pending: (await one("SELECT COUNT(*) c FROM payments WHERE status='pending'")).c,
    tokens: (await one('SELECT COALESCE(SUM(total_tokens),0) t FROM gpt_usage')).t,
    vpn: (await one("SELECT COUNT(*) c FROM vpn_accounts WHERE status='active'")).c,
    vpnMain: (await one("SELECT COUNT(*) c FROM vpn_accounts WHERE status='active' AND account_type='main'")).c,
    vpnWhite: (await one("SELECT COUNT(*) c FROM vpn_accounts WHERE status='active' AND account_type='white'")).c,
    openTickets: (await one("SELECT COUNT(*) c FROM support_tickets WHERE status IN ('open','pending')")).c,
    answeredTickets: (await one("SELECT COUNT(*) c FROM support_tickets WHERE status='answered'")).c,
  };
  const payments = await query('SELECT p.*, u.email, pl.name plan_name FROM payments p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN plans pl ON pl.id=p.plan_id ORDER BY p.id DESC LIMIT 10');
  const tickets = await query('SELECT t.*, u.email FROM support_tickets t LEFT JOIN users u ON u.id=t.user_id ORDER BY t.updated_at DESC LIMIT 8');
  res.render('admin/index',{title:'Админка', stats, payments, tickets});
});
router.get('/users', async (req,res)=>{
  const users = await query(`SELECT u.*, (SELECT ends_at FROM subscriptions s WHERE s.user_id=u.id AND s.status='active' AND s.ends_at>NOW() ORDER BY ends_at DESC LIMIT 1) sub_ends FROM users u ORDER BY u.id DESC LIMIT 500`);
  const plans = await query('SELECT * FROM plans ORDER BY sort_order');
  const subs = await query(`SELECT s.*, p.name plan_name, p.plan_kind, p.vpn_enabled, p.gpt_enabled, p.white_vpn_enabled, COALESCE(s.device_limit,p.device_limit,1) device_limit FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.status='active' AND s.ends_at>NOW() ORDER BY s.ends_at DESC`);
  const subsByUser = {};
  for (const s of subs) { (subsByUser[s.user_id] ||= []).push(s); }
  res.render('admin/users',{title:'Пользователи', users, plans, subsByUser});
});
router.post('/users/:id/status', async (req,res)=>{ await query('UPDATE users SET status=:status WHERE id=:id',{id:req.params.id,status:req.body.status}); req.flash('success','Статус обновлен'); res.redirect('/admin/users'); });
router.post('/users/:id/role', requireLevel(3), async (req,res)=>{ const target=await one('SELECT role FROM users WHERE id=:id',{id:req.params.id}); if(target && !canManageRole(req.session.user,target.role)){ req.flash('error','Нельзя менять роль пользователя выше или равного уровня'); return res.redirect('/admin/users'); } await query('UPDATE users SET role=:role WHERE id=:id',{id:req.params.id,role:req.body.role}); req.flash('success','Роль обновлена'); res.redirect('/admin/users'); });
router.post('/users/:id/grant', async (req,res)=>{ try{
  const user = await one('SELECT id,email,name,role FROM users WHERE id=:id',{id:req.params.id});
  if(!user) throw new Error('Пользователь не найден');
  const planIds = Array.isArray(req.body.plan_id) ? req.body.plan_id : [req.body.plan_id];
  for (const pid of planIds.filter(Boolean)) {
    await grantSubscription(req.params.id, pid, 'admin');
    const plan = await one('SELECT * FROM plans WHERE id=:id',{id:pid});
    if(plan?.vpn_enabled) {
      await createOrGetVpn(user, true, plan.white_vpn_enabled ? 'white' : 'main');
    }
  }
  req.flash('success','Подписка выдана, VPN-ссылки активированы при наличии VPN-тарифа');
}catch(e){req.flash('error',e.message)} res.redirect('/admin/users'); });
router.post('/users/:id/cancel-subs', async (req,res)=>{ try{ const mode=req.body.mode || 'all'; await cancelUserSubscriptions(req.params.id, mode); const r=await revokeUserVpnAccess(req.params.id, mode); req.flash('success',`Подписки отключены. VPN-доступ отозван: ${r.total}`); }catch(e){req.flash('error',e.message)} res.redirect('/admin/users'); });
router.post('/subscriptions/:id/cancel', async (req,res)=>{ try{ await cancelSubscription(req.params.id); const r=await syncVpnAccess(); req.flash('success',`Подписка отменена. Синхронизировано VPN-аккаунтов: ${r.total}`); }catch(e){req.flash('error',e.message)} res.redirect(req.get('referer') || '/admin/subscriptions'); });
router.post('/users/:id/vpn', async (req,res)=>{ try{ const user=await one('SELECT id,email,name,role FROM users WHERE id=:id',{id:req.params.id}); await createOrGetVpn(user, true, req.body.account_type || 'main'); req.flash('success','VPN создан/пересобран'); }catch(e){req.flash('error',e.message)} res.redirect('/admin/users'); });

router.get('/subscriptions', async (req,res)=>{ const subs=await query(`SELECT s.*,u.email,pl.name plan_name FROM subscriptions s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN plans pl ON pl.id=s.plan_id ORDER BY s.id DESC LIMIT 500`); res.render('admin/subscriptions',{title:'Подписки',subs}); });
router.get('/vpn', async (req,res)=>{ const accounts=await query(`SELECT v.*,u.email,u.name FROM vpn_accounts v LEFT JOIN users u ON u.id=v.user_id ORDER BY v.account_type, v.id DESC LIMIT 500`); res.render('admin/vpn',{title:'VPN аккаунты',accounts}); });
router.post('/vpn/test-xui', async (req,res)=>{ try{ await testXuiConnection(); req.flash('success','3x-ui подключение успешно. Inbound найден.'); }catch(e){ req.flash('error',e.message); } res.redirect('/admin/vpn'); });
router.post('/vpn/rebuild-links', async (req,res)=>{ try{ const count=await rebuildAllVpnLinks(req.body.account_type || 'main'); req.flash('success',`Пересобрано VPN-ссылок: ${count}. Тип: ${req.body.account_type || 'main'}.`); }catch(e){ req.flash('error',e.message); } res.redirect('/admin/vpn'); });
router.post('/vpn/sync-access', async (req,res)=>{ try{ const r=await syncVpnAccess(req.body.account_type || null); req.flash('success',`Синхронизация готова. Отключено без активной подписки: ${r.total}. Удалено из локального Xray: ${r.localRemoved}.`); }catch(e){ req.flash('error',e.message); } res.redirect('/admin/vpn'); });
router.post('/vpn/create-for-user', async (req,res)=>{ try{ const user=await one('SELECT id,email,name,role FROM users WHERE id=:id',{id:req.body.user_id}); if(!user) throw new Error('Пользователь не найден'); await createOrGetVpn(user, true, req.body.account_type || 'main'); req.flash('success','Happ-ссылка создана/пересобрана'); }catch(e){ req.flash('error',e.message); } res.redirect('/admin/vpn'); });
router.get('/gpt', async (req,res)=>{ const total=await one('SELECT COALESCE(SUM(prompt_tokens),0) prompt_tokens, COALESCE(SUM(completion_tokens),0) completion_tokens, COALESCE(SUM(total_tokens),0) total_tokens FROM gpt_usage'); const rows=await query(`SELECT g.*,u.email FROM gpt_usage g LEFT JOIN users u ON u.id=g.user_id ORDER BY g.id DESC LIMIT 500`); res.render('admin/gpt',{title:'GPT статистика',total,rows}); });


router.get('/ai-models', async (req,res)=>{
  const models = await query('SELECT * FROM ai_models ORDER BY sort_order, id');
  res.render('admin/ai_models',{title:'AI модели',models});
});
router.post('/ai-models/save', async (req,res)=>{
  const b=req.body;
  const data={
    id:b.id||null, code:b.code, provider:b.provider||'OpenAI', model_id:b.model_id, name:b.name,
    input_price:b.input_price||0, output_price:b.output_price||0, context_tokens:b.context_tokens||0, capabilities:b.capabilities||'',
    token_multiplier:b.token_multiplier||1, max_output_tokens:b.max_output_tokens||2000, sort_order:b.sort_order||100, is_active:b.is_active?1:0
  };
  if(data.id){
    await query(`UPDATE ai_models SET code=:code,provider=:provider,model_id=:model_id,name=:name,input_price=:input_price,output_price=:output_price,context_tokens=:context_tokens,capabilities=:capabilities,token_multiplier=:token_multiplier,max_output_tokens=:max_output_tokens,sort_order=:sort_order,is_active=:is_active WHERE id=:id`, data);
  } else {
    await query(`INSERT INTO ai_models(code,provider,model_id,name,input_price,output_price,context_tokens,capabilities,token_multiplier,max_output_tokens,sort_order,is_active) VALUES(:code,:provider,:model_id,:name,:input_price,:output_price,:context_tokens,:capabilities,:token_multiplier,:max_output_tokens,:sort_order,:is_active)`, data);
  }
  req.flash('success','AI модель сохранена');
  res.redirect('/admin/ai-models');
});
router.post('/ai-models/:id/toggle', async (req,res)=>{
  await query('UPDATE ai_models SET is_active=IF(is_active=1,0,1) WHERE id=:id',{id:req.params.id});
  req.flash('success','Статус модели изменён');
  res.redirect('/admin/ai-models');
});

router.get('/plans', async (req,res)=>{ const plans=await query('SELECT * FROM plans ORDER BY sort_order'); res.render('admin/plans',{title:'Тарифы',plans}); });
router.post('/plans/save', async (req,res)=>{
  const b=req.body;
  if(b.id){ await query(`UPDATE plans SET code=:code,name=:name,price=:price,currency=:currency,days=:days,vpn_enabled=:vpn,gpt_enabled=:gpt,gpt_monthly_tokens=:tokens,sort_order=:sort,is_active=:active,description=:description,plan_kind=:kind,period_kind=:period,white_vpn_enabled=:white,display_badge=:badge,device_limit=:devices,total_gb=:totalGb WHERE id=:id`,{...b,vpn:b.vpn_enabled?1:0,gpt:b.gpt_enabled?1:0,active:b.is_active?1:0,tokens:b.gpt_monthly_tokens||0,sort:b.sort_order||100,kind:b.plan_kind||'combo',period:b.period_kind||'monthly',white:b.white_vpn_enabled?1:0,badge:b.display_badge||'',devices:b.device_limit||1,totalGb:b.total_gb||0}); }
  else { await query(`INSERT INTO plans(code,name,price,currency,days,vpn_enabled,gpt_enabled,gpt_monthly_tokens,sort_order,is_active,description,plan_kind,period_kind,white_vpn_enabled,display_badge,device_limit,total_gb) VALUES(:code,:name,:price,:currency,:days,:vpn,:gpt,:tokens,:sort,:active,:description,:kind,:period,:white,:badge,:devices,:totalGb)`,{...b,vpn:b.vpn_enabled?1:0,gpt:b.gpt_enabled?1:0,active:b.is_active?1:0,tokens:b.gpt_monthly_tokens||0,sort:b.sort_order||100,kind:b.plan_kind||'combo',period:b.period_kind||'monthly',white:b.white_vpn_enabled?1:0,badge:b.display_badge||'',devices:b.device_limit||1,totalGb:b.total_gb||0}); }
  req.flash('success','Тариф сохранен'); res.redirect('/admin/plans');
});
router.post('/plans/:id/delete', async (req,res)=>{ await query('UPDATE plans SET is_active=0 WHERE id=:id',{id:req.params.id}); req.flash('success','Тариф скрыт'); res.redirect('/admin/plans'); });

router.get('/settings', async (req,res)=>{ const settings=await getSettingsMap(); res.render('admin/settings',{title:'Настройки',settings}); });
router.post('/settings', async (req,res)=>{
  try {
    const secrets = new Set(['ai.api_key','payments.yoomoney.receiver','payments.yoomoney.secret','payments.cryptobot.token','xui.password','smtp.password','telegram.bot_token']);
    const normalizeValue = (value) => {
      if (Array.isArray(value)) {
        const nonEmpty = value.map(v => String(v ?? '').trim()).filter(v => v !== '' && v !== '********');
        if (nonEmpty.length) return nonEmpty[nonEmpty.length - 1];
        return String(value[value.length - 1] ?? '').trim();
      }
      return String(value ?? '').trim();
    };
    for(const [k,raw] of Object.entries(req.body)){
      if(k==='_csrf') continue;
      const v = normalizeValue(raw);
      if(v === '********') continue;
      if(secrets.has(k) && v === '') continue;
      await setSetting(k, v, secrets.has(k));
    }
    req.flash('success','Настройки сохранены');
    return res.redirect('/admin/settings');
  } catch(e) {
    console.error('settings save error', e);
    req.flash('error','Не удалось сохранить настройки: ' + (e.message || e));
    return res.redirect('/admin/settings');
  }
});
router.get('/payments', async (req,res)=>{ const payments=await query('SELECT p.*,u.email,pl.name plan_name FROM payments p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN plans pl ON pl.id=p.plan_id ORDER BY p.id DESC LIMIT 500'); res.render('admin/payments',{title:'Платежи',payments}); });
router.post('/payments/:id/mark-paid', async (req,res)=>{ const p=await one('SELECT * FROM payments WHERE id=:id',{id:req.params.id}); if(p&&p.status!=='paid'){ await finalizePayment(p, {manual:true, by:'admin'}); } req.flash('success','Платеж отмечен оплаченным'); res.redirect('/admin/payments'); });


router.get('/promocodes', async (req,res)=>{
  const codes = await query('SELECT pc.*, p.name plan_name FROM promo_codes pc LEFT JOIN plans p ON p.id=pc.plan_id ORDER BY pc.id DESC');
  const plans = await query('SELECT id,name FROM plans ORDER BY sort_order');
  res.render('admin/promocodes',{title:'Промокоды',codes,plans});
});
router.post('/promocodes/save', async (req,res)=>{
  const b=req.body;
  const data={code:String(b.code||'').trim().toUpperCase(),type:b.discount_type||'percent',value:b.discount_value||0,max:b.max_uses||0,plan:b.plan_id||null,active:b.is_active?1:0,valid:b.valid_until||null,id:b.id||null};
  if(!data.code) { req.flash('error','Код обязателен'); return res.redirect('/admin/promocodes'); }
  if(data.id) await query('UPDATE promo_codes SET code=:code,discount_type=:type,discount_value=:value,max_uses=:max,plan_id=:plan,is_active=:active,valid_until=:valid WHERE id=:id',data);
  else await query('INSERT INTO promo_codes(code,discount_type,discount_value,max_uses,plan_id,is_active,valid_until) VALUES(:code,:type,:value,:max,:plan,:active,:valid)',data);
  req.flash('success','Промокод сохранён'); res.redirect('/admin/promocodes');
});
router.post('/promocodes/:id/delete', async (req,res)=>{ await query('UPDATE promo_codes SET is_active=0 WHERE id=:id',{id:req.params.id}); req.flash('success','Промокод выключен'); res.redirect('/admin/promocodes'); });

router.get('/referrals', async (req,res)=>{
  const settings = await getSettingsMap();
  const rows = await query(`SELECT re.*, ru.email referrer_email, uu.email referred_email FROM referral_events re LEFT JOIN users ru ON ru.id=re.referrer_user_id LEFT JOIN users uu ON uu.id=re.referred_user_id ORDER BY re.id DESC LIMIT 500`);
  res.render('admin/referrals',{title:'Рефералка',settings,rows});
});
router.post('/referrals/settings', async (req,res)=>{
  await setSetting('referral.enabled', req.body.enabled || 'false');
  await setSetting('referral.bonus_days', req.body.bonus_days || '0');
  await setSetting('referral.bonus_plan_code', req.body.bonus_plan_code || 'combo-day');
  await setSetting('referral.percent', req.body.percent || '0');
  req.flash('success','Настройки рефералки сохранены'); res.redirect('/admin/referrals');
});

router.post('/smtp/test', async (req,res)=>{
  try { await sendMail({ to:req.body.email || req.session.user.email, subject:'SMTP test VPN+GPT', text:'SMTP работает.' }); req.flash('success','Тестовое письмо отправлено'); }
  catch(e){ req.flash('error','SMTP ошибка: '+e.message); }
  res.redirect('/admin/settings');
});


router.post('/telegram/test', async (req,res)=>{
  try { await testTelegram(); req.flash('success','Тестовое уведомление Telegram отправлено'); }
  catch(e){ req.flash('error','Telegram ошибка: '+(e.response?.data?.description || e.message)); }
  res.redirect('/admin/settings#telegram');
});

router.get('/updates', async (req,res)=>{
  let log=''; try{ log=fs.readFileSync(path.join(updateDir,'last-update.log'),'utf8').slice(-30000); }catch(e){}
  const latestPath = path.join(updateDir,'latest.zip');
  const latestZipName = fs.existsSync(latestPath) ? path.basename(latestPath) : '';
  res.render('admin/updates',{title:'Обновления', projectDir:process.cwd(), log, latestZipName});
});
router.post('/updates/upload', (req,res)=>{
  upload.single('updateZip')(req,res,(err)=>{
    if (err) {
      req.flash('error', err.message || 'Ошибка загрузки архива');
      return res.redirect('/admin/updates');
    }
    if(!req.file){ req.flash('error','Файл не загружен'); return res.redirect('/admin/updates'); }
    try {
      const target=path.join(updateDir,'latest.zip');
      if (fs.existsSync(target)) fs.unlinkSync(target);
      fs.renameSync(req.file.path,target);
      req.flash('success','Архив обновления загружен. Теперь нажми “Применить обновление”.');
    } catch(e){
      req.flash('error', 'Не удалось сохранить архив: ' + e.message);
    }
    res.redirect('/admin/updates');
  });
});
router.post('/updates/run', async (req,res)=>{
  const zip=path.join(updateDir,'latest.zip');
  if(!fs.existsSync(zip)){ req.flash('error','Сначала загрузи ZIP-архив обновления'); return res.redirect('/admin/updates'); }
  const script=path.join(process.cwd(),'scripts','apply-update.sh');
  const logFile = path.join(updateDir,'last-update.log');
  writeLog(logFile,[`[${new Date().toISOString()}] Запуск обновления`, `ZIP: ${zip}`, `DIR: ${process.cwd()}`]);
  appendLog(logFile, 'Обновление запущено в фоне...');
  spawnDetached('bash',[script,zip,process.cwd()],logFile,process.cwd());
  req.flash('success','Обновление запущено в фоне. Через 10–60 секунд обнови страницу и проверь лог.');
  res.redirect('/admin/updates');
});
router.post('/updates/restart-pm2', async (req,res)=>{
  const script = path.join(process.cwd(),'scripts','restart-app.sh');
  const logFile = path.join(updateDir,'last-update.log');
  appendLog(logFile, `[${new Date().toISOString()}] Запрошен перезапуск PM2`);
  spawnDetached('bash',[script,'vpn-gpt-full'],logFile,process.cwd());
  req.flash('success','Команда на перезапуск PM2 отправлена. Обнови страницу через несколько секунд.');
  res.redirect('/admin/updates');
});


router.get('/vds', async (req,res)=>{
  const logPath = path.join(updateDir,'vds-autosetup.log');
  let log=''; try{ log=fs.readFileSync(logPath,'utf8').slice(-50000); }catch(e){}
  let health=''; try{ health=fs.readFileSync(path.join(updateDir,'vds-health.log'),'utf8').slice(-50000); }catch(e){}
  const settings=await getSettingsMap();
  const detected=readDetected();
  res.render('admin/vds',{title:'VDS автонастройка',log,health,settings,detected,projectDir:process.cwd()});
});
router.post('/vds/run', async (req,res)=>{
  const script=path.join(process.cwd(),'scripts','auto-vpn-setup.sh');
  const logFile=path.join(updateDir,'vds-autosetup.log');
  const detectedFile=detectedPath();
  writeLog(logFile,[`[${new Date().toISOString()}] Запуск базовой VDS проверки`, `APP_DIR: ${process.cwd()}`]);
  spawnDetached('bash',[script,process.cwd(),detectedFile,'basic'],logFile,process.cwd());
  req.flash('success','Базовая проверка запущена в фоне. Лог обновится через несколько секунд.');
  res.redirect('/admin/vds');
});
router.post('/vds/run-full', async (req,res)=>{
  const ip = String(req.body.public_ip || '').trim();
  const xuiPort = String(req.body.xui_port || '2053').trim();
  const vpnPort = String(req.body.vpn_port || '8443').trim();
  const whiteVpnPort = String(req.body.white_vpn_port || '8444').trim();
  const xuiUser = String(req.body.xui_username || 'admin').trim();
  const xuiPass = String(req.body.xui_password || '').trim() || randomPassword();
  const vpnSni = String(req.body.vpn_sni || 'www.microsoft.com').trim();
  const displayName = String(req.body.vpn_display_name || 'AstraGate VPN').trim();
  const region = String(req.body.vpn_region || 'Premium').trim();
  const whiteDisplayName = String(req.body.white_vpn_display_name || 'AstraGate White').trim();
  const whiteRegion = String(req.body.white_vpn_region || 'White').trim();
  const publicIp = ip || req.ip.replace('::ffff:','');

  const preDetected = {
    public_ip: publicIp,
    xui_port: xuiPort,
    xui_base_url: publicIp ? `http://${publicIp}:${xuiPort}` : '',
    xui_username: xuiUser,
    xui_password: xuiPass,
    xui_inbound_id: '1',
    vpn_port: vpnPort,
    vpn_sni: vpnSni,
    vpn_display_name: displayName,
    vpn_region: region,
    white_vpn_host: publicIp,
    white_vpn_port: whiteVpnPort,
    white_vpn_sni: vpnSni,
    white_vpn_display_name: whiteDisplayName,
    white_vpn_region: whiteRegion,
    white_vpn_flow: 'xtls-rprx-vision',
    vpn_fingerprint: 'chrome',
    vpn_spider_x: '/',
    xray_local_enabled: 'true',
    xray_config_path: '/etc/vpn-gpt-xray/config.json',
    xray_service: 'vpn-gpt-xray'
  };
  fs.writeFileSync(detectedPath(), JSON.stringify(preDetected, null, 2));
  await saveDetectedToSettings(preDetected);

  const script=path.join(process.cwd(),'scripts','auto-vpn-setup.sh');
  const logFile=path.join(updateDir,'vds-autosetup.log');
  writeLog(logFile,[`[${new Date().toISOString()}] Запуск полной VDS автонастройки`, `APP_DIR: ${process.cwd()}`, `xui.base_url: ${preDetected.xui_base_url}`, `vpn.port: ${vpnPort}`]);
  spawnDetached('bash',[script,process.cwd(),detectedPath(),'full',publicIp,xuiPort,xuiUser,xuiPass,vpnPort,vpnSni,displayName,region,whiteVpnPort,whiteDisplayName,whiteRegion],logFile,process.cwd());
  req.flash('success','Полная автонастройка запущена. Пароль и базовые параметры уже сохранены в настройках. Через минуту нажми “Синхронизировать найденное”.');
  res.redirect('/admin/vds');
});
router.post('/vds/sync-detected', async (req,res)=>{
  const detected = readDetected();
  if (!Object.keys(detected).length) { req.flash('error','Файл найденных параметров пока не создан. Сначала запусти автонастройку.'); return res.redirect('/admin/vds'); }
  await saveDetectedToSettings(detected);
  req.flash('success','Найденные параметры перенесены в настройки сайта. Проверь раздел VPN и нажми “Проверить подключение”.');
  res.redirect('/admin/vds');
});
router.post('/vds/save-detected', async (req,res)=>{
  const detected = {
    public_ip: req.body.public_ip || '',
    xui_base_url: req.body.xui_base_url || '',
    xui_username: req.body.xui_username || '',
    xui_password: req.body.xui_password || '',
    xui_inbound_id: req.body.xui_inbound_id || '1'
  };
  fs.writeFileSync(detectedPath(), JSON.stringify({...readDetected(), ...detected}, null, 2));
  await saveDetectedToSettings(detected);
  req.flash('success','Параметры VDS/VPN сохранены');
  res.redirect('/admin/vds');
});


router.post('/vds/health', async (req,res)=>{
  const script=path.join(process.cwd(),'scripts','check-vds-health.sh');
  const logFile=path.join(updateDir,'vds-health.log');
  writeLog(logFile,[`[${new Date().toISOString()}] Запуск полной проверки VDS/VPN`, `APP_DIR: ${process.cwd()}`]);
  spawnDetached('bash',[script,process.cwd(),detectedPath()],logFile,process.cwd());
  req.flash('success','Проверка запущена. Обнови страницу через несколько секунд и смотри лог проверки.');
  res.redirect('/admin/vds');
});


router.post('/vds/repair-dual-vpn', async (req,res)=>{
  const script=path.join(process.cwd(),'scripts','repair-dual-vpn.js');
  const logFile=path.join(updateDir,'vds-health.log');
  writeLog(logFile,[`[${new Date().toISOString()}] Запуск ремонта двух VPN-портов`, `APP_DIR: ${process.cwd()}`]);
  spawnDetached('node',[script,'repair'],logFile,process.cwd());
  req.flash('success','Ремонт обычного VPN и White VPN запущен. Через 10–30 секунд нажми “Проверить всю настройку”.');
  res.redirect('/admin/vds');
});

router.post('/vpn/repair-dual-vpn', async (req,res)=>{
  const script=path.join(process.cwd(),'scripts','repair-dual-vpn.js');
  const logFile=path.join(updateDir,'vds-health.log');
  writeLog(logFile,[`[${new Date().toISOString()}] Запуск ремонта VPN из раздела VPN`, `APP_DIR: ${process.cwd()}`]);
  spawnDetached('node',[script,'repair'],logFile,process.cwd());
  req.flash('success','Ремонт и пересборка обоих VPN запущены. Проверь лог в VDS автонастройке.');
  res.redirect('/admin/vpn');
});


router.get('/domain', async (req,res)=>{
  const settings = await getSettingsMap();
  let log='';
  try { log = fs.readFileSync(path.join(updateDir,'domain-setup.log'),'utf8').slice(-50000); } catch(e) {}
  let last={};
  try { last = JSON.parse(fs.readFileSync(path.join(updateDir,'domain-last.json'),'utf8')); } catch(e) {}
  res.render('admin/domain',{title:'Перенос на домен',settings,log,last});
});

router.post('/domain/apply', async (req,res)=>{
  const domain = String(req.body.domain || '').trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'');
  const email = String(req.body.email || '').trim() || `admin@${domain}`;
  if(!domain){ req.flash('error','Введи домен'); return res.redirect('/admin/domain'); }
  await setSetting('app.domain', domain);
  await setSetting('app.url', `https://${domain}`);
  await setSetting('app.icon_url', `https://${domain}/img/app-icon.png`);
  await setSetting('vpn.host', domain);
  await setSetting('white_vpn.host', domain);
  const script = path.join(process.cwd(),'scripts','apply-domain.sh');
  const logFile = path.join(updateDir,'domain-setup.log');
  writeLog(logFile,[`[${new Date().toISOString()}] Запуск переноса на домен`, `DOMAIN: ${domain}`, `APP_DIR: ${process.cwd()}`]);
  spawnDetached('bash',[script,process.cwd(),domain,email,updateDir],logFile,process.cwd());
  req.flash('success','Перенос на домен запущен. Через 30–90 секунд обнови страницу и проверь лог. Если DNS ещё не смотрит на VDS, Certbot покажет ошибку в логе.');
  res.redirect('/admin/domain');
});

router.post('/domain/rebuild-links', async (req,res)=>{
  try {
    const settings = await getSettingsMap();
    const domain = String(settings['app.domain'] || '').trim();
    if(!domain) throw new Error('Домен ещё не задан');
    await setSetting('vpn.host', domain);
    await setSetting('white_vpn.host', domain);
    const main = await rebuildAllVpnLinks('main');
    const white = await rebuildAllVpnLinks('white');
    req.flash('success',`Happ-ссылки пересобраны на домен. Обычный VPN: ${main}, White VPN: ${white}`);
  } catch(e) { req.flash('error',e.message); }
  res.redirect('/admin/domain');
});


router.get('/support', async (req,res)=>{ const status=req.query.status||''; const where=status?'WHERE st.status=:status':''; const tickets=await query(`SELECT st.*, u.email, u.name, a.email assigned_email FROM support_tickets st JOIN users u ON u.id=st.user_id LEFT JOIN users a ON a.id=st.assigned_to ${where} ORDER BY COALESCE(st.last_message_at,st.created_at) DESC LIMIT 500`, status?{status}:{}); res.render('admin/support',{title:'Техподдержка',tickets,status}); });
router.get('/support/:id', async (req,res)=>{ const ticket=await one('SELECT st.*,u.email,u.name,a.email assigned_email FROM support_tickets st JOIN users u ON u.id=st.user_id LEFT JOIN users a ON a.id=st.assigned_to WHERE st.id=:id',{id:req.params.id}); if(!ticket) return res.status(404).render('error',{title:'404',message:'Тикет не найден'}); const messages=await query('SELECT sm.*,u.email,u.name FROM support_messages sm LEFT JOIN users u ON u.id=sm.user_id WHERE sm.ticket_id=:id ORDER BY sm.id',{id:ticket.id}); res.render('admin/support_show',{title:'Тикет #'+ticket.id,ticket,messages}); });
router.post('/support/:id/reply', async (req,res)=>{ const ticket=await one('SELECT * FROM support_tickets WHERE id=:id',{id:req.params.id}); if(!ticket) return res.status(404).render('error',{title:'404',message:'Тикет не найден'}); const message=String(req.body.message||'').trim(); if(!message){ req.flash('error','Сообщение пустое'); return res.redirect('/admin/support/'+ticket.id); } await query('INSERT INTO support_messages(ticket_id,user_id,sender_role,message,is_internal) VALUES(:tid,:uid,"staff",:msg,:internal)',{tid:ticket.id,uid:req.session.user.id,msg:message,internal:req.body.is_internal?1:0}); await query('UPDATE support_tickets SET status=:status, assigned_to=COALESCE(assigned_to,:uid), last_message_at=NOW(), updated_at=NOW() WHERE id=:id',{id:ticket.id,uid:req.session.user.id,status:req.body.is_internal?'pending':'answered'}); await notifySupportStaffReply({ticketId:ticket.id, subject:ticket.subject, message, staff:req.session.user, internal:!!req.body.is_internal}).catch(()=>{}); req.flash('success','Ответ отправлен'); res.redirect('/admin/support/'+ticket.id); });
router.post('/support/:id/status', async (req,res)=>{ await query('UPDATE support_tickets SET status=:status, priority=:priority, assigned_to=:assigned, updated_at=NOW() WHERE id=:id',{id:req.params.id,status:req.body.status,priority:req.body.priority,assigned:req.body.assigned_to||null}); req.flash('success','Тикет обновлён'); res.redirect('/admin/support/'+req.params.id); });

router.get('/logs', async (req,res)=>{ const logs=await query('SELECT a.*,u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500'); res.render('admin/logs',{title:'Логи',logs}); });

router.post('/telegram-proxy/autosetup', async (req,res)=>{const {execFile}=require('child_process');const script=require('path').join(process.cwd(),'scripts','ag-proxy-autosetup.sh');execFile('bash',[script],{cwd:process.cwd(),timeout:240000,env:Object.assign({},process.env,{APP_DIR:process.cwd(),TG_PROXY_HOST:String((req.body&&req.body.host)||'astragate.su').trim(),TG_PROXY_PORT:String((req.body&&req.body.port)||'8445').trim()})},(err,stdout,stderr)=>{console.log('[telegram-proxy-autosetup]',stdout,stderr);if(req.flash){err?req.flash('error','Автонастройка Telegram Proxy не выполнена'):req.flash('success','Telegram Proxy настроен')}res.redirect('/admin/settings#telegram-proxy')});});

module.exports = router;
