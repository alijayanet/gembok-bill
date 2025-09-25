const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function checkPackagesTable() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Checking packages table structure...');
        
        // Check table structure
        const packagesInfo = await new Promise((resolve, reject) => {
            db.all('PRAGMA table_info(packages)', (err, rows) => {
                if (err) {
                    if (err.message.includes('no such table')) {
                        console.log('❌ packages table does not exist');
                        resolve([]);
                    } else {
                        reject(err);
                    }
                } else {
                    resolve(rows || []);
                }
            });
        });
        
        console.log('📋 packages table structure:');
        packagesInfo.forEach(col => {
            console.log(`   - ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.dflt_value ? `DEFAULT ${col.dflt_value}` : ''}`);
        });
        
        // Try to create package manually
        console.log('\n🔧 Trying to create default package...');
        await new Promise((resolve) => {
            db.run(`
                INSERT INTO packages (name, speed, price, tax_rate, description, status) 
                VALUES ('Paket Dasar', 10, 100000, 11, 'Paket internet dasar', 'active')
            `, function(err) {
                if (err) {
                    console.log('❌ Error creating package:', err.message);
                } else {
                    console.log('✅ Default package created with ID:', this.lastID);
                }
                resolve();
            });
        });
        
        // Check packages count
        const count = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM packages', (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        console.log(`📊 Total packages: ${count}`);
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    checkPackagesTable();
}

module.exports = checkPackagesTable;
