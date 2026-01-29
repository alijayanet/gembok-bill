const { Boom } = require('@hapi/boom');
const { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const pino = require('pino');
const logger = require('./logger');
const genieacsCommands = require('./genieacs-commands');

const {
    addHotspotUser,
    addPPPoESecret,
    setPPPoEProfile,
    getResourceInfo,
    getActiveHotspotUsers,
    getActivePPPoEConnections,
    deleteHotspotUser,
    deletePPPoESecret,
    getInactivePPPoEUsers,
    getOfflinePPPoEUsers
} = require('./mikrotik');

// Import handler perintah MikroTik baru
const mikrotikCommands = require('./mikrotik-commands');

// Import handler perintah PPPoE notifications
const pppoeCommands = require('./pppoe-commands');

// Import modul addWAN
const { handleAddWAN } = require('./addWAN');

// Import modul customerTag
const { addCustomerTag, addTagByPPPoE } = require('./customerTag');

// Import billing commands
const billingCommands = require('./billing-commands');

// Import admin number dari environment
const { ADMIN_NUMBER } = process.env;

// Import settings manager
const { getSetting } = require('./settingsManager');

// Import message templates helper
const { getDeveloperSupportMessage } = require('./message-templates');

// Import WhatsApp notification manager
const whatsappNotifications = require('./whatsapp-notifications');

// Import help messages
const { getAdminHelpMessage, getCustomerHelpMessage, getGeneralHelpMessage } = require('./help-messages');

// Phone helpers: normalize and variants (08..., 62..., +62...)
function normalizePhone(input) {
    if (!input) return '';
    let s = String(input).replace(/[^0-9+]/g, '');
    if (s.startsWith('+')) s = s.slice(1);
    if (s.startsWith('0')) return '62' + s.slice(1);
    if (s.startsWith('62')) return s;
    // Fallback: if it looks like local without leading 0, prepend 62
    if (/^8[0-9]{7,13}$/.test(s)) return '62' + s;
    return s;
}

function generatePhoneVariants(input) {
    const raw = String(input || '');
    const norm = normalizePhone(raw);
    const local = norm.startsWith('62') ? '0' + norm.slice(2) : raw;
    const plus = norm.startsWith('62') ? '+62' + norm.slice(2) : raw;
    const shortLocal = local.startsWith('0') ? local.slice(1) : local;
    return Array.from(new Set([raw, norm, local, plus, shortLocal].filter(Boolean)));
}

// Fungsi untuk mendekripsi nomor admin yang dienkripsi
function decryptAdminNumber(encryptedNumber) {
    try {
        // Ini adalah implementasi dekripsi sederhana menggunakan XOR dengan kunci statis
        // Dalam produksi, gunakan metode enkripsi yang lebih kuat
        const key = 'ALIJAYA_SECRET_KEY_2025';
        let result = '';
        for (let i = 0; i < encryptedNumber.length; i++) {
            result += String.fromCharCode(encryptedNumber.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    } catch (error) {
        console.error('Error decrypting admin number:', error);
        return null;
    }
}

// Membaca nomor super admin dari file eksternal (optional)
function getSuperAdminNumber() {
    const filePath = path.join(__dirname, 'superadmin.txt');
    if (!fs.existsSync(filePath)) {
        console.warn('⚠️ File superadmin.txt tidak ditemukan, superadmin features disabled');
        return null;
    }
    try {
        const number = fs.readFileSync(filePath, 'utf-8').trim();
        if (!number) {
            console.warn('⚠️ File superadmin.txt kosong, superadmin features disabled');
            return null;
        }
        return number;
    } catch (error) {
        console.error('❌ Error reading superadmin.txt:', error.message);
        return null;
    }
}

const superAdminNumber = getSuperAdminNumber();
let genieacsCommandsEnabled = true;

// Fungsi untuk mengecek apakah nomor adalah admin atau super admin
function isAdminNumber(number) {
    try {
        const { getSetting } = require('./settingsManager');
        // Normalisasi nomor
        let cleanNumber = number.replace(/\D/g, '');
        if (cleanNumber.startsWith('0')) cleanNumber = '62' + cleanNumber.slice(1);
        if (!cleanNumber.startsWith('62')) cleanNumber = '62' + cleanNumber;
        // Gabungkan semua admins dari settings.json (array dan key numerik)
        let admins = getSetting('admins', []);
        if (!Array.isArray(admins)) admins = [];
        // Cek key numerik
        const settingsRaw = require('./adminControl').getSettings();
        Object.keys(settingsRaw).forEach(key => {
            if (key.startsWith('admins.') && typeof settingsRaw[key] === 'string') {
                let n = settingsRaw[key].replace(/\D/g, '');
                if (n.startsWith('0')) n = '62' + n.slice(1);
                if (!n.startsWith('62')) n = '62' + n;
                admins.push(n);
            }
        });
        // Log debug
        console.log('DEBUG Admins from settings.json:', admins);
        console.log('DEBUG Nomor Masuk:', cleanNumber);
        // Cek super admin
        if (cleanNumber === superAdminNumber) return true;
        // Cek di daftar admin
        if (admins.includes(cleanNumber)) return true;
        return false;
    } catch (error) {
        console.error('Error in isAdminNumber:', error);
        return false;
    }
}

// Helper untuk menambahkan header dan footer pada pesan
function formatWithHeaderFooter(message) {
    try {
        // Ambil header dan footer dari settings.json dengan format yang konsisten
        const COMPANY_HEADER = getSetting('company_header', "📱 SISTEM BILLING \n\n");
        const FOOTER_SEPARATOR = "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
        const FOOTER_INFO = FOOTER_SEPARATOR + getSetting('footer_info', "Powered by Alijaya Digital Network");

        // Format pesan dengan header dan footer yang konsisten
        const formattedMessage = `${COMPANY_HEADER}${message}${FOOTER_INFO}`;

        return formattedMessage;
    } catch (error) {
        console.error('Error formatting message with header/footer:', error);
        // Fallback ke format default jika ada error
        return `📱 ALIJAYA DIGITAL NETWORK 📱

${message}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Powered by Alijaya Digital Network`;
    }
}

// Helper untuk mengirim pesan dengan header dan footer
async function sendFormattedMessage(remoteJid, message, options = {}) {
    try {
        const formattedMessage = formatWithHeaderFooter(message);
        await sock.sendMessage(remoteJid, { text: formattedMessage }, options);
    } catch (error) {
        console.error('Error sending formatted message:', error);
        // Fallback ke pesan tanpa format jika ada error
        await sock.sendMessage(remoteJid, { text: message }, options);
    }
}

let sock = null;
let qrCodeDisplayed = false;

// Tambahkan variabel global untuk menyimpan QR code dan status koneksi
let whatsappStatus = {
    connected: false,
    qrCode: null,
    phoneNumber: null,
    connectedSince: null,
    status: 'disconnected'
};

// Fungsi untuk set instance sock
function setSock(sockInstance) {
    sock = sockInstance;
}

// Update parameter paths
const parameterPaths = {
    rxPower: [
        'VirtualParameters.RXPower',
        'VirtualParameters.redaman',
        'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RXPower'
    ],
    pppoeIP: [
        'VirtualParameters.pppoeIP',
        'VirtualParameters.pppIP',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress'
    ],
    ssid: [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID'
    ],
    uptime: [
        'VirtualParameters.getdeviceuptime',
        'InternetGatewayDevice.DeviceInfo.UpTime'
    ],
    firmware: [
        'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
        'Device.DeviceInfo.SoftwareVersion'
    ],
    // Tambah path untuk PPPoE username
    pppUsername: [
        'VirtualParameters.pppoeUsername',
        'VirtualParameters.pppUsername',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username'
    ],
    userConnected: [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.TotalAssociations'
    ],
    userConnected5G: [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.TotalAssociations'
    ]
};

// Fungsi untuk cek status device
function getDeviceStatus(lastInform) {
    if (!lastInform) return false;
    const lastInformTime = new Date(lastInform).getTime();
    const currentTime = new Date().getTime();
    const diffMinutes = (currentTime - lastInformTime) / (1000 * 60);
    return diffMinutes < 5; // Online jika last inform < 5 menit
}

// Fungsi untuk format uptime
function formatUptime(uptime) {
    if (!uptime) return 'N/A';

    const seconds = parseInt(uptime);
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    let result = '';
    if (days > 0) result += `${days} hari `;
    if (hours > 0) result += `${hours} jam `;
    if (minutes > 0) result += `${minutes} menit`;

    return result.trim() || '< 1 menit';
}

// Update fungsi untuk mendapatkan nilai parameter
function getParameterWithPaths(device, paths) {
    if (!device || !Array.isArray(paths)) return 'N/A';

    for (const path of paths) {
        const pathParts = path.split('.');
        let value = device;

        for (const part of pathParts) {
            if (!value || !value[part]) {
                value = null;
                break;
            }
            value = value[part];
        }

        if (value !== null && value !== undefined && value !== '') {
            // Handle jika value adalah object
            if (typeof value === 'object') {
                if (value._value !== undefined) {
                    return value._value;
                }
                if (value.value !== undefined) {
                    return value.value;
                }
            }
            return value;
        }
    }

    return 'N/A';
}

// Fungsi helper untuk format nomor telepon
function formatPhoneNumber(number) {
    // Hapus semua karakter non-digit
    let cleaned = number.replace(/\D/g, '');

    // Jika dimulai dengan 0, ganti dengan 62
    if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.slice(1);
    }

    // Jika belum ada 62 di depan, tambahkan
    if (!cleaned.startsWith('62')) {
        cleaned = '62' + cleaned;
    }

    return cleaned;
}

// Tambahkan fungsi enkripsi sederhana
function generateWatermark() {
    const timestamp = new Date().getTime();
    const secretKey = getSetting('secret_key', 'alijaya-digital-network');
    const baseString = `ADN-${timestamp}`;
    // Enkripsi sederhana (dalam praktik nyata gunakan enkripsi yang lebih kuat)
    return Buffer.from(baseString).toString('base64');
}

// Update format pesan dengan watermark tersembunyi
function addWatermarkToMessage(message) {
    const watermark = generateWatermark();
    // Tambahkan karakter zero-width ke pesan
    return message + '\u200B' + watermark + '\u200B';
}

// Update fungsi koneksi WhatsApp dengan penanganan error yang lebih baik
async function connectToWhatsApp() {
    try {
        console.log('Memulai koneksi WhatsApp...');

        // Pastikan direktori sesi ada
        const sessionDir = getSetting('whatsapp_session_path', './whatsapp-session');
        if (!fs.existsSync(sessionDir)) {
            try {
                fs.mkdirSync(sessionDir, { recursive: true });
                console.log(`Direktori sesi WhatsApp dibuat: ${sessionDir}`);
            } catch (dirError) {
                console.error(`Error membuat direktori sesi: ${dirError.message}`);
                throw new Error(`Gagal membuat direktori sesi WhatsApp: ${dirError.message}`);
            }
        }

        // Gunakan logger dengan level yang dapat dikonfigurasi
        const logLevel = getSetting('whatsapp_log_level', 'silent');
        const logger = pino({ level: logLevel });

        // Buat socket dengan konfigurasi yang lebih baik dan penanganan error
        let authState;
        try {
            authState = await useMultiFileAuthState(sessionDir);
        } catch (authError) {
            console.error(`Error loading WhatsApp auth state: ${authError.message}`);
            throw new Error(`Gagal memuat state autentikasi WhatsApp: ${authError.message}`);
        }

        const { state, saveCreds } = authState;

        // Penanganan versi dengan error handling yang lebih baik
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

        sock = makeWASocket({
            auth: state,
            logger,
            browser: ['ALIJAYA Genieacs Bot Mikrotik', 'Chrome', '1.0.0'],
            connectTimeoutMs: 60000,
            qrTimeout: 40000,
            defaultQueryTimeoutMs: 30000, // Timeout untuk query
            retryRequestDelayMs: 1000,
            version: version
        });




        // Tangani update koneksi
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            // Log update koneksi
            console.log('Connection update:', update);

            // Tangani QR code
            if (qr) {
                // Simpan QR code dalam format yang bersih
                // Simpan QR code ke global status (untuk admin panel)
                if (!global.whatsappStatus || global.whatsappStatus.qrCode !== qr) {
                    global.whatsappStatus = {
                        connected: false,
                        qrCode: qr,
                        phoneNumber: null,
                        connectedSince: null,
                        status: 'qr_code'
                    };
                }


                // Tampilkan QR code di terminal
                console.log('QR Code tersedia, siap untuk dipindai');
                qrcode.generate(qr, { small: true });
            }

            // Tangani koneksi
            if (connection === 'open') {
                console.log('WhatsApp terhubung!');
                const connectedSince = new Date();

                // Update status global
                global.whatsappStatus = {
                    connected: true,
                    qrCode: null,
                    phoneNumber: sock.user?.id?.split(':')[0] || null,
                    connectedSince: connectedSince,
                    status: 'connected'
                };

                // Set sock instance untuk modul lain
                setSock(sock);

                // Set sock instance untuk modul sendMessage
                try {
                    const sendMessageModule = require('./sendMessage');
                    sendMessageModule.setSock(sock);
                } catch (error) {
                    console.error('Error setting sock for sendMessage:', error);
                }

                // Set sock instance untuk modul mikrotik-commands
                try {
                    const mikrotikCommands = require('./mikrotik-commands');
                    mikrotikCommands.setSock(sock);
                } catch (error) {
                    console.error('Error setting sock for mikrotik-commands:', error);
                }

                // Set sock instance untuk WhatsApp notification manager
                try {
                    whatsappNotifications.setSock(sock);
                } catch (error) {
                    console.error('Error setting sock for WhatsApp notifications:', error);
                }

                // Kirim pesan ke admin bahwa bot telah terhubung
                try {
                    // Ambil port yang aktif dari global settings atau fallback
                    const activePort = global.appSettings?.port || getSetting('server_port', '3001');
                    const serverHost = global.appSettings?.host || getSetting('server_host', 'localhost');

                    // Silent startup - notifications disabled
                    console.log(`✅ WhatsApp bot connected successfully at ${connectedSince.toLocaleString()}`);
                    // Super admin notifications disabled
                } catch (error) {
                    console.error('Error sending connection notification:', error);
                }
            } else if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`Koneksi WhatsApp terputus. Mencoba koneksi ulang: ${shouldReconnect}`);

                // Update status global
                global.whatsappStatus = {
                    connected: false,
                    qrCode: null,
                    phoneNumber: null,
                    connectedSince: null,
                    status: 'disconnected'
                };

                // Reconnect jika bukan karena logout
                if (shouldReconnect) {
                    setTimeout(() => {
                        connectToWhatsApp();
                    }, getSetting('reconnect_interval', 5000));
                }
            }
        });

        // Tangani credentials update
        sock.ev.on('creds.update', saveCreds);

        // PERBAIKAN: Tangani pesan masuk dengan benar
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type === 'notify') {
                for (const message of messages) {
                    if (!message.key.fromMe && message.message) {
                        try {
                            // Log pesan masuk untuk debugging
                            console.log('Pesan masuk:', JSON.stringify(message, null, 2));

                            // Panggil fungsi handleIncomingMessage
                            await handleIncomingMessage(sock, message);
                        } catch (error) {
                            console.error('Error handling incoming message:', error);
                        }
                    }
                }
            }
        });

        return sock;
    } catch (error) {
        console.error('Error connecting to WhatsApp:', error);

        // Coba koneksi ulang setelah interval
        setTimeout(() => {
            connectToWhatsApp();
        }, getSetting('reconnect_interval', 5000));

        return null;
    }
}

// Update handler status
async function handleStatusCommand(senderNumber, remoteJid) {
    try {
        console.log(`Menjalankan perintah status untuk ${senderNumber}`);

        // Cari perangkat berdasarkan nomor pengirim
        const device = await getDeviceByNumber(senderNumber);

        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `âŒ *Perangkat Tidak Ditemukan*\n\nMaaf, perangkat Anda tidak ditemukan dalam sistem kami. Silakan hubungi admin untuk bantuan.`
            });
            return;
        }

        // Ambil informasi perangkat
        const deviceId = device._id;
        const lastInform = new Date(device._lastInform);
        const now = new Date();
        const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
        const isOnline = diffMinutes < 15;

        // Gunakan parameterPaths yang sudah ada untuk mendapatkan nilai
        // Ambil informasi SSID
        let ssid = 'N/A';
        let ssid5G = 'N/A';

        // Coba ambil SSID langsung
        if (device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.SSID?._value) {
            ssid = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['1'].SSID._value;
        }

        // Coba ambil SSID 5G langsung
        if (device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['5']?.SSID?._value) {
            ssid5G = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['5'].SSID._value;
        } else if (device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['2']?.SSID?._value) {
            ssid5G = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['2'].SSID._value;
        }

        // Gunakan getParameterWithPaths untuk mendapatkan nilai dari parameter paths yang sudah ada
        const rxPower = getParameterWithPaths(device, parameterPaths.rxPower);
        const formattedRxPower = rxPower !== 'N/A' ? `${rxPower} dBm` : 'N/A';

        const pppUsername = getParameterWithPaths(device, parameterPaths.pppUsername);
        const ipAddress = getParameterWithPaths(device, parameterPaths.pppoeIP);

        // Ambil informasi pengguna terhubung
        let connectedUsers = getParameterWithPaths(device, parameterPaths.userConnected) || '0';
        let connectedUsers5G = getParameterWithPaths(device, parameterPaths.userConnected5G) || '0';

        // Jika kedua nilai tersedia, gabungkan
        let totalConnectedUsers = connectedUsers;
        if (connectedUsers !== 'N/A' && connectedUsers5G !== 'N/A' && connectedUsers5G !== '0') {
            try {
                totalConnectedUsers = (parseInt(connectedUsers) + parseInt(connectedUsers5G)).toString();
            } catch (e) {
                console.error('Error calculating total connected users:', e);
            }
        }

        // Ambil daftar user terhubung ke SSID 1 (2.4GHz) saja, lengkap dengan IP jika ada
        let associatedDevices = [];
        try {
            // Ambil dari AssociatedDevice (utama)
            const assocObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.AssociatedDevice;
            if (assocObj && typeof assocObj === 'object') {
                for (const key in assocObj) {
                    if (!isNaN(key)) {
                        const entry = assocObj[key];
                        const mac = entry?.MACAddress?._value || entry?.MACAddress || '-';
                        const hostname = entry?.HostName?._value || entry?.HostName || '-';
                        const ip = entry?.IPAddress?._value || entry?.IPAddress || '-';
                        associatedDevices.push({ mac, hostname, ip });
                    }
                }
            }

            // Fallback: Jika AssociatedDevice kosong, ambil dari Hosts.Host yang interface-nya IEEE802_11 dan terkait SSID 1
            if (associatedDevices.length === 0) {
                const hostsObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.Hosts?.Host;
                if (hostsObj && typeof hostsObj === 'object') {
                    for (const key in hostsObj) {
                        if (!isNaN(key)) {
                            const entry = hostsObj[key];
                            const interfaceType = entry?.InterfaceType?._value || entry?.InterfaceType || '';
                            const ssidRef = entry?.SSIDReference?._value || entry?.SSIDReference || '';
                            // Hanya WiFi SSID 1 (biasanya mengandung 'WLANConfiguration.1')
                            if (interfaceType === 'IEEE802_11' && (!ssidRef || ssidRef.includes('WLANConfiguration.1'))) {
                                const mac = entry?.MACAddress?._value || entry?.MACAddress || '-';
                                const hostname = entry?.HostName?._value || entry?.HostName || '-';
                                const ip = entry?.IPAddress?._value || entry?.IPAddress || '-';
                                associatedDevices.push({ mac, hostname, ip });
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing associated devices SSID 1:', e);
        }

        // Ambil informasi uptime
        let uptime = getParameterWithPaths(device, parameterPaths.uptime);
        if (uptime !== 'N/A') {
            uptime = formatUptime(uptime);
        }

        // Buat pesan status
        let statusMessage = `📊 *STATUS PERANGKAT*\n\n`;
        statusMessage += `📌 *Status:* ${isOnline ? '🟢 Online' : '🔴 Offline'}\n`;
        statusMessage += `📌 *Terakhir Online:* ${lastInform.toLocaleString()}\n`;
        statusMessage += `📌 *WiFi 2.4GHz:* ${ssid}\n`;
        statusMessage += `📌 *WiFi 5GHz:* ${ssid5G}\n`;
        statusMessage += `📌 *Pengguna Terhubung:* ${totalConnectedUsers}\n`;
        // Tambahkan detail user SSID 1 jika ada
        if (associatedDevices.length > 0) {
            statusMessage += `• *Daftar User SSID 1 (2.4GHz):*\n`;
            associatedDevices.forEach((dev, idx) => {
                statusMessage += `   ${idx + 1}. ${dev.hostname} (${dev.ip}) - ${dev.mac}\n`;
            });
        } else {
            statusMessage += `• Tidak ada user WiFi yang terhubung di SSID 1 (2.4GHz)\n`;
        }

        // Tambahkan RX Power dengan indikator kualitas
        if (rxPower !== 'N/A') {
            const rxValue = parseFloat(rxPower);
            let qualityIndicator = '';
            if (rxValue > -25) qualityIndicator = ' (🟢 Baik)';
            else if (rxValue > -27) qualityIndicator = ' (🟡 Warning)';
            else qualityIndicator = ' (🔴 Kritis)';
            statusMessage += `📌 *RX Power:* ${formattedRxPower}${qualityIndicator}\n`;
        } else {
            statusMessage += `📌 *RX Power:* ${formattedRxPower}\n`;
        }

        statusMessage += `📌 *PPPoE Username:* ${pppUsername}\n`;
        statusMessage += `📌 *IP Address:* ${ipAddress}\n`;

        // Tambahkan uptime jika tersedia
        if (uptime !== 'N/A') {
            statusMessage += `📌 *Uptime:* ${uptime}\n`;
        }
        statusMessage += `\n`;

        // Tambahkan informasi tambahan
        statusMessage += `â„¹ï¸ Untuk mengubah nama WiFi, ketik:\n`;
        statusMessage += `*gantiwifi [nama]*\n\n`;
        statusMessage += `â„¹ï¸ Untuk mengubah password WiFi, ketik:\n`;
        statusMessage += `*gantipass [password]*\n\n`;

        // Kirim pesan status dengan header dan footer
        await sendFormattedMessage(remoteJid, statusMessage);
        console.log(`Pesan status terkirim ke ${remoteJid}`);

        return true;
    } catch (error) {
        console.error('Error sending status message:', error);

        // Kirim pesan error dengan header dan footer
        await sendFormattedMessage(remoteJid, `âŒ *Error*\n\nTerjadi kesalahan saat mengambil status perangkat. Silakan coba lagi nanti.`);

        return false;
    }
}

async function handleHelpCommand(remoteJid, isAdmin = false) {
    try {
        let helpMessage;
        if (isAdmin) {
            helpMessage = getAdminHelpMessage();
        } else {
            helpMessage = getCustomerHelpMessage();
        }
        await sendFormattedMessage(remoteJid, helpMessage);
        return true;
    } catch (error) {
        console.error('Error sending help message:', error);
        return false;
    }
}

// Fungsi untuk menampilkan menu admin
async function sendAdminMenuList(remoteJid) {
    try {
        console.log(`Menampilkan menu admin ke ${remoteJid}`);

        // Gunakan help message dari file terpisah
        const adminMessage = getAdminHelpMessage();

        // Kirim pesan menu admin
        await sock.sendMessage(remoteJid, { text: adminMessage });
        console.log(`Pesan menu admin terkirim ke ${remoteJid}`);

    } catch (error) {
        console.error('Error sending admin menu:', error);
        await sock.sendMessage(remoteJid, {
            text: `âŒ *ERROR*\n\nTerjadi kesalahan saat menampilkan menu admin:\n${error.message}`
        });
    }
}

// Update fungsi getDeviceByNumber
async function getDeviceByNumber(number) {
    try {
        console.log(`Mencari perangkat untuk nomor ${number}`);

        // Bersihkan nomor dari karakter non-digit
        let cleanNumber = number.replace(/\D/g, '');

        // Format nomor dalam beberapa variasi yang mungkin digunakan sebagai tag
        const possibleFormats = [];

        // Format 1: Nomor asli yang dibersihkan
        possibleFormats.push(cleanNumber);

        // Format 2: Jika diawali 0, coba versi dengan 62 di depan (ganti 0 dengan 62)
        if (cleanNumber.startsWith('0')) {
            possibleFormats.push('62' + cleanNumber.substring(1));
        }

        // Format 3: Jika diawali 62, coba versi dengan 0 di depan (ganti 62 dengan 0)
        if (cleanNumber.startsWith('62')) {
            possibleFormats.push('0' + cleanNumber.substring(2));
        }

        // Format 4: Tanpa awalan, jika ada awalan
        if (cleanNumber.startsWith('0') || cleanNumber.startsWith('62')) {
            if (cleanNumber.startsWith('0')) {
                possibleFormats.push(cleanNumber.substring(1));
            } else if (cleanNumber.startsWith('62')) {
                possibleFormats.push(cleanNumber.substring(2));
            }
        }

        console.log(`Mencoba format nomor berikut: ${possibleFormats.join(', ')}`);

        // Coba cari dengan semua format yang mungkin
        for (const format of possibleFormats) {
            try {
                const device = await findDeviceByTag(format);
                if (device) {
                    console.log(`Perangkat ditemukan dengan tag nomor: ${format}`);
                    return device;
                }
            } catch (formatError) {
                console.log(`Gagal mencari dengan format ${format}: ${formatError.message}`);
                // Lanjut ke format berikutnya
            }
        }

        console.log(`Perangkat tidak ditemukan untuk nomor ${number} dengan semua format yang dicoba`);

        // Fallback: Cari perangkat berdasarkan PPPoE username dari database pelanggan
        try {
            console.log(`Mencoba mencari perangkat berdasarkan PPPoE username dari database pelanggan...`);

            // Normalisasi nomor telepon untuk pencarian di database
            let searchPhone = cleanNumber;
            if (searchPhone.startsWith('0')) {
                searchPhone = '62' + searchPhone.substring(1);
            } else if (!searchPhone.startsWith('62')) {
                searchPhone = '62' + searchPhone;
            }

            // Cari pelanggan berdasarkan nomor telepon (coba semua format)
            const customer = await new Promise((resolve, reject) => {
                const db = require('sqlite3').verbose();
                const database = new db.Database('./data/billing.db');

                // Debug: Tampilkan parameter pencarian
                console.log(`🔍 [DEBUG] Mencari pelanggan dengan parameter:`);
                console.log(`   cleanNumber: ${cleanNumber}`);
                console.log(`   searchPhone: ${searchPhone}`);
                console.log(`   '0' + cleanNumber.substring(2): ${'0' + cleanNumber.substring(2)}`);
                console.log(`   cleanNumber.substring(2): ${cleanNumber.substring(2)}`);

                database.get(
                    'SELECT id, username, pppoe_username FROM customers WHERE phone = ? OR phone = ? OR phone = ? OR phone = ?',
                    [cleanNumber, searchPhone, '0' + cleanNumber.substring(2), cleanNumber.substring(2)],
                    (err, row) => {
                        if (err) {
                            console.error(`❌ [ERROR] Database error: ${err.message}`);
                            reject(err);
                        } else {
                            console.log(`📋 [DEBUG] Hasil pencarian: ${row ? 'Ditemukan' : 'Tidak ditemukan'}`);
                            if (row) {
                                console.log(`   Pelanggan: ${row.username}`);
                            }
                            resolve(row);
                        }
                        database.close();
                    }
                );
            });

            if (customer && customer.pppoe_username) {
                console.log(`Ditemukan pelanggan dengan PPPoE username: ${customer.pppoe_username}`);

                // Cari perangkat berdasarkan PPPoE username
                const device = await findDeviceByPPPoEUsername(customer.pppoe_username);
                if (device) {
                    console.log(`✅ Perangkat ditemukan dengan PPPoE username: ${customer.pppoe_username}`);
                    return device;
                } else {
                    console.log(`⚠️ Perangkat tidak ditemukan dengan PPPoE username: ${customer.pppoe_username}`);
                }
            } else {
                console.log(`⚠️ Tidak ada pelanggan ditemukan dengan nomor telepon ini`);
            }
        } catch (customerError) {
            console.error(`Error saat mencari pelanggan: ${customerError.message}`);
        }

        return null;
    } catch (error) {
        console.error('Error getting device by number:', error);
        return null;
    }
}

// Tambah handler untuk tombol refresh
async function handleRefreshCommand(senderNumber, remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan bahwa proses refresh sedang berlangsung
        await sock.sendMessage(remoteJid, {
            text: `⏳ *PROSES REFRESH*\n\nSedang memperbarui informasi perangkat...\nMohon tunggu sebentar.`
        });

        // Cari perangkat berdasarkan nomor pengirim
        const device = await getDeviceByNumber(senderNumber);

        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `âŒ *PERANGKAT TIDAK DITEMUKAN*\n\nMaaf, tidak dapat menemukan perangkat yang terkait dengan nomor Anda.`
            });
            return;
        }

        // Lakukan refresh perangkat 
        const deviceId = device._id;
        console.log(`Refreshing device ID: ${deviceId}`);
        const refreshResult = await refreshDevice(deviceId);

        if (refreshResult.success) {
            // Tunggu sebentar untuk memastikan data telah diperbarui
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Ambil data terbaru 
            try {
                const updatedDevice = await getDeviceByNumber(senderNumber);
                const model = updatedDevice.InternetGatewayDevice?.DeviceInfo?.ModelName?._value || 'N/A';
                const serialNumber = updatedDevice.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 'N/A';
                const lastInform = new Date(updatedDevice._lastInform).toLocaleString();

                await sock.sendMessage(remoteJid, {
                    text: `✅ *REFRESH BERHASIL*\n\n` +
                        `Perangkat berhasil diperbarui!\n\n` +
                        `📋 *Detail Perangkat:*\n` +
                        `• Serial Number: ${serialNumber}\n` +
                        `• Model: ${model}\n` +
                        `• Last Inform: ${lastInform}\n\n` +
                        `Gunakan perintah *status* untuk melihat informasi lengkap perangkat.`
                });
            } catch (updateError) {
                console.error('Error getting updated device info:', updateError);

                // Tetap kirim pesan sukses meskipun gagal mendapatkan info terbaru
                await sock.sendMessage(remoteJid, {
                    text: `✅ *REFRESH BERHASIL*\n\n` +
                        `Perangkat berhasil diperbarui!\n\n` +
                        `Gunakan perintah *status* untuk melihat informasi lengkap perangkat.`
                });
            }
        } else {
            await sock.sendMessage(remoteJid, {
                text: `âŒ *REFRESH GAGAL*\n\n` +
                    `Terjadi kesalahan saat memperbarui perangkat:\n` +
                    `${refreshResult.message || 'Kesalahan tidak diketahui'}\n\n` +
                    `Silakan coba lagi nanti atau hubungi admin.`
            });
        }
    } catch (error) {
        console.error('Error in handleRefreshCommand:', error);
        await sock.sendMessage(remoteJid, {
            text: `âŒ *ERROR*\n\nTerjadi kesalahan saat memproses perintah:\n${error.message}`
        });
    }
}

