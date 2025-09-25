const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function fixAdminPaymentSync() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔧 Fixing admin payment sync issue...');
        console.log('📋 Problem: Admin payments not syncing with collector reports');
        
        // Check current data
        console.log('\n📊 Current Data Status:');
        
        const stats = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    'invoices' as table_name, 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count
                FROM invoices
                UNION ALL
                SELECT 
                    'payments' as table_name, 
                    COUNT(*) as total, 0 as paid_count
                FROM payments
                UNION ALL
                SELECT 
                    'collector_payments' as table_name, 
                    COUNT(*) as total, 0 as paid_count
                FROM collector_payments
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        stats.forEach(stat => {
            console.log(`   - ${stat.table_name}: ${stat.total} total, ${stat.paid_count} paid`);
        });
        
        // Find admin payments that need collector_payments records
        console.log('\n🔍 Finding admin payments without collector_payments records...');
        
        const adminPayments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    p.*, 
                    i.invoice_number,
                    i.customer_id,
                    i.status as invoice_status,
                    c.name as customer_name,
                    c.phone as customer_phone
                FROM payments p
                JOIN invoices i ON p.invoice_id = i.id
                JOIN customers c ON i.customer_id = c.id
                LEFT JOIN collector_payments cp ON p.invoice_id = cp.invoice_id
                WHERE p.payment_type = 'direct' 
                  AND cp.id IS NULL 
                  AND i.status = 'paid'
                ORDER BY p.payment_date DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (adminPayments.length > 0) {
            console.log(`❌ Found ${adminPayments.length} admin payments without collector_payments records:`);
            
            // Get or create default admin collector
            let adminCollector = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM collectors WHERE name LIKE "%Admin%" OR email LIKE "%admin%" LIMIT 1', (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (!adminCollector) {
                console.log('   Creating default admin collector...');
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO collectors (
                            name, phone, email, status, commission_rate, 
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [
                        'Admin System',
                        '0000000000',
                        'admin@system.com',
                        'active',
                        0.00,
                        new Date().toISOString(),
                        new Date().toISOString()
                    ], function(err) {
                        if (err) {
                            console.error('     ❌ Failed to create admin collector:', err.message);
                            reject(err);
                        } else {
                            console.log('     ✅ Created admin collector (ID: ' + this.lastID + ')');
                            adminCollector = { id: this.lastID };
                            resolve();
                        }
                    });
                });
            } else {
                console.log(`   Using existing admin collector: ${adminCollector.name} (ID: ${adminCollector.id})`);
            }
            
            // Create collector_payments records for admin payments
            for (const payment of adminPayments) {
                console.log(`   - Processing payment for ${payment.customer_name}:`);
                console.log(`     Amount: Rp ${payment.amount?.toLocaleString()}`);
                console.log(`     Invoice: ${payment.invoice_number}`);
                console.log(`     Payment Date: ${payment.payment_date}`);
                
                try {
                    await new Promise((resolve, reject) => {
                        db.run(`
                            INSERT INTO collector_payments (
                                collector_id, customer_id, invoice_id, 
                                amount, payment_amount, commission_amount, 
                                payment_method, reference_number,
                                collected_at, status, notes, created_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [
                            adminCollector.id,
                            payment.customer_id,
                            payment.invoice_id,
                            payment.amount, // amount (required field)
                            payment.amount, // payment_amount
                            0, // No commission for admin payments
                            payment.payment_method,
                            payment.reference_number || '',
                            payment.payment_date,
                            'completed', // Admin payments are always completed
                            'Admin payment - auto-synced',
                            new Date().toISOString()
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
            console.log('✅ No admin payments without collector_payments records found');
        }
        
        // Check for invoices marked as paid but no payment records at all
        console.log('\n🔍 Checking for paid invoices without any payment records...');
        
        const paidInvoicesWithoutPayments = await new Promise((resolve, reject) => {
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
                JOIN customers c ON i.customer_id = c.id
                LEFT JOIN payments p ON i.id = p.invoice_id
                WHERE i.status = 'paid' AND p.id IS NULL
                ORDER BY i.created_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (paidInvoicesWithoutPayments.length > 0) {
            console.log(`❌ Found ${paidInvoicesWithoutPayments.length} paid invoices without payment records:`);
            
            for (const invoice of paidInvoicesWithoutPayments) {
                console.log(`   - Invoice ${invoice.invoice_number} (${invoice.customer_name}):`);
                console.log(`     Amount: Rp ${invoice.amount?.toLocaleString()}`);
                console.log(`     Payment Date: ${invoice.payment_date}`);
                console.log(`     Payment Method: ${invoice.payment_method || 'unknown'}`);
                
                // Create payment record
                try {
                    await new Promise((resolve, reject) => {
                        db.run(`
                            INSERT INTO payments (
                                invoice_id, amount, payment_method, reference_number, notes, 
                                payment_date, payment_type
                            ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        `, [
                            invoice.invoice_id,
                            invoice.amount,
                            invoice.payment_method || 'manual',
                            '',
                            'Auto-created from admin payment',
                            invoice.payment_date,
                            'manual'
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
            console.log('✅ No paid invoices without payment records found');
        }
        
        // Final verification
        console.log('\n📊 Final verification:');
        
        const finalStats = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    'invoices' as table_name, 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count
                FROM invoices
                UNION ALL
                SELECT 
                    'payments' as table_name, 
                    COUNT(*) as total, 0 as paid_count
                FROM payments
                UNION ALL
                SELECT 
                    'collector_payments' as table_name, 
                    COUNT(*) as total,
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
        
        console.log('\n🎉 Admin payment sync fix completed!');
        console.log('   - Admin payments now have collector_payments records');
        console.log('   - Paid invoices have proper payment records');
        console.log('   - Collector reports should now show admin payments');
        console.log('\n✅ Admin payments should now appear in collector reports');
        
    } catch (error) {
        console.error('❌ Error fixing admin payment sync:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    fixAdminPaymentSync()
        .then(() => {
            console.log('✅ Admin payment sync fix completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Admin payment sync fix failed:', error);
            process.exit(1);
        });
}

module.exports = fixAdminPaymentSync;
