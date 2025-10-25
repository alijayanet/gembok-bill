const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Path to the billing database
const dbPath = path.join(__dirname, '../data/billing.db');
const migrationsPath = path.join(__dirname, '../migrations');

// Create database connection
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('✅ Connected to billing database');
    
    // Get all migration files and sort them alphabetically
    const migrationFiles = fs.readdirSync(migrationsPath)
        .filter(file => file.endsWith('.sql'))
        .sort();
    
    console.log(`🔍 Found ${migrationFiles.length} migration files`);
    
    // Run each migration
    let completed = 0;
    migrationFiles.forEach(file => {
        const migrationPath = path.join(migrationsPath, file);
        try {
            const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
            db.exec(migrationSQL, (err) => {
                if (err) {
                    console.error(`❌ Error running migration ${file}:`, err.message);
                } else {
                    console.log(`✅ Successfully ran migration ${file}`);
                }
                
                completed++;
                if (completed === migrationFiles.length) {
                    console.log('\n🎉 All migrations completed!');
                    db.close((err) => {
                        if (err) {
                            console.error('❌ Error closing database:', err.message);
                        } else {
                            console.log('🔒 Database connection closed');
                        }
                        process.exit(0);
                    });
                }
            });
        } catch (error) {
            console.error(`❌ Error reading migration ${file}:`, error.message);
            completed++;
            if (completed === migrationFiles.length) {
                db.close((err) => {
                    if (err) {
                        console.error('❌ Error closing database:', err.message);
                    } else {
                        console.log('🔒 Database connection closed');
                    }
                    process.exit(1);
                });
            }
        }
    });
});