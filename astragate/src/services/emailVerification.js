const crypto = require('crypto');
const dayjs = require('dayjs');
const { query, one } = require('../config/db');
const { sendEmailVerificationCode } = require('./mailer');
const { getSettingsMap } = require('./settings');

function makeCode() { return String(crypto.randomInt(100000, 999999)); }

async function sendVerificationCode(userId) {
  const settings = await getSettingsMap();
  if (settings['smtp.enabled'] !== 'true') throw new Error('SMTP не включён. Подтверждение почты сейчас недоступно.');
  const user = await one('SELECT * FROM users WHERE id=:id', { id:userId });
  if (!user) throw new Error('Пользователь не найден');
  if (Number(user.email_verified) === 1) return { already:true };
  const code = makeCode();
  await query('UPDATE email_verification_codes SET status="expired" WHERE user_id=:uid AND status="pending"', { uid:userId });
  await query(`INSERT INTO email_verification_codes(user_id,email,code,expires_at)
    VALUES(:uid,:email,:code,DATE_ADD(NOW(), INTERVAL 30 MINUTE))`, { uid:userId, email:user.email, code });
  await sendEmailVerificationCode(user, code);
  return { sent:true };
}

async function confirmVerificationCode(userId, code) {
  const row = await one(`SELECT * FROM email_verification_codes
    WHERE user_id=:uid AND code=:code AND status='pending'
    ORDER BY id DESC LIMIT 1`, { uid:userId, code:String(code || '').trim() });
  if (!row) throw new Error('Код неверный');
  if (dayjs(row.expires_at).isBefore(dayjs())) {
    await query('UPDATE email_verification_codes SET status="expired" WHERE id=:id', { id:row.id });
    throw new Error('Код истёк, запроси новый');
  }
  await query('UPDATE users SET email_verified=1, email_verified_at=NOW() WHERE id=:uid', { uid:userId });
  await query('UPDATE email_verification_codes SET status="used", used_at=NOW() WHERE id=:id', { id:row.id });
  return true;
}

async function hasClaimedTrial(userId) {
  const row = await one('SELECT id FROM user_trial_claims WHERE user_id=:uid LIMIT 1', { uid:userId });
  return !!row;
}

module.exports = { sendVerificationCode, confirmVerificationCode, hasClaimedTrial };
