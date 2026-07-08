const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { notifySupportTicketCreated, notifySupportUserReply } = require('../services/telegram');
const { query, one } = require('../config/db');
const router = express.Router();
router.use((req,res,next)=>{ if(!req.session || !req.session.user) return res.redirect('/login'); next(); });

const uploadDir = path.join(process.cwd(), 'uploads', 'support');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 25 * 1024 * 1024, files: 5 }
});
function uploadFiles(req,res,next){
  upload.array('files',5)(req,res,(err)=>{
    if(err){
      req.flash('error', err.message || 'Ошибка загрузки файла');
      const back = req.params && req.params.id ? `/support/${req.params.id}` : '/support/new';
      return res.redirect(back);
    }
    next();
  });
}

router.get('/support', async (req,res)=>{
  const tickets = await query('SELECT * FROM support_tickets WHERE user_id=:uid ORDER BY updated_at DESC LIMIT 200',{uid:req.session.user.id});
  res.render('support/index',{title:'Поддержка',tickets});
});
router.get('/support/new', async (req,res)=>res.render('support/new',{title:'Новый тикет'}));
router.post('/support/new', uploadFiles, async (req,res)=>{
  const subject=String(req.body.subject||'').trim();
  const message=String(req.body.message||'').trim();
  if(!subject||!message){ req.flash('error','Заполни тему и сообщение'); return res.redirect('/support/new'); }
  const r=await query('INSERT INTO support_tickets(user_id,subject,status,priority,last_message_at) VALUES(:uid,:subject,"open",:priority,NOW())',{uid:req.session.user.id,subject,priority:req.body.priority||'normal'});
  const mr=await query('INSERT INTO support_messages(ticket_id,user_id,sender_role,message) VALUES(:tid,:uid,"user",:msg)',{tid:r.insertId,uid:req.session.user.id,msg:message});
  for(const f of (req.files||[])) await query('INSERT INTO support_files(ticket_id,message_id,user_id,original_name,stored_name,mime_type,size_bytes,file_path) VALUES(:tid,:mid,:uid,:on,:sn,:mt,:sz,:fp)',{tid:r.insertId,mid:mr.insertId,uid:req.session.user.id,on:f.originalname,sn:f.filename,mt:f.mimetype,sz:f.size,fp:f.path});
  await notifySupportTicketCreated({ ticketId:r.insertId, subject, message, user:req.session.user }).catch(()=>{});
  req.flash('success','Тикет создан');
  res.redirect('/support/'+r.insertId);
});
router.get('/support/:id', async (req,res)=>{
  const ticket=await one('SELECT * FROM support_tickets WHERE id=:id AND user_id=:uid',{id:req.params.id,uid:req.session.user.id});
  if(!ticket) return res.status(404).render('error',{title:'404',message:'Тикет не найден'});
  const messages=await query('SELECT sm.*,u.email,u.name FROM support_messages sm LEFT JOIN users u ON u.id=sm.user_id WHERE sm.ticket_id=:id ORDER BY sm.id',{id:ticket.id});
  res.render('support/show',{title:'Тикет #'+ticket.id,ticket,messages});
});
router.post('/support/:id/reply', uploadFiles, async (req,res)=>{
  const ticket=await one('SELECT * FROM support_tickets WHERE id=:id AND user_id=:uid',{id:req.params.id,uid:req.session.user.id});
  if(!ticket) return res.status(404).render('error',{title:'404',message:'Тикет не найден'});
  const message=String(req.body.message||'').trim();
  if(!message && !(req.files||[]).length){ req.flash('error','Сообщение пустое'); return res.redirect('/support/'+ticket.id); }
  const mr=await query('INSERT INTO support_messages(ticket_id,user_id,sender_role,message) VALUES(:tid,:uid,"user",:msg)',{tid:ticket.id,uid:req.session.user.id,msg:message});
  for(const f of (req.files||[])) await query('INSERT INTO support_files(ticket_id,message_id,user_id,original_name,stored_name,mime_type,size_bytes,file_path) VALUES(:tid,:mid,:uid,:on,:sn,:mt,:sz,:fp)',{tid:ticket.id,mid:mr.insertId,uid:req.session.user.id,on:f.originalname,sn:f.filename,mt:f.mimetype,sz:f.size,fp:f.path});
  await query('UPDATE support_tickets SET status="open", last_message_at=NOW(), updated_at=NOW() WHERE id=:id',{id:ticket.id});
  await notifySupportUserReply({ ticketId:ticket.id, subject:ticket.subject, message, user:req.session.user }).catch(()=>{});
  res.redirect('/support/'+ticket.id);
});
router.post('/support/:id/close', async (req,res)=>{
  await query('UPDATE support_tickets SET status="closed", updated_at=NOW() WHERE id=:id AND user_id=:uid',{id:req.params.id,uid:req.session.user.id});
  req.flash('success','Тикет закрыт');
  res.redirect('/support');
});
module.exports = router;
