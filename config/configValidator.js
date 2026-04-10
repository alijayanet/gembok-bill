const axios = require('axios');
const { getSetting } = require('./settingsManager');
const logger = require('./logger');

/**
 * Validator untuk konfigurasi GenieACS dan Mikrotik
 * Mendeteksi settingan IP yang tidak sesuai atau dummy
 */
class ConfigValidator {
    constructor() {
        this.validationResults = {
            genieacs: { isValid: false, errors: [], warnings: [] },
            mikrotik: { isValid: false, errors: [], warnings: [] },
            overall: { isValid: false, needsAttention: false }
        };
    }

    /**
     * Validasi format IP address
     */
    isValidIPAddress(ip) {
        // Regex untuk validasi IPv4
        const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        
        // Cek format IP
        if (!ipv4Regex.test(ip)) {
            return false;
        }

        // Cek IP yang tidak valid/dummy
        const dummyIPs = [
            '0.0.0.0',           // Invalid
            '127.0.0.1',         // Localhost (mungkin dummy)
            '192.168.1.1',       // Router default umum
            '192.168.0.1',       // Router default umum
            '10.0.0.1',          // Router default umum
            '172.16.0.1',        // Router default umum
            'localhost',         // Hostname localhost
            'example.com',       // Domain dummy
            'test.com',          // Domain dummy
            'dummy',             // Kata dummy
            'admin',             // Kata admin
            'test'               // Kata test
        ];

        return !dummyIPs.includes(ip.toLowerCase());
    }

    /**
     * Validasi port number
     */
    isValidPort(port) {
        const portNum = parseInt(port);
        return portNum >= 1 && portNum <= 65535;
    }

    /**
     * Validasi URL format
     */
    isValidURL(url) {
        try {
            const urlObj = new URL(url);
            return this.isValidIPAddress(urlObj.hostname) || urlObj.hostname.includes('.');
        } catch (e) {
            return false;
        }
    }

    /**
     * Test koneksi ke GenieACS
     */
    async testGenieACSConnection() {
        const genieacsUrl = getSetting('genieacs_url', 'http://localhost:7557');
        const genieacsUsername = getSetting('genieacs_username', 'acs');
        const genieacsPassword = getSetting('genieacs_password', '');

        try {

            // Validasi URL format
            if (!this.isValidURL(genieacsUrl)) {
                return {
                    success: false,
                    error: 'Format URL GenieACS tidak valid',
                    details: `URL: ${genieacsUrl}`
                };
            }

            // Validasi credentials
            if (!genieacsUsername || !genieacsPassword) {
                return {
                    success: false,
                    error: 'Username atau password GenieACS tidak dikonfigurasi',
                    details: `Username: ${genieacsUsername ? 'Ada' : 'Kosong'}, Password: ${genieacsPassword ? 'Ada' : 'Kosong'}`
                };
            }

            // Test koneksi dengan timeout sangat pendek untuk login
            const response = await axios.get(`${genieacsUrl}/devices`, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                },
                timeout: 3000, // 3 detik timeout untuk login yang cepat
                headers: {
                    'Accept': 'application/json'
                }
            });

