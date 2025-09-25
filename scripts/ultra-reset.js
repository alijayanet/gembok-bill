#!/usr/bin/env node

/**
 * Ultra reset - Hapus SEMUA data termasuk default
 * HATI-HATI: Ini akan menghapus SEMUANYA tanpa default!
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function ultraReset() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🚨 ULTRA RESET - DELETING EVERYTHING INCLUDING DEFAULTS!');
        console.log('⚠️  This will delete ALL data including default package and collector');
        
        // Get all table names
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
        
        console.log(`\n🗑️  Deleting ALL data from ${tables.length} tables...`);
        
        // Delete all data
        for (const table of tables) {
            try {
                await new Promise((resolve, reject) => {
                    db.run(`DELETE FROM ${table}`, (err) => {
                        if (err) {
                            console.error(`   ❌ Error deleting ${table}:`, err.message);
                            reject(err);
                        } else {
                            console.log(`   ✅ ${table}: ALL data deleted`);
                            resolve();
                        }
                    });
                });
            } catch (error) {
                console.log(`   ⚠️  ${table}: ${error.message}`);
            }
        }
        
        // Reset sequences
        await new Promise((resolve) => {
            db.run(`DELETE FROM sqlite_sequence`, (err) => {
                if (err) {
                    console.log('   ⚠️  Could not reset sequences');
                } else {
                    console.log('   ✅ All sequences reset');
                }
                resolve();
            });
        });
        
        // Vacuum
        await new Promise((resolve) => {
            db.run(`VACUUM`, (err) => {
                if (err) {
                    console.log('   ⚠️  Could not vacuum');
                } else {
                    console.log('   ✅ Database vacuumed');
                }
                resolve();
            });
        });
        
        // Final check
        console.log('\n📊 Final verification:');
        for (const table of tables) {
            try {
                const count = await new Promise((resolve) => {
                    db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
                        resolve(row ? row.count : 0);
                    });
                });
                console.log(`   - ${table}: ${count} records`);
            } catch (error) {
                console.log(`   - ${table}: 0 records`);
            }
        }
        
        console.log('\n🎉 ULTRA RESET COMPLETED!');
        console.log('   - ALL data deleted (including defaults)');
        console.log('   - Database is completely empty');
        console.log('   - No default package or collector');
        console.log('\n⚠️  You will need to create packages and collectors manually');
        
    } catch (error) {
        console.error('❌ Error during ultra reset:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    ultraReset()
        .then(() => {
            console.log('✅ Ultra reset completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Ultra reset failed:', error);
            process.exit(1);
        });
}

module.exports = ultraReset;
