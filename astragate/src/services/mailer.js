const nodemailer = require('nodemailer');
const { getSettingsMap } = require('./settings');
const { query } = require('../config/db');

async function getTransport() {
  const s = await getSettingsMap();
  if (s['smtp.enabled'] !== 'true') return null;
  if (!s['smtp.host'] || !s['smtp.user']) throw new Error('SMTP не настроен');
  return nodemailer.createTransport({
    host: s['smtp.host'],
    port: Number(s['smtp.port'] || 587),
    secure: s['smtp.secure'] === 'true',
    auth: { user: s['smtp.user'], pass: s['smtp.password'] || '' }
  });
}
async function sendMail({ userId=null, to, subject, text, html }) {
  const s = await getSettingsMap();
  if (s['smtp.enabled'] !== 'true') return { skipped:true };
  try {
    const transport = await getTransport();
    const info = await transport.sendMail({ from: s['smtp.from'] || s['smtp.user'], to, subject, text, html });
    await query('INSERT INTO email_log(user_id,email,subject,status) VALUES(:u,:e,:s,"sent")', {u:userId,e:to,s:subject});
    return info;
  } catch(e) {
    await query('INSERT INTO email_log(user_id,email,subject,status,error) VALUES(:u,:e,:s,"failed",:err)', {u:userId,e:to,s:subject,err:e.message});
    throw e;
  }
}
async function sendRegistrationEmail(user) {
  const s = await getSettingsMap();
  if (s['smtp.registration_email'] !== 'true') return;
  await sendMail({
    userId:user.id,
    to:user.email,
    subject:'Регистрация в AstraGate',
    text:`Здравствуйте${user.name ? ', '+user.name : ''}. Аккаунт создан. Подтверди почту в кабинете, чтобы получить пробный VPN + GPT на 1 день.`,
    html:`<p>Здравствуйте${user.name ? ', '+user.name : ''}.</p><p>Аккаунт создан. Подтверди почту в кабинете, чтобы получить пробный VPN + GPT на 1 день.</p>`
  }).catch(()=>{});
}
async function sendEmailVerificationCode(user, code) {
  await sendMail({
    userId: user.id,
    to: user.email,
    subject: 'Код подтверждения почты AstraGate',
    text: `Код подтверждения почты: ${code}. Код действует 30 минут. После подтверждения можно получить пробный VPN + GPT на 1 день.`,
    html: `<p>Код подтверждения почты:</p><h2 style="letter-spacing:3px">${code}</h2><p>Код действует 30 минут. После подтверждения можно получить пробный VPN + GPT на 1 день.</p>`
  });
}
module.exports = { sendMail, sendRegistrationEmail, sendEmailVerificationCode };
