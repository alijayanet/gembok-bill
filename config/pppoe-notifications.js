// pppoe-notifications.js - Module for managing PPPoE login/logout notifications
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { getMikrotikConnection } = require('./mikrotik');
const { getSetting, setSetting } = require('./settingsManager');

// Default settings
const defaultSettings = {
    enabled: true,
    loginNotifications: true,
    logoutNotifications: true,
    includeOfflineList: true,
    maxOfflineListCount: 20,
    monitorInterval: 60000, // 1 menit
    lastActiveUsers: []
};

// Store the WhatsApp socket instance
let sock = null;
let monitorInterval = null;
let lastActivePPPoE = [];

// Set the WhatsApp socket instance
function setSock(sockInstance) {
    sock = sockInstance;
    logger.info('WhatsApp socket set in pppoe-notifications module');
}

// Fungsi untuk mendapatkan pengaturan notifikasi PPPoE dari settings.json
function getPPPoENotificationSettings() {
    return getSetting('pppoe_notifications', {
        enabled: true,
        loginNotifications: true,
        logoutNotifications: true,
        includeOfflineList: true,
        maxOfflineListCount: 20,
        monitorInterval: 60000
    });
}

// Save settings to settings.json
function saveSettings(settings) {
    try {
        // Update settings.json dengan pengaturan PPPoE notifications
        const { getSettingsWithCache } = require('./settingsManager');
        const currentSettings = getSettingsWithCache();
        
        // Update pppoe_notifications settings
        currentSettings['pppoe_notifications.enabled'] = settings.enabled.toString();
        currentSettings['pppoe_notifications.loginNotifications'] = settings.loginNotifications.toString();
        currentSettings['pppoe_notifications.logoutNotifications'] = settings.logoutNotifications.toString();
        currentSettings['pppoe_notifications.includeOfflineList'] = settings.includeOfflineList.toString();
        currentSettings['pppoe_notifications.maxOfflineListCount'] = settings.maxOfflineListCount.toString();
        currentSettings['pppoe_notifications.monitorInterval'] = settings.monitorInterval.toString();
        
        fs.writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));
        logger.info('PPPoE notification settings saved to settings.json');
        return true;
    } catch (error) {
        logger.error(`Error saving PPPoE notification settings: ${error.message}`);
        return false;
    }
}

// Get current settings
function getSettings() {
    return getPPPoENotificationSettings();
}

// Update settings
function updateSettings(newSettings) {
    const currentSettings = getPPPoENotificationSettings();
    const updatedSettings = { ...currentSettings, ...newSettings };
    return setSetting('pppoe_notifications', updatedSettings);
}

// Enable/disable notifications
function setNotificationStatus(enabled) {
    return updateSettings({ enabled });
}

// Enable/disable login notifications
function setLoginNotifications(enabled) {
    return updateSettings({ loginNotifications: enabled });
}

// Enable/disable logout notifications
function setLogoutNotifications(enabled) {
    return updateSettings({ logoutNotifications: enabled });
}

// Get admin numbers from settings.json
function getAdminNumbers() {
    try {
        const { getSettingsWithCache } = require('./settingsManager');
        const settings = getSettingsWithCache();
        
        // Cari admin numbers dengan format admins.0, admins.1, dst
        const adminNumbers = [];
        let index = 0;
        while (settings[`admins.${index}`]) {
            adminNumbers.push(settings[`admins.${index}`]);
            index++;
        }
        
        // Jika tidak ada format admins.0, coba cari array admins
        if (adminNumbers.length === 0 && settings.admins) {
            return settings.admins;
        }
        
        return adminNumbers;
    } catch (error) {
        logger.error(`Error getting admin numbers: ${error.message}`);
        return [];
    }
}

