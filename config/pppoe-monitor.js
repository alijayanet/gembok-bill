// pppoe-monitor.js - Enhanced PPPoE monitoring with notification control
const logger = require('./logger');
const pppoeNotifications = require('./pppoe-notifications');
const { getActivePPPoEConnections } = require('./mikrotik');

let monitorInterval = null;
let lastActivePPPoE = [];
let isMonitoring = false;
let previousPPPoEData = [];

// Tambahkan konfigurasi untuk pemeriksaan PPPoE
const PPPoE_CONFIG = {
    checkInterval: 30000, // 30 detik
    maxRetries: 3,
    retryDelay: 5000 // 5 detik
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

// Fungsi untuk mendapatkan data PPPoE saat ini dari Mikrotik
async function getCurrentPPPoEData() {
    try {
        console.log('[PPPoE-MONITOR] Mengambil data PPPoE aktif dari Mikrotik...');
        
        // Gunakan fungsi yang sudah ada untuk mendapatkan koneksi PPPoE aktif
        const result = await withTimeout(getActivePPPoEConnections(), 10000, 'Timeout saat mengambil data PPPoE dari Mikrotik');
        
        if (result && result.success && Array.isArray(result.data)) {
            console.log(`[PPPoE-MONITOR] Ditemukan ${result.data.length} koneksi PPPoE aktif`);
            return result.data;
        } else {
            console.warn('[PPPoE-MONITOR] Gagal mendapatkan data PPPoE aktif dari Mikrotik');
            return [];
        }
    } catch (error) {
        console.error('[PPPoE-MONITOR] Error saat mengambil data PPPoE dari Mikrotik:', error.message);
        return [];
    }
}

// Fungsi untuk membandingkan data PPPoE
async function comparePPPoEData(previousData, currentData) {
    try {
        console.log('[PPPoE-MONITOR] Membandingkan data PPPoE...');
        
        // Jika tidak ada data sebelumnya, semua data saat ini adalah "baru"
        if (!previousData || previousData.length === 0) {
            console.log('[PPPoE-MONITOR] Tidak ada data sebelumnya, semua koneksi dianggap baru');
            return currentData.map(conn => ({
                type: 'new',
                connection: conn
            }));
        }
        
        // Buat map dari data sebelumnya untuk pencarian cepat
        const previousMap = new Map();
        previousData.forEach(conn => {
            if (conn.name) {
                previousMap.set(conn.name, conn);
            }
        });
        
        // Buat map dari data saat ini
        const currentMap = new Map();
        currentData.forEach(conn => {
            if (conn.name) {
                currentMap.set(conn.name, conn);
            }
        });
        
        const changes = [];
        
        // Cari koneksi baru (ada di current tapi tidak di previous)
        currentData.forEach(conn => {
            if (conn.name && !previousMap.has(conn.name)) {
                changes.push({
                    type: 'login',
                    connection: conn
                });
            }
        });
        
        // Cari koneksi yang logout (ada di previous tapi tidak di current)
        previousData.forEach(conn => {
            if (conn.name && !currentMap.has(conn.name)) {
                changes.push({
                    type: 'logout',
                    connection: conn
                });
            }
        });
        
        console.log(`[PPPoE-MONITOR] Ditemukan ${changes.length} perubahan PPPoE`);
        return changes;
    } catch (error) {
        console.error('[PPPoE-MONITOR] Error saat membandingkan data PPPoE:', error.message);
        return [];
    }
}

// Fungsi untuk memproses perubahan PPPoE
async function processPPPoEChange(change) {
    try {
        console.log('[PPPoE-MONITOR] Memproses perubahan PPPoE:', JSON.stringify(change, null, 2));
        
        // Dapatkan pengaturan notifikasi
        const settings = pppoeNotifications.getSettings();
        
        // Proses berdasarkan tipe perubahan
        switch (change.type) {
            case 'login':
                if (settings.loginNotifications) {
                    console.log('[PPPoE-MONITOR] Mengirim notifikasi login untuk:', change.connection.name);
                    await pppoeNotifications.sendLoginNotification(change.connection);
                } else {
                    console.log('[PPPoE-MONITOR] Notifikasi login dinonaktifkan untuk:', change.connection.name);
                }
                break;
                
            case 'logout':
                if (settings.logoutNotifications) {
                    console.log('[PPPoE-MONITOR] Mengirim notifikasi logout untuk:', change.connection.name);
                    await pppoeNotifications.sendLogoutNotification(change.connection);
                } else {
                    console.log('[PPPoE-MONITOR] Notifikasi logout dinonaktifkan untuk:', change.connection.name);
                }
                break;
                
            case 'new':
                if (settings.loginNotifications) {
                    console.log('[PPPoE-MONITOR] Mengirim notifikasi koneksi baru untuk:', change.connection.name);
                    await pppoeNotifications.sendLoginNotification(change.connection);
                } else {
                    console.log('[PPPoE-MONITOR] Notifikasi koneksi baru dinonaktifkan untuk:', change.connection.name);
                }
                break;
                
            default:
                console.warn('[PPPoE-MONITOR] Tipe perubahan tidak dikenali:', change.type);
        }
        
        return true;
    } catch (error) {
        console.error('[PPPoE-MONITOR] Error saat memproses perubahan PPPoE:', error.message);
        return false;
    }
}

// Perbaiki fungsi checkPPPoEChanges dengan penanganan error yang lebih baik
async function checkPPPoEChanges() {
    try {
        console.log('[PPPoE-MONITOR] Memeriksa perubahan PPPoE...');
        
        // Cek koneksi WhatsApp dengan penanganan error yang lebih baik
        if (!global.whatsappStatus || !global.whatsappStatus.connected) {
            console.warn('[PPPoE-MONITOR] WhatsApp tidak terhubung, melewatkan notifikasi');
            return;
        }

        // Dapatkan data pelanggan PPPoE terbaru dari Mikrotik
        let currentPPPoEData;
        try {
            console.log('[PPPoE-MONITOR] Mengambil data PPPoE terbaru dari Mikrotik...');
            currentPPPoEData = await withTimeout(getCurrentPPPoEData(), 10000, 'Timeout saat mengambil data PPPoE');
        } catch (getDataError) {
            console.error('[PPPoE-MONITOR] Error saat mendapatkan data PPPoE:', getDataError.message);
            return;
        }
        
        if (!currentPPPoEData) {
            console.warn('[PPPoE-MONITOR] Gagal mendapatkan data PPPoE');
            return;
        }

        // Bandingkan dengan data sebelumnya
        let changes;
        try {
            console.log('[PPPoE-MONITOR] Membandingkan data PPPoE...');
            changes = await withTimeout(comparePPPoEData(previousPPPoEData, currentPPPoEData), 5000, 'Timeout saat membandingkan data PPPoE');
        } catch (compareError) {
            console.error('[PPPoE-MONITOR] Error saat membandingkan data PPPoE:', compareError.message);
            return;
        }
        
        // Proses perubahan dengan penanganan error per item
        if (changes && changes.length > 0) {
            console.log(`[PPPoE-MONITOR] Ditemukan ${changes.length} perubahan PPPoE`);
            
            // Kumpulkan semua perubahan login dan logout
            const loginChanges = changes.filter(c => c.type === 'login' || c.type === 'new');
            const logoutChanges = changes.filter(c => c.type === 'logout');
            
            // Kirim notifikasi batch untuk login jika ada
            if (loginChanges.length > 0) {
                try {
                    console.log(`[PPPoE-MONITOR] Mengirim notifikasi batch login untuk ${loginChanges.length} user`);
                    await pppoeNotifications.sendBatchLoginNotification(
                        loginChanges.map(c => c.connection),
                        currentPPPoEData
                    );
                } catch (batchError) {
                    console.error('[PPPoE-MONITOR] Error saat mengirim notifikasi batch login:', batchError.message);
                }
            }
            
            // Kirim notifikasi batch untuk logout jika ada
            if (logoutChanges.length > 0) {
                try {
                    console.log(`[PPPoE-MONITOR] Mengirim notifikasi batch logout untuk ${logoutChanges.length} user`);
                    await pppoeNotifications.sendBatchLogoutNotification(
                        logoutChanges.map(c => c.connection),
                        currentPPPoEData
                    );
                } catch (batchError) {
                    console.error('[PPPoE-MONITOR] Error saat mengirim notifikasi batch logout:', batchError.message);
                }
            }
        } else {
            console.log('[PPPoE-MONITOR] Tidak ada perubahan PPPoE');
        }

        // Update data sebelumnya
        previousPPPoEData = currentPPPoEData;
        console.log('[PPPoE-MONITOR] Pemeriksaan selesai');
        
    } catch (error) {
        console.error('[PPPoE-MONITOR] Error tidak terduga saat memeriksa perubahan PPPoE:', error.message);
        // Jangan biarkan error menghentikan monitor
        // Proses akan dilanjutkan pada interval berikutnya
    }
}

// Perbaiki timeout function dengan penanganan error yang lebih baik
function scheduleNextCheck() {
    console.log(`[PPPoE-MONITOR] Menjadwalkan pemeriksaan berikutnya dalam ${PPPoE_CONFIG.checkInterval/1000} detik`);
    
    setTimeout(async function _onTimeout() {
        try {
            await checkPPPoEChanges();
        } catch (error) {
            console.error('[PPPoE-MONITOR] Error pada timeout function:', error.message);
        } finally {
            // Pastikan penjadwalan berikutnya selalu dijalankan
            scheduleNextCheck();
        }
    }, PPPoE_CONFIG.checkInterval);
}

// Mulai penjadwalan pemeriksaan
console.log('[PPPoE-MONITOR] Memulai monitor PPPoE...');
scheduleNextCheck();

// Start PPPoE monitoring
async function startPPPoEMonitoring() {
    try {
        if (isMonitoring) {
            logger.info('PPPoE monitoring is already running');
            return { success: true, message: 'Monitoring sudah berjalan' };
        }

        const settings = pppoeNotifications.getSettings();
        const interval = settings.monitorInterval || 60000; // Default 1 minute

        // Clear any existing interval
        if (monitorInterval) {
            clearInterval(monitorInterval);
        }

        // Start monitoring
        monitorInterval = setInterval(async () => {
            await checkPPPoEChanges();
        }, interval);

        isMonitoring = true;
        logger.info(`PPPoE monitoring started with interval ${interval}ms`);
        
        return { 
            success: true, 
            message: `PPPoE monitoring dimulai dengan interval ${interval/1000} detik` 
        };
    } catch (error) {
        logger.error(`Error starting PPPoE monitoring: ${error.message}`);
        return { 
            success: false, 
            message: `Gagal memulai monitoring: ${error.message}` 
        };
    }
}

// Stop PPPoE monitoring
function stopPPPoEMonitoring() {
    try {
        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }
        
        isMonitoring = false;
        logger.info('PPPoE monitoring stopped');
        
        return { 
            success: true, 
            message: 'PPPoE monitoring dihentikan' 
        };
    } catch (error) {
        logger.error(`Error stopping PPPoE monitoring: ${error.message}`);
        return { 
            success: false, 
            message: `Gagal menghentikan monitoring: ${error.message}` 
        };
    }
}

