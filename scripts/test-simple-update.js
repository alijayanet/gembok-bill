const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/billing.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Testing simple update...');

// Test with very simple update
db.run(`
    UPDATE collector_payments 
    SET remittance_status = 'received'
    WHERE id = 1
`, function(err) {
    if (err) {
        console.error('❌ Error:', err.message);
        console.error('❌ Full error:', err);
    } else {
        console.log(`✅ Updated ${this.changes} records`);
    }
    
    // Check result
    db.get(`
        SELECT id, remittance_status, notes
        FROM collector_payments 
        WHERE id = 1
    `, (err, row) => {
        if (err) {
            console.error('❌ Error checking:', err.message);
        } else {
            console.log(`📊 ID: ${row.id}, Status: ${row.remittance_status}, Notes: ${row.notes}`);
        }
        
        db.close();
        console.log('✅ Test completed!');
    });
});
