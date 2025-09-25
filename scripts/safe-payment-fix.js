const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function safePaymentFix() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔧 Starting safe payment duplication fix...');
        
        // Step 1: Check if columns already exist
        console.log('🔍 Checking existing columns...');
        const paymentsInfo = await new Promise((resolve, reject) => {
            db.all('PRAGMA table_info(payments)', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        const existingColumns = paymentsInfo.map(col => col.name);
        console.log('   Existing columns:', existingColumns.join(', '));
        
        // Step 2: Add missing columns only
        const columnsToAdd = [
            { name: 'collector_id', sql: 'ALTER TABLE payments ADD COLUMN collector_id INTEGER;' },
            { name: 'commission_amount', sql: 'ALTER TABLE payments ADD COLUMN commission_amount DECIMAL(15,2) DEFAULT 0;' },
            { name: 'payment_type', sql: "ALTER TABLE payments ADD COLUMN payment_type TEXT DEFAULT 'direct' CHECK(payment_type IN ('direct', 'collector', 'online', 'manual'));" }
        ];
        
        for (const column of columnsToAdd) {
            if (!existingColumns.includes(column.name)) {
                console.log(`📝 Adding column: ${column.name}`);
                await new Promise((resolve, reject) => {
                    db.run(column.sql, (err) => {
                        if (err) {
                            console.error(`❌ Failed to add column ${column.name}:`, err.message);
                            reject(err);
                        } else {
                            console.log(`✅ Column ${column.name} added successfully`);
                            resolve();
                        }
                    });
                });
            } else {
                console.log(`✅ Column ${column.name} already exists`);
            }
        }
        
        // Step 3: Create indexes if they don't exist
        console.log('📝 Creating indexes...');
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_payments_collector_id ON payments(collector_id);',
            'CREATE INDEX IF NOT EXISTS idx_payments_payment_type ON payments(payment_type);'
        ];
        
        for (const indexSql of indexes) {
            await new Promise((resolve, reject) => {
                db.run(indexSql, (err) => {
                    if (err) {
                        console.error('❌ Failed to create index:', err.message);
                        reject(err);
                    } else {
                        console.log('✅ Index created successfully');
                        resolve();
                    }
                });
            });
        }
        
        // Step 4: Update existing payments to have payment_type
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
        
        // Step 5: Check for duplicates and overlaps
        console.log('🔍 Checking for duplicates...');
        
        // Check collector_payments vs payments overlap
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
            console.log(`⚠️  Found ${overlaps.length} overlapping payments`);
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
        
        // Step 6: Migrate collector_payments data
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
                        cp.commission_amount || 0,
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
    safePaymentFix()
        .then(() => {
            console.log('✅ Script completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Script failed:', error);
            process.exit(1);
        });
}

module.exports = safePaymentFix;
