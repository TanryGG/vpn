const { query } = require('../config/db');
async function log(userId, action, details='', ip='') {
  try { await query('INSERT INTO audit_log(user_id,action,details,ip) VALUES(:userId,:action,:details,:ip)', { userId, action, details, ip }); } catch(e) {}
}
module.exports = { log };
