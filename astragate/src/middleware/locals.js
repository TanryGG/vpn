const { getSettingsMap } = require('../services/settings');
module.exports = async (req,res,next)=>{
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash ? req.flash('success') : [];
  res.locals.error = req.flash ? req.flash('error') : [];
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  res.locals.siteName = process.env.SITE_NAME || 'AstraGate';
  res.locals.appIcon = '/img/app-icon.png';
  res.locals.footerText = process.env.FOOTER_TEXT || 'AstraGate — AI, VPN и приватный доступ в одном кабинете';
  res.locals.siteUrl = '';

  const maps = {
    status: { pending:'Ожидает', paid:'Оплачено', failed:'Ошибка', canceled:'Отменён', cancelled:'Отменён', active:'Активен', blocked:'Заблокирован', open:'Открыт', answered:'Отвечен', closed:'Закрыт', expired:'Истёк', disabled:'Отключён' },
    support: { open:'Открыт', pending:'В работе', answered:'Отвечен', closed:'Закрыт' },
    priority: { low:'Низкий', normal:'Обычный', high:'Высокий', urgent:'Срочный' },
    role: { user:'Пользователь', moderator:'Модератор', admin_l1:'Админ 1 уровня', admin_l2:'Админ 2 уровня', admin_l3:'Админ 3 уровня', admin:'Администратор' },
    provider: { yoomoney:'YooMoney', cryptobot:'CryptoBot', admin:'Админ', manual:'Вручную' },
    source: { admin:'Выдано админом', admin_payment:'Подтверждено админом', payment:'Оплата', yoomoney:'YooMoney', cryptobot:'CryptoBot' }
  };
  res.locals.label = (type, value) => maps[type]?.[String(value || '').toLowerCase()] || value || '-';
  try {
    const settings = await getSettingsMap();
    res.locals.siteName = settings['app.name'] || res.locals.siteName;
    res.locals.footerText = settings['app.footer_text'] || res.locals.footerText;
    res.locals.siteUrl = settings['app.url'] || '';
    res.locals.appIcon = settings['app.icon_url'] || res.locals.appIcon;
  } catch(e) {}
  next();
};