// Restart PPPoE monitoring
async function restartPPPoEMonitoring() {
    try {
        stopPPPoEMonitoring();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        return await startPPPoEMonitoring();
    } catch (error) {
        logger.error(`Error restarting PPPoE monitoring: ${error.message}`);
        return { 
            success: false, 
            message: `Gagal restart monitoring: ${error.message}` 
        };
    }
}

// Get monitoring status
function getMonitoringStatus() {
    const settings = pppoeNotifications.getSettings();
    const adminNumbers = pppoeNotifications.getAdminNumbers();
    const technicianNumbers = pppoeNotifications.getTechnicianNumbers();
    
    return {
        isRunning: isMonitoring,
        notificationsEnabled: settings.enabled,
        loginNotifications: settings.loginNotifications,
        logoutNotifications: settings.logoutNotifications,
        interval: settings.monitorInterval,
        adminNumbers: adminNumbers,
        technicianNumbers: technicianNumbers,
        activeConnections: lastActivePPPoE.length
    };
}

// Set monitoring interval
async function setMonitoringInterval(intervalMs) {
    try {
        const settings = pppoeNotifications.getSettings();
        settings.monitorInterval = intervalMs;
        
        if (pppoeNotifications.saveSettings(settings)) {
            // Restart monitoring with new interval if it's running
            if (isMonitoring) {
                await restartPPPoEMonitoring();
            }
            
            logger.info(`PPPoE monitoring interval updated to ${intervalMs}ms`);
            return { 
                success: true, 
                message: `Interval monitoring diubah menjadi ${intervalMs/1000} detik` 
            };
        } else {
            return { 
                success: false, 
                message: 'Gagal menyimpan pengaturan interval' 
            };
        }
    } catch (error) {
        logger.error(`Error setting monitoring interval: ${error.message}`);
        return { 
            success: false, 
            message: `Gagal mengubah interval: ${error.message}` 
        };
    }
}

// Initialize monitoring on startup
async function initializePPPoEMonitoring() {
    try {
        const settings = pppoeNotifications.getSettings();
        
        // Auto-start monitoring if enabled
        if (settings.enabled) {
            await startPPPoEMonitoring();
            logger.info('PPPoE monitoring auto-started on initialization');
        } else {
            logger.info('PPPoE monitoring disabled in settings');
        }
    } catch (error) {
        logger.error(`Error initializing PPPoE monitoring: ${error.message}`);
    }
}

// Set WhatsApp socket
function setSock(sockInstance) {
    pppoeNotifications.setSock(sockInstance);
}

module.exports = {
    setSock,
    startPPPoEMonitoring,
    stopPPPoEMonitoring,
    restartPPPoEMonitoring,
    getMonitoringStatus,
    setMonitoringInterval,
    initializePPPoEMonitoring,
    checkPPPoEChanges
};