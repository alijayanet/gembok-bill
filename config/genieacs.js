const axios = require('axios');
const { sendTechnicianMessage } = require('./sendMessage');
const mikrotik = require('./mikrotik');
const { getMikrotikConnection } = require('./mikrotik');
const { getSetting } = require('./settingsManager');
const cacheManager = require('./cacheManager');

// Helper untuk membuat axios instance dinamis
function getAxiosInstance() {
    const GENIEACS_URL = getSetting('genieacs_url', 'http://localhost:7557');
    const GENIEACS_USERNAME = getSetting('genieacs_username', 'acs');
    const GENIEACS_PASSWORD = getSetting('genieacs_password', '');
    return axios.create({
        baseURL: GENIEACS_URL,
        auth: {
            username: GENIEACS_USERNAME,
            password: GENIEACS_PASSWORD
        },
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        timeout: 5000 // 5 second timeout
    });
}

// GenieACS API wrapper
const genieacsApi = {
    async getDevices() {
        try {
            // Check cache first
            const cacheKey = 'genieacs:devices';
            const cachedData = cacheManager.get(cacheKey);

            if (cachedData) {
                console.log(`✅ Using cached devices data (${cachedData.length} devices)`);
                return cachedData;
            }

            console.log('🔍 Fetching devices from GenieACS API...');
            const axiosInstance = getAxiosInstance();
            const response = await axiosInstance.get('/devices');
            const devices = response.data || [];

            console.log(`✅ Found ${devices.length} devices from API`);

            // Cache the response for 2 minutes
            cacheManager.set(cacheKey, devices, 2 * 60 * 1000);

            return devices;
        } catch (error) {
            console.error('❌ Error getting devices:', error.response?.data || error.message);
            throw error;
        }
    },

    async findDeviceByPhoneNumber(phoneNumber) {
        try {
            const axiosInstance = getAxiosInstance();
            // Mencari device berdasarkan tag yang berisi nomor telepon
            const response = await axiosInstance.get('/devices', {
                params: {
                    'query': JSON.stringify({
                        '_tags': phoneNumber
                    })
                }
            });

            if (response.data && response.data.length > 0) {
                return response.data[0]; // Mengembalikan device pertama yang ditemukan
            }

            // Jika tidak ditemukan dengan tag, coba cari dengan PPPoE username dari billing
            try {
                const { billingManager } = require('./billing');
                const customer = await billingManager.getCustomerByPhone(phoneNumber);
                if (customer && customer.pppoe_username) {
                    console.log(`Device not found by phone tag, trying PPPoE username: ${customer.pppoe_username}`);
                    return await this.findDeviceByPPPoE(customer.pppoe_username);
                }
            } catch (billingError) {
                console.error(`Error finding customer in billing for phone ${phoneNumber}:`, billingError.message);
            }

            throw new Error(`No device found with phone number: ${phoneNumber}`);
        } catch (error) {
            console.error(`Error finding device with phone number ${phoneNumber}:`, error.response?.data || error.message);
            throw error;
        }
    },

    async findDeviceByPPPoE(pppoeUsername) {
        try {
            const axiosInstance = getAxiosInstance();

            // Parameter paths untuk PPPoE Username
            const pppUsernamePaths = [
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username._value',
                'VirtualParameters.pppoeUsername',
                'VirtualParameters.pppUsername'
            ];

            // Buat query untuk mencari perangkat berdasarkan PPPoE Username
            const queryObj = { $or: [] };

            // Tambahkan semua kemungkinan path ke query
            for (const path of pppUsernamePaths) {
                const pathQuery = {};
                pathQuery[path] = pppoeUsername;
                queryObj.$or.push(pathQuery);
            }

            const queryJson = JSON.stringify(queryObj);
            const encodedQuery = encodeURIComponent(queryJson);

            // Ambil perangkat dari GenieACS
            const response = await axiosInstance.get(`/devices/?query=${encodedQuery}`);

            if (response.data && response.data.length > 0) {
                return response.data[0];
            }

            throw new Error(`No device found with PPPoE Username: ${pppoeUsername}`);
        } catch (error) {
            console.error(`Error finding device with PPPoE Username ${pppoeUsername}:`, error.response?.data || error.message);
            throw error;
        }
    },

    async getDeviceByPhoneNumber(phoneNumber) {
        try {
            const device = await this.findDeviceByPhoneNumber(phoneNumber);
            if (!device) {
                throw new Error(`No device found with phone number: ${phoneNumber}`);
            }
            return await this.getDevice(device._id);
        } catch (error) {
            console.error(`Error getting device by phone number ${phoneNumber}:`, error.message);
            throw error;
        }
    },

    async getDevice(deviceId) {
        try {
            const axiosInstance = getAxiosInstance();
            const response = await axiosInstance.get(`/devices/${encodeURIComponent(deviceId)}`);
            return response.data;
        } catch (error) {
            console.error(`Error getting device ${deviceId}:`, error.response?.data || error.message);
            throw error;
        }
    },

    async setParameterValues(deviceId, parameters) {
        try {
            console.log('Setting parameters for device:', deviceId, parameters);
            const axiosInstance = getAxiosInstance();
            // Format parameter values untuk GenieACS
            const parameterValues = [];
            for (const [path, value] of Object.entries(parameters)) {
                // Handle SSID update
                if (path.includes('SSID')) {
                    parameterValues.push(
                        ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", value],
                        ["Device.WiFi.SSID.1.SSID", value]
                    );
                }
                // Handle WiFi password update
                else if (path.includes('Password') || path.includes('KeyPassphrase')) {
                    parameterValues.push(
                        ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase", value],
                        ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", value],
                        ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey", value]
                    );
                }
                // Handle other parameters
                else {
                    parameterValues.push([path, value]);
                }
            }

            console.log('Formatted parameter values:', parameterValues);

            // Kirim task ke GenieACS
            const task = {
                name: "setParameterValues",
                parameterValues: parameterValues
            };

            const response = await axiosInstance.post(
                `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
                task
            );

            console.log('Parameter update response:', response.data);

            // Kirim refresh task
            const refreshTask = {
                name: "refreshObject",
                objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1"
            };

            const refreshResponse = await axiosInstance.post(
                `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
                refreshTask
            );

            console.log('Refresh task response:', refreshResponse.data);

            return response.data;
        } catch (error) {
            console.error(`Error setting parameters for device ${deviceId}:`, error.response?.data || error.message);
            throw error;
        }
    },

    async reboot(deviceId) {
        try {
            const axiosInstance = getAxiosInstance();
            const task = {
                name: "reboot",
                timestamp: new Date().toISOString()
            };
            const response = await axiosInstance.post(
                `/devices/${encodeURIComponent(deviceId)}/tasks`,
                task
            );
            return response.data;
        } catch (error) {
            console.error(`Error rebooting device ${deviceId}:`, error.response?.data || error.message);
            throw error;
        }
    },

    async factoryReset(deviceId) {
        try {
            const axiosInstance = getAxiosInstance();
            const task = {
                name: "factoryReset",
                timestamp: new Date().toISOString()
            };
            const response = await axiosInstance.post(
                `/devices/${encodeURIComponent(deviceId)}/tasks`,
                task
            );
            return response.data;
        } catch (error) {
            console.error(`Error factory resetting device ${deviceId}:`, error.response?.data || error.message);
            throw error;
        }
    },

    async addTagToDevice(deviceId, tag) {
        try {
            console.log(`Adding tag "${tag}" to device: ${deviceId}`);
            const axiosInstance = getAxiosInstance();

            // Dapatkan device terlebih dahulu untuk melihat tag yang sudah ada
            const device = await this.getDevice(deviceId);
            const existingTags = device._tags || [];

            // Cek apakah tag sudah ada
            if (existingTags.includes(tag)) {
                console.log(`Tag "${tag}" already exists on device ${deviceId}`);
                return { success: true, message: 'Tag already exists' };
            }

            // Tambahkan tag baru
            const newTags = [...existingTags, tag];

            // Update device dengan tag baru
            const response = await axiosInstance.put(
                `/devices/${encodeURIComponent(deviceId)}`,
                {
                    _tags: newTags
                }
            );

            console.log(`Successfully added tag "${tag}" to device ${deviceId}`);
            return { success: true, message: 'Tag added successfully' };
        } catch (error) {
            console.error(`Error adding tag "${tag}" to device ${deviceId}:`, error.response?.data || error.message);
            throw error;
        }
    },

    async removeTagFromDevice(deviceId, tag) {
        try {
            console.log(`Removing tag "${tag}" from device: ${deviceId}`);
            const axiosInstance = getAxiosInstance();

            // Dapatkan device terlebih dahulu untuk melihat tag yang sudah ada
            const device = await this.getDevice(deviceId);
            const existingTags = device._tags || [];

            // Cek apakah tag ada
            if (!existingTags.includes(tag)) {
                console.log(`Tag "${tag}" does not exist on device ${deviceId}`);
                return { success: true, message: 'Tag does not exist' };
            }

            // Hapus tag
            const newTags = existingTags.filter(t => t !== tag);

            // Update device dengan tag yang sudah difilter
            const response = await axiosInstance.put(
                `/devices/${encodeURIComponent(deviceId)}`,
                {
                    _tags: newTags
                }
            );

            console.log(`Successfully removed tag "${tag}" from device ${deviceId}`);
            return { success: true, message: 'Tag removed successfully' };
        } catch (error) {
            console.error(`Error removing tag "${tag}" from device ${deviceId}:`, error.response?.data || error.message);
            throw error;
        }
    },

    async getDeviceParameters(deviceId, parameterNames) {
        try {
            const axiosInstance = getAxiosInstance();
            const queryString = parameterNames.map(name => `query=${encodeURIComponent(name)}`).join('&');
            const response = await axiosInstance.get(`/devices/${encodeURIComponent(deviceId)}?${queryString}`);
            return response.data;
        } catch (error) {
            console.error(`Error getting parameters for device ${deviceId}:`, error.response?.data || error.message);
            throw error;
        }
    },

    async getDeviceInfo(deviceId) {
        try {
            console.log(`Getting device info for device ID: ${deviceId}`);
            const GENIEACS_URL = getSetting('genieacs_url', 'http://localhost:7557');
            const GENIEACS_USERNAME = getSetting('genieacs_username', 'acs');
            const GENIEACS_PASSWORD = getSetting('genieacs_password', '');
            // Mendapatkan device detail
            const deviceResponse = await axios.get(`${GENIEACS_URL}/devices/${encodeURIComponent(deviceId)}`, {
                auth: {
                    username: GENIEACS_USERNAME,
                    password: GENIEACS_PASSWORD
                }
            });
            return deviceResponse.data;
        } catch (error) {
            console.error(`Error getting device info for ${deviceId}:`, error.response?.data || error.message);
            throw error;
        }
    },

    async getVirtualParameters(deviceId) {
        try {
            const axiosInstance = getAxiosInstance();
            const response = await axiosInstance.get(`/devices/${encodeURIComponent(deviceId)}`);
            return response.data.VirtualParameters || {};
        } catch (error) {
            console.error(`Error getting virtual parameters for device ${deviceId}:`, error.response?.data || error.message);
            throw error;
        }
    },
};

