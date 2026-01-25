/**
 * Script untuk membersihkan seluruh data transaksi dan log (Clean Install/Reset)
 * Namun tetap mempertahankan data Master (Paket Billing & Data Pelanggan)
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const dbPath = path.join(__dirname, '../data/billing.db');

if (!fs.existsSync(dbPath)) {
    console.error('❌ Database billing.db tidak ditemukan di:', dbPath);
    process.exit(1);
}

const db = new sqlite3.Database(dbPath);

const tablesToReset = [
    'invoices',
    'payments',
    'payment_gateway_transactions',
    'expenses',
    'collector_payments',
    'collectors',
    'technicians',
    'customers',
    'packages',
    'odps',
    'cable_routes',
    'network_segments',
    'odp_connections',
    'cable_maintenance_logs',
    'app_settings',
    'system_settings'
];

console.log('🧹 Memulai proses pembersihan TOTAL seluruh data...');
console.log('⚠️ PERINGATAN: SEMUA data akan dihapus (Invoice, Pelanggan, Paket, Tagihan, Kolektor)!');

db.serialize(() => {
    // Nonaktifkan foreign keys sementara agar bisa delete massal
    db.run('PRAGMA foreign_keys = OFF');

    let completed = 0;
    tablesToReset.forEach(table => {
        db.run(`DELETE FROM ${table}`, function (err) {
            if (err) {
                if (err.message.includes('no such table')) {
                    // console.log(`- Table ${table} belum ada, dilewati.`);
                } else {
                    console.error(`❌ Gagal menghapus tabel ${table}:`, err.message);
                }
            } else {
                console.log(`✅ Tabel ${table} berhasil dikosongkan.`);
                // Reset auto-increment counter
                db.run(`UPDATE sqlite_sequence SET seq = 0 WHERE name = '${table}'`);
            }

            completed++;
            if (completed === tablesToReset.length) {
                finish();
            }
        });
    });

    function finish() {
        db.run('PRAGMA foreign_keys = ON', () => {
            console.log('\n✨ PEMBERSIHAN SELESAI!');
            console.log('Sistem sekarang dalam keadaan bersih namun data Pelanggan & Paket tetap utuh.');
            console.log('Silakan restart aplikasi.');
            db.close();
        });
    }
});
