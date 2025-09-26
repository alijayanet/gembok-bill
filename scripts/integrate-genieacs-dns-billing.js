#!/usr/bin/env node

/**
 * Script untuk mengintegrasikan konfigurasi DNS GenieACS dengan sistem billing
 * Otomatis mengatur DNS server pada ONU saat customer baru dibuat atau diaktifkan
 */

const billingManager = require('../config/billing');
const genieacs = require('../config/genieacs');
const { GenieACSDNSConfig } = require('./genieacs-dns-config');
const logger = require('../config/logger');

class GenieACSDNSBillingIntegration {
    constructor() {
        this.dnsConfig = new GenieACSDNSConfig();
    }

    // Fungsi untuk mengatur DNS server saat customer baru dibuat
    async configureDNSForNewCustomer(customerId) {
        try {
            console.log(`🔧 Mengatur DNS server untuk customer baru: ${customerId}`);
            
            // Ambil data customer
            const customer = await billingManager.getCustomerById(customerId);
            if (!customer) {
                throw new Error(`Customer dengan ID ${customerId} tidak ditemukan`);
            }

            // Cek apakah customer memiliki PPPoE username
            if (!customer.pppoe_username) {
                console.log(`⚠️  Customer ${customer.name} tidak memiliki PPPoE username, skip DNS configuration`);
                return { success: false, message: 'Customer tidak memiliki PPPoE username' };
            }

            // Cari device berdasarkan PPPoE username
            const device = await genieacs.findDeviceByPPPoE(customer.pppoe_username);
            if (!device) {
                console.log(`⚠️  Device dengan PPPoE username ${customer.pppoe_username} tidak ditemukan di GenieACS`);
                return { success: false, message: 'Device tidak ditemukan di GenieACS' };
            }

            // Konfigurasi DNS server
            const result = await this.dnsConfig.configureDNSServer(device._id);
            
            if (result.success) {
                console.log(`✅ DNS server berhasil dikonfigurasi untuk customer ${customer.name} (${customer.pppoe_username})`);
                
                // Log ke database billing
                await this.logDNSConfiguration(customerId, device._id, 'success', 'DNS server dikonfigurasi untuk customer baru');
                
                return {
                    success: true,
                    customerId,
                    deviceId: device._id,
                    pppoeUsername: customer.pppoe_username,
                    message: 'DNS server berhasil dikonfigurasi'
                };
            } else {
                console.error(`❌ DNS server gagal dikonfigurasi untuk customer ${customer.name}: ${result.error}`);
                
                // Log error ke database billing
                await this.logDNSConfiguration(customerId, device._id, 'error', result.error);
                
                return {
                    success: false,
                    customerId,
                    deviceId: device._id,
                    error: result.error
                };
            }

        } catch (error) {
            console.error(`❌ Error mengatur DNS untuk customer ${customerId}:`, error);
            return {
                success: false,
                customerId,
                error: error.message
            };
        }
    }

    // Fungsi untuk mengatur DNS server saat customer diaktifkan
    async configureDNSForActivatedCustomer(customerId) {
        try {
            console.log(`🔧 Mengatur DNS server untuk customer yang diaktifkan: ${customerId}`);
            
            // Ambil data customer
            const customer = await billingManager.getCustomerById(customerId);
            if (!customer) {
                throw new Error(`Customer dengan ID ${customerId} tidak ditemukan`);
            }

            // Cek status customer
            if (customer.status !== 'active') {
                console.log(`⚠️  Customer ${customer.name} status bukan 'active', skip DNS configuration`);
                return { success: false, message: 'Customer status bukan active' };
            }

            // Cek apakah customer memiliki PPPoE username
            if (!customer.pppoe_username) {
                console.log(`⚠️  Customer ${customer.name} tidak memiliki PPPoE username, skip DNS configuration`);
                return { success: false, message: 'Customer tidak memiliki PPPoE username' };
            }

            // Cari device berdasarkan PPPoE username
            const device = await genieacs.findDeviceByPPPoE(customer.pppoe_username);
            if (!device) {
                console.log(`⚠️  Device dengan PPPoE username ${customer.pppoe_username} tidak ditemukan di GenieACS`);
                return { success: false, message: 'Device tidak ditemukan di GenieACS' };
            }

            // Konfigurasi DNS server
            const result = await this.dnsConfig.configureDNSServer(device._id);
            
            if (result.success) {
                console.log(`✅ DNS server berhasil dikonfigurasi untuk customer yang diaktifkan ${customer.name} (${customer.pppoe_username})`);
                
                // Log ke database billing
                await this.logDNSConfiguration(customerId, device._id, 'success', 'DNS server dikonfigurasi untuk customer yang diaktifkan');
                
                return {
                    success: true,
                    customerId,
                    deviceId: device._id,
                    pppoeUsername: customer.pppoe_username,
                    message: 'DNS server berhasil dikonfigurasi'
                };
            } else {
                console.error(`❌ DNS server gagal dikonfigurasi untuk customer ${customer.name}: ${result.error}`);
                
                // Log error ke database billing
                await this.logDNSConfiguration(customerId, device._id, 'error', result.error);
                
                return {
                    success: false,
                    customerId,
                    deviceId: device._id,
                    error: result.error
                };
            }

        } catch (error) {
            console.error(`❌ Error mengatur DNS untuk customer yang diaktifkan ${customerId}:`, error);
            return {
                success: false,
                customerId,
                error: error.message
            };
        }
    }

