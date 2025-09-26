#!/usr/bin/env node

/**
 * Script untuk memperbaiki masalah session GenieACS
 * Menangani error "Invalid session" dan session timeout
 */

const axios = require('axios');
const { getSetting } = require('../config/settingsManager');
const genieacs = require('../config/genieacs');

class GenieACSSessionFix {
    constructor() {
        this.genieacsUrl = getSetting('genieacs_url', 'http://192.168.8.89:7547');
        this.genieacsUsername = getSetting('genieacs_username', 'admin');
        this.genieacsPassword = getSetting('genieacs_password', 'admin');
        this.sessionTimeout = 30000; // 30 detik
    }

    // Helper untuk membuat axios instance dengan session management
    getAxiosInstance() {
        return axios.create({
            baseURL: this.genieacsUrl,
            auth: {
                username: this.genieacsUsername,
                password: this.genieacsPassword
            },
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            timeout: this.sessionTimeout
        });
    }

    // Fungsi untuk test koneksi GenieACS
    async testConnection() {
        try {
            console.log('🔍 Testing koneksi ke GenieACS...');
            console.log(`📋 URL: ${this.genieacsUrl}`);
            console.log(`📋 Username: ${this.genieacsUsername}`);
            
            const axiosInstance = this.getAxiosInstance();
            const response = await axiosInstance.get('/devices');
            
            console.log(`✅ Koneksi berhasil! Ditemukan ${response.data.length} device`);
            return {
                success: true,
                deviceCount: response.data.length,
                message: 'Koneksi GenieACS berhasil'
            };
            
        } catch (error) {
            console.error('❌ Koneksi GenieACS gagal:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data || error.message
            };
        }
    }

    // Fungsi untuk cek status device
    async checkDeviceStatus(deviceId) {
        try {
            console.log(`🔍 Checking status device: ${deviceId}`);
            
            const axiosInstance = this.getAxiosInstance();
            
            // Coba endpoint yang berbeda untuk mendapatkan device info
            let response;
            try {
                // Coba endpoint dengan query parameter
                response = await axiosInstance.get(`/devices?query=${encodeURIComponent(JSON.stringify({_id: deviceId}))}`);
                
                if (!response.data || response.data.length === 0) {
                    throw new Error('Device not found');
                }
                
                const device = response.data[0];
                const isOnline = device._lastInform ? true : false;
                const lastInform = device._lastInform ? new Date(device._lastInform).toLocaleString() : 'Never';
                
                console.log(`📡 Device Status: ${isOnline ? 'Online' : 'Offline'}`);
                console.log(`📅 Last Inform: ${lastInform}`);
                
                return {
                    success: true,
                    deviceId,
                    isOnline,
                    lastInform,
                    device
                };
                
            } catch (directError) {
                // Fallback: coba endpoint langsung
                console.log(`⚠️  Query method failed, trying direct endpoint...`);
                response = await axiosInstance.get(`/devices/${encodeURIComponent(deviceId)}`);
                
                const device = response.data;
                const isOnline = device._lastInform ? true : false;
                const lastInform = device._lastInform ? new Date(device._lastInform).toLocaleString() : 'Never';
                
                console.log(`📡 Device Status: ${isOnline ? 'Online' : 'Offline'}`);
                console.log(`📅 Last Inform: ${lastInform}`);
                
                return {
                    success: true,
                    deviceId,
                    isOnline,
                    lastInform,
                    device
                };
            }
            
        } catch (error) {
            console.error(`❌ Error checking device ${deviceId}:`, error.response?.data || error.message);
            return {
                success: false,
                deviceId,
                error: error.response?.data || error.message
            };
        }
    }

