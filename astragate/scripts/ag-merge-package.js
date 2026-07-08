const fs=require('fs');
const baseDeps={"axios":"^1.7.9","bcrypt":"^5.1.1","bcryptjs":"^2.4.3","body-parser":"^1.20.3","connect-flash":"^0.1.1","cookie-parser":"^1.4.7","cors":"^2.8.5","csurf":"^1.11.0","dotenv":"^16.4.7","ejs":"^3.1.10","express":"^4.18.3","express-ejs-layouts":"^2.5.1","express-session":"^1.18.1","helmet":"^7.2.0","lodash":"^4.17.21","method-override":"^3.0.0","morgan":"^1.10.0","multer":"^1.4.5-lts.1","mysql":"^2.18.1","mysql2":"^3.11.5","node-cron":"^3.0.3","node-fetch":"^2.7.0","nodemailer":"^6.9.16","qrcode":"^1.5.4","telegraf":"^4.16.3","uuid":"^9.0.1","yauzl":"^3.2.0","adm-zip":"^0.5.16","form-data":"^4.0.1","jsonwebtoken":"^9.0.2","marked":"^12.0.2","ws":"^8.18.0"};
let p={};try{p=JSON.parse(fs.readFileSync('package.json','utf8'))}catch(e){}
if(!p.name || /telegram-proxy|autosetup|update/i.test(p.name)) p.name='vpn-gpt-full';
p.version=p.version||'2026.05.29-hard-reset-fixed';p.private=true;p.main=p.main||'src/app.js';p.scripts=Object.assign({start:'node src/app.js'},p.scripts||{});p.dependencies=Object.assign({},baseDeps,p.dependencies||{});
fs.writeFileSync('package.json',JSON.stringify(p,null,2));console.log('[pkg] package.json merged');
