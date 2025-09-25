const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function cleanAdminPaymentsFromCollector() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔧 Cleaning admin payments from collector_payments table...');
        console.log('📋 Logic: Admin payments should not appear in "Transaksi Kolektor" page');
        
        // Check current admin payments in collector_payments
        console.log('\n📊 Current collector_payments data:');
        
        const collectorPayments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    cp.id,
                    cp.collector_id,
                    cp.payment_amount,
                    cp.status,
                    cp.remittance_status,
                    cp.notes,
                    cp.collected_at,
                    c.name as collector_name
                FROM collector_payments cp
                LEFT JOIN collectors c ON cp.collector_id = c.id
                ORDER BY cp.collected_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (collectorPayments.length > 0) {
            console.log(`📦 Found ${collectorPayments.length} collector payments:`);
            collectorPayments.forEach(payment => {
                const isAdminPayment = payment.notes?.includes('Admin payment') || payment.collector_name?.includes('Admin');
                console.log(`   - ID ${payment.id}: ${payment.collector_name}`);
                console.log(`     Amount: Rp ${payment.payment_amount?.toLocaleString()}`);
                console.log(`     Status: ${payment.status}`);
                console.log(`     Remittance: ${payment.remittance_status || 'pending'}`);
                console.log(`     Admin Payment: ${isAdminPayment ? 'YES ❌' : 'NO ✅'}`);
                console.log(`     Notes: ${payment.notes || 'N/A'}`);
                console.log('');
            });
        } else {
            console.log('✅ No collector payments found');
        }
        
        // Find admin payments to remove
        console.log('\n🔍 Finding admin payments to remove...');
        
        const adminPaymentsToRemove = collectorPayments.filter(payment => {
            const isAdminPayment = payment.notes?.includes('Admin payment') || payment.collector_name?.includes('Admin');
            return isAdminPayment;
        });
        
        if (adminPaymentsToRemove.length > 0) {
            console.log(`❌ Found ${adminPaymentsToRemove.length} admin payments in collector_payments:`);
            
            for (const payment of adminPaymentsToRemove) {
                console.log(`   - Removing payment ID ${payment.id}:`);
                console.log(`     Amount: Rp ${payment.payment_amount?.toLocaleString()}`);
                console.log(`     Collector: ${payment.collector_name}`);
                console.log(`     Notes: ${payment.notes}`);
                
                // Remove admin payment from collector_payments
                try {
                    await new Promise((resolve, reject) => {
                        db.run(`
                            DELETE FROM collector_payments 
                            WHERE id = ?
                        `, [payment.id], function(err) {
                            if (err) {
                                console.error(`     ❌ Failed to remove payment: ${err.message}`);
                                reject(err);
                            } else {
                                console.log(`     ✅ Removed admin payment from collector_payments`);
                                resolve();
                            }
                        });
                    });
                } catch (error) {
                    console.log(`     ⚠️  Could not remove payment: ${error.message}`);
                }
            }
        } else {
            console.log('✅ No admin payments found in collector_payments');
        }
        
        // Check if we need to remove admin collector
        console.log('\n🔍 Checking admin collector...');
        
        const adminCollector = await new Promise((resolve, reject) => {
            db.get(`
                SELECT c.*, COUNT(cp.id) as payment_count
                FROM collectors c
                LEFT JOIN collector_payments cp ON c.id = cp.collector_id
                WHERE c.name LIKE '%Admin%' OR c.email LIKE '%admin%'
                GROUP BY c.id
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (adminCollector && adminCollector.payment_count === 0) {
            console.log(`❌ Found admin collector with no payments: ${adminCollector.name}`);
            console.log('   Removing admin collector...');
            
            try {
                await new Promise((resolve, reject) => {
                    db.run(`
                        DELETE FROM collectors 
                        WHERE id = ?
                    `, [adminCollector.id], function(err) {
                        if (err) {
                            console.error(`     ❌ Failed to remove admin collector: ${err.message}`);
                            reject(err);
                        } else {
                            console.log(`     ✅ Removed admin collector`);
                            resolve();
                        }
                    });
                });
            } catch (error) {
                console.log(`     ⚠️  Could not remove admin collector: ${error.message}`);
            }
        } else if (adminCollector) {
            console.log(`✅ Admin collector exists with ${adminCollector.payment_count} payments`);
        } else {
            console.log('✅ No admin collector found');
        }
        
        // Final verification
        console.log('\n📊 Final verification:');
        
        const finalCollectorPayments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    cp.id,
                    cp.collector_id,
                    cp.payment_amount,
                    cp.status,
                    cp.remittance_status,
                    cp.notes,
                    c.name as collector_name
                FROM collector_payments cp
                LEFT JOIN collectors c ON cp.collector_id = c.id
                ORDER BY cp.collected_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (finalCollectorPayments.length > 0) {
            console.log(`📦 Remaining collector payments (${finalCollectorPayments.length}):`);
            finalCollectorPayments.forEach(payment => {
                console.log(`   - ${payment.collector_name}: Rp ${payment.payment_amount?.toLocaleString()}`);
                console.log(`     Status: ${payment.status}, Remittance: ${payment.remittance_status || 'pending'}`);
            });
        } else {
            console.log('✅ No collector payments remaining (clean slate)');
        }
        
        // Check payments table (should remain unchanged)
        const paymentsTable = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    p.id,
                    p.amount,
                    p.payment_method,
                    p.payment_type,
                    p.payment_date,
                    i.invoice_number
                FROM payments p
                LEFT JOIN invoices i ON p.invoice_id = i.id
                ORDER BY p.payment_date DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        console.log(`\n💳 Payments table (${paymentsTable.length} records):`);
        paymentsTable.forEach(payment => {
            console.log(`   - ${payment.payment_type}: Rp ${payment.amount?.toLocaleString()} (${payment.payment_method})`);
            console.log(`     Invoice: ${payment.invoice_number}, Date: ${payment.payment_date}`);
        });
        
        console.log('\n🎉 Admin payments cleanup completed!');
        console.log('   - Admin payments removed from collector_payments table');
        console.log('   - "Transaksi Kolektor" page now shows only collector transactions');
        console.log('   - Admin payments remain in payments table for admin tracking');
        console.log('\n✅ "Transaksi Kolektor" page is now clean and logical');
        
    } catch (error) {
        console.error('❌ Error cleaning admin payments:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    cleanAdminPaymentsFromCollector()
        .then(() => {
            console.log('✅ Admin payments cleanup completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Admin payments cleanup failed:', error);
            process.exit(1);
        });
}

module.exports = cleanAdminPaymentsFromCollector;
