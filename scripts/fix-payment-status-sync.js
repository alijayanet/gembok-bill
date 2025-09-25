const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function fixPaymentStatusSync() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔧 Fixing payment status synchronization issue...');
        console.log('📋 Problem: Admin payment not syncing with collector reports');
        
        // Step 1: Check for invoices marked as paid but missing payment records
        console.log('\n🔍 Step 1: Checking for missing payment records...');
        
        const missingPayments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    i.id as invoice_id,
                    i.invoice_number,
                    i.amount,
                    i.payment_date,
                    i.payment_method,
                    i.customer_id,
                    c.name as customer_name
                FROM invoices i
                LEFT JOIN customers c ON i.customer_id = c.id
                LEFT JOIN payments p ON i.id = p.invoice_id
                WHERE i.status = 'paid' AND p.id IS NULL
                ORDER BY i.created_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (missingPayments.length > 0) {
            console.log(`❌ Found ${missingPayments.length} invoices marked as paid but missing payment records:`);
            
            for (const invoice of missingPayments) {
                console.log(`   - Invoice ${invoice.invoice_number}: Rp ${invoice.amount?.toLocaleString()}`);
                console.log(`     Customer: ${invoice.customer_name || 'N/A'}`);
                console.log(`     Payment Date: ${invoice.payment_date}`);
                console.log(`     Payment Method: ${invoice.payment_method || 'unknown'}`);
                
                // Create missing payment record
                try {
                    await new Promise((resolve, reject) => {
                        db.run(`
                            INSERT INTO payments (
                                invoice_id, amount, payment_method, reference_number, notes, 
                                payment_date, payment_type
                            ) VALUES (?, ?, ?, ?, ?, ?, 'manual')
                        `, [
                            invoice.invoice_id,
                            invoice.amount,
                            invoice.payment_method || 'manual',
                            '',
                            'Auto-created from admin payment',
                            invoice.payment_date
                        ], function(err) {
                            if (err) {
                                console.error(`     ❌ Failed to create payment record: ${err.message}`);
                                reject(err);
                            } else {
                                console.log(`     ✅ Created payment record (ID: ${this.lastID})`);
                                resolve();
                            }
                        });
                    });
                } catch (error) {
                    console.log(`     ⚠️  Could not create payment record: ${error.message}`);
                }
            }
        } else {
            console.log('✅ No missing payment records found');
        }
        
        // Step 2: Check for collector_payments with wrong status
        console.log('\n🔍 Step 2: Checking collector_payments status...');
        
        const collectorStatusIssues = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    cp.id as collector_payment_id,
                    cp.status as collector_status,
                    cp.payment_amount,
                    cp.invoice_id,
                    i.status as invoice_status,
                    i.payment_date as invoice_payment_date
                FROM collector_payments cp
                LEFT JOIN invoices i ON cp.invoice_id = i.id
                WHERE cp.status != 'completed' AND i.status = 'paid'
                ORDER BY cp.collected_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (collectorStatusIssues.length > 0) {
            console.log(`❌ Found ${collectorStatusIssues.length} collector payments with wrong status:`);
            
            for (const issue of collectorStatusIssues) {
                console.log(`   - Collector Payment ID: ${issue.collector_payment_id}`);
                console.log(`     Current Status: ${issue.collector_status}`);
                console.log(`     Invoice Status: ${issue.invoice_status}`);
                console.log(`     Amount: Rp ${issue.payment_amount?.toLocaleString()}`);
                
                // Update collector payment status
                try {
                    await new Promise((resolve, reject) => {
                        db.run(`
                            UPDATE collector_payments 
                            SET status = 'completed', 
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        `, [issue.collector_payment_id], function(err) {
                            if (err) {
                                console.error(`     ❌ Failed to update status: ${err.message}`);
                                reject(err);
                            } else {
                                console.log(`     ✅ Updated status to 'completed'`);
                                resolve();
                            }
                        });
                    });
                } catch (error) {
                    console.log(`     ⚠️  Could not update status: ${error.message}`);
                }
            }
        } else {
            console.log('✅ No collector payment status issues found');
        }
        
        // Step 3: Create missing collector_payments for admin payments
        console.log('\n🔍 Step 3: Creating missing collector_payments for admin payments...');
        
        const missingCollectorPayments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    p.id as payment_id,
                    p.invoice_id,
                    p.amount,
                    p.payment_method,
                    p.payment_date,
                    i.customer_id,
                    c.name as customer_name
                FROM payments p
                LEFT JOIN invoices i ON p.invoice_id = i.id
                LEFT JOIN customers c ON i.customer_id = c.id
                LEFT JOIN collector_payments cp ON p.invoice_id = cp.invoice_id
                WHERE p.payment_type = 'manual' 
                  AND cp.id IS NULL 
                  AND i.status = 'paid'
                ORDER BY p.payment_date DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (missingCollectorPayments.length > 0) {
            console.log(`❌ Found ${missingCollectorPayments.length} admin payments missing collector_payments records:`);
            
            // Get default collector (or create one if needed)
            let defaultCollector = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM collectors ORDER BY id LIMIT 1', (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (!defaultCollector) {
                console.log('   Creating default collector for admin payments...');
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO collectors (name, phone, email, status, commission_rate) 
                        VALUES ('Admin Default', '0000000000', 'admin@system.com', 'active', 0.00)
                    `, function(err) {
                        if (err) {
                            console.error('     ❌ Failed to create default collector:', err.message);
                            reject(err);
                        } else {
                            console.log('     ✅ Created default collector (ID: ' + this.lastID + ')');
                            defaultCollector = { id: this.lastID };
                            resolve();
                        }
                    });
                });
            }
            
            for (const payment of missingCollectorPayments) {
                console.log(`   - Payment ID: ${payment.payment_id}`);
                console.log(`     Invoice: ${payment.invoice_id}`);
                console.log(`     Customer: ${payment.customer_name || 'N/A'}`);
                console.log(`     Amount: Rp ${payment.amount?.toLocaleString()}`);
                
                // Create collector payment record
                try {
                    await new Promise((resolve, reject) => {
                        db.run(`
                            INSERT INTO collector_payments (
                                collector_id, customer_id, invoice_id, 
                                payment_amount, commission_amount, 
                                payment_method, payment_date, 
                                status, notes
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)
                        `, [
                            defaultCollector.id,
                            payment.customer_id,
                            payment.invoice_id,
                            payment.amount,
                            0, // No commission for admin payments
                            payment.payment_method,
                            payment.payment_date,
                            'Admin payment - auto-synced'
                        ], function(err) {
                            if (err) {
                                console.error(`     ❌ Failed to create collector payment: ${err.message}`);
                                reject(err);
                            } else {
                                console.log(`     ✅ Created collector payment (ID: ${this.lastID})`);
                                resolve();
                            }
                        });
                    });
                } catch (error) {
                    console.log(`     ⚠️  Could not create collector payment: ${error.message}`);
                }
            }
        } else {
            console.log('✅ No missing collector_payments found');
        }
        
        // Step 4: Final verification
        console.log('\n📊 Final verification:');
        
        const finalStats = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    'invoices' as table_name, COUNT(*) as total,
                    SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count
                FROM invoices
                UNION ALL
                SELECT 
                    'payments' as table_name, COUNT(*) as total, 0 as paid_count
                FROM payments
                UNION ALL
                SELECT 
                    'collector_payments' as table_name, COUNT(*) as total,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as paid_count
                FROM collector_payments
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        finalStats.forEach(stat => {
            console.log(`   - ${stat.table_name}: ${stat.total} total, ${stat.paid_count} completed`);
        });
        
        console.log('\n🎉 Payment status synchronization fix completed!');
        console.log('   - Missing payment records created');
        console.log('   - Collector payment statuses updated');
        console.log('   - Admin payments synced with collector reports');
        console.log('\n✅ Admin payments should now show correctly in collector reports');
        
    } catch (error) {
        console.error('❌ Error fixing payment status sync:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    fixPaymentStatusSync()
        .then(() => {
            console.log('✅ Payment status sync fix completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Payment status sync fix failed:', error);
            process.exit(1);
        });
}

module.exports = fixPaymentStatusSync;
