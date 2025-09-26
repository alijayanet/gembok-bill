#!/usr/bin/env node

/**
 * Reset Invoice Data Script
 * Menghapus semua data invoice dan transaksi tanpa menghapus customer
 * HATI-HATI: Script ini akan menghapus SEMUA invoice, payment, dan transaksi!
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function resetInvoiceData() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🚨 RESET INVOICE DATA - DELETING ALL INVOICES AND TRANSACTIONS!');
        console.log('⚠️  This will delete ALL invoices, payments, and transactions');
        console.log('✅ Customer data will be PRESERVED');
        console.log('=' .repeat(60));
        
        // Step 1: Get current data counts for backup info
        console.log('📊 Current data counts:');
        const counts = {};
        
        const transactionTables = [
            'collector_payments',
            'payments', 
            'payment_gateway_transactions',
            'voucher_purchases',
            'invoices'
        ];
        
        for (const table of transactionTables) {
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
            total_invoices: counts.invoices,
            total_payments: counts.payments,
            total_collector_payments: counts.collector_payments,
            total_payment_gateway_transactions: counts.payment_gateway_transactions,
            total_voucher_purchases: counts.voucher_purchases
        };
        
        console.log('\n💾 Backup information:');
        console.log(`   Reset timestamp: ${backupInfo.timestamp}`);
        console.log(`   Total records to be deleted: ${Object.values(counts).reduce((a, b) => a + b, 0)} records`);
        
        // Step 3: Confirmation prompt
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const answer = await new Promise((resolve) => {
            rl.question('\nType "RESET INVOICES" to confirm (case sensitive): ', (input) => {
                rl.close();
                resolve(input);
            });
        });
        
        if (answer !== 'RESET INVOICES') {
            console.log('❌ Reset cancelled. No data was modified.');
            process.exit(0);
        }
        
        console.log('\n🔄 Starting invoice data reset...');
        
        // Step 4: Delete data in correct order (respecting foreign keys)
        console.log('\n🗑️  Deleting transaction data...');
        
        const deleteOrder = [
            'collector_payments',           // Delete first (references invoices)
            'payments',                     // Delete second (references invoices)
            'payment_gateway_transactions', // Delete third (references invoices)
            'voucher_purchases',           // Delete fourth (independent)
            'invoices'                     // Delete last (main table)
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
        
        // Step 5: Reset auto-increment counters for transaction tables
        console.log('\n🔄 Resetting auto-increment counters...');
        const resetTables = ['invoices', 'payments', 'collector_payments', 'payment_gateway_transactions', 'voucher_purchases'];
        
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
        
        // Step 6: Clean up collector assignments (optional - keep assignments but reset status)
        console.log('\n🧹 Cleaning up collector assignments...');
        try {
            await new Promise((resolve, reject) => {
                db.run(`UPDATE collector_assignments SET status = 'cancelled', notes = 'Reset due to invoice data cleanup'`, (err) => {
                    if (err) {
                        console.log('   ⚠️  Could not clean collector assignments');
                        resolve();
                    } else {
                        console.log('✅ Collector assignments status updated');
                        resolve();
                    }
                });
            });
        } catch (error) {
            console.log('   ⚠️  Collector assignments cleanup failed');
        }
        
        // Step 7: Update system settings for reset tracking
        console.log('\n⚙️  Updating system settings...');
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT OR REPLACE INTO system_settings (key, value, description, updated_at) 
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `, ['invoice_reset_date', new Date().toISOString(), 'Last invoice data reset date'], (err) => {
                if (err) {
                    console.log('   ⚠️  Could not update system settings');
                    resolve();
                } else {
                    console.log('✅ System settings updated');
                    resolve();
                }
            });
        });
        
        // Step 8: Final verification
        console.log('\n📊 Final verification:');
        const finalCounts = {};
        
        for (const table of transactionTables) {
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
        
        // Step 9: Verify customer data is preserved
        console.log('\n👥 Verifying customer data preservation:');
        try {
            const customerCount = await new Promise((resolve, reject) => {
                db.get(`SELECT COUNT(*) as count FROM customers`, (err, row) => {
                    if (err) {
                        resolve(0);
                    } else {
                        resolve(row ? row.count : 0);
                    }
                });
            });
            console.log(`   - customers: ${customerCount} records (PRESERVED)`);
        } catch (error) {
            console.log(`   - customers: 0 records`);
        }
        
        // Step 10: Create reset summary
        console.log('\n🎉 Invoice data reset completed successfully!');
        console.log('=' .repeat(60));
        console.log('📋 RESET SUMMARY:');
        console.log(`   Reset Date: ${new Date().toISOString()}`);
        console.log(`   Data Deleted: ${Object.values(counts).reduce((a, b) => a + b, 0)} records`);
        console.log(`   Current Transaction Data: ${Object.values(finalCounts).reduce((a, b) => a + b, 0)} records`);
        console.log('');
        console.log('✅ Data preserved:');
        console.log('   - Customer data (customers table)');
        console.log('   - Package data (packages table)');
        console.log('   - Collector data (collectors table)');
        console.log('');
        console.log('🗑️  Data deleted:');
        console.log('   - All invoices');
        console.log('   - All payments');
        console.log('   - All collector payments');
        console.log('   - All payment gateway transactions');
        console.log('   - All voucher purchases');
        console.log('');
        console.log('🚀 Database is now clean and ready for new invoices!');
        console.log('=' .repeat(60));
        
    } catch (error) {
        console.error('❌ Error during invoice data reset:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    resetInvoiceData()
        .then(() => {
            console.log('✅ Invoice data reset script completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Invoice data reset script failed:', error);
            process.exit(1);
        });
}

module.exports = resetInvoiceData;
