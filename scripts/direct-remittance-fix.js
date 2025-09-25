const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/billing.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Direct remittance status fix...');

// Simple update without any problematic columns
db.run(`
    UPDATE collector_payments 
    SET remittance_status = 'received'
    WHERE collector_id = 1
`, function(err) {
    if (err) {
        console.error('❌ Error updating:', err.message);
    } else {
        console.log(`✅ Updated ${this.changes} admin payment records`);
    }
    
    // Check result
    db.get(`
        SELECT remittance_status, notes, collector_id
        FROM collector_payments 
        WHERE collector_id = 1
    `, (err, row) => {
        if (err) {
            console.error('❌ Error checking:', err.message);
        } else {
            console.log(`📊 Result: remittance_status = ${row.remittance_status}`);
            console.log(`📊 Notes: ${row.notes}`);
        }
        
        db.close();
        console.log('✅ Fix completed!');
    });
});
