const { Boom } = require('@hapi/boom');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const logger = require('./logger');

// Import modul-modul yang sudah dibuat
const WhatsAppCore = require('./whatsapp-core');
const WhatsAppCommands = require('./whatsapp-commands');
const WhatsAppMessageHandlers = require('./whatsapp-message-handlers');

// Import modul-modul lain yang diperlukan
const genieacsCommands = require('./genieacs-commands');
const mikrotikCommands = require('./mikrotik-commands');
const pppoeCommands = require('./pppoe-commands');
const { handleAddWAN } = require('./addWAN');
const { addCustomerTag, addTagByPPPoE } = require('./customerTag');
const billingCommands = require('./billing-commands');
const whatsappNotifications = require('./whatsapp-notifications');
const { getSetting } = require('./settingsManager');

// Inisialisasi modul-modul
const whatsappCore = new WhatsAppCore();
const whatsappCommands = new WhatsAppCommands(whatsappCore);
const messageHandlers = new WhatsAppMessageHandlers(whatsappCore, whatsappCommands);

// Variabel global untuk status WhatsApp
global.whatsappStatus = whatsappCore.getWhatsAppStatus();

// Fungsi untuk koneksi WhatsApp
async function connectToWhatsApp() {
    try {
        console.log('Memulai koneksi WhatsApp...');
        
        // Buat direktori session
        const sessionDir = getSetting('whatsapp_session_path', './whatsapp-session');
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
            console.log(`Direktori sesi WhatsApp dibuat: ${sessionDir}`);
        }
        
        // Load auth state
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        // Konfigurasi logging
        const logLevel = getSetting('whatsapp_log_level', 'silent');
        const pinoLogger = pino({ level: logLevel });
        
        // Buat socket WhatsApp dengan penanganan versi yang lebih baik
        let version;
        try {
            const versionResult = await fetchLatestBaileysVersion();
            // Tangani berbagai tipe return value
            if (Array.isArray(versionResult)) {
                version = versionResult;
            } else if (versionResult && Array.isArray(versionResult.version)) {
                version = versionResult.version;
            } else {
                // Fallback ke versi default jika fetching gagal
                version = [2, 3000, 1023223821];
            }
            console.log(`📱 Using WhatsApp Web version: ${version.join('.')}`);
        } catch (error) {
            console.warn(`⚠️ Failed to fetch latest WhatsApp version, using fallback:`, error.message);
            version = [2, 3000, 1023223821];
        }

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pinoLogger,
            browser: ['ALIJAYA WhatsApp Bot', 'Chrome', '1.0.0'],
            version: version
        });
        
        // Set socket ke semua modul
        whatsappCore.setSock(sock);
        whatsappCommands.setSock(sock);
        
        // Set socket ke modul-modul lain
        genieacsCommands.setSock(sock);
        mikrotikCommands.setSock(sock);
        pppoeCommands.setSock(sock);
        
        // Set socket ke notification manager
        try {
            whatsappNotifications.setSock(sock);
        } catch (error) {
            console.error('Error setting sock for WhatsApp notifications:', error);
        }
        
        // Event handlers
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                // Generate QR code
                qrcode.generate(qr, { small: true });
                whatsappCore.updateStatus({ qrCode: qr, status: 'qr_generated' });
                console.log('QR Code generated, silakan scan');
            }
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error instanceof Boom) && 
                                      (lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut);
                
                console.log(`Koneksi WhatsApp terputus. Mencoba koneksi ulang: ${shouldReconnect}`);
                
                whatsappCore.updateStatus({ 
                    connected: false, 
                    status: 'disconnected',
                    qrCode: null 
                });
                
                if (shouldReconnect) {
                    setTimeout(connectToWhatsApp, 30000); // 30 detik delay
                }
            }
            
            if (connection === 'open') {
                console.log('WhatsApp terhubung!');
                
                // Update status
                whatsappCore.updateStatus({
                    connected: true,
                    status: 'connected',
                    phoneNumber: sock.user?.id?.split(':')[0],
                    connectedSince: new Date(),
                    qrCode: null
                });
                
                // Kirim notifikasi ke admin - DISABLED
                // await sendAdminNotifications(sock);
                
                // Handle welcome message untuk super admin
                await messageHandlers.handleSuperAdminWelcome(sock);
                
                logger.info('WhatsApp connected successfully');
                
                // Initialize monitoring jika diperlukan
                initializeMonitoring();
            }
        });

        return sock;
    } catch (error) {
        logger.error('Error connecting to WhatsApp:', error);
        setTimeout(connectToWhatsApp, 30000); // Retry setelah 30 detik
    }
}

