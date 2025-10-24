-- Migration: Add image column to packages table
-- Date: 2025-10-24
-- Description: Add image column for storing package image filenames

ALTER TABLE packages ADD COLUMN image_filename TEXT NULL;

-- Create index for image_filename for faster queries
CREATE INDEX IF NOT EXISTS idx_packages_image_filename ON packages(image_filename);