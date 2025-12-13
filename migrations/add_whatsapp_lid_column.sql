-- Migration: Add WhatsApp LID column to customers table
-- Date: 2025-12-13
-- Description: Add whatsapp_lid column to support WhatsApp Lidded ID authentication

-- Add whatsapp_lid column (nullable for backward compatibility)
ALTER TABLE customers ADD COLUMN whatsapp_lid TEXT UNIQUE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_customers_whatsapp_lid ON customers(whatsapp_lid);

-- Add comment for documentation
-- whatsapp_lid format: e.g., "85280887435270@lid"
-- This column stores the WhatsApp Lidded ID for customers who register via WhatsApp
-- Customers can register their LID using the REG command
