-- Migration: Add Telegram Sessions Table
-- Date: 2026-01-25
-- Description: Create telegram_sessions table for Telegram bot authentication

CREATE TABLE IF NOT EXISTS telegram_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id INTEGER UNIQUE NOT NULL,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_user_id ON telegram_sessions(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_expires_at ON telegram_sessions(expires_at);

-- Add comment to track migration
INSERT OR IGNORE INTO app_settings (key, value, created_at) 
VALUES ('telegram_sessions_table_created', 'true', CURRENT_TIMESTAMP);
