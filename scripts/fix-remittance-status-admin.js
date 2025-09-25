const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function fixRemittanceStatusAdmin() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔧 Fixing remittance status for admin payments...');
        console.log('📋 Problem: Admin payments show remittance "pending" when they should be "received"');
        
        // Check current collector payments with remittance status
        console.log('\n📊 Current collector payments:');
        
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
                const remittanceStatus = payment.remittance_status || 'pending';
                const isAdminPayment = payment.notes?.includes('Admin payment') || payment.collector_name?.includes('Admin');
                console.log(`   - ID ${payment.id}: ${payment.collector_name}`);
                console.log(`     Amount: Rp ${payment.payment_amount?.toLocaleString()}`);
                console.log(`     Status: ${payment.status}`);
                console.log(`     Remittance: ${remittanceStatus}`);
                console.log(`     Admin Payment: ${isAdminPayment ? 'YES' : 'NO'}`);
                console.log(`     Notes: ${payment.notes || 'N/A'}`);
                console.log('');
            });
        } else {
            console.log('✅ No collector payments found');
        }
        
        // Find admin payments with pending remittance
        console.log('\n🔍 Finding admin payments with pending remittance...');
        
        const adminPaymentsPending = collectorPayments.filter(payment => {
            const isAdminPayment = payment.notes?.includes('Admin payment') || payment.collector_name?.includes('Admin');
            const isPendingRemittance = !payment.remittance_status || payment.remittance_status === 'pending';
            return isAdminPayment && isPendingRemittance;
        });
        
        if (adminPaymentsPending.length > 0) {
            console.log(`❌ Found ${adminPaymentsPending.length} admin payments with pending remittance:`);
            
            for (const payment of adminPaymentsPending) {
                console.log(`   - Processing payment ID ${payment.id}:`);
                console.log(`     Amount: Rp ${payment.payment_amount?.toLocaleString()}`);
                console.log(`     Collector: ${payment.collector_name}`);
                console.log(`     Current Remittance: ${payment.remittance_status || 'pending'}`);
                
                // Update remittance status to 'received' for admin payments
                try {
                    await new Promise((resolve, reject) => {
                        db.run(`
                            UPDATE collector_payments 
                            SET remittance_status = 'received',
                                remittance_id = 0
                            WHERE id = ?
                        `, [payment.id], function(err) {
                            if (err) {
                                console.error(`     ❌ Failed to update remittance status: ${err.message}`);
                                reject(err);
                            } else {
                                console.log(`     ✅ Updated remittance status to 'received'`);
                                resolve();
                            }
                        });
                    });
                } catch (error) {
                    console.log(`     ⚠️  Could not update remittance status: ${error.message}`);
                }
            }
        } else {
            console.log('✅ No admin payments with pending remittance found');
        }
        
        // Check if we need to create a collector_remittance record
        console.log('\n🔍 Checking if collector_remittance record exists...');
        
        const remittanceRecords = await new Promise((resolve, reject) => {
            db.all(`
                SELECT * FROM collector_remittances 
                WHERE collector_id = 1 AND notes LIKE '%Admin%'
                ORDER BY received_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (remittanceRecords.length === 0 && adminPaymentsPending.length > 0) {
            console.log('❌ No collector_remittance record found for admin payments');
            console.log('   Creating collector_remittance record...');
            
            // Calculate total amount for admin payments
            const totalAmount = adminPaymentsPending.reduce((sum, payment) => sum + (payment.payment_amount || 0), 0);
            
            try {
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO collector_remittances (
                            collector_id, amount, payment_method, notes, received_at, received_by
                        ) VALUES (?, ?, ?, ?, ?, ?)
                    `, [
                        1, // Admin collector ID
                        totalAmount,
                        'admin_payment',
                        'Admin payments - auto-synced',
                        new Date().toISOString(),
                        'system'
                    ], function(err) {
                        if (err) {
                            console.error(`     ❌ Failed to create remittance record: ${err.message}`);
                            reject(err);
                        } else {
                            console.log(`     ✅ Created remittance record (ID: ${this.lastID})`);
                            console.log(`     Amount: Rp ${totalAmount.toLocaleString()}`);
                            resolve();
                        }
                    });
                });
            } catch (error) {
                console.log(`     ⚠️  Could not create remittance record: ${error.message}`);
            }
        } else {
            console.log('✅ Collector remittance records exist for admin payments');
        }
        
        // Final verification
        console.log('\n📊 Final verification:');
        
        const finalStatus = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    cp.id,
                    cp.remittance_status,
                    cp.notes,
                    c.name as collector_name
                FROM collector_payments cp
                LEFT JOIN collectors c ON cp.collector_id = c.id
                WHERE cp.notes LIKE '%Admin payment%' OR c.name LIKE '%Admin%'
                ORDER BY cp.id DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        finalStatus.forEach(payment => {
            console.log(`   - ${payment.collector_name}: Remittance = ${payment.remittance_status || 'pending'}`);
        });
        
        console.log('\n🎉 Remittance status fix completed!');
        console.log('   - Admin payments now have remittance_status = "received"');
        console.log('   - Collector remittance records created if needed');
        console.log('   - Admin payments should no longer show "pending" remittance');
        
    } catch (error) {
        console.error('❌ Error fixing remittance status:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    fixRemittanceStatusAdmin()
        .then(() => {
            console.log('✅ Remittance status fix completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Remittance status fix failed:', error);
            process.exit(1);
        });
}

module.exports = fixRemittanceStatusAdmin;
