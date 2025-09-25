const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function fixPaymentDuplication() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔧 Starting payment duplication fix...');
        
        // Step 1: Apply migration
        console.log('📝 Applying migration to payments table...');
        await new Promise((resolve, reject) => {
            db.exec(`
                -- Add new columns
                ALTER TABLE payments ADD COLUMN collector_id INTEGER;
                ALTER TABLE payments ADD COLUMN commission_amount DECIMAL(15,2) DEFAULT 0;
                ALTER TABLE payments ADD COLUMN payment_type TEXT DEFAULT 'direct' CHECK(payment_type IN ('direct', 'collector', 'online', 'manual'));
                
                -- Create indexes
                CREATE INDEX IF NOT EXISTS idx_payments_collector_id ON payments(collector_id);
                CREATE INDEX IF NOT EXISTS idx_payments_payment_type ON payments(payment_type);
                
                -- Update existing payments
                UPDATE payments SET payment_type = 'direct' WHERE payment_type IS NULL;
            `, (err) => {
                if (err) {
                    console.error('❌ Migration failed:', err.message);
                    reject(err);
                } else {
                    console.log('✅ Migration applied successfully');
                    resolve();
                }
            });
        });
        
        // Step 2: Check for duplicate payments
        console.log('🔍 Checking for duplicate payments...');
        const duplicates = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    p.invoice_id,
                    p.amount,
                    p.payment_method,
                    p.payment_date,
                    COUNT(*) as count
                FROM payments p
                GROUP BY p.invoice_id, p.amount, p.payment_method, p.payment_date
                HAVING COUNT(*) > 1
                ORDER BY p.payment_date DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (duplicates.length > 0) {
            console.log(`⚠️  Found ${duplicates.length} potential duplicate payment groups`);
            duplicates.forEach(dup => {
                console.log(`   - Invoice ${dup.invoice_id}: ${dup.count} payments of ${dup.amount} on ${dup.payment_date}`);
            });
        } else {
            console.log('✅ No duplicate payments found');
        }
        
        // Step 3: Check collector_payments vs payments overlap
        console.log('🔍 Checking collector_payments vs payments overlap...');
        const overlaps = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    cp.id as collector_payment_id,
                    cp.invoice_id,
                    cp.payment_amount,
                    cp.collected_at,
                    p.id as payment_id,
                    p.amount as payment_amount_2,
                    p.payment_date as payment_date_2
                FROM collector_payments cp
                LEFT JOIN payments p ON cp.invoice_id = p.invoice_id 
                    AND cp.payment_amount = p.amount 
                    AND DATE(cp.collected_at) = DATE(p.payment_date)
                WHERE p.id IS NOT NULL
                ORDER BY cp.collected_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (overlaps.length > 0) {
            console.log(`⚠️  Found ${overlaps.length} overlapping payments between collector_payments and payments`);
            overlaps.forEach(overlap => {
                console.log(`   - Invoice ${overlap.invoice_id}: Collector payment ${overlap.collector_payment_id} overlaps with payment ${overlap.payment_id}`);
            });
            
            // Step 4: Fix overlaps by removing duplicates from payments table
            console.log('🔧 Removing duplicate entries from payments table...');
            for (const overlap of overlaps) {
                await new Promise((resolve, reject) => {
                    db.run(`
                        DELETE FROM payments 
                        WHERE id = ? AND invoice_id = ? AND amount = ? AND DATE(payment_date) = DATE(?)
                    `, [overlap.payment_id, overlap.invoice_id, overlap.payment_amount_2, overlap.collected_at], (err) => {
                        if (err) {
                            console.error(`❌ Failed to remove duplicate payment ${overlap.payment_id}:`, err.message);
                            reject(err);
                        } else {
                            console.log(`✅ Removed duplicate payment ${overlap.payment_id}`);
                            resolve();
                        }
                    });
                });
            }
        } else {
            console.log('✅ No overlapping payments found');
        }
        
        // Step 5: Migrate collector_payments data to payments table
        console.log('📦 Migrating collector_payments to payments table...');
        const collectorPayments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    cp.*,
                    i.customer_id
                FROM collector_payments cp
                LEFT JOIN invoices i ON cp.invoice_id = i.id
                WHERE cp.invoice_id IS NOT NULL
                ORDER BY cp.collected_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        let migrated = 0;
        for (const cp of collectorPayments) {
            // Check if this collector payment already exists in payments table
            const exists = await new Promise((resolve, reject) => {
                db.get(`
                    SELECT id FROM payments 
                    WHERE invoice_id = ? AND amount = ? AND collector_id = ? AND payment_type = 'collector'
                `, [cp.invoice_id, cp.payment_amount, cp.collector_id], (err, row) => {
                    if (err) reject(err);
                    else resolve(!!row);
                });
            });
            
            if (!exists) {
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO payments (
                            invoice_id, amount, payment_method, reference_number, notes, 
                            collector_id, commission_amount, payment_type, payment_date
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'collector', ?)
                    `, [
                        cp.invoice_id,
                        cp.payment_amount,
                        cp.payment_method,
                        cp.reference_number || '',
                        cp.notes || `Collector payment ${cp.collector_id}`,
                        cp.collector_id,
                        cp.commission_amount,
                        cp.collected_at
                    ], function(err) {
                        if (err) {
                            console.error(`❌ Failed to migrate collector payment ${cp.id}:`, err.message);
                            reject(err);
                        } else {
                            migrated++;
                            resolve();
                        }
                    });
                });
            }
        }
        
        console.log(`✅ Migrated ${migrated} collector payments to payments table`);
        
        // Step 6: Update payment types for existing payments
        console.log('🏷️  Updating payment types...');
        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE payments 
                SET payment_type = CASE 
                    WHEN payment_method = 'online' THEN 'online'
                    WHEN collector_id IS NOT NULL THEN 'collector'
                    WHEN payment_method IN ('manual', 'admin') THEN 'manual'
                    ELSE 'direct'
                END
                WHERE payment_type IS NULL OR payment_type = 'direct'
            `, (err) => {
                if (err) {
                    console.error('❌ Failed to update payment types:', err.message);
                    reject(err);
                } else {
                    console.log('✅ Payment types updated');
                    resolve();
                }
            });
        });
        
        // Step 7: Final statistics
        console.log('📊 Final statistics:');
        const stats = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    payment_type,
                    COUNT(*) as count,
                    SUM(amount) as total_amount,
                    SUM(commission_amount) as total_commission
                FROM payments 
                GROUP BY payment_type
                ORDER BY payment_type
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        stats.forEach(stat => {
            console.log(`   - ${stat.payment_type}: ${stat.count} payments, Rp ${stat.total_amount?.toLocaleString()}, Commission: Rp ${stat.total_commission?.toLocaleString()}`);
        });
        
        console.log('🎉 Payment duplication fix completed successfully!');
        
    } catch (error) {
        console.error('❌ Error fixing payment duplication:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    fixPaymentDuplication()
        .then(() => {
            console.log('✅ Script completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Script failed:', error);
            process.exit(1);
        });
}

module.exports = fixPaymentDuplication;
