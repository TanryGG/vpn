const express = require('express');
const bcrypt = require('bcryptjs');
const { query, one } = require('../config/db');
const { setSetting, isInstalled } = require('../services/settings');
const router = express.Router();

router.use(async (req,res,next)=>{
  try { if (await isInstalled()) return res.redirect('/'); } catch(e) {}
  next();
});
router.get('/', (req,res)=>res.render('install', { title:'Установка' }));
router.post('/', async (req,res)=>{
  try {
    const { app_url, admin_email, admin_password, ai_api_key, ai_model, yoomoney_receiver, cryptobot_token } = req.body;
    if (!admin_email || !admin_password || admin_password.length < 8) throw new Error('Укажи email и пароль админа минимум 8 символов');
    const exists = await one('SELECT id FROM users WHERE email=:email', { email: admin_email });
    if (!exists) {
      const hash = await bcrypt.hash(admin_password, 12);
      await query('INSERT INTO users(email,password_hash,name,role,email_verified) VALUES(:email,:hash,"Admin","admin",1)', { email:admin_email, hash });
    }
    await setSetting('app.installed','true');
    await setSetting('app.url', app_url || '');
    await setSetting('ai.api_key', ai_api_key || '', true);
    await setSetting('ai.base_url', 'https://api.aitunnel.ru/v1/');
    await setSetting('ai.model', ai_model || 'openai/gpt-5.4-mini');
    await setSetting('ai.max_tokens', '2000');
    await setSetting('payments.yoomoney.enabled', yoomoney_receiver ? 'true':'false');
    await setSetting('payments.yoomoney.receiver', yoomoney_receiver || '', true);
    await setSetting('payments.yoomoney.secret', '', true);
    await setSetting('payments.cryptobot.enabled', cryptobot_token ? 'true':'false');
    await setSetting('payments.cryptobot.token', cryptobot_token || '', true);
    await setSetting('payments.cryptobot.asset','USDT');
    await setSetting('xui.enabled','false');
    req.flash('success','Установка завершена. Войди в админку.');
    res.redirect('/login');
  } catch(e) { req.flash('error', e.message); res.redirect('/install'); }
});
module.exports = router;
