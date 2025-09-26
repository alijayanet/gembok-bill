#!/usr/bin/env node

/**
 * Script untuk mengatur DNS server TR069 pada ONU yang terkoneksi ke Mikrotik
 * 
 * Konfigurasi:
 * - Server GenieACS: 192.168.8.89:7547
 * - IP PPPoE: 192.168.10.0/24
 * - DNS Server: 192.168.8.89 (GenieACS server)
 */

const axios = require('axios');
const { getSetting } = require('../config/settingsManager');
const genieacs = require('../config/genieacs');
const mikrotik = require('../config/mikrotik');

class GenieACSDNSConfig {
    constructor() {
        this.genieacsUrl = getSetting('genieacs_url', 'http://192.168.8.89:7547');
        this.genieacsUsername = getSetting('genieacs_username', 'admin');
        this.genieacsPassword = getSetting('genieacs_password', 'admin');
        this.dnsServer = '192.168.8.89'; // IP GenieACS server
        this.pppoeRange = '192.168.10.0/24';
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
            }
        });
    }

    // Fungsi untuk mengatur DNS server pada ONU
    async configureDNSServer(deviceId, dnsServers = [this.dnsServer]) {
        try {
            console.log(`🔧 Mengatur DNS server untuk device: ${deviceId}`);
            console.log(`📋 DNS Servers: ${dnsServers.join(', ')}`);

            const axiosInstance = this.getAxiosInstance();

            // Cek apakah device online dan dapat diakses
            try {
                const deviceInfo = await axiosInstance.get(`/devices/${encodeURIComponent(deviceId)}`);
                console.log(`📡 Device status: ${deviceInfo.data._lastInform ? 'Online' : 'Offline'}`);
                
                if (!deviceInfo.data._lastInform) {
                    console.log(`⚠️  Device ${deviceId} offline, skip konfigurasi DNS`);
                    return {
                        success: false,
                        deviceId,
                        error: 'Device offline'
                    };
                }
            } catch (deviceError) {
                console.error(`❌ Error cek status device ${deviceId}:`, deviceError.message);
                return {
                    success: false,
                    deviceId,
                    error: 'Device tidak dapat diakses'
                };
            }

            // Parameter paths untuk DNS server di berbagai model ONU
            const dnsParameterPaths = [
                // Standard TR-069 paths
                'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers',
                'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers._value',
                'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers.1',
                'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers.2',
                
                // Alternative paths
                'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers.3',
                'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers.4',
                
                // Device-specific paths
                'Device.DNS.Client.Server.1',
                'Device.DNS.Client.Server.2',
                'Device.DNS.Client.Server.3',
                'Device.DNS.Client.Server.4',
                
                // Virtual parameters
                'VirtualParameters.dnsServer1',
                'VirtualParameters.dnsServer2',
                'VirtualParameters.dnsServer3',
                'VirtualParameters.dnsServer4'
            ];

            // Buat task untuk mengatur DNS server
            const tasks = [];

            // Task 1: Set DNS servers
            const dnsTask = {
                name: "setParameterValues",
                parameterValues: []
            };

            // Tambahkan parameter untuk setiap DNS server
            dnsServers.forEach((dnsServer, index) => {
                // Gunakan path yang berbeda untuk setiap DNS server
                const primaryPaths = [
                    `InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers.${index + 1}`,
                    `Device.DNS.Client.Server.${index + 1}`,
                    `VirtualParameters.dnsServer${index + 1}`
                ];

                primaryPaths.forEach(path => {
                    dnsTask.parameterValues.push([path, dnsServer]);
                });
            });

            // Task 2: Set DNS server list (untuk ONU yang mendukung array)
            const dnsListTask = {
                name: "setParameterValues",
                parameterValues: [
                    ['InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers', dnsServers.join(',')],
                    ['InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers._value', dnsServers.join(',')],
                    ['VirtualParameters.dnsServers', dnsServers.join(',')]
                ]
            };

            // Task 3: Refresh object untuk memastikan perubahan diterapkan
            const refreshTask = {
                name: "refreshObject",
                objectName: "InternetGatewayDevice.LANDevice.1.LANHostConfigManagement"
            };

            tasks.push(dnsTask, dnsListTask, refreshTask);

            // Kirim semua task ke GenieACS dengan retry mechanism
            const results = [];
            let successCount = 0;
            
            for (const task of tasks) {
                let retryCount = 0;
                const maxRetries = 3;
                let taskSuccess = false;
                
                while (retryCount < maxRetries && !taskSuccess) {
                    try {
                        console.log(`📤 Mengirim task: ${task.name} (attempt ${retryCount + 1})`);
                        
                        // Tambahkan delay untuk menghindari session conflict
                        if (retryCount > 0) {
                            await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
                        }
                        
                        const response = await axiosInstance.post(
                            `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
                            task
                        );
                        
                        results.push({
                            task: task.name,
                            success: true,
                            response: response.data,
                            attempts: retryCount + 1
                        });
                        
                        console.log(`✅ Task ${task.name} berhasil dikirim (attempt ${retryCount + 1})`);
                        taskSuccess = true;
                        successCount++;
                        
                    } catch (taskError) {
                        retryCount++;
                        const errorMsg = taskError.response?.data || taskError.message;
                        
                        console.error(`❌ Task ${task.name} gagal (attempt ${retryCount}):`, errorMsg);
                        
                        // Jika error "Invalid session", coba refresh session
                        if (errorMsg.includes('Invalid session') && retryCount < maxRetries) {
                            console.log(`🔄 Mencoba refresh session untuk task ${task.name}...`);
                            // Delay lebih lama untuk session refresh
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        }
                        
                        if (retryCount >= maxRetries) {
                            results.push({
                                task: task.name,
                                success: false,
                                error: errorMsg,
                                attempts: retryCount
                            });
                        }
                    }
                }
            }

            // Tentukan success berdasarkan jumlah task yang berhasil
            const overallSuccess = successCount > 0; // Minimal 1 task berhasil

            return {
                success: overallSuccess,
                deviceId,
                dnsServers,
                results,
                successCount,
                totalTasks: tasks.length
            };

        } catch (error) {
            console.error(`❌ Error mengatur DNS server untuk device ${deviceId}:`, error);
            return {
                success: false,
                deviceId,
                error: error.message
            };
        }
    }

    // Fungsi untuk mengatur DNS server pada semua ONU yang terkoneksi
    async configureAllONUDNS() {
        try {
            console.log('🚀 MULAI KONFIGURASI DNS SERVER UNTUK SEMUA ONU');
            console.log('=' .repeat(60));

            // Step 1: Ambil semua device dari GenieACS
            console.log('📋 Step 1: Mengambil daftar device dari GenieACS...');
            const devices = await genieacs.getDevices();
            console.log(`✅ Ditemukan ${devices.length} device`);

            if (devices.length === 0) {
                console.log('⚠️  Tidak ada device ditemukan');
                return { success: false, message: 'Tidak ada device ditemukan' };
            }

            // Step 2: Filter device yang terkoneksi (memiliki PPPoE username)
            console.log('\n📋 Step 2: Memfilter device yang terkoneksi...');
            const connectedDevices = [];

            for (const device of devices) {
                try {
                    // Cek apakah device memiliki PPPoE username
                    const pppoeUsername = 
                        device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.Username?._value ||
                        device.InternetGatewayDevice?.WANDevice?.[0]?.WANConnectionDevice?.[0]?.WANPPPConnection?.[0]?.Username?._value ||
                        device.VirtualParameters?.pppoeUsername?._value ||
                        null;

                    if (pppoeUsername) {
                        connectedDevices.push({
                            id: device._id,
                            serialNumber: this.getDeviceSerialNumber(device),
                            pppoeUsername,
                            lastInform: device._lastInform
                        });
                    }
                } catch (deviceError) {
                    console.error(`Error memproses device ${device._id}:`, deviceError.message);
                }
            }

            console.log(`✅ Ditemukan ${connectedDevices.length} device yang terkoneksi`);

            if (connectedDevices.length === 0) {
                console.log('⚠️  Tidak ada device yang terkoneksi');
                return { success: false, message: 'Tidak ada device yang terkoneksi' };
            }

            // Step 3: Tampilkan daftar device yang akan dikonfigurasi
            console.log('\n📋 Step 3: Daftar device yang akan dikonfigurasi:');
            connectedDevices.forEach((device, index) => {
                console.log(`${index + 1}. ID: ${device.id}`);
                console.log(`   Serial: ${device.serialNumber}`);
                console.log(`   PPPoE: ${device.pppoeUsername}`);
                console.log(`   Last Inform: ${new Date(device.lastInform).toLocaleString()}`);
                console.log('');
            });

            // Step 4: Konfirmasi
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            const answer = await new Promise((resolve) => {
                rl.question(`Apakah Anda yakin ingin mengatur DNS server untuk ${connectedDevices.length} device? (y/N): `, (input) => {
                    rl.close();
                    resolve(input.toLowerCase());
                });
            });

            if (answer !== 'y' && answer !== 'yes') {
                console.log('❌ Konfigurasi dibatalkan');
                return { success: false, message: 'Konfigurasi dibatalkan' };
            }

            // Step 5: Konfigurasi DNS server untuk setiap device
            console.log('\n🔧 Step 5: Mengatur DNS server untuk setiap device...');
            
            const results = [];
            let successCount = 0;
            let errorCount = 0;

            for (const device of connectedDevices) {
                try {
                    console.log(`\n📝 Mengatur DNS untuk device: ${device.id}`);
                    const result = await this.configureDNSServer(device.id);
                    
                    if (result.success) {
                        console.log(`✅ DNS berhasil dikonfigurasi untuk ${device.serialNumber}`);
                        successCount++;
                    } else {
                        console.log(`❌ DNS gagal dikonfigurasi untuk ${device.serialNumber}: ${result.error}`);
                        errorCount++;
                    }
                    
                    results.push(result);
                    
                    // Delay antar device untuk menghindari overload
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                } catch (error) {
                    console.error(`❌ Error mengatur DNS untuk device ${device.id}:`, error.message);
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
            console.log(`📋 Total device diproses: ${connectedDevices.length}`);

            return {
                success: true,
                totalDevices: connectedDevices.length,
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

    // Fungsi untuk mengatur DNS server berdasarkan PPPoE username
    async configureDNSByPPPoE(pppoeUsername) {
        try {
            console.log(`🔍 Mencari device dengan PPPoE username: ${pppoeUsername}`);
            
            const device = await genieacs.findDeviceByPPPoE(pppoeUsername);
            if (!device) {
                throw new Error(`Device dengan PPPoE username ${pppoeUsername} tidak ditemukan`);
            }

            console.log(`✅ Device ditemukan: ${device._id}`);
            return await this.configureDNSServer(device._id);

        } catch (error) {
            console.error(`❌ Error mengatur DNS untuk PPPoE ${pppoeUsername}:`, error);
            return {
                success: false,
                pppoeUsername,
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

    // Fungsi untuk verifikasi konfigurasi DNS
    async verifyDNSConfiguration(deviceId) {
        try {
            console.log(`🔍 Memverifikasi konfigurasi DNS untuk device: ${deviceId}`);
            
            const device = await genieacs.getDeviceInfo(deviceId);
            
            // Cek parameter DNS yang sudah dikonfigurasi
            const dnsParameters = [
                'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers',
                'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers._value',
                'VirtualParameters.dnsServers'
            ];

            const foundDNS = [];
            for (const param of dnsParameters) {
                const value = this.getParameterValue(device, param);
                if (value) {
                    foundDNS.push({ parameter: param, value });
                }
            }

            console.log(`📋 DNS Configuration untuk device ${deviceId}:`);
            foundDNS.forEach(dns => {
                console.log(`   ${dns.parameter}: ${dns.value}`);
            });

            return {
                success: true,
                deviceId,
                dnsConfiguration: foundDNS
            };

        } catch (error) {
            console.error(`❌ Error verifikasi DNS untuk device ${deviceId}:`, error);
            return {
                success: false,
                deviceId,
                error: error.message
            };
        }
    }

    // Helper function untuk mendapatkan nilai parameter
    getParameterValue(device, path) {
        try {
            const parts = path.split('.');
            let current = device;
            
            for (const part of parts) {
                if (!current) return null;
                current = current[part];
            }
            
            if (current && current._value !== undefined) {
                return current._value;
            }
            
            return null;
        } catch (error) {
            console.error(`Error getting parameter value from path ${path}:`, error);
            return null;
        }
    }
}

// Fungsi utama untuk menjalankan script
async function main() {
    const dnsConfig = new GenieACSDNSConfig();
    
    try {
        console.log('🚀 GENIEACS DNS CONFIGURATION SCRIPT');
        console.log('=' .repeat(50));
        console.log(`📋 Konfigurasi:`);
        console.log(`   GenieACS URL: ${dnsConfig.genieacsUrl}`);
        console.log(`   DNS Server: ${dnsConfig.dnsServer}`);
        console.log(`   PPPoE Range: ${dnsConfig.pppoeRange}`);
        console.log('');

        // Pilihan menu
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('📋 Pilihan:');
        console.log('1. Konfigurasi DNS untuk semua ONU');
        console.log('2. Konfigurasi DNS berdasarkan PPPoE username');
        console.log('3. Verifikasi konfigurasi DNS device');
        console.log('4. Keluar');

        const choice = await new Promise((resolve) => {
            rl.question('\nPilih opsi (1-4): ', (input) => {
                rl.close();
                resolve(input.trim());
            });
        });

        switch (choice) {
            case '1':
                await dnsConfig.configureAllONUDNS();
                break;
            case '2':
                const pppoeUsername = await new Promise((resolve) => {
                    const rl2 = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout
                    });
                    rl2.question('Masukkan PPPoE username: ', (input) => {
                        rl2.close();
                        resolve(input.trim());
                    });
                });
                await dnsConfig.configureDNSByPPPoE(pppoeUsername);
                break;
            case '3':
                const deviceId = await new Promise((resolve) => {
                    const rl3 = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout
                    });
                    rl3.question('Masukkan Device ID: ', (input) => {
                        rl3.close();
                        resolve(input.trim());
                    });
                });
                await dnsConfig.verifyDNSConfiguration(deviceId);
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

module.exports = { GenieACSDNSConfig };
