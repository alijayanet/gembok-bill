#!/usr/bin/env node

/**
 * Complete reset script - Hapus SEMUA data termasuk cache dan temporary files
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

async function completeReset() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🚨 COMPLETE RESET - DELETING ALL DATA INCLUDING CACHE!');
        console.log('⚠️  This will delete EVERYTHING including temporary files');
        
        // Step 1: Get all table names
        console.log('\n🔍 Getting all table names...');
        const tables = await new Promise((resolve, reject) => {
            db.all(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name NOT LIKE 'sqlite_%'
                ORDER BY name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(row => row.name));
            });
        });
        
        console.log('📋 Tables found:', tables.join(', '));
        
        // Step 2: Delete all data from all tables
        console.log('\n🗑️  Deleting all data from all tables...');
        for (const table of tables) {
            try {
                await new Promise((resolve, reject) => {
                    db.run(`DELETE FROM ${table}`, (err) => {
                        if (err) {
                            console.error(`   ❌ Error deleting ${table}:`, err.message);
                            reject(err);
                        } else {
                            console.log(`   ✅ ${table}: cleared`);
                            resolve();
                        }
                    });
                });
            } catch (error) {
                console.log(`   ⚠️  ${table}: ${error.message}`);
            }
        }
        
        // Step 3: Reset all auto-increment sequences
        console.log('\n🔄 Resetting all auto-increment sequences...');
        await new Promise((resolve) => {
            db.run(`DELETE FROM sqlite_sequence`, (err) => {
                if (err) {
                    console.log('   ⚠️  Could not reset sequences:', err.message);
                } else {
                    console.log('   ✅ All sequences reset');
                }
                resolve();
            });
        });
        
        // Step 4: Vacuum database to reclaim space
        console.log('\n🧹 Vacuuming database...');
        await new Promise((resolve) => {
            db.run(`VACUUM`, (err) => {
                if (err) {
                    console.log('   ⚠️  Could not vacuum database:', err.message);
                } else {
                    console.log('   ✅ Database vacuumed');
                }
                resolve();
            });
        });
        
        // Step 5: Create default data
        console.log('\n📦 Creating default data...');
        
        // Default package
        await new Promise((resolve) => {
            db.run(`
                INSERT INTO packages (name, speed, price, tax_rate, description, is_active) 
                VALUES ('Paket Dasar', 10, 100000, 11, 'Paket internet dasar', 1)
            `, function(err) {
                if (err) {
                    console.log('   ❌ Failed to create default package:', err.message);
                } else {
                    console.log('   ✅ Default package created (ID: ' + this.lastID + ')');
                }
                resolve();
            });
        });
        
        // Default collector
        await new Promise((resolve) => {
            db.run(`
                INSERT INTO collectors (name, phone, email, status, commission_rate) 
                VALUES ('Collector Default', '081234567890', 'collector@example.com', 'active', 5.00)
            `, function(err) {
                if (err) {
                    console.log('   ❌ Failed to create default collector:', err.message);
                } else {
                    console.log('   ✅ Default collector created (ID: ' + this.lastID + ')');
                }
                resolve();
            });
        });
        
        // Step 6: Clear any cache files
        console.log('\n🗑️  Clearing cache files...');
        const cacheFiles = [
            '../data/cache.json',
            '../data/temp.json',
            '../data/session.json',
            '../logs/*.log'
        ];
        
        for (const file of cacheFiles) {
            try {
                const filePath = path.join(__dirname, file);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`   ✅ Deleted: ${file}`);
                }
            } catch (error) {
                console.log(`   ⚠️  Could not delete ${file}: ${error.message}`);
            }
        }
        
        // Step 7: Final verification
        console.log('\n📊 Final verification:');
        for (const table of tables) {
            try {
                const count = await new Promise((resolve, reject) => {
                    db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
                        if (err) resolve(0);
                        else resolve(row ? row.count : 0);
                    });
                });
                console.log(`   - ${table}: ${count} records`);
            } catch (error) {
                console.log(`   - ${table}: 0 records`);
            }
        }
        
        console.log('\n🎉 Complete reset finished!');
        console.log('   - All data deleted');
        console.log('   - All sequences reset');
        console.log('   - Database vacuumed');
        console.log('   - Cache files cleared');
        console.log('   - Default data created');
        console.log('\n🚀 Database is completely clean and ready!');
        
    } catch (error) {
        console.error('❌ Error during complete reset:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    completeReset()
        .then(() => {
            console.log('✅ Complete reset script finished');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Complete reset failed:', error);
            process.exit(1);
        });
}

module.exports = completeReset;
