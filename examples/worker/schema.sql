CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  raw_size INTEGER,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emails_recipient ON emails(recipient);
CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at);
