#!/usr/bin/env node

/**
 * Script sederhana untuk konfigurasi DNS GenieACS
 * Mengatasi masalah 405 Method Not Allowed dengan pendekatan yang lebih sederhana
 */

const axios = require('axios');
const { getSetting } = require('../config/settingsManager');
const genieacs = require('../config/genieacs');

class SimpleGenieACSDNS {
    constructor() {
        this.genieacsUrl = getSetting('genieacs_url', 'http://192.168.8.89:7547');
        this.genieacsUsername = getSetting('genieacs_username', 'admin');
        this.genieacsPassword = getSetting('genieacs_password', 'admin');
        this.dnsServer = '192.168.8.89';
    }

    // Helper untuk membuat axios instance
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
            timeout: 30000
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

    // Fungsi untuk mendapatkan device info dari list devices
    getDeviceInfo(devices, deviceId) {
        try {
            const device = devices.find(d => d._id === deviceId);
            if (!device) {
                return null;
            }

            const isOnline = device._lastInform ? true : false;
            const lastInform = device._lastInform ? new Date(device._lastInform).toLocaleString() : 'Never';
            
            return {
                device,
                isOnline,
                lastInform
            };
        } catch (error) {
            console.error(`Error getting device info for ${deviceId}:`, error);
            return null;
        }
    }

    // Fungsi untuk mengirim task sederhana
    async sendSimpleTask(deviceId, task) {
        try {
            console.log(`📤 Mengirim task ${task.name} ke device ${deviceId}...`);
            
            const axiosInstance = this.getAxiosInstance();
            
            // Kirim task dengan retry sederhana
            let retryCount = 0;
            const maxRetries = 2;
            
            while (retryCount < maxRetries) {
                try {
                    if (retryCount > 0) {
                        console.log(`⏳ Retry ${retryCount}...`);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                    
                    const response = await axiosInstance.post(
                        `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
                        task
                    );
                    
                    console.log(`✅ Task ${task.name} berhasil dikirim`);
                    return {
                        success: true,
                        task: task.name,
                        response: response.data
                    };
                    
                } catch (taskError) {
                    retryCount++;
                    const errorMsg = taskError.response?.data || taskError.message;
                    
                    console.error(`❌ Task ${task.name} gagal (attempt ${retryCount}):`, errorMsg);
                    
                    if (retryCount >= maxRetries) {
                        return {
                            success: false,
                            task: task.name,
                            error: errorMsg
                        };
                    }
                }
            }
            
        } catch (error) {
            console.error(`❌ Error mengirim task ke device ${deviceId}:`, error);
            return {
                success: false,
                task: task.name,
                error: error.message
            };
        }
    }

    // Fungsi untuk konfigurasi DNS sederhana
    async configureSimpleDNS(deviceId, dnsServer = '192.168.8.89') {
        try {
            console.log(`🔧 Mengatur DNS server untuk device: ${deviceId}`);
            console.log(`📋 DNS Server: ${dnsServer}`);
            
            // Buat task sederhana untuk DNS
            const dnsTask = {
                name: "setParameterValues",
                parameterValues: [
                    ['InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers.1', dnsServer],
                    ['InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers.2', '8.8.8.8'],
                    ['Device.DNS.Client.Server.1', dnsServer],
                    ['Device.DNS.Client.Server.2', '8.8.8.8']
                ]
            };
            
            // Kirim task
            const result = await this.sendSimpleTask(deviceId, dnsTask);
            
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

    // Fungsi untuk konfigurasi DNS untuk device online
    async configureDNSForOnlineDevices() {
        try {
            console.log('🚀 KONFIGURASI DNS UNTUK DEVICE ONLINE');
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
            
            // Step 3: Filter device online (berdasarkan lastInform)
            console.log('\n📋 Memfilter device online...');
            const onlineDevices = devices.filter(device => {
                if (!device._lastInform) return false;
                
                // Cek apakah device online (lastInform dalam 24 jam terakhir)
                const lastInformTime = new Date(device._lastInform).getTime();
                const now = new Date().getTime();
                const timeDiff = now - lastInformTime;
                const hoursDiff = timeDiff / (1000 * 60 * 60);
                
                return hoursDiff <= 24; // Online jika lastInform dalam 24 jam
            });
            
            console.log(`✅ Ditemukan ${onlineDevices.length} device online (lastInform dalam 24 jam)`);
            
            if (onlineDevices.length === 0) {
                return {
                    success: false,
                    message: 'Tidak ada device online'
                };
            }
            
            // Step 4: Tampilkan daftar device online
            console.log('\n📋 Daftar device online:');
            onlineDevices.forEach((device, index) => {
                const serialNumber = this.getDeviceSerialNumber(device);
                const lastInform = new Date(device._lastInform).toLocaleString();
                console.log(`${index + 1}. ${device._id}`);
                console.log(`   Serial: ${serialNumber}`);
                console.log(`   Last Inform: ${lastInform}`);
                console.log('');
            });
            
            // Step 5: Konfirmasi
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
            
            // Step 6: Konfigurasi DNS untuk setiap device
            console.log('\n🔧 Mengatur DNS server untuk setiap device...');
            
            const results = [];
            let successCount = 0;
            let errorCount = 0;
            
            for (const device of onlineDevices) {
                try {
                    console.log(`\n📝 Memproses device: ${device._id}`);
                    const result = await this.configureSimpleDNS(device._id);
                    
                    if (result.success) {
                        successCount++;
                        console.log(`✅ DNS berhasil dikonfigurasi untuk ${device._id}`);
                    } else {
                        errorCount++;
                        console.log(`❌ DNS gagal dikonfigurasi untuk ${device._id}: ${result.error}`);
                    }
                    
                    results.push(result);
                    
                    // Delay antar device
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                } catch (error) {
                    console.error(`❌ Error memproses device ${device._id}:`, error.message);
                    errorCount++;
                    results.push({
                        success: false,
                        deviceId: device._id,
                        error: error.message
                    });
                }
            }
            
            // Step 7: Hasil akhir
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
    const simpleDNS = new SimpleGenieACSDNS();
    
    try {
        console.log('🚀 SIMPLE GENIEACS DNS CONFIGURATION');
        console.log('=' .repeat(50));

        // Pilihan menu
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('📋 Pilihan:');
        console.log('1. Test koneksi GenieACS');
        console.log('2. Konfigurasi DNS untuk device tertentu');
        console.log('3. Konfigurasi DNS untuk semua device online');
        console.log('4. Keluar');

        const choice = await new Promise((resolve) => {
            rl.question('\nPilih opsi (1-4): ', (input) => {
                rl.close();
                resolve(input.trim());
            });
        });

        switch (choice) {
            case '1':
                await simpleDNS.testConnection();
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
                await simpleDNS.configureSimpleDNS(deviceId);
                break;
            case '3':
                await simpleDNS.configureDNSForOnlineDevices();
                break;
            case '4':
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

module.exports = { SimpleGenieACSDNS };
