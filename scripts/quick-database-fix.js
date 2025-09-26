const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function quickDatabaseFix() {
    console.log('🔧 Quick Database Fix...\n');
    
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        // Set WAL mode
        console.log('📝 Setting WAL mode...');
        await new Promise((resolve, reject) => {
            db.run('PRAGMA journal_mode=WAL', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        // Set timeout
        console.log('⏱️  Setting timeout...');
        await new Promise((resolve, reject) => {
            db.run('PRAGMA busy_timeout=30000', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        // Test database
        console.log('🧪 Testing database...');
        const test = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM customers', (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        console.log(`✅ Database working, customers: ${test.count}`);
        
        db.close();
        console.log('✅ Database fix completed!');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        db.close();
    }
}

quickDatabaseFix();
