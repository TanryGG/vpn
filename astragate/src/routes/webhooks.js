const express = require('express');
const { handleYooMoneyWebhook, handleCryptoBotWebhook } = require('../services/payments');
const router = express.Router();
router.post('/yoomoney', express.urlencoded({extended:false}), async (req,res)=>{ try { await handleYooMoneyWebhook(req.body); res.send('OK'); } catch(e){ console.error(e); res.status(400).send('ERR'); } });
router.post('/cryptobot', express.json({type:'*/*'}), async (req,res)=>{ try { await handleCryptoBotWebhook(req.body); res.send('OK'); } catch(e){ console.error(e); res.status(400).send('ERR'); } });
module.exports = router;
