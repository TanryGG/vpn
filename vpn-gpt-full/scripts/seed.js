require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query, one } = require('../src/config/db');

async function main(){
  const plans = [
    ['trial-combo-day','Пробный VPN + GPT · 1 день',0,'RUB',1,1,1,300000,0,'combo','daily','Пробная подписка после подтверждения почты',1,0,'Trial'],
    ['vpn-day-1','VPN День · 1 устройство',13,'RUB',1,1,0,0,1,'vpn','daily','Только VPN на 1 день',1,0,'1 устройство'],
    ['vpn-day-3','VPN День · 3 устройства',19,'RUB',1,1,0,0,2,'vpn','daily','Только VPN на 1 день для 3 устройств',3,0,'3 устройства'],
    ['vpn-day-5','VPN День · 5 устройств',26,'RUB',1,1,0,0,3,'vpn','daily','Только VPN на 1 день для 5 устройств',5,0,'5 устройств'],
    ['vpn-week-1','VPN Неделя · 1 устройство',46,'RUB',7,1,0,0,10,'vpn','weekly','Только VPN на 7 дней',1,0,'1 устройство'],
    ['vpn-week-3','VPN Неделя · 3 устройства',66,'RUB',7,1,0,0,11,'vpn','weekly','VPN на неделю для 3 устройств',3,0,'3 устройства'],
    ['vpn-week-5','VPN Неделя · 5 устройств',86,'RUB',7,1,0,0,12,'vpn','weekly','VPN на неделю для 5 устройств',5,0,'5 устройств'],
    ['vpn-month-1','VPN Месяц · 1 устройство',113,'RUB',30,1,0,0,20,'vpn','monthly','VPN на 30 дней',1,0,'1 устройство'],
    ['vpn-month-3','VPN Месяц · 3 устройства',166,'RUB',30,1,0,0,21,'vpn','monthly','VPN на 30 дней для 3 устройств',3,0,'3 устройства'],
    ['vpn-month-5','VPN Месяц · 5 устройств',219,'RUB',30,1,0,0,22,'vpn','monthly','VPN на 30 дней для 5 устройств',5,0,'5 устройств'],
    ['white-vpn-month-1','White VPN · 1 устройство',199,'RUB',30,1,0,0,30,'vpn','monthly','Стабильный маршрут для обычных сервисов',1,1,'White VPN'],
    ['white-vpn-month-3','White VPN · 3 устройства',266,'RUB',30,1,0,0,31,'vpn','monthly','White VPN для 3 устройств',3,1,'White VPN · 3'],
    ['white-vpn-month-5','White VPN · 5 устройств',333,'RUB',30,1,0,0,32,'vpn','monthly','White VPN для 5 устройств',5,1,'White VPN · 5'],
    ['gpt-day','GPT День',19,'RUB',1,0,1,250000,40,'gpt','daily','GPT на 1 день',0,0,'GPT'],
    ['gpt-week','GPT Неделя',79,'RUB',7,0,1,1000000,41,'gpt','weekly','GPT на 7 дней',0,0,'GPT'],
    ['gpt-month','GPT Месяц',166,'RUB',30,0,1,4000000,42,'gpt','monthly','GPT на 30 дней',0,0,'GPT'],
    ['combo-day-1','VPN + GPT День · 1 устройство',26,'RUB',1,1,1,300000,50,'combo','daily','VPN и GPT на 1 день',1,0,'Combo'],
    ['combo-day-3','VPN + GPT День · 3 устройства',39,'RUB',1,1,1,300000,51,'combo','daily','VPN и GPT на 1 день для 3 устройств',3,0,'3 устройства'],
    ['combo-week-1','VPN + GPT Неделя · 1 устройство',93,'RUB',7,1,1,1200000,60,'combo','weekly','VPN и GPT на 7 дней',1,0,'Combo'],
    ['combo-week-3','VPN + GPT Неделя · 3 устройства',133,'RUB',7,1,1,1200000,61,'combo','weekly','VPN и GPT на 7 дней для 3 устройств',3,0,'3 устройства'],
    ['combo-month-1','VPN + GPT Месяц · 1 устройство',233,'RUB',30,1,1,5000000,70,'combo','monthly','VPN и GPT на 30 дней',1,0,'Combo'],
    ['combo-month-3','VPN + GPT Месяц · 3 устройства',333,'RUB',30,1,1,5000000,71,'combo','monthly','VPN и GPT на 30 дней для 3 устройств',3,0,'3 устройства'],
    ['combo-month-5','VPN + GPT Месяц · 5 устройств',433,'RUB',30,1,1,5000000,72,'combo','monthly','VPN и GPT на 30 дней для 5 устройств',5,0,'5 устройств'],
    ['combo-max-5','VPN + GPT Max · 5 устройств',533,'RUB',30,1,1,9000000,73,'combo','monthly','Максимальный тариф на месяц: VPN и GPT для 5 устройств',5,0,'MAX']
  ];
  for(const p of plans){
    await query(`INSERT INTO plans(code,name,price,currency,days,vpn_enabled,gpt_enabled,gpt_monthly_tokens,sort_order,plan_kind,period_kind,description,device_limit,white_vpn_enabled,display_badge)
    VALUES(:code,:name,:price,:currency,:days,:vpn,:gpt,:tokens,:sort,:kind,:period,:desc,:devices,:white,:badge)
    ON DUPLICATE KEY UPDATE name=VALUES(name), price=VALUES(price), currency=VALUES(currency), days=VALUES(days), vpn_enabled=VALUES(vpn_enabled), gpt_enabled=VALUES(gpt_enabled), gpt_monthly_tokens=VALUES(gpt_monthly_tokens), sort_order=VALUES(sort_order), plan_kind=VALUES(plan_kind), period_kind=VALUES(period_kind), description=VALUES(description), device_limit=VALUES(device_limit), white_vpn_enabled=VALUES(white_vpn_enabled), display_badge=VALUES(display_badge), is_active=1`,
    {code:p[0],name:p[1],price:p[2],currency:p[3],days:p[4],vpn:p[5],gpt:p[6],tokens:p[7],sort:p[8],kind:p[9],period:p[10],desc:p[11],devices:p[12],white:p[13],badge:p[14]});
  }
  await query("ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_trial TINYINT NOT NULL DEFAULT 0");
  await query("UPDATE plans SET is_trial=1, is_active=1 WHERE code='trial-combo-day'");

  // Базовые лимиты трафика для VPN-тарифов. 0 означает без лимита. Можно менять в админке.
  await query(`UPDATE plans SET total_gb=25 WHERE vpn_enabled=1 AND days<=1 AND total_gb=0`);
  await query(`UPDATE plans SET total_gb=100 WHERE vpn_enabled=1 AND days>1 AND days<=7 AND total_gb=0`);
  await query(`UPDATE plans SET total_gb=300 WHERE vpn_enabled=1 AND days>=30 AND total_gb=0`);

  const priceCutFlag = await one("SELECT value FROM settings WHERE `key`='pricing.cut_2026_05_24'").catch(()=>null);
  if (!priceCutFlag) {
    const safeCodes = plans.map(p=>String(p[0]).replace(/'/g,"\\'"));
    await query(`UPDATE plans SET price=ROUND(GREATEST(price / 2.25, 1), 2) WHERE code NOT IN ('${safeCodes.join("','")}')`);
    await query("INSERT INTO settings(`key`,value,is_secret) VALUES('pricing.cut_2026_05_24','true',0) ON DUPLICATE KEY UPDATE value='true'");
  }

  const priceCutFlag2 = await one("SELECT value FROM settings WHERE `key`='pricing.cut_2026_05_25'").catch(()=>null);
  if (!priceCutFlag2) {
    const safeCodes = plans.map(p=>String(p[0]).replace(/'/g,"\\'"));
    await query(`UPDATE plans SET price=ROUND(GREATEST(price / 1.5, 1), 0) WHERE code NOT IN ('${safeCodes.join("','")}')`);
    await query("INSERT INTO settings(`key`,value,is_secret) VALUES('pricing.cut_2026_05_25','true',0) ON DUPLICATE KEY UPDATE value='true'");
  }

  const defaultSettings = [
    ['vpn.display_name','AstraGate VPN',0],['vpn.region','Premium',0],['vpn.show_user_number','false',0],['vpn.encryption','none',0],['vpn.spider_x','/',0],['vpn.limit_ip','0',0],['vpn.total_gb','0',0],
    ['white_vpn.display_name','AstraGate White',0],
    ['white_vpn.region','White',0],
    ['white_vpn.host','',0],
    ['white_vpn.port','8443',0],
    ['white_vpn.sni','www.microsoft.com',0],
    ['white_vpn.fingerprint','chrome',0],
    ['white_vpn.flow','xtls-rprx-vision',0],
    ['white_vpn.spider_x','/',0],
    ['vpn.white_mode_name','White VPN',0],
    ['vpn.white_note','Стабильный маршрут для доступа к обычным сервисам при нестабильной сети.',0],
    ['ai.default_model_code','gpt-5.4-mini',0],
    ['ai.allow_archives','true',0],
    ['ai.max_archive_files','20',0],
    ['referral.enabled','true',0],['referral.bonus_days','3',0],['referral.bonus_plan_code','combo-day',0],['referral.percent','0',0],
    ['smtp.enabled','false',0],['smtp.host','',0],['smtp.port','587',0],['smtp.secure','false',0],['smtp.user','',0],['smtp.password','',1],['smtp.from','VPN+GPT <no-reply@example.com>',0],['smtp.registration_email','true',0],
    ['trial.enabled','true',0],['trial.plan_code','trial-combo-day',0],['trial.require_email_verified','true',0],['trial.gpt_tokens','300000',0],
    ['app.name','AstraGate',0],['app.url','https://astragate.app',0],['app.icon_url','/img/app-icon.png',0],['happ.location_icon','🇵🇱',0],['app.support_text','Support: astragate.su',0],['app.support_url','https://astragate.su',0],['app.footer_text','AstraGate — AI, VPN и приватный доступ в одном кабинете',0],['vpn.expired_label','Подписка не оплачена',0]
  ];
  for (const st of defaultSettings) {
    await query(`INSERT INTO settings(\`key\`, value, is_secret) VALUES(:key,:value,:secret)
      ON DUPLICATE KEY UPDATE value=IF(value IS NULL OR value='', VALUES(value), value)`,
      { key: st[0], value: st[1], secret: st[2] });
  }
  const users = await query('SELECT id,email,referral_code FROM users');
  for (const u of users) if(!u.referral_code) await query('UPDATE users SET referral_code=:c WHERE id=:id',{id:u.id,c:crypto.randomBytes(5).toString('hex')});




  const aiModels = [
    ['gpt-5.5-pro','OpenAI','openai/gpt-5.5-pro','GPT 5.5 PRO',576,34560,1050000,'Vision,Tools,Reasoning',12,8000,1],
    ['gpt-5.5','OpenAI','openai/gpt-5.5','GPT 5.5',96,5760,1050000,'Vision,Tools,Reasoning',4,8000,2],
    ['gpt-5.4-nano','OpenAI','openai/gpt-5.4-nano','GPT 5.4 NANO',3.84,240,400000,'Vision,Tools,Reasoning',1,4000,3],
    ['gpt-5.4-mini','OpenAI','openai/gpt-5.4-mini','GPT 5.4 MINI',14.4,864,400000,'Vision,Tools,Reasoning',1.5,5000,4],
    ['gpt-5.4-pro','OpenAI','openai/gpt-5.4-pro','GPT 5.4 PRO',576,34560,1050000,'Vision,Tools,Reasoning',10,8000,5],
    ['gpt-5.4','OpenAI','openai/gpt-5.4','GPT 5.4',48,2880,1050000,'Vision,Tools,Reasoning',3,8000,6],
    ['gpt-5.3-chat','OpenAI','openai/gpt-5.3-chat','GPT 5.3 CHAT',33.6,2688,128000,'Vision,Tools',2,4000,7],
    ['gpt-5.3-codex','OpenAI','openai/gpt-5.3-codex','GPT 5.3 CODEX',33.6,2688,400000,'Vision,Tools,Reasoning,Code',2.5,6000,8],
    ['gpt-audio','OpenAI','openai/gpt-audio','GPT AUDIO',480,1920,128000,'Tools,Audio In,Audio Out',5,4000,9],
    ['gemini-3.5-flash','Google','google/gemini-3.5-flash','GEMINI 3.5 FLASH',288,1728,1048576,'Vision,Tools,Reasoning',4,8000,20],
    ['gemini-3.1-flash-lite','Google','google/gemini-3.1-flash-lite','GEMINI 3.1 FLASH LITE',48,288,1048576,'Vision,Tools,Reasoning',1.2,4000,21],
    ['gemini-3.1-flash-lite-preview','Google','google/gemini-3.1-flash-lite-preview','GEMINI 3.1 FLASH LITE PREVIEW',48,288,1048576,'Vision,Tools,Reasoning',1.2,4000,22],
    ['gemini-3.1-pro-preview-customtools','Google','google/gemini-3.1-pro-preview-customtools','GEMINI 3.1 PRO PREVIEW CUSTOMTOOLS',38.4,2304,1048576,'Vision,Tools,Reasoning',2.4,8000,23],
    ['gemini-3.1-pro-preview','Google','google/gemini-3.1-pro-preview','GEMINI 3.1 PRO PREVIEW',38.4,2304,1048576,'Vision,Tools,Reasoning',2.4,8000,24],
    ['gemini-3-flash-preview','Google','google/gemini-3-flash-preview','GEMINI 3 FLASH PREVIEW',96,576,1048576,'Vision,Tools,Reasoning',2,6000,25]
  ];
  for(const m of aiModels){
    await query(`INSERT INTO ai_models(code,provider,model_id,name,input_price,output_price,context_tokens,capabilities,token_multiplier,max_output_tokens,sort_order,is_active)
      VALUES(:code,:provider,:model_id,:name,:in_price,:out_price,:context,:cap,:mult,:maxout,:sort,1)
      ON DUPLICATE KEY UPDATE provider=VALUES(provider), model_id=VALUES(model_id), name=VALUES(name), input_price=VALUES(input_price), output_price=VALUES(output_price), context_tokens=VALUES(context_tokens), capabilities=VALUES(capabilities), token_multiplier=VALUES(token_multiplier), max_output_tokens=VALUES(max_output_tokens), sort_order=VALUES(sort_order)`,
      {code:m[0],provider:m[1],model_id:m[2],name:m[3],in_price:m[4],out_price:m[5],context:m[6],cap:m[7],mult:m[8],maxout:m[9],sort:m[10]});
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if(adminEmail && adminPassword && !(await one('SELECT id FROM users WHERE email=:email',{email:adminEmail}))){
    const hash = await bcrypt.hash(adminPassword, 12);
    await query('INSERT INTO users(email,password_hash,name,role,email_verified,referral_code) VALUES(:email,:hash,:name,"admin",1,:code)', {email:adminEmail,hash,name:'Admin',code:crypto.randomBytes(5).toString('hex')});
  }
  console.log('Seed completed');
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
