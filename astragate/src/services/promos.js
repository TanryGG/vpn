const { one, query } = require('../config/db');

function normalize(code){ return String(code||'').trim().toUpperCase(); }
async function validatePromo(code, plan) {
  const c = normalize(code);
  if (!c) return { promo:null, discount:0, final:Number(plan.price) };
  const promo = await one('SELECT * FROM promo_codes WHERE code=:code AND is_active=1', { code:c });
  if (!promo) throw new Error('Промокод не найден или выключен');
  if (promo.valid_until && new Date(promo.valid_until) < new Date()) throw new Error('Срок промокода истёк');
  if (promo.max_uses && promo.used_count >= promo.max_uses) throw new Error('Лимит использований промокода исчерпан');
  if (promo.plan_id && Number(promo.plan_id) !== Number(plan.id)) throw new Error('Промокод не подходит для этого тарифа');
  const price = Number(plan.price);
  let discount = promo.discount_type === 'fixed' ? Number(promo.discount_value) : price * Number(promo.discount_value) / 100;
  discount = Math.max(0, Math.min(price, Math.round(discount * 100) / 100));
  return { promo, discount, final: Math.max(0, Math.round((price - discount)*100)/100) };
}
async function markPromoUsed(id){ if(id) await query('UPDATE promo_codes SET used_count=used_count+1 WHERE id=:id',{id}); }
module.exports = { validatePromo, markPromoUsed, normalize };
