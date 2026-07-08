const dayjs = require('dayjs');
const { query, one } = require('../config/db');
const { getSetting, getSettingsMap } = require('./settings');

async function getActiveSubscription(userId) {
  return one(`SELECT s.*, p.name plan_name, p.code plan_code, p.gpt_monthly_tokens, p.vpn_enabled, p.gpt_enabled, p.plan_kind, p.period_kind, COALESCE(s.device_limit,p.device_limit,1) device_limit, COALESCE(s.total_gb,p.total_gb,0) total_gb
    FROM subscriptions s JOIN plans p ON p.id=s.plan_id
    WHERE s.user_id=:userId AND s.status='active' AND s.ends_at > NOW()
    ORDER BY s.ends_at DESC LIMIT 1`, { userId });
}
async function getActiveVpnSubscription(userId, white = false) {
  const whiteSql = white ? ' AND p.white_vpn_enabled=1' : ' AND COALESCE(p.white_vpn_enabled,0)=0';
  return one(`SELECT s.*, p.name plan_name, p.white_vpn_enabled, COALESCE(s.device_limit,p.device_limit,1) device_limit, COALESCE(s.total_gb,p.total_gb,0) total_gb FROM subscriptions s JOIN plans p ON p.id=s.plan_id
    WHERE s.user_id=:userId AND s.status='active' AND s.ends_at > NOW() AND p.vpn_enabled=1 ${whiteSql}
    ORDER BY s.ends_at DESC LIMIT 1`, { userId });
}
async function getActiveWhiteVpnSubscription(userId) { return getActiveVpnSubscription(userId, true); }
async function listUserSubscriptions(userId) {
  return query(`SELECT s.*, p.name plan_name, p.plan_kind, p.vpn_enabled, p.gpt_enabled, p.white_vpn_enabled, COALESCE(s.device_limit,p.device_limit,1) device_limit, COALESCE(s.total_gb,p.total_gb,0) total_gb
    FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=:userId ORDER BY FIELD(s.status,'active','expired','cancelled'), s.ends_at DESC`, {userId});
}
async function cancelSubscription(subId) { await query('UPDATE subscriptions SET status="cancelled" WHERE id=:id', {id:subId}); }
async function cancelUserSubscriptions(userId, mode='all') {
  let extra='';
  if(mode==='vpn') extra=' AND p.vpn_enabled=1 AND COALESCE(p.white_vpn_enabled,0)=0';
  if(mode==='white') extra=' AND p.white_vpn_enabled=1';
  if(mode==='gpt') extra=' AND p.gpt_enabled=1';
  await query(`UPDATE subscriptions s JOIN plans p ON p.id=s.plan_id SET s.status='cancelled' WHERE s.user_id=:userId AND s.status='active' ${extra}`, {userId});
}

async function getActiveGptSubscription(userId) {
  return one(`SELECT s.*, p.name plan_name, p.gpt_monthly_tokens, COALESCE(s.device_limit,p.device_limit,1) device_limit, COALESCE(s.total_gb,p.total_gb,0) total_gb FROM subscriptions s JOIN plans p ON p.id=s.plan_id
    WHERE s.user_id=:userId AND s.status='active' AND s.ends_at > NOW() AND p.gpt_enabled=1
    ORDER BY s.ends_at DESC LIMIT 1`, { userId });
}
async function grantSubscription(userId, planId, source='manual') {
  const plan = await one('SELECT * FROM plans WHERE id=:planId', { planId });
  if (!plan) throw new Error('Тариф не найден');
  let active = null;
  if (plan.white_vpn_enabled) active = await getActiveWhiteVpnSubscription(userId);
  else if (plan.vpn_enabled && !plan.gpt_enabled) active = await getActiveVpnSubscription(userId, false);
  else if (!plan.vpn_enabled && plan.gpt_enabled) active = await getActiveGptSubscription(userId);
  else active = await getActiveSubscription(userId);
  const start = active && dayjs(active.ends_at).isAfter(dayjs()) ? dayjs(active.ends_at) : dayjs();
  const end = start.add(plan.days, 'day');
  await query('INSERT INTO subscriptions(user_id,plan_id,starts_at,ends_at,source,device_limit,total_gb) VALUES(:userId,:planId,:starts,:ends,:source,:deviceLimit,:totalGb)', {
    userId, planId, starts: start.format('YYYY-MM-DD HH:mm:ss'), ends: end.format('YYYY-MM-DD HH:mm:ss'), source, deviceLimit: Number(plan.device_limit || 1), totalGb: Number(plan.total_gb || 0)
  });
  return getActiveSubscription(userId);
}
async function grantReferralBonus(payment) {
  const s = await getSettingsMap();
  if (s['referral.enabled'] !== 'true') return;
  const user = await one('SELECT * FROM users WHERE id=:id', {id:payment.user_id});
  if (!user?.referred_by) return;
  const exists = await one('SELECT id FROM referral_events WHERE referred_user_id=:u AND status="paid" LIMIT 1', {u:user.id});
  if (exists) return;
  const bonusDays = Number(s['referral.bonus_days'] || 0);
  let bonusPlan = null;
  if (s['referral.bonus_plan_code']) bonusPlan = await one('SELECT * FROM plans WHERE code=:c', {c:s['referral.bonus_plan_code']});
  if (!bonusPlan) bonusPlan = await one('SELECT * FROM plans WHERE is_active=1 ORDER BY sort_order LIMIT 1');
  if (bonusDays > 0 && bonusPlan) {
    const start = dayjs(); const end = start.add(bonusDays, 'day');
    await query('INSERT INTO subscriptions(user_id,plan_id,starts_at,ends_at,source,device_limit,total_gb) VALUES(:u,:p,:s,:e,"referral_bonus",:dl,:tg)', {u:user.referred_by,p:bonusPlan.id,s:start.format('YYYY-MM-DD HH:mm:ss'),e:end.format('YYYY-MM-DD HH:mm:ss'),dl:Number(bonusPlan.device_limit||1),tg:Number(bonusPlan.total_gb||0)});
  }
  await query('INSERT INTO referral_events(referrer_user_id,referred_user_id,payment_id,bonus_days,status) VALUES(:r,:u,:p,:d,"paid")', {r:user.referred_by,u:user.id,p:payment.id,d:bonusDays});
}
async function expireOld() {
  await query("UPDATE subscriptions SET status='expired' WHERE status='active' AND ends_at <= NOW()");
  try {
    const { syncVpnAccess } = require('./vpn');
    await syncVpnAccess();
  } catch (e) {
    console.error('VPN access sync failed:', e.message);
  }
}
async function monthlyUsage(userId) {
  const row = await one(`SELECT COALESCE(SUM(NULLIF(charged_tokens,0)), COALESCE(SUM(total_tokens),0), 0) tokens FROM gpt_usage WHERE user_id=:userId AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`, { userId });
  return Number(row?.tokens || 0);
}
module.exports = { getActiveSubscription, getActiveVpnSubscription, getActiveWhiteVpnSubscription, getActiveGptSubscription, listUserSubscriptions, cancelSubscription, cancelUserSubscriptions, grantSubscription, grantReferralBonus, expireOld, monthlyUsage };
