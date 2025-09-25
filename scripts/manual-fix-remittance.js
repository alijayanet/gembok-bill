const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function manualFixRemittance() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔧 Manual fix for remittance status...');
        
        // Update admin payment remittance status
        console.log('Updating admin payment remittance status...');
        
        const result = await new Promise((resolve, reject) => {
            db.run(`
                UPDATE collector_payments 
                SET remittance_status = 'received',
                    remittance_id = 0
                WHERE notes LIKE '%Admin payment%' OR collector_id = 1
            `, function(err) {
                if (err) {
                    console.error('❌ Error updating remittance status:', err.message);
                    reject(err);
                } else {
                    console.log(`✅ Updated ${this.changes} admin payment records`);
                    resolve(this.changes);
                }
            });
        });
        
        // Verify the update
        console.log('\nVerifying update...');
        
        const verification = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    cp.id,
                    cp.remittance_status,
                    cp.notes,
                    c.name as collector_name
                FROM collector_payments cp
                LEFT JOIN collectors c ON cp.collector_id = c.id
                ORDER BY cp.id DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        verification.forEach(payment => {
            console.log(`   - ${payment.collector_name}: Remittance = ${payment.remittance_status || 'pending'}`);
        });
        
        console.log('\n✅ Manual remittance fix completed!');
        
    } catch (error) {
        console.error('❌ Error in manual fix:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    manualFixRemittance();
}

module.exports = manualFixRemittance;
