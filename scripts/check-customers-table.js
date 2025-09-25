const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function checkCustomersTable() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Checking customers table structure...\n');
        
        // Get table schema
        const columns = await new Promise((resolve, reject) => {
            db.all("PRAGMA table_info(customers)", (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        console.log('📋 Customers table columns:');
        columns.forEach(col => {
            console.log(`   - ${col.name} (${col.type}) ${col.notnull ? 'NOT NULL' : ''} ${col.pk ? 'PRIMARY KEY' : ''}`);
        });
        
        // Get sample data
        console.log('\n📊 Sample customers data:');
        const sampleCustomers = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM customers LIMIT 3", (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        if (sampleCustomers.length > 0) {
            console.log('   Sample customer:');
            console.log(JSON.stringify(sampleCustomers[0], null, 2));
        } else {
            console.log('   No customers found');
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        db.close();
    }
}

checkCustomersTable();
