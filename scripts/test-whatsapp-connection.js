const fs = require('fs');
const path = require('path');

// Fungsi untuk menguji koneksi WhatsApp
async function testWhatsAppConnection() {
    try {
        console.log('Menguji koneksi WhatsApp...');
        
        // Cek apakah file konfigurasi WhatsApp ada
        const whatsappConfigPath = path.join(__dirname, '../config/whatsapp.js');
        if (fs.existsSync(whatsappConfigPath)) {
            console.log('✅ File konfigurasi WhatsApp ditemukan');
        } else {
            console.log('❌ File konfigurasi WhatsApp tidak ditemukan');
            process.exit(1);
        }
        
        // Cek apakah direktori sesi WhatsApp ada
        const sessionDir = path.join(__dirname, '../whatsapp-session');
        if (fs.existsSync(sessionDir)) {
            console.log('✅ Direktori sesi WhatsApp ditemukan');
            
            // Cek isi direktori sesi
            const sessionFiles = fs.readdirSync(sessionDir);
            console.log(`📁 File sesi yang tersedia: ${sessionFiles.length} file`);
            
            if (sessionFiles.length > 0) {
                console.log('📝 File sesi yang ditemukan:');
                sessionFiles.forEach(file => {
                    console.log(`  - ${file}`);
                });
            }
        } else {
            console.log('⚠️ Direktori sesi WhatsApp tidak ditemukan (akan dibuat saat koneksi)');
        }
        
        // Cek versi Baileys
        try {
            const baileysPkg = require('../package.json');
            const baileysVersion = baileysPkg.dependencies['@whiskeysockets/baileys'];
            console.log(`📱 Versi Baileys yang digunakan: ${baileysVersion}`);
        } catch (versionError) {
            console.log('⚠️ Tidak dapat memeriksa versi Baileys:', versionError.message);
        }
        
        // Cek apakah node_modules @whiskeysockets/baileys ada
        const baileysNodeModulesPath = path.join(__dirname, '../node_modules/@whiskeysockets/baileys');
        if (fs.existsSync(baileysNodeModulesPath)) {
            console.log('✅ Library @whiskeysockets/baileys ditemukan di node_modules');
        } else {
            console.log('❌ Library @whiskeysockets/baileys tidak ditemukan di node_modules');
            console.log('💡 Jalankan "npm install" untuk menginstal dependensi');
            process.exit(1);
        }
        
        console.log('\n✅ Pengujian koneksi WhatsApp selesai');
        console.log('\n💡 Untuk menghubungkan WhatsApp:');
        console.log('1. Jalankan aplikasi dengan "npm start"');
        console.log('2. Tunggu QR code muncul di terminal');
        console.log('3. Scan QR code dengan WhatsApp Anda');
        console.log('4. Pastikan koneksi internet stabil');
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error saat menguji koneksi WhatsApp:', error.message);
        process.exit(1);
    }
}

// Jalankan pengujian
testWhatsAppConnection();