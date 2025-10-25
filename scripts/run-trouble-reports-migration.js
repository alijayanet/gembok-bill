const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Path to the billing database
const dbPath = path.join(__dirname, '../data/billing.db');
const migrationPath = path.join(__dirname, '../migrations/create_trouble_reports_table.sql');

// Read the migration file
const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

// Create database connection
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('✅ Connected to billing database');
    
    // Run the migration
    db.exec(migrationSQL, (err) => {
        if (err) {
            console.error('❌ Error running migration:', err.message);
            db.close();
            process.exit(1);
        }
        
        console.log('✅ Successfully created trouble_reports table');
        
        // Verify the table was created
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='trouble_reports'", (err, row) => {
            if (err) {
                console.error('❌ Error verifying table creation:', err.message);
            } else if (row) {
                console.log('✅ Verification: trouble_reports table exists');
            } else {
                console.error('❌ Verification failed: trouble_reports table not found');
            }
            
            // Close database connection
            db.close((err) => {
                if (err) {
                    console.error('❌ Error closing database:', err.message);
                } else {
                    console.log('🔒 Database connection closed');
                }
                process.exit(row ? 0 : 1);
            });
        });
    });
});