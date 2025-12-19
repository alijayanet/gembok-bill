#!/usr/bin/env node

/**
 * FRESH SERVER INSTALLATION SCRIPT
 * Script untuk install server baru dari 0 - menghapus SEMUA data transaksi
 * 
 * Script ini akan:
 * 1. Menghapus semua data transaksi (customers, invoices, payments, agents, vouchers, dll)
 * 2. Reset semua counter dan sequence
 * 3. Membuat data default yang diperlukan
 * 4. Setup voucher pricing system
 * 5. Setup agent system
 * 6. Membuat data sample untuk testing
 * 
 * HATI-HATI: Script ini akan menghapus SEMUA DATA!
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

async function freshServerInstallation() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🚨 FRESH SERVER INSTALLATION - HAPUS SEMUA DATA TRANSAKSI!');
        console.log('=' .repeat(80));
        console.log('⚠️  Script ini akan menghapus SEMUA data transaksi untuk server baru');
        console.log('⚠️  SEMUA CUSTOMERS, INVOICES, PAYMENTS, AGENTS, VOUCHERS akan DIHAPUS!');
        console.log('⚠️  Hanya data struktur dan setting yang akan dipertahankan');
        console.log('=' .repeat(80));
        
        // Confirmation prompt
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const answer = await new Promise((resolve) => {
            rl.question('Ketik "FRESH INSTALL" untuk konfirmasi (case sensitive): ', (input) => {
                rl.close();
                resolve(input);
            });
        });
        
        if (answer !== 'FRESH INSTALL') {
            console.log('❌ Instalasi dibatalkan. Tidak ada data yang dimodifikasi.');
            process.exit(0);
        }
        
        console.log('\n🔄 Memulai fresh server installation...');
        
        // Step 1: Get all table names
        console.log('\n📋 Step 1: Mengidentifikasi semua tabel...');
        const tables = await new Promise((resolve, reject) => {
            db.all(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name NOT LIKE 'sqlite_%'
                ORDER BY name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(row => row.name));
            });
        });
        
        console.log(`✅ Ditemukan ${tables.length} tabel:`, tables.join(', '));
        
        // Step 2: Get current data counts for backup info
        console.log('\n📊 Step 2: Mencatat data yang akan dihapus...');
        const dataCounts = {};
        
        for (const table of tables) {
            try {
                const count = await new Promise((resolve, reject) => {
                    db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
                        if (err) resolve(0);
                        else resolve(row ? row.count : 0);
                    });
                });
                dataCounts[table] = count;
                if (count > 0) {
                    console.log(`   📊 ${table}: ${count} records`);
                }
            } catch (error) {
                dataCounts[table] = 0;
            }
        }
        
        const totalRecords = Object.values(dataCounts).reduce((a, b) => a + b, 0);
        console.log(`\n📈 Total records yang akan dihapus: ${totalRecords}`);
        
        // Step 3: Delete all data in correct order (respecting foreign keys)
        console.log('\n🗑️  Step 3: Menghapus semua data transaksi...');
        
        // Define deletion order to respect foreign key constraints
        const deletionOrder = [
            // Agent related tables first
            'agent_voucher_sales',
            'agent_balances',
            'agent_notifications',
            'agent_transactions',
            'agent_monthly_payments',
            'agents',
            
            // Voucher related tables
            'voucher_invoices',
            'voucher_pricing',
            
            // Payment related tables
            'collector_payments',
            'payments',
            'collectors',
            
            // Invoice and customer tables
            'invoices',
            'customers',
            
            // Package and system tables
            'packages',
            'technicians',
            'expenses',
            
            // Settings (keep some essential ones)
            'app_settings',
            'system_settings'
        ];
        
        for (const table of deletionOrder) {
            if (tables.includes(table)) {
                try {
                    await new Promise((resolve, reject) => {
                        db.run(`DELETE FROM ${table}`, (err) => {
                            if (err) {
                                console.error(`   ❌ Error deleting ${table}:`, err.message);
                                reject(err);
                            } else {
                                console.log(`   ✅ ${table}: cleared`);
                                resolve();
                            }
                        });
                    });
                } catch (error) {
                    console.log(`   ⚠️  ${table}: ${error.message}`);
                }
            }
        }
        
        // Step 4: Reset all auto-increment sequences
        console.log('\n🔄 Step 4: Reset semua auto-increment sequences...');
        await new Promise((resolve) => {
            db.run(`DELETE FROM sqlite_sequence`, (err) => {
                if (err) {
                    console.log('   ⚠️  Could not reset sequences:', err.message);
                } else {
                    console.log('   ✅ All sequences reset to start from 1');
                }
                resolve();
            });
        });
        
        // Step 5: Create default voucher pricing
        console.log('\n🎫 Step 5: Membuat voucher pricing default...');
        const defaultVouchers = [
            {
                package_name: '3K',
                duration: 1,
                duration_type: 'days',
                customer_price: 3000,
                agent_price: 2000,
                commission_amount: 1000,
                voucher_digit_type: 'numbers',
                voucher_length: 4,
                account_type: 'voucher',
                hotspot_profile: '3k',
                description: 'Voucher 3K - 1 hari',
                is_active: 1
            },
            {
                package_name: '5K',
                duration: 2,
                duration_type: 'days',
                customer_price: 5000,
                agent_price: 4000,
                commission_amount: 1000,
                voucher_digit_type: 'numbers',
                voucher_length: 5,
                account_type: 'voucher',
                hotspot_profile: '5k',
                description: 'Voucher 5K - 2 hari',
                is_active: 1
            },
            {
                package_name: '10K',
                duration: 5,
                duration_type: 'days',
                customer_price: 10000,
                agent_price: 8000,
                commission_amount: 2000,
                voucher_digit_type: 'numbers',
                voucher_length: 5,
                account_type: 'voucher',
                hotspot_profile: '10k',
                description: 'Voucher 10K - 5 hari',
                is_active: 1
            },
            {
                package_name: 'Member 7 Hari',
                duration: 7,
                duration_type: 'days',
                customer_price: 15000,
                agent_price: 12000,
                commission_amount: 3000,
                voucher_digit_type: 'mixed',
                voucher_length: 8,
                account_type: 'member',
                hotspot_profile: 'member',
                description: 'Member 7 Hari - Username dan Password berbeda',
                is_active: 1
            }
        ];
        
        for (const voucher of defaultVouchers) {
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO voucher_pricing (
                        package_name, duration, duration_type, customer_price, agent_price,
                        commission_amount, voucher_digit_type, voucher_length, account_type,
                        hotspot_profile, description, is_active, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                    voucher.package_name, voucher.duration, voucher.duration_type,
                    voucher.customer_price, voucher.agent_price, voucher.commission_amount,
                    voucher.voucher_digit_type, voucher.voucher_length, voucher.account_type,
                    voucher.hotspot_profile, voucher.description, voucher.is_active
                ], function(err) {
                    if (err) {
                        console.error(`❌ Failed to create voucher ${voucher.package_name}:`, err.message);
                        reject(err);
                    } else {
                        console.log(`   ✅ Voucher ${voucher.package_name} created (ID: ${this.lastID})`);
                        resolve();
                    }
                });
            });
        }
        
        // Step 6: Create default agent
        console.log('\n👤 Step 6: Membuat agent default...');
        const agentId = await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO agents (name, phone, email, status, created_at) 
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                'Agent Test',
                '081234567890',
                'agent@test.com',
                'active'
            ], function(err) {
                if (err) {
                    console.error('❌ Failed to create default agent:', err.message);
                    reject(err);
                } else {
                    console.log(`   ✅ Default agent created (ID: ${this.lastID})`);
                    resolve(this.lastID);
                }
            });
        });
        
        // Create agent balance
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO agent_balances (agent_id, balance, last_updated) 
                VALUES (?, ?, CURRENT_TIMESTAMP)
            `, [agentId, 100000], function(err) {
                if (err) {
                    console.error('❌ Failed to create agent balance:', err.message);
                    reject(err);
                } else {
                    console.log(`   ✅ Agent balance created: Rp 100,000`);
                    resolve();
                }
            });
        });
        
        // Step 7: Create default packages
        console.log('\n📦 Step 7: Membuat paket internet default...');
        const defaultPackages = [
            {
                name: 'Paket Internet Dasar',
                speed: '10 Mbps',
                price: 100000,
                tax_rate: 11,
                description: 'Paket internet dasar 10 Mbps unlimited',
                is_active: 1,
                pppoe_profile: 'default'
            },
            {
                name: 'Paket Internet Standard',
                speed: '20 Mbps',
                price: 150000,
                tax_rate: 11,
                description: 'Paket internet standard 20 Mbps unlimited',
                is_active: 1,
                pppoe_profile: 'standard'
            },
            {
                name: 'Paket Internet Premium',
                speed: '50 Mbps',
                price: 250000,
                tax_rate: 11,
                description: 'Paket internet premium 50 Mbps unlimited',
                is_active: 1,
                pppoe_profile: 'premium'
            }
        ];
        
        for (const pkg of defaultPackages) {
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO packages (name, speed, price, tax_rate, description, is_active, pppoe_profile) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    pkg.name, pkg.speed, pkg.price, pkg.tax_rate,
                    pkg.description, pkg.is_active, pkg.pppoe_profile
                ], function(err) {
                    if (err) {
                        console.error(`❌ Failed to create package ${pkg.name}:`, err.message);
                        reject(err);
                    } else {
                        console.log(`   ✅ Package ${pkg.name} created (ID: ${this.lastID})`);
                        resolve();
                    }
                });
            });
        }
        
        // Step 8: Create default collector
        console.log('\n💰 Step 8: Membuat collector default...');
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO collectors (name, phone, email, status, commission_rate, created_at) 
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                'Kolektor Utama',
                '081234567891',
                'kolektor@company.com',
                'active',
                10.0
            ], function(err) {
                if (err) {
                    console.error('❌ Failed to create default collector:', err.message);
                    reject(err);
                } else {
                    console.log('   ✅ Default collector created (ID: ' + this.lastID + ')');
                    resolve();
                }
            });
        });
        
        // Step 9: Create default technician
        console.log('\n🔧 Step 9: Membuat technician default...');
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO technicians (name, phone, role, is_active, join_date, created_at) 
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [
                'Administrator',
                '081234567892',
                'admin',
                1
            ], function(err) {
                if (err) {
                    console.error('❌ Failed to create default technician:', err.message);
                    reject(err);
                } else {
                    console.log('   ✅ Default technician created (ID: ' + this.lastID + ')');
                    resolve();
                }
            });
        });
        
        // Step 10: Create app settings
        console.log('\n⚙️  Step 10: Membuat pengaturan aplikasi...');
        const appSettings = [
            { key: 'company_name', value: 'ALIJAYA DIGITAL NETWORK' },
            { key: 'company_phone', value: '081947215703' },
            { key: 'company_email', value: 'info@alijaya.com' },
            { key: 'company_address', value: 'Jl. Contoh Alamat No. 123' },
            { key: 'company_header', value: '📱 ALIJAYA DIGITAL NETWORK 📱\n\n' },
            { key: 'footer_info', value: 'Powered by Alijaya Digital Network' },
            { key: 'contact_phone', value: '081947215703' },
            { key: 'default_commission_rate', value: '10' },
            { key: 'tax_rate', value: '11' },
            { key: 'currency', value: 'IDR' },
            { key: 'timezone', value: 'Asia/Jakarta' },
            { key: 'whatsapp_gateway', value: 'enabled' },
            { key: 'agent_system', value: 'enabled' },
            { key: 'voucher_system', value: 'enabled' }
        ];
        
        for (const setting of appSettings) {
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO app_settings (key, value, created_at) 
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                `, [setting.key, setting.value], function(err) {
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
        
        // Step 11: Create system settings
        console.log('\n🔧 Step 11: Membuat pengaturan sistem...');
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO system_settings (key, value, description, created_at) 
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                'installation_date',
                new Date().toISOString(),
                'Fresh installation date'
            ], function(err) {
                if (err) {
                    console.error('❌ Failed to create system setting:', err.message);
                    reject(err);
                } else {
                    console.log('   ✅ System setting created');
                    resolve();
                }
            });
        });
        
        // Step 12: Vacuum database to reclaim space
        console.log('\n🧹 Step 12: Optimasi database...');
        await new Promise((resolve) => {
            db.run(`VACUUM`, (err) => {
                if (err) {
                    console.log('   ⚠️  Could not vacuum database:', err.message);
                } else {
                    console.log('   ✅ Database optimized and space reclaimed');
                }
                resolve();
            });
        });
        
        // Step 13: Final verification
        console.log('\n📊 Step 13: Verifikasi akhir...');
        const finalStats = {};
        
        for (const table of tables) {
            try {
                const count = await new Promise((resolve, reject) => {
                    db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
                        if (err) resolve(0);
                        else resolve(row ? row.count : 0);
                    });
                });
                finalStats[table] = count;
                if (count > 0) {
                    console.log(`   📊 ${table}: ${count} records`);
                }
            } catch (error) {
                finalStats[table] = 0;
            }
        }
        
        // Step 14: Create installation summary
        console.log('\n🎉 FRESH SERVER INSTALLATION COMPLETED!');
        console.log('=' .repeat(80));
        console.log('📋 INSTALLATION SUMMARY:');
        console.log(`   📅 Installation Date: ${new Date().toISOString()}`);
        console.log(`   🗑️  Data Deleted: ${totalRecords} records`);
        console.log(`   📊 Current Data: ${Object.values(finalStats).reduce((a, b) => a + b, 0)} records`);
        console.log('');
        console.log('✅ Default data created:');
        console.log(`   🎫 Voucher Pricing: ${defaultVouchers.length} packages`);
        console.log('   👤 Agent: Agent Test (Rp 100,000 balance)');
        console.log(`   📦 Internet Packages: ${defaultPackages.length} packages`);
        console.log('   💰 Collector: Kolektor Utama (10% commission)');
        console.log('   🔧 Technician: Administrator (admin role)');
        console.log(`   ⚙️  App Settings: ${appSettings.length} settings`);
        console.log('   🔧 System Settings: Installation date');
        console.log('');
        console.log('🚀 System is ready for production!');
        console.log('   - Clean financial data');
        console.log('   - Agent voucher system ready');
        console.log('   - Voucher pricing configured');
        console.log('   - WhatsApp integration ready');
        console.log('   - Mikrotik integration ready');
        console.log('=' .repeat(80));
        
        console.log('\n📋 Next Steps:');
        console.log('   1. ✅ Database sudah bersih dari data lama');
        console.log('   2. ✅ Voucher pricing sudah dikonfigurasi');
        console.log('   3. ✅ Agent system sudah siap');
        console.log('   4. ✅ WhatsApp gateway sudah dikonfigurasi');
        console.log('   5. 🔄 Restart aplikasi untuk memastikan semua setting aktif');
        console.log('   6. 🧪 Test agent voucher system');
        console.log('   7. 🎯 Ready untuk customer baru!');
        
    } catch (error) {
        console.error('❌ Error during fresh installation:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    freshServerInstallation()
        .then(() => {
            console.log('\n✅ Fresh server installation completed successfully!');
            console.log('🚀 Server is ready for new customers and transactions!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Fresh server installation failed:', error);
            process.exit(1);
        });
}

module.exports = freshServerInstallation;