// Get technician numbers from settings.json
async function getTechnicianNumbers() {
    try {
        const sqlite3 = require('sqlite3').verbose();
        const path = require('path');
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        return new Promise((resolve, reject) => {
            // Ambil semua nomor teknisi aktif dari database
            const query = `
                SELECT phone, name, role 
                FROM technicians 
                WHERE is_active = 1 
                ORDER BY role, name
            `;
            
            db.all(query, [], (err, rows) => {
                db.close();
                
                if (err) {
                    logger.error(`Error getting technician numbers from database: ${err.message}`);
                    resolve([]);
                    return;
                }
                
                // Extract phone numbers
                const technicianNumbers = rows.map(row => row.phone);
                logger.info(`Found ${technicianNumbers.length} active technicians in database`);
                
                resolve(technicianNumbers);
            });
        });
    } catch (error) {
        logger.error(`Error getting technician numbers: ${error.message}`);
        return [];
    }
}

// Add admin number to settings.json
function addAdminNumber(number) {
    try {
        const { getSettingsWithCache } = require('./settingsManager');
        const settings = getSettingsWithCache();
        
        if (!settings.admins) {
            settings.admins = [];
        }
        
        if (!settings.admins.includes(number)) {
            settings.admins.push(number);
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            logger.info(`Admin number added to settings.json: ${number}`);
            return true;
        }
        return true; // Already exists
    } catch (error) {
        logger.error(`Error adding admin number: ${error.message}`);
        return false;
    }
}

// Add technician number to settings.json
function addTechnicianNumber(number) {
    try {
        const { getSettingsWithCache } = require('./settingsManager');
        const settings = getSettingsWithCache();
        
        if (!settings.technician_numbers) {
            settings.technician_numbers = [];
        }
        
        if (!settings.technician_numbers.includes(number)) {
            settings.technician_numbers.push(number);
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            logger.info(`Technician number added to settings.json: ${number}`);
            return true;
        }
        return true; // Already exists
    } catch (error) {
        logger.error(`Error adding technician number: ${error.message}`);
        return false;
    }
}

// Remove admin number from settings.json
function removeAdminNumber(number) {
    try {
        const { getSettingsWithCache } = require('./settingsManager');
        const settings = getSettingsWithCache();
        
        if (settings.admins) {
            settings.admins = settings.admins.filter(n => n !== number);
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            logger.info(`Admin number removed from settings.json: ${number}`);
            return true;
        }
        return true;
    } catch (error) {
        logger.error(`Error removing admin number: ${error.message}`);
        return false;
    }
}

// Remove technician number from settings.json
function removeTechnicianNumber(number) {
    try {
        const { getSettingsWithCache } = require('./settingsManager');
        const settings = getSettingsWithCache();
        
        if (settings.technician_numbers) {
            settings.technician_numbers = settings.technician_numbers.filter(n => n !== number);
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            logger.info(`Technician number removed from settings.json: ${number}`);
            return true;
        }
        return true;
    } catch (error) {
        logger.error(`Error removing technician number: ${error.message}`);
        return false;
    }
}

// Helper function untuk cek koneksi WhatsApp
async function checkWhatsAppConnection() {
    if (!sock) {
        logger.error('WhatsApp sock instance not set');
        return false;
    }

    try {
        // Cek apakah socket masih terhubung
        if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
            return true;
        } else {
            logger.warn('WhatsApp connection is not open');
            return false;
        }
    } catch (error) {
        logger.error(`Error checking WhatsApp connection: ${error.message}`);
        return false;
    }
}

// Helper function untuk format nomor WhatsApp
function formatWhatsAppNumber(number) {
    // Remove all non-numeric characters
    let cleanNumber = number.replace(/[^0-9]/g, '');

    // Add country code if not present
    if (cleanNumber.startsWith('0')) {
        cleanNumber = '62' + cleanNumber.substring(1); // Indonesia country code
    } else if (!cleanNumber.startsWith('62')) {
        cleanNumber = '62' + cleanNumber;
    }

    return cleanNumber + '@s.whatsapp.net';
}

// Tambahkan konfigurasi timeout untuk fungsi validasi
const VALIDATION_CONFIG = {
    timeout: 5000, // 5 detik
    maxRetries: 2
};

