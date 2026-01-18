-- Migration: Create installation_jobs system
-- Date: 2026-01-18
-- Description: Create tables for managing installation jobs and their status history

CREATE TABLE IF NOT EXISTS installation_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_number TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_address TEXT NOT NULL,
    package_id INTEGER,
    installation_date DATE,
    installation_time TIME,
    assigned_technician_id INTEGER,
    status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'assigned', 'in_progress', 'completed', 'cancelled')),
    priority TEXT DEFAULT 'normal',
    notes TEXT,
    equipment_needed TEXT,
    estimated_duration INTEGER DEFAULT 120, -- in minutes
    customer_latitude REAL,
    customer_longitude REAL,
    created_by_admin_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_technician_id) REFERENCES technicians(id) ON DELETE SET NULL
);

-- Create indexes for installation_jobs
CREATE INDEX IF NOT EXISTS idx_installation_jobs_status ON installation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_installation_jobs_technician ON installation_jobs(assigned_technician_id);
CREATE INDEX IF NOT EXISTS idx_installation_jobs_date ON installation_jobs(installation_date);
CREATE INDEX IF NOT EXISTS idx_installation_jobs_number ON installation_jobs(job_number);

-- Create table for job status history
CREATE TABLE IF NOT EXISTS installation_job_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_by_type TEXT NOT NULL, -- 'admin', 'technician', 'system'
    changed_by_id TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES installation_jobs(id) ON DELETE CASCADE
);

-- Create index for history
CREATE INDEX IF NOT EXISTS idx_job_history_job_id ON installation_job_status_history(job_id);

-- Create trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_installation_jobs_updated_at 
    AFTER UPDATE ON installation_jobs
    FOR EACH ROW
BEGIN
    UPDATE installation_jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
