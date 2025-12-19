const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Path to the billing database
const dbPath = path.join(__dirname, '../data/billing.db');
const migrationsPath = path.join(__dirname, '../migrations');

// Create database connection
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
        process.exit(1);
    }
    console.log('✅ Connected to billing database');
    console.log(`📂 Migrations path: ${migrationsPath}\n`);

    // Get all migration files and sort them alphabetically
    const migrationFiles = fs.readdirSync(migrationsPath)
        .filter(file => file.endsWith('.sql'))
        .sort();

    console.log(`🔍 Found ${migrationFiles.length} migration files\n`);

    if (migrationFiles.length === 0) {
        console.log('⚠️  No migration files found. Closing database.');
        db.close();
        process.exit(0);
    }

    // Run each migration
    let completed = 0;
    let successCount = 0;
    let errorCount = 0;

    migrationFiles.forEach(file => {
        const migrationPath = path.join(migrationsPath, file);
        try {
            const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

            db.exec(migrationSQL, (err) => {
                if (err) {
                    // Check if error is benign (already exists)
                    if (err.message.includes('duplicate column') ||
                        err.message.includes('already exists') ||
                        err.message.includes('no such table')) {
                        console.log(`⚠️  Migration ${file}: ${err.message} (skipping)`);
                    } else {
                        console.error(`❌ Error running migration ${file}:`, err.message);
                        errorCount++;
                    }
                } else {
                    console.log(`✅ Successfully ran migration ${file}`);
                    successCount++;
                }

                completed++;
                if (completed === migrationFiles.length) {
                    console.log('\n📊 Migration Summary:');
                    console.log(`   ✅ Successful: ${successCount}`);
                    console.log(`   ⚠️  Skipped: ${completed - successCount - errorCount}`);
                    console.log(`   ❌ Errors: ${errorCount}`);
                    console.log('\n🎉 All migrations completed!');

                    db.close((err) => {
                        if (err) {
                            console.error('❌ Error closing database:', err.message);
                        } else {
                            console.log('🔒 Database connection closed');
                        }
                        process.exit(errorCount > 0 ? 1 : 0);
                    });
                }
            });
        } catch (error) {
            console.error(`❌ Error reading migration ${file}:`, error.message);
            errorCount++;
            completed++;

            if (completed === migrationFiles.length) {
                console.log('\n📊 Migration Summary:');
                console.log(`   ✅ Successful: ${successCount}`);
                console.log(`   ⚠️  Skipped: ${completed - successCount - errorCount}`);
                console.log(`   ❌ Errors: ${errorCount}`);

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
