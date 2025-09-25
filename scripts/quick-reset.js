#!/usr/bin/env node

/**
 * Quick reset script untuk development/testing
 * HATI-HATI: Script ini akan menghapus SEMUA data tanpa konfirmasi!
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function quickReset() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🚨 QUICK RESET - DELETING ALL DATA!');
        console.log('⚠️  No confirmation required - use with caution!');
        
        // Delete all data
        const tables = ['collector_payments', 'payments', 'invoices', 'customers', 'collectors', 'packages'];
        
        for (const table of tables) {
            try {
                await new Promise((resolve, reject) => {
                    db.run(`DELETE FROM ${table}`, (err) => {
                        if (err && !err.message.includes('no such table')) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
                console.log(`✅ ${table}: cleared`);
            } catch (error) {
                console.log(`⚠️  ${table}: ${error.message}`);
            }
        }
        
        // Reset auto-increment
        await new Promise((resolve) => {
            db.run(`DELETE FROM sqlite_sequence`, (err) => {
                resolve();
            });
        });
        
        // Create default package
        await new Promise((resolve) => {
            db.run(`
                INSERT INTO packages (name, speed, price, tax_rate, description, is_active) 
                VALUES ('Paket Dasar', 10, 100000, 11, 'Paket internet dasar', 1)
            `, function(err) {
                if (!err) {
                    console.log('✅ Default package created');
                } else {
                    console.log('❌ Failed to create default package:', err.message);
                }
                resolve();
            });
        });
        
        // Create default collector
        await new Promise((resolve) => {
            db.run(`
                INSERT INTO collectors (name, phone, email, status, commission_rate) 
                VALUES ('Collector Default', '081234567890', 'collector@test.com', 'active', 5.00)
            `, function(err) {
                if (!err) console.log('✅ Default collector created');
                resolve();
            });
        });
        
        console.log('🎉 Quick reset completed!');
        
    } catch (error) {
        console.error('❌ Quick reset failed:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    quickReset();
}

module.exports = quickReset;
