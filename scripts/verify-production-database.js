#!/usr/bin/env node

/**
 * Script verifikasi database untuk produksi
 * Memastikan semua tabel yang dibutuhkan ada dalam database
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Path to the billing database
const dbPath = path.join(__dirname, '../data/billing.db');

// Tabel-tabel yang wajib ada di produksi
const requiredTables = [
    'invoices',
    'customers',
    'packages',
    'payments',
    'payment_gateway_transactions',
    'odps',
    'cable_routes',
    'technicians',
    'trouble_reports'  // Tabel yang baru ditambahkan
];

// Kolom-kolom yang wajib ada di tabel tertentu
const requiredColumns = {
    invoices: [
        'id', 'customer_id', 'package_id', 'invoice_number', 'amount',
        'base_amount', 'tax_rate', 'due_date', 'status', 'payment_date',
        'payment_method', 'payment_gateway', 'payment_token', 'payment_url',
        'payment_status', 'notes', 'created_at', 'description', 'invoice_type', 'package_name'
    ],
    customers: [
        'id', 'name', 'username', 'phone', 'pppoe_username', 'email', 'address',
        'latitude', 'longitude', 'package_id', 'odp_id', 'pppoe_profile',
        'status', 'auto_suspension', 'billing_day', 'whatsapp_lid'
    ],
    packages: [
        'id', 'name', 'price', 'tax_rate', 'description', 'speed',
        'status', 'created_at', 'pppoe_profile'
    ]
};

// Fungsi untuk memverifikasi keberadaan tabel
function verifyTablesExist(db) {
    return new Promise((resolve, reject) => {
        console.log('🔍 Memverifikasi keberadaan tabel yang dibutuhkan...');

        const missingTables = [];
        let completed = 0;

        requiredTables.forEach(tableName => {
            db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [tableName], (err, row) => {
                if (err) {
                    console.error(`❌ Error memeriksa tabel ${tableName}:`, err.message);
                    missingTables.push(tableName);
                } else if (!row) {
                    console.error(`❌ Tabel ${tableName} tidak ditemukan`);
                    missingTables.push(tableName);
                } else {
                    console.log(`✅ Tabel ${tableName} ditemukan`);
                }

                completed++;
                if (completed === requiredTables.length) {
                    if (missingTables.length > 0) {
                        reject(new Error(`Tabel yang hilang: ${missingTables.join(', ')}`));
                    } else {
                        resolve();
                    }
                }
            });
        });
    });
}

// Fungsi untuk memverifikasi kolom dalam tabel
function verifyTableColumns(db, tableName, requiredCols) {
    return new Promise((resolve, reject) => {
        console.log(`\n🔍 Memverifikasi kolom dalam tabel ${tableName}...`);

        db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
            if (err) {
                reject(new Error(`Error memeriksa kolom tabel ${tableName}: ${err.message}`));
                return;
            }

            const existingColumns = columns.map(col => col.name);
            const missingColumns = requiredCols.filter(col => !existingColumns.includes(col));

            if (missingColumns.length > 0) {
                console.error(`❌ Kolom yang hilang dalam tabel ${tableName}: ${missingColumns.join(', ')}`);
                reject(new Error(`Kolom yang hilang dalam tabel ${tableName}: ${missingColumns.join(', ')}`));
            } else {
                console.log(`✅ Semua kolom dalam tabel ${tableName} lengkap`);
                resolve();
            }
        });
    });
}

// Fungsi utama verifikasi
async function verifyProductionDatabase() {
    let db;

    try {
        console.log('🚀 Memulai verifikasi database produksi...');

        // Membuka koneksi database
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                throw new Error(`Error membuka database: ${err.message}`);
            }
            console.log('✅ Terhubung ke database billing');
        });

        // Memverifikasi tabel-tabel
        await verifyTablesExist(db);

        // Memverifikasi kolom-kolom penting
        for (const [tableName, columns] of Object.entries(requiredColumns)) {
            await verifyTableColumns(db, tableName, columns);
        }

        console.log('\n🎉 Verifikasi database produksi berhasil!');
        console.log('✅ Semua tabel yang dibutuhkan ada');
        console.log('✅ Semua kolom yang dibutuhkan ada');
        console.log('✅ Database siap untuk produksi');

        return true;

    } catch (error) {
        console.error('\n💥 Verifikasi database produksi gagal!');
        console.error('❌ Error:', error.message);
        return false;

    } finally {
        // Menutup koneksi database
        if (db) {
            db.close((err) => {
                if (err) {
                    console.error('❌ Error menutup database:', err.message);
                } else {
                    console.log('🔒 Koneksi database ditutup');
                }
            });
        }
    }
}

// Menjalankan verifikasi jika script dijalankan langsung
if (require.main === module) {
    verifyProductionDatabase()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('Error tidak terduga:', error.message);
            process.exit(1);
        });
}

module.exports = { verifyProductionDatabase };