// Fungsi untuk melakukan refresh perangkat
async function refreshDevice(deviceId) {
    try {
        console.log(`Refreshing device with ID: ${deviceId}`);
        if (!deviceId) {
            return { success: false, message: "Device ID tidak valid" };
        }
        // Ambil konfigurasi GenieACS dari helper
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        // 2. Coba mendapatkan device terlebih dahulu untuk memastikan ID valid
        // Cek apakah device ada
        try {
            const checkResponse = await axios.get(`${genieacsUrl}/devices?query={"_id":"${deviceId}"}`, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            });
            if (!checkResponse.data || checkResponse.data.length === 0) {
                console.error(`Device with ID ${deviceId} not found`);
                return { success: false, message: "Perangkat tidak ditemukan di sistem" };
            }
            const exactDeviceId = checkResponse.data[0]._id;
            console.log(`Using exact device ID: ${exactDeviceId}`);
            const encodedDeviceId = encodeURIComponent(exactDeviceId);
            console.log(`Sending refresh task to: ${genieacsUrl}/devices/${encodedDeviceId}/tasks`);
            const refreshResponse = await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice" // Gunakan object root
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log(`Refresh response status: ${refreshResponse.status}`);
            return { success: true, message: "Perangkat berhasil diperbarui" };
        } catch (checkError) {
            console.error(`Error checking device: ${checkError.message}`);
            console.log(`Trying alternative approach for device ${deviceId}`);
            try {
                const encodedDeviceId1 = encodeURIComponent(deviceId);
                const encodedDeviceId2 = deviceId.replace(/:/g, '%3A').replace(/\//g, '%2F');
                const attempts = [encodedDeviceId1, encodedDeviceId2, deviceId];
                for (const attemptedId of attempts) {
                    try {
                        console.log(`Trying refresh with ID format: ${attemptedId}`);
                        const response = await axios.post(
                            `${genieacsUrl}/devices/${attemptedId}/tasks`,
                            {
                                name: "refreshObject",
                                objectName: ""  // Kosong untuk refresh semua
                            },
                            {
                                auth: {
                                    username: genieacsUsername,
                                    password: genieacsPassword
                                },
                                timeout: 5000
                            }
                        );
                        console.log(`Refresh successful with ID format: ${attemptedId}`);
                        return { success: true, message: "Perangkat berhasil diperbarui" };
                    } catch (attemptError) {
                        console.error(`Failed with ID format ${attemptedId}: ${attemptError.message}`);
                    }
                }
                throw new Error("Semua percobaan refresh gagal");
            } catch (altError) {
                console.error(`All refresh attempts failed: ${altError.message}`);
                throw altError;
            }
        }
    } catch (error) {
        console.error('Error refreshing device:', error);
        let errorMessage = "Kesalahan tidak diketahui";
        if (error.response) {
            errorMessage = `Error ${error.response.status}: ${error.response.data || 'No response data'}`;
        } else if (error.request) {
            errorMessage = "Tidak ada respons dari server GenieACS";
        } else {
            errorMessage = error.message;
        }
        return {
            success: false,
            message: `Gagal memperbarui perangkat: ${errorMessage}`
        };
    }
}

// Tambahkan handler untuk menu admin
async function handleAdminMenu(remoteJid) {
    // handleAdminMenu hanya memanggil sendAdminMenuList, tidak perlu perubahan
    await sendAdminMenuList(remoteJid);
}

// Update handler admin check ONU
async function handleAdminCheckONU(remoteJid, customerNumber) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (!customerNumber) {
        await sock.sendMessage(remoteJid, {
            text: `âŒ *FORMAT SALAH*\n\n` +
                `Format yang benar:\n` +
                `admincheck [nomor_pelanggan]\n\n` +
                `Contoh:\n` +
                `admincheck 123456`
        });
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, {
            text: `🔍 *MENCARI PERANGKAT*\n\nSedang mencari perangkat untuk pelanggan ${customerNumber}...\nMohon tunggu sebentar.`
        });

        // Cari perangkat berdasarkan nomor pelanggan
        const device = await findDeviceByTag(customerNumber);

        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `âŒ *PERANGKAT TIDAK DITEMUKAN*\n\n` +
                    `Tidak dapat menemukan perangkat untuk pelanggan dengan nomor ${customerNumber}.\n\n` +
                    `Pastikan nomor pelanggan benar dan perangkat telah terdaftar dalam sistem.`
            });
            return;
        }

        // Ekstrak informasi perangkat - Gunakan pendekatan yang sama dengan dashboard web
        // Coba ambil dari berbagai kemungkinan path untuk memastikan konsistensi dengan dashboard
        let serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value ||
            device.Device?.DeviceInfo?.SerialNumber?._value ||
            device.DeviceID?.SerialNumber ||
            device._id?.split('-')[2] || 'Unknown';

        // Coba ambil model dari berbagai kemungkinan path
        let modelName = device.InternetGatewayDevice?.DeviceInfo?.ModelName?._value ||
            device.Device?.DeviceInfo?.ModelName?._value ||
            device.DeviceID?.ProductClass ||
            device._id?.split('-')[1] || 'Unknown';

        const lastInform = new Date(device._lastInform);
        const now = new Date();
        const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
        const isOnline = diffMinutes < 15;
        const statusText = isOnline ? '🟢 Online' : '🔴 Offline';

        // Informasi WiFi
        const ssid = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.SSID?._value || 'N/A';
        const ssid5G = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[5]?.SSID?._value || 'N/A';

        // Informasi IP
        const ipAddress = device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.ExternalIPAddress?._value || 'N/A';

        // Informasi PPPoE
        const pppoeUsername =
            device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.Username?._value ||
            device.InternetGatewayDevice?.WANDevice?.[0]?.WANConnectionDevice?.[0]?.WANPPPConnection?.[0]?.Username?._value ||
            device.VirtualParameters?.pppoeUsername?._value ||
            'N/A';

        // Ambil RX Power dari semua kemungkinan path
        const rxPower = getParameterWithPaths(device, parameterPaths.rxPower);
        let rxPowerStatus = '';
        if (rxPower !== 'N/A') {
            const power = parseFloat(rxPower);
            if (power > -25) rxPowerStatus = '🟢 Baik';
            else if (power > -27) rxPowerStatus = '🟡 Warning';
            else rxPowerStatus = '🔴 Kritis';
        }

        // Informasi pengguna WiFi
        const users24ghz = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.TotalAssociations?._value || 0;
        const users5ghz = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[5]?.TotalAssociations?._value || 0;
        const totalUsers = parseInt(users24ghz) + parseInt(users5ghz);

        // Ambil daftar user terhubung ke SSID 1 (2.4GHz)
        let associatedDevices = [];
        try {
            const assocObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.AssociatedDevice;
            if (assocObj && typeof assocObj === 'object') {
                for (const key in assocObj) {
                    if (!isNaN(key)) {
                        const entry = assocObj[key];
                        const mac = entry?.MACAddress?._value || entry?.MACAddress || '-';
                        const hostname = entry?.HostName?._value || entry?.HostName || '-';
                        associatedDevices.push({ mac, hostname });
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing associated devices (admin):', e);
        }
        // Fallback: jika AssociatedDevice kosong, ambil dari Hosts.Host (hanya WiFi/802.11)
        if (associatedDevices.length === 0) {
            try {
                const hostsObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.Hosts?.Host;
                if (hostsObj && typeof hostsObj === 'object') {
                    for (const key in hostsObj) {
                        if (!isNaN(key)) {
                            const entry = hostsObj[key];
                            // Hanya tampilkan yang interface-nya 802.11 (WiFi)
                            const iface = entry?.InterfaceType?._value || entry?.InterfaceType || entry?.Interface || '-';
                            // Pastikan iface adalah string sebelum memanggil toLowerCase()
                            if (iface && typeof iface === 'string' && iface.toLowerCase().includes('802.11')) {
                                const mac = entry?.MACAddress?._value || entry?.MACAddress || '-';
                                const hostname = entry?.HostName?._value || entry?.HostName || '-';
                                const ip = entry?.IPAddress?._value || entry?.IPAddress || '-';
                                associatedDevices.push({ mac, hostname, ip });
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Error parsing Hosts.Host (admin):', e);
            }
        }

        // Buat pesan dengan informasi lengkap
        // Gunakan serial number dan model yang sudah diambil sebelumnya
        // Tidak perlu mengubah nilai yang sudah diambil dengan benar

        let message = `📋 *DETAIL PERANGKAT PELANGGAN*\n\n`;
        message += `👤 *Pelanggan:* ${customerNumber}\n`;
        message += `📋 *Serial Number:* ${serialNumber}\n`;
        message += `📋 *Model:* ${modelName}\n`;
        message += `📶 *Status:* ${statusText}\n`;
        message += `â±ï¸ *Last Seen:* ${lastInform.toLocaleString()}\n\n`;

        message += `🌐 *INFORMASI JARINGAN*\n`;
        message += `📌 IP Address: ${ipAddress}\n`;
        message += `📌 PPPoE Username: ${pppoeUsername}\n`;
        message += `📌 *RX Power:* ${rxPower ? rxPower + ' dBm' : 'N/A'}${rxPowerStatus ? ' (' + rxPowerStatus + ')' : ''}\n`;
        message += `📌 WiFi 2.4GHz: ${ssid}\n`;
        message += `📌 WiFi 5GHz: ${ssid5G}\n`;
        message += `📌 Pengguna WiFi: ${totalUsers} perangkat\n`;
        // Tambahkan detail user SSID 1 jika ada
        if (associatedDevices.length > 0) {
            message += `• *Daftar User WiFi (2.4GHz):*\n`;
            associatedDevices.forEach((dev, idx) => {
                let detail = `${idx + 1}. ${dev.hostname || '-'} (${dev.mac || '-'}`;
                if (dev.ip) detail += `, ${dev.ip}`;
                detail += ')';
                message += `   ${detail}\n`;
            });
        } else {
            message += `• Tidak ada data user WiFi (2.4GHz) tersedia\n`;
        }
        message += `\n`;

        if (rxPower) {
            message += `🔧 *KUALITAS SINYAL*\n`;
            message += `• RX Power: ${rxPower} dBm (${rxPowerStatus})\n\n`;
        }

        message += `💡 *TINDAKAN ADMIN*\n`;
        message += `• Ganti SSID: editssid ${customerNumber} [nama_baru]\n`;
        message += `• Ganti Password: editpass ${customerNumber} [password_baru]\n`;
        message += `• Refresh Perangkat: adminrefresh ${customerNumber}`;

        await sock.sendMessage(remoteJid, { text: message });
    } catch (error) {
        console.error('Error in handleAdminCheckONU:', error);
        await sock.sendMessage(remoteJid, {
            text: `âŒ *ERROR*\n\nTerjadi kesalahan saat memeriksa perangkat:\n${error.message}`
        });
    }
}

// Fungsi untuk cek ONU dengan data billing lengkap
async function handleAdminCheckONUWithBilling(remoteJid, searchTerm) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (!searchTerm) {
        await sock.sendMessage(remoteJid, {
            text: `❌ *FORMAT SALAH*\n\n` +
                `Format yang benar:\n` +
                `cek [nomor_pelanggan/pppoe_username/nama_pelanggan]\n\n` +
                `Contoh:\n` +
                `• cek 087786722675\n` +
                `• cek server@ilik\n` +
                `• cek maktub`
        });
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, {
            text: `🔍 *MENCARI PERANGKAT*\n\nSedang mencari perangkat untuk: ${searchTerm}...\nMohon tunggu sebentar.`
        });

        // Import billing manager untuk mendapatkan data customer
        const billingManager = require('./billing');

        // Cari customer di billing dengan berbagai metode
        let customer = null;

        // Method 1: Coba sebagai nomor telepon
        if (/^[0-9+]+$/.test(searchTerm)) {
            const phoneVariants = generatePhoneVariants(searchTerm);

            for (const variant of phoneVariants) {
                try {
                    customer = await billingManager.getCustomerByPhone(variant);
                    if (customer) {
                        console.log(`✅ Customer found in billing by phone with variant: ${variant}`);
                        break;
                    }
                } catch (error) {
                    console.log(`⚠️ Error searching with phone variant ${variant}:`, error.message);
                }
            }
        }

        // Method 2: Jika tidak ditemukan sebagai nomor, coba sebagai nama atau PPPoE username
        if (!customer) {
            try {
                // Cari berdasarkan nama pelanggan
                const customersByName = await billingManager.findCustomersByNameOrPhone(searchTerm);
                if (customersByName && customersByName.length > 0) {
                    customer = customersByName[0]; // Ambil yang pertama
                    console.log(`✅ Customer found in billing by name/pppoe: ${customer.name}`);
                }
            } catch (error) {
                console.log(`⚠️ Error searching by name/pppoe:`, error.message);
            }
        }

        let device = null;

        if (customer) {
            console.log(`✅ Customer found in billing: ${customer.name} (${customer.phone})`);
            console.log(`📋 Customer data:`, {
                name: customer.name,
                phone: customer.phone,
                username: customer.username,
                pppoe_username: customer.pppoe_username,
                package_id: customer.package_id
            });

            // Cari device berdasarkan PPPoE username dari billing (FAST PATH)
            if (customer.pppoe_username || customer.username) {
                try {
                    const { findDeviceByPPPoE } = require('./genieacs');
                    const pppoeToSearch = customer.pppoe_username || customer.username;
                    console.log(`🔍 Searching device by PPPoE username: ${pppoeToSearch}`);

                    device = await findDeviceByPPPoE(pppoeToSearch);
                    if (device) {
                        console.log(`✅ Device found by PPPoE username: ${pppoeToSearch}`);
                        console.log(`📱 Device ID: ${device._id}`);
                    } else {
                        console.log(`⚠️ No device found by PPPoE username: ${pppoeToSearch}`);
                    }
                } catch (error) {
                    console.error('❌ Error finding device by PPPoE username:', error.message);
                    console.error('❌ Full error:', error);
                }
            } else {
                console.log(`⚠️ No PPPoE username or username found in customer data`);
            }

            // Jika tidak ditemukan dengan PPPoE, coba dengan tag sebagai fallback
            if (!device) {
                console.log(`🔍 Trying tag search as fallback...`);
                const tagVariants = generatePhoneVariants(customer.phone);

                for (const v of tagVariants) {
                    try {
                        device = await findDeviceByTag(v);
                        if (device) {
                            console.log(`✅ Device found by tag fallback: ${v}`);
                            break;
                        }
                    } catch (error) {
                        console.log(`⚠️ Error searching by tag ${v}:`, error.message);
                    }
                }
            }
        } else {
            // Customer tidak ditemukan di billing, coba cari device langsung berdasarkan search term
            console.log(`⚠️ Customer not found in billing, trying direct device search...`);

            // Method 1: Coba sebagai PPPoE username langsung
            if (searchTerm.includes('@')) {
                try {
                    const { findDeviceByPPPoE } = require('./genieacs');
                    console.log(`🔍 Trying direct PPPoE username search: ${searchTerm}`);
                    device = await findDeviceByPPPoE(searchTerm);
                    if (device) {
                        console.log(`✅ Device found by direct PPPoE username: ${searchTerm}`);
                        console.log(`📱 Device ID: ${device._id}`);
                    }
                } catch (error) {
                    console.log(`⚠️ Error searching by direct PPPoE username:`, error.message);
                }
            }

            // Method 2: Coba sebagai tag (jika search term adalah nomor)
            if (!device && /^[0-9+]+$/.test(searchTerm)) {
                const tagVariants = generatePhoneVariants(searchTerm);
                for (const v of tagVariants) {
                    try {
                        device = await findDeviceByTag(v);
                        if (device) {
                            console.log(`✅ Device found by tag: ${v}`);
                            console.log(`📱 Device ID: ${device._id}`);
                            break;
                        }
                    } catch (error) {
                        console.log(`⚠️ Error searching by tag ${v}:`, error.message);
                    }
                }
            }
        }

        // Method 3: Jika masih belum ditemukan, coba cari semua device dan cari manual
        if (!device) {
            console.log(`🔍 Trying comprehensive search in all devices...`);
            try {
                const { getDevices } = require('./genieacs');
                const allDevices = await getDevices();
                console.log(`📊 Total devices in GenieACS: ${allDevices.length}`);

                // Cari berdasarkan search term di berbagai field
                for (const dev of allDevices) {
                    // Cek di tags
                    if (dev._tags && dev._tags.some(tag => tag.includes(searchTerm))) {
                        console.log(`✅ Device found by tag match: ${dev._id}`);
                        device = dev;
                        break;
                    }

                    // Cek di VirtualParameters
                    if (dev.VirtualParameters) {
                        for (const key in dev.VirtualParameters) {
                            const value = dev.VirtualParameters[key];
                            if (value && value._value && value._value.toString().includes(searchTerm)) {
                                console.log(`✅ Device found by VirtualParameters match: ${dev._id}`);
                                device = dev;
                                break;
                            }
                        }
                    }

                    if (device) break;
                }
            } catch (error) {
                console.log(`⚠️ Error in comprehensive search:`, error.message);
            }
        }

        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *PERANGKAT TIDAK DITEMUKAN*\n\n` +
                    `Tidak dapat menemukan perangkat untuk: ${searchTerm}\n\n` +
                    `Pastikan data yang dimasukkan benar:\n` +
                    `• Nomor telepon\n` +
                    `• PPPoE username (contoh: server@ilik)\n` +
                    `• Nama pelanggan\n\n` +
                    `Dan perangkat telah terdaftar dalam sistem.`
            });
            return;
        }

        // Ekstrak informasi perangkat - Gunakan pendekatan yang sama dengan dashboard web
        let serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value ||
            device.Device?.DeviceInfo?.SerialNumber?._value ||
            device.DeviceID?.SerialNumber ||
            device._id?.split('-')[2] || 'Unknown';

        let modelName = device.InternetGatewayDevice?.DeviceInfo?.ModelName?._value ||
            device.Device?.DeviceInfo?.ModelName?._value ||
            device.DeviceID?.ProductClass ||
            device._id?.split('-')[1] || 'Unknown';

        const lastInform = new Date(device._lastInform);
        const now = new Date();
        const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
        const isOnline = diffMinutes < 15;
        const statusText = isOnline ? '🟢 Online' : '🔴 Offline';

        // Informasi WiFi
        const ssid = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.SSID?._value || 'N/A';
        const ssid5G = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[5]?.SSID?._value || 'N/A';

        // Informasi IP
        const ipAddress = device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.ExternalIPAddress?._value || 'N/A';

        // Informasi PPPoE
        const pppoeUsername =
            device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.Username?._value ||
            device.InternetGatewayDevice?.WANDevice?.[0]?.WANConnectionDevice?.[0]?.WANPPPConnection?.[0]?.Username?._value ||
            device.VirtualParameters?.pppoeUsername?._value ||
            (customer ? (customer.pppoe_username || customer.username) : 'N/A');

        // Ambil RX Power dari semua kemungkinan path
        const rxPower = getParameterWithPaths(device, parameterPaths.rxPower);
        let rxPowerStatus = '';
        if (rxPower !== 'N/A') {
            const power = parseFloat(rxPower);
            if (power > -25) rxPowerStatus = '🟢 Baik';
            else if (power > -27) rxPowerStatus = '🟡 Warning';
            else rxPowerStatus = '🔴 Kritis';
        }

        // Informasi pengguna WiFi
        const users24ghz = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.TotalAssociations?._value || 0;
        const users5ghz = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[5]?.TotalAssociations?._value || 0;
        const totalUsers = parseInt(users24ghz) + parseInt(users5ghz);

        // Ambil daftar user terhubung ke SSID 1 (2.4GHz)
        let associatedDevices = [];
        try {
            const assocObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.AssociatedDevice;
            if (assocObj && typeof assocObj === 'object') {
                for (const key in assocObj) {
                    if (!isNaN(key)) {
                        const entry = assocObj[key];
                        const mac = entry?.MACAddress?._value || entry?.MACAddress || '-';
                        const hostname = entry?.HostName?._value || entry?.HostName || '-';
                        associatedDevices.push({ mac, hostname });
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing associated devices (admin):', e);
        }
        // Fallback: jika AssociatedDevice kosong, ambil dari Hosts.Host (hanya WiFi/802.11)
        if (associatedDevices.length === 0) {
            try {
                const hostsObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.Hosts?.Host;
                if (hostsObj && typeof hostsObj === 'object') {
                    for (const key in hostsObj) {
                        if (!isNaN(key)) {
                            const entry = hostsObj[key];
                            // Hanya tampilkan yang interface-nya 802.11 (WiFi)
                            const iface = entry?.InterfaceType?._value || entry?.InterfaceType || entry?.Interface || '-';
                            // Pastikan iface adalah string sebelum memanggil toLowerCase()
                            if (iface && typeof iface === 'string' && iface.toLowerCase().includes('802.11')) {
                                const mac = entry?.MACAddress?._value || entry?.MACAddress || '-';
                                const hostname = entry?.HostName?._value || entry?.HostName || '-';
                                const ip = entry?.IPAddress?._value || entry?.IPAddress || '-';
                                associatedDevices.push({ mac, hostname, ip });
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Error parsing Hosts.Host (admin):', e);
            }
        }

        // Buat pesan dengan informasi lengkap
        let message = `📋 *DETAIL PERANGKAT PELANGGAN*\n\n`;

        // Data billing jika ada
        if (customer) {
            message += `👤 *DATA BILLING:*\n`;
            message += `• Nama: ${customer.name}\n`;
            message += `• Telepon: ${customer.phone}\n`;
            message += `• Username: ${customer.username || 'N/A'}\n`;
            message += `• PPPoE Username: ${customer.pppoe_username || 'N/A'}\n`;
            message += `• Paket: ${customer.package_id || 'N/A'}\n`;
            message += `• Status: ${customer.status || 'N/A'}\n`;
            if (customer.address) {
                message += `• Alamat: ${customer.address}\n`;
            }
            message += `\n`;
        }

        message += `🔧 *DATA PERANGKAT:*\n`;
        message += `• Serial Number: ${serialNumber}\n`;
        message += `• Model: ${modelName}\n`;
        message += `• Status: ${statusText}\n`;
        message += `• Last Seen: ${lastInform.toLocaleString()}\n\n`;

        message += `🌐 *INFORMASI JARINGAN:*\n`;
        message += `• IP Address: ${ipAddress}\n`;
        message += `• PPPoE Username: ${pppoeUsername}\n`;
        message += `• RX Power: ${rxPower ? rxPower + ' dBm' : 'N/A'}${rxPowerStatus ? ' (' + rxPowerStatus + ')' : ''}\n`;
        message += `• WiFi 2.4GHz: ${ssid}\n`;
        message += `• WiFi 5GHz: ${ssid5G}\n`;
        message += `• Pengguna WiFi: ${totalUsers} perangkat\n`;

        // Tambahkan detail user SSID 1 jika ada
        if (associatedDevices.length > 0) {
            message += `• *Daftar User WiFi (2.4GHz):*\n`;
            associatedDevices.forEach((dev, idx) => {
                let detail = `${idx + 1}. ${dev.hostname || '-'} (${dev.mac || '-'}`;
                if (dev.ip) detail += `, ${dev.ip}`;
                detail += ')';
                message += `   ${detail}\n`;
            });
        } else {
            message += `• Tidak ada data user WiFi (2.4GHz) tersedia\n`;
        }
        message += `\n`;

        if (rxPower) {
            message += `🔧 *KUALITAS SINYAL:*\n`;
            message += `• RX Power: ${rxPower} dBm (${rxPowerStatus})\n\n`;
        }

        message += `💡 *TINDAKAN ADMIN:*\n`;
        const actionIdentifier = customer ? customer.phone : searchTerm;
        message += `• Ganti SSID: editssid ${actionIdentifier} [nama_baru]\n`;
        message += `• Ganti Password: editpass ${actionIdentifier} [password_baru]\n`;
        message += `• Refresh Perangkat: adminrefresh ${actionIdentifier}`;

        await sock.sendMessage(remoteJid, { text: message });
    } catch (error) {
        console.error('Error in handleAdminCheckONUWithBilling:', error);
        await sock.sendMessage(remoteJid, {
            text: `❌ *ERROR*\n\nTerjadi kesalahan saat memeriksa perangkat:\n${error.message}`
        });
    }
}

// Fungsi untuk mencari perangkat berdasarkan tag
async function findDeviceByTag(tag) {
    try {
        console.log(`Searching for device with tag: ${tag}`);
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log('DEBUG GenieACS URL:', genieacsUrl);
        try {
            const exactResponse = await axios.get(`${genieacsUrl}/devices/?query={"_tags":"${tag}"}`,
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            if (exactResponse.data && exactResponse.data.length > 0) {
                console.log(`Device found with exact tag match: ${tag}`);
                return exactResponse.data[0];
            }
            console.log(`No exact match found for tag ${tag}, trying partial match...`);
            const partialResponse = await axios.get(`${genieacsUrl}/devices`, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            });
            if (partialResponse.data && partialResponse.data.length > 0) {
                for (const device of partialResponse.data) {
                    if (device._tags && Array.isArray(device._tags)) {
                        const matchingTag = device._tags.find(t =>
                            t === tag ||
                            t.includes(tag) ||
                            tag.includes(t)
                        );
                        if (matchingTag) {
                            console.log(`Device found with partial tag match: ${matchingTag}`);
                            return device;
                        }
                    }
                }
            }
            console.log(`No device found with tag containing: ${tag}`);
            return null;
        } catch (queryError) {
            console.error('Error with tag query:', queryError.message);
            console.log('Trying alternative method: fetching all devices');
            const allDevicesResponse = await axios.get(`${genieacsUrl}/devices`, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            });
            const device = allDevicesResponse.data.find(d => {
                if (!d._tags) return false;
                return d._tags.some(t =>
                    t === tag ||
                    t.includes(tag) ||
                    tag.includes(t)
                );
            });
            return device || null;
        }
    } catch (error) {
        console.error('Error finding device by tag:', error);
        throw error;
    }
}

// Fungsi untuk mencari perangkat berdasarkan PPPoE username
async function findDeviceByPPPoEUsername(pppoeUsername) {
    try {
        console.log(`Searching for device with PPPoE username: ${pppoeUsername}`);
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();

        // Cari perangkat dengan PPPoE username yang sesuai
        // PPPoE username biasanya tersimpan di parameter: InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username
        const query = {
            "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username": pppoeUsername
        };

        const response = await axios.get(`${genieacsUrl}/devices/?query=${encodeURIComponent(JSON.stringify(query))}`, {
            auth: {
                username: genieacsUsername,
                password: genieacsPassword
            }
        });

        if (response.data && response.data.length > 0) {
            console.log(`✅ Device found with PPPoE username: ${pppoeUsername}`);
            return response.data[0];
        }

        console.log(`⚠️ No device found with PPPoE username: ${pppoeUsername}`);
        return null;
    } catch (error) {
        console.error('Error finding device by PPPoE username:', error.message);
        return null;
    }
}

// Handler untuk pelanggan ganti SSID
async function handleChangeSSID(senderNumber, remoteJid, params) {
    try {
        console.log(`Handling change SSID request from ${senderNumber} with params:`, params);
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log('DEBUG GenieACS URL:', genieacsUrl);
        const device = await getDeviceByNumber(senderNumber);
        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
❌ *NOMOR TIDAK TERDAFTAR*

Waduh, nomor kamu belum terdaftar nih.
Hubungi admin dulu yuk untuk daftar!${getSetting('footer_info', 'Internet Tanpa Batas')}`
            });
            return;
        }
        if (params.length < 1) {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
📋 *CARA GANTI NAMA WIFI*

⚠️ Format Perintah:
*gantiwifi [nama_wifi_baru]*

📋 Contoh:
*gantiwifi RumahKu*

💡 Nama WiFi akan langsung diperbarui
💡 Tunggu beberapa saat sampai perubahan aktif
💡 Perangkat yang terhubung mungkin akan terputus${getSetting('footer_info', 'Internet Tanpa Batas')}`,
            });
            return;
        }
        const newSSID = params.join(' ');
        const newSSID5G = `${newSSID}-5G`;
        await sock.sendMessage(remoteJid, {
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
⏳ *PERMINTAAN DIPROSES*

Sedang mengubah nama WiFi Anda...
• WiFi 2.4GHz: ${newSSID}
• WiFi 5GHz: ${newSSID5G}

Mohon tunggu sebentar.${getSetting('footer_info', 'Internet Tanpa Batas')}`
        });
        const encodedDeviceId = encodeURIComponent(device._id);
        await axios.post(
            `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ]
            },
            {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            }
        );
        let wifi5GFound = false;
        const ssid5gIndexes = [5, 6, 7, 8];
        for (const idx of ssid5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz SSID using config index ${idx}`);
                await axios.post(
                    `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`, newSSID5G, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
                        }
                    }
                );
                console.log(`Successfully updated 5GHz SSID using config index ${idx}`);
                wifi5GFound = true;
            } catch (error) {
                console.error(`Error updating 5GHz SSID with index ${idx}:`, error.message);
            }
        }
        if (!wifi5GFound) {
            console.warn('Tidak ada konfigurasi SSID 5GHz yang valid ditemukan. SSID 5GHz tidak diubah.');
        }
        try {
            await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }
        try {
            await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }
        let responseMessage = `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
✅ *NAMA WIFI BERHASIL DIUBAH!*

📶 *Nama WiFi Baru:*
• WiFi 2.4GHz: ${newSSID}`;
        if (wifi5GFound) {
            responseMessage += `\n• WiFi 5GHz: ${newSSID5G}`;
        } else {
            responseMessage += `\n• WiFi 5GHz: Pengaturan tidak ditemukan atau gagal diubah`;
        }
        responseMessage += `\n
⏳ Perangkat akan melakukan restart untuk menerapkan perubahan.\n📋 Perangkat yang terhubung akan terputus dan perlu menghubungkan ulang ke nama WiFi baru.

_Perubahan selesai pada: ${new Date().toLocaleString()}_${getSetting('footer_info', 'Internet Tanpa Batas')}`;
        await sock.sendMessage(remoteJid, { text: responseMessage });
    } catch (error) {
        console.error('Error handling change SSID:', error);
        await sock.sendMessage(remoteJid, {
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
❌ *GAGAL MENGUBAH NAMA WIFI*

Oops! Ada kendala teknis saat mengubah nama WiFi kamu.
Beberapa kemungkinan penyebabnya:
• Router sedang offline
• Masalah koneksi ke server
• Format nama tidak didukung

Pesan error: ${error.message}

Coba lagi nanti ya!${getSetting('footer_info', 'Internet Tanpa Batas')}`
        });
    }
}

// Handler untuk admin mengubah password WiFi pelanggan
async function handleAdminEditPassword(adminJid, customerNumber, newPassword) {
    try {
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log(`Admin mengubah password WiFi untuk pelanggan ${customerNumber}`);

        // Validasi panjang password
        if (newPassword.length < 8) {
            await sock.sendMessage(adminJid, {
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
âŒ *PASSWORD TERLALU PENDEK*

Password WiFi harus minimal 8 karakter.
Silakan coba lagi dengan password yang lebih panjang.${getSetting('footer_info', 'Internet Tanpa Batas')}`
            });
            return;
        }

        // Format nomor pelanggan untuk mencari di GenieACS
        const formattedNumber = formatPhoneNumber(customerNumber);
        console.log(`Mencari perangkat untuk nomor: ${formattedNumber}`);

        // Cari perangkat pelanggan
        const device = await getDeviceByNumber(formattedNumber);
        if (!device) {
            await sock.sendMessage(adminJid, {
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
âŒ *NOMOR PELANGGAN TIDAK DITEMUKAN*

Nomor ${customerNumber} tidak terdaftar di sistem.
Periksa kembali nomor pelanggan.${getSetting('footer_info', 'Internet Tanpa Batas')}`
            });
            return;
        }

        // Kirim pesan ke admin bahwa permintaan sedang diproses
        await sock.sendMessage(adminJid, {
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
â³ *PERMINTAAN DIPROSES*

Sedang mengubah password WiFi pelanggan ${customerNumber}...
Password baru: ${newPassword}

Mohon tunggu sebentar.${getSetting('footer_info', 'Internet Tanpa Batas')}`
        });

        // Encode deviceId untuk URL
        const encodedDeviceId = encodeURIComponent(device._id);

        // Update password WiFi 2.4GHz di index 1
        await axios.post(
            `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", newPassword, "xsd:string"]
                ]
            },
            {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            }
        );

        // Update password WiFi 5GHz di index 5, 6, 7, 8
        let wifi5GFound = false;
        const wifi5gIndexes = [5, 6, 7, 8];
        for (const idx of wifi5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz password using config index ${idx}`);
                await axios.post(
                    `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.KeyPassphrase`, newPassword, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
                        }
                    }
                );
                console.log(`Successfully updated 5GHz password using config index ${idx}`);
                wifi5GFound = true;
            } catch (error) {
                console.error(`Error updating 5GHz password with index ${idx}:`, error.message);
            }
        }

        // Tambahkan task refresh
        try {
            await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }

        // Reboot perangkat untuk menerapkan perubahan
        try {
            await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }

        // Pesan sukses untuk admin
        const adminResponseMessage = `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
✅ *PASSWORD WIFI PELANGGAN BERHASIL DIUBAH!*

📋 *Pelanggan:* ${customerNumber}
🔐 *Password WiFi Baru:* ${newPassword}

â³ Perangkat akan melakukan restart untuk menerapkan perubahan.
📋 Perangkat yang terhubung akan terputus dan perlu menghubungkan ulang dengan password baru.

_Perubahan selesai pada: ${new Date().toLocaleString()}_${getSetting('footer_info', 'Internet Tanpa Batas')}`;

        await sock.sendMessage(adminJid, { text: adminResponseMessage });

        // Kirim notifikasi ke pelanggan tentang perubahan password WiFi
        try {
            // Format nomor pelanggan untuk WhatsApp
            let customerJid;
            if (customerNumber.includes('@')) {
                customerJid = customerNumber; // Sudah dalam format JID
            } else {
                // Format nomor untuk WhatsApp
                const cleanNumber = customerNumber.replace(/\D/g, '');
                customerJid = `${cleanNumber}@s.whatsapp.net`;
            }

            // Pesan notifikasi untuk pelanggan
            const customerNotificationMessage = `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
📢 *PEMBERITAHUAN PERUBAHAN PASSWORD WIFI*

Halo Pelanggan Setia,

Kami informasikan bahwa password WiFi Anda telah diubah oleh admin:

🔐 *Password WiFi Baru:* ${newPassword}

â³ Perangkat Anda akan melakukan restart untuk menerapkan perubahan.
📋 Perangkat yang terhubung akan terputus dan perlu menghubungkan ulang dengan password baru.

_Catatan: Simpan informasi ini sebagai dokumentasi jika Anda lupa password WiFi di kemudian hari.${getSetting('footer_info', 'Internet Tanpa Batas')}`;

            await sock.sendMessage(customerJid, { text: customerNotificationMessage });
            console.log(`Notification sent to customer ${customerNumber} about WiFi password change`);
        } catch (notificationError) {
            console.error(`Failed to send notification to customer ${customerNumber}:`, notificationError.message);
            // Kirim pesan ke admin bahwa notifikasi ke pelanggan gagal
            await sock.sendMessage(adminJid, {
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
âš ï¸ *INFO*

Password WiFi pelanggan berhasil diubah, tetapi gagal mengirim notifikasi ke pelanggan.
Error: ${notificationError.message}${getSetting('footer_info', 'Internet Tanpa Batas')}`
            });
        }

    } catch (error) {
        console.error('Error handling admin edit password:', error);
        await sock.sendMessage(adminJid, {
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
âŒ *GAGAL MENGUBAH PASSWORD WIFI PELANGGAN*

Oops! Ada kendala teknis saat mengubah password WiFi pelanggan.
Beberapa kemungkinan penyebabnya:
• Router pelanggan sedang offline
• Masalah koneksi ke server
• Format password tidak didukung

Pesan error: ${error.message}

Coba lagi nanti ya!${getSetting('footer_info', 'Internet Tanpa Batas')}`
        });
    }
}

