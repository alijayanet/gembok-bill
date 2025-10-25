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
                        console.error(`❌ Error adding column ${columnName}:`, err.message);
                        reject(err);
                    } else {
                        console.log(`✅ Successfully added column ${columnName} ${columnDefinition}`);
                        resolve(true);
                    }
                });
            } else {
                console.log(`ℹ️  Column ${columnName} already exists, skipping...`);
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
                        console.error(`❌ Error creating index ${indexName}:`, err.message);
                        reject(err);
                    } else {
                        console.log(`✅ Successfully created index ${indexName} on ${tableName}(${columns.join(', ')})`);
                        resolve(true);
                    }
                });
            } else {
                console.log(`ℹ️  Index ${indexName} already exists, skipping...`);
                resolve(false);
            }
        });
    });
}

// Function to run the comprehensive invoice migration
async function runComprehensiveInvoiceMigration() {
    try {
        console.log('🚀 Starting comprehensive invoice migration...');
        
        // List of columns to ensure exist
        const columnsToAdd = [
            { name: 'base_amount', definition: 'DECIMAL(10,2)' },
            { name: 'tax_rate', definition: 'DECIMAL(5,2)' },
            { name: 'description', definition: 'TEXT' },
            { name: 'invoice_type', definition: 'TEXT DEFAULT \'monthly\'' },
            { name: 'package_name', definition: 'TEXT' }
        ];
        
        // Add missing columns
        console.log('\n📋 Checking and adding missing columns...');
        let columnsAdded = 0;
        for (const column of columnsToAdd) {
            try {
                const added = await addColumnIfNotExists('invoices', column.name, column.definition);
                if (added) columnsAdded++;
            } catch (error) {
                // If it's a duplicate column error, that's fine - it already exists
                if (error.message.includes('duplicate column name')) {
                    console.log(`ℹ️  Column ${column.name} already exists (caught during add attempt)`);
                } else {
                    throw error;
                }
            }
        }
        
        console.log(`\n📊 Columns processed: ${columnsAdded} new columns added`);
        
        // Update existing invoices with default values for new columns
        console.log('\n🔄 Updating existing invoices with default values...');
        db.run(`UPDATE invoices 
                SET base_amount = COALESCE(base_amount, amount), 
                    tax_rate = COALESCE(tax_rate, 0.00),
                    description = COALESCE(description, ''),
                    invoice_type = COALESCE(invoice_type, 'monthly'),
                    package_name = COALESCE(package_name, '')
                WHERE base_amount IS NULL OR tax_rate IS NULL`, function(err) {
            if (err) {
                console.error('❌ Error updating invoices:', err.message);
            } else {
                console.log(`✅ Updated ${this.changes} invoices with default values`);
            }
        });
        
        // Create indexes
        console.log('\n.CreateIndexing for better performance...');
        const indexesToCreate = [
            { name: 'idx_invoices_base_amount', table: 'invoices', columns: ['base_amount'] },
            { name: 'idx_invoices_tax_rate', table: 'invoices', columns: ['tax_rate'] },
            { name: 'idx_invoices_invoice_type', table: 'invoices', columns: ['invoice_type'] },
            { name: 'idx_invoices_package_name', table: 'invoices', columns: ['package_name'] }
        ];
        
        let indexesCreated = 0;
        for (const index of indexesToCreate) {
            try {
                const created = await createIndexIfNotExists(index.name, index.table, index.columns);
                if (created) indexesCreated++;
            } catch (error) {
                console.error(`❌ Error creating index ${index.name}:`, error.message);
            }
        }
        
        console.log(`\n📊 Indexes processed: ${indexesCreated} new indexes created`);
        
        // Final verification
        console.log('\n🔍 Final verification of table structure...');
        db.all("PRAGMA table_info(invoices)", (err, columns) => {
            if (err) {
                console.error('❌ Error getting final structure:', err.message);
                return;
            }
            
            console.log('\n📊 Final invoices table structure:');
            columns.forEach(col => {
                const required = col.notnull ? 'REQUIRED' : 'OPTIONAL';
                const defaultValue = col.dflt_value ? ` (Default: ${col.dflt_value})` : '';
                console.log(`  - ${col.name}: ${col.type} - ${required}${defaultValue}`);
            });
            
            console.log('\n🎉 Comprehensive invoice migration completed successfully!');
            console.log('\n📝 Summary:');
            console.log(`  ✅ ${columnsAdded} columns added (if missing)`);
            console.log(`  ✅ Existing invoices updated with default values`);
            console.log(`  ✅ ${indexesCreated} indexes created (if missing)`);
            console.log('\n🚀 The invoices table is now fully prepared for PPN support!');
        });
        
    } catch (error) {
        console.error('\n💥 Migration failed:', error.message);
        throw error;
    }
}

// Run the migration if this script is executed directly
if (require.main === module) {
    runComprehensiveInvoiceMigration()
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

module.exports = { runComprehensiveInvoiceMigration };