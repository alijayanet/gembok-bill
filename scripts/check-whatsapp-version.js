const fs = require('fs');
const path = require('path');

// Fungsi untuk memeriksa versi WhatsApp Web yang kompatibel
async function checkWhatsAppVersion() {
    try {
        console.log('Memeriksa versi WhatsApp Web yang kompatibel...');
        
        // Versi Baileys yang digunakan
        const baileysPkg = require('../package.json');
        const baileysVersion = baileysPkg.dependencies['@whiskeysockets/baileys'];
        console.log(`Versi Baileys yang diinstal: ${baileysVersion}`);
        
        // Cek apakah direktori node_modules ada
        const nodeModulesPath = path.join(__dirname, '../node_modules/@whiskeysockets/baileys');
        if (fs.existsSync(nodeModulesPath)) {
            console.log('Direktori Baileys ditemukan');
            
            // Cek versi package.json di node_modules
            try {
                const installedPkg = require('../node_modules/@whiskeysockets/baileys/package.json');
                console.log(`Versi Baileys yang terinstal: ${installedPkg.version}`);
            } catch (pkgError) {
                console.log('Tidak dapat membaca package.json dari node_modules');
            }
            
            // Cek versi WhatsApp Web
            try {
                const versionFilePath = path.join(__dirname, '../node_modules/@whiskeysockets/baileys/lib/Defaults/baileys-version.json');
                if (fs.existsSync(versionFilePath)) {
                    const versionData = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
                    console.log('Versi WhatsApp Web saat ini:', versionData);
                } else {
                    console.log('File versi tidak ditemukan, menggunakan versi default');
                }
            } catch (versionError) {
                console.log('Tidak dapat membaca versi WhatsApp Web:', versionError.message);
            }
        } else {
            console.log('Direktori node_modules/@whiskeysockets/baileys tidak ditemukan');
        }
        
        console.log('✅ Pemeriksaan versi WhatsApp selesai');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error saat memeriksa versi WhatsApp:', error.message);
        process.exit(1);
    }
}

// Jalankan pemeriksaan
checkWhatsAppVersion();