// Tambahkan fungsi utilitas untuk menangani timeout
function withTimeout(promise, timeoutMs, timeoutMessage = 'Operation timed out') {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`${timeoutMessage} after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
}

// Perbaiki fungsi validateWhatsAppNumber dengan penanganan timeout yang lebih baik
async function validateWhatsAppNumber(phoneNumber) {
    try {
        console.log(`[PPPoE-NOTIFICATION] Memulai validasi nomor WhatsApp: ${phoneNumber}`);
        
        // Cek apakah WhatsApp socket tersedia dan terhubung
        if (!global.whatsappSocket || !global.whatsappStatus || !global.whatsappStatus.connected) {
            console.warn('[PPPoE-NOTIFICATION] WhatsApp socket tidak tersedia atau tidak terhubung');
            return { isValid: false, error: 'WhatsApp tidak terhubung' };
        }

        // Cek apakah fungsi onWhatsApp tersedia
        if (typeof global.whatsappSocket.onWhatsApp !== 'function') {
            console.warn('[PPPoE-NOTIFICATION] Fungsi onWhatsApp tidak tersedia');
            return { isValid: false, error: 'Fungsi onWhatsApp tidak tersedia' };
        }

        // Coba beberapa kali jika terjadi timeout
        for (let attempt = 1; attempt <= VALIDATION_CONFIG.maxRetries; attempt++) {
            try {
                console.log(`[PPPoE-NOTIFICATION] Mencoba validasi nomor WhatsApp (attempt ${attempt}): ${phoneNumber}`);
                
                // Buat promise dengan timeout
                const validationPromise = global.whatsappSocket.onWhatsApp(phoneNumber);
                
                // Tambahkan timeout
                const result = await withTimeout(validationPromise, VALIDATION_CONFIG.timeout, `Validasi nomor WhatsApp timeout pada attempt ${attempt}`);
                
                console.log(`[PPPoE-NOTIFICATION] Validasi berhasil (attempt ${attempt})`);
                return { isValid: result && result.length > 0, result };
                
            } catch (error) {
                console.warn(`[PPPoE-NOTIFICATION] Attempt ${attempt} gagal:`, error.message);
                
                // Jika ini adalah attempt terakhir, kembalikan error
                if (attempt === VALIDATION_CONFIG.maxRetries) {
                    console.error('[PPPoE-NOTIFICATION] Semua attempt validasi gagal:', error.message);
                    return { isValid: false, error: error.message };
                }
                
                // Tunggu sebentar sebelum retry
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    } catch (error) {
        console.error('[PPPoE-NOTIFICATION] Error tidak terduga saat validasi nomor WhatsApp:', error.message);
        return { isValid: false, error: error.message };
    }
}

// Perbaiki fungsi sendNotification untuk menangani timeout dengan lebih baik
async function sendNotification(customer, notificationData) {
    try {
        console.log(`[PPPoE-NOTIFICATION] Mengirim notifikasi ke: ${customer.phone}`);
        
        // Cek apakah WhatsApp socket tersedia
        if (!global.whatsappSocket || !global.whatsappStatus || !global.whatsappStatus.connected) {
            console.warn('[PPPoE-NOTIFICATION] Tidak dapat mengirim notifikasi: WhatsApp tidak terhubung');
            return { success: false, message: 'WhatsApp tidak terhubung' };
        }

        // Format nomor telepon
        const formattedPhone = formatPhoneNumberForWhatsApp(customer.phone);
        if (!formattedPhone) {
            console.warn('[PPPoE-NOTIFICATION] Format nomor telepon tidak valid:', customer.phone);
            return { success: false, message: 'Format nomor telepon tidak valid' };
        }

        // Validasi nomor WhatsApp dengan timeout handling
        const validation = await validateWhatsAppNumber(formattedPhone);
        if (!validation.isValid) {
            console.warn('[PPPoE-NOTIFICATION] Nomor WhatsApp tidak valid atau tidak dapat divalidasi:', customer.phone);
            return { success: false, message: 'Nomor WhatsApp tidak valid' };
        }

        // Buat pesan notifikasi
        const message = createNotificationMessage(customer, notificationData);
        
        // Cek apakah fungsi sendMessage tersedia
        if (typeof global.whatsappSocket.sendMessage !== 'function') {
            console.warn('[PPPoE-NOTIFICATION] Fungsi sendMessage tidak tersedia');
            return { success: false, message: 'Fungsi sendMessage tidak tersedia' };
        }
        
        // Tambahkan timeout untuk pengiriman pesan
        const sendPromise = global.whatsappSocket.sendMessage(formattedPhone, { text: message });
        const result = await withTimeout(sendPromise, 10000, 'Pengiriman pesan WhatsApp timeout');
        
        console.log('[PPPoE-NOTIFICATION] Notifikasi berhasil dikirim ke:', customer.phone);
        return { success: true, result };
    } catch (error) {
        console.error('[PPPoE-NOTIFICATION] Gagal mengirim notifikasi WhatsApp ke:', customer.phone, error.message);
        
        // Jangan biarkan error menghentikan aplikasi
        return { success: false, message: error.message };
    }
}

// Get active PPPoE connections
async function getActivePPPoEConnections() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available for PPPoE monitoring');
            return { success: false, data: [] };
        }
        
        const pppConnections = await conn.write('/ppp/active/print');
        return {
            success: true,
            data: pppConnections
        };
    } catch (error) {
        logger.error(`Error getting active PPPoE connections: ${error.message}`);
        return { success: false, data: [] };
    }
}

// Get offline PPPoE users
async function getOfflinePPPoEUsers(activeUsers) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            return [];
        }
        
        const pppSecrets = await conn.write('/ppp/secret/print');
        const offlineUsers = pppSecrets.filter(secret => !activeUsers.includes(secret.name));
        return offlineUsers.map(user => user.name);
    } catch (error) {
        logger.error(`Error getting offline PPPoE users: ${error.message}`);
        return [];
    }
}

// Format login notification message
function formatLoginMessage(loginUsers, connections, offlineUsers) {
    const settings = getPPPoENotificationSettings();
    let message = `🔔 *PPPoE LOGIN NOTIFICATION*\n\n`;
    
    message += `📊 *User Login (${loginUsers.length}):*\n`;
    loginUsers.forEach((username, index) => {
        const connection = connections.find(c => c.name === username);
        message += `${index + 1}. *${username}*\n`;
        if (connection) {
            message += `   • IP: ${connection.address || 'N/A'}\n`;
            message += `   • Uptime: ${connection.uptime || 'N/A'}\n`;
        }
        message += '\n';
    });
    
    if (settings.includeOfflineList && offlineUsers.length > 0) {
        const maxCount = settings.maxOfflineListCount;
        const displayCount = Math.min(offlineUsers.length, maxCount);
        
        message += `🚫 *User Offline (${offlineUsers.length}):*\n`;
        for (let i = 0; i < displayCount; i++) {
            message += `${i + 1}. ${offlineUsers[i]}\n`;
        }
        
        if (offlineUsers.length > maxCount) {
            message += `... dan ${offlineUsers.length - maxCount} user lainnya\n`;
        }
    }
    
    message += `\n⏰ ${new Date().toLocaleString()}`;
    return message;
}

// Format logout notification message
function formatLogoutMessage(logoutUsers, offlineUsers) {
    const settings = getPPPoENotificationSettings();
    let message = `🚪 *PPPoE LOGOUT NOTIFICATION*\n\n`;
    
    message += `📊 *User Logout (${logoutUsers.length}):*\n`;
    logoutUsers.forEach((username, index) => {
        message += `${index + 1}. *${username}*\n`;
    });
    
    if (settings.includeOfflineList && offlineUsers.length > 0) {
        const maxCount = settings.maxOfflineListCount;
        const displayCount = Math.min(offlineUsers.length, maxCount);
        
        message += `\n🚫 *Total User Offline (${offlineUsers.length}):*\n`;
        for (let i = 0; i < displayCount; i++) {
            message += `${i + 1}. ${offlineUsers[i]}\n`;
        }
        
        if (offlineUsers.length > maxCount) {
            message += `... dan ${offlineUsers.length - maxCount} user lainnya\n`;
        }
    }
    
    message += `\n⏰ ${new Date().toLocaleString()}`;
    return message;
}

// Fungsi untuk mengirim notifikasi login PPPoE
async function sendLoginNotification(connection) {
    try {
        console.log('[PPPoE-NOTIFICATION] Mengirim notifikasi login untuk:', connection.name);
        
        // Dapatkan pengaturan notifikasi
        const settings = getPPPoENotificationSettings();
        
        // Jika notifikasi dinonaktifkan, hentikan proses
        if (!settings.enabled) {
            console.log('[PPPoE-NOTIFICATION] Notifikasi dinonaktifkan, melewatkan pengiriman');
            return { success: false, message: 'Notifikasi dinonaktifkan' };
        }
        
        // Jika notifikasi login dinonaktifkan, hentikan proses
        if (!settings.loginNotifications) {
            console.log('[PPPoE-NOTIFICATION] Notifikasi login dinonaktifkan, melewatkan pengiriman');
            return { success: false, message: 'Notifikasi login dinonaktifkan' };
        }
        
        // Dapatkan daftar nomor admin dan teknisi
        const adminNumbers = getAdminNumbers();
        const technicianNumbers = getTechnicianNumbers();
        const allRecipients = [...new Set([...adminNumbers, ...technicianNumbers])];
        
        // Jika tidak ada penerima, hentikan proses
        if (allRecipients.length === 0) {
            console.log('[PPPoE-NOTIFICATION] Tidak ada penerima notifikasi, melewatkan pengiriman');
            return { success: false, message: 'Tidak ada penerima notifikasi' };
        }
        
        // Buat pesan notifikasi
        let message = `🔔 *PPPoE LOGIN NOTIFICATION*\n\n`;
        if (connection.routerName || connection.routerId) {
            message += `🧭 *Router:* ${connection.routerName || connection.routerId}\n`;
        }
        message += `👤 *User:* ${connection.name}\n`;
        message += `📍 *IP Address:* ${connection.address || 'N/A'}\n`;
        message += `📈 *Uptime:* ${connection.uptime || 'N/A'}\n`;
        if (connection.comment) {
            message += `📝 *Comment:* ${connection.comment}\n`;
        }
        message += `\n⏰ *Waktu:* ${new Date().toLocaleString('id-ID')}`;
        
        // Kirim notifikasi ke semua penerima
        const results = [];
        for (const phoneNumber of allRecipients) {
            try {
                const result = await sendNotificationToNumber(phoneNumber, message);
                results.push({ phoneNumber, success: result.success, message: result.message });
            } catch (sendError) {
                console.error(`[PPPoE-NOTIFICATION] Gagal mengirim notifikasi ke ${phoneNumber}:`, sendError.message);
                results.push({ phoneNumber, success: false, message: sendError.message });
            }
        }
        
        console.log(`[PPPoE-NOTIFICATION] Notifikasi login terkirim ke ${results.filter(r => r.success).length} dari ${results.length} penerima`);
        return { success: true, results };
        
    } catch (error) {
        console.error('[PPPoE-NOTIFICATION] Error saat mengirim notifikasi login:', error.message);
        return { success: false, message: error.message };
    }
}

// Fungsi untuk mengirim notifikasi logout PPPoE
async function sendLogoutNotification(connection) {
    try {
        console.log('[PPPoE-NOTIFICATION] Mengirim notifikasi logout untuk:', connection.name);
        
        // Dapatkan pengaturan notifikasi
        const settings = getPPPoENotificationSettings();
        
        // Jika notifikasi dinonaktifkan, hentikan proses
        if (!settings.enabled) {
            console.log('[PPPoE-NOTIFICATION] Notifikasi dinonaktifkan, melewatkan pengiriman');
            return { success: false, message: 'Notifikasi dinonaktifkan' };
        }
        
        // Jika notifikasi logout dinonaktifkan, hentikan proses
        if (!settings.logoutNotifications) {
            console.log('[PPPoE-NOTIFICATION] Notifikasi logout dinonaktifkan, melewatkan pengiriman');
            return { success: false, message: 'Notifikasi logout dinonaktifkan' };
        }
        
        // Dapatkan daftar nomor admin dan teknisi
        const adminNumbers = getAdminNumbers();
        const technicianNumbers = getTechnicianNumbers();
        const allRecipients = [...new Set([...adminNumbers, ...technicianNumbers])];
        
        // Jika tidak ada penerima, hentikan proses
        if (allRecipients.length === 0) {
            console.log('[PPPoE-NOTIFICATION] Tidak ada penerima notifikasi, melewatkan pengiriman');
            return { success: false, message: 'Tidak ada penerima notifikasi' };
        }
        
        // Buat pesan notifikasi
        let message = `🚪 *PPPoE LOGOUT NOTIFICATION*\n\n`;
        if (connection.routerName || connection.routerId) {
            message += `🧭 *Router:* ${connection.routerName || connection.routerId}\n`;
        }
        message += `👤 *User:* ${connection.name}\n`;
        if (connection.comment) {
            message += `📝 *Comment:* ${connection.comment}\n`;
        }
        message += `\n⏰ *Waktu:* ${new Date().toLocaleString('id-ID')}`;
        
        // Kirim notifikasi ke semua penerima
        const results = [];
        for (const phoneNumber of allRecipients) {
            try {
                const result = await sendNotificationToNumber(phoneNumber, message);
                results.push({ phoneNumber, success: result.success, message: result.message });
            } catch (sendError) {
                console.error(`[PPPoE-NOTIFICATION] Gagal mengirim notifikasi ke ${phoneNumber}:`, sendError.message);
                results.push({ phoneNumber, success: false, message: sendError.message });
            }
        }
        
        console.log(`[PPPoE-NOTIFICATION] Notifikasi logout terkirim ke ${results.filter(r => r.success).length} dari ${results.length} penerima`);
        return { success: true, results };
        
    } catch (error) {
        console.error('[PPPoE-NOTIFICATION] Error saat mengirim notifikasi logout:', error.message);
        return { success: false, message: error.message };
    }
}

// Fungsi untuk mengirim notifikasi ke nomor tertentu
async function sendNotificationToNumber(phoneNumber, message) {
    try {
        // Cek apakah WhatsApp socket tersedia
        if (!global.whatsappSocket || !global.whatsappStatus || !global.whatsappStatus.connected) {
            console.warn('[PPPoE-NOTIFICATION] WhatsApp tidak terhubung');
            return { success: false, message: 'WhatsApp tidak terhubung' };
        }
        
        // Format nomor telepon
        const formattedPhone = formatWhatsAppNumber(phoneNumber);
        if (!formattedPhone) {
            console.warn('[PPPoE-NOTIFICATION] Format nomor telepon tidak valid:', phoneNumber);
            return { success: false, message: 'Format nomor telepon tidak valid' };
        }
        
        // Kirim pesan
        await global.whatsappSocket.sendMessage(formattedPhone, { text: message });
        console.log('[PPPoE-NOTIFICATION] Pesan terkirim ke:', phoneNumber);
        return { success: true, message: 'Pesan terkirim' };
        
    } catch (error) {
        console.error('[PPPoE-NOTIFICATION] Gagal mengirim pesan ke:', phoneNumber, error.message);
        return { success: false, message: error.message };
    }
}

module.exports = {
    setSock,
    getPPPoENotificationSettings,
    // Tambahkan alias agar kompatibel:
    getSettings: getPPPoENotificationSettings,
    setNotificationStatus,
    setLoginNotifications,
    setLogoutNotifications,
    getAdminNumbers,
    getTechnicianNumbers,
    addAdminNumber,
    addTechnicianNumber,
    removeAdminNumber,
    removeTechnicianNumber,
    sendNotification,
    sendLoginNotification,
    sendLogoutNotification,
    getActivePPPoEConnections,
    getOfflinePPPoEUsers,
    formatLoginMessage,
    formatLogoutMessage
};
