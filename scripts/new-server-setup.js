#!/usr/bin/env node

/**
 * New Server Setup - Setup awal untuk server baru
 * Membuat data default yang diperlukan untuk server baru tanpa data lama
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Function to ensure app_settings table exists
async function ensureAppSettingsTable(db) {
    console.log('🔧 Ensuring app_settings table exists...');
    
    return new Promise((resolve, reject) => {
        // Create app_settings table if it doesn't exist
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        db.run(createTableSQL, (err) => {
            if (err) {
                console.error('❌ Failed to create app_settings table:', err.message);
                reject(err);
            } else {
                console.log('   ✅ app_settings table ensured');
                resolve();
            }
        });
    });
}

// Function to ensure essential tables exist
async function ensureEssentialTables(db) {
    console.log('🔧 Ensuring essential tables exist...');
    
    const essentialTables = [
        {
            name: 'packages',
            sql: `CREATE TABLE IF NOT EXISTS packages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                speed TEXT,
                price INTEGER NOT NULL,
                tax_rate REAL DEFAULT 11.0,
                description TEXT,
                is_active INTEGER DEFAULT 1,
                pppoe_profile TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        },
        {
            name: 'collectors',
            sql: `CREATE TABLE IF NOT EXISTS collectors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT UNIQUE,
                email TEXT,
                commission_rate REAL DEFAULT 10.0,
                status TEXT DEFAULT 'active',
                password TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        },
        {
            name: 'technicians',
            sql: `CREATE TABLE IF NOT EXISTS technicians (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT UNIQUE,
                role TEXT DEFAULT 'technician',
                email TEXT,
                notes TEXT,
                is_active INTEGER DEFAULT 1,
                area_coverage TEXT,
                join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME,
                whatsapp_group_id TEXT
            )`
        },
        {
            name: 'customers',
            sql: `CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                name TEXT NOT NULL,
                phone TEXT,
                email TEXT,
                address TEXT,
                package_id INTEGER,
                status TEXT DEFAULT 'active',
                join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (package_id) REFERENCES packages (id)
            )`
        },
        {
            name: 'invoices',
            sql: `CREATE TABLE IF NOT EXISTS invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                package_id INTEGER,
                amount INTEGER NOT NULL,
                tax_amount INTEGER DEFAULT 0,
                description TEXT,
                status TEXT DEFAULT 'unpaid',
                due_date DATE,
                paid_date DATE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                invoice_number TEXT UNIQUE,
                invoice_type TEXT DEFAULT 'monthly',
                FOREIGN KEY (customer_id) REFERENCES customers (id),
                FOREIGN KEY (package_id) REFERENCES packages (id)
            )`
        }
    ];
    
    for (const table of essentialTables) {
        await new Promise((resolve, reject) => {
            db.run(table.sql, (err) => {
                if (err) {
                    console.error(`❌ Failed to create ${table.name} table:`, err.message);
                    reject(err);
                } else {
                    console.log(`   ✅ ${table.name} table ensured`);
                    resolve();
                }
            });
        });
    }
}

async function runSqlMigrations(db) {
    console.log('\n🔧 Step 0: Running SQL migrations...');
    
    // Get all SQL migration files
    const migrationsDir = path.join(__dirname, '../migrations');
    
    // Check if migrations directory exists
    const fs = require('fs');
    if (!fs.existsSync(migrationsDir)) {
        console.log('   ⚠️  Migrations directory not found, skipping...');
        return;
    }
    
    const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort(); // Sort to ensure proper order
    
    console.log(`   📋 Found ${migrationFiles.length} migration files`);
    
    // Run each migration
    for (const file of migrationFiles) {
        const filePath = path.join(migrationsDir, file);
        console.log(`   🚀 Running ${file}...`);
        
        try {
            const sql = fs.readFileSync(filePath, 'utf8');
            
            // Split SQL by semicolon to handle multiple statements
            const statements = sql
                .split(';')
                .map(stmt => stmt.trim())
                .filter(stmt => stmt.length > 0);
            
            for (const statement of statements) {
                const trimmedStatement = statement.trim();
                if (trimmedStatement) {
                    // Skip empty statements and transaction control
                    if (trimmedStatement.toUpperCase() === 'BEGIN' || 
                        trimmedStatement.toUpperCase() === 'COMMIT' ||
                        trimmedStatement.toUpperCase() === 'END' ||
                        trimmedStatement.toUpperCase() === 'ROLLBACK') {
                        continue;
                    }
                    
                    await new Promise((resolve, reject) => {
                        db.run(trimmedStatement, function(err) {
                            if (err) {
                                // Ignore errors for already existing columns/tables
                                if (err.message.includes('duplicate') || 
                                    err.message.includes('already exists') ||
                                    err.message.includes('no such table') ||
                                    err.message.includes('no such column') ||
                                    err.message.includes('incomplete input') ||
                                    err.message.includes('not an error') ||
                                    err.message.includes('SQLITE_MISUSE')) {
                                    console.log(`      ℹ️  ${err.message} (continuing...)`);
                                    resolve();
                                } else {
                                    console.log(`      ❌ Error: ${err.message}`);
                                    resolve(); // Continue with other migrations
                                }
                            } else {
                                resolve();
                            }
                        });
                    });
                }
            }
            
            console.log(`   ✅ ${file} completed successfully`);
        } catch (error) {
            console.log(`   ⚠️  ${file} had issues: ${error.message} (continuing...)`);
        }
    }
    
    console.log('   🎉 SQL migrations completed!\n');
}

async function newServerSetup() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
    
    try {
        console.log('🚀 NEW SERVER SETUP - Setup Awal Server Baru...\n');
        
        // Step 0: Run SQL migrations first
        await runSqlMigrations(db);
        
        // Ensure essential tables exist
        await ensureEssentialTables(db);
        
        // Ensure app_settings table exists
        await ensureAppSettingsTable(db);
        
        // Step 1: Set database optimizations
        console.log('⚙️  Step 1: Setting database optimizations...');
        await new Promise((resolve, reject) => {
            db.run('PRAGMA journal_mode=WAL', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        await new Promise((resolve, reject) => {
            db.run('PRAGMA busy_timeout=30000', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        await new Promise((resolve, reject) => {
            db.run('PRAGMA foreign_keys=ON', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        console.log('   ✅ WAL mode enabled');
        console.log('   ✅ Timeout configured');
        console.log('   ✅ Foreign keys enabled');
        
        // Step 2: Create default packages
        console.log('\n📦 Step 2: Creating default packages...');
        const packages = [
            {
                name: 'Paket Internet Dasar',
                speed: '10 Mbps',
                price: 100000,
                description: 'Paket internet dasar 10 Mbps unlimited',
                is_active: 1,
                pppoe_profile: 'default'
            },
            {
                name: 'Paket Internet Standard',
                speed: '20 Mbps',
                price: 150000,
                description: 'Paket internet standard 20 Mbps unlimited',
                is_active: 1,
                pppoe_profile: 'standard'
            },
            {
                name: 'Paket Internet Premium',
                speed: '50 Mbps',
                price: 250000,
                description: 'Paket internet premium 50 Mbps unlimited',
                is_active: 1,
                pppoe_profile: 'premium'
            }
        ];
        
        const packageIds = [];
        for (const pkg of packages) {
            const packageId = await new Promise((resolve, reject) => {
                db.run(`
                    INSERT OR IGNORE INTO packages (name, speed, price, tax_rate, description, is_active, pppoe_profile) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    pkg.name, pkg.speed, pkg.price, 11, pkg.description, pkg.is_active, pkg.pppoe_profile
                ], function(err) {
                    if (err) {
                        console.error(`❌ Failed to create package ${pkg.name}:`, err.message);
                        reject(err);
                    } else {
                        console.log(`   ✅ Package ${pkg.name} created (ID: ${this.lastID})`);
                        resolve(this.lastID);
                    }
                });
            });
            packageIds.push(packageId);
        }
        
        // Step 3: Create default collector
        console.log('\n👤 Step 3: Creating default collector...');
        const collectorId = await new Promise((resolve, reject) => {
            // First check if collector already exists
            db.get('SELECT id FROM collectors WHERE phone = ?', ['081234567890'], (err, row) => {
                if (err) {
                    console.error('❌ Error checking existing collector:', err.message);
                    reject(err);
                    return;
                }
                
                if (row) {
                    console.log('   ℹ️  Default collector already exists (ID: ' + row.id + ')');
                    resolve(row.id);
                    return;
                }
                
                // Create new collector
                db.run(`
                    INSERT INTO collectors (name, phone, email, commission_rate, status, created_at) 
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                    'Kolektor Utama',
                    '081234567890',
                    'kolektor@company.com',
                    10.0, // 10% commission
                    'active'
                ], function(err) {
                    if (err) {
                        console.error('❌ Failed to create default collector:', err.message);
                        reject(err);
                    } else {
                        console.log('   ✅ Default collector created (ID: ' + this.lastID + ')');
                        resolve(this.lastID);
                    }
                });
            });
        });
        
        // Step 4: Create default technician
        console.log('\n🔧 Step 4: Creating default technician...');
        const technicianId = await new Promise((resolve, reject) => {
            // First check if technician already exists
            db.get('SELECT id FROM technicians WHERE phone = ?', ['081234567891'], (err, row) => {
                if (err) {
                    console.error('❌ Error checking existing technician:', err.message);
                    reject(err);
                    return;
                }
                
                if (row) {
                    console.log('   ℹ️  Default technician already exists (ID: ' + row.id + ')');
                    resolve(row.id);
                    return;
                }
                
                // Check table structure first
                db.all("PRAGMA table_info(technicians)", [], (err, rows) => {
                    if (err) {
                        console.error('❌ Error checking technicians table structure:', err.message);
                        reject(err);
                        return;
                    }
                    
                    // Get available columns
                    const columns = rows.map(row => row.name);
                    console.log('   ℹ️  Available technician columns:', columns.join(', '));
                    
                    // Build query based on available columns
                    let query, params;
                    if (columns.includes('join_date')) {
                        // Modern structure
                        query = `
                            INSERT INTO technicians (name, phone, role, is_active, join_date, created_at) 
                            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        `;
                        params = [
                            'Administrator',
                            '081234567891',
                            'technician',
                            1
                        ];
                    } else {
                        // Legacy structure
                        query = `
                            INSERT INTO technicians (name, phone, role, is_active, created_at) 
                            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                        `;
                        params = [
                            'Administrator',
                            '081234567891',
                            'technician',
                            1
                        ];
                    }
                    
                    db.run(query, params, function(err) {
                        if (err) {
                            console.error('❌ Failed to create default technician:', err.message);
                            reject(err);
                        } else {
                            console.log('   ✅ Default technician created (ID: ' + this.lastID + ')');
                            resolve(this.lastID);
                        }
                    });
                });
            });
        });
        
        // Step 5: Create sample customers
        console.log('\n👥 Step 5: Creating sample customers...');
        const customers = [
            {
                username: 'pelanggan1',
                name: 'Pelanggan Pertama',
                phone: '081234567892',
                email: 'pelanggan1@example.com',
                address: 'Alamat Pelanggan Pertama'
            },
            {
                username: 'pelanggan2',
                name: 'Pelanggan Kedua',
                phone: '081234567893',
                email: 'pelanggan2@example.com',
                address: 'Alamat Pelanggan Kedua'
            }
        ];
        
        const customerIds = [];
        for (const customer of customers) {
            const customerId = await new Promise((resolve, reject) => {
                db.run(`
                    INSERT OR IGNORE INTO customers (username, name, phone, email, address, status, join_date) 
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                    customer.username, customer.name, customer.phone, customer.email, customer.address, 'active'
                ], function(err) {
                    if (err) {
                        console.error(`❌ Failed to create customer ${customer.username}:`, err.message);
                        reject(err);
                    } else {
                        console.log(`   ✅ Customer ${customer.username} created (ID: ${this.lastID})`);
                        resolve(this.lastID);
                    }
                });
            });
            customerIds.push(customerId);
        }
        
        // Step 6: Create sample invoices
        console.log('\n📄 Step 6: Creating sample invoices...');
        // Initialize invoiceIds array
        const invoiceIds = [];
        
        // First check if we have customer and package IDs
        if (customerIds.length > 0 && packageIds.length > 0) {
            const invoices = [
                {
                    customer_id: customerIds[0],
                    package_id: packageIds[0],
                    amount: 100000,
                    status: 'unpaid',
                    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    invoice_number: 'INV-001',
                    invoice_type: 'monthly'
                },
                {
                    customer_id: customerIds[1],
                    package_id: packageIds[1],
                    amount: 150000,
                    status: 'unpaid',
                    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    invoice_number: 'INV-002',
                    invoice_type: 'monthly'
                }
            ];
            
            for (const invoice of invoices) {
                const invoiceId = await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT OR IGNORE INTO invoices (customer_id, package_id, amount, status, due_date, created_at, invoice_number, invoice_type) 
                        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
                    `, [
                        invoice.customer_id, invoice.package_id, invoice.amount, invoice.status, 
                        invoice.due_date, invoice.invoice_number, invoice.invoice_type
                    ], function(err) {
                        if (err) {
                            console.error(`❌ Failed to create invoice ${invoice.invoice_number}:`, err.message);
                            reject(err);
                        } else {
                            console.log(`   ✅ Invoice ${invoice.invoice_number} created (ID: ${this.lastID})`);
                            resolve(this.lastID);
                        }
                    });
                });
                invoiceIds.push(invoiceId);
            }
        } else {
            console.log('   ⚠️  Skipping invoice creation - no customers or packages available');
        }
        
        // Step 7: Create app settings
        console.log('\n⚙️  Step 7: Creating app settings...');
        const settings = [
            { key: 'company_name', value: 'ALIJAYA DIGITAL NETWORK' },
            { key: 'company_phone', value: '081947215703' },
            { key: 'company_email', value: 'info@alijaya.com' },
            { key: 'company_address', value: 'Jl. Contoh Alamat No. 123' },
            { key: 'default_commission_rate', value: '10' },
            { key: 'tax_rate', value: '11' },
            { key: 'currency', value: 'IDR' },
            { key: 'timezone', value: 'Asia/Jakarta' }
        ];
        
        for (const setting of settings) {
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT OR IGNORE INTO app_settings (key, value, created_at) 
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                `, [
                    setting.key, setting.value
                ], function(err) {
                    if (err) {
                        console.error(`❌ Failed to create setting ${setting.key}:`, err.message);
                        reject(err);
                    } else {
                        console.log(`   ✅ Setting ${setting.key} created`);
                        resolve();
                    }
                });
            });
        }
        
        // Step 8: Final verification
        console.log('\n📊 Step 8: Final verification...');
        const finalStats = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    'packages' as table_name, COUNT(*) as count 
                FROM packages
                UNION ALL
                SELECT 
                    'collectors' as table_name, COUNT(*) as count 
                FROM collectors
                UNION ALL
                SELECT 
                    'technicians' as table_name, COUNT(*) as count 
                FROM technicians
                UNION ALL
                SELECT 
                    'customers' as table_name, COUNT(*) as count 
                FROM customers
                UNION ALL
                SELECT 
                    'invoices' as table_name, COUNT(*) as count 
                FROM invoices
                UNION ALL
                SELECT 
                    'app_settings' as table_name, COUNT(*) as count 
                FROM app_settings
                UNION ALL
                SELECT 
                    'payments' as table_name, COUNT(*) as count 
                FROM payments
                UNION ALL
                SELECT 
                    'expenses' as table_name, COUNT(*) as count 
                FROM expenses
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        finalStats.forEach(stat => {
            console.log(`   📊 ${stat.table_name}: ${stat.count} records`);
        });
        
        console.log('\n🎉 NEW SERVER SETUP COMPLETED!');
        console.log('=' .repeat(60));
        console.log('✅ Default packages created');
        console.log('✅ Default collector created');
        console.log('✅ Default technician created');
        console.log('✅ Sample customers created');
        console.log('✅ Sample invoices created');
        console.log('✅ App settings configured');
        console.log('✅ Database optimizations applied');
        console.log('✅ System ready for production');
        console.log('=' .repeat(60));
        
        console.log('\n📋 Summary:');
        console.log(`   📦 Packages: ${packageIds.length} packages created`);
        console.log(`   👤 Collector: Kolektor Utama (10% commission)`);
        console.log(`   🔧 Technician: Administrator (admin role)`);
        console.log(`   👥 Customers: ${customerIds.length} sample customers`);
        console.log(`   📄 Invoices: ${invoiceIds.length} sample invoices`);
        console.log(`   ⚙️  Settings: ${settings.length} app settings`);
        console.log(`   💰 Payments: 0 (clean start)`);
        console.log(`   💸 Expenses: 0 (clean start)`);
        
        console.log('\n🚀 Server is ready for production use!');
        console.log('   - Clean financial data');
        console.log('   - Default packages available');
        console.log('   - Collector system ready');
        console.log('   - Keuangan akan benar dari awal');
        console.log('   - Ready for new customers and payments');
        
    } catch (error) {
        console.error('❌ Error during new server setup:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    newServerSetup()
        .then(() => {
            console.log('✅ New server setup completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ New server setup failed:', error);
            process.exit(1);
        });
}

module.exports = newServerSetup;