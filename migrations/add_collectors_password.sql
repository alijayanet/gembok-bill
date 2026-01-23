-- Migration: Add password column to collectors table
-- Date: 2025-01-23
-- Description: Add password column for collector authentication

-- Add password column to collectors table
ALTER TABLE collectors ADD COLUMN password TEXT;

-- Update index for better query performance
CREATE INDEX IF NOT EXISTS idx_collectors_password ON collectors(password);
