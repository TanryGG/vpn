const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query, one } = require('../config/db');
const { guestOnly } = require('../middleware/auth');
const { sendRegistrationEmail } = require('../services/mailer');
const { sendVerificationCode } = require('../services/emailVerification');
const router = express.Router();

router.get('/register', guestOnly, (req,res)=>res.render('register',{title:'Регистрация', ref:req.query.ref || ''}));
router.post('/register', guestOnly, async (req,res)=>{
  try{
    const {email,password,name,ref} = req.body;
    if(!email || !password || password.length < 8) throw new Error('Email и пароль минимум 8 символов обязательны');
    if(await one('SELECT id FROM users WHERE email=:email',{email})) throw new Error('Email уже зарегистрирован');
    let referredBy = null;
    if (ref) {
      const refUser = await one('SELECT id FROM users WHERE referral_code=:c', {c:String(ref).trim()});
      if (refUser) referredBy = refUser.id;
    }
    const hash = await bcrypt.hash(password, 12);
    const referralCode = crypto.randomBytes(5).toString('hex');
    const result = await query('INSERT INTO users(email,password_hash,name,referred_by,referral_code) VALUES(:email,:hash,:name,:ref,:code)',{email,hash,name:name||'',ref:referredBy,code:referralCode});
    const user = { id: result.insertId, email, name:name||'' };
    if (referredBy) await query('INSERT INTO referral_events(referrer_user_id,referred_user_id,status) VALUES(:r,:u,"registered")', {r:referredBy,u:user.id});
    await sendRegistrationEmail(user);
    await sendVerificationCode(user.id).catch(()=>{});
    req.flash('success','Аккаунт создан. Войди в кабинет и подтверди почту, чтобы получить пробный VPN + GPT на 1 день.'); res.redirect('/login');
  }catch(e){req.flash('error',e.message);res.redirect('/register' + (req.body.ref ? '?ref=' + encodeURIComponent(req.body.ref) : ''));}
});
router.get('/login', guestOnly, (req,res)=>res.render('login',{title:'Вход'}));
router.post('/login', guestOnly, async (req,res)=>{
  try{
    const {email,password}=req.body;
    const user = await one('SELECT * FROM users WHERE email=:email',{email});
    if(!user || !(await bcrypt.compare(password, user.password_hash))) throw new Error('Неверный email или пароль');
    if(user.status !== 'active') throw new Error('Аккаунт заблокирован');
    req.session.user = { id:user.id, email:user.email, name:user.name, role:user.role };
    res.redirect(user.role === 'admin' ? '/admin' : '/dashboard');
  }catch(e){req.flash('error',e.message);res.redirect('/login');}
});
router.post('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/')));
module.exports = router;