/**
 * Get a formatted technical summary of a device
 */
async function getTechnicalSummary(deviceId) {
    try {
        const device = await genieacsApi.getDevice(deviceId);
        if (!device) return null;

        const rxPowerPaths = [
            'VirtualParameters.RXPower',
            'VirtualParameters.redaman',
            'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RXPower',
            'Device.XPON.Interface.1.Stats.RXPower'
        ];

        let rxPower = 'N/A';
        for (const path of rxPowerPaths) {
            const val = getRXPowerValue(device, path);
            if (val !== null) {
                rxPower = `${val} dBm`;
                break;
            }
        }

        const ssid =
            device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.SSID?._value ||
            device.Device?.WiFi?.SSID?.[1]?.SSID?._value ||
            'N/A';

        const uptime =
            device.InternetGatewayDevice?.DeviceInfo?.UpTime?._value ||
            device.Device?.DeviceInfo?.UpTime?._value ||
            'N/A';

        const formattedUptime = uptime !== 'N/A' ? formatSeconds(parseInt(uptime)) : 'N/A';

        return {
            id: device._id,
            serialNumber: getDeviceSerialNumber(device),
            rxPower,
            ssid,
            uptime: formattedUptime,
            model: device.DeviceID?.ProductClass?._value || 'N/A',
            lastInform: device._lastInform ? new Date(device._lastInform).toLocaleString('id-ID') : 'N/A'
        };
    } catch (error) {
        console.error('Error getting technical summary:', error);
        return null;
    }
}

