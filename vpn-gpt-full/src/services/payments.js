const crypto = require('crypto');
const axios = require('axios');
const { query, one } = require('../config/db');
const { getSettingsMap } = require('./settings');
const { grantSubscription, grantReferralBonus } = require('./subscriptions');
const { validatePromo, markPromoUsed } = require('./promos');
const { notifyPaymentPaid } = require('./telegram');

async function createPaymentRecord(user, plan, provider, promoCode='') {
  const promoData = await validatePromo(promoCode, plan);
  const referrer = user.referred_by || null;
  const providerPaymentId = `${provider}_${Date.now()}_${user.id}_${plan.id}`;
  await query(`INSERT INTO payments(user_id,plan_id,provider,provider_payment_id,amount,original_amount,discount_amount,currency,status,promo_code_id,referrer_user_id)
    VALUES(:u,:p,:provider,:pid,:amount,:original,:discount,:cur,'pending',:promo,:ref)`, {
    u:user.id,p:plan.id,provider,pid:providerPaymentId,amount:promoData.final,original:plan.price,discount:promoData.discount,cur:plan.currency,promo:promoData.promo?.id||null,ref:referrer
  });
  return { label:providerPaymentId, amount:promoData.final, promo:promoData.promo, discount:promoData.discount };
}
async function finalizePayment(payment, rawPayload={}) {
  if (!payment || payment.status === 'paid') return;
  await query('UPDATE payments SET status="paid", raw_payload=:raw, paid_at=NOW() WHERE id=:id', { id:payment.id, raw:JSON.stringify(rawPayload) });
  await grantSubscription(payment.user_id, payment.plan_id, payment.provider);
  try {
    const plan = await one('SELECT * FROM plans WHERE id=:id', { id: payment.plan_id });
    if (plan?.vpn_enabled) {
      const user = await one('SELECT id,email,name,role FROM users WHERE id=:id', { id: payment.user_id });
      if (user) {
        const { createOrGetVpn } = require('./vpn');
        await createOrGetVpn(user, true, plan.white_vpn_enabled ? 'white' : 'main');
      }
    }
  } catch (e) { console.error('VPN restore after payment failed:', e.message); }
  try {
    const user = await one('SELECT * FROM users WHERE id=:id', { id: payment.user_id });
    const plan = await one('SELECT * FROM plans WHERE id=:id', { id: payment.plan_id });
    await notifyPaymentPaid({ payment: {...payment, status:'paid'}, user, plan });
  } catch(e) { console.error('Telegram payment notify failed:', e.message); }
  if (payment.promo_code_id) await markPromoUsed(payment.promo_code_id);
  await grantReferralBonus({...payment, status:'paid'});
}
async function createYooMoneyPayment(user, plan, promoCode='') {
  const s = await getSettingsMap();
  if (s['payments.yoomoney.enabled'] !== 'true') throw new Error('YooMoney выключен');
  const receiver = s['payments.yoomoney.receiver'];
  if (!receiver) throw new Error('YooMoney receiver не настроен');
  const p = await createPaymentRecord(user, plan, 'yoomoney', promoCode);
  const url = new URL('https://yoomoney.ru/quickpay/confirm.xml');
  url.searchParams.set('receiver', receiver);
  url.searchParams.set('quickpay-form', 'shop');
  url.searchParams.set('targets', `VPN+GPT ${plan.name}`);
  url.searchParams.set('paymentType', 'AC');
  url.searchParams.set('sum', String(p.amount));
  url.searchParams.set('label', p.label);
  url.searchParams.set('successURL', (s['app.url'] || '') + '/payments/success');
  return url.toString();
}
function verifyYooMoney(body, secret) {
  const fields = ['notification_type','operation_id','amount','currency','datetime','sender','codepro','notification_secret','label'];
  const str = fields.map(k => body[k] || '').join('&');
  const sha1 = crypto.createHash('sha1').update(str).digest('hex');
  return sha1 === body.sha1_hash;
}
async function handleYooMoneyWebhook(body) {
  const s = await getSettingsMap();
  const secret = s['payments.yoomoney.secret'];
  if (secret && !verifyYooMoney(body, secret)) throw new Error('Bad YooMoney signature');
  const payment = await one('SELECT * FROM payments WHERE provider="yoomoney" AND provider_payment_id=:label', { label:body.label });
  if (!payment) throw new Error('Payment not found');
  await finalizePayment(payment, body);
}
function normalizeMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return n.toFixed(8).replace(/\.?0+$/, '');
}
async function getCryptoBotRates(token) {
  const r = await axios.get('https://pay.crypt.bot/api/getExchangeRates', {
    headers: { 'Crypto-Pay-API-Token': token },
    timeout: 15000
  });
  if (!r.data?.ok || !Array.isArray(r.data.result)) {
    throw new Error('CryptoBot не вернул курсы валют: ' + JSON.stringify(r.data));
  }
  return r.data.result.filter(x => x && x.is_valid !== false);
}
function findRate(rates, source, target) {
  source = String(source).toUpperCase();
  target = String(target).toUpperCase();
  return rates.find(x => String(x.source).toUpperCase() === source && String(x.target).toUpperCase() === target);
}
async function convertRubToCrypto(token, rubAmount, asset) {
  asset = String(asset || 'USDT').toUpperCase();
  const rub = Number(rubAmount || 0);
  if (!Number.isFinite(rub) || rub <= 0) throw new Error('Некорректная сумма для CryptoBot');
  if (asset === 'RUB') return { amount: normalizeMoney(rub), rate: 1, asset: 'RUB', source: 'RUB', target: 'RUB' };
  const rates = await getCryptoBotRates(token);

  // Обычно CryptoBot отдаёт пару вида USDT -> RUB: rate = сколько рублей стоит 1 USDT.
  const direct = findRate(rates, asset, 'RUB');
  if (direct && Number(direct.rate) > 0) {
    const rate = Number(direct.rate);
    return { amount: normalizeMoney(rub / rate), rate, asset, source: asset, target: 'RUB' };
  }

  // На случай если API вернул обратную пару RUB -> USDT.
  const inverse = findRate(rates, 'RUB', asset);
  if (inverse && Number(inverse.rate) > 0) {
    const rate = Number(inverse.rate);
    return { amount: normalizeMoney(rub * rate), rate, asset, source: 'RUB', target: asset };
  }

  throw new Error(`CryptoBot: не найден курс RUB -> ${asset}. Проверь asset в настройках CryptoBot.`);
}
async function createCryptoBotPayment(user, plan, promoCode='') {
  const s = await getSettingsMap();
  if (s['payments.cryptobot.enabled'] !== 'true') throw new Error('CryptoBot выключен');
  const token = s['payments.cryptobot.token'];
  if (!token) throw new Error('CryptoBot token не настроен');
  const asset = String(s['payments.cryptobot.asset'] || 'USDT').toUpperCase();
  const p = await createPaymentRecord(user, plan, 'cryptobot', promoCode);
  const converted = await convertRubToCrypto(token, p.amount, asset);
  const r = await axios.post('https://pay.crypt.bot/api/createInvoice', {
    asset,
    amount: converted.amount,
    description: `AstraGate ${plan.name} — ${p.amount} RUB`,
    payload: JSON.stringify({ user_id:user.id, plan_id:plan.id, t:Date.now(), label:p.label, rub_amount:p.amount, crypto_amount:converted.amount, asset }),
    allow_comments: false,
    allow_anonymous: false
  }, { headers: { 'Crypto-Pay-API-Token': token }, timeout: 15000 });
  if (!r.data?.ok) throw new Error('CryptoBot error: ' + JSON.stringify(r.data));
  const inv = r.data.result;
  const raw = {
    invoice: inv,
    conversion: {
      rub_amount: p.amount,
      crypto_amount: converted.amount,
      asset,
      rate: converted.rate,
      rate_source: converted.source,
      rate_target: converted.target,
      discount: p.discount || 0,
      promo: p.promo?.code || null
    }
  };
  await query('UPDATE payments SET provider_payment_id=:pid, amount=:amount, currency=:cur, raw_payload=:raw WHERE provider_payment_id=:old', {
    pid:String(inv.invoice_id), amount: converted.amount, cur:asset, raw:JSON.stringify(raw), old:p.label
  });
  return inv.pay_url;
}
async function handleCryptoBotWebhook(body) {
  if (body.update_type !== 'invoice_paid') return;
  const inv = body.payload;
  const payment = await one('SELECT * FROM payments WHERE provider="cryptobot" AND provider_payment_id=:id', { id:String(inv.invoice_id) });
  if (!payment) throw new Error('Payment not found');
  await finalizePayment(payment, body);
}
module.exports = { createYooMoneyPayment, handleYooMoneyWebhook, createCryptoBotPayment, handleCryptoBotWebhook, finalizePayment };
