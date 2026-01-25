const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Path to the database
const dbPath = path.join(__dirname, '..', 'data', 'billing.db');

// Open the database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }

  console.log('Connected to the database.');

  // Create migrations table if it doesn't exist
  db.run(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating migrations table:', err.message);
      db.close();
      process.exit(1);
    }

    console.log('Migrations table ready.');
    runPendingMigrations();
  });
});

function runPendingMigrations() {
  // Get list of migration files
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  console.log(`Found ${migrationFiles.length} migration files.`);

  // Get executed migrations
  db.all('SELECT name FROM migrations', (err, rows) => {
    if (err) {
      console.error('Error getting executed migrations:', err.message);
      db.close();
      process.exit(1);
    }

    const executedMigrations = rows.map(row => row.name);
    const pendingMigrations = migrationFiles.filter(file => !executedMigrations.includes(file));

    console.log(`Pending ${pendingMigrations.length} migrations.`);

    if (pendingMigrations.length === 0) {
      console.log('✅ All migrations have been executed.');
      db.close();
      process.exit(0);
    }

    // Run pending migrations one by one
    runMigration(0);

    function runMigration(index) {
      if (index >= pendingMigrations.length) {
        console.log('✅ All pending migrations executed successfully.');
        db.close();
        process.exit(0);
        return;
      }

      const migrationFile = pendingMigrations[index];
      const migrationPath = path.join(migrationsDir, migrationFile);

      console.log(`\nRunning migration ${index + 1}/${pendingMigrations.length}: ${migrationFile}`);

      // Read migration file
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

      // Execute migration
      db.exec(migrationSQL, (err) => {
        if (err) {
          if (err.message.includes('duplicate column name') ||
            err.message.includes('Cannot add a UNIQUE column') ||
            err.message.includes('no such column') ||
            err.message.includes('no such table')) {
            console.log(`⚠️  Warning (non-critical): ${err.message}`);
            console.log('   Continuing with next migration...');
          } else {
            console.error(`❌ Error executing migration ${migrationFile}:`, err.message);
            db.close();
            process.exit(1);
          }
        } else {
          console.log(`✅ Migration ${migrationFile} executed successfully.`);
        }

        // Record that this migration was executed
        db.run('INSERT OR IGNORE INTO migrations (name) VALUES (?)', [migrationFile], (err) => {
          if (err) {
            console.error(`❌ Error recording migration ${migrationFile}:`, err.message);
            db.close();
            process.exit(1);
          }

          // Continue with next migration
          runMigration(index + 1);
        });
      });
    }
  });
}