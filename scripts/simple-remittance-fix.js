const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Simple fix for remittance status
const dbPath = path.join(__dirname, '../data/billing.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Simple remittance status fix...');

// Update admin payment remittance status
db.run(`
    UPDATE collector_payments 
    SET remittance_status = 'received',
        remittance_id = 0
    WHERE notes LIKE '%Admin payment%' OR collector_id = 1
`, function(err) {
    if (err) {
        console.error('❌ Error:', err.message);
    } else {
        console.log(`✅ Updated ${this.changes} records`);
    }
    
    // Verify
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
        if (err) {
            console.error('❌ Error verifying:', err.message);
        } else {
            console.log('\n📊 Verification:');
            rows.forEach(payment => {
                console.log(`   - ${payment.collector_name}: Remittance = ${payment.remittance_status || 'pending'}`);
            });
        }
        
        db.close();
        console.log('\n✅ Fix completed!');
    });
});