    // Fungsi untuk mengatur DNS server untuk semua customer aktif
    async configureDNSForAllActiveCustomers() {
        try {
            console.log('🚀 MENGATUR DNS SERVER UNTUK SEMUA CUSTOMER AKTIF');
            console.log('=' .repeat(60));

            // Ambil semua customer aktif
            const customers = await billingManager.getAllCustomers();
            const activeCustomers = customers.filter(customer => 
                customer.status === 'active' && customer.pppoe_username
            );

            console.log(`📋 Ditemukan ${activeCustomers.length} customer aktif dengan PPPoE username`);

            if (activeCustomers.length === 0) {
                console.log('⚠️  Tidak ada customer aktif yang memiliki PPPoE username');
                return { success: false, message: 'Tidak ada customer aktif yang memiliki PPPoE username' };
            }

            // Konfirmasi
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            const answer = await new Promise((resolve) => {
                rl.question(`Apakah Anda yakin ingin mengatur DNS server untuk ${activeCustomers.length} customer aktif? (y/N): `, (input) => {
                    rl.close();
                    resolve(input.toLowerCase());
                });
            });

            if (answer !== 'y' && answer !== 'yes') {
                console.log('❌ Konfigurasi dibatalkan');
                return { success: false, message: 'Konfigurasi dibatalkan' };
            }

            // Proses setiap customer
            const results = [];
            let successCount = 0;
            let errorCount = 0;

            for (const customer of activeCustomers) {
                try {
                    console.log(`\n📝 Memproses customer: ${customer.name} (${customer.pppoe_username})`);
                    
                    const result = await this.configureDNSForActivatedCustomer(customer.id);
                    results.push(result);
                    
                    if (result.success) {
                        successCount++;
                    } else {
                        errorCount++;
                    }
                    
                    // Delay antar customer
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                } catch (error) {
                    console.error(`❌ Error memproses customer ${customer.name}:`, error.message);
                    errorCount++;
                    results.push({
                        success: false,
                        customerId: customer.id,
                        error: error.message
                    });
                }
            }

            // Hasil akhir
            console.log('\n📊 HASIL KONFIGURASI DNS:');
            console.log('=' .repeat(40));
            console.log(`✅ Customer berhasil dikonfigurasi: ${successCount}`);
            console.log(`❌ Customer gagal dikonfigurasi: ${errorCount}`);
            console.log(`📋 Total customer diproses: ${activeCustomers.length}`);

            return {
                success: true,
                totalCustomers: activeCustomers.length,
                successCount,
                errorCount,
                results
            };

        } catch (error) {
            console.error('❌ Error dalam konfigurasi DNS untuk semua customer:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Fungsi untuk log konfigurasi DNS ke database
    async logDNSConfiguration(customerId, deviceId, status, message) {
        try {
            const sqlite3 = require('sqlite3').verbose();
            const db = new sqlite3.Database('./data/billing.db');

            return new Promise((resolve, reject) => {
                const sql = `
                    INSERT INTO dns_configuration_log 
                    (customer_id, device_id, status, message, created_at)
                    VALUES (?, ?, ?, ?, datetime('now'))
                `;

                db.run(sql, [customerId, deviceId, status, message], function(err) {
                    if (err) {
                        console.error('Error logging DNS configuration:', err);
                        reject(err);
                    } else {
                        console.log(`📝 DNS configuration logged: ${status} for customer ${customerId}`);
                        resolve(this.lastID);
                    }
                    db.close();
                });
            });
        } catch (error) {
            console.error('Error logging DNS configuration:', error);
            // Jangan throw error, karena ini hanya logging
        }
    }

    // Fungsi untuk membuat tabel log jika belum ada
    async createDNSLogTable() {
        try {
            const sqlite3 = require('sqlite3').verbose();
            const db = new sqlite3.Database('./data/billing.db');

            return new Promise((resolve, reject) => {
                const sql = `
                    CREATE TABLE IF NOT EXISTS dns_configuration_log (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        customer_id INTEGER NOT NULL,
                        device_id TEXT NOT NULL,
                        status TEXT NOT NULL,
                        message TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (customer_id) REFERENCES customers (id)
                    )
                `;

                db.run(sql, (err) => {
                    if (err) {
                        console.error('Error creating DNS log table:', err);
                        reject(err);
                    } else {
                        console.log('✅ DNS configuration log table created/verified');
                        resolve();
                    }
                    db.close();
                });
            });
        } catch (error) {
            console.error('Error creating DNS log table:', error);
            throw error;
        }
    }

    // Fungsi untuk mendapatkan log konfigurasi DNS
    async getDNSConfigurationLog(customerId = null, limit = 50) {
        try {
            const sqlite3 = require('sqlite3').verbose();
            const db = new sqlite3.Database('./data/billing.db');

            return new Promise((resolve, reject) => {
                let sql = `
                    SELECT dcl.*, c.name as customer_name, c.pppoe_username
                    FROM dns_configuration_log dcl
                    LEFT JOIN customers c ON dcl.customer_id = c.id
                `;
                
                const params = [];
                
                if (customerId) {
                    sql += ' WHERE dcl.customer_id = ?';
                    params.push(customerId);
                }
                
                sql += ' ORDER BY dcl.created_at DESC LIMIT ?';
                params.push(limit);

                db.all(sql, params, (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows || []);
                    }
                    db.close();
                });
            });
        } catch (error) {
            console.error('Error getting DNS configuration log:', error);
            throw error;
        }
    }
}

// Fungsi utama untuk menjalankan script
async function main() {
    const integration = new GenieACSDNSBillingIntegration();
    
    try {
        console.log('🚀 GENIEACS DNS BILLING INTEGRATION');
        console.log('=' .repeat(50));

        // Buat tabel log jika belum ada
        await integration.createDNSLogTable();

        // Pilihan menu
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('📋 Pilihan:');
        console.log('1. Konfigurasi DNS untuk customer baru');
        console.log('2. Konfigurasi DNS untuk customer yang diaktifkan');
        console.log('3. Konfigurasi DNS untuk semua customer aktif');
        console.log('4. Lihat log konfigurasi DNS');
        console.log('5. Keluar');

        const choice = await new Promise((resolve) => {
            rl.question('\nPilih opsi (1-5): ', (input) => {
                rl.close();
                resolve(input.trim());
            });
        });

        switch (choice) {
            case '1':
                const customerId = await new Promise((resolve) => {
                    const rl2 = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout
                    });
                    rl2.question('Masukkan Customer ID: ', (input) => {
                        rl2.close();
                        resolve(parseInt(input.trim()));
                    });
                });
                await integration.configureDNSForNewCustomer(customerId);
                break;
            case '2':
                const activatedCustomerId = await new Promise((resolve) => {
                    const rl3 = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout
                    });
                    rl3.question('Masukkan Customer ID: ', (input) => {
                        rl3.close();
                        resolve(parseInt(input.trim()));
                    });
                });
                await integration.configureDNSForActivatedCustomer(activatedCustomerId);
                break;
            case '3':
                await integration.configureDNSForAllActiveCustomers();
                break;
            case '4':
                const logs = await integration.getDNSConfigurationLog();
                console.log('\n📋 Log Konfigurasi DNS:');
                logs.forEach((log, index) => {
                    console.log(`${index + 1}. Customer: ${log.customer_name} (${log.pppoe_username})`);
                    console.log(`   Device: ${log.device_id}`);
                    console.log(`   Status: ${log.status}`);
                    console.log(`   Message: ${log.message}`);
                    console.log(`   Created: ${log.created_at}`);
                    console.log('');
                });
                break;
            case '5':
                console.log('👋 Keluar dari script');
                return;
            default:
                console.log('❌ Pilihan tidak valid');
                return;
        }

    } catch (error) {
        console.error('❌ Error dalam script:', error);
    }
}

// Run if called directly
if (require.main === module) {
    main()
        .then(() => {
            console.log('\n✅ Script selesai dijalankan!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Script gagal:', error);
            process.exit(1);
        });
}

module.exports = { GenieACSDNSBillingIntegration };