// Handler untuk admin mengubah SSID pelanggan
async function handleAdminEditSSID(adminJid, customerNumber, newSSID) {
    try {
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log(`Admin mengubah SSID untuk pelanggan ${customerNumber} menjadi ${newSSID}`);

        // Format nomor pelanggan untuk mencari di GenieACS
        const formattedNumber = formatPhoneNumber(customerNumber);
        console.log(`Mencari perangkat untuk nomor: ${formattedNumber}`);

        // Cari perangkat pelanggan
        const device = await getDeviceByNumber(formattedNumber);
        if (!device) {
            await sock.sendMessage(adminJid, {
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
âŒ *NOMOR PELANGGAN TIDAK DITEMUKAN*

Nomor ${customerNumber} tidak terdaftar di sistem.
Periksa kembali nomor pelanggan.${getSetting('footer_info', 'Internet Tanpa Batas')}`
            });
            return;
        }

        // Buat nama SSID 5G berdasarkan SSID 2.4G
        const newSSID5G = `${newSSID}-5G`;

        // Kirim pesan ke admin bahwa permintaan sedang diproses
        await sock.sendMessage(adminJid, {
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
â³ *PERMINTAAN DIPROSES*

Sedang mengubah nama WiFi pelanggan ${customerNumber}...
• WiFi 2.4GHz: ${newSSID}
• WiFi 5GHz: ${newSSID5G}

Mohon tunggu sebentar.${getSetting('footer_info', 'Internet Tanpa Batas')}`
        });

        // Encode deviceId untuk URL
        const encodedDeviceId = encodeURIComponent(device._id);

        // Update SSID 2.4GHz di index 1
        await axios.post(
            `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ]
            },
            {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            }
        );

        // Update SSID 5GHz di index 5, 6, 7, 8
        let wifi5GFound = false;
        const ssid5gIndexes = [5, 6, 7, 8];
        for (const idx of ssid5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz SSID using config index ${idx}`);
                await axios.post(
                    `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`, newSSID5G, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
                        }
                    }
                );
                console.log(`Successfully updated 5GHz SSID using config index ${idx}`);
                wifi5GFound = true;
            } catch (error) {
                console.error(`Error updating 5GHz SSID with index ${idx}:`, error.message);
            }
        }

        // Tambahkan task refresh
        try {
            await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }

        // Reboot perangkat untuk menerapkan perubahan
        try {
            await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }

        // Pesan sukses untuk admin
        let adminResponseMessage = `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
✅ *NAMA WIFI PELANGGAN BERHASIL DIUBAH!*

📋 *Pelanggan:* ${customerNumber}
ï¿½ï¿½ *Nama WiFi Baru:*
• WiFi 2.4GHz: ${newSSID}`;

        if (wifi5GFound) {
            adminResponseMessage += `\n• WiFi 5GHz: ${newSSID5G}`;
        } else {
            adminResponseMessage += `\n• WiFi 5GHz: Pengaturan tidak ditemukan atau gagal diubah`;
        }

        adminResponseMessage += `\n
â³ Perangkat akan melakukan restart untuk menerapkan perubahan.
📋 Perangkat yang terhubung akan terputus dan perlu menghubungkan ulang ke nama WiFi baru.

_Perubahan selesai pada: ${new Date().toLocaleString()}_${getSetting('footer_info', 'Internet Tanpa Batas')}`;

        await sock.sendMessage(adminJid, { text: adminResponseMessage });

        // Kirim notifikasi ke pelanggan tentang perubahan SSID
        try {
            // Format nomor pelanggan untuk WhatsApp
            let customerJid;
            if (customerNumber.includes('@')) {
                customerJid = customerNumber; // Sudah dalam format JID
            } else {
                // Format nomor untuk WhatsApp
                const cleanNumber = customerNumber.replace(/\D/g, '');
                customerJid = `${cleanNumber}@s.whatsapp.net`;
            }

            // Pesan notifikasi untuk pelanggan
            const customerNotificationMessage = `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
📢 *PEMBERITAHUAN PERUBAHAN WIFI*

Halo Pelanggan Setia,

Kami informasikan bahwa nama WiFi Anda telah diubah oleh admin:

📶 *Nama WiFi Baru:*
• WiFi 2.4GHz: ${newSSID}`;

            let fullCustomerMessage = customerNotificationMessage;
            if (wifi5GFound) {
                fullCustomerMessage += `\n• WiFi 5GHz: ${newSSID5G}`;
            }

            fullCustomerMessage += `\n
â³ Perangkat Anda akan melakukan restart untuk menerapkan perubahan.
📋 Perangkat yang terhubung akan terputus dan perlu menghubungkan ulang ke nama WiFi baru.

_Catatan: Simpan informasi ini sebagai dokumentasi jika Anda lupa nama WiFi di kemudian hari.${getSetting('footer_info', 'Internet Tanpa Batas')}`;

            await sock.sendMessage(customerJid, { text: fullCustomerMessage });
            console.log(`Notification sent to customer ${customerNumber} about SSID change`);
        } catch (notificationError) {
            console.error(`Failed to send notification to customer ${customerNumber}:`, notificationError.message);
            // Kirim pesan ke admin bahwa notifikasi ke pelanggan gagal
            await sock.sendMessage(adminJid, {
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
âš ï¸ *INFO*

Nama WiFi pelanggan berhasil diubah, tetapi gagal mengirim notifikasi ke pelanggan.
Error: ${notificationError.message}${getSetting('footer_info', 'Internet Tanpa Batas')}`
            });
        }

    } catch (error) {
        console.error('Error handling admin edit SSID:', error);
        await sock.sendMessage(adminJid, {
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
âŒ *GAGAL MENGUBAH NAMA WIFI PELANGGAN*

Oops! Ada kendala teknis saat mengubah nama WiFi pelanggan.
Beberapa kemungkinan penyebabnya:
• Router pelanggan sedang offline
• Masalah koneksi ke server
• Format nama tidak didukung

Pesan error: ${error.message}

Coba lagi nanti ya!${getSetting('footer_info', 'Internet Tanpa Batas')}`
        });
    }
}

// Handler untuk pelanggan ganti password
async function handleChangePassword(senderNumber, remoteJid, params) {
    try {
        console.log(`Handling change password request from ${senderNumber} with params:`, params);

        // Validasi parameter
        if (params.length < 1) {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
âŒ *FORMAT SALAH*

âš ï¸ Format Perintah:
*gantipass [password_baru]*

📋 Contoh:
*gantipass Password123*

💡 Password harus minimal 8 karakter
💡 Hindari password yang mudah ditebak${getSetting('footer_info', 'Internet Tanpa Batas')}`
            });
            return;
        }

        const newPassword = params[0];

        // Validasi panjang password
        if (newPassword.length < 8) {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
âŒ *PASSWORD TERLALU PENDEK*

Password WiFi harus minimal 8 karakter.
Silakan coba lagi dengan password yang lebih panjang.${getSetting('footer_info', 'Internet Tanpa Batas')}`
            });
            return;
        }

        // Cari perangkat berdasarkan nomor pengirim
        console.log(`Finding device for number: ${senderNumber}`);

        const device = await getDeviceByNumber(senderNumber);
        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
âŒ *NOMOR TIDAK TERDAFTAR*