            return {
                success: true,
                message: 'Koneksi ke GenieACS berhasil',
                details: `Status: ${response.status}, Data devices: ${response.data ? response.data.length || 0 : 0}`
            };

        } catch (error) {
            let errorMessage = 'Gagal koneksi ke GenieACS';
            let errorDetails = error.message;

            if (error.code === 'ECONNREFUSED') {
                errorMessage = 'GenieACS tidak dapat dijangkau';
                errorDetails = `Server tidak merespons pada ${genieacsUrl}. Pastikan GenieACS berjalan dan dapat diakses.`;
            } else if (error.code === 'ENOTFOUND') {
                errorMessage = 'Host GenieACS tidak ditemukan';
                errorDetails = `Alamat IP ${genieacsUrl} tidak dapat dijangkau. Periksa koneksi jaringan.`;
            } else if (error.code === 'ETIMEDOUT') {
                errorMessage = 'GenieACS timeout';
                errorDetails = `Koneksi ke ${genieacsUrl} timeout. Server mungkin lambat atau tidak aktif.`;
            } else if (error.response) {
                if (error.response.status === 401) {
                    errorMessage = 'Autentikasi GenieACS gagal';
                    errorDetails = 'Username atau password salah';
                } else if (error.response.status === 404) {
                    errorMessage = 'Endpoint GenieACS tidak ditemukan';
                    errorDetails = 'URL mungkin salah atau server tidak mendukung API';
                }
            }

            return {
                success: false,
                error: errorMessage,
                details: errorDetails
            };
        }
    }

    /**
     * Test koneksi ke Mikrotik
     */
    async testMikrotikConnection() {
        const mikrotikHost = getSetting('mikrotik_host', '192.168.1.1');
        const mikrotikPort = getSetting('mikrotik_port', '8728');
        const mikrotikUser = getSetting('mikrotik_user', 'admin');
        const mikrotikPassword = getSetting('mikrotik_password', '');

        try {
            const { getMikrotikConnection } = require('./mikrotik');
            const { listMikrotikRouters } = require('./mikrotik');

            const routerInfo = typeof listMikrotikRouters === 'function' ? listMikrotikRouters() : { routers: [], defaultRouterId: null };
            const routers = Array.isArray(routerInfo.routers) ? routerInfo.routers : [];

            if (routers.length > 0) {
                const invalidRouters = [];
                for (const r of routers) {
                    const label = `${r.name || r.id} (${r.id})`;
                    if (!r.host || !this.isValidIPAddress(r.host)) {
                        invalidRouters.push({ id: r.id, label, reason: `Host tidak valid: ${r.host || '(kosong)'}` });
                        continue;
                    }
                    if (!this.isValidPort(r.port)) {
                        invalidRouters.push({ id: r.id, label, reason: `Port tidak valid: ${r.port || '(kosong)'}` });
                        continue;
                    }
                    if (!r.user || !r.password) {
                        invalidRouters.push({ id: r.id, label, reason: 'Username atau password belum dikonfigurasi' });
                        continue;
                    }
                }

                const routerIdToTest = routerInfo.defaultRouterId || (routers[0] ? routers[0].id : null);
                const routerToTest = routers.find(r => r.id === routerIdToTest) || null;

                if (!routerIdToTest || !routerToTest) {
                    return {
                        success: false,
                        error: 'Konfigurasi Mikrotik multi-router tidak valid',
                        details: 'Tidak ada router default yang bisa dipakai untuk test koneksi'
                    };
                }

                const routerLabel = `${routerToTest.name || routerToTest.id} (${routerToTest.id})`;
                const routerInvalid = invalidRouters.find(r => r.id === routerToTest.id);
                if (routerInvalid) {
                    return {
                        success: false,
                        error: 'Konfigurasi router default Mikrotik tidak valid',
                        details: `${routerLabel}: ${routerInvalid.reason}`
                    };
                }

                const connection = await Promise.race([
                    getMikrotikConnection({ routerId: routerIdToTest }),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Connection timeout')), 10000)
                    )
                ]);

                if (connection) {
                    const invalidSummary = invalidRouters.length
                        ? `; Router bermasalah: ${invalidRouters.map(r => r.label).join(', ')}`
                        : '';
                    return {
                        success: true,
                        message: 'Koneksi ke Mikrotik berhasil',
                        details: `Router: ${routerLabel}${invalidSummary}`
                    };
                }

                return {
                    success: false,
                    error: 'Koneksi ke Mikrotik gagal',
                    details: `Tidak dapat membuat koneksi ke router default: ${routerLabel}`
                };
            }
            
            if (!this.isValidIPAddress(mikrotikHost)) {
                return {
                    success: false,
                    error: 'IP address Mikrotik tidak valid',
                    details: `IP: ${mikrotikHost}`
                };
            }

            if (!this.isValidPort(mikrotikPort)) {
                return {
                    success: false,
                    error: 'Port Mikrotik tidak valid',
                    details: `Port: ${mikrotikPort}`
                };
            }

            if (!mikrotikUser || !mikrotikPassword) {
                return {
                    success: false,
                    error: 'Username atau password Mikrotik tidak dikonfigurasi',
                    details: `Username: ${mikrotikUser ? 'Ada' : 'Kosong'}, Password: ${mikrotikPassword ? 'Ada' : 'Kosong'}`
                };
            }

            // Coba koneksi dengan timeout 10 detik untuk login (lebih stabil di server)
            const connection = await Promise.race([
                getMikrotikConnection(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Connection timeout')), 10000)
                )
            ]);

            if (connection) {
                return {
                    success: true,
                    message: 'Koneksi ke Mikrotik berhasil',
                    details: `Host: ${mikrotikHost}:${mikrotikPort}, User: ${mikrotikUser}`
                };
            } else {
                return {
                    success: false,
                    error: 'Koneksi ke Mikrotik gagal',
                    details: 'Tidak dapat membuat koneksi ke router Mikrotik'
                };
            }

        } catch (error) {
            let errorMessage = 'Gagal koneksi ke Mikrotik';
            let errorDetails = error.message;

            if (error.message.includes('timeout')) {
                errorMessage = 'Mikrotik tidak merespons';
                errorDetails = `Timeout (10s) - Router mungkin sibuk atau tidak dapat dijangkau pada ${mikrotikHost}:${mikrotikPort}`;
            } else if (error.message.includes('ECONNREFUSED')) {
                errorMessage = 'Koneksi ke Mikrotik ditolak';
                errorDetails = `Port ${mikrotikPort} ditolak oleh router. Pastikan service API aktif di Mikrotik.`;
            } else if (error.code === 'ENOTFOUND') {
                errorMessage = 'Host Mikrotik tidak ditemukan';
                errorDetails = `Alamat IP ${mikrotikHost} tidak dapat dijangkau. Periksa koneksi jaringan.`;
            } else {
                // Menampilkan error asli dari library (misal: "invalid username or password")
                errorMessage = 'Gagal Autentikasi / Error API';
                errorDetails = error.message;
            }

            return {
                success: false,
                error: errorMessage,
                details: errorDetails
            };
        }
    }

    /**
     * Validasi lengkap semua konfigurasi
     */
    async validateAllConfigurations() {
        console.log('🔍 [CONFIG_VALIDATOR] Memulai validasi konfigurasi...');
        
        // Reset hasil validasi
        this.validationResults = {
            genieacs: { isValid: false, errors: [], warnings: [] },
            mikrotik: { isValid: false, errors: [], warnings: [] },
            overall: { isValid: false, needsAttention: false }
        };

        // Validasi GenieACS
        console.log('🔍 [CONFIG_VALIDATOR] Memvalidasi konfigurasi GenieACS...');
        const genieacsResult = await this.testGenieACSConnection();
        
        if (genieacsResult.success) {
            this.validationResults.genieacs.isValid = true;
            console.log('✅ [CONFIG_VALIDATOR] GenieACS: Konfigurasi valid');
        } else {
            this.validationResults.genieacs.errors.push(genieacsResult.error);
            console.log(`❌ [CONFIG_VALIDATOR] GenieACS: ${genieacsResult.error}`);
        }

        // Validasi Mikrotik
        console.log('🔍 [CONFIG_VALIDATOR] Memvalidasi konfigurasi Mikrotik...');
        const mikrotikResult = await this.testMikrotikConnection();
        
        if (mikrotikResult.success) {
            this.validationResults.mikrotik.isValid = true;
            console.log('✅ [CONFIG_VALIDATOR] Mikrotik: Konfigurasi valid');
        } else {
            this.validationResults.mikrotik.errors.push(mikrotikResult.error);
            console.log(`❌ [CONFIG_VALIDATOR] Mikrotik: ${mikrotikResult.error}`);
        }

        // Evaluasi hasil keseluruhan
        this.validationResults.overall.isValid = 
            this.validationResults.genieacs.isValid && this.validationResults.mikrotik.isValid;
        
        this.validationResults.overall.needsAttention = 
            this.validationResults.genieacs.errors.length > 0 || this.validationResults.mikrotik.errors.length > 0;

        console.log(`🔍 [CONFIG_VALIDATOR] Validasi selesai. Status: ${this.validationResults.overall.isValid ? 'VALID' : 'PERLU PERHATIAN'}`);
        
        return this.validationResults;
    }

    /**
     * Dapatkan ringkasan validasi untuk ditampilkan ke admin
     */
    getValidationSummary() {
        const summary = {
            status: this.validationResults.overall.isValid ? 'valid' : 'warning',
            message: '',
            details: {
                genieacs: {
                    status: this.validationResults.genieacs.isValid ? 'valid' : 'error',
                    message: this.validationResults.genieacs.isValid ? 'Konfigurasi GenieACS valid' : 'Konfigurasi GenieACS bermasalah',
                    errors: this.validationResults.genieacs.errors
                },
                mikrotik: {
                    status: this.validationResults.mikrotik.isValid ? 'valid' : 'error', 
                    message: this.validationResults.mikrotik.isValid ? 'Konfigurasi Mikrotik valid' : 'Konfigurasi Mikrotik bermasalah',
                    errors: this.validationResults.mikrotik.errors
                }
            }
        };

        if (this.validationResults.overall.isValid) {
            summary.message = 'Semua konfigurasi sistem valid dan siap digunakan';
        } else {
            const errorCount = this.validationResults.genieacs.errors.length + this.validationResults.mikrotik.errors.length;
            summary.message = `Ditemukan ${errorCount} masalah konfigurasi yang perlu diperbaiki`;
        }

        return summary;
    }

    /**
     * Cek apakah konfigurasi saat ini menggunakan settingan default/dummy
     */
    checkForDefaultSettings() {
        const warnings = [];
        
        // Cek GenieACS
        const genieacsUrl = getSetting('genieacs_url', '');
        const genieacsUser = getSetting('genieacs_username', '');
        const genieacsPass = getSetting('genieacs_password', '');
        
        if (genieacsUrl.includes('localhost') || genieacsUrl.includes('127.0.0.1')) {
            warnings.push('GenieACS menggunakan alamat localhost - pastikan ini sesuai dengan setup Anda');
        }
        
        if (genieacsUser === 'admin' || genieacsUser === 'acs' || genieacsUser === '') {
            warnings.push('GenieACS menggunakan username default - pertimbangkan untuk mengubahnya');
        }
        
        if (genieacsPass === 'admin' || genieacsPass === 'password' || genieacsPass === '') {
            warnings.push('GenieACS menggunakan password default - segera ubah untuk keamanan');
        }

        // Cek Mikrotik
        const mikrotikHost = getSetting('mikrotik_host', '');
        const mikrotikUser = getSetting('mikrotik_user', '');
        const mikrotikPass = getSetting('mikrotik_password', '');
        
        if (mikrotikHost === '192.168.1.1' || mikrotikHost === '192.168.0.1' || mikrotikHost === '') {
            warnings.push('Mikrotik menggunakan IP default - pastikan sesuai dengan setup router Anda');
        }
        
        if (mikrotikUser === 'admin' || mikrotikUser === '') {
            warnings.push('Mikrotik menggunakan username default - pertimbangkan untuk mengubahnya');
        }
        
        if (mikrotikPass === 'admin' || mikrotikPass === 'password' || mikrotikPass === '') {
            warnings.push('Mikrotik menggunakan password default - segera ubah untuk keamanan');
        }

        return warnings;
    }
}

// Export instance singleton
const configValidator = new ConfigValidator();

module.exports = {
    ConfigValidator,
    configValidator,
    validateConfiguration: () => configValidator.validateAllConfigurations(),
    getValidationSummary: () => configValidator.getValidationSummary(),
    checkForDefaultSettings: () => configValidator.checkForDefaultSettings()
};
