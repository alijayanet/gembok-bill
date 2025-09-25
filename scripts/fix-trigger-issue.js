const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/billing.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Fixing trigger issue...');

// Drop the problematic trigger
db.run(`
    DROP TRIGGER IF EXISTS update_collector_payments_updated_at
`, function(err) {
    if (err) {
        console.error('❌ Error dropping trigger:', err.message);
    } else {
        console.log('✅ Dropped problematic trigger');
    }
    
    // Now try the update
    console.log('Trying to update remittance status...');
    
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
            SELECT id, remittance_status, notes
            FROM collector_payments 
            WHERE collector_id = 1
        `, (err, row) => {
            if (err) {
                console.error('❌ Error checking:', err.message);
            } else {
                console.log(`📊 Result: ID=${row.id}, Status=${row.remittance_status}, Notes=${row.notes}`);
            }
            
            db.close();
            console.log('✅ Fix completed!');
        });
    });
});