// Fungsi untuk mengirim notifikasi ke admin
async function sendAdminNotifications(sock) {
    try {
        const companyHeader = getSetting('company_header', 'ALIJAYA DIGITAL NETWORK');
        const companyHeaderShort = companyHeader.length > 20 ? companyHeader.substring(0, 20) + '...' : companyHeader;
        
        // Notifikasi ke semua admin
        const admins = getSetting('admins', []);
        const settings = getSetting('admins', {});
        
        // Tambahkan admin dari key numerik
        Object.keys(settings).forEach(key => {
            if (key.match(/^\d+$/) && settings[key]) {
                admins.push(settings[key]);
            }
        });
        
        const notificationMessage = `📋 *BOT WHATSAPP ${companyHeaderShort}*\n\n` +
                                  `✅ Bot WhatsApp berhasil terhubung!\n` +
                                  `🕐 Waktu: ${new Date().toLocaleString('id-ID')}\n` +
                                  `🌐 Status: Online\n\n` +
                                  `Ketik *admin* untuk melihat menu lengkap.`;
        
        for (const adminNumber of admins) {
            try {
                const adminJid = whatsappCore.createJID(adminNumber);
                if (adminJid) {
                    await sock.sendMessage(adminJid, { text: notificationMessage });
                    console.log(`Notifikasi terkirim ke admin: ${adminNumber}`);
                }
            } catch (error) {
                console.error(`Gagal mengirim notifikasi ke admin ${adminNumber}:`, error);
            }
        }
        
        // Notifikasi ke super admin
        const superAdminNumber = whatsappCore.getSuperAdmin();
        if (superAdminNumber) {
            try {
                const superAdminJid = whatsappCore.createJID(superAdminNumber);
                if (superAdminJid) {
                    const startupMessage = `📋 *BOT WHATSAPP ${companyHeaderShort}*\n\n` +
                                          `🚀 *STARTUP BERHASIL!*\n\n` +
                                          `Bot WhatsApp telah berhasil dijalankan dan terhubung.\n` +
                                          `🕐 Waktu: ${new Date().toLocaleString('id-ID')}\n` +
                                          `🌐 Status: Online\n\n` +
                                          `Semua layanan siap digunakan.`;
                    
                    await sock.sendMessage(superAdminJid, { text: startupMessage });
                    console.log('Notifikasi startup terkirim ke super admin');
                }
            } catch (error) {
                console.error('Gagal mengirim notifikasi startup ke super admin:', error);
            }
        }
        
    } catch (error) {
        console.error('Error sending admin notifications:', error);
    }
}

// Fungsi untuk initialize monitoring
function initializeMonitoring() {
    try {
        // Initialize PPPoE monitoring jika MikroTik dikonfigurasi
        if (getSetting('mikrotik_host') && getSetting('mikrotik_user') && getSetting('mikrotik_password')) {
            const { monitorPPPoEConnections } = require('./mikrotik');
            monitorPPPoEConnections().then(() => {
                logger.info('PPPoE monitoring initialized');
            }).catch(err => {
                logger.error('Error initializing PPPoE monitoring:', err);
            });
        }
        
        // Initialize RX Power monitoring
        try {
            const rxPowerMonitor = require('./rxPowerMonitor');
            rxPowerMonitor.setSock(whatsappCore.getSock());
            rxPowerMonitor.startRXPowerMonitoring();
            logger.info('RX Power monitoring initialized');
        } catch (err) {
            logger.error('Error initializing RX Power monitoring:', err);
        }
        
    } catch (error) {
        logger.error('Error initializing services:', error);
    }
}

// Fungsi untuk mendapatkan status WhatsApp
function getWhatsAppStatus() {
    return whatsappCore.getWhatsAppStatus();
}

// Fungsi untuk menghapus sesi WhatsApp
async function deleteWhatsAppSession() {
    try {
        const sessionDir = getSetting('whatsapp_session_path', './whatsapp-session');
        if (fs.existsSync(sessionDir)) {
            const files = fs.readdirSync(sessionDir);
            for (const file of files) {
                fs.unlinkSync(path.join(sessionDir, file));
            }
            console.log(`Menghapus ${files.length} file sesi WhatsApp`);
        }
        
        console.log('Sesi WhatsApp berhasil dihapus');
        
        // Reset status
        whatsappCore.updateStatus({
            connected: false,
            qrCode: null,
            phoneNumber: null,
            connectedSince: null,
            status: 'disconnected'
        });
        
        // Restart koneksi
        setTimeout(() => {
            console.log('Memulai koneksi ulang WhatsApp...');
            connectToWhatsApp();
        }, 5000);
        
        return { success: true, message: 'Sesi WhatsApp berhasil dihapus' };
    } catch (error) {
        console.error('Error saat menghapus sesi WhatsApp:', error);
        return { success: false, message: error.message };
    }
}

// Export fungsi-fungsi yang diperlukan
module.exports = {
    connectToWhatsApp,
    getWhatsAppStatus,
    deleteWhatsAppSession,
    whatsappCore,
    whatsappCommands,
    messageHandlers
};
