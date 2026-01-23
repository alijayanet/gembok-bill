const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/billing.db');
const db = new sqlite3.Database(dbPath);

console.log('Adding password column to collectors table...');

db.run('ALTER TABLE collectors ADD COLUMN password TEXT', (err) => {
    if (err) {
        if (err.message.includes('duplicate column name')) {
            console.log('✅ Password column already exists in collectors table');
        } else {
            console.error('❌ Error adding password column:', err.message);
        }
    } else {
        console.log('✅ Password column added successfully to collectors table');
    }
    
    db.close(() => {
        console.log('Database connection closed');
        process.exit(0);
    });
});
