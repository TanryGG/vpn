require('dotenv').config();
const mysql = require('mysql2/promise');
const env = require('../src/config/env');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(120) DEFAULT '',
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  status ENUM('active','blocked') NOT NULL DEFAULT 'active',
  email_verified TINYINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  \`key\` VARCHAR(190) NOT NULL UNIQUE,
  value TEXT,
  is_secret TINYINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'RUB',
  days INT NOT NULL DEFAULT 30,
  vpn_enabled TINYINT NOT NULL DEFAULT 1,
  gpt_enabled TINYINT NOT NULL DEFAULT 1,
  gpt_monthly_tokens INT NOT NULL DEFAULT 500000,
  sort_order INT NOT NULL DEFAULT 100,
  is_active TINYINT NOT NULL DEFAULT 1,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  plan_id INT NOT NULL,
  status ENUM('active','expired','cancelled') NOT NULL DEFAULT 'active',
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  source VARCHAR(50) DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  plan_id INT NULL,
  provider ENUM('yoomoney','cryptobot','manual') NOT NULL,
  provider_payment_id VARCHAR(190) NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'RUB',
  status ENUM('pending','paid','failed','cancelled') NOT NULL DEFAULT 'pending',
  raw_payload MEDIUMTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vpn_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  uuid VARCHAR(80) NOT NULL,
  email_label VARCHAR(190) NOT NULL,
  vless_url TEXT,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gpt_usage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  model VARCHAR(120) NOT NULL,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;



CREATE TABLE IF NOT EXISTS ai_chats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(190) NOT NULL DEFAULT 'Новый чат',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chat_id INT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('user','assistant','system') NOT NULL,
  content MEDIUMTEXT,
  model VARCHAR(120) DEFAULT '',
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(chat_id) REFERENCES ai_chats(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chat_id INT NOT NULL,
  message_id INT NULL,
  user_id INT NOT NULL,
  role ENUM('user','assistant') NOT NULL DEFAULT 'user',
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) DEFAULT '',
  size_bytes INT NOT NULL DEFAULT 0,
  file_path TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(chat_id) REFERENCES ai_chats(id) ON DELETE CASCADE,
  FOREIGN KEY(message_id) REFERENCES ai_messages(id) ON DELETE SET NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS system_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(80) NOT NULL,
  status ENUM('queued','running','done','failed') NOT NULL DEFAULT 'queued',
  log_path TEXT,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;



CREATE TABLE IF NOT EXISTS promo_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  discount_type ENUM('percent','fixed') NOT NULL DEFAULT 'percent',
  discount_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  max_uses INT NOT NULL DEFAULT 0,
  used_count INT NOT NULL DEFAULT 0,
  plan_id INT NULL,
  is_active TINYINT NOT NULL DEFAULT 1,
  valid_until DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS referral_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  referrer_user_id INT NOT NULL,
  referred_user_id INT NOT NULL,
  payment_id INT NULL,
  bonus_days INT NOT NULL DEFAULT 0,
  bonus_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status ENUM('registered','paid','cancelled') NOT NULL DEFAULT 'registered',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(referred_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(payment_id) REFERENCES payments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  email VARCHAR(190) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  status ENUM('sent','failed') NOT NULL DEFAULT 'sent',
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS telegram_bind_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(16) NOT NULL UNIQUE,
  chat_id BIGINT NOT NULL,
  username VARCHAR(190) DEFAULT '',
  first_name VARCHAR(190) DEFAULT '',
  last_name VARCHAR(190) DEFAULT '',
  used_by_user_id INT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME NULL,
  INDEX(chat_id),
  INDEX(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(120) NOT NULL,
  details TEXT,
  ip VARCHAR(80),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

async function main() {
  const conn = await mysql.createConnection(env.db);
  for (const statement of schema.split(/;\s*\n/).map(s => s.trim()).filter(Boolean)) {
    await conn.query(statement);
  }
  const alters = [
    "ALTER TABLE users MODIFY role ENUM('user','moderator','admin_l1','admin_l2','admin_l3','admin') NOT NULL DEFAULT 'user'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram VARCHAR(120) DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_linked_at DATETIME NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(40) NULL UNIQUE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INT NULL",
    "ALTER TABLE plans ADD COLUMN IF NOT EXISTS plan_kind ENUM('vpn','gpt','combo') NOT NULL DEFAULT 'combo'",
    "ALTER TABLE plans ADD COLUMN IF NOT EXISTS period_kind ENUM('daily','weekly','monthly','custom') NOT NULL DEFAULT 'monthly'",
    "ALTER TABLE plans ADD COLUMN IF NOT EXISTS device_limit INT NOT NULL DEFAULT 1",
    "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS device_limit INT NOT NULL DEFAULT 1",
    "ALTER TABLE plans ADD COLUMN IF NOT EXISTS total_gb INT NOT NULL DEFAULT 0",
    "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS total_gb INT NOT NULL DEFAULT 0",
    "ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS sub_token VARCHAR(80) DEFAULT NULL",
    "ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS subscription_url TEXT NULL",
    "ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS happ_url TEXT NULL",
    "ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS expires_at DATETIME NULL",
    "ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS total_gb INT NULL DEFAULT 0",
    "ALTER TABLE plans ADD COLUMN IF NOT EXISTS white_vpn_enabled TINYINT NOT NULL DEFAULT 0",
    "ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS account_type ENUM('main','white') NOT NULL DEFAULT 'main'",
    "ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS server_label VARCHAR(190) DEFAULT ''",
    "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS admin_note VARCHAR(255) DEFAULT ''",

    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS original_amount DECIMAL(10,2) NULL",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS promo_code_id INT NULL",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS referrer_user_id INT NULL",
    "ALTER TABLE payments MODIFY amount DECIMAL(18,8) NOT NULL DEFAULT 0",
    "ALTER TABLE payments MODIFY original_amount DECIMAL(18,8) NULL",
    "ALTER TABLE payments MODIFY discount_amount DECIMAL(18,8) NOT NULL DEFAULT 0",
  ];
  for (const sql of alters) { try { await conn.query(sql); } catch(e) { console.warn('ALTER skipped:', sql, e.message); } }

  const modelSchema = [
    `CREATE TABLE IF NOT EXISTS ai_models (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(80) NOT NULL UNIQUE,
      provider VARCHAR(80) NOT NULL DEFAULT 'OpenAI',
      model_id VARCHAR(190) NOT NULL,
      name VARCHAR(160) NOT NULL,
      input_price DECIMAL(10,2) NOT NULL DEFAULT 0,
      output_price DECIMAL(10,2) NOT NULL DEFAULT 0,
      context_tokens INT NOT NULL DEFAULT 0,
      capabilities VARCHAR(255) DEFAULT '',
      token_multiplier DECIMAL(8,2) NOT NULL DEFAULT 1.00,
      max_output_tokens INT NOT NULL DEFAULT 2000,
      sort_order INT NOT NULL DEFAULT 100,
      is_active TINYINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `ALTER TABLE gpt_usage ADD COLUMN IF NOT EXISTS charged_tokens INT NOT NULL DEFAULT 0`,
    `ALTER TABLE gpt_usage ADD COLUMN IF NOT EXISTS ai_model_id INT NULL`,
    `ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS charged_tokens INT NOT NULL DEFAULT 0`,
    `ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS ai_model_id INT NULL`,
    `ALTER TABLE plans ADD COLUMN IF NOT EXISTS white_vpn_enabled TINYINT NOT NULL DEFAULT 0`,
    `ALTER TABLE plans ADD COLUMN IF NOT EXISTS display_badge VARCHAR(80) DEFAULT ''`,
    `ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS vpn_mode VARCHAR(40) DEFAULT 'standard'`,
    `ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS disabled_at DATETIME NULL`,
    `ALTER TABLE vpn_accounts ADD COLUMN IF NOT EXISTS grace_until DATETIME NULL`
  ];
  for (const sql of modelSchema) { try { await conn.query(sql); } catch(e) { console.warn('MODEL MIGRATION skipped:', e.message); } }




  const supportSchema = [
    `CREATE TABLE IF NOT EXISTS support_tickets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      assigned_to INT NULL,
      subject VARCHAR(255) NOT NULL,
      status ENUM('open','pending','answered','closed') NOT NULL DEFAULT 'open',
      priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
      last_message_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_support_user (user_id),
      INDEX idx_support_status (status),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(assigned_to) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS support_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id INT NOT NULL,
      user_id INT NULL,
      sender_role ENUM('user','staff','system') NOT NULL DEFAULT 'user',
      message MEDIUMTEXT NOT NULL,
      is_internal TINYINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_support_msg_ticket (ticket_id),
      FOREIGN KEY(ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS support_files (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id INT NOT NULL,
      message_id INT NULL,
      user_id INT NULL,
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(160) DEFAULT '',
      size_bytes INT NOT NULL DEFAULT 0,
      file_path TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_support_file_ticket (ticket_id),
      FOREIGN KEY(ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY(message_id) REFERENCES support_messages(id) ON DELETE SET NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_to INT NULL`,
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS last_message_at DATETIME NULL`,
    `ALTER TABLE support_tickets MODIFY status ENUM('open','pending','answered','closed') NOT NULL DEFAULT 'open'`,
    `ALTER TABLE support_tickets MODIFY priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal'`,
    `ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS is_internal TINYINT NOT NULL DEFAULT 0`
  ];
  for (const sql of supportSchema) { try { await conn.query(sql); } catch(e) { console.warn('SUPPORT MIGRATION skipped:', e.message); } }

  // vpn_accounts раньше создавалась с UNIQUE(user_id), из-за этого обычный VPN и White VPN конфликтовали.
  // Снимаем старый уникальный индекс и ставим уникальность на пару user_id + account_type.
  try {
    const [idx] = await conn.query("SHOW INDEX FROM vpn_accounts WHERE Column_name='user_id' AND Non_unique=0");
    for (const i of idx) {
      if (i.Key_name !== 'PRIMARY') {
        try { await conn.query(`ALTER TABLE vpn_accounts DROP INDEX \`${i.Key_name}\``); console.log('Dropped old vpn_accounts unique index:', i.Key_name); } catch(e) { console.warn('DROP old vpn unique skipped:', e.message); }
      }
    }
  } catch(e) { console.warn('vpn_accounts index scan skipped:', e.message); }
  try { await conn.query("ALTER TABLE vpn_accounts ADD UNIQUE KEY uniq_user_account_type (user_id, account_type)"); } catch(e) { if (!String(e.message).includes('Duplicate key name')) console.warn('vpn composite unique skipped:', e.message); }


  const accountSecuritySchema = [
    `CREATE TABLE IF NOT EXISTS email_change_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      old_email VARCHAR(190) NOT NULL,
      new_email VARCHAR(190) NOT NULL,
      old_code VARCHAR(16) NOT NULL,
      new_code VARCHAR(16) NOT NULL,
      status ENUM('pending','confirmed','cancelled','expired') NOT NULL DEFAULT 'pending',
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      confirmed_at DATETIME NULL,
      INDEX idx_email_change_user (user_id),
      INDEX idx_email_change_status (status),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ];
  for (const sql of accountSecuritySchema) { try { await conn.query(sql); } catch(e) { console.warn('ACCOUNT SECURITY MIGRATION skipped:', e.message); } }



  const trialSchema = [
    `CREATE TABLE IF NOT EXISTS email_verification_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      email VARCHAR(190) NOT NULL,
      code VARCHAR(16) NOT NULL,
      status ENUM('pending','used','expired') NOT NULL DEFAULT 'pending',
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      used_at DATETIME NULL,
      INDEX idx_email_verify_user (user_id),
      INDEX idx_email_verify_code (code),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS user_trial_claims (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      plan_id INT NULL,
      claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified TINYINT NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at DATETIME NULL`,
    `ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_trial TINYINT NOT NULL DEFAULT 0`
  ];
  for (const sql of trialSchema) { try { await conn.query(sql); } catch(e) { console.warn('TRIAL/EMAIL VERIFY MIGRATION skipped:', e.message); } }

  await conn.end();
  console.log('Migrations applied');
}
main().catch(e => { console.error(e); process.exit(1); });
