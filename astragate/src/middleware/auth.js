const ROLE_LEVELS = { user: 0, moderator: 1, admin_l1: 2, admin_l2: 3, admin_l3: 4, admin: 4 };
function getRoleLevel(user){ return ROLE_LEVELS[user?.role] || 0; }
function requireAuth(req, res, next) { if (!req.session.user) return res.redirect('/login'); next(); }
function requireAdmin(req, res, next) { if (!req.session.user) return res.redirect('/login'); if (getRoleLevel(req.session.user) < 1) return res.status(403).render('error', { title: '403', message: 'Нет доступа' }); next(); }
function requireLevel(level){ return (req,res,next)=>{ if (!req.session.user) return res.redirect('/login'); if (getRoleLevel(req.session.user) < level) return res.status(403).render('error', { title:'403', message:'Недостаточно прав' }); next(); }; }
function guestOnly(req, res, next) { if (req.session.user) return res.redirect('/dashboard'); next(); }
module.exports = { requireAuth, requireAdmin, requireLevel, guestOnly, getRoleLevel };
