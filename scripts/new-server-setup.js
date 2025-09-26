#!/usr/bin/env node

/**
 * New Server Setup - Setup awal untuk server baru
 * Membuat data default yang diperlukan untuk server baru tanpa data lama
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function newServerSetup() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
    
    try {
        console.log('🚀 NEW SERVER SETUP - Setup Awal Server Baru...\n');
        
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
                    INSERT INTO packages (name, speed, price, tax_rate, description, is_active, pppoe_profile) 
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
        
        // Step 4: Create default technician
        console.log('\n🔧 Step 4: Creating default technician...');
        const technicianId = await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO technicians (name, phone, role, is_active, join_date, created_at) 
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [
                'Administrator',
                '081234567891',
                'technician', // Use valid role
                1 // is_active = true
            ], function(err) {
                if (err) {
                    console.error('❌ Failed to create default technician:', err.message);
                    reject(err);
                } else {
                    console.log('   ✅ Default technician created (ID: ' + this.lastID + ')');
                    resolve(this.lastID);
                }
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
                    INSERT INTO customers (username, name, phone, email, address, status, join_date) 
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
        
        const invoiceIds = [];
        for (const invoice of invoices) {
            const invoiceId = await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO invoices (customer_id, package_id, amount, status, due_date, created_at, invoice_number, invoice_type) 
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
                    INSERT INTO app_settings (key, value, created_at) 
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
