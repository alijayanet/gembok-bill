#!/usr/bin/env node

/**
 * Script untuk mempersiapkan project untuk diunggah ke GitHub
 * Menghapus data sensitif dan mengganti dengan data dummy
 */

const fs = require('fs');
const path = require('path');

// Fungsi untuk menghapus file sensitif
function removeSensitiveFiles() {
    const sensitiveFiles = [
        'config/superadmin.txt',
        'data/billing.db',
        'data/billing.db-shm',
        'data/billing.db-wal',
        'data/billing.db.backup'
    ];
    
    console.log('🗑️  Menghapus file sensitif...');
    
    sensitiveFiles.forEach(file => {
        const filePath = path.join(__dirname, '..', file);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log(`  ✅ Dihapus: ${file}`);
            } catch (error) {
                console.log(`  ⚠️  Gagal menghapus: ${file} - ${error.message}`);
            }
        } else {
            console.log(`  ℹ️  Tidak ditemukan: ${file}`);
        }
    });
}

// Fungsi untuk membuat file konfigurasi dummy
function createDummyConfigFiles() {
    console.log('\n📝 Membuat file konfigurasi dummy...');
    
    // Membuat superadmin.txt kosong
    const superadminPath = path.join(__dirname, '..', 'config', 'superadmin.txt');
    try {
        fs.writeFileSync(superadminPath, '');
        console.log('  ✅ Dibuat: config/superadmin.txt (kosong)');
    } catch (error) {
        console.log(`  ⚠️  Gagal membuat superadmin.txt: ${error.message}`);
    }
    
    // Membuat .env.example
    const envExamplePath = path.join(__dirname, '..', '.env.example');
    const envExampleContent = `# Contoh file konfigurasi environment
# Salin file ini ke .env dan sesuaikan nilainya

# Database
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=gembok_bill

# WhatsApp
WHATSAPP_SESSION_PATH=./whatsapp-session
ADMIN_NUMBER=6281234567890

# Mikrotik
MIKROTIK_HOST=192.168.1.1
MIKROTIK_USER=admin
MIKROTIK_PASSWORD=password

# GenieACS
GENIEACS_URL=http://localhost:7557
GENIEACS_USERNAME=admin
GENIEACS_PASSWORD=password

# Payment Gateway
MIDTRANS_SERVER_KEY=your_midtrans_server_key
MIDTRANS_CLIENT_KEY=your_midtrans_client_key

# Xendit
XENDIT_SECRET_KEY=your_xendit_secret_key

# Application
PORT=3000
NODE_ENV=development
SECRET_KEY=your_secret_key_here
`;
    
    try {
        fs.writeFileSync(envExamplePath, envExampleContent);
        console.log('  ✅ Dibuat: .env.example');
    } catch (error) {
        console.log(`  ⚠️  Gagal membuat .env.example: ${error.message}`);
    }
}

// Fungsi untuk membersihkan file konfigurasi
function cleanConfigFiles() {
    console.log('\n🧼 Membersihkan file konfigurasi...');
    
    // File konfigurasi yang mungkin mengandung data sensitif
    const configFiles = [
        'config/settingsManager.js'
    ];
    
    // Untuk saat ini, kita hanya memberi peringatan
    // Karena file ini mungkin mengandung logika penting yang tidak boleh diubah
    configFiles.forEach(file => {
        console.log(`  ℹ️  Periksa dan pastikan tidak ada data sensitif di: ${file}`);
    });
}

// Fungsi untuk membuat database kosong
function createEmptyDatabase() {
    console.log('\n💾 Membuat database kosong...');
    
    // Membuat file database kosong untuk referensi
    const emptyDbPath = path.join(__dirname, '..', 'data', 'empty-database.sql');
    const emptyDbContent = `-- Database schema kosong untuk Gembok Bill
-- Gunakan file migrasi di folder migrations/ untuk membuat struktur database
    
-- Contoh struktur tabel dasar (lihat file migrations/ untuk detail lengkap)
-- CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password TEXT);
-- CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT);
-- CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer_id INTEGER, amount REAL, status TEXT);
`;
    
    try {
        fs.writeFileSync(emptyDbPath, emptyDbContent);
        console.log('  ✅ Dibuat: data/empty-database.sql');
    } catch (error) {
        console.log(`  ⚠️  Gagal membuat empty-database.sql: ${error.message}`);
    }
}

// Fungsi untuk membuat README untuk data
function createDataReadme() {
    console.log('\n📄 Membuat dokumentasi data...');
    
    const readmePath = path.join(__dirname, '..', 'DATA_README.md');
    const readmeContent = `# Data Management untuk Gembok Bill

## Struktur Database

Database menggunakan SQLite dan struktur tabel didefinisikan dalam file migrasi di folder [\`migrations/\`](file:///e:/gembok-bill211025/migrations).

## Inisialisasi Data Awal

Untuk server baru, jalankan perintah berikut:

\`\`\`bash
npm run setup
\`\`\`

Ini akan:
1. Menginstal semua dependensi
2. Menjalankan semua file migrasi untuk membuat struktur database
3. Membuat data awal yang diperlukan

## File Migrasi

Semua file migrasi berada di folder [\`migrations/\`](file:///e:/gembok-bill211025/migrations) dan dijalankan secara berurutan berdasarkan nama file.

## Konfigurasi Environment

Salin file [.env.example](file:///e:/gembok-bill211025/.env.example) ke .env dan sesuaikan nilainya:

\`\`\`bash
cp .env.example .env
\`\`\`

Kemudian edit file .env dengan konfigurasi yang sesuai untuk lingkungan Anda.

## Keamanan

- Jangan pernah menyertakan file .env atau data sensitif lainnya di repository
- Gunakan .env.example sebagai template untuk konfigurasi
- Pastikan file config/superadmin.txt hanya berisi nomor yang sesuai
`;

    try {
        fs.writeFileSync(readmePath, readmeContent);
        console.log('  ✅ Dibuat: DATA_README.md');
    } catch (error) {
        console.log(`  ⚠️  Gagal membuat DATA_README.md: ${error.message}`);
    }
}

// Fungsi utama
async function main() {
    console.log('🚀 Memulai persiapan project untuk GitHub...\n');
    
    try {
        removeSensitiveFiles();
        createDummyConfigFiles();
        cleanConfigFiles();
        createEmptyDatabase();
        createDataReadme();
        
        console.log('\n✅ Persiapan selesai!');
        console.log('\n📋 Langkah selanjutnya:');
        console.log('1. Periksa file yang dihasilkan');
        console.log('2. Pastikan tidak ada data sensitif yang tersisa');
        console.log('3. Commit dan push ke GitHub');
        console.log('4. Untuk server baru, gunakan "npm run setup" untuk inisialisasi');
    } catch (error) {
        console.error('\n❌ Terjadi kesalahan:', error.message);
        process.exit(1);
    }
}

// Jalankan script
if (require.main === module) {
    main();
}

module.exports = {
    removeSensitiveFiles,
    createDummyConfigFiles,
    cleanConfigFiles,
    createEmptyDatabase,
    createDataReadme
};