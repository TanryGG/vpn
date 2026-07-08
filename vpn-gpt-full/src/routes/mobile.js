const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query, one } = require('../config/db');
const { getActiveSubscription, getActiveVpnSubscription, getActiveWhiteVpnSubscription, getActiveGptSubscription } = require('../services/subscriptions');
const { createYooMoneyPayment, createCryptoBotPayment } = require('../services/payments');
const { sendMessage, listActiveModels } = require('../services/gpt');
const { createOrGetVpn } = require('../services/vpn');

const router = express.Router();

async function ensureMobileTables(){
  await query(`CREATE TABLE IF NOT EXISTS mobile_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NULL,
    INDEX(user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
function hashToken(token){ return crypto.createHash('sha256').update(String(token)).digest('hex'); }
async function makeToken(userId){
  await ensureMobileTables();
  const token = crypto.randomBytes(32).toString('hex');
  await query('INSERT INTO mobile_tokens(user_id,token_hash,expires_at) VALUES(:uid,:hash,DATE_ADD(NOW(), INTERVAL 60 DAY))', {uid:userId, hash:hashToken(token)});
  return token;
}
async function auth(req,res,next){
  try{
    await ensureMobileTables();
    const raw = String(req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
    if(!raw) return res.status(401).json({error:'Не авторизован'});
    const row = await one(`SELECT mt.*, u.id, u.email, u.name, u.role, u.status FROM mobile_tokens mt JOIN users u ON u.id=mt.user_id WHERE mt.token_hash=:h AND (mt.expires_at IS NULL OR mt.expires_at>NOW()) LIMIT 1`, {h:hashToken(raw)});
    if(!row || row.status !== 'active') return res.status(401).json({error:'Сессия истекла'});
    req.mobileUser = { id:row.user_id, email:row.email, name:row.name, role:row.role };
    next();
  }catch(e){ next(e); }
}
function fmtDate(v){ return v ? String(v).replace('T',' ').replace(/\.000Z$/,'') : ''; }
function planDto(p){
  return {
    id:p.id, code:p.code, name:p.name, price:Number(p.price||0), price_rub:`${Number(p.price||0).toFixed(0)} RUB`, currency:p.currency||'RUB', days:p.days,
    plan_kind:p.plan_kind||'combo', period_kind:p.period_kind||'custom', device_limit:Number(p.device_limit||1), total_gb:Number(p.total_gb||0),
    vpn_enabled:!!Number(p.vpn_enabled), gpt_enabled:!!Number(p.gpt_enabled), white_vpn_enabled:!!Number(p.white_vpn_enabled||0), description:p.description||''
  };
}
router.post('/login', async (req,res,next)=>{
  try{
    const email = String(req.body.email||'').trim();
    const password = String(req.body.password||'');
    const user = await one('SELECT * FROM users WHERE email=:email LIMIT 1', {email});
    if(!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({error:'Неверный email или пароль'});
    if(user.status !== 'active') return res.status(403).json({error:'Аккаунт заблокирован'});
    const token = await makeToken(user.id);
    res.json({token, user:{id:user.id,email:user.email,name:user.name||'',role:user.role}});
  }catch(e){ next(e); }
});
router.get('/profile', auth, async (req,res,next)=>{
  try{
    const [sub, vpn, white, gpt] = await Promise.all([
      getActiveSubscription(req.mobileUser.id), getActiveVpnSubscription(req.mobileUser.id,false), getActiveWhiteVpnSubscription(req.mobileUser.id), getActiveGptSubscription(req.mobileUser.id)
    ]);
    res.json({
      user:req.mobileUser, email:req.mobileUser.email,
      subscription: sub ? {name:sub.plan_name, ends_at:fmtDate(sub.ends_at)} : null,
      vpn_status: vpn ? 'active' : 'inactive', vpn_expires: vpn ? fmtDate(vpn.ends_at) : '',
      white_vpn_status: white ? 'active' : 'inactive', white_vpn_expires: white ? fmtDate(white.ends_at) : '',
      gpt_status: gpt ? 'active' : 'inactive', gpt_expires: gpt ? fmtDate(gpt.ends_at) : '', gpt_tokens:gpt ? Number(gpt.gpt_monthly_tokens||0) : 0
    });
  }catch(e){ next(e); }
});
router.get('/vpn/config', auth, async (req,res,next)=>{
  try{
    const type = req.query.type === 'white' ? 'white' : 'main';
    let acc = await one('SELECT * FROM vpn_accounts WHERE user_id=:uid AND account_type=:type AND status="active" ORDER BY id DESC LIMIT 1', {uid:req.mobileUser.id,type});
    if(!acc) acc = await createOrGetVpn(req.mobileUser, true, type);
    const url = String(acc.vless_url||'');
    const m = url.match(/^vless:\/\/([^@]+)@([^:]+):(\d+)\?([^#]+)/);
    if(!m) return res.status(404).json({error:'VPN config not found'});
    const params = new URLSearchParams(m[4]);
    res.json({
      type, uuid:m[1], host:m[2], port:Number(m[3]),
      public_key:params.get('pbk')||'', short_id:params.get('sid')||'', sni:params.get('sni')||'www.microsoft.com',
      fingerprint:params.get('fp')||'chrome', spider_x:params.get('spx')||'/', flow:params.get('flow')||'xtls-rprx-vision', vless_url:url
    });
  }catch(e){ next(e); }
});
router.get('/plans', auth, async (req,res,next)=>{
  try{
    const plans = await query(`SELECT id,code,name,price,currency,days,vpn_enabled,gpt_enabled,description,sort_order,is_active,COALESCE(plan_kind,'combo') plan_kind,COALESCE(period_kind,'custom') period_kind,COALESCE(device_limit,1) device_limit,COALESCE(total_gb,0) total_gb,COALESCE(white_vpn_enabled,0) white_vpn_enabled FROM plans WHERE is_active=1 ORDER BY sort_order, price, id`);
    res.json({plans:plans.map(planDto)});
  }catch(e){ next(e); }
});
router.get('/ai/models', auth, async (req,res,next)=>{
  try{
    let models=[];
    try { models = await listActiveModels(); } catch(e) { models=[]; }
    if(!models.length) models = [{code:'gpt-4.1-mini', name:'GPT Mini', provider:'OpenAI'}];
    res.json({models: models.map(m=>({code:m.code||m.model_id||m.name, name:m.name||m.code, provider:m.provider||'', model_id:m.model_id||m.code||''}))});
  }catch(e){ next(e); }
});
router.post('/payments/create', auth, async (req,res,next)=>{
  try{
    const planId = Number(req.body.plan_id || req.body.planId || 0);
    const provider = String(req.body.provider || 'yoomoney').toLowerCase();
    const plan = await one('SELECT * FROM plans WHERE id=:id AND is_active=1 LIMIT 1', {id:planId});
    if(!plan) return res.status(404).json({error:'Тариф не найден'});
    const user = await one('SELECT * FROM users WHERE id=:id LIMIT 1', {id:req.mobileUser.id});
    let url;
    if(provider === 'cryptobot') url = await createCryptoBotPayment(user, plan, String(req.body.promo_code||''));
    else url = await createYooMoneyPayment(user, plan, String(req.body.promo_code||''));
    res.json({url, payment_url:url, provider});
  }catch(e){ next(e); }
});
router.post('/gpt/chat', auth, async (req,res,next)=>{
  try{
    const message = String(req.body.message||'').trim();
    const model = String(req.body.model_id||req.body.model||'').trim();
    if(!message) return res.status(400).json({error:'Сообщение пустое'});
    const r = await sendMessage(req.mobileUser.id, null, message, [], model);
    res.json({answer:r.answer || r.content || String(r)});
  }catch(e){ next(e); }
});
router.use((err,req,res,next)=>{ console.error('mobile api error:', err); res.status(500).json({error:err.message||'Internal error'}); });
module.exports = router;