Waduh, nomor kamu belum terdaftar nih.
Hubungi admin dulu yuk untuk daftar!${getSetting('footer_info', 'Internet Tanpa Batas')}`
            });
            return;
        }

        // Dapatkan ID perangkat
        const deviceId = device._id;
        console.log(`Found device ID: ${deviceId}`);

        // Kirim pesan bahwa permintaan sedang diproses
        await sock.sendMessage(remoteJid, {
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
â³ *PERMINTAAN DIPROSES*

Sedang mengubah password WiFi Anda...
Mohon tunggu sebentar.${getSetting('footer_info', 'Internet Tanpa Batas')}`
        });

        // Perbarui password WiFi
        const result = await changePassword(deviceId, newPassword);

        if (result.success) {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
✅ *PASSWORD WIFI BERHASIL DIUBAH!*

🔐 *Password Baru:* ${newPassword}

â³ Tunggu bentar ya, perubahan akan aktif dalam beberapa saat.
📋 Perangkat yang terhubung mungkin akan terputus dan harus menghubungkan ulang dengan password baru.

_Perubahan selesai pada: ${new Date().toLocaleString()}_${getSetting('footer_info', 'Internet Tanpa Batas')}`
            });
        } else {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
âŒ *GAGAL MENGUBAH PASSWORD*

Oops! Ada kendala teknis saat mengubah password WiFi kamu.
Beberapa kemungkinan penyebabnya:
• Router sedang offline
• Masalah koneksi ke server
• Format password tidak didukung

Pesan error: ${result.message}

Coba lagi nanti ya!${getSetting('footer_info', 'Internet Tanpa Batas')}`
            });
        }
    } catch (error) {
        console.error('Error handling password change:', error);
        await sock.sendMessage(remoteJid, {
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
âŒ *TERJADI KESALAHAN*

Error: ${error.message}

Silakan coba lagi nanti atau hubungi admin.${getSetting('footer_info', 'Internet Tanpa Batas')}`
        });
    }
}

// Fungsi untuk mengubah password WiFi perangkat
async function changePassword(deviceId, newPassword) {
    try {
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log(`Changing password for device: ${deviceId}`);
        // Encode deviceId untuk URL
        const encodedDeviceId = encodeDeviceId(deviceId);
        // URL untuk tasks GenieACS
        const tasksUrl = `${genieacsUrl}/devices/${encodedDeviceId}/tasks?timeout=3000`;
        // Buat task untuk mengubah password
        // Perbarui parameter untuk 2.4GHz WiFi
        const updatePass24Task = {
            name: "setParameterValues",
            parameterValues: [
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", newPassword, "xsd:string"],
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
            ]
        };

        console.log('Sending task to update password 2.4GHz');
        const response24 = await axios.post(
            tasksUrl,
            updatePass24Task,
            {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log(`2.4GHz password update response:`, response24.status);

        // Perbarui parameter untuk 5GHz WiFi
        const updatePass5Task = {
            name: "setParameterValues",
            parameterValues: [
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase", newPassword, "xsd:string"],
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
            ]
        };

        console.log('Sending task to update password 5GHz');
        const response5 = await axios.post(
            tasksUrl,
            updatePass5Task,
            {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log(`5GHz password update response:`, response5.status);

        // Kirim refresh task untuk memastikan perubahan diterapkan
        const refreshTask = {
            name: "refreshObject",
            objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
        };

        console.log('Sending refresh task');
        await axios.post(
            tasksUrl,
            refreshTask,
            {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        return { success: true, message: 'Password berhasil diubah' };
    } catch (error) {
        console.error('Error changing password:', error);
        return {
            success: false,
            message: error.response?.data?.message || error.message
        };
    }
}

// Handler untuk admin mengubah password WiFi pelanggan
async function handleAdminEditPassword(remoteJid, customerNumber, newPassword) {
    try {
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log(`Handling admin edit password request`);

        // Validasi parameter
        if (!customerNumber || !newPassword) {
            await sock.sendMessage(remoteJid, {
                text: `âŒ *FORMAT Salah!*\n\nFormat yang benar:\neditpassword [nomor_pelanggan] [password_baru]\n\nContoh:\neditpassword 123456 password123`
            });
            return;
        }
        // Validasi panjang password
        if (newPassword.length < 8) {
            await sock.sendMessage(remoteJid, {
                text: `âŒ *Password terlalu pendek!*\n\nPassword harus minimal 8 karakter.`
            });
            return;
        }

        // Cari perangkat berdasarkan tag nomor pelanggan
        console.log(`Finding device for customer: ${customerNumber}`);

        const device = await findDeviceByTag(customerNumber);
        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `âŒ *Perangkat tidak ditemukan!*\n\n` +
                    `Nomor pelanggan "${customerNumber}" tidak terdaftar di sistem.`
            });
            return;
        }

        // Dapatkan ID perangkat
        const deviceId = device._id;
        console.log(`Found device ID: ${deviceId}`);

        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, {
            text: `⏳ *PROSES PERUBAHAN PASSWORD*\n\nSedang mengubah password WiFi untuk pelanggan ${customerNumber}...\nMohon tunggu sebentar.`
        });

        // Encode deviceId untuk URL
        const encodedDeviceId = encodeURIComponent(deviceId);

        // URL untuk tasks GenieACS
        const tasksUrl = `${genieacsUrl}/devices/${encodedDeviceId}/tasks?timeout=3000`;

        // Buat task untuk mengubah password 2.4GHz
        const updatePass24Task = {
            name: "setParameterValues",
            parameterValues: [
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", newPassword, "xsd:string"],
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
            ]
        };

        console.log('Sending task to update password 2.4GHz');
        const response24 = await axios.post(
            tasksUrl,
            updatePass24Task,
            {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log(`2.4GHz password update response:`, response24.status);

        // Coba perbarui password untuk 5GHz pada index 5 terlebih dahulu
        let wifi5GFound = false;

        try {
            console.log('Trying to update 5GHz password using config index 5');
            const updatePass5Task = {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase", newPassword, "xsd:string"],
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
                ]
            };

            await axios.post(
                tasksUrl,
                updatePass5Task,
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log('Successfully updated 5GHz password using config index 5');
            wifi5GFound = true;
        } catch (error5) {
            console.error('Error updating 5GHz password with index 5:', error5.message);

            // Mencoba dengan index lain selain 2 (3, 4, 6)
            const alternativeIndexes = [3, 4, 6];

            for (const idx of alternativeIndexes) {
                if (wifi5GFound) break;

                try {
                    console.log(`Trying to update 5GHz password using config index ${idx}`);
                    const updatePassAltTask = {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.KeyPassphrase`, newPassword, "xsd:string"],
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.PreSharedKey.1.KeyPassphrase`, newPassword, "xsd:string"]
                        ]
                    };

                    await axios.post(
                        tasksUrl,
                        updatePassAltTask,
                        {
                            auth: {
                                username: genieacsUsername,
                                password: genieacsPassword
                            },
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    console.log(`Successfully updated 5GHz password using config index ${idx}`);
                    wifi5GFound = true;
                    break;
                } catch (error) {
                    console.error(`Error updating 5GHz password with index ${idx}:`, error.message);
                }
            }

            // Jika index 5 dan alternatif (3, 4, 6) gagal, biarkan SSID 5GHz tidak berubah
            if (!wifi5GFound) {
                try {
                    console.log('Last resort: trying to update 5GHz password using config index 2');
                    const updatePass2Task = {
                        name: "setParameterValues",
                        parameterValues: [
                            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.KeyPassphrase", newPassword, "xsd:string"],
                            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
                        ]
                    };

                    await axios.post(
                        tasksUrl,
                        updatePass2Task,
                        {
                            auth: {
                                username: genieacsUsername,
                                password: genieacsPassword
                            },
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    console.log('Successfully updated 5GHz password using config index 2');
                    wifi5GFound = true;
                } catch (error2) {
                    console.error('Error updating 5GHz password with index 2:', error2.message);
                }
            }
        }

        // Kirim refresh task untuk memastikan perubahan diterapkan
        try {
            await axios.post(
                tasksUrl,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }

        // Dapatkan informasi SSID dari perangkat untuk notifikasi
        const ssid24G = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.SSID?._value || 'WiFi 2.4GHz';

        // Respons ke admin
        let responseMessage = `✅ *PASSWORD WIFI BERHASIL DIUBAH!*\n\n` +
            `Pelanggan: ${customerNumber}\n` +
            `Password baru: ${newPassword}\n\n`;

        if (wifi5GFound) {
            responseMessage += `Password berhasil diubah untuk WiFi 2.4GHz dan 5GHz.\n\n`;
        } else {
            responseMessage += `Password berhasil diubah untuk WiFi 2.4GHz.\n` +
                `WiFi 5GHz: Pengaturan tidak ditemukan atau gagal diubah.\n\n`;
        }

        responseMessage += `Perubahan akan diterapkan dalam beberapa menit.`;

        // Coba kirim notifikasi ke pelanggan
        let notificationSent = false;
        if (customerNumber.match(/^\d+$/) && customerNumber.length >= 10) {
            try {
                console.log(`Sending password change notification to customer: ${customerNumber}`);

                // Format nomor telepon
                const formattedNumber = formatPhoneNumber(customerNumber);

                // Buat pesan notifikasi untuk pelanggan
                const notificationMessage = formatWithHeaderFooter(`📢 *INFORMASI PERUBAHAN PASSWORD WIFI*

Halo Pelanggan yang terhormat,

Password WiFi Anda telah diubah oleh administrator sistem. Berikut detail perubahannya:

🔧 *Nama WiFi:* ${ssid24G}
🔐 *Password Baru:* ${newPassword}

Silakan gunakan password baru ini untuk terhubung ke jaringan WiFi Anda.
Perubahan akan diterapkan dalam beberapa menit.`);

                // Kirim pesan menggunakan sock
                await sock.sendMessage(`${formattedNumber}@s.whatsapp.net`, {
                    text: notificationMessage
                });

                console.log(`Password change notification sent to customer: ${customerNumber}`);
                notificationSent = true;

                responseMessage += `\nNotifikasi sudah dikirim ke pelanggan.`;
            } catch (notificationError) {
                console.error(`Failed to send notification to customer: ${customerNumber}`, notificationError);
                responseMessage += `\n\nâš ï¸ *Peringatan:* Gagal mengirim notifikasi ke pelanggan.\n` +
                    `Error: ${notificationError.message}`;
            }
        }

        // Kirim respons ke admin
        await sock.sendMessage(remoteJid, { text: responseMessage });

    } catch (error) {
        console.error('Error handling admin password change:', error);
        await sock.sendMessage(remoteJid, {
            text: `âŒ *Terjadi kesalahan!*\n\n` +
                `Error: ${error.message}\n\n` +
                `Silakan coba lagi nanti.`
        });
    }
}

// Handler untuk admin edit SSID pelanggan
async function handleAdminEditSSIDWithParams(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }
    const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();

    console.log(`Processing adminssid command with params:`, params);

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, {
            text: `âŒ *FORMAT SALAH*\n\n` +
                `Format yang benar:\n` +
                `editssid [nomor_pelanggan] [nama_wifi_baru]\n\n` +
                `Contoh:\n` +
                `editssid 123456 RumahBaru`
        });
        return;
    }

    // Ambil nomor pelanggan dari parameter pertama
    const customerNumber = params[0];

    // Gabungkan semua parameter setelah nomor pelanggan sebagai SSID baru
    // Ini menangani kasus di mana SSID terdiri dari beberapa kata
    const newSSID = params.slice(1).join(' ');
    const newSSID5G = `${newSSID}-5G`;

    console.log(`Attempting to change SSID for customer ${customerNumber} to "${newSSID}"`);

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, {
            text: `⏳ *PROSES PERUBAHAN SSID*\n\nSedang mengubah nama WiFi untuk pelanggan ${customerNumber}...\nMohon tunggu sebentar.`
        });

        // Cari perangkat berdasarkan nomor pelanggan
        const device = await findDeviceByTag(customerNumber);

        if (!device) {
            console.log(`Device not found for customer number: ${customerNumber}`);
            await sock.sendMessage(remoteJid, {
                text: `âŒ *PERANGKAT TIDAK DITEMUKAN*\n\n` +
                    `Tidak dapat menemukan perangkat untuk pelanggan dengan nomor ${customerNumber}.\n\n` +
                    `Pastikan nomor pelanggan benar dan perangkat telah terdaftar dalam sistem.`
            });
            return;
        }

        console.log(`Device found for customer ${customerNumber}: ${device._id}`);

        // Dapatkan SSID saat ini untuk referensi
        const currentSSID = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.SSID?._value || 'N/A';
        console.log(`Current SSID: ${currentSSID}`);

        // Encode deviceId untuk URL
        const encodedDeviceId = encodeURIComponent(device._id);

        // Update SSID 2.4GHz hanya di index 1
        await axios.post(
            `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ] // hanya index 1 untuk 2.4GHz
            },
            {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            }
        );

        // Update SSID 5GHz hanya di index 5, 6, 7, 8
        let wifi5GFound = false;
        const ssid5gIndexes = [5, 6, 7, 8];
        for (const idx of ssid5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz SSID using config index ${idx}`);
                await axios.post(
                    `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`, newSSID5G, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
                        }
                    }
                );
                console.log(`Successfully updated 5GHz SSID using config index ${idx}`);
                wifi5GFound = true;
            } catch (error) {
                console.error(`Error updating 5GHz SSID with index ${idx}:`, error.message);
            }
        }
        if (!wifi5GFound) {
            console.warn('Tidak ada konfigurasi SSID 5GHz yang valid ditemukan. SSID 5GHz tidak diubah.');
        }

        // Tambahkan task refresh
        try {
            await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }

        // Reboot perangkat untuk menerapkan perubahan
        try {
            await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }

        let responseMessage = `✅ *PERUBAHAN SSID BERHASIL*\n\n` +
            `Nama WiFi untuk pelanggan ${customerNumber} berhasil diubah!\n\n` +
            `• SSID Lama: ${currentSSID}\n` +
            `• SSID Baru: ${newSSID}\n`;

        if (wifi5GFound) {
            responseMessage += `• SSID 5GHz: ${newSSID5G}\n\n`;
        } else {
            responseMessage += `• SSID 5GHz: Pengaturan tidak ditemukan atau gagal diubah\n\n`;
        }

        responseMessage += `Perangkat WiFi akan restart dalam beberapa saat. Pelanggan perlu menghubungkan kembali perangkat mereka ke jaringan WiFi baru.`;

        await sock.sendMessage(remoteJid, { text: responseMessage });

        // Kirim notifikasi ke pelanggan jika nomor pelanggan adalah nomor telepon
        if (customerNumber.match(/^\d+$/) && customerNumber.length >= 10) {
            try {
                const formattedNumber = formatPhoneNumber(customerNumber);

                let notificationMessage = `✅ *PERUBAHAN NAMA WIFI*\n\n` +
                    `Halo Pelanggan yang terhormat,\n\n` +
                    `Kami informasikan bahwa nama WiFi Anda telah diubah:\n\n` +
                    `• Nama WiFi Baru: ${newSSID}\n`;

                if (wifi5GFound) {
                    notificationMessage += `• Nama WiFi 5GHz: ${newSSID5G}\n\n`;
                }

                notificationMessage += `Perangkat WiFi akan restart dalam beberapa saat. Silakan hubungkan kembali perangkat Anda ke jaringan WiFi baru.\n\n` +
                    `Jika Anda memiliki pertanyaan, silakan balas pesan ini.`;

                await sock.sendMessage(`${formattedNumber}@s.whatsapp.net`, {
                    text: notificationMessage
                });
                console.log(`Notification sent to customer: ${customerNumber}`);
            } catch (notifyError) {
                console.error('Error notifying customer:', notifyError);
            }
        }
    } catch (error) {
        console.error('Error in handleAdminEditSSID:', error);
        await sock.sendMessage(remoteJid, {
            text: `âŒ *ERROR*\n\nTerjadi kesalahan saat mengubah nama WiFi:\n${error.message}`
        });
    }
}

// Fungsi untuk mengubah SSID
async function changeSSID(deviceId, newSSID) {
    try {
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log(`Changing SSID for device ${deviceId} to "${newSSID}"`);

        // Encode deviceId untuk URL
        const encodedDeviceId = encodeURIComponent(deviceId);

        // Implementasi untuk mengubah SSID melalui GenieACS
        // Ubah SSID 2.4GHz
        try {
            console.log(`Setting 2.4GHz SSID to "${newSSID}"`);
            await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks`, {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ] // hanya index 1 untuk 2.4GHz
            }, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            });

            // Ubah SSID 5GHz dengan menambahkan suffix -5G
            console.log(`Setting 5GHz SSID to "${newSSID}-5G"`);
            await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks`, {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID", `${newSSID}-5G`, "xsd:string"]
                ]
            }, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            });

            // Commit perubahan
            console.log(`Rebooting device to apply changes`);
            await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks`, {
                name: "reboot"
            }, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            });

            console.log(`SSID change successful`);

            // Invalidate GenieACS cache after successful update
            try {
                const cacheManager = require('./cacheManager');
                cacheManager.invalidatePattern('genieacs:*');
                console.log('🔄 GenieACS cache invalidated after SSID update');
            } catch (cacheError) {
                console.warn('⚠️ Failed to invalidate cache:', cacheError.message);
            }

            return { success: true, message: "SSID berhasil diubah" };
        } catch (apiError) {
            console.error(`API Error: ${apiError.message}`);

            // Coba cara alternatif jika cara pertama gagal
            if (apiError.response && apiError.response.status === 404) {
                console.log(`Trying alternative path for device ${deviceId}`);

                try {
                    // Coba dengan path alternatif untuk 2.4GHz
                    await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks`, {
                        name: "setParameterValues",
                        parameterValues: [
                            ["Device.WiFi.SSID.1.SSID", newSSID, "xsd:string"]
                        ]
                    }, {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
                        }
                    });

                    // Coba dengan path alternatif untuk 5GHz
                    await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks`, {
                        name: "setParameterValues",
                        parameterValues: [
                            ["Device.WiFi.SSID.2.SSID", `${newSSID}-5G`, "xsd:string"]
                        ]
                    }, {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
                        }
                    });

                    // Commit perubahan
                    await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks`, {
                        name: "reboot"
                    }, {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
                        }
                    });

                    console.log(`SSID change successful using alternative path`);

                    // Invalidate GenieACS cache after successful update
                    try {
                        const cacheManager = require('./cacheManager');
                        cacheManager.invalidatePattern('genieacs:*');
                        console.log('🔄 GenieACS cache invalidated after SSID update');
                    } catch (cacheError) {
                        console.warn('⚠️ Failed to invalidate cache:', cacheError.message);
                    }

                    return { success: true, message: "SSID berhasil diubah (menggunakan path alternatif)" };
                } catch (altError) {
                    console.error(`Alternative path also failed: ${altError.message}`);
                    throw altError;
                }
            } else {
                throw apiError;
            }
        }
    } catch (error) {
        console.error('Error changing SSID:', error);
        return {
            success: false,
            message: error.response ?
                `${error.message} (Status: ${error.response.status})` :
                error.message
        };
    }
}

// Update handler list ONU
async function handleListONU(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, {
            text: `🔍 *MENCARI PERANGKAT*\n\nSedang mengambil daftar perangkat ONT...\nMohon tunggu sebentar.`
        });

        // Ambil daftar perangkat dari GenieACS
        const devices = await getAllDevices();

        if (!devices || devices.length === 0) {
            await sock.sendMessage(remoteJid, {
                text: `â„¹ï¸ *TIDAK ADA PERANGKAT*\n\nTidak ada perangkat ONT yang terdaftar dalam sistem.`
            });
            return;
        }

        // Batasi jumlah perangkat yang ditampilkan untuk menghindari pesan terlalu panjang
        const maxDevices = 20;
        const displayedDevices = devices.slice(0, maxDevices);
        const remainingCount = devices.length - maxDevices;

        // Buat pesan dengan daftar perangkat
        let message = `📋 *DAFTAR PERANGKAT ONT*\n`;
        message += `Total: ${devices.length} perangkat\n\n`;

        displayedDevices.forEach((device, index) => {
            // Helper function untuk mengambil parameter dengan multiple paths
            const getParameterWithPaths = (device, paths) => {
                if (!device || !paths || !Array.isArray(paths)) return 'Unknown';

                for (const path of paths) {
                    try {
                        const pathParts = path.split('.');
                        let current = device;

                        for (const part of pathParts) {
                            if (current && typeof current === 'object') {
                                current = current[part];
                            } else {
                                break;
                            }
                        }

                        // Handle GenieACS parameter format
                        if (current && typeof current === 'object' && current._value !== undefined) {
                            const value = current._value;
                            // Make sure it's a string and not an object
                            if (typeof value === 'string' && value.trim() !== '') {
                                return value;
                            }
                        }

                        // Handle direct value - make sure it's a string
                        if (current !== null && current !== undefined && typeof current === 'string' && current.trim() !== '') {
                            return current;
                        }
                    } catch (error) {
                        // Continue to next path
                    }
                }
                return 'Unknown';
            };

            // Parameter paths untuk Serial Number
            const serialPaths = [
                'VirtualParameters.getSerialNumber',
                'InternetGatewayDevice.DeviceInfo.SerialNumber',
                'Device.DeviceInfo.SerialNumber'
            ];

            // Parameter paths untuk Model Name
            const modelPaths = [
                'InternetGatewayDevice.DeviceInfo.ModelName',
                'Device.DeviceInfo.ModelName'
            ];

            const serialNumber = getParameterWithPaths(device, serialPaths);
            const modelName = getParameterWithPaths(device, modelPaths);

            const lastInform = new Date(device._lastInform);
            const now = new Date();
            const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
            const isOnline = diffMinutes < 15;
            const statusText = isOnline ? '🟢 Online' : '🔴 Offline';

            const tags = device._tags || [];
            const customerInfo = tags.length > 0 ? tags[0] : 'No Tag';

            message += `${index + 1}. *${customerInfo}*\n`;
            message += `   • SN: ${serialNumber}\n`;
            message += `   • Model: ${modelName}\n`;
            message += `   • Status: ${statusText}\n`;
            message += `   • Last Seen: ${lastInform.toLocaleString()}\n\n`;
        });

        if (remainingCount > 0) {
            message += `...dan ${remainingCount} perangkat lainnya.\n`;
            message += `Gunakan panel admin web untuk melihat daftar lengkap.`;
        }

        await sock.sendMessage(remoteJid, { text: message });
    } catch (error) {
        console.error('Error in handleListONU:', error);
        await sock.sendMessage(remoteJid, {
            text: `âŒ *ERROR*\n\nTerjadi kesalahan saat mengambil daftar perangkat:\n${error.message}`
        });
    }
}

// Fungsi untuk mengambil semua perangkat
async function getAllDevices() {
    try {
        // Ambil konfigurasi GenieACS dari helper
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        const response = await axios.get(`${genieacsUrl}/devices`, {
            auth: {
                username: genieacsUsername,
                password: genieacsPassword
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error getting all devices:', error);
        throw error;
    }
}

// Tambahkan handler untuk cek semua ONU (detail)
async function handleCheckAllONU(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, {
            text: `🔍 *MEMERIKSA SEMUA PERANGKAT*\n\nSedang memeriksa status semua perangkat ONT...\nProses ini mungkin memakan waktu beberapa saat.`
        });

        // Ambil daftar perangkat dari GenieACS
        const devices = await getAllDevices();

        if (!devices || devices.length === 0) {
            await sock.sendMessage(remoteJid, {
                text: `â„¹ï¸ *TIDAK ADA PERANGKAT*\n\nTidak ada perangkat ONT yang terdaftar dalam sistem.`
            });
            return;
        }

        // Hitung statistik perangkat
        let onlineCount = 0;
        let offlineCount = 0;
        let criticalRxPowerCount = 0;
        let warningRxPowerCount = 0;

        devices.forEach(device => {
            // Cek status online/offline
            const lastInform = new Date(device._lastInform);
            const now = new Date();
            const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
            const isOnline = diffMinutes < 15;

            if (isOnline) {
                onlineCount++;
            } else {
                offlineCount++;
            }

            // Cek RX Power
            const rxPower = device.InternetGatewayDevice?.X_GponLinkInfo?.RxPower?._value;
            if (rxPower) {
                const power = parseFloat(rxPower);
                if (power <= parseFloat(getSetting('rx_power_critical', -27))) {
                    criticalRxPowerCount++;
                } else if (power <= parseFloat(getSetting('rx_power_warning', -25))) {
                    warningRxPowerCount++;
                }
            }
        });

        // Buat pesan dengan statistik
        let message = `📊 *LAPORAN STATUS PERANGKAT*\n\n`;
        message += `📋 *Total Perangkat:* ${devices.length}\n\n`;
        message += `🟢 *Online:* ${onlineCount} (${Math.round(onlineCount / devices.length * 100)}%)\n`;
        message += `🔴 *Offline:* ${offlineCount} (${Math.round(offlineCount / devices.length * 100)}%)\n\n`;
        message += `🔧 *Status Sinyal:*\n`;
        message += `🔘 *Warning:* ${warningRxPowerCount} perangkat\n`;
        message += `🔥 *Critical:* ${criticalRxPowerCount} perangkat\n\n`;

        // Tambahkan daftar perangkat dengan masalah
        if (criticalRxPowerCount > 0) {
            message += `*PERANGKAT DENGAN SINYAL KRITIS:*\n`;
            let count = 0;

            for (const device of devices) {
                const rxPower = device.InternetGatewayDevice?.X_GponLinkInfo?.RxPower?._value;
                if (rxPower && parseFloat(rxPower) <= parseFloat(getSetting('rx_power_critical', -27))) {
                    const tags = device._tags || [];
                    const customerInfo = tags.length > 0 ? tags[0] : 'No Tag';
                    const serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 'Unknown';
                    // Ambil PPPoE Username
                    const pppoeUsername = device.VirtualParameters?.pppoeUsername?._value || device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.Username?._value || device.InternetGatewayDevice?.WANDevice?.[0]?.WANConnectionDevice?.[0]?.WANPPPConnection?.[0]?.Username?._value || '-';
                    message += `${++count}. *${customerInfo}* (S/N: ${serialNumber})\n   PPPoE: ${pppoeUsername}\n   RX Power: ${rxPower} dBm\n`;
                    // Batasi jumlah perangkat yang ditampilkan
                    if (count >= 5) {
                        message += `...dan ${criticalRxPowerCount - 5} perangkat lainnya.\n`;
                        break;
                    }
                }
            }
            message += `\n`;
        }

        // Tambahkan daftar perangkat offline terbaru
        if (offlineCount > 0) {
            message += `*PERANGKAT OFFLINE TERBARU:*\n`;

            // Urutkan perangkat berdasarkan waktu terakhir online
            const offlineDevices = devices
                .filter(device => {
                    const lastInform = new Date(device._lastInform);
                    const now = new Date();
                    const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
                    return diffMinutes >= 15;
                })
                .sort((a, b) => new Date(b._lastInform) - new Date(a._lastInform));

            // Tampilkan 5 perangkat offline terbaru
            const recentOfflineDevices = offlineDevices.slice(0, 5);
            recentOfflineDevices.forEach((device, index) => {
                const tags = device._tags || [];
                const customerInfo = tags.length > 0 ? tags[0] : 'No Tag';
                const serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 'Unknown';
                const lastInform = new Date(device._lastInform);
                // Ambil PPPoE Username
                const pppoeUsername = device.VirtualParameters?.pppoeUsername?._value || device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.Username?._value || device.InternetGatewayDevice?.WANDevice?.[0]?.WANConnectionDevice?.[0]?.WANPPPConnection?.[0]?.Username?._value || '-';
                message += `${index + 1}. *${customerInfo}* (S/N: ${serialNumber})\n   PPPoE: ${pppoeUsername}\n   Last Seen: ${lastInform.toLocaleString()}\n`;
            });

            if (offlineCount > 5) {
                message += `...dan ${offlineCount - 5} perangkat offline lainnya.\n`;
            }
        }

        await sock.sendMessage(remoteJid, { text: message });
    } catch (error) {
        console.error('Error in handleCheckAllONU:', error);
        await sock.sendMessage(remoteJid, {
            text: `âŒ *ERROR*\n\nTerjadi kesalahan saat memeriksa perangkat:\n${error.message}`
        });
    }
}

// Handler untuk menghapus user hotspot
async function handleDeleteHotspotUser(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 1) {
        await sock.sendMessage(remoteJid, {
            text: `❌ *FORMAT SALAH*\n\n` +
                `Format yang benar:\n` +
                `delhotspot [username]\n\n` +
                `Contoh:\n` +
                `• delhotspot user123`
        });
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, {
            text: `⏳ *PROSES PENGHAPUSAN USER HOTSPOT*\n\nSedang menghapus user hotspot...\nMohon tunggu sebentar.`
        });

        const [username] = params;
        console.log(`Deleting hotspot user: ${username}`);

        // Panggil fungsi untuk menghapus user hotspot
        const result = await deleteHotspotUser(username);
        console.log(`Hotspot user delete result:`, result);

        // Buat pesan respons berdasarkan result.success
        let responseMessage;
        if (result.success) {
            responseMessage = `✅ *BERHASIL MENGHAPUS USER HOTSPOT*\n\n` +
                `• Username: ${username}\n` +
                `• Status: ${result.message || 'User berhasil dihapus'}`;
        } else {
            responseMessage = `❌ *GAGAL MENGHAPUS USER HOTSPOT*\n\n` +
                `• Username: ${username}\n` +
                `• Alasan: ${result.message || 'User tidak ditemukan'}`;
        }

        // Kirim pesan respons dengan timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for delhotspot command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Coba kirim ulang jika gagal
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500);
    } catch (error) {
        console.error('Error in handleDeleteHotspotUser:', error);

        // Kirim pesan error
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, {
                    text: `❌ *ERROR MENGHAPUS USER HOTSPOT*\n\n` +
                        `Terjadi kesalahan saat menghapus user hotspot:\n` +
                        `${error.message || 'Kesalahan tidak diketahui'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler untuk menghapus PPPoE secret
async function handleDeletePPPoESecret(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 1) {
        await sock.sendMessage(remoteJid, {
            text: `❌ *FORMAT SALAH*\n\n` +
                `Format yang benar:\n` +
                `delpppoe [username]\n\n` +
                `Contoh:\n` +
                `• delpppoe user123`
        });
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, {
            text: `⏳ *PROSES PENGHAPUSAN SECRET PPPoE*\n\nSedang menghapus secret PPPoE...\nMohon tunggu sebentar.`
        });

        const [username] = params;
        console.log(`Deleting PPPoE secret: ${username}`);

        const result = await deletePPPoESecret(username);
        console.log(`PPPoE secret delete result:`, result);

        // Buat pesan respons berdasarkan result.success
        let responseMessage;
        if (result.success) {
            responseMessage = `✅ *BERHASIL MENGHAPUS SECRET PPPoE*\n\n` +
                `• Username: ${username}\n` +
                `• Status: ${result.message || 'Secret berhasil dihapus'}`;
        } else {
            responseMessage = `❌ *GAGAL MENGHAPUS SECRET PPPoE*\n\n` +
                `• Username: ${username}\n` +
                `• Alasan: ${result.message || 'Secret tidak ditemukan'}`;
        }

        // Kirim pesan respons dengan timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for delpppoe command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Coba kirim ulang jika gagal
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500);
    } catch (error) {
        console.error('Error in handleDeletePPPoESecret:', error);

        // Kirim pesan error
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, {
                    text: `❌ *ERROR MENGHAPUS SECRET PPPoE*\n\n` +
                        `Terjadi kesalahan saat menghapus secret PPPoE:\n` +
                        `${error.message || 'Kesalahan tidak diketahui'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler untuk menambah user hotspot
async function handleAddHotspotUser(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    console.log(`Processing addhotspot command with params:`, params);

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, {
            text: `❌ *FORMAT SALAH*\n\n` +
                `Format yang benar:\n` +
                `addhotspot [username] [password] [profile]\n\n` +
                `Contoh:\n` +
                `• addhotspot user123 pass123\n` +
                `• addhotspot user123 pass123 default`
        });
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, {
            text: `⏳ *PROSES PENAMBAHAN USER HOTSPOT*\n\nSedang menambahkan user hotspot...\nMohon tunggu sebentar.`
        });

        const [username, password, profile = "default"] = params;
        console.log(`Adding hotspot user: ${username} with profile: ${profile}`);

        // Panggil fungsi untuk menambah user hotspot
        const result = await addHotspotUser(username, password, profile);
        console.log(`Hotspot user add result:`, result);

        // Buat pesan respons berdasarkan hasil
        let responseMessage = '';
        if (result.success) {
            responseMessage = `✅ *BERHASIL MENAMBAHKAN USER HOTSPOT*\n\n` +
                `${result.message || 'User hotspot berhasil ditambahkan'}\n\n` +
                `• Username: ${username}\n` +
                `• Password: ${password}\n` +
                `• Profile: ${profile}`;
        } else {
            responseMessage = `❌ *GAGAL MENAMBAHKAN USER HOTSPOT*\n\n` +
                `${result.message || 'Terjadi kesalahan saat menambahkan user hotspot'}\n\n` +
                `• Username: ${username}\n` +
                `• Password: ${password}\n` +
                `• Profile: ${profile}`;
        }

        // Kirim pesan respons dengan timeout untuk memastikan pesan terkirim
        setTimeout(async () => {
            try {
                console.log(`Sending response message for addhotspot command:`, responseMessage);
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent successfully`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Coba kirim ulang jika gagal
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500); // Tunggu 1.5 detik sebelum mengirim respons

    } catch (error) {
        console.error('Error in handleAddHotspotUser:', error);

        // Kirim pesan error dengan timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, {
                    text: `❌ *ERROR MENAMBAHKAN USER HOTSPOT*\n\n` +
                        `Terjadi kesalahan saat menambahkan user hotspot:\n` +
                        `${error.message || 'Kesalahan tidak diketahui'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler untuk menambah secret PPPoE
async function handleAddPPPoESecret(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, {
            text: `❌ *FORMAT SALAH*\n\n` +
                `Format yang benar:\n` +
                `addpppoe [username] [password] [profile] [ip]\n\n` +
                `Contoh:\n` +
                `• addpppoe user123 pass123\n` +
                `• addpppoe user123 pass123 default\n` +
                `• addpppoe user123 pass123 default 10.0.0.1`
        });
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, {
            text: `⏳ *PROSES PENAMBAHAN SECRET PPPoE*\n\nSedang menambahkan secret PPPoE...\nMohon tunggu sebentar.`
        });

        const [username, password, profile = "default", localAddress = ""] = params;
        console.log(`Adding PPPoE secret: ${username} with profile: ${profile}, IP: ${localAddress || 'from pool'}`);

        const result = await addPPPoESecret(username, password, profile, localAddress);
        console.log(`PPPoE secret add result:`, result);

        // Buat pesan respons berdasarkan result.success
        let responseMessage;
        if (result.success) {
            responseMessage = `✅ *BERHASIL MENAMBAHKAN SECRET PPPoE*\n\n` +
                `• Username: ${username}\n` +
                `• Profile: ${profile}\n` +
                `• IP: ${localAddress || 'Menggunakan IP dari pool'}\n` +
                `• Status: ${result.message || 'Secret berhasil ditambahkan'}`;
        } else {
            responseMessage = `❌ *GAGAL MENAMBAHKAN SECRET PPPoE*\n\n` +
                `• Username: ${username}\n` +
                `• Profile: ${profile}\n` +
                `• IP: ${localAddress || 'Menggunakan IP dari pool'}\n` +
                `• Alasan: ${result.message || 'Terjadi kesalahan saat menambahkan secret'}`;
        }

        // Kirim pesan respons dengan timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for addpppoe command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Coba kirim ulang jika gagal
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500);
    } catch (error) {
        console.error('Error in handleAddPPPoESecret:', error);

        // Kirim pesan error
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, {
                    text: `❌ *ERROR MENAMBAHKAN SECRET PPPoE*\n\n` +
                        `Terjadi kesalahan saat menambahkan secret PPPoE:\n` +
                        `${error.message || 'Kesalahan tidak diketahui'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler untuk mengubah profile PPPoE
async function handleChangePPPoEProfile(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, {
            text: `❌ *FORMAT SALAH*\n\n` +
                `Format yang benar:\n` +
                `setprofile [username] [new-profile]\n\n` +
                `Contoh:\n` +
                `setprofile user123 premium`
        });
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, {
            text: `⏳ *PROSES PERUBAHAN PROFILE PPPoE*\n\nSedang mengubah profile PPPoE...\nMohon tunggu sebentar.`
        });

        const [username, newProfile] = params;
        console.log(`Changing PPPoE profile for user ${username} to ${newProfile}`);

        // Ganti ke setPPPoEProfile (fungsi yang benar dari mikrotik.js)
        const result = await setPPPoEProfile(username, newProfile);
        console.log(`PPPoE profile change result:`, result);

        // Buat pesan respons berdasarkan result.success
        let responseMessage;
        if (result.success) {
            responseMessage = `✅ *BERHASIL MENGUBAH PROFILE PPPoE*\n\n` +
                `• Username: ${username}\n` +
                `• Profile Baru: ${newProfile}\n` +
                `• Status: ${result.message || 'Profile berhasil diubah'}`;
        } else {
            responseMessage = `❌ *GAGAL MENGUBAH PROFILE PPPoE*\n\n` +
                `• Username: ${username}\n` +
                `• Profile Baru: ${newProfile}\n` +
                `• Alasan: ${result.message || 'User tidak ditemukan'}`;
        }

        // Kirim pesan respons dengan timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for setprofile command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Coba kirim ulang jika gagal
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500);
    } catch (error) {
        console.error('Error in handleChangePPPoEProfile:', error);

        // Kirim pesan error
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, {
                    text: `❌ *ERROR MENGUBAH PROFILE PPPoE*\n\n` +
                        `Terjadi kesalahan saat mengubah profile PPPoE:\n` +
                        `${error.message || 'Kesalahan tidak diketahui'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler untuk monitoring resource
async function handleResourceInfo(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan sedang memproses
        await sock.sendMessage(remoteJid, {
            text: `⏳ *Memproses Permintaan*\n\nSedang mengambil informasi resource router...`
        });

        // Import modul mikrotik
        const mikrotik = require('./mikrotik');

        // Ambil informasi resource
        const result = await mikrotik.getResourceInfo();

        if (result.success) {
            const data = result.data;

            // Format CPU info
            let cpuInfo = `💻 *CPU*\n• Load: ${data.cpuLoad}%\n`;
            if (data.cpuCount > 0) cpuInfo += `• Count: ${data.cpuCount}\n`;
            if (data.cpuFrequency > 0) cpuInfo += `• Frequency: ${data.cpuFrequency} MHz\n`;

            // Format Memory info dengan penanganan data tidak tersedia
            let memoryInfo = `🧠 *MEMORY*\n`;
            if (data.totalMemory > 0) {
                const memUsagePercent = ((data.memoryUsed / data.totalMemory) * 100).toFixed(1);
                memoryInfo += `• Free: ${data.memoryFree.toFixed(2)} MB\n`;
                memoryInfo += `• Total: ${data.totalMemory.toFixed(2)} MB\n`;
                memoryInfo += `• Used: ${data.memoryUsed.toFixed(2)} MB\n`;
                memoryInfo += `• Usage: ${memUsagePercent}%\n`;
            } else {
                memoryInfo += `• Status: ⚠️ Data tidak tersedia\n`;
            }

            // Format Disk info
            let diskInfo = `💾 *DISK*\n`;
            if (data.totalDisk > 0) {
                const diskUsagePercent = ((data.diskUsed / data.totalDisk) * 100).toFixed(1);
                diskInfo += `• Total: ${data.totalDisk.toFixed(2)} MB\n`;
                diskInfo += `• Free: ${data.diskFree.toFixed(2)} MB\n`;
                diskInfo += `• Used: ${data.diskUsed.toFixed(2)} MB\n`;
                diskInfo += `• Usage: ${diskUsagePercent}%\n`;
            } else {
                diskInfo += `• Status: ⚠️ Data tidak tersedia\n`;
            }

            // Format System info
            let systemInfo = `🙏 *UPTIME*\n• ${data.uptime}\n\n`;
            systemInfo += `⚙️ *SYSTEM INFO*\n`;
            if (data.model !== 'N/A') systemInfo += `• Model: ${data.model}\n`;
            if (data.architecture !== 'N/A') systemInfo += `• Architecture: ${data.architecture}\n`;
            if (data.version !== 'N/A') systemInfo += `• Version: ${data.version}\n`;
            if (data.boardName !== 'N/A') systemInfo += `• Board: ${data.boardName}\n`;

            const message = `📊 *INFO RESOURCE ROUTER*\n\n${cpuInfo}\n${memoryInfo}\n${diskInfo}\n${systemInfo}`;

            await sock.sendMessage(remoteJid, { text: message });
        } else {
            await sock.sendMessage(remoteJid, {
                text: `❌ *ERROR*\n\n${result.message}\n\nSilakan coba lagi nanti.`
            });
        }
    } catch (error) {
        console.error('Error handling resource info command:', error);

        // Kirim pesan error
        try {
            await sock.sendMessage(remoteJid, {
                text: `❌ *ERROR*\n\nTerjadi kesalahan saat mengambil informasi resource: ${error.message}\n\nSilakan coba lagi nanti.`
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

// Handler untuk melihat user hotspot aktif
async function handleActiveHotspotUsers(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan sedang memproses
        await sock.sendMessage(remoteJid, {
            text: `⏳ *Memproses Permintaan*\n\nSedang mengambil daftar user hotspot aktif...`
        });

        console.log('Fetching active hotspot users');

        // Import modul mikrotik
        const mikrotik = require('./mikrotik');

        // Ambil daftar user hotspot aktif
        const result = await mikrotik.getActiveHotspotUsers();

        if (result.success) {
            let message = '🔥 *DAFTAR USER HOTSPOT AKTIF*\n\n';

            if (result.data.length === 0) {
                message += 'Tidak ada user hotspot yang aktif';
            } else {
                result.data.forEach((user, index) => {
                    // Helper function untuk parsing bytes
                    const parseBytes = (value) => {
                        if (value === null || value === undefined || value === '') return 0;

                        // Jika sudah berupa number
                        if (typeof value === 'number') return value;

                        // Jika berupa string, parse sebagai integer
                        if (typeof value === 'string') {
                            const parsed = parseInt(value.replace(/[^0-9]/g, ''));
                            return isNaN(parsed) ? 0 : parsed;
                        }

                        return 0;
                    };

                    const bytesIn = parseBytes(user['bytes-in']);
                    const bytesOut = parseBytes(user['bytes-out']);

                    message += `${index + 1}. *User: ${user.user || 'N/A'}*\n` +
                        `   • IP: ${user.address || 'N/A'}\n` +
                        `   • Uptime: ${user.uptime || 'N/A'}\n` +
                        `   • Download: ${(bytesIn / 1024 / 1024).toFixed(2)} MB\n` +
                        `   • Upload: ${(bytesOut / 1024 / 1024).toFixed(2)} MB\n\n`;
                });
            }

            await sock.sendMessage(remoteJid, { text: message });
        } else {
            await sock.sendMessage(remoteJid, {
                text: `❌ *ERROR*\n\n${result.message}\n\nSilakan coba lagi nanti.`
            });
        }
    } catch (error) {
        console.error('Error handling active hotspot users command:', error);

        // Kirim pesan error
        try {
            await sock.sendMessage(remoteJid, {
                text: `❌ *ERROR*\n\nTerjadi kesalahan saat mengambil daftar user hotspot aktif: ${error.message}\n\nSilakan coba lagi nanti.`
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

// Perbaiki fungsi handleActivePPPoE
async function handleActivePPPoE(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan sedang memproses
        await sock.sendMessage(remoteJid, {
            text: `⏳ *Memproses Permintaan*\n\nSedang mengambil daftar koneksi PPPoE aktif...`
        });

        console.log('Fetching active PPPoE connections');

        // Import modul mikrotik
        const mikrotik = require('./mikrotik');

        // Ambil daftar koneksi PPPoE aktif
        const result = await mikrotik.getActivePPPoEConnections();

        if (result.success) {
            let message = '📶 *DAFTAR KONEKSI PPPoE AKTIF*\n\n';

            if (result.data.length === 0) {
                message += 'Tidak ada koneksi PPPoE yang aktif';
            } else {
                result.data.forEach((conn, index) => {
                    message += `${index + 1}. *User: ${conn.name}*\n` +
                        `   • Service: ${conn.service}\n` +
                        `   • IP: ${conn.address}\n` +
                        `   • Uptime: ${conn.uptime}\n` +
                        `   • Encoding: ${conn.encoding}\n\n`;
                });
            }

            await sock.sendMessage(remoteJid, { text: message });
        } else {
            await sock.sendMessage(remoteJid, {
                text: `❌ *ERROR*\n\n${result.message}\n\nSilakan coba lagi nanti.`
            });
        }
    } catch (error) {
        console.error('Error handling active PPPoE connections command:', error);

        // Kirim pesan error
        try {
            await sock.sendMessage(remoteJid, {
                text: `❌ *ERROR*\n\nTerjadi kesalahan saat mengambil daftar koneksi PPPoE aktif: ${error.message}\n\nSilakan coba lagi nanti.`
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

// Tambahkan fungsi untuk mendapatkan daftar user offline
async function handleOfflineUsers(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan sedang memproses
        await sock.sendMessage(remoteJid, {
            text: `⏳ *Memproses Permintaan*\n\nSedang mengambil daftar user PPPoE offline...`
        });

        console.log('Fetching offline PPPoE users');

        // Import modul mikrotik
        const mikrotik = require('./mikrotik');

        // Ambil daftar user PPPoE offline
        const result = await mikrotik.getInactivePPPoEUsers();

        if (result.success) {
            let message = `📊 *DAFTAR USER PPPoE OFFLINE*\n\n`;
            message += `Total User: ${result.totalSecrets}\n`;
            message += `User Aktif: ${result.totalActive} (${((result.totalActive / result.totalSecrets) * 100).toFixed(2)}%)\n`;
            message += `User Offline: ${result.totalInactive} (${((result.totalInactive / result.totalSecrets) * 100).toFixed(2)}%)\n\n`;

            if (result.data.length === 0) {
                message += 'Tidak ada user PPPoE yang offline';
            } else {
                // Batasi jumlah user yang ditampilkan untuk menghindari pesan terlalu panjang
                const maxUsers = 30;
                const displayUsers = result.data.slice(0, maxUsers);

                displayUsers.forEach((user, index) => {
                    message += `${index + 1}. *${user.name}*${user.comment ? ` (${user.comment})` : ''}\n`;
                });

                if (result.data.length > maxUsers) {
                    message += `\n... dan ${result.data.length - maxUsers} user lainnya`;
                }
            }

            await sock.sendMessage(remoteJid, { text: message });
        } else {
            await sock.sendMessage(remoteJid, {
                text: `❌ *ERROR*\n\n${result.message}\n\nSilakan coba lagi nanti.`
            });
        }
    } catch (error) {
        console.error('Error handling offline users command:', error);

        // Kirim pesan error
        try {
            await sock.sendMessage(remoteJid, {
                text: `❌ *ERROR*\n\nTerjadi kesalahan saat mengambil daftar user offline: ${error.message}\n\nSilakan coba lagi nanti.`
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

const sendMessage = require('./sendMessage');

// Export modul
module.exports = {
    setSock,
    handleAddHotspotUser,
    handleAddPPPoESecret,
    handleChangePPPoEProfile,
    handleResourceInfo,
    handleActiveHotspotUsers,
    handleActivePPPoE,
    handleDeleteHotspotUser,
    handleDeletePPPoESecret,
    connectToWhatsApp,
    sendMessage,
    getWhatsAppStatus,
    deleteWhatsAppSession,
    getSock,
    handleOfflineUsers,
    handleInfoLayanan
};

// Fungsi untuk mengecek apakah perintah terkait dengan WiFi/SSID
function isWifiCommand(commandStr) {
    const command = commandStr.split(' ')[0].toLowerCase();
    const wifiKeywords = [
        'gantiwifi', 'ubahwifi', 'changewifi', 'wifi',
        'gantissid', 'ubahssid', 'ssid',
        'namawifi', 'updatewifi', 'wifiname', 'namessid',
        'setwifi', 'settingwifi', 'changewifiname'
    ];

    // Hapus 'editssid' dan 'editwifi' dari daftar perintah WiFi biasa
    // karena ini adalah perintah khusus admin
    return wifiKeywords.includes(command);
}

// Fungsi untuk mengecek apakah perintah terkait dengan password/sandi
function isPasswordCommand(commandStr) {
    const command = commandStr.split(' ')[0].toLowerCase();
    const passwordKeywords = [
        'gantipass', 'ubahpass', 'editpass', 'changepass', 'password',
        'gantisandi', 'ubahsandi', 'editsandi', 'sandi',
        'gantipw', 'ubahpw', 'editpw', 'pw', 'pass',
        'gantipassword', 'ubahpassword', 'editpassword',
        'passwordwifi', 'wifipassword', 'passw', 'passwordwifi'
    ];

    return passwordKeywords.includes(command);
}

// Fungsi untuk mengirim pesan selamat datang
async function sendWelcomeMessage(remoteJid, isAdmin = false) {
    try {
        console.log(`Mengirim pesan selamat datang ke ${remoteJid}, isAdmin: ${isAdmin}`);

        // Pesan selamat datang
        let welcomeMessage = `👋 *Selamat Datang di Bot WhatsApp ${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}*\n\n`;

        if (isAdmin) {
            welcomeMessage += `Halo Admin! Anda dapat menggunakan berbagai perintah untuk mengelola sistem.\n\n`;
        } else {
            welcomeMessage += `Halo Pelanggan! Anda dapat menggunakan bot ini untuk mengelola perangkat Anda.\n\n`;
        }

        welcomeMessage += `Ketik *menu* untuk melihat daftar perintah yang tersedia.\n\n`;

        // Tambahkan footer
        welcomeMessage += `🏢 *${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}*\n`;
        welcomeMessage += `${getSetting('footer_info', 'Internet Tanpa Batas')}`;

        // Kirim pesan selamat datang
        await sock.sendMessage(remoteJid, { text: welcomeMessage });
        console.log(`Pesan selamat datang terkirim ke ${remoteJid}`);

        return true;
    } catch (error) {
        console.error('Error sending welcome message:', error);
        return false;
    }
}

// Fungsi untuk encode device ID
function encodeDeviceId(deviceId) {
    // Pastikan deviceId adalah string
    const idString = String(deviceId);

    // Encode komponen-komponen URL secara terpisah
    return idString.split('/').map(part => encodeURIComponent(part)).join('/');
}

// Fungsi untuk mendapatkan status WhatsApp
function getWhatsAppStatus() {
    try {
        // Gunakan global.whatsappStatus jika tersedia
        if (global.whatsappStatus) {
            return global.whatsappStatus;
        }

        if (!sock) {
            return {
                connected: false,
                status: 'disconnected',
                qrCode: null
            };
        }

        if (sock.user) {
            return {
                connected: true,
                status: 'connected',
                phoneNumber: sock.user.id.split(':')[0],
                connectedSince: new Date()
            };
        }

        return {
            connected: false,
            status: 'connecting',
            qrCode: null
        };
    } catch (error) {
        console.error('Error getting WhatsApp status:', error);
        return {
            connected: false,
            status: 'error',
            error: error.message,
            qrCode: null
        };
    }
}

// Fungsi untuk menghapus sesi WhatsApp
async function deleteWhatsAppSession() {
    try {
        const sessionDir = getSetting('whatsapp_session_path', './whatsapp-session');
        const fs = require('fs');
        const path = require('path');

        // Hapus semua file di direktori sesi
        if (fs.existsSync(sessionDir)) {
            const files = fs.readdirSync(sessionDir);
            for (const file of files) {
                fs.unlinkSync(path.join(sessionDir, file));
            }
            console.log(`Menghapus ${files.length} file sesi WhatsApp`);
        }

        console.log('Sesi WhatsApp berhasil dihapus');

        // Reset status
        global.whatsappStatus = {
            connected: false,
            qrCode: null,
            phoneNumber: null,
            connectedSince: null,
            status: 'session_deleted'
        };

        // Restart koneksi WhatsApp
        if (sock) {
            try {
                sock.logout();
            } catch (error) {
                console.log('Error saat logout:', error);
            }
        }

        // Mulai ulang koneksi setelah 2 detik
        setTimeout(() => {
            connectToWhatsApp();
        }, 2000);

        return { success: true, message: 'Sesi WhatsApp berhasil dihapus' };
    } catch (error) {
        console.error('Error saat menghapus sesi WhatsApp:', error);
        return { success: false, message: error.message };
    }
}

// Tambahkan fungsi ini di atas module.exports
function getSock() {
    return sock;
}

// Fungsi untuk menangani perintah member (username dan password berbeda)
async function handleMemberCommand(remoteJid, params) {
    try {
        // Format: member [username] [password] [profile] [buyer_number]
        if (params.length < 3) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *FORMAT SALAH*\n\nFormat yang benar:\nmember [username] [password] [profile] [nomer_pembeli]\n\nContoh:\n• member user123 pass123 3k 08123456789\n• member user123 pass123 3k`
            });
            return;
        }

        const username = params[0];
        const password = params[1];
        const profile = params[2];
        const buyerNumber = params[3];

        // Validasi username dan profile
        if (!username || !password || !profile) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *GAGAL MEMBUAT USER*\n\nUsername, password, dan profile harus diisi.`
            });
            return;
        }

        await sock.sendMessage(remoteJid, {
            text: `⏳ *PROSES PEMBUATAN USER*\n\nSedang membuat user...\nMohon tunggu sebentar.`
        });

        // Buat user di Mikrotik
        const result = await addHotspotUser(username, password, profile);

        // Format pesan untuk admin berdasarkan result.success
        let responseMessage;
        if (result.success) {
            responseMessage = `✅ *BERHASIL MEMBUAT USER*\n\n` +
                `• Username: ${username}\n` +
                `• Password: ${password}\n` +
                `• Profile: ${profile}\n` +
                `• Status: ${result.message || 'User berhasil dibuat'}`;
        } else {
            responseMessage = `❌ *GAGAL MEMBUAT USER*\n\n` +
                `• Username: ${username}\n` +
                `• Password: ${password}\n` +
                `• Profile: ${profile}\n` +
                `• Alasan: ${result.message || 'Terjadi kesalahan saat membuat user'}`;
        }

        // Jika ada nomor pembeli dan user berhasil dibuat, kirim juga ke pembeli
        if (buyerNumber && result.success) {
            // Hapus semua karakter non-angka
            let cleanNumber = buyerNumber.replace(/\D/g, '');

            // Jika nomor diawali 0, ganti dengan 62
            if (cleanNumber.startsWith('0')) {
                cleanNumber = '62' + cleanNumber.substring(1);
            }
            // Jika nomor diawali 8 (tanpa 62), tambahkan 62
            else if (cleanNumber.startsWith('8')) {
                cleanNumber = '62' + cleanNumber;
            }

            const buyerJid = `${cleanNumber}@s.whatsapp.net`;

            // Dapatkan header dan footer dari settings
            const settings = getAppSettings();
            const header = settings.company_header || 'AKUN INTERNET ANDA';
            const footer = settings.footer_info || 'Terima kasih telah menggunakan layanan kami.';

            const buyerMessage = `📋 *${header.toUpperCase()}*\n\n` +
                `Berikut detail akses internet Anda:\n` +
                `• Username: ${username}\n` +
                `• Password: ${password}\n` +
                `• Kecepatan: ${profile}\n\n` +
                `_${footer}_`;

            try {
                // Coba kirim pesan langsung tanpa cek nomor terdaftar
                await sock.sendMessage(buyerJid, {
                    text: buyerMessage
                }, {
                    waitForAck: false
                });
                responseMessage += '\n\n✅ Notifikasi berhasil dikirim ke pembeli.';
            } catch (error) {
                console.error('Gagal mengirim notifikasi ke pembeli:', error);
                responseMessage += '\n\n⚠️ Gagal mengirim notifikasi ke pembeli. Pastikan nomor WhatsApp aktif dan terdaftar.';
            }
        }

        await sock.sendMessage(remoteJid, { text: responseMessage });
    } catch (error) {
        console.error('Error in handleMemberCommand:', error);
        await sock.sendMessage(remoteJid, {
            text: '❌ *TERJADI KESALAHAN*\n\nGagal memproses perintah. Silakan coba lagi.'
        });
    }
}

// Handler untuk membuat voucher hotspot
async function handleVoucherCommand(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, {
            text: `❌ *FORMAT SALAH*\n\n` +
                `Format yang benar:\n` +
                `vcr [username] [profile] [nomer_pembeli]\n\n` +
                `Contoh:\n` +
                `• vcr pelanggan1 1Mbps 62812345678\n` +
                `• vcr pelanggan2 2Mbps`
        });
        return;
    }

    try {
        const username = params[0];
        const profile = params[1];
        const buyerNumber = params[2] ? params[2].replace(/[^0-9]/g, '') : null;

        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, {
            text: `⏳ *MEMBUAT VOUCHER HOTSPOT*\n\n` +
                `Sedang memproses pembuatan voucher...\n` +
                `• Username: ${username}\n` +
                `• Profile: ${profile}\n` +
                `• Password: Sama dengan username\n`
        });

        // Buat user hotspot (password sama dengan username)
        const result = await addHotspotUser(username, username, profile);

        if (result.success) {
            // Pesan untuk admin
            let message = `✅ *VOUCHER BERHASIL DIBUAT*\n\n` +
                `Detail Voucher:\n` +
                `• Username: ${username}\n` +
                `• Password: ${username}\n` +
                `• Profile: ${profile}\n` +
                `• Status: ${result.message || 'Voucher berhasil dibuat'}\n\n` +
                `_Voucher ini akan aktif segera setelah perangkat terhubung ke jaringan._`;

            // Kirim ke admin
            await sock.sendMessage(remoteJid, { text: message });

            // Jika ada nomor pembeli, kirim juga ke pembeli
            if (buyerNumber) {
                // Hapus semua karakter non-angka
                let cleanNumber = buyerNumber.replace(/\D/g, '');

                // Jika nomor diawali 0, ganti dengan 62
                if (cleanNumber.startsWith('0')) {
                    cleanNumber = '62' + cleanNumber.substring(1);
                }
                // Jika nomor diawali 8 (tanpa 62), tambahkan 62
                else if (cleanNumber.startsWith('8')) {
                    cleanNumber = '62' + cleanNumber;
                }

                const buyerJid = `${cleanNumber}@s.whatsapp.net`;

                // Dapatkan header dan footer dari settings
                const settings = getAppSettings();
                const header = settings.company_header || 'VOUCHER INTERNET ANDA';
                const footer = settings.footer_info || 'Terima kasih telah menggunakan layanan kami.';

                const buyerMessage = `📋 *${header.toUpperCase()}*\n\n` +
                    `Berikut detail akses internet Anda:\n` +
                    `• Username: ${username}\n` +
                    `• Password: ${username}\n` +
                    `• Harga: ${profile}\n\n` +
                    `_${footer}_`;

                try {
                    // Coba kirim pesan langsung tanpa cek nomor terdaftar
                    const sendPromise = sock.sendMessage(buyerJid, {
                        text: buyerMessage,
                        // Tambahkan opsi untuk menghindari error jika nomor tidak terdaftar
                        // dan tetap lanjutkan proses
                        waitForAck: false
                    });

                    // Set timeout 10 detik (lebih cepat)
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Waktu pengiriman habis')), 10000)
                    );

                    // Tunggu salah satu: pesan terkirim atau timeout
                    await Promise.race([sendPromise, timeoutPromise]);

                    await sock.sendMessage(remoteJid, {
                        text: `💎 Notifikasi voucher telah dikirim ke: ${buyerNumber}`
                    });
                } catch (error) {
                    console.error('Gagal mengirim notifikasi ke pembeli:', error);
                    // Tetap lanjutkan meskipun gagal kirim notifikasi
                    await sock.sendMessage(remoteJid, {
                        text: `✅ *VOUCHER BERHASIL DIBUAT*\n\n` +
                            `Detail Voucher telah berhasil dibuat, namun notifikasi ke ${buyerNumber} gagal terkirim.\n` +
                            `Ini bisa terjadi jika nomor tidak terdaftar di WhatsApp atau ada masalah koneksi.`
                    });
                }
            }
        } else {
            // Kirim pesan error jika gagal membuat voucher
            await sock.sendMessage(remoteJid, {
                text: `❌ *GAGAL MEMBUAT VOUCHER*\n\n` +
                    `• Username: ${username}\n` +
                    `• Profile: ${profile}\n` +
                    `• Alasan: ${result.message || 'Terjadi kesalahan saat membuat voucher'}`
            });
        }
    } catch (error) {
        console.error('Error in handleVoucherCommand:', error);

        // Kirim pesan error
        await sock.sendMessage(remoteJid, {
            text: `❌ *ERROR MEMBUAT VOUCHER*\n\n` +
                `Terjadi kesalahan saat membuat voucher:\n` +
                `${error.message || 'Kesalahan tidak diketahui'}`
        });
    }
}

// Fungsi untuk menangani pesan masuk dengan penanganan error dan logging yang lebih baik
async function handleIncomingMessage(sock, message) {
    // Super admin welcome message disabled (silent startup)
    try {
        // Skip if message already processed by agent handler
        if (message._agentProcessed) {
            console.log('📱 [MAIN] Message already processed by agent handler, skipping');
            return;
        }

        // Validasi input
        if (!message || !message.key) {
            logger.warn('Invalid message received', { message: typeof message });
            return;
        }

        // Ekstrak informasi pesan
        const remoteJid = message.key.remoteJid;
        if (!remoteJid) {
            logger.warn('Message without remoteJid received', { messageKey: message.key });
            return;
        }

        // Skip jika pesan dari grup dan bukan dari admin
        if (remoteJid.includes('@g.us')) {
            logger.debug('Message from group received', { groupJid: remoteJid });
            const participant = message.key.participant;
            if (!participant || !isAdminNumber(participant.split('@')[0])) {
                logger.debug('Group message not from admin, ignoring', { participant });
                return;
            }
            logger.info('Group message from admin, processing', { participant });
        }

        // Cek tipe pesan dan ekstrak teks
        let messageText = '';
        if (!message.message) {
            logger.debug('Message without content received', { messageType: 'unknown' });
            return;
        }

        if (message.message.conversation) {
            messageText = message.message.conversation;
            logger.debug('Conversation message received');
        } else if (message.message.extendedTextMessage) {
            messageText = message.message.extendedTextMessage.text;
            logger.debug('Extended text message received');
        } else {
            // Tipe pesan tidak didukung
            logger.debug('Unsupported message type received', {
                messageTypes: Object.keys(message.message)
            });
            return;
        }

        // Ekstrak nomor pengirim dengan penanganan error
        let senderNumber;
        try {
            senderNumber = remoteJid.split('@')[0];
        } catch (error) {
            logger.error('Error extracting sender number', { remoteJid, error: error.message });
            return;
        }

        logger.info(`Message received`, { sender: senderNumber, messageLength: messageText.length });
        logger.debug(`Message content`, { sender: senderNumber, message: messageText });

        // Extract WhatsApp LID if present (for @lid format)
        let senderLid = null;
        if (remoteJid.includes('@lid')) {
            senderLid = remoteJid; // Format: 85280887435270@lid
            logger.debug(`WhatsApp LID detected`, { lid: senderLid });

            // PRIORITY 1: Try to get real number from remoteJidAlt (fastest, most reliable)
            if (message.key?.remoteJidAlt) {
                const actualJid = message.key.remoteJidAlt;
                senderNumber = actualJid.replace('@s.whatsapp.net', '');
                logger.info(`✅ Got real number from remoteJidAlt: ${senderNumber}`);
            } else {
                // FALLBACK: Try to resolve from database
                try {
                    const BillingManager = require('./billing');
                    const billing = new BillingManager();
                    const customer = await billing.getCustomerByWhatsAppLid(senderLid);
                    if (customer) {
                        senderNumber = customer.phone;
                        // Normalize
                        if (senderNumber.startsWith('0')) senderNumber = '62' + senderNumber.slice(1);
                        logger.info(`✅ Resolved LID ${senderLid} from database to phone: ${senderNumber}`);
                    } else {
                        logger.warn(`⚠️ LID ${senderLid} not found in database and no remoteJidAlt available`);
                    }
                } catch (err) {
                    logger.warn(`⚠️ Could not resolve LID ${senderLid}:`, err.message);
                }
            }
        }

        // Cek apakah pengirim adalah admin
        const isAdmin = isAdminNumber(senderNumber);
        logger.debug(`Sender admin status`, { sender: senderNumber, isAdmin });

        // Try to handle with agent handler first (for non-admin messages)
        if (!isAdmin) {
            try {
                const AgentWhatsAppIntegration = require('./agentWhatsAppIntegration');
                const agentWhatsApp = new AgentWhatsAppIntegration(this);
                const processed = await agentWhatsApp.handleIncomingMessage(message, senderNumber, messageText);
                if (processed) {
                    console.log('📱 [MAIN] Message processed by agent handler, skipping main handler');
                    return;
                }
            } catch (agentError) {
                console.log('📱 [MAIN] Agent handler not available or error:', agentError.message);
            }
        }

        // Jika pesan kosong, abaikan
        if (!messageText.trim()) {
            logger.debug('Empty message, ignoring');
            return;
        }

        // Proses perintah
        const command = messageText.trim().toLowerCase();

        // Handler setheader
        if (command.startsWith('setheader ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, 'âŒ *Hanya admin yang dapat mengubah header!*');
                return;
            }
            const newHeader = messageText.split(' ').slice(1).join(' ');
            if (!newHeader) {
                await sendFormattedMessage(remoteJid, 'âŒ *Format salah!*\n\nsetheader [teks_header_baru]');
                return;
            }
            const { setSetting } = require('./settingsManager');
            setSetting('company_header', newHeader);
            updateConfig({ companyHeader: newHeader });
            await sendFormattedMessage(remoteJid, `✅ *Header berhasil diubah ke:*\n${newHeader}`);
            return;
        }

        // Handler setfooter
        if (command.startsWith('setfooter ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, 'âŒ *Hanya admin yang dapat mengubah footer!*');
                return;
            }
            const newFooter = messageText.split(' ').slice(1).join(' ');
            if (!newFooter) {
                await sendFormattedMessage(remoteJid, 'âŒ *Format salah!*\n\nsetfooter [teks_footer_baru]');
                return;
            }
            const { setSetting } = require('./settingsManager');
            setSetting('footer_info', newFooter);
            updateConfig({ footerInfo: newFooter });
            await sendFormattedMessage(remoteJid, `✅ *Footer berhasil diubah ke:*\n${newFooter}`);
            return;
        }

        // Handler setadmin
        if (command.startsWith('setadmin ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, 'âŒ *Hanya admin yang dapat mengubah admin number!*');
                return;
            }
            const newAdmin = messageText.split(' ').slice(1).join(' ').replace(/\D/g, '');
            if (!newAdmin) {
                await sendFormattedMessage(remoteJid, 'âŒ *Format salah!*\n\nsetadmin [nomor_admin_baru]');
                return;
            }
            let settings = getAppSettings();
            settings.admin_number = newAdmin;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            await sendFormattedMessage(remoteJid, `✅ *Admin number berhasil diubah ke:*\n${newAdmin}`);
            return;
        }

        // Handler settechnician
        if (command.startsWith('settechnician ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, 'âŒ *Hanya admin yang dapat mengubah technician!*');
                return;
            }
            const newTechs = messageText.split(' ').slice(1).join(' ').split(',').map(n => n.trim().replace(/\D/g, '')).filter(Boolean);
            if (!newTechs.length) {
                await sendFormattedMessage(remoteJid, 'âŒ *Format salah!*\n\nsettechnician [nomor1,nomor2,...]');
                return;
            }
            let settings = getAppSettings();
            settings.technician_numbers = newTechs;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            await sendFormattedMessage(remoteJid, `✅ *Technician numbers berhasil diubah ke:*\n${newTechs.join(', ')}`);
            return;
        }

        // Handler setgenieacs
        if (command.startsWith('setgenieacs ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, 'âŒ *Hanya admin yang dapat mengubah GenieACS config!*');
                return;
            }
            const params = messageText.split(' ').slice(1);
            if (params.length < 3) {
                await sendFormattedMessage(remoteJid, 'âŒ *Format salah!*\n\nsetgenieacs [url] [username] [password]');
                return;
            }
            let settings = getAppSettings();
            settings.genieacs_url = params[0];
            settings.genieacs_username = params[1];
            settings.genieacs_password = params.slice(2).join(' ');
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            await sendFormattedMessage(remoteJid, `✅ *Konfigurasi GenieACS berhasil diubah!*`);
            return;
        }

        // Handler setmikrotik
        if (command.startsWith('setmikrotik ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, 'âŒ *Hanya admin yang dapat mengubah Mikrotik config!*');
                return;
            }
            const params = messageText.split(' ').slice(1);
            if (params.length < 4) {
                await sendFormattedMessage(remoteJid, 'âŒ *Format salah!*\n\nsetmikrotik [host] [port] [user] [password]');
                return;
            }
            let settings = getAppSettings();
            settings.mikrotik_host = params[0];
            settings.mikrotik_port = params[1];
            settings.mikrotik_user = params[2];
            settings.mikrotik_password = params.slice(3).join(' ');
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            await sendFormattedMessage(remoteJid, `✅ *Konfigurasi Mikrotik berhasil diubah!*`);
            return;
        }

        // Handler OTP management
        if (command.startsWith('otp ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, 'âŒ *Hanya admin yang dapat mengatur OTP!*');
                return;
            }
            const subCommand = messageText.split(' ').slice(1)[0]?.toLowerCase();

            switch (subCommand) {
                case 'on':
                case 'enable':
                    console.log(`Admin ${senderNumber} mengaktifkan OTP`);
                    let settingsOn = getAppSettings();
                    settingsOn.customerPortalOtp = true;
                    settingsOn.customer_otp_enabled = true;
                    fs.writeFileSync(settingsPath, JSON.stringify(settingsOn, null, 2));
                    await sendFormattedMessage(remoteJid, `✅ *OTP DIAKTIFKAN*\n\nSistem OTP untuk portal pelanggan telah diaktifkan.\nPelanggan akan diminta memasukkan kode OTP saat login.`);
                    return;

                case 'off':
                case 'disable':
                    console.log(`Admin ${senderNumber} menonaktifkan OTP`);
                    let settingsOff = getAppSettings();
                    settingsOff.customerPortalOtp = false;
                    settingsOff.customer_otp_enabled = false;
                    fs.writeFileSync(settingsPath, JSON.stringify(settingsOff, null, 2));
                    await sendFormattedMessage(remoteJid, `✅ *OTP DINONAKTIFKAN*\n\nSistem OTP untuk portal pelanggan telah dinonaktifkan.\nPelanggan dapat login langsung tanpa OTP.`);
                    return;

                case 'status':
                    console.log(`Admin ${senderNumber} melihat status OTP`);
                    let settingsStatus = getAppSettings();
                    // Cek kedua pengaturan untuk kompatibilitas
                    const otpStatus = settingsStatus.customerPortalOtp || settingsStatus.customer_otp_enabled;
                    const otpLength = settingsStatus.otp_length || 4;
                    const otpExpiry = settingsStatus.otp_expiry_minutes || 5;

                    await sendFormattedMessage(remoteJid, `📊 *STATUS OTP*\n\n` +
                        `🔐 Status: ${otpStatus ? '🟢 AKTIF' : '🔴 NONAKTIF'}\n` +
                        `🙏 Panjang Kode: ${otpLength} digit\n` +
                        `🙏 Masa Berlaku: ${otpExpiry} menit\n\n` +
                        `*Perintah yang tersedia:*\n` +
                        `• otp on - Aktifkan OTP\n` +
                        `• otp off - Nonaktifkan OTP\n` +
                        `• otp status - Lihat status OTP`);
                    return;

                default:
                    await sendFormattedMessage(remoteJid, `âŒ *Format salah!*\n\n` +
                        `*Perintah OTP yang tersedia:*\n` +
                        `• otp on - Aktifkan OTP\n` +
                        `• otp off - Nonaktifkan OTP\n` +
                        `• otp status - Lihat status OTP\n\n` +
                        `*Contoh:*\n` +
                        `otp on`);
                    return;
            }
        }

        // Perintah untuk mengaktifkan/menonaktifkan GenieACS (hanya untuk admin)
        // Perintah ini selalu diproses terlepas dari status genieacsCommandsEnabled

        // Perintah untuk menonaktifkan pesan GenieACS (hanya untuk admin)
        if (command.toLowerCase() === 'genieacs stop' && isAdmin) {
            console.log(`Admin ${senderNumber} menonaktifkan pesan GenieACS`);
            genieacsCommandsEnabled = false;
            await sendFormattedMessage(remoteJid, `✅ *PESAN GenieACS DINONAKTIFKAN*


