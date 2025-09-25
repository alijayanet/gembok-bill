const sqlite3 = require('sqlite3').verbose();
const path = require('path');

function checkTableStructure() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    console.log('🔍 Checking table structures...\n');
    
    const tables = ['packages', 'collectors', 'customers', 'invoices', 'payments'];
    
    tables.forEach(table => {
        console.log(`📋 Table: ${table}`);
        db.all(`PRAGMA table_info(${table})`, (err, rows) => {
            if (err) {
                console.log(`   ❌ Error: ${err.message}`);
            } else if (rows && rows.length > 0) {
                console.log('   Columns:');
                rows.forEach(row => {
                    console.log(`     - ${row.name} (${row.type})`);
                });
            } else {
                console.log('   ⚠️  Table not found or empty');
            }
            console.log('');
        });
    });
    
    setTimeout(() => {
        db.close();
    }, 2000);
}

checkTableStructure();