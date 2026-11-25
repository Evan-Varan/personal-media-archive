CREATE TABLE IF NOT EXISTS mailing_subscribers (
  email TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  confirmed INTEGER NOT NULL DEFAULT 0,
  requested_at TEXT NOT NULL,
  confirmed_at TEXT
);

ALTER TABLE posts ADD COLUMN mailing_announced INTEGER NOT NULL DEFAULT 0;
UPDATE posts SET mailing_announced = 1 WHERE published = 1;