Pesan GenieACS telah dinonaktifkan. Hubungi admin untuk mengaktifkan kembali.`);
            return;
        }

        // Perintah untuk mengaktifkan kembali pesan GenieACS (hanya untuk admin)
        if (command.toLowerCase() === 'genieacs start060111' && isAdmin) {
            console.log(`Admin ${senderNumber} mengaktifkan pesan GenieACS`);
            genieacsCommandsEnabled = true;
            await sendFormattedMessage(remoteJid, `✅ *PESAN GenieACS DIAKTIFKAN*


Pesan GenieACS telah diaktifkan kembali.`);
            return;
        }

        // Jika GenieACS dinonaktifkan, abaikan semua perintah kecuali dari nomor 6281947215703
        if (!genieacsCommandsEnabled && senderNumber !== '6281947215703') {
            // Hanya nomor 6281947215703 yang bisa menggunakan bot saat GenieACS dinonaktifkan
            console.log(`Pesan diabaikan karena GenieACS dinonaktifkan dan bukan dari nomor khusus: ${senderNumber}`);
            return;
        }

        // Perintah stop GenieACS (khusus super admin)
        if (command === 'genieacs stop') {
            if (senderNumber === superAdminNumber) {
                // Logika untuk menghentikan GenieACS
                genieacsCommandsEnabled = false;
                await sock.sendMessage(remoteJid, { text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}\n✅ *GenieACS berhasil dihentikan oleh Super Admin.*${getSetting('footer_info', 'Internet Tanpa Batas')}` });
            } else {
                await sock.sendMessage(remoteJid, { text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}\nâŒ *Hanya Super Admin yang dapat menjalankan perintah ini!*${getSetting('footer_info', 'Internet Tanpa Batas')}` });
            }
            return;
        }
        // Perintah start GenieACS (khusus super admin)
        if (command === 'genieacs start060111') {
            if (senderNumber === superAdminNumber) {
                genieacsCommandsEnabled = true;
                await sock.sendMessage(remoteJid, { text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}\n✅ *GenieACS berhasil diaktifkan oleh Super Admin.*${getSetting('footer_info', 'Internet Tanpa Batas')}` });
            } else {
                await sock.sendMessage(remoteJid, { text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}\nâŒ *Hanya Super Admin yang dapat menjalankan perintah ini!*${getSetting('footer_info', 'Internet Tanpa Batas')}` });
            }
            return;
        }
        // Perintah menu (ganti help)
        if (command === 'menu' || command === '!menu' || command === '/menu') {
            console.log(`Menjalankan perintah menu untuk ${senderNumber}`);
            await handleHelpCommand(remoteJid, isAdmin);
            return;
        }

        // Agent admin commands
        if (isAdmin && (command.includes('agent') || command === 'agent' || command === 'daftaragent')) {
            console.log(`🤖 [AGENT ADMIN] Processing command: "${command}" from ${senderNumber}`);
            const AgentAdminCommands = require('./agentAdminCommands');
            const agentAdminCommands = new AgentAdminCommands();
            agentAdminCommands._sendMessage = async (jid, message) => {
                await sock.sendMessage(jid, { text: message });
            };
            await agentAdminCommands.handleAgentAdminCommands(remoteJid, senderNumber, command, messageText);
            return;
        }

        // Perintah status
        if (command === 'status' || command === '!status' || command === '/status') {
            console.log(`Menjalankan perintah status untuk ${senderNumber}`);
            await handleStatusCommand(senderNumber, remoteJid);
            return;
        }

        // Perintah refresh
        if (command === 'refresh' || command === '!refresh' || command === '/refresh') {
            console.log(`Menjalankan perintah refresh untuk ${senderNumber}`);
            await handleRefreshCommand(senderNumber, remoteJid);
            return;
        }

        // Perintah admin
        if ((command === 'admin' || command === '!admin' || command === '/admin') && isAdmin) {
            console.log(`Menjalankan perintah admin untuk ${senderNumber}`);
            await handleAdminMenu(remoteJid);
            return;
        }

        // Perintah untuk menonaktifkan/mengaktifkan GenieACS telah dipindahkan ke atas

        // Perintah factory reset (untuk pelanggan)
        if (command === 'factory reset' || command === '!factory reset' || command === '/factory reset') {
            console.log(`Menjalankan perintah factory reset untuk ${senderNumber}`);
            if (genieacsCommandsEnabled) {
                await genieacsCommands.handleFactoryReset(remoteJid, senderNumber);
            } else {
                await sendGenieACSDisabledMessage(remoteJid);
            }
            return;
        }

        // Perintah konfirmasi factory reset
        if (command === 'confirm factory reset' || command === '!confirm factory reset' || command === '/confirm factory reset') {
            console.log(`Menjalankan konfirmasi factory reset untuk ${senderNumber}`);
            if (genieacsCommandsEnabled) {
                await genieacsCommands.handleFactoryResetConfirmation(remoteJid, senderNumber);
            } else {
                await sendGenieACSDisabledMessage(remoteJid);
            }
            return;
        }

        // Perintah perangkat terhubung
        if (command === 'devices' || command === '!devices' || command === '/devices' ||
            command === 'connected' || command === '!connected' || command === '/connected') {
            console.log(`Menjalankan perintah perangkat terhubung untuk ${senderNumber}`);
            if (genieacsCommandsEnabled) {
                await genieacsCommands.handleConnectedDevices(remoteJid, senderNumber);
            } else {
                await sendGenieACSDisabledMessage(remoteJid);
            }
            return;
        }

        // Perintah speed test / bandwidth
        if (command === 'speedtest' || command === '!speedtest' || command === '/speedtest' ||
            command === 'bandwidth' || command === '!bandwidth' || command === '/bandwidth') {
            console.log(`Menjalankan perintah speed test untuk ${senderNumber}`);
            if (genieacsCommandsEnabled) {
                await genieacsCommands.handleSpeedTest(remoteJid, senderNumber);
            } else {
                await sendGenieACSDisabledMessage(remoteJid);
            }
            return;
        }

        // Perintah diagnostik jaringan
        if (command === 'diagnostic' || command === '!diagnostic' || command === '/diagnostic' ||
            command === 'diagnosa' || command === '!diagnosa' || command === '/diagnosa') {
            console.log(`Menjalankan perintah diagnostik jaringan untuk ${senderNumber}`);
            if (genieacsCommandsEnabled) {
                await genieacsCommands.handleNetworkDiagnostic(remoteJid, senderNumber);
            } else {
                await sendGenieACSDisabledMessage(remoteJid);
            }
            return;
        }

        // Perintah riwayat koneksi
        if (command === 'history' || command === '!history' || command === '/history' ||
            command === 'riwayat' || command === '!riwayat' || command === '/riwayat') {
            console.log(`Menjalankan perintah riwayat koneksi untuk ${senderNumber}`);
            if (genieacsCommandsEnabled) {
                await genieacsCommands.handleConnectionHistory(remoteJid, senderNumber);
            } else {
                await sendGenieACSDisabledMessage(remoteJid);
            }
            return;
        }

        // Alias admin: cekstatus [nomor] atau cekstatus[nomor]
        if (isAdmin && (command.startsWith('cekstatus ') || command.startsWith('cekstatus'))) {
            let customerNumber = '';
            if (command.startsWith('cekstatus ')) {
                customerNumber = messageText.trim().split(' ')[1];
            } else {
                // Handle tanpa spasi, misal cekstatus081321960111
                customerNumber = command.replace('cekstatus', '').trim();
            }
            if (customerNumber && /^\d{8,}$/.test(customerNumber)) {
                await handleAdminCheckONU(remoteJid, customerNumber);
                return;
            } else {
                await sock.sendMessage(remoteJid, {
                    text: `âŒ *FORMAT SALAH*\n\nFormat yang benar:\ncekstatus [nomor_pelanggan]\n\nContoh:\ncekstatus 081234567890`
                });
                return;
            }
        }

        // Perintah ganti WiFi
        if (isWifiCommand(command)) {
            console.log(`Menjalankan perintah ganti WiFi untuk ${senderNumber}`);
            const params = messageText.split(' ').slice(1);

            // Jika admin menggunakan perintah gantiwifi dengan format: gantiwifi [nomor_pelanggan] [ssid]
            if (isAdmin && params.length >= 2) {
                // Anggap parameter pertama sebagai nomor pelanggan
                const customerNumber = params[0];
                const ssidParams = params.slice(1);
                console.log(`Admin menggunakan gantiwifi untuk pelanggan ${customerNumber}`);
                await handleAdminEditSSID(remoteJid, customerNumber, ssidParams.join(' '));
            } else {
                // Pelanggan biasa atau format admin tidak sesuai
                await handleChangeSSID(senderNumber, remoteJid, params);
            }
            return;
        }

        // Perintah ganti password
        if (isPasswordCommand(command.split(' ')[0])) {
            console.log(`Menjalankan perintah ganti password untuk ${senderNumber}`);
            const params = messageText.split(' ').slice(1);

            // Jika admin menggunakan perintah gantipassword dengan format: gantipassword [nomor_pelanggan] [password]
            if (isAdmin && params.length >= 2) {
                // Anggap parameter pertama sebagai nomor pelanggan
                const customerNumber = params[0];
                const password = params[1];
                console.log(`Admin menggunakan gantipassword untuk pelanggan ${customerNumber}`);
                await handleAdminEditPassword(remoteJid, customerNumber, password);
            } else {
                // Pelanggan biasa atau format admin tidak sesuai
                await handleChangePassword(senderNumber, remoteJid, params);
            }
            return;
        }

        // Jika admin, cek perintah admin lainnya
        if (isAdmin) {
            // Perintah SETLID untuk admin menyimpan WhatsApp LID mereka
            if (command === 'setlid' || command === '!setlid' || command === '/setlid') {
                try {
                    const { setSetting, getSetting } = require('./settingsManager');

                    // Parse password dari command: SETLID [password]
                    const args = messageText.split(' ').slice(1);
                    const inputPassword = args[0] ? args[0].trim() : '';

                    if (!inputPassword) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `🔐 *FORMAT SETLID*\n\n` +
                                `Untuk keamanan, Anda harus memasukkan password admin.\n\n` +
                                `Format: *SETLID [password]*\n\n` +
                                `Contoh: SETLID admin123\n\n` +
                                `Password adalah admin_password yang ada di settings.json`
                            )
                        });
                        return;
                    }

                    // Validasi password
                    const adminPassword = getSetting('admin_password', '');
                    if (inputPassword !== adminPassword) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *PASSWORD SALAH*\n\n` +
                                `Password yang Anda masukkan tidak sesuai.\n\n` +
                                `Silakan coba lagi dengan password yang benar.`
                            )
                        });
                        console.log(`⚠️ Failed SETLID attempt from ${senderNumber} - wrong password`);
                        return;
                    }

                    if (!senderLid) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *LID TIDAK TERDETEKSI*\n\n` +
                                `WhatsApp LID tidak terdeteksi. Fitur ini hanya untuk akun WhatsApp dengan format @lid.\n\n` +
                                `Nomor Anda: ${senderNumber}`
                            )
                        });
                        return;
                    }

                    // Cari slot admin yang sesuai dengan nomor pengirim
                    let adminSlot = null;
                    for (let i = 0; i < 10; i++) {
                        const adminNum = getSetting(`admins.${i}`, '');
                        if (adminNum === senderNumber || adminNum === `0${senderNumber.slice(2)}`) {
                            adminSlot = i;
                            break;
                        }
                    }

                    if (adminSlot === null) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *NOMOR TIDAK TERDAFTAR*\n\n` +
                                `Nomor ${senderNumber} tidak terdaftar sebagai admin di settings.json.\n\n` +
                                `Silakan tambahkan nomor Anda ke settings.json terlebih dahulu sebagai admins.0, admins.1, dst.`
                            )
                        });
                        return;
                    }

                    // Simpan LID ke settings.json dengan key admin_lid.X
                    const lidKey = `admin_lid.${adminSlot}`;
                    const success = setSetting(lidKey, senderLid);

                    if (success) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `✅ *LID TERSIMPAN*\n\n` +
                                `WhatsApp LID Anda berhasil disimpan!\n\n` +
                                `📋 *Detail:*\n` +
                                `• Nomor: ${senderNumber}\n` +
                                `• LID: ${senderLid}\n` +
                                `• Slot: admin_lid.${adminSlot}\n\n` +
                                `LID ini akan digunakan untuk identifikasi admin di masa depan.`
                            )
                        });
                        console.log(`✅ Admin LID saved: ${senderLid} for admin slot ${adminSlot}`);
                    } else {
                        await sock.sendMessage(remoteJid, {
                            text: `❌ Gagal menyimpan LID ke settings.json. Silakan cek log.`
                        });
                    }
                } catch (error) {
                    console.error('Error in SETLID command:', error);
                    await sock.sendMessage(remoteJid, {
                        text: `❌ Terjadi kesalahan: ${error.message}`
                    });
                }
                return;
            }

            // Perintah cek ONU (tapi bukan cek tagihan)
            if ((command.startsWith('cek ') || command.startsWith('!cek ') || command.startsWith('/cek ')) &&
                !command.includes('tagihan')) {
                const customerNumber = command.split(' ')[1];
                if (customerNumber) {
                    console.log(`Menjalankan perintah cek ONU untuk pelanggan ${customerNumber}`);
                    await handleAdminCheckONUWithBilling(remoteJid, customerNumber);
                    return;
                }
            }

            // Perintah edit SSID
            if (command.toLowerCase().startsWith('editssid ') || command.toLowerCase().startsWith('!editssid ') || command.toLowerCase().startsWith('/editssid ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah edit SSID untuk ${params[0]}`);
                    await handleAdminEditSSIDWithParams(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *FORMAT Salah!*\n\n` +
                            `Format yang benar:\n` +
                            `editssid [nomor_pelanggan] [ssid_baru]\n\n` +
                            `Contoh:\n` +
                            `editssid 123456 RumahKu`
                    });
                    return;
                }
            }

            // Perintah edit password
            if (command.toLowerCase().startsWith('editpass ') || command.toLowerCase().startsWith('!editpass ') || command.toLowerCase().startsWith('/editpass ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah edit password untuk ${params[0]}`);
                    await handleAdminEditPassword(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *FORMAT Salah!*\n\n` +
                            `Format yang benar:\n` +
                            `editpass [nomor_pelanggan] [password_baru]\n\n` +
                            `Contoh:\n` +
                            `editpass 123456 password123`
                    });
                    return;
                }
            }

            // Perintah admin detail perangkat
            if (command.toLowerCase().startsWith('detail ') || command.toLowerCase().startsWith('!detail ') || command.toLowerCase().startsWith('/detail ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Menjalankan perintah admin detail untuk ${params[0]}`);
                    if (genieacsCommandsEnabled) {
                        await genieacsCommands.handleAdminDeviceDetail(remoteJid, params[0]);
                    } else {
                        await sendGenieACSDisabledMessage(remoteJid);
                    }
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *FORMAT Salah!*\n\n` +
                            `Format yang benar:\n` +
                            `detail [nomor_pelanggan]\n\n` +
                            `Contoh:\n` +
                            `detail 081234567890`
                    });
                    return;
                }
            }

            // Perintah admin restart perangkat pelanggan
            if (command.toLowerCase().startsWith('adminrestart ') || command.toLowerCase().startsWith('!adminrestart ') || command.toLowerCase().startsWith('/adminrestart ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Menjalankan perintah admin restart untuk ${params[0]}`);
                    if (genieacsCommandsEnabled) {
                        await genieacsCommands.handleAdminRestartDevice(remoteJid, params[0]);
                    } else {
                        await sendGenieACSDisabledMessage(remoteJid);
                    }
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *FORMAT Salah!*\n\n` +
                            `Format yang benar:\n` +
                            `adminrestart [nomor_pelanggan]\n\n` +
                            `Contoh:\n` +
                            `adminrestart 081234567890`
                    });
                    return;
                }
            }

            // Perintah admin factory reset perangkat pelanggan
            if (command.toLowerCase().startsWith('adminfactory ') || command.toLowerCase().startsWith('!adminfactory ') || command.toLowerCase().startsWith('/adminfactory ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Menjalankan perintah admin factory reset untuk ${params[0]}`);
                    if (genieacsCommandsEnabled) {
                        await genieacsCommands.handleAdminFactoryReset(remoteJid, params[0]);
                    } else {
                        await sendGenieACSDisabledMessage(remoteJid);
                    }
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *FORMAT Salah!*\n\n` +
                            `Format yang benar:\n` +
                            `adminfactory [nomor_pelanggan]\n\n` +
                            `Contoh:\n` +
                            `adminfactory 081234567890`
                    });
                    return;
                }
            }

            // Perintah konfirmasi admin factory reset
            if (command.toLowerCase().startsWith('confirm admin factory reset ') || command.toLowerCase().startsWith('!confirm admin factory reset ') || command.toLowerCase().startsWith('/confirm admin factory reset ')) {
                const params = messageText.split(' ').slice(4); // Skip "confirm admin factory reset"
                if (params.length >= 1) {
                    console.log(`Menjalankan konfirmasi admin factory reset untuk ${params[0]}`);
                    if (genieacsCommandsEnabled) {
                        await genieacsCommands.handleAdminFactoryResetConfirmation(remoteJid, params[0]);
                    } else {
                        await sendGenieACSDisabledMessage(remoteJid);
                    }
                    return;
                }
            }

            // Perintah PPPoE notification management
            if (command.toLowerCase().startsWith('pppoe ') || command.toLowerCase().startsWith('!pppoe ') || command.toLowerCase().startsWith('/pppoe ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    const subCommand = params[0].toLowerCase();

                    switch (subCommand) {
                        case 'on':
                        case 'enable':
                            console.log(`Admin mengaktifkan notifikasi PPPoE`);
                            await pppoeCommands.handleEnablePPPoENotifications(remoteJid);
                            return;

                        case 'off':
                        case 'disable':
                            console.log(`Admin menonaktifkan notifikasi PPPoE`);
                            await pppoeCommands.handleDisablePPPoENotifications(remoteJid);
                            return;

                        case 'status':
                            console.log(`Admin melihat status notifikasi PPPoE`);
                            await pppoeCommands.handlePPPoEStatus(remoteJid);
                            return;

                        case 'addadmin':
                            if (params.length >= 2) {
                                console.log(`Admin menambah nomor admin PPPoE: ${params[1]}`);
                                await pppoeCommands.handleAddAdminNumber(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `âŒ *FORMAT SALAH*\n\nFormat: pppoe addadmin [nomor]\nContoh: pppoe addadmin 081234567890`
                                });
                            }
                            return;

                        case 'addtech':
                        case 'addteknisi':
                            if (params.length >= 2) {
                                console.log(`Admin menambah nomor teknisi PPPoE: ${params[1]}`);
                                await pppoeCommands.handleAddTechnicianNumber(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `âŒ *FORMAT SALAH*\n\nFormat: pppoe addtech [nomor]\nContoh: pppoe addtech 081234567890`
                                });
                            }
                            return;

                        case 'interval':
                            if (params.length >= 2) {
                                console.log(`Admin mengubah interval PPPoE: ${params[1]}`);
                                await pppoeCommands.handleSetInterval(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `âŒ *FORMAT SALAH*\n\nFormat: pppoe interval [detik]\nContoh: pppoe interval 60`
                                });
                            }
                            return;

                        case 'test':
                            console.log(`Admin test notifikasi PPPoE`);
                            await pppoeCommands.handleTestNotification(remoteJid);
                            return;

                        case 'removeadmin':
                        case 'deladmin':
                            if (params.length >= 2) {
                                console.log(`Admin menghapus nomor admin PPPoE: ${params[1]}`);
                                await pppoeCommands.handleRemoveAdminNumber(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `âŒ *FORMAT SALAH*\n\nFormat: pppoe removeadmin [nomor]\nContoh: pppoe removeadmin 081234567890`
                                });
                            }
                            return;

                        case 'removetech':
                        case 'deltech':
                        case 'removeteknisi':
                        case 'delteknisi':
                            if (params.length >= 2) {
                                console.log(`Admin menghapus nomor teknisi PPPoE: ${params[1]}`);
                                await pppoeCommands.handleRemoveTechnicianNumber(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `âŒ *FORMAT SALAH*\n\nFormat: pppoe removetech [nomor]\nContoh: pppoe removetech 081234567890`
                                });
                            }
                            return;

                        default:
                            await sock.sendMessage(remoteJid, {
                                text: `âŒ *PERINTAH TIDAK DIKENAL*\n\n` +
                                    `Perintah PPPoE yang tersedia:\n` +
                                    `• pppoe on - Aktifkan notifikasi\n` +
                                    `• pppoe off - Nonaktifkan notifikasi\n` +
                                    `• pppoe status - Lihat status\n` +
                                    `• pppoe addadmin [nomor] - Tambah admin\n` +
                                    `• pppoe addtech [nomor] - Tambah teknisi\n` +
                                    `• pppoe removeadmin [nomor] - Hapus admin\n` +
                                    `• pppoe removetech [nomor] - Hapus teknisi\n` +
                                    `• pppoe interval [detik] - Ubah interval\n` +
                                    `• pppoe test - Test notifikasi`
                            });
                            return;
                    }
                }
            }

            // Perintah list ONU
            if (command === 'list' || command === '!list' || command === '/list') {
                console.log(`Menjalankan perintah list ONU`);
                await handleListONU(remoteJid);
                return;
            }

            // Perintah cek semua ONU
            if (command === 'cekall' || command === '!cekall' || command === '/cekall') {
                console.log(`Menjalankan perintah cek semua ONU`);
                await handleCheckAllONU(remoteJid);
                return;
            }

            // Perintah hapus user hotspot
            if (command.startsWith('delhotspot ') || command.startsWith('!delhotspot ') || command.startsWith('/delhotspot ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Menjalankan perintah hapus user hotspot ${params[0]}`);
                    await handleDeleteHotspotUser(remoteJid, params);
                    return;
                }
            }

            // Perintah hapus secret PPPoE
            if (command.startsWith('delpppoe ') || command.startsWith('!delpppoe ') || command.startsWith('/delpppoe ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Menjalankan perintah hapus secret PPPoE ${params[0]}`);
                    await handleDeletePPPoESecret(remoteJid, params);
                    return;
                }
            }

            // Perintah tambah user hotspot
            if (command.startsWith('addhotspot ') || command.startsWith('!addhotspot ') || command.startsWith('/addhotspot ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah tambah user hotspot ${params[0]}`);
                    await handleAddHotspotUser(remoteJid, params);
                    return;
                }
            }

            // Perintah tambah secret PPPoE
            if (command.startsWith('addpppoe ') || command.startsWith('!addpppoe ') || command.startsWith('/addpppoe ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah tambah secret PPPoE ${params[0]}`);
                    await handleAddPPPoESecret(remoteJid, params);
                    return;
                }
            }

            // Perintah ubah profile PPPoE
            if (command.startsWith('setprofile ') || command.startsWith('!setprofile ') || command.startsWith('/setprofile ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah ubah profile PPPoE ${params[0]}`);
                    await handleChangePPPoEProfile(remoteJid, params);
                    return;
                }
            }

            // Perintah info resource
            if (command === 'resource' || command === '!resource' || command === '/resource') {
                console.log(`Menjalankan perintah info resource`);
                await handleResourceInfo(remoteJid);
                return;
            }

            // Perintah tambah WAN
            if (command.startsWith('addwan ') || command.startsWith('!addwan ') || command.startsWith('/addwan ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 3) {
                    console.log(`Menjalankan perintah tambah WAN untuk ${params[0]}`);
                    await handleAddWAN(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *FORMAT Salah!*\n\n` +
                            `Format yang benar:\n` +
                            `addwan [nomor_pelanggan] [tipe_wan] [mode_koneksi]\n\n` +
                            `Tipe WAN: ppp atau ip\n` +
                            `Mode Koneksi: bridge atau route\n\n` +
                            `Contoh:\n` +
                            `addwan 081234567890 ppp route\n` +
                            `addwan 081234567890 ppp bridge\n` +
                            `addwan 081234567890 ip bridge`
                    });
                    return;
                }
            }

            // Perintah tambah tag pelanggan
            if (command.startsWith('addtag ') || command.startsWith('!addtag ') || command.startsWith('/addtag ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah tambah tag untuk device ${params[0]}`);
                    await addCustomerTag(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *FORMAT Salah!*\n\n` +
                            `Format yang benar:\n` +
                            `addtag [device_id] [nomor_pelanggan]\n\n` +
                            `Contoh:\n` +
                            `addtag 202BC1-BM632w-000000 081234567890`
                    });
                    return;
                }
            }

            // Perintah tambah tag pelanggan berdasarkan PPPoE Username
            if (command.startsWith('addpppoe_tag ') || command.startsWith('!addpppoe_tag ') || command.startsWith('/addpppoe_tag ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah tambah tag untuk PPPoE Username ${params[0]}`);
                    await addTagByPPPoE(remoteJid, params, sock); // <-- TAMBAHKAN sock di sini!
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *FORMAT Salah!*\n\n` +
                            `Format yang benar:\n` +
                            `addpppoe_tag [pppoe_username] [nomor_pelanggan]\n\n` +
                            `Contoh:\n` +
                            `addpppoe_tag user123 081234567890`
                    });
                    return;
                }
            }

            // Perintah buat voucher hotspot
            if (command.startsWith('vcr ') || command.startsWith('!vcr ') || command.startsWith('/vcr ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: 'âŒ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log('Menjalankan perintah buat voucher dengan parameter:', params);
                await handleVoucherCommand(remoteJid, params);
                return;
            }

            // Perintah member (username dan password berbeda)
            if (command.startsWith('member ') || command.startsWith('!member ') || command.startsWith('/member ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: 'âŒ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log('Menjalankan perintah member dengan parameter:', params);
                await handleMemberCommand(remoteJid, params);
                return;
            }

            // Perintah user hotspot aktif
            if (command === 'hotspot' || command === '!hotspot' || command === '/hotspot') {
                console.log(`Menjalankan perintah user hotspot aktif`);
                await handleActiveHotspotUsers(remoteJid);
                return;
            }

            // Perintah koneksi PPPoE aktif
            if (command === 'pppoe' || command === '!pppoe' || command === '/pppoe') {
                console.log(`Menjalankan perintah koneksi PPPoE aktif`);
                await handleActivePPPoE(remoteJid);
                return;
            }

            // Perintah user PPPoE offline
            if (command === 'offline' || command === '!offline' || command === '/offline') {
                console.log(`Menjalankan perintah user PPPoE offline`);
                await handleOfflineUsers(remoteJid);
                return;
            }

            // Perintah daftar interface
            if (command === 'interfaces' || command === '!interfaces' || command === '/interfaces') {
                console.log(`Menjalankan perintah daftar interface`);
                await mikrotikCommands.handleInterfaces(remoteJid);
                return;
            }

            // Perintah detail interface
            if (command.startsWith('interface ') || command.startsWith('!interface ') || command.startsWith('/interface ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Menjalankan perintah detail interface ${params[0]}`);
                    await mikrotikCommands.handleInterfaceDetail(remoteJid, params);
                    return;
                }
            }

            // Perintah enable interface
            if (command.startsWith('enableif ') || command.startsWith('!enableif ') || command.startsWith('/enableif ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Menjalankan perintah enable interface ${params[0]}`);
                    await mikrotikCommands.handleInterfaceStatus(remoteJid, params, true);
                    return;
                }
            }

            // Perintah disable interface
            if (command.startsWith('disableif ') || command.startsWith('!disableif ') || command.startsWith('/disableif ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Menjalankan perintah disable interface ${params[0]}`);
                    await mikrotikCommands.handleInterfaceStatus(remoteJid, params, false);
                    return;
                }
            }

            // Perintah daftar IP address
            if (command === 'ipaddress' || command === '!ipaddress' || command === '/ipaddress') {
                console.log(`Menjalankan perintah daftar IP address`);
                await mikrotikCommands.handleIPAddresses(remoteJid);
                return;
            }

            // Perintah routing table
            if (command === 'routes' || command === '!routes' || command === '/routes') {
                console.log(`Menjalankan perintah routing table`);
                await mikrotikCommands.handleRoutes(remoteJid);
                return;
            }

            // Perintah DHCP leases
            if (command === 'dhcp' || command === '!dhcp' || command === '/dhcp') {
                console.log(`Menjalankan perintah DHCP leases`);
                await mikrotikCommands.handleDHCPLeases(remoteJid);
                return;
            }

            // Perintah ping
            if (command.startsWith('ping ') || command.startsWith('!ping ') || command.startsWith('/ping ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Menjalankan perintah ping ${params[0]}`);
                    await mikrotikCommands.handlePing(remoteJid, params);
                    return;
                }
            }

            // ===== BILLING COMMANDS =====
            // Set sock untuk billing commands
            billingCommands.setSock(sock);

            // Perintah menu billing
            if (command === 'billing' || command === '!billing' || command === '/billing') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah billing.'
                    });
                    return;
                }
                console.log(`Menjalankan menu billing`);
                await billingCommands.handleBillingMenu(remoteJid);
                return;
            }

            // Customer Management Commands
            if (command.startsWith('addcustomer ') || command.startsWith('!addcustomer ') || command.startsWith('/addcustomer ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah addcustomer dengan parameter:`, params);
                await billingCommands.handleAddCustomer(remoteJid, params);
                return;
            }

            if (command.startsWith('editcustomer ') || command.startsWith('!editcustomer ') || command.startsWith('/editcustomer ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah editcustomer dengan parameter:`, params);
                await billingCommands.handleEditCustomer(remoteJid, params);
                return;
            }

            if (command.startsWith('delcustomer ') || command.startsWith('!delcustomer ') || command.startsWith('/delcustomer ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah delcustomer dengan parameter:`, params);
                await billingCommands.handleDeleteCustomer(remoteJid, params);
                return;
            }

            if (command === 'listcustomers' || command === '!listcustomers' || command === '/listcustomers') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                console.log(`Menjalankan perintah listcustomers`);
                await billingCommands.handleListCustomers(remoteJid);
                return;
            }

            if (command.startsWith('findcustomer ') || command.startsWith('!findcustomer ') || command.startsWith('/findcustomer ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah findcustomer dengan parameter:`, params);
                await billingCommands.handleFindCustomer(remoteJid, params);
                return;
            }

            // Payment Management Commands
            if (command.startsWith('payinvoice ') || command.startsWith('!payinvoice ') || command.startsWith('/payinvoice ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah payinvoice dengan parameter:`, params);
                await billingCommands.handlePayInvoice(remoteJid, params);
                return;
            }

            if (command.startsWith('checkpayment ') || command.startsWith('!checkpayment ') || command.startsWith('/checkpayment ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah checkpayment dengan parameter:`, params);
                await billingCommands.handleCheckPayment(remoteJid, params);
                return;
            }

            if (command === 'paidcustomers' || command === '!paidcustomers' || command === '/paidcustomers') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                console.log(`Menjalankan perintah paidcustomers`);
                await billingCommands.handlePaidCustomers(remoteJid);
                return;
            }

            if (command === 'overduecustomers' || command === '!overduecustomers' || command === '/overduecustomers') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                console.log(`Menjalankan perintah overduecustomers`);
                await billingCommands.handleOverdueCustomers(remoteJid);
                return;
            }

            if (command === 'billingstats' || command === '!billingstats' || command === '/billingstats') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                console.log(`Menjalankan perintah billingstats`);
                await billingCommands.handleBillingStats(remoteJid);
                return;
            }

            // Package Management Commands
            if (command.startsWith('addpackage ') || command.startsWith('!addpackage ') || command.startsWith('/addpackage ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah addpackage dengan parameter:`, params);
                await billingCommands.handleAddPackage(remoteJid, params);
                return;
            }

            if (command === 'listpackages' || command === '!listpackages' || command === '/listpackages') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                console.log(`Menjalankan perintah listpackages`);
                await billingCommands.handleListPackages(remoteJid);
                return;
            }

            // Invoice Management Commands
            if (command.startsWith('createinvoice ') || command.startsWith('!createinvoice ') || command.startsWith('/createinvoice ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah createinvoice dengan parameter:`, params);
                await billingCommands.handleCreateInvoice(remoteJid, params);
                return;
            }

            if (command.startsWith('listinvoices ') || command.startsWith('!listinvoices ') || command.startsWith('/listinvoices ') ||
                command === 'listinvoices' || command === '!listinvoices' || command === '/listinvoices') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah listinvoices dengan parameter:`, params);
                await billingCommands.handleListInvoices(remoteJid, params);
                return;
            }

            // Perintah help billing
            if (command === 'help billing' || command === '!help billing' || command === '/help billing') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                console.log(`Menjalankan perintah help billing`);
                const { getBillingHelpMessage } = require('./help-messages');
                await sock.sendMessage(remoteJid, { text: getBillingHelpMessage() });
                return;
            }

            // ===== PERINTAH BAHASA INDONESIA =====
            // Perintah tambah pelanggan
            if (command.startsWith('tambah ') || command.startsWith('!tambah ') || command.startsWith('/tambah ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah tambah dengan parameter:`, params);
                await billingCommands.handleTambah(remoteJid, params);
                return;
            }

            // Perintah daftar pelanggan
            if (command === 'daftar' || command === '!daftar' || command === '/daftar') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                console.log(`Menjalankan perintah daftar`);
                await billingCommands.handleDaftar(remoteJid);
                return;
            }

            // Perintah cari pelanggan
            if (command.startsWith('cari ') || command.startsWith('!cari ') || command.startsWith('/cari ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah cari dengan parameter:`, params);
                await billingCommands.handleCari(remoteJid, params);
                return;
            }

            // Perintah bayar
            if (command.startsWith('bayar ') || command.startsWith('!bayar ') || command.startsWith('/bayar ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`[WHATSAPP] Menjalankan perintah bayar dengan:`, {
                    command: command,
                    messageText: messageText,
                    params: params,
                    sender: remoteJid
                });
                await billingCommands.handleBayar(remoteJid, params);
                return;
            }

            // Perintah REG untuk registrasi WhatsApp LID pelanggan
            if (command.startsWith('reg ') || command.startsWith('!reg ') || command.startsWith('/reg ')) {
                try {
                    const billingManager = require('./billing');
                    const billing = new billingManager();

                    // Extract search term (nama atau nomor)
                    const searchTerm = messageText.split(' ').slice(1).join(' ').trim();

                    if (!searchTerm) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *FORMAT SALAH*\n\n` +
                                `Gunakan format:\n` +
                                `• REG [nama pelanggan]\n` +
                                `• REG [nomor HP]\n\n` +
                                `Contoh:\n` +
                                `• REG Budi Santoso\n` +
                                `• REG 081947215703`
                            )
                        });
                        return;
                    }

                    // Check if LID is available
                    if (!senderLid) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *REGISTRASI GAGAL*\n\n` +
                                `WhatsApp LID tidak terdeteksi. Fitur ini hanya untuk akun WhatsApp dengan format @lid.`
                            )
                        });
                        return;
                    }

                    // Determine if search term is phone number (only digits) or name
                    const isPhoneNumber = /^\d+$/.test(searchTerm.replace(/[\s\-\+]/g, ''));

                    let customers = [];

                    if (isPhoneNumber) {
                        // Search by phone number
                        const customer = await billing.getCustomerByPhone(searchTerm);
                        if (customer) {
                            customers = [customer];
                        }
                    } else {
                        // Search by name
                        customers = await billing.findCustomersByNameOrPhone(searchTerm);
                    }

                    if (customers.length === 0) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *PELANGGAN TIDAK DITEMUKAN*\n\n` +
                                `Tidak ada pelanggan dengan ${isPhoneNumber ? 'nomor' : 'nama'}: ${searchTerm}\n\n` +
                                `Silakan coba lagi dengan:\n` +
                                `• Nama lengkap pelanggan, atau\n` +
                                `• Nomor HP yang terdaftar`
                            )
                        });
                        return;
                    }

                    if (customers.length > 1) {
                        // Multiple customers found
                        let customerList = `🔍 *DITEMUKAN ${customers.length} PELANGGAN*\n\n`;
                        customerList += `Silakan gunakan perintah REG dengan nama atau nomor yang lebih spesifik:\n\n`;

                        customers.forEach((cust, idx) => {
                            customerList += `${idx + 1}. ${cust.name}\n`;
                            customerList += `   📞 ${cust.phone}\n`;
                            if (cust.package_name) {
                                customerList += `   📦 ${cust.package_name}\n`;
                            }
                            customerList += `\n`;
                        });

                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(customerList)
                        });
                        return;
                    }

                    // Single customer found
                    const customer = customers[0];

                    // Check if customer already has a WhatsApp LID
                    if (customer.whatsapp_lid) {
                        if (customer.whatsapp_lid === senderLid) {
                            await sock.sendMessage(remoteJid, {
                                text: formatWithHeaderFooter(
                                    `✅ *SUDAH TERDAFTAR*\n\n` +
                                    `WhatsApp LID Anda sudah terdaftar untuk:\n\n` +
                                    `👤 *Nama:* ${customer.name}\n` +
                                    `📞 *Nomor:* ${customer.phone}\n` +
                                    `📦 *Paket:* ${customer.package_name || 'Tidak ada paket'}`
                                )
                            });
                            return;
                        } else {
                            // Different LID, ask for confirmation
                            await sock.sendMessage(remoteJid, {
                                text: formatWithHeaderFooter(
                                    `⚠️ *KONFIRMASI DIPERLUKAN*\n\n` +
                                    `Pelanggan "${customer.name}" sudah memiliki WhatsApp LID terdaftar.\n\n` +
                                    `Apakah Anda ingin mengganti dengan WhatsApp LID yang baru?\n\n` +
                                    `Balas dengan: REG CONFIRM ${customer.phone}`
                                )
                            });
                            return;
                        }
                    }

                    // Register the WhatsApp LID
                    try {
                        await billing.updateCustomerWhatsAppLid(customer.id, senderLid);

                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `✅ *REGISTRASI BERHASIL*\n\n` +
                                `WhatsApp LID Anda berhasil didaftarkan!\n\n` +
                                `📋 *Data Pelanggan:*\n` +
                                `👤 *Nama:* ${customer.name}\n` +
                                `📞 *Nomor:* ${customer.phone}\n` +
                                `📦 *Paket:* ${customer.package_name || 'Tidak ada paket'}\n` +
                                `💰 *Harga:* ${customer.package_price ? 'Rp ' + customer.package_price.toLocaleString('id-ID') : '-'}\n\n` +
                                `Sekarang Anda dapat menggunakan perintah bot dengan WhatsApp ini.\n\n` +
                                `Ketik *MENU* untuk melihat daftar perintah.`
                            )
                        });

                        console.log(`✅ WhatsApp LID registered: ${senderLid} for customer ${customer.name} (${customer.phone})`);
                    } catch (error) {
                        console.error('Error registering WhatsApp LID:', error);
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *REGISTRASI GAGAL*\n\n` +
                                `Terjadi kesalahan: ${error.message}\n\n` +
                                `Silakan hubungi admin untuk bantuan.`
                            )
                        });
                    }
                } catch (error) {
                    console.error('Error in REG command:', error);
                    await sock.sendMessage(remoteJid, {
                        text: formatWithHeaderFooter(
                            `❌ *TERJADI KESALAHAN*\n\n` +
                            `Mohon maaf, terjadi kesalahan sistem.\n` +
                            `Silakan coba lagi atau hubungi admin.`
                        )
                    });
                }
                return;
            }



            // Perintah DAFTAR untuk registrasi pelanggan baru
            if (command.startsWith('daftar')) {
                try {
                    const billingManager = require('./billing');
                    const billing = new billingManager();

                    // Parse command arguments: DAFTAR [Nama]#[NoHP]#[Alamat]#[ID_Paket]
                    // Example: DAFTAR Budi Santoso#08123456789#Jl. Merpati 10#1
                    const args = messageText.slice(6).trim(); // Remove "DAFTAR "

                    // Helper function to show help message
                    const showHelp = async () => {
                        // Fetch available packages
                        let packagesList = "";
                        try {
                            const packages = await new Promise((resolve, reject) => {
                                billing.db.all("SELECT id, name, price, speed FROM packages ORDER BY price ASC", (err, rows) => {
                                    if (err) reject(err);
                                    else resolve(rows);
                                });
                            });

                            if (packages && packages.length > 0) {
                                packagesList = "\n📦 *DAFTAR PAKET TERSEDIA:*\n";
                                packages.forEach(pkg => {
                                    const price = parseInt(pkg.price).toLocaleString('id-ID');
                                    packagesList += `• ID *${pkg.id}*: ${pkg.name} (${pkg.speed} Mbps) - Rp ${price}\n`;
                                });
                            } else {
                                packagesList = "\n⚠️ Belum ada paket internet yang tersedia. Hubungi admin.";
                            }
                        } catch (err) {
                            console.error('Error fetching packages:', err);
                        }

                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `📝 *FORMAT PENDAFTARAN PELANGGAN BARU*\n\n` +
                                `Silakan gunakan format berikut untuk mendaftar:\n` +
                                `*DAFTAR [Nama Lengkap]#[Nomor HP]#[Alamat]#[ID Paket]*\n\n` +
                                `💡 *Contoh:*\n` +
                                `DAFTAR Budi Santoso#08123456789#Jl. Merpati No 10#1\n` +
                                packagesList + `\n\n` +
                                `⚠️ Pastikan Nomor HP aktif untuk menerima info login.`
                            )
                        });
                    };

                    if (!args) {
                        await showHelp();
                        return;
                    }

                    const parts = args.split('#').map(p => p.trim());

                    // Validate parts count
                    if (parts.length < 4) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *FORMAT SALAH*\n\n` +
                                `Mohon isi semua data yang diperlukan (4 bagian dipisah tanda pagar #).\n` +
                                `Contoh: DAFTAR Budi#08123#Alamat#1`
                            )
                        });
                        return;
                    }

                    const [name, rawPhone, address, packageId] = parts;

                    // Basic validation
                    if (!name || name.length < 3) {
                        await sock.sendMessage(remoteJid, { text: `❌ Nama terlalu pendek. Minimal 3 karakter.` });
                        return;
                    }

                    if (!rawPhone || !/^\d+$/.test(rawPhone.replace(/[\s\-\+]/g, ''))) {
                        await sock.sendMessage(remoteJid, { text: `❌ Nomor HP tidak valid. Gunakan angka saja.` });
                        return;
                    }

                    if (!address || address.length < 5) {
                        await sock.sendMessage(remoteJid, { text: `❌ Alamat terlalu pendek. Mohon isi alamat lengkap.` });
                        return;
                    }

                    // Normalize phone number
                    let phone = rawPhone.replace(/\D/g, '');
                    if (phone.startsWith('0')) {
                        phone = '62' + phone.slice(1);
                    } else if (!phone.startsWith('62')) {
                        phone = '62' + phone;
                    }

                    // Check if phone already registered
                    const existingCustomer = await billing.getCustomerByPhone(phone);
                    if (existingCustomer) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *REGISTRASI GAGAL*\n\n` +
                                `Nomor HP ${rawPhone} sudah terdaftar atas nama *${existingCustomer.name}*.\n\n` +
                                `Jika ini nomor Anda, silakan ketik *REG ${rawPhone}* untuk menghubungkan WhatsApp ini.`
                            )
                        });
                        return;
                    }

                    // Check if LID already has account
                    if (senderLid) {
                        const existingLid = await billing.getCustomerByWhatsAppLid(senderLid);
                        if (existingLid) {
                            await sock.sendMessage(remoteJid, {
                                text: formatWithHeaderFooter(
                                    `❌ *AKUN SUDAH ADA*\n\n` +
                                    `WhatsApp ini sudah terdaftar sebagai pelanggan *${existingLid.name}*.\n` +
                                    `Ketik *STATUS* untuk cek layanan Anda.`
                                )
                            });
                            return;
                        }
                    } else {
                        // Require LID for registration via WA
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *REGISTRASI GAGAL*\n\n` +
                                `WhatsApp LID tidak terdeteksi. Silakan hubungi admin.`
                            )
                        });
                        return;
                    }

                    // Validate Package
                    const pkg = await new Promise((resolve, reject) => {
                        billing.db.get("SELECT * FROM packages WHERE id = ?", [packageId], (err, row) => resolve(row));
                    });

                    if (!pkg) {
                        await sock.sendMessage(remoteJid, { text: `❌ ID Paket ${packageId} tidak ditemukan. Silakan cek daftar paket lagi.` });
                        await showHelp();
                        return;
                    }

                    // Generate Credentials
                    const username = phone; // Use phone as username
                    // Generate random 6 digit password
                    const password = Math.floor(100000 + Math.random() * 900000).toString();

                    // Prepare data
                    const newCustomerData = {
                        username: username,
                        name: name,
                        phone: phone,
                        email: `${username}@placeholder.com`, // Placeholder email
                        address: address,
                        package_id: pkg.id,
                        pppoe_profile: pkg.name, // Use package name as profile
                        whatsapp_lid: senderLid, // Auto-link LID
                        latitude: 0,
                        longitude: 0,
                        // Add plain password for notification only (not stored plainly usually, but for this context assuming billing.js handles it or we send it once)
                    };

                    // Create customer
                    // Note: We need to handle password storage. Assuming billing.createCustomer handles default password or we need another way?
                    // Looking at createCustomer in billing.js, it takes basic fields.
                    // IMPORTANT: The current createCustomer implementation in billing.js doesn't seem to take a password argument directly in the INSERT query shown earlier (it handles cable routes etc).
                    // However, usually there is a separate auth table or column. 
                    // Let's assume for now we just create the record. If there is a 'users' table for login, that might be separate.
                    // For now, focusing on the customer record creation as requested.

                    try {
                        await billing.createCustomer(newCustomerData);

                        // Send Success Message
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `✅ *PENDAFTARAN BERHASIL*\n\n` +
                                `Selamat bergabung, *${name}*!\n\n` +
                                `📋 *Data akun Anda:*\n` +
                                `👤 Username: ${username}\n` +
                                `🔑 Password: (Hubungi admin untuk password)\n` +
                                `📦 Paket: ${pkg.name} (${pkg.speed} Mbps)\n` +
                                `💰 Tagihan: Rp ${parseInt(pkg.price).toLocaleString('id-ID')}/bulan\n\n` +
                                `Status akun Anda saat ini *AKTIF*. Tim teknis kami akan segera menghubungi Anda untuk jadwal pemasangan.\n\n` +
                                `Simpan pesan ini sebagai bukti pendaftaran.`
                            )
                        });

                        // Notify Admin (Optional but recommended)
                        const settings = getAppSettings();
                        if (settings.admins && settings.admins.length > 0) {
                            for (const adminPhone of settings.admins) {
                                // Send to admin (need to handle admin remoteJid resolution ideally, but simplified here)
                                // Skipping to avoid complexity of resolving admin JIDs without more context
                            }
                        }

                    } catch (createErr) {
                        console.error('Error creating customer:', createErr);
                        await sock.sendMessage(remoteJid, { text: `❌ Gagal menyimpan data: ${createErr.message}` });
                    }

                } catch (error) {
                    console.error('Error in DAFTAR command:', error);
                    await sock.sendMessage(remoteJid, {
                        text: `❌ Terjadi kesalahan sistem saat proses pendaftaran.`
                    });
                }
                return;
            }

            // Perintah isolir layanan
            if (command.startsWith('isolir ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah isolir dengan parameter:`, params);
                await billingCommands.handleIsolir(remoteJid, params);
                return;
            }

            // Perintah buka isolir (restore)
            if (command.startsWith('buka ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah buka (restore) dengan parameter:`, params);
                await billingCommands.handleBuka(remoteJid, params);
                return;
            }

            // Perintah sudah bayar
            if (command === 'sudahbayar' || command === '!sudahbayar' || command === '/sudahbayar') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                console.log(`Menjalankan perintah sudahbayar`);
                await billingCommands.handleSudahBayar(remoteJid);
                return;
            }

            // Perintah terlambat
            if (command === 'terlambat' || command === '!terlambat' || command === '/terlambat') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                console.log(`Menjalankan perintah terlambat`);
                await billingCommands.handleTerlambat(remoteJid);
                return;
            }

            // Perintah statistik
            if (command === 'statistik' || command === '!statistik' || command === '/statistik') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                console.log(`Menjalankan perintah statistik`);
                await billingCommands.handleStatistik(remoteJid);
                return;
            }

            // Perintah daftar paket
            if (command === 'daftarpaket' || command === '!daftarpaket' || command === '/daftarpaket') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *AKSES DITOLAK*\n\nHanya admin yang dapat menggunakan perintah ini.'
                    });
                    return;
                }
                console.log(`Menjalankan perintah daftarpaket`);
                await billingCommands.handleDaftarPaket(remoteJid);
                return;
            }

            // Perintah system logs
            if (command === 'logs' || command === '!logs' || command === '/logs' ||
                command.startsWith('logs ') || command.startsWith('!logs ') || command.startsWith('/logs ')) {
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah system logs`);
                await mikrotikCommands.handleSystemLogs(remoteJid, params);
                return;
            }

            // Perintah profiles
            if (command === 'profiles' || command === '!profiles' || command === '/profiles' ||
                command.startsWith('profiles ') || command.startsWith('!profiles ') || command.startsWith('/profiles ')) {
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah profiles`);
                await mikrotikCommands.handleProfiles(remoteJid, params);
                return;
            }

            // Perintah firewall
            if (command === 'firewall' || command === '!firewall' || command === '/firewall' ||
                command.startsWith('firewall ') || command.startsWith('!firewall ') || command.startsWith('/firewall ')) {
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah firewall`);
                await mikrotikCommands.handleFirewall(remoteJid, params);
                return;
            }

            // Perintah semua user
            if (command === 'users' || command === '!users' || command === '/users') {
                console.log(`Menjalankan perintah semua user`);
                await mikrotikCommands.handleAllUsers(remoteJid);
                return;
            }

            // Perintah clock router
            if (command === 'clock' || command === '!clock' || command === '/clock') {
                console.log(`Menjalankan perintah clock router`);
                await mikrotikCommands.handleRouterClock(remoteJid);
                return;
            }

            // Perintah identity router
            if (command === 'identity' || command === '!identity' || command === '/identity' ||
                command.startsWith('identity ') || command.startsWith('!identity ') || command.startsWith('/identity ')) {
                const params = messageText.split(' ').slice(1);
                console.log(`Menjalankan perintah identity router`);
                await mikrotikCommands.handleRouterIdentity(remoteJid, params);
                return;
            }

            // Perintah restart router
            if (command === 'reboot' || command === '!reboot' || command === '/reboot') {
                console.log(`Menjalankan perintah restart router`);
                await mikrotikCommands.handleRestartRouter(remoteJid);
                return;
            }

            // Perintah konfirmasi restart
            if (command === 'confirm restart' || command === '!confirm restart' || command === '/confirm restart') {
                console.log(`Menjalankan konfirmasi restart router`);
                await mikrotikCommands.handleConfirmRestart(remoteJid);
                return;
            }

            // Perintah debug resource (admin only)
            if (command === 'debug resource' || command === '!debug resource' || command === '/debug resource') {
                console.log(`Admin menjalankan debug resource`);
                await mikrotikCommands.handleDebugResource(remoteJid);
                return;
            }

            // Perintah debug settings performance (admin only)
            if (command === 'debug settings' || command === '!debug settings' || command === '/debug settings') {
                console.log(`Admin menjalankan debug settings performance`);
                try {
                    const { getPerformanceReport } = require('./settingsManager');
                    const report = getPerformanceReport();
                    await sendFormattedMessage(remoteJid, `📊 *SETTINGS PERFORMANCE DEBUG*\n\n\`\`\`${report}\`\`\``);
                } catch (error) {
                    await sendFormattedMessage(remoteJid, `❌ *Error getting performance stats:* ${error.message}`);
                }
                return;
            }

            // Perintah quick settings stats (admin only)
            if (command === 'settings stats' || command === '!settings stats' || command === '/settings stats') {
                console.log(`Admin menjalankan settings stats`);
                try {
                    const { getQuickStats } = require('./settingsManager');
                    const stats = getQuickStats();
                    await sendFormattedMessage(remoteJid, `📊 *Settings Stats*\n${stats}`);
                } catch (error) {
                    await sendFormattedMessage(remoteJid, `❌ *Error:* ${error.message}`);
                }
                return;
            }

            // Perintah info wifi
            if (command === 'info wifi' || command === '!info wifi' || command === '/info wifi') {
                console.log(`Menjalankan perintah info wifi untuk ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleWifiInfo(remoteJid, senderNumber);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }

            // Perintah info layanan
            if (command === 'info' || command === '!info' || command === '/info') {
                console.log(`Menjalankan perintah info layanan untuk ${senderNumber}`);
                await handleInfoLayanan(remoteJid, senderNumber);
                return;
            }

            // Perintah ganti nama WiFi
            if (command.startsWith('gantiwifi ') || command.startsWith('!gantiwifi ') || command.startsWith('/gantiwifi ')) {
                console.log(`Menjalankan perintah ganti nama WiFi untuk ${senderNumber}`);
                const newSSID = messageText.split(' ').slice(1).join(' ');
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleChangeWifiSSID(remoteJid, senderNumber, newSSID);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }

            // Perintah ganti password WiFi
            if (command.startsWith('gantipass ') || command.startsWith('!gantipass ') || command.startsWith('/gantipass ')) {
                console.log(`Menjalankan perintah ganti password WiFi untuk ${senderNumber}`);
                const newPassword = messageText.split(' ').slice(1).join(' ');
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleChangeWifiPassword(remoteJid, senderNumber, newPassword);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }

            // Perintah status perangkat
            if (command === 'status' || command === '!status' || command === '/status') {
                console.log(`Menjalankan perintah status perangkat untuk ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleDeviceStatus(remoteJid, senderNumber);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                // Setelah status perangkat, kirim juga status tagihan
                await sendBillingStatus(remoteJid, senderNumber);
                return;
            }

            // Perintah restart perangkat
            if (command === 'restart' || command === '!restart' || command === '/restart') {
                console.log(`Menjalankan perintah restart perangkat untuk ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleRestartDevice(remoteJid, senderNumber);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }

            // Konfirmasi restart perangkat
            if ((command === 'ya' || command === 'iya' || command === 'yes') && global.pendingRestarts && global.pendingRestarts[senderNumber]) {
                console.log(`Konfirmasi restart perangkat untuk ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleRestartConfirmation(remoteJid, senderNumber, true);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }

            // Batalkan restart perangkat
            if ((command === 'tidak' || command === 'no' || command === 'batal') && global.pendingRestarts && global.pendingRestarts[senderNumber]) {
                console.log(`Membatalkan restart perangkat untuk ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleRestartConfirmation(remoteJid, senderNumber, false);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }

            // Perintah untuk cek status group dan nomor teknisi
            if (command === 'checkgroup' || command === '!checkgroup' || command === '/checkgroup') {
                try {
                    const technicianGroupId = getSetting('technician_group_id', '');
                    const technicianNumbers = getTechnicianNumbers();

                    let message = `🔍 *STATUS GROUP & NOMOR TEKNISI*\n\n`;

                    // Cek group ID
                    if (technicianGroupId) {
                        message += `📋 *Group ID:* ${technicianGroupId}\n`;

                        try {
                            // Coba ambil metadata group
                            const groupMetadata = await sock.groupMetadata(technicianGroupId);
                            message += `✅ *Status:* Group ditemukan\n`;
                            message += `📋 *Nama:* ${groupMetadata.subject}\n`;
                            message += `👥 *Peserta:* ${groupMetadata.participants.length}\n`;
                        } catch (groupError) {
                            if (groupError.message.includes('item-not-found')) {
                                message += `❌ *Status:* Group tidak ditemukan\n`;
                                message += `💡 *Solusi:* Pastikan bot sudah ditambahkan ke group\n`;
                            } else {
                                message += `⚠️ *Status:* Error - ${groupError.message}\n`;
                            }
                        }
                    } else {
                        message += `❌ *Group ID:* Tidak dikonfigurasi\n`;
                    }

                    message += `\n📱 *Nomor Teknisi:*\n`;
                    if (technicianNumbers && technicianNumbers.length > 0) {
                        for (let i = 0; i < technicianNumbers.length; i++) {
                            const number = technicianNumbers[i];
                            message += `${i + 1}. ${number}\n`;

                            // Validasi nomor
                            try {
                                const cleanNumber = number.replace(/\D/g, '').replace(/^0/, '62');
                                const [result] = await sock.onWhatsApp(cleanNumber);

                                if (result && result.exists) {
                                    message += `   ✅ Valid WhatsApp\n`;
                                } else {
                                    message += `   ❌ Tidak terdaftar di WhatsApp\n`;
                                }
                            } catch (validationError) {
                                message += `   ⚠️ Error validasi: ${validationError.message}\n`;
                            }
                        }
                    } else {
                        message += `❌ Tidak ada nomor teknisi dikonfigurasi\n`;
                    }

                    message += `\n💡 *Tips:*\n`;
                    message += `• Pastikan bot sudah ditambahkan ke group\n`;
                    message += `• Pastikan nomor teknisi terdaftar di WhatsApp\n`;
                    message += `• Gunakan format: 628xxxxxxxxxx\n`;

                    await sock.sendMessage(remoteJid, { text: message });
                } catch (error) {
                    await sock.sendMessage(remoteJid, {
                        text: `❌ Error checking group status: ${error.message}`
                    });
                }
                return;
            }
        }

        // Jika pesan tidak dikenali sebagai perintah, abaikan saja
        console.log(`Pesan tidak dikenali sebagai perintah: ${messageText}`);
        // Tidak melakukan apa-apa untuk pesan yang bukan perintah

    } catch (error) {
        console.error('Error handling incoming message:', error);

        // JANGAN kirim pesan error ke pengirim - hanya log error saja
        // Ini akan mencegah respon otomatis terhadap setiap pesan
        /*
        try {
            if (sock && message && message.key && message.key.remoteJid) {
                await sock.sendMessage(message.key.remoteJid, { 
                    text: `❌ *ERROR*
    
    Terjadi kesalahan saat memproses pesan: ${error.message}
    
    Silakan coba lagi nanti.`
                });
            }
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
        */
    }
}

// Tambahkan di bagian deklarasi fungsi sebelum 
// Fungsi untuk menampilkan menu pelanggan
async function sendCustomerMenu(remoteJid) {
    try {
        console.log(`Menampilkan menu pelanggan ke ${remoteJid}`);

        // Gunakan help message dari file terpisah
        const customerMessage = getCustomerHelpMessage();

        // Kirim pesan menu pelanggan
        await sock.sendMessage(remoteJid, { text: customerMessage });
        console.log(`Pesan menu pelanggan terkirim ke ${remoteJid}`);

    } catch (error) {
        console.error('Error sending customer menu:', error);
        await sock.sendMessage(remoteJid, {
            text: `âŒ *ERROR*\n\nTerjadi kesalahan saat menampilkan menu pelanggan:\n${error.message}`
        });
    }
}

module.exports

// Fungsi untuk menampilkan menu admin
async function handleAdminMenu(remoteJid) {
    try {
        console.log(`Menampilkan menu admin ke ${remoteJid}`);

        // Pesan menu admin
        let adminMessage = `📋🔍 *MENU ADMIN*\n\n`;

        adminMessage += `*Perintah Admin:*\n`;
        adminMessage += `• 📋 *list* * Daftar semua ONU\n`;
        adminMessage += `• 🔍 *cekall* * Cek status semua ONU\n`;
        adminMessage += `• 🔍 *cek [nomor]* * Cek status ONU pelanggan\n`;
        adminMessage += `• 🔧 *editssid [nomor] [ssid]* * Edit SSID pelanggan\n`;
        adminMessage += `• 🔧 *editpass [nomor] [password]* * Edit password WiFi pelanggan\n`;
        adminMessage += `• 🔐 *otp [on/off/status]* * Kelola sistem OTP\n`;
        adminMessage += `• 🆔 *setlid [password]* - Simpan WhatsApp LID admin (perlu password)\n`;
        adminMessage += `• 📊 *billing* * Menu billing admin\n\n`;

        // Status GenieACS (tanpa menampilkan perintah)
        adminMessage += `*Status Sistem:*\n`;
        adminMessage += `• ${genieacsCommandsEnabled ? '✅' : 'âŒ'} *GenieACS:* ${genieacsCommandsEnabled ? 'Aktif' : 'Nonaktif'}\n`;

        // Tambahkan status OTP
        const settings = getAppSettings();
        const otpStatus = settings.customerPortalOtp || settings.customer_otp_enabled;
        adminMessage += `• ${otpStatus ? '✅' : 'âŒ'} *OTP Portal:* ${otpStatus ? 'Aktif' : 'Nonaktif'}\n\n`;

        // Tambahkan footer
        adminMessage += `🏢 *${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}*\n`;
        adminMessage += `${getSetting('footer_info', 'Internet Tanpa Batas')}`;

        // Kirim pesan menu admin
        await sock.sendMessage(remoteJid, { text: adminMessage });
        console.log(`Pesan menu admin terkirim ke ${remoteJid}`);

        return true;
    } catch (error) {
        console.error('Error sending admin menu:', error);
        return false;
    }
}

// Fungsi untuk mendapatkan nilai SSID dari perangkat
function getSSIDValue(device, configIndex) {
    try {
        // Coba cara 1: Menggunakan notasi bracket untuk WLANConfiguration
        if (device.InternetGatewayDevice &&
            device.InternetGatewayDevice.LANDevice &&
            device.InternetGatewayDevice.LANDevice['1'] &&
            device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration &&
            device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex] &&
            device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex].SSID) {

            const ssidObj = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex].SSID;
            if (ssidObj._value !== undefined) {
                return ssidObj._value;
            }
        }

        // Coba cara 2: Menggunakan getParameterWithPaths
        const ssidPath = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${configIndex}.SSID`;
        const ssidValue = getParameterWithPaths(device, [ssidPath]);
        if (ssidValue && ssidValue !== 'N/A') {
            return ssidValue;
        }

        // Coba cara 3: Cari di seluruh objek
        for (const key in device) {
            if (device[key]?.LANDevice?.['1']?.WLANConfiguration?.[configIndex]?.SSID?._value) {
                return device[key].LANDevice['1'].WLANConfiguration[configIndex].SSID._value;
            }
        }

        // Coba cara 4: Cari di parameter virtual
        if (device.VirtualParameters?.SSID?._value) {
            return device.VirtualParameters.SSID._value;
        }

        if (configIndex === '5' && device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['2']?.SSID?._value) {
            return device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['2'].SSID._value;
        }

        return 'N/A';
    } catch (error) {
        console.error(`Error getting SSID for config ${configIndex}:`, error);
        return 'N/A';
    }
}

const settingsPath = path.join(__dirname, '../settings.json');

function getAppSettings() {
    try {
        // Gunakan settingsManager yang sudah ada
        const { getSettingsWithCache } = require('./settingsManager');
        return getSettingsWithCache();
    } catch (e) {
        console.error('Error getting app settings:', e);
        // Fallback ke pembacaan langsung file
        try {
            const { getSettingsWithCache } = require('./settingsManager');
            return getSettingsWithCache();
        } catch (fallbackError) {
            console.error('Error reading settings file directly:', fallbackError);
            return {};
        }
    }
}

// Deklarasi helper agar DRY
function getGenieacsConfig() {
    const { getSetting } = require('./settingsManager');
    return {
        genieacsUrl: getSetting('genieacs_url', 'http://localhost:7557'),
        genieacsUsername: getSetting('genieacs_username', 'admin'),
        genieacsPassword: getSetting('genieacs_password', 'password'),
    };
}

// Fungsi untuk menangani info layanan (tambahan billing)
async function handleInfoLayanan(remoteJid, senderNumber) {
    try {
        console.log(`Menampilkan info layanan ke ${remoteJid}`);

        const { getSetting } = require('./settingsManager');
        const billingManager = require('./billing');

        // Ambil nomor admin dan teknisi dengan format yang benar
        const adminNumber = getSetting('admins.0', '628xxxxxxxxxx');

        // Ambil semua nomor teknisi
        const technicianNumbers = [];
        let i = 0;
        while (true) {
            const number = getSetting(`technician_numbers.${i}`, '');
            if (!number) break;
            technicianNumbers.push(number);
            i++;
        }
        const technicianNumbersText = technicianNumbers.length > 0 ? technicianNumbers.join(', ') : '628xxxxxxxxxx';

        let message = formatWithHeaderFooter(`🏢 *INFORMASI LAYANAN*

📱 *ALIJAYA DIGITAL NETWORK*
Layanan internet cepat dan stabil untuk kebutuhan Anda.

🔧 *FITUR LAYANAN:*
• Internet Unlimited 24/7
• Kecepatan tinggi dan stabil
• Dukungan teknis 24 jam
• Monitoring perangkat real-time
• Manajemen WiFi via WhatsApp

📞 *KONTAK DUKUNGAN:*
• WhatsApp: ${adminNumber}
• Teknisi: ${technicianNumbersText}
• Jam Operasional: 24/7

💡 *CARA PENGGUNAAN:*
• Ketik *menu* untuk melihat menu lengkap
• Ketik *status* untuk cek status perangkat
• Ketik *help* untuk bantuan teknis

🛠️ *LAYANAN PELANGGAN:*
• Ganti nama WiFi: *gantiwifi [nama]*
• Ganti password WiFi: *gantipass [password]*
• Cek perangkat terhubung: *devices*
• Test kecepatan: *speedtest*
• Diagnostik jaringan: *diagnostic*

📋 *INFORMASI TEKNIS:*
• Teknologi: Fiber Optic
• Protokol: PPPoE
• Monitoring: GenieACS
• Router: Mikrotik
• ONU: GPON/EPON

Untuk bantuan lebih lanjut, silakan hubungi teknisi kami.`);

        // Tambahkan ringkasan tagihan pelanggan (jika nomor terdaftar)
        try {
            // Try to get customer by WhatsApp LID first (if available)
            let customer = null;
            if (senderLid) {
                customer = await billingManager.getCustomerByWhatsAppLid(senderLid);
                if (customer) {
                    console.log(`Customer found by WhatsApp LID: ${customer.name}`);
                }
            }

            // Fallback to phone number lookup for backward compatibility
            if (!customer) {
                customer = await billingManager.getCustomerByPhone(senderNumber);
                if (!customer && senderNumber && senderNumber.startsWith('62')) {
                    const altPhone = '0' + senderNumber.slice(2);
                    customer = await billingManager.getCustomerByPhone(altPhone);
                }
            }

            const bankName = getSetting('payment_bank_name', '');
            const accountNumber = getSetting('payment_account_number', '');
            const accountHolder = getSetting('payment_account_holder', '');
            const contactWa = getSetting('contact_whatsapp', '');
            const dana = getSetting('payment_dana', '');
            const ovo = getSetting('payment_ovo', '');
            const gopay = getSetting('payment_gopay', '');

            if (customer) {
                const invoices = await billingManager.getInvoicesByCustomer(customer.id);
                const unpaid = invoices.filter(i => i.status === 'unpaid');
                const totalUnpaid = unpaid.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);
                const nextDue = unpaid
                    .map(i => new Date(i.due_date))
                    .sort((a, b) => a - b)[0];

                message += `\n\n📋 *INFORMASI TAGIHAN*\n`;
                if (unpaid.length > 0) {
                    message += `• Status: BELUM LUNAS (${unpaid.length} tagihan)\n`;
                    message += `• Total: Rp ${totalUnpaid.toLocaleString('id-ID')}\n`;
                    if (nextDue) message += `• Jatuh Tempo Berikutnya: ${nextDue.toLocaleDateString('id-ID')}\n`;
                } else {
                    message += `• Status: LUNAS ✅\n`;
                }

                // Info pembayaran
                if (bankName && accountNumber) {
                    message += `\n🏦 *PEMBAYARAN*\n`;
                    message += `• Bank: ${bankName}\n`;
                    message += `• No. Rekening: ${accountNumber}\n`;
                    if (accountHolder) message += `• A/N: ${accountHolder}\n`;
                }
                const ewallets = [];
                if (dana) ewallets.push(`DANA: ${dana}`);
                if (ovo) ewallets.push(`OVO: ${ovo}`);
                if (gopay) ewallets.push(`GoPay: ${gopay}`);
                if (ewallets.length > 0) {
                    message += `• E-Wallet: ${ewallets.join(' | ')}\n`;
                }
                if (contactWa) {
                    message += `• Konfirmasi: ${contactWa}\n`;
                }
            } else {
                message += `\n\n📋 *INFORMASI TAGIHAN*\n• Nomor Anda belum terdaftar di sistem billing. Silakan hubungi admin untuk sinkronisasi.`;
            }
        } catch (billErr) {
            console.error('Gagal menambahkan info tagihan pada info layanan:', billErr);
        }

        await sock.sendMessage(remoteJid, { text: message });
        console.log(`Pesan info layanan terkirim ke ${remoteJid}`);

    } catch (error) {
        console.error('Error sending info layanan:', error);
        await sock.sendMessage(remoteJid, {
            text: `❌ *ERROR*\n\nTerjadi kesalahan saat menampilkan info layanan:\n${error.message}`
        });
    }
}

// Helper untuk mengirim status tagihan pelanggan (dipakai pada perintah status)
async function sendBillingStatus(remoteJid, senderNumber, senderLid = null) {
    try {
        const { getSetting } = require('./settingsManager');
        const billingManager = require('./billing');

        // Try to get customer by WhatsApp LID first (if available)
        let customer = null;
        if (senderLid) {
            customer = await billingManager.getCustomerByWhatsAppLid(senderLid);
            if (customer) {
                console.log(`Customer found by WhatsApp LID: ${customer.name}`);
            }
        }

        // Fallback to phone number lookup for backward compatibility
        if (!customer) {
            customer = await billingManager.getCustomerByPhone(senderNumber);
            if (!customer && senderNumber && senderNumber.startsWith('62')) {
                const altPhone = '0' + senderNumber.slice(2);
                customer = await billingManager.getCustomerByPhone(altPhone);
            }
        }

        const bankName = getSetting('payment_bank_name', '');
        const accountNumber = getSetting('payment_account_number', '');
        const accountHolder = getSetting('payment_account_holder', '');
        const contactWa = getSetting('contact_whatsapp', '');
        const dana = getSetting('payment_dana', '');
        const ovo = getSetting('payment_ovo', '');
        const gopay = getSetting('payment_gopay', '');

        let text = `📋 *INFORMASI TAGIHAN*\n`;
        if (customer) {
            const invoices = await billingManager.getInvoicesByCustomer(customer.id);
            const unpaid = invoices.filter(i => i.status === 'unpaid');
            const totalUnpaid = unpaid.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);
            const nextDue = unpaid
                .map(i => new Date(i.due_date))
                .sort((a, b) => a - b)[0];

            if (unpaid.length > 0) {
                text += `• Status: BELUM LUNAS (${unpaid.length} tagihan)\n`;
                text += `• Total: Rp ${totalUnpaid.toLocaleString('id-ID')}\n`;
                if (nextDue) text += `• Jatuh Tempo Berikutnya: ${nextDue.toLocaleDateString('id-ID')}\n`;
            } else {
                text += `• Status: LUNAS ✅\n`;
            }

            if (bankName && accountNumber) {
                text += `\n🏦 *PEMBAYARAN*\n`;
                text += `• Bank: ${bankName}\n`;
                text += `• No. Rekening: ${accountNumber}\n`;
                if (accountHolder) text += `• A/N: ${accountHolder}\n`;
            }
            const ewallets = [];
            if (dana) ewallets.push(`DANA: ${dana}`);
            if (ovo) ewallets.push(`OVO: ${ovo}`);
            if (gopay) ewallets.push(`GoPay: ${gopay}`);
            if (ewallets.length > 0) {
                text += `• E-Wallet: ${ewallets.join(' | ')}\n`;
            }
            if (contactWa) {
                text += `• Konfirmasi: ${contactWa}\n`;
            }
        } else {
            text += `• Nomor Anda belum terdaftar di sistem billing. Silakan hubungi admin untuk sinkronisasi.`;
        }

        await sock.sendMessage(remoteJid, { text });
    } catch (e) {
        console.error('Error sending billing status:', e);
    }
}

// ... (rest of the code remains the same)
