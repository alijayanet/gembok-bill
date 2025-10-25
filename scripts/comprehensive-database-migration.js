const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Path to the billing database
const dbPath = path.join(__dirname, '../data/billing.db');

// Create database connection
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('✅ Connected to billing database');
});

// Function to check if a column exists in a table
function columnExists(tableName, columnName) {
    return new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
            if (err) {
                reject(err);
                return;
            }
            
            const exists = columns.some(col => col.name === columnName);
            resolve(exists);
        });
    });
}

// Function to add a column if it doesn't exist
function addColumnIfNotExists(tableName, columnName, columnDefinition) {
    return new Promise(async (resolve, reject) => {
        try {
            const exists = await columnExists(tableName, columnName);
            if (!exists) {
                const sql = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`;
                db.run(sql, (err) => {
                    if (err) {
                        // If it's a duplicate column error, that's fine - it already exists
                        if (err.message.includes('duplicate column name')) {
                            console.log(`ℹ️  Column ${columnName} already exists in ${tableName} (caught during add attempt)`);
                            resolve(false);
                        } else {
                            console.error(`❌ Error adding column ${columnName} to ${tableName}:`, err.message);
                            reject(err);
                        }
                    } else {
                        console.log(`✅ Successfully added column ${columnName} ${columnDefinition} to ${tableName}`);
                        resolve(true);
                    }
                });
            } else {
                console.log(`ℹ️  Column ${columnName} already exists in ${tableName}, skipping...`);
                resolve(false);
            }
        } catch (error) {
            reject(error);
        }
    });
}

// Function to create an index if it doesn't exist
function createIndexIfNotExists(indexName, tableName, columns) {
    return new Promise((resolve, reject) => {
        // First check if index exists
        db.get("SELECT name FROM sqlite_master WHERE type='index' AND name=?", [indexName], (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            
            if (!row) {
                // Index doesn't exist, create it
                const sql = `CREATE INDEX ${indexName} ON ${tableName}(${columns.join(', ')})`;
                db.run(sql, (err) => {
                    if (err) {
                        console.error(`❌ Error creating index ${indexName} on ${tableName}:`, err.message);
                        reject(err);
                    } else {
                        console.log(`✅ Successfully created index ${indexName} on ${tableName}(${columns.join(', ')})`);
                        resolve(true);
                    }
                });
            } else {
                console.log(`ℹ️  Index ${indexName} on ${tableName} already exists, skipping...`);
                resolve(false);
            }
        });
    });
}

// Function to run comprehensive database migration
async function runComprehensiveDatabaseMigration() {
    try {
        console.log('🚀 Starting comprehensive database migration...');
        
        // Define all table updates
        const tableUpdates = {
            trouble_reports: {
                columns: [
                    { name: 'id', definition: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
                    { name: 'phone', definition: 'TEXT' },
                    { name: 'name', definition: 'TEXT' },
                    { name: 'location', definition: 'TEXT' },
                    { name: 'category', definition: 'TEXT' },
                    { name: 'description', definition: 'TEXT' },
                    { name: 'status', definition: 'TEXT DEFAULT \'pending\'' },
                    { name: 'assigned_to', definition: 'INTEGER' },
                    { name: 'resolution', definition: 'TEXT' },
                    { name: 'created_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
                    { name: 'updated_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP' }
                ],
                indexes: [
                    { name: 'idx_trouble_reports_status', columns: ['status'] },
                    { name: 'idx_trouble_reports_category', columns: ['category'] },
                    { name: 'idx_trouble_reports_assigned_to', columns: ['assigned_to'] },
                    { name: 'idx_trouble_reports_created_at', columns: ['created_at'] }
                ]
            },
            packages: {
                columns: [
                    { name: 'status', definition: 'TEXT DEFAULT \'active\'' },
                    { name: 'updated_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP' }
                ],
                indexes: [
                    { name: 'idx_packages_status', columns: ['status'] },
                    { name: 'idx_packages_updated_at', columns: ['updated_at'] }
                ]
            },
            voucher_pricing: {
                columns: [
                    { name: 'package_id', definition: 'INTEGER' },
                    { name: 'duration_hours', definition: 'INTEGER DEFAULT 24' },
                    { name: 'price', definition: 'DECIMAL(10,2)' },
                    { name: 'commission', definition: 'DECIMAL(10,2)' }
                ],
                indexes: [
                    { name: 'idx_voucher_pricing_package_id', columns: ['package_id'] },
                    { name: 'idx_voucher_pricing_duration', columns: ['duration_hours'] }
                ]
            },
            customers: {
                columns: [
                    { name: 'created_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
                    { name: 'updated_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP' }
                ],
                indexes: [
                    { name: 'idx_customers_created_at', columns: ['created_at'] },
                    { name: 'idx_customers_updated_at', columns: ['updated_at'] }
                ]
            },
            voucher_settings: {
                columns: [
                    { name: 'id', definition: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
                    { name: 'name', definition: 'TEXT' },
                    { name: 'header_text', definition: 'TEXT' },
                    { name: 'footer_text', definition: 'TEXT' },
                    { name: 'validity_days', definition: 'INTEGER DEFAULT 30' },
                    { name: 'created_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
                    { name: 'updated_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP' }
                ],
                indexes: [
                    { name: 'idx_voucher_settings_name', columns: ['name'] },
                    { name: 'idx_voucher_settings_created_at', columns: ['created_at'] }
                ]
            },
            payments: {
                columns: [
                    { name: 'created_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP' }
                ],
                indexes: [
                    { name: 'idx_payments_created_at', columns: ['created_at'] }
                ]
            }
        };
        
        // Process each table
        console.log('\n📋 Processing tables...');
        let totalColumnsAdded = 0;
        let totalIndexesCreated = 0;
        
        for (const [tableName, updates] of Object.entries(tableUpdates)) {
            console.log(`\n🔧 Processing ${tableName}...`);
            
            // Add missing columns
            let columnsAdded = 0;
            for (const column of updates.columns) {
                try {
                    const added = await addColumnIfNotExists(tableName, column.name, column.definition);
                    if (added) columnsAdded++;
                } catch (error) {
                    console.error(`❌ Error processing column ${column.name} in ${tableName}:`, error.message);
                }
            }
            
            console.log(`✅ Added ${columnsAdded} columns to ${tableName}`);
            totalColumnsAdded += columnsAdded;
            
            // Create indexes
            let indexesCreated = 0;
            for (const index of updates.indexes) {
                try {
                    const created = await createIndexIfNotExists(index.name, tableName, index.columns);
                    if (created) indexesCreated++;
                } catch (error) {
                    console.error(`❌ Error creating index ${index.name} on ${tableName}:`, error.message);
                }
            }
            
            console.log(`✅ Created ${indexesCreated} indexes on ${tableName}`);
            totalIndexesCreated += indexesCreated;
        }
        
        // Update existing records with default values
        console.log('\n🔄 Updating existing records with default values...');
        
        // Update trouble_reports
        db.run(`UPDATE trouble_reports 
                SET status = COALESCE(status, 'pending'),
                    created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
                    updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
                WHERE status IS NULL OR created_at IS NULL OR updated_at IS NULL`, function(err) {
            if (err) {
                console.error('❌ Error updating trouble_reports:', err.message);
            } else {
                console.log(`✅ Updated ${this.changes} trouble_reports records`);
            }
        });
        
        // Update packages
        db.run(`UPDATE packages 
                SET status = COALESCE(status, 'active'),
                    updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
                WHERE status IS NULL OR updated_at IS NULL`, function(err) {
            if (err) {
                console.error('❌ Error updating packages:', err.message);
            } else {
                console.log(`✅ Updated ${this.changes} packages records`);
            }
        });
        
        // Update customers
        db.run(`UPDATE customers 
                SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
                    updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
                WHERE created_at IS NULL OR updated_at IS NULL`, function(err) {
            if (err) {
                console.error('❌ Error updating customers:', err.message);
            } else {
                console.log(`✅ Updated ${this.changes} customers records`);
            }
        });
        
        // Update voucher_settings
        db.run(`UPDATE voucher_settings 
                SET validity_days = COALESCE(validity_days, 30),
                    created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
                    updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
                WHERE validity_days IS NULL OR created_at IS NULL OR updated_at IS NULL`, function(err) {
            if (err) {
                console.error('❌ Error updating voucher_settings:', err.message);
            } else {
                console.log(`✅ Updated ${this.changes} voucher_settings records`);
            }
        });
        
        // Update payments
        db.run(`UPDATE payments 
                SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP)
                WHERE created_at IS NULL`, function(err) {
            if (err) {
                console.error('❌ Error updating payments:', err.message);
            } else {
                console.log(`✅ Updated ${this.changes} payments records`);
            }
        });
        
        // Final summary
        console.log('\n🎉 Comprehensive database migration completed successfully!');
        console.log('\n📝 Summary:');
        console.log(`  ✅ ${totalColumnsAdded} columns added across all tables`);
        console.log(`  ✅ ${totalIndexesCreated} indexes created for better performance`);
        console.log(`  ✅ Existing records updated with appropriate default values`);
        console.log('\n🚀 The database is now fully prepared for all application features!');
        
    } catch (error) {
        console.error('\n💥 Migration failed:', error.message);
        throw error;
    }
}

// Run the migration if this script is executed directly
if (require.main === module) {
    runComprehensiveDatabaseMigration()
        .then(() => {
            console.log('\n🎯 Migration script completed successfully!');
            db.close((err) => {
                if (err) {
                    console.error('❌ Error closing database:', err.message);
                } else {
                    console.log('🔒 Database connection closed');
                }
            });
        })
        .catch(error => {
            console.error('\n💥 Migration script failed:', error.message);
            db.close((err) => {
                if (err) {
                    console.error('❌ Error closing database:', err.message);
                }
            });
            process.exit(1);
        });
}

module.exports = { runComprehensiveDatabaseMigration };