function formatSeconds(seconds) {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    let res = "";
    if (days > 0) res += `${days}h `;
    if (hours > 0) res += `${hours}j `;
    if (minutes > 0) res += `${minutes}m`;
    return res.trim() || "< 1m";
}

// Fungsi untuk memeriksa nilai RXPower dari semua perangkat
async function monitorRXPower(threshold = -27) {
    try {
        console.log(`Memulai pemantauan RXPower dengan threshold ${threshold} dBm`);

        // Ambil semua perangkat
        const devices = await genieacsApi.getDevices();
        console.log(`Memeriksa RXPower untuk ${devices.length} perangkat...`);

        // Ambil data PPPoE dari Mikrotik
        console.log('Mengambil data PPPoE dari Mikrotik...');
        const conn = await getMikrotikConnection();
        let pppoeSecrets = [];

        if (conn) {
            try {
                // Dapatkan semua PPPoE secret dari Mikrotik
                pppoeSecrets = await conn.write('/ppp/secret/print');
                console.log(`Ditemukan ${pppoeSecrets.length} PPPoE secret`);
            } catch (error) {
                console.error('Error mendapatkan PPPoE secret:', error.message);
            }
        }

        const criticalDevices = [];

        // Periksa setiap perangkat
        for (const device of devices) {
            try {
                // Dapatkan nilai RXPower
                const rxPowerPaths = [
                    'VirtualParameters.RXPower',
                    'VirtualParameters.redaman',
                    'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RXPower',
                    'Device.XPON.Interface.1.Stats.RXPower'
                ];

                let rxPower = null;

                // Periksa setiap jalur yang mungkin berisi nilai RXPower
                for (const path of rxPowerPaths) {
                    // Ekstrak nilai menggunakan path yang ada di device
                    if (getRXPowerValue(device, path)) {
                        rxPower = getRXPowerValue(device, path);
                        break;
                    }
                }

                // Jika rxPower ditemukan dan di bawah threshold
                if (rxPower !== null && parseFloat(rxPower) < threshold) {
                    // Cari PPPoE username dari parameter perangkat (seperti di handleAdminCheckONU)
                    let pppoeUsername = "Unknown";
                    const serialNumber = getDeviceSerialNumber(device);
                    const deviceId = device._id;
                    const shortDeviceId = deviceId.split('-')[2] || deviceId;

                    // Ambil PPPoE username dari parameter perangkat
                    pppoeUsername =
                        device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.Username?._value ||
                        device.InternetGatewayDevice?.WANDevice?.[0]?.WANConnectionDevice?.[0]?.WANPPPConnection?.[0]?.Username?._value ||
                        device.VirtualParameters?.pppoeUsername?._value ||
                        "Unknown";

                    // Jika tidak ditemukan dari parameter perangkat, coba cari dari PPPoE secret di Mikrotik
                    if (pppoeUsername === "Unknown") {
                        // Coba cari PPPoE secret yang terkait dengan perangkat ini berdasarkan comment
                        const matchingSecret = pppoeSecrets.find(secret => {
                            if (!secret.comment) return false;

                            // Cek apakah serial number atau device ID ada di kolom comment
                            return (
                                secret.comment.includes(serialNumber) ||
                                secret.comment.includes(shortDeviceId)
                            );
                        });

                        if (matchingSecret) {
                            // Jika ditemukan secret yang cocok, gunakan nama secret sebagai username
                            pppoeUsername = matchingSecret.name;
                            console.log(`Menemukan PPPoE username ${pppoeUsername} untuk perangkat ${shortDeviceId} dari PPPoE secret`);
                        }
                    } else {
                        console.log(`Menemukan PPPoE username ${pppoeUsername} untuk perangkat ${shortDeviceId} dari parameter perangkat`);
                    }

                    // Jika masih tidak ditemukan, coba cari dari tag perangkat
                    if (pppoeUsername === "Unknown" && device._tags && Array.isArray(device._tags)) {
                        // Cek apakah ada tag yang dimulai dengan "pppoe:" yang berisi username
                        const pppoeTag = device._tags.find(tag => tag.startsWith('pppoe:'));
                        if (pppoeTag) {
                            pppoeUsername = pppoeTag.replace('pppoe:', '');
                            console.log(`Menemukan PPPoE username ${pppoeUsername} untuk perangkat ${shortDeviceId} dari tag`);
                        } else {
                            console.log(`Tidak menemukan PPPoE username untuk perangkat ${shortDeviceId}, tags: ${JSON.stringify(device._tags)}`);
                        }
                    }

                    const deviceInfo = {
                        id: device._id,
                        rxPower,
                        serialNumber: getDeviceSerialNumber(device),
                        lastInform: device._lastInform,
                        pppoeUsername: pppoeUsername
                    };

                    criticalDevices.push(deviceInfo);
                    console.log(`Perangkat dengan RXPower rendah: ${deviceInfo.id}, RXPower: ${rxPower} dBm, PPPoE: ${pppoeUsername}`);
                }
            } catch (deviceError) {
                console.error(`Error memeriksa RXPower untuk perangkat ${device._id}:`, deviceError);
            }
        }

        // Jika ada perangkat dengan RXPower di bawah threshold
        if (criticalDevices.length > 0) {
            // Buat pesan peringatan
            let message = `⚠️ *PERINGATAN: REDAMAN TINGGI* ⚠️\n\n`;
            message += `${criticalDevices.length} perangkat memiliki nilai RXPower di atas ${threshold} dBm:\n\n`;

            criticalDevices.forEach((device, index) => {
                message += `${index + 1}. ID: ${device.id.split('-')[2] || device.id}\n`;
                message += `   S/N: ${device.serialNumber}\n`;
                message += `   PPPoE: ${device.pppoeUsername}\n`;
                message += `   RXPower: ${device.rxPower} dBm\n`;
                message += `   Last Inform: ${new Date(device.lastInform).toLocaleString()}\n\n`;
            });

            message += `Mohon segera dicek untuk menghindari koneksi terputus.`;

            // Kirim pesan ke grup teknisi dengan prioritas tinggi
            await sendTechnicianMessage(message, 'high');
            console.log(`Pesan peringatan RXPower terkirim untuk ${criticalDevices.length} perangkat`);
        } else {
            console.log('Tidak ada perangkat dengan nilai RXPower di bawah threshold');
        }

        return {
            success: true,
            criticalDevices,
            message: `${criticalDevices.length} perangkat memiliki RXPower di atas threshold`
        };
    } catch (error) {
        console.error('Error memantau RXPower:', error);
        return {
            success: false,
            message: `Error memantau RXPower: ${error.message}`,
            error
        };
    }
}

// Helper function untuk mendapatkan nilai RXPower
function getRXPowerValue(device, path) {
    try {
        // Split path menjadi parts
        const parts = path.split('.');
        let current = device;

        // Navigate through nested properties
        for (const part of parts) {
            if (!current) return null;
            current = current[part];
        }

        // Check if it's a GenieACS parameter object
        if (current && current._value !== undefined) {
            return current._value;
        }

        return null;
    } catch (error) {
        console.error(`Error getting RXPower from path ${path}:`, error);
        return null;
    }
}

// Helper function untuk mendapatkan serial number
function getDeviceSerialNumber(device) {
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

        // Fallback ke ID perangkat jika serial number tidak ditemukan
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

// Fungsi untuk memantau perangkat yang tidak aktif (offline)
async function monitorOfflineDevices(thresholdHours = null) {
    try {
        // Jika thresholdHours tidak diberikan, ambil dari settings
        if (thresholdHours === null) {
            thresholdHours = parseInt(getSetting('offline_device_threshold_hours', '24'));
        }
        console.log(`Memulai pemantauan perangkat offline dengan threshold ${thresholdHours} jam`);

        // Ambil semua perangkat
        const devices = await genieacsApi.getDevices();
        console.log(`Memeriksa status untuk ${devices.length} perangkat...`);

        const offlineDevices = [];
        const now = new Date();
        const thresholdMs = thresholdHours * 60 * 60 * 1000; // Convert jam ke ms

        // Periksa setiap perangkat
        for (const device of devices) {
            try {
                if (!device._lastInform) {
                    console.log(`Perangkat ${device._id} tidak memiliki lastInform`);
                    continue;
                }

                const lastInformTime = new Date(device._lastInform).getTime();
                const timeDiff = now.getTime() - lastInformTime;

                // Jika perangkat belum melakukan inform dalam waktu yang melebihi threshold
                if (timeDiff > thresholdMs) {
                    const pppoeUsername = device?.VirtualParameters?.pppoeUsername?._value ||
                        device?.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.Username?._value ||
                        device?.InternetGatewayDevice?.WANDevice?.[0]?.WANConnectionDevice?.[0]?.WANPPPConnection?.[0]?.Username?._value ||
                        (Array.isArray(device?._tags) ? (device._tags.find(tag => tag.startsWith('pppoe:'))?.replace('pppoe:', '')) : undefined) ||
                        '-';
                    const deviceInfo = {
                        id: device._id,
                        serialNumber: getDeviceSerialNumber(device),
                        pppoeUsername,
                        lastInform: device._lastInform,
                        offlineHours: Math.round(timeDiff / (60 * 60 * 1000) * 10) / 10 // Jam dengan 1 desimal
                    };

                    offlineDevices.push(deviceInfo);
                    console.log(`Perangkat offline: ${deviceInfo.id}, Offline selama: ${deviceInfo.offlineHours} jam`);
                }
            } catch (deviceError) {
                console.error(`Error memeriksa status untuk perangkat ${device._id}:`, deviceError);
            }
        }

        // Jika ada perangkat yang offline
        if (offlineDevices.length > 0) {
            // Buat pesan peringatan
            let message = `⚠️ *PERINGATAN: PERANGKAT OFFLINE* ⚠️\n\n`;
            message += `${offlineDevices.length} perangkat offline lebih dari ${thresholdHours} jam:\n\n`;

            offlineDevices.forEach((device, index) => {
                message += `${index + 1}. ID: ${device.id.split('-')[2] || device.id}\n`;
                message += `   S/N: ${device.serialNumber}\n`;
                message += `   PPPoE: ${device.pppoeUsername || '-'}\n`;
                message += `   Offline selama: ${device.offlineHours} jam\n`;
                message += `   Last Inform: ${new Date(device.lastInform).toLocaleString()}\n\n`;
            });

            message += `Mohon segera ditindaklanjuti.`;

            // Kirim pesan ke grup teknisi dengan prioritas medium
            await sendTechnicianMessage(message, 'medium');
            console.log(`Pesan peringatan perangkat offline terkirim untuk ${offlineDevices.length} perangkat`);
        } else {
            console.log('Tidak ada perangkat yang offline lebih dari threshold');
        }

        return {
            success: true,
            offlineDevices,
            message: `${offlineDevices.length} perangkat offline lebih dari ${thresholdHours} jam`
        };
    } catch (error) {
        console.error('Error memantau perangkat offline:', error);
        return {
            success: false,
            message: `Error memantau perangkat offline: ${error.message}`,
            error
        };
    }
}

// Jadwalkan monitoring setiap 6 jam
function scheduleMonitoring() {
    // Ambil pengaturan dari settings.json
    const rxPowerRecapEnabled = getSetting('rxpower_recap_enable', true) !== false;
    const rxPowerRecapInterval = getSetting('rxpower_recap_interval', 6 * 60 * 60 * 1000);
    const offlineNotifEnabled = getSetting('offline_notification_enable', true) !== false;
    const offlineNotifInterval = getSetting('offline_notification_interval', 12 * 60 * 60 * 1000);

    setTimeout(async () => {
        if (rxPowerRecapEnabled) {
            console.log('Menjalankan pemantauan RXPower awal...');
            await monitorRXPower();
        }
        if (offlineNotifEnabled) {
            console.log('Menjalankan pemantauan perangkat offline awal...');
            await monitorOfflineDevices();
        }
        // Jadwalkan secara berkala
        if (rxPowerRecapEnabled) {
            setInterval(async () => {
                console.log('Menjalankan pemantauan RXPower terjadwal...');
                await monitorRXPower();
            }, rxPowerRecapInterval);
        }
        if (offlineNotifEnabled) {
            setInterval(async () => {
                console.log('Menjalankan pemantauan perangkat offline terjadwal...');
                await monitorOfflineDevices();
            }, offlineNotifInterval);
        }
    }, 5 * 60 * 1000); // Mulai 5 menit setelah server berjalan
}

// Jalankan penjadwalan monitoring - DISABLED (using IntervalManager instead)
// scheduleMonitoring();

// ===== ENHANCEMENT: CACHED VERSIONS (Tidak mengubah fungsi existing) =====

/**
 * Enhanced getDevices dengan caching
 * Fallback ke fungsi original jika cache miss
 */
async function getDevicesCached() {
    // Use the same cache key as getDevices method
    const cacheKey = 'genieacs:devices';
    const cached = cacheManager.get(cacheKey);

    if (cached) {
        console.log(`📦 Using cached devices data (${cached.length} devices)`);
        return cached;
    }

    console.log('🔄 Fetching fresh devices data from GenieACS');
    const devices = await genieacsApi.getDevices();

    return devices; // getDevices already handles caching
}

/**
 * Enhanced getDeviceInfo dengan caching
 * Fallback ke fungsi original jika cache miss
 */
async function getDeviceInfoCached(deviceId) {
    const cacheKey = `genieacs_device_${deviceId}`;
    const cached = cacheManager.get(cacheKey);

    if (cached) {
        console.log(`📦 Using cached device info for ${deviceId}`);
        return cached;
    }

    console.log(`🔄 Fetching fresh device info for ${deviceId}`);
    const deviceInfo = await genieacsApi.getDeviceInfo(deviceId);

    // Cache untuk 2 menit
    cacheManager.set(cacheKey, deviceInfo, 2 * 60 * 1000);

    return deviceInfo;
}

/**
 * Clear cache untuk device tertentu
 * Berguna saat ada update device
 */
function clearDeviceCache(deviceId = null) {
    try {
        if (deviceId) {
            cacheManager.clear(`genieacs_device_${deviceId}`);
            console.log(`🗑️ Cleared cache for device ${deviceId}`);
        } else {
            // Clear all GenieACS related cache
            cacheManager.clear('genieacs_devices');
            console.log('🗑️ Cleared all GenieACS devices cache');
        }
    } catch (error) {
        console.error('Error clearing device cache:', error);
        throw error;
    }
}

/**
 * Clear all cache (untuk maintenance)
 */
function clearAllCache() {
    try {
        cacheManager.clearAll();
        console.log('🗑️ Cleared all cache');
    } catch (error) {
        console.error('Error clearing all cache:', error);
        throw error;
    }
}

/**
 * Get cache statistics untuk monitoring
 */
function getCacheStats() {
    return cacheManager.getStats();
}

module.exports = {
    // Original functions (tidak berubah)
    getDevices: genieacsApi.getDevices,
    getDeviceInfo: genieacsApi.getDeviceInfo,
    findDeviceByPhoneNumber: genieacsApi.findDeviceByPhoneNumber,
    findDeviceByPPPoE: genieacsApi.findDeviceByPPPoE,
    getDeviceByPhoneNumber: genieacsApi.getDeviceByPhoneNumber,
    setParameterValues: genieacsApi.setParameterValues,
    reboot: genieacsApi.reboot,
    factoryReset: genieacsApi.factoryReset,
    addTagToDevice: genieacsApi.addTagToDevice,
    removeTagFromDevice: genieacsApi.removeTagFromDevice,
    getVirtualParameters: genieacsApi.getVirtualParameters,
    monitorRXPower,
    monitorOfflineDevices,
    getRXPowerValue,
    getDeviceSerialNumber,
    getTechnicalSummary,

    // Enhanced functions dengan caching
    getDevicesCached,
    getDeviceInfoCached,
    clearDeviceCache,
    clearAllCache,
    getCacheStats
};
