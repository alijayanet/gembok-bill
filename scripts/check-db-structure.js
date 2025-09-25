const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function checkDatabaseStructure() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Checking database structure...');
        
        // Check collector_payments table structure
        console.log('\n📋 collector_payments table structure:');
        const collectorPaymentsInfo = await new Promise((resolve, reject) => {
            db.all('PRAGMA table_info(collector_payments)', (err, rows) => {
                if (err) {
                    if (err.message.includes('no such table')) {
                        console.log('   ❌ collector_payments table does not exist');
                        resolve([]);
                    } else {
                        reject(err);
                    }
                } else {
                    resolve(rows || []);
                }
            });
        });
        
        collectorPaymentsInfo.forEach(col => {
            console.log(`   - ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.dflt_value ? `DEFAULT ${col.dflt_value}` : ''}`);
        });
        
        // Check payments table structure
        console.log('\n📋 payments table structure:');
        const paymentsInfo = await new Promise((resolve, reject) => {
            db.all('PRAGMA table_info(payments)', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        paymentsInfo.forEach(col => {
            console.log(`   - ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.dflt_value ? `DEFAULT ${col.dflt_value}` : ''}`);
        });
        
        // Check if collector_payments has data
        if (collectorPaymentsInfo.length > 0) {
            const collectorPaymentsCount = await new Promise((resolve, reject) => {
                db.get('SELECT COUNT(*) as count FROM collector_payments', (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.count : 0);
                });
            });
            console.log(`\n📊 collector_payments records: ${collectorPaymentsCount}`);
        }
        
        // Check payments count
        const paymentsCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM payments', (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        console.log(`📊 payments records: ${paymentsCount}`);
        
    } catch (error) {
        console.error('❌ Error checking database structure:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    checkDatabaseStructure()
        .then(() => {
            console.log('\n✅ Database structure check completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Database structure check failed:', error);
            process.exit(1);
        });
}

module.exports = checkDatabaseStructure;
