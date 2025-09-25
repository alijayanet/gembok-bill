const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

console.log('🔧 Starting Remittance Migration...\n');

// Path ke database
const dbPath = path.join(__dirname, '../data/billing.db');

// Pastikan direktori data ada
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('📁 Created data directory');
}

// Koneksi ke database
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error connecting to database:', err);
        process.exit(1);
    } else {
        console.log('✅ Connected to billing database');
    }
});

// Migration SQL untuk remittance columns
const migrationSQL = `
-- Migration: Add remittance columns to payments table
-- Date: 2025-01-27
-- Description: Add remittance tracking columns to payments table for collector remittance system

-- Add remittance columns to payments table
ALTER TABLE payments ADD COLUMN remittance_status TEXT CHECK(remittance_status IN ('pending', 'remitted', 'cancelled'));
ALTER TABLE payments ADD COLUMN remittance_date DATETIME;
ALTER TABLE payments ADD COLUMN remittance_notes TEXT;

-- Create index for remittance queries
CREATE INDEX IF NOT EXISTS idx_payments_remittance_status ON payments(remittance_status);
CREATE INDEX IF NOT EXISTS idx_payments_remittance_date ON payments(remittance_date);

-- Update existing collector payments to have remittance_status = 'pending'
UPDATE payments 
SET remittance_status = 'pending' 
WHERE payment_type = 'collector' AND remittance_status IS NULL;
`;

// Jalankan migration
db.exec(migrationSQL, (err) => {
    if (err) {
        console.error('❌ Migration failed:', err.message);
        
        // Check if columns already exist
        if (err.message.includes('duplicate column name')) {
            console.log('ℹ️  Columns already exist, skipping...');
        } else {
            console.error('❌ Migration error:', err);
            process.exit(1);
        }
    } else {
        console.log('✅ Migration applied successfully');
    }
    
    // Verify migration
    db.all("PRAGMA table_info(payments)", (err, columns) => {
        if (err) {
            console.error('❌ Error checking table structure:', err);
        } else {
            console.log('\n📋 Payments table structure:');
            columns.forEach(col => {
                if (col.name.includes('remittance') || col.name.includes('payment_type') || col.name.includes('collector')) {
                    console.log(`   - ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''}`);
                }
            });
        }
        
        // Check collector payments count
        db.get(`
            SELECT 
                COUNT(*) as total_payments,
                COUNT(CASE WHEN payment_type = 'collector' THEN 1 END) as collector_payments,
                COUNT(CASE WHEN payment_type = 'collector' AND remittance_status = 'pending' THEN 1 END) as pending_remittances
            FROM payments
        `, (err, row) => {
            if (err) {
                console.error('❌ Error checking payments count:', err);
            } else {
                console.log('\n📊 Payments Statistics:');
                console.log(`   - Total Payments: ${row.total_payments}`);
                console.log(`   - Collector Payments: ${row.collector_payments}`);
                console.log(`   - Pending Remittances: ${row.pending_remittances}`);
            }
            
            db.close((err) => {
                if (err) {
                    console.error('❌ Error closing database:', err);
                } else {
                    console.log('\n🎉 Remittance migration completed successfully!');
                    process.exit(0);
                }
            });
        });
    });
});
