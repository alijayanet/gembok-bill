const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/billing.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 Checking for triggers and constraints...');

// Check for triggers
db.all("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'", (err, triggers) => {
    if (err) {
        console.error('❌ Error checking triggers:', err.message);
    } else {
        console.log('📋 Triggers found:');
        if (triggers.length === 0) {
            console.log('   - No triggers found');
        } else {
            triggers.forEach(trigger => {
                console.log(`   - ${trigger.name}`);
                console.log(`     SQL: ${trigger.sql}`);
            });
        }
    }
});

// Check table info
db.all("PRAGMA table_info(collector_payments)", (err, columns) => {
    if (err) {
        console.error('❌ Error checking table info:', err.message);
    } else {
        console.log('\n📋 collector_payments columns:');
        columns.forEach(col => {
            console.log(`   - ${col.name}: ${col.type}`);
        });
    }
});

// Check foreign keys
db.all("PRAGMA foreign_key_list(collector_payments)", (err, fks) => {
    if (err) {
        console.error('❌ Error checking foreign keys:', err.message);
    } else {
        console.log('\n📋 Foreign keys:');
        if (fks.length === 0) {
            console.log('   - No foreign keys found');
        } else {
            fks.forEach(fk => {
                console.log(`   - ${fk.from} -> ${fk.table}.${fk.to}`);
            });
        }
    }
    
    db.close();
    console.log('\n✅ Check completed!');
});