    // Fungsi untuk mengirim task dengan session management
    async sendTaskWithSessionManagement(deviceId, task, maxRetries = 3) {
        try {
            console.log(`📤 Mengirim task ${task.name} ke device ${deviceId}...`);
            
            const axiosInstance = this.getAxiosInstance();
            let retryCount = 0;
            
            while (retryCount < maxRetries) {
                try {
                    // Tambahkan delay untuk menghindari session conflict
                    if (retryCount > 0) {
                        const delay = 2000 * retryCount; // 2s, 4s, 6s
                        console.log(`⏳ Delay ${delay}ms sebelum retry...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                    
                    console.log(`📤 Attempt ${retryCount + 1}/${maxRetries}: ${task.name}`);
                    
                    const response = await axiosInstance.post(
                        `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
                        task
                    );
                    
                    console.log(`✅ Task ${task.name} berhasil dikirim (attempt ${retryCount + 1})`);
                    return {
                        success: true,
                        task: task.name,
                        response: response.data,
                        attempts: retryCount + 1
                    };
                    
                } catch (taskError) {
                    retryCount++;
                    const errorMsg = taskError.response?.data || taskError.message;
                    
                    console.error(`❌ Task ${task.name} gagal (attempt ${retryCount}):`, errorMsg);
                    
                    // Jika error "Invalid session", coba refresh session
                    if (errorMsg.includes('Invalid session') && retryCount < maxRetries) {
                        console.log(`🔄 Invalid session detected, refreshing...`);
                        // Delay lebih lama untuk session refresh
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                    
                    // Jika error "Device not found" atau "Device offline", stop retry
                    if (errorMsg.includes('Device not found') || 
                        errorMsg.includes('Device offline') ||
                        errorMsg.includes('Connection refused')) {
                        console.log(`🛑 Device tidak dapat diakses, stop retry`);
                        break;
                    }
                }
            }
            
            return {
                success: false,
                task: task.name,
                error: 'Max retries exceeded',
                attempts: retryCount
            };
            
        } catch (error) {
            console.error(`❌ Error mengirim task ke device ${deviceId}:`, error);
            return {
                success: false,
                task: task.name,
                error: error.message
            };
        }
    }

    // Fungsi untuk konfigurasi DNS dengan session management
    async configureDNSWithSessionManagement(deviceId, dnsServer = '192.168.8.89') {
        try {
            console.log(`🔧 Mengatur DNS server untuk device: ${deviceId}`);
            console.log(`📋 DNS Server: ${dnsServer}`);
            
            // Step 1: Cek status device
            const deviceStatus = await this.checkDeviceStatus(deviceId);
            if (!deviceStatus.success) {
                return {
                    success: false,
                    deviceId,
                    error: 'Device tidak dapat diakses'
                };
            }
            
            if (!deviceStatus.isOnline) {
                return {
                    success: false,
                    deviceId,
                    error: 'Device offline'
                };
            }
            
            // Step 2: Buat task untuk DNS configuration
            const dnsTask = {
                name: "setParameterValues",
                parameterValues: [
                    ['InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers.1', dnsServer],
                    ['InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers.2', '8.8.8.8'],
                    ['Device.DNS.Client.Server.1', dnsServer],
                    ['Device.DNS.Client.Server.2', '8.8.8.8'],
                    ['VirtualParameters.dnsServer1', dnsServer],
                    ['VirtualParameters.dnsServer2', '8.8.8.8']
                ]
            };
            
            // Step 3: Kirim task dengan session management
            const result = await this.sendTaskWithSessionManagement(deviceId, dnsTask);
            
            if (result.success) {
                console.log(`✅ DNS server berhasil dikonfigurasi untuk device ${deviceId}`);
                return {
                    success: true,
                    deviceId,
                    dnsServer,
                    result
                };
            } else {
                console.log(`❌ DNS server gagal dikonfigurasi untuk device ${deviceId}: ${result.error}`);
                return {
                    success: false,
                    deviceId,
                    error: result.error
                };
            }
            
        } catch (error) {
            console.error(`❌ Error konfigurasi DNS untuk device ${deviceId}:`, error);
            return {
                success: false,
                deviceId,
                error: error.message
            };
        }
    }

    // Fungsi untuk konfigurasi DNS untuk semua device online
    async configureDNSForAllOnlineDevices() {
        try {
            console.log('🚀 KONFIGURASI DNS UNTUK SEMUA DEVICE ONLINE');
            console.log('=' .repeat(60));
            
            // Step 1: Test koneksi
            const connectionTest = await this.testConnection();
            if (!connectionTest.success) {
                return {
                    success: false,
                    error: 'Koneksi GenieACS gagal'
                };
            }
            
            // Step 2: Ambil semua device
            console.log('\n📋 Mengambil daftar device...');
            const devices = await genieacs.getDevices();
            console.log(`✅ Ditemukan ${devices.length} device`);
            
            // Step 3: Filter device online
            console.log('\n📋 Memfilter device online...');
            const onlineDevices = [];
            
            for (const device of devices) {
                const deviceStatus = await this.checkDeviceStatus(device._id);
                if (deviceStatus.success && deviceStatus.isOnline) {
                    onlineDevices.push({
                        id: device._id,
                        serialNumber: this.getDeviceSerialNumber(device),
                        lastInform: deviceStatus.lastInform
                    });
                }
            }
            
            console.log(`✅ Ditemukan ${onlineDevices.length} device online`);
            
            if (onlineDevices.length === 0) {
                return {
                    success: false,
                    message: 'Tidak ada device online'
                };
            }
            
            // Step 4: Konfirmasi
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            const answer = await new Promise((resolve) => {
                rl.question(`Apakah Anda yakin ingin mengatur DNS untuk ${onlineDevices.length} device online? (y/N): `, (input) => {
                    rl.close();
                    resolve(input.toLowerCase());
                });
            });
            
            if (answer !== 'y' && answer !== 'yes') {
                console.log('❌ Konfigurasi dibatalkan');
                return { success: false, message: 'Konfigurasi dibatalkan' };
            }
            
            // Step 5: Konfigurasi DNS untuk setiap device
            console.log('\n🔧 Mengatur DNS server untuk setiap device...');
            
            const results = [];
            let successCount = 0;
            let errorCount = 0;
            
            for (const device of onlineDevices) {
                try {
                    console.log(`\n📝 Memproses device: ${device.id}`);
                    const result = await this.configureDNSWithSessionManagement(device.id);
                    
                    if (result.success) {
                        successCount++;
                        console.log(`✅ DNS berhasil dikonfigurasi untuk ${device.serialNumber}`);
                    } else {
                        errorCount++;
                        console.log(`❌ DNS gagal dikonfigurasi untuk ${device.serialNumber}: ${result.error}`);
                    }
                    
                    results.push(result);
                    
                    // Delay antar device
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                } catch (error) {
                    console.error(`❌ Error memproses device ${device.id}:`, error.message);
                    errorCount++;
                    results.push({
                        success: false,
                        deviceId: device.id,
                        error: error.message
                    });
                }
            }
            
            // Step 6: Hasil akhir
            console.log('\n📊 HASIL KONFIGURASI DNS:');
            console.log('=' .repeat(40));
            console.log(`✅ Device berhasil dikonfigurasi: ${successCount}`);
            console.log(`❌ Device gagal dikonfigurasi: ${errorCount}`);
            console.log(`📋 Total device diproses: ${onlineDevices.length}`);
            
            return {
                success: true,
                totalDevices: onlineDevices.length,
                successCount,
                errorCount,
                results
            };
            
        } catch (error) {
            console.error('❌ Error dalam konfigurasi DNS:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Helper function untuk mendapatkan serial number
    getDeviceSerialNumber(device) {
        try {
            const serialPaths = [
                'DeviceID.SerialNumber',
                'InternetGatewayDevice.DeviceInfo.SerialNumber',
                'Device.DeviceInfo.SerialNumber'
            ];
            
            for (const path of serialPaths) {
                const parts = path.split('.');
                let current = device;
                
                for (const part of parts) {
                    if (!current) break;
                    current = current[part];
                }
                
                if (current && current._value !== undefined) {
                    return current._value;
                }
            }
            
            // Fallback ke ID perangkat
            if (device._id) {
                const parts = device._id.split('-');
                if (parts.length >= 3) {
                    return parts[2];
                }
                return device._id;
            }
            
            return 'Unknown';
        } catch (error) {
            console.error('Error getting device serial number:', error);
            return 'Unknown';
        }
    }
}

// Fungsi utama untuk menjalankan script
async function main() {
    const sessionFix = new GenieACSSessionFix();
    
    try {
        console.log('🚀 GENIEACS SESSION FIX SCRIPT');
        console.log('=' .repeat(50));

        // Pilihan menu
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('📋 Pilihan:');
        console.log('1. Test koneksi GenieACS');
        console.log('2. Cek status device');
        console.log('3. Konfigurasi DNS untuk device tertentu');
        console.log('4. Konfigurasi DNS untuk semua device online');
        console.log('5. Keluar');

        const choice = await new Promise((resolve) => {
            rl.question('\nPilih opsi (1-5): ', (input) => {
                rl.close();
                resolve(input.trim());
            });
        });

        switch (choice) {
            case '1':
                await sessionFix.testConnection();
                break;
            case '2':
                const deviceId = await new Promise((resolve) => {
                    const rl2 = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout
                    });
                    rl2.question('Masukkan Device ID: ', (input) => {
                        rl2.close();
                        resolve(input.trim());
                    });
                });
                await sessionFix.checkDeviceStatus(deviceId);
                break;
            case '3':
                const deviceId3 = await new Promise((resolve) => {
                    const rl3 = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout
                    });
                    rl3.question('Masukkan Device ID: ', (input) => {
                        rl3.close();
                        resolve(input.trim());
                    });
                });
                await sessionFix.configureDNSWithSessionManagement(deviceId3);
                break;
            case '4':
                await sessionFix.configureDNSForAllOnlineDevices();
                break;
            case '5':
                console.log('👋 Keluar dari script');
                return;
            default:
                console.log('❌ Pilihan tidak valid');
                return;
        }

    } catch (error) {
        console.error('❌ Error dalam script:', error);
    }
}

// Run if called directly
if (require.main === module) {
    main()
        .then(() => {
            console.log('\n✅ Script selesai dijalankan!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Script gagal:', error);
            process.exit(1);
        });
}

module.exports = { GenieACSSessionFix };
