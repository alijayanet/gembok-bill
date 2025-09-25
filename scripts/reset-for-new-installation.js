#!/usr/bin/env node

/**
 * Script untuk reset semua data ke 0 untuk instalasi server baru
 * HATI-HATI: Script ini akan menghapus SEMUA data!
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function resetForNewInstallation() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🚨 WARNING: This will DELETE ALL DATA!');
        console.log('=' .repeat(60));
        console.log('⚠️  This script will reset the database for new server installation');
        console.log('⚠️  ALL CUSTOMERS, INVOICES, PAYMENTS, AND SETTINGS will be DELETED!');
        console.log('=' .repeat(60));
        
        // Confirmation prompt
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const answer = await new Promise((resolve) => {
            rl.question('Type "RESET" to confirm (case sensitive): ', (input) => {
                rl.close();
                resolve(input);
            });
        });
        
        if (answer !== 'RESET') {
            console.log('❌ Reset cancelled. No data was modified.');
            process.exit(0);
        }
        
        console.log('\n🔄 Starting database reset...');
        
        // Step 1: Get current data counts for backup info
        console.log('📊 Current data counts:');
        const counts = {};
        
        const tables = ['customers', 'invoices', 'payments', 'collector_payments', 'collectors', 'packages'];
        
        for (const table of tables) {
            try {
                const count = await new Promise((resolve, reject) => {
                    db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
                        if (err) {
                            if (err.message.includes('no such table')) {
                                resolve(0);
                            } else {
                                reject(err);
                            }
                        } else {
                            resolve(row ? row.count : 0);
                        }
                    });
                });
                counts[table] = count;
                console.log(`   - ${table}: ${count} records`);
            } catch (error) {
                console.log(`   - ${table}: table not found`);
                counts[table] = 0;
            }
        }
        
        // Step 2: Create backup info
        const backupInfo = {
            timestamp: new Date().toISOString(),
            total_customers: counts.customers,
            total_invoices: counts.invoices,
            total_payments: counts.payments,
            total_collector_payments: counts.collector_payments,
            total_collectors: counts.collectors,
            total_packages: counts.packages
        };
        
        console.log('\n💾 Creating backup information...');
        console.log(`   Backup timestamp: ${backupInfo.timestamp}`);
        console.log(`   Total data that will be deleted: ${Object.values(counts).reduce((a, b) => a + b, 0)} records`);
        
        // Step 3: Delete all data in correct order (respecting foreign keys)
        console.log('\n🗑️  Deleting all data...');
        
        const deleteOrder = [
            'collector_payments',
            'payments', 
            'invoices',
            'customers',
            'collectors',
            'packages'
        ];
        
        for (const table of deleteOrder) {
            try {
                await new Promise((resolve, reject) => {
                    db.run(`DELETE FROM ${table}`, (err) => {
                        if (err) {
                            if (err.message.includes('no such table')) {
                                console.log(`   ✅ ${table}: table not found (skipped)`);
                                resolve();
                            } else {
                                console.error(`   ❌ Error deleting ${table}:`, err.message);
                                reject(err);
                            }
                        } else {
                            console.log(`   ✅ ${table}: all records deleted`);
                            resolve();
                        }
                    });
                });
            } catch (error) {
                console.log(`   ⚠️  ${table}: ${error.message}`);
            }
        }
        
        // Step 4: Reset auto-increment counters
        console.log('\n🔄 Resetting auto-increment counters...');
        const resetTables = ['customers', 'invoices', 'payments', 'collector_payments', 'collectors', 'packages'];
        
        for (const table of resetTables) {
            try {
                await new Promise((resolve, reject) => {
                    db.run(`DELETE FROM sqlite_sequence WHERE name='${table}'`, (err) => {
                        if (err) {
                            console.log(`   ⚠️  ${table}: could not reset sequence`);
                            resolve();
                        } else {
                            console.log(`   ✅ ${table}: auto-increment reset to 1`);
                            resolve();
                        }
                    });
                });
            } catch (error) {
                console.log(`   ⚠️  ${table}: sequence reset failed`);
            }
        }
        
        // Step 5: Insert default package
        console.log('\n📦 Creating default package...');
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO packages (name, speed, price, tax_rate, description, is_active, pppoe_profile) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                'Paket Internet Dasar',
                '10 Mbps',
                100000,
                11,
                'Paket internet dasar 10 Mbps',
                1, // is_active = true
                'default'
            ], function(err) {
                if (err) {
                    console.error('❌ Failed to create default package:', err.message);
                    reject(err);
                } else {
                    console.log('✅ Default package created (ID: ' + this.lastID + ')');
                    resolve();
                }
            });
        });
        
        // Step 6: Insert default collector (optional)
        console.log('\n👤 Creating default collector...');
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO collectors (name, phone, email, status, commission_rate) 
                VALUES (?, ?, ?, ?, ?)
            `, [
                'Tukang Tagih Default',
                '081234567890',
                'collector@example.com',
                'active',
                5.00
            ], function(err) {
                if (err) {
                    console.error('❌ Failed to create default collector:', err.message);
                    reject(err);
                } else {
                    console.log('✅ Default collector created (ID: ' + this.lastID + ')');
                    resolve();
                }
            });
        });
        
        // Step 7: Clean system settings (keep essential ones)
        console.log('\n⚙️  Resetting system settings...');
        await new Promise((resolve, reject) => {
            db.run(`
                DELETE FROM system_settings 
                WHERE key NOT IN ('app_name', 'app_version', 'database_version', 'installation_date')
            `, (err) => {
                if (err) {
                    console.log('   ⚠️  Could not clean system settings');
                    resolve();
                } else {
                    console.log('✅ System settings cleaned');
                    resolve();
                }
            });
        });
        
        // Step 8: Set installation date
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT OR REPLACE INTO system_settings (key, value, description) 
                VALUES ('installation_date', ?, 'Installation date')
            `, [new Date().toISOString()], (err) => {
                if (err) {
                    console.log('   ⚠️  Could not set installation date');
                    resolve();
                } else {
                    console.log('✅ Installation date set');
                    resolve();
                }
            });
        });
        
        // Step 9: Final verification
        console.log('\n📊 Final verification:');
        const finalCounts = {};
        
        for (const table of tables) {
            try {
                const count = await new Promise((resolve, reject) => {
                    db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
                        if (err) {
                            resolve(0);
                        } else {
                            resolve(row ? row.count : 0);
                        }
                    });
                });
                finalCounts[table] = count;
                console.log(`   - ${table}: ${count} records`);
            } catch (error) {
                finalCounts[table] = 0;
                console.log(`   - ${table}: 0 records`);
            }
        }
        
        // Step 10: Create reset summary
        console.log('\n🎉 Database reset completed successfully!');
        console.log('=' .repeat(60));
        console.log('📋 RESET SUMMARY:');
        console.log(`   Reset Date: ${new Date().toISOString()}`);
        console.log(`   Data Deleted: ${Object.values(counts).reduce((a, b) => a + b, 0)} records`);
        console.log(`   Current Data: ${Object.values(finalCounts).reduce((a, b) => a + b, 0)} records`);
        console.log('');
        console.log('✅ Default data created:');
        console.log('   - 1 default package (Paket Internet Dasar)');
        console.log('   - 1 default collector (Tukang Tagih Default)');
        console.log('');
        console.log('🚀 Database is now ready for new server installation!');
        console.log('=' .repeat(60));
        
    } catch (error) {
        console.error('❌ Error during reset:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    resetForNewInstallation()
        .then(() => {
            console.log('✅ Reset script completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Reset script failed:', error);
            process.exit(1);
        });
}

module.exports = resetForNewInstallation;
