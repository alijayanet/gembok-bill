/**
 * Auto setup GenieACS DNS untuk development
 * Otomatis dijalankan saat aplikasi pertama kali dijalankan
 */

const { runAutoSetup } = require('../scripts/auto-genieacs-dns-dev');
const { getSetting } = require('./settingsManager');
const logger = require('./logger');

class AutoGenieACSSetup {
    constructor() {
        this.isDevelopment = process.env.NODE_ENV === 'development' || 
                           process.env.NODE_ENV === 'dev' || 
                           !process.env.NODE_ENV;
        this.autoSetupEnabled = getSetting('auto_genieacs_dns_setup', true);
        this.setupCompleted = false;
    }

    // Fungsi untuk menjalankan auto setup
    async runAutoSetup() {
        try {
            // Cek apakah auto setup sudah dijalankan
            if (this.setupCompleted) {
                logger.info('Auto GenieACS DNS setup sudah dijalankan sebelumnya');
                return { success: true, message: 'Setup sudah dijalankan' };
            }

            // Cek apakah auto setup diaktifkan
            if (!this.autoSetupEnabled) {
                logger.info('Auto GenieACS DNS setup dinonaktifkan');
                return { success: true, message: 'Auto setup dinonaktifkan' };
            }

            // Cek apakah ini environment development
            if (!this.isDevelopment) {
                logger.info('Auto GenieACS DNS setup hanya untuk development environment');
                return { success: true, message: 'Hanya untuk development' };
            }

            logger.info('🚀 Memulai auto setup GenieACS DNS untuk development...');
            
            // Jalankan auto setup
            const result = await runAutoSetup();
            
            if (result.success) {
                this.setupCompleted = true;
                logger.info('✅ Auto GenieACS DNS setup berhasil');
                logger.info(`📋 IP Server: ${result.serverIP}`);
                logger.info(`📋 GenieACS URL: ${result.genieacsUrl}`);
                logger.info(`📋 Script Mikrotik: ${result.mikrotikScript}`);
                
                return {
                    success: true,
                    message: 'Auto setup berhasil',
                    data: result
                };
            } else {
                logger.error('❌ Auto GenieACS DNS setup gagal:', result.error);
                return {
                    success: false,
                    message: 'Auto setup gagal',
                    error: result.error
                };
            }

        } catch (error) {
            logger.error('❌ Error dalam auto GenieACS DNS setup:', error);
            return {
                success: false,
                message: 'Error dalam auto setup',
                error: error.message
            };
        }
    }

    // Fungsi untuk menjalankan auto setup dengan delay
    async runAutoSetupWithDelay(delayMs = 10000) {
        try {
            logger.info(`⏳ Auto GenieACS DNS setup akan dijalankan dalam ${delayMs/1000} detik...`);
            
            // Delay untuk memastikan aplikasi sudah fully loaded
            await new Promise(resolve => setTimeout(resolve, delayMs));
            
            return await this.runAutoSetup();
            
        } catch (error) {
            logger.error('❌ Error dalam auto setup dengan delay:', error);
            return {
                success: false,
                message: 'Error dalam auto setup dengan delay',
                error: error.message
            };
        }
    }

    // Fungsi untuk mengecek status setup
    getSetupStatus() {
        return {
            isDevelopment: this.isDevelopment,
            autoSetupEnabled: this.autoSetupEnabled,
            setupCompleted: this.setupCompleted
        };
    }

    // Fungsi untuk mengaktifkan/menonaktifkan auto setup
    setAutoSetupEnabled(enabled) {
        this.autoSetupEnabled = enabled;
        logger.info(`Auto GenieACS DNS setup ${enabled ? 'diaktifkan' : 'dinonaktifkan'}`);
    }
}

// Instance global
const autoGenieACSSetup = new AutoGenieACSSetup();

// Export instance dan class
module.exports = {
    AutoGenieACSSetup,
    autoGenieACSSetup,
    
    // Helper functions
    runAutoSetup: () => autoGenieACSSetup.runAutoSetup(),
    runAutoSetupWithDelay: (delayMs) => autoGenieACSSetup.runAutoSetupWithDelay(delayMs),
    getSetupStatus: () => autoGenieACSSetup.getSetupStatus(),
    setAutoSetupEnabled: (enabled) => autoGenieACSSetup.setAutoSetupEnabled(enabled)
};
