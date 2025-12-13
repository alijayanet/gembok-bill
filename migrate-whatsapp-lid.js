// Database Migration Script - Add WhatsApp LID Column
// Run this script to update existing database with whatsapp_lid support

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'billing.db');
const db = new sqlite3.Database(dbPath);

console.log('🔄 Starting database migration...\n');

db.serialize(() => {
    // Step 1: Add whatsapp_lid column (without UNIQUE constraint for ALTER TABLE compatibility)
    db.run('ALTER TABLE customers ADD COLUMN whatsapp_lid TEXT', (err) => {
        if (err) {
            if (err.message.includes('duplicate column')) {
                console.log('ℹ️  Column whatsapp_lid already exists - skipping column creation');

                // Column exists, just create index
                createIndex();
            } else {
                console.error('❌ Error adding column:', err.message);
                db.close();
                return;
            }
        } else {
            console.log('✅ Column whatsapp_lid added successfully');

            // Column added, now create index
            createIndex();
        }
    });

    function createIndex() {
        // Step 2: Create unique index for whatsapp_lid
        db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_whatsapp_lid ON customers(whatsapp_lid)', (err) => {
            if (err) {
                console.error('❌ Error creating unique index:', err.message);
                db.close();
                return;
            } else {
                console.log('✅ Unique index idx_customers_whatsapp_lid created successfully');
            }

            // Step 3: Verify the changes
            verifyMigration();
        });
    }

    function verifyMigration() {
        db.all("PRAGMA table_info(customers)", (err, rows) => {
            if (err) {
                console.error('❌ Error verifying schema:', err.message);
                db.close();
                return;
            }

            const lidColumn = rows.find(col => col.name === 'whatsapp_lid');
            if (lidColumn) {
                console.log('\n✅ Migration completed successfully!');
                console.log('📋 Column details:', {
                    name: lidColumn.name,
                    type: lidColumn.type,
                    nullable: lidColumn.notnull === 0 ? 'YES' : 'NO'
                });

                // Check index
                db.all("PRAGMA index_list(customers)", (err, indexes) => {
                    if (err) {
                        console.error('⚠️  Warning: Could not verify indexes');
                    } else {
                        const lidIndex = indexes.find(idx => idx.name === 'idx_customers_whatsapp_lid');
                        if (lidIndex) {
                            console.log('📋 Index details:', {
                                name: lidIndex.name,
                                unique: lidIndex.unique === 1 ? 'YES' : 'NO'
                            });
                        }
                    }

                    closeDatabase();
                });
            } else {
                console.log('\n⚠️  Warning: whatsapp_lid column not found in schema');
                closeDatabase();
            }
        });
    }

    function closeDatabase() {
        db.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err.message);
            } else {
                console.log('\n🎉 Database migration complete!');
                console.log('📝 Next steps:');
                console.log('   1. Restart your application (stop and run: npm start)');
                console.log('   2. Test REG command from WhatsApp with @lid format');
                console.log('   3. Check logs for successful registration');
            }
        });
    }
});
