const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const { getDevices, setParameterValues } = require('../config/genieacs');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getSettingsWithCache } = require('../config/settingsManager')
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');

// Test route untuk verifikasi router
router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'AdminGenieacs router is working!',
    timestamp: new Date().toISOString()
  });
});

// Debug route tanpa authentication untuk testing
router.get('/debug/mapping/devices', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Debug route accessible',
      timestamp: new Date().toISOString(),
      router: 'adminGenieacs',
      path: '/admin/debug/mapping/devices'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function untuk menentukan status device
function getDeviceStatus(lastInform) {
  if (!lastInform) return 'Unknown';
  
  try {
    const lastInformTime = new Date(lastInform).getTime();
    const now = Date.now();
    const diffMs = now - lastInformTime;
    const diffHours = diffMs / (1000 * 60 * 60);
    
    // Device dianggap online jika last inform < 1 jam
    if (diffHours < 1) {
      return 'Online';
    } else if (diffHours < 24) {
      return 'Offline';
    } else {
      return 'Offline';
    }
  } catch (error) {
    return 'Unknown';
  }
}

// Helper dan parameterPaths dari customerPortal.js
const parameterPaths = {
  pppUsername: [
    'VirtualParameters.pppoeUsername',
    'VirtualParameters.pppUsername',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username'
  ],
  rxPower: [
    'VirtualParameters.RXPower',
    'VirtualParameters.redaman',
    'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RXPower'
  ],
  deviceTags: [
    'Tags',
    '_tags',
    'VirtualParameters.Tags'
  ],
  serialNumber: [
    'DeviceID.SerialNumber',
    'InternetGatewayDevice.DeviceInfo.SerialNumber._value'
  ],
  model: [
    'DeviceID.ProductClass',
    'InternetGatewayDevice.DeviceInfo.ModelName._value'
  ],
  status: [
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Status._value',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Status._value',
    'VirtualParameters.Status'
  ],
  ssid: [
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID._value',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID._value',
    'VirtualParameters.SSID'
  ],
  password: [
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase._value',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase._value',
    'VirtualParameters.Password'
  ],
  userConnected: [
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations'
  ]
};
function getParameterWithPaths(device, paths) {
  for (const path of paths) {
    const parts = path.split('.');
    let value = device;
    
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
        if (value && value._value !== undefined) value = value._value;
      } else {
        value = undefined;
        break;
      }
    }
    
    if (value !== undefined && value !== null && value !== '') {
      // Handle special case for device tags
      if (path.includes('Tags') || path.includes('_tags')) {
        if (Array.isArray(value)) {
          return value.filter(tag => tag && tag !== '').join(', ');
        } else if (typeof value === 'string') {
          return value;
        }
      }
      return value;
    }
  }
  return '-';
}


// GET: List Device GenieACS
router.get('/genieacs', adminAuth, async (req, res) => {
  try {
    // Ambil data device dari GenieACS
    // ENHANCEMENT: Gunakan cached version untuk performa lebih baik
    const { getDevicesCached } = require('../config/genieacs');
    const devicesRaw = await getDevicesCached();
    // Mapping data sesuai kebutuhan tabel
    const devices = devicesRaw.map((device, i) => ({
      id: device._id || '-',
      serialNumber: device.DeviceID?.SerialNumber || device._id || '-',
      model: device.DeviceID?.ProductClass || device.InternetGatewayDevice?.DeviceInfo?.ModelName?._value || '-',
      lastInform: device._lastInform ? new Date(device._lastInform).toLocaleString('id-ID') : '-',
      pppoeUsername: getParameterWithPaths(device, parameterPaths.pppUsername),
      ssid: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.SSID?._value || device.VirtualParameters?.SSID || '-',
      password: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.KeyPassphrase?._value || '-',
      userKonek: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.TotalAssociations?._value || '-',
      rxPower: getParameterWithPaths(device, parameterPaths.rxPower),
      tag: (Array.isArray(device.Tags) && device.Tags.length > 0)
        ? device.Tags.join(', ')
        : (typeof device.Tags === 'string' && device.Tags)
          ? device.Tags
          : (Array.isArray(device._tags) && device._tags.length > 0)
            ? device._tags.join(', ')
            : (typeof device._tags === 'string' && device._tags)
              ? device._tags
              : '-'
    }));
    // Tambahkan statistik GenieACS seperti di dashboard
    const genieacsTotal = devicesRaw.length;
    const now = Date.now();
    const genieacsOnline = devicesRaw.filter(dev => dev._lastInform && (now - new Date(dev._lastInform).getTime()) < 3600*1000).length;
    const genieacsOffline = genieacsTotal - genieacsOnline;
    const settings = getSettingsWithCache();
    res.render('adminGenieacs', { title: 'Device GenieACS', devices, settings, genieacsTotal, genieacsOnline, genieacsOffline, versionInfo: getVersionInfo(), versionBadge: getVersionBadge() });
  } catch (err) {
    res.render('adminGenieacs', { title: 'Device GenieACS', devices: [], error: 'Gagal mengambil data device.', versionInfo: getVersionInfo(), versionBadge: getVersionBadge() });
  }
});

// Endpoint edit SSID/Password - Optimized like WhatsApp (Fast Response)
router.post('/genieacs/edit', adminAuth, async (req, res) => {
  try {
    const { id, ssid, password } = req.body;
    console.log('Edit request received:', { id, ssid, password });

    const { getSetting } = require('../config/settingsManager');
    const genieacsUrl = getSetting('genieacs_url', 'http://localhost:7557');
    const genieacsUsername = getSetting('genieacs_username', 'admin');
    const genieacsPassword = getSetting('genieacs_password', 'password');

    // Encode deviceId untuk URL
    const encodedDeviceId = encodeURIComponent(id);

    // Kirim response cepat ke frontend
    if (typeof ssid !== 'undefined') {
      res.json({ 
        success: true, 
        field: 'ssid', 
        message: 'SSID berhasil diupdate!',
        newSSID: ssid
      });
      
      // Proses update di background (non-blocking)
      updateSSIDOptimized(id, ssid, genieacsUrl, genieacsUsername, genieacsPassword).then(result => {
        if (result.success) {
          console.log(`✅ Admin SSID update completed for device: ${id} to: ${ssid}`);
        } else {
          console.error(`❌ Admin SSID update failed for device: ${id}: ${result.message}`);
        }
      }).catch(error => {
        console.error('Error in background admin SSID update:', error);
      });
      
    } else if (typeof password !== 'undefined') {
      res.json({ 
        success: true, 
        field: 'password', 
        message: 'Password berhasil diupdate!'
      });
      
      // Proses update di background (non-blocking)
      updatePasswordOptimized(id, password, genieacsUrl, genieacsUsername, genieacsPassword).then(result => {
        if (result.success) {
          console.log(`✅ Admin password update completed for device: ${id}`);
        } else {
          console.error(`❌ Admin password update failed for device: ${id}: ${result.message}`);
        }
      }).catch(error => {
        console.error('Error in background admin password update:', error);
      });
      
    } else {
      res.status(400).json({ success: false, message: 'Tidak ada perubahan' });
    }
    
  } catch (err) {
    console.error('General error in edit endpoint:', err);
    res.status(500).json({ success: false, message: 'Gagal update SSID/Password: ' + err.message });
  }
});

// Helper: Update SSID Optimized (seperti WhatsApp command) - Fast Response
async function updateSSIDOptimized(deviceId, newSSID, genieacsUrl, username, password) {
  try {
    console.log(`🔄 Optimized SSID update for device: ${deviceId} to: ${newSSID}`);
    
    const encodedDeviceId = encodeURIComponent(deviceId);
    
    // Buat nama SSID 5G berdasarkan SSID 2.4G (seperti di WhatsApp)
    const newSSID5G = `${newSSID}-5G`;
    
    // Concurrent API calls untuk speed up
    const axiosConfig = {
      auth: { username, password },
      timeout: 10000 // 10 second timeout
    };
    
    // Update SSID 2.4GHz dan 5GHz secara concurrent
    const tasks = [];
    
    // Task 1: Update SSID 2.4GHz
    tasks.push(
      axios.post(
        `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
        {
          name: "setParameterValues",
          parameterValues: [
            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
          ]
        },
        axiosConfig
      )
    );
    
    // Task 2: Update SSID 5GHz (coba index 5 dulu, yang paling umum)
    tasks.push(
      axios.post(
        `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
        {
          name: "setParameterValues",
          parameterValues: [
            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID", newSSID5G, "xsd:string"]
          ]
        },
        axiosConfig
      ).catch(() => null) // Ignore error jika index 5 tidak ada
    );
    
    // Task 3: Refresh object
    tasks.push(
      axios.post(
        `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
        {
          name: "refreshObject",
          objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
        },
        axiosConfig
      ).catch(() => null) // Ignore error jika refresh gagal
    );
    
    // Jalankan semua tasks secara concurrent
    const results = await Promise.allSettled(tasks);
    
    // Check results
    const mainTaskSuccess = results[0].status === 'fulfilled';
    const wifi5GFound = results[1].status === 'fulfilled';
    
    if (mainTaskSuccess) {
      console.log(`✅ SSID update completed for device: ${deviceId}: ${newSSID}`);
      
      // Invalidate GenieACS cache after successful update
      try {
        const cacheManager = require('../config/cacheManager');
        cacheManager.invalidatePattern('genieacs:*');
        console.log('🔄 GenieACS cache invalidated after SSID update');
      } catch (cacheError) {
        console.warn('⚠️ Failed to invalidate cache:', cacheError.message);
      }
      
      return { success: true, wifi5GFound };
    } else {
      console.error(`❌ SSID update failed for device: ${deviceId}: ${results[0].reason?.message || 'Unknown error'}`);
      return { success: false, message: 'Gagal update SSID' };
    }
    
  } catch (error) {
    console.error('Error in updateSSIDOptimized:', error);
    return { success: false, message: error.message };
  }
}

// Helper: Update Password Optimized (seperti WhatsApp command) - Fast Response
async function updatePasswordOptimized(deviceId, newPassword, genieacsUrl, username, password) {
  try {
    console.log(`🔄 Optimized password update for device: ${deviceId}`);
    
    const encodedDeviceId = encodeURIComponent(deviceId);
    
    // Concurrent API calls untuk speed up
    const axiosConfig = {
      auth: { username, password },
      timeout: 10000 // 10 second timeout
    };
    
    // Update password 2.4GHz dan 5GHz secara concurrent
    const tasks = [];
    
    // Task 1: Update password 2.4GHz
    tasks.push(
      axios.post(
        `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
        {
          name: "setParameterValues",
          parameterValues: [
            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", newPassword, "xsd:string"]
          ]
        },
        axiosConfig
      )
    );
    
    // Task 2: Update password 5GHz (coba index 5 dulu)
    tasks.push(
      axios.post(
        `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
        {
          name: "setParameterValues",
          parameterValues: [
            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase", newPassword, "xsd:string"]
          ]
        },
        axiosConfig
      ).catch(() => null) // Ignore error jika index 5 tidak ada
    );
    
    // Task 3: Refresh object
    tasks.push(
      axios.post(
        `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
        {
          name: "refreshObject",
          objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
        },
        axiosConfig
      ).catch(() => null) // Ignore error jika refresh gagal
    );
    
    // Jalankan semua tasks secara concurrent
    const results = await Promise.allSettled(tasks);
    
    // Check results
    const mainTaskSuccess = results[0].status === 'fulfilled';
    
    if (mainTaskSuccess) {
      console.log(`✅ Password update completed for device: ${deviceId}`);
      return { success: true };
    } else {
      console.error(`❌ Password update failed for device: ${deviceId}: ${results[0].reason?.message || 'Unknown error'}`);
      return { success: false, message: 'Gagal update password' };
    }
    
  } catch (error) {
    console.error('Error in updatePasswordOptimized:', error);
    return { success: false, message: error.message };
  }
}

// Endpoint edit tag (nomor pelanggan)
router.post('/genieacs/edit-tag', adminAuth, async (req, res) => {
  try {
    const { id, tag } = req.body;
    if (!id || typeof tag === 'undefined') {
      return res.status(400).json({ success: false, message: 'ID dan tag wajib diisi' });
    }
    const { getSetting } = require('../config/settingsManager');
    const genieacsUrl = getSetting('genieacs_url', 'http://localhost:7557');
    const genieacsUsername = getSetting('genieacs_username', 'admin');
    const genieacsPassword = getSetting('genieacs_password', 'password');
    // 1. Ambil tag lama perangkat
    let oldTags = [];
    try {
      const deviceResp = await axios.get(`${genieacsUrl}/devices/${encodeURIComponent(id)}`, {
        auth: { username: genieacsUsername, password: genieacsPassword }
      });
      oldTags = deviceResp.data._tags || deviceResp.data.Tags || [];
      if (typeof oldTags === 'string') oldTags = [oldTags];
    } catch (e) {
      oldTags = [];
    }
    // 2. Hapus semua tag lama (tanpa kecuali)
    for (const oldTag of oldTags) {
      if (oldTag) {
        try {
          await axios.delete(`${genieacsUrl}/devices/${encodeURIComponent(id)}/tags/${encodeURIComponent(oldTag)}`, {
            auth: { username: genieacsUsername, password: genieacsPassword }
          });
        } catch (e) {
          // lanjutkan saja
        }
      }
    }
    // 3. Tambahkan tag baru
    await axios.post(`${genieacsUrl}/devices/${encodeURIComponent(id)}/tags/${encodeURIComponent(tag)}`, {}, {
      auth: { username: genieacsUsername, password: genieacsPassword }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal update tag' });
  }
});

// Endpoint restart ONU
router.post('/genieacs/restart-onu', adminAuth, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Device ID wajib diisi' });
    }

    const { getSetting } = require('../config/settingsManager');
    const genieacsUrl = getSetting('genieacs_url', 'http://localhost:7557');
    const genieacsUsername = getSetting('genieacs_username', 'admin');
    const genieacsPassword = getSetting('genieacs_password', 'password');

    // Kirim perintah restart ke GenieACS menggunakan endpoint yang benar
    const taskData = {
      name: 'reboot'
    };

    // Pastikan device ID di-encode dengan benar untuk menghindari masalah karakter khusus
    const encodedDeviceId = encodeURIComponent(id);
    console.log(`🔧 Admin restart - Device ID: ${id}`);
    console.log(`🔧 Admin restart - Encoded Device ID: ${encodedDeviceId}`);

    await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks?connection_request`, taskData, {
      auth: { username: genieacsUsername, password: genieacsPassword },
      headers: { 'Content-Type': 'application/json' }
    });

    res.json({ success: true, message: 'Perintah restart berhasil dikirim' });
  } catch (err) {
    console.error('Error restart:', err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengirim perintah restart: ' + (err.response?.data?.message || err.message)
    });
  }
});

// API endpoint untuk statistik GenieACS (untuk mapping page)
router.get('/api/statistics', adminAuth, async (req, res) => {
  try {
    // ENHANCEMENT: Gunakan cached version untuk performa lebih baik
    const { getDevicesCached } = require('../config/genieacs');
    const devices = await getDevicesCached();
    
    // Hitung statistik seperti di dashboard
    const totalDevices = devices.length;
    const now = Date.now();
    const onlineDevices = devices.filter(dev => dev._lastInform && (now - new Date(dev._lastInform).getTime()) < 3600*1000).length;
    const offlineDevices = totalDevices - onlineDevices;
    
    res.json({
      success: true,
      data: {
        totalDevices,
        onlineDevices,
        offlineDevices,
        lastUpdated: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error getting GenieACS statistics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API endpoint untuk mapping - devices dengan koordinat customer dan data kabel dari database
router.get('/api/mapping/devices', adminAuth, async (req, res) => {
  try {
    const billingManager = require('../config/billing');
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const dbPath = path.join(__dirname, '../data/billing.db');
    const { pppoe, phone } = req.query;
    
    console.log('🔍 Starting mapping devices API with database integration...');
    
    // Jika ada parameter query, filter devices berdasarkan kriteria
    if (pppoe || phone) {
      let customer = null;
      
      // Cari customer berdasarkan parameter
      if (pppoe) {
        customer = await billingManager.getCustomerByPPPoE(pppoe);
      } else if (phone) {
        customer = await billingManager.getCustomerByPhone(phone);
      }
      
      if (!customer) {
        return res.json({
          success: true,
          data: {
            devicesWithCoords: [],
            devicesWithoutCoords: [],
            cableRoutes: [],
            odps: [],
            statistics: {
              totalDevices: 0,
              onlineDevices: 0,
              offlineDevices: 0
            },
            coordinateSources: {
              pppoe_username: 0,
              device_tag: 0,
              serial_number: 0
            }
          }
        });
      }
      
      // Cari device berdasarkan customer yang ditemukan
      // ENHANCEMENT: Gunakan cached version jika tersedia
      const { getDevicesCached } = require('../config/genieacs');
      const devicesRaw = await getDevicesCached();
      const devicesWithCoords = [];
      const devicesWithoutCoords = [];
      
      for (const device of devicesRaw) {
        let deviceCustomer = null;
        let coordinateSource = 'none';
        
        // 1. Coba cari berdasarkan PPPoE username
        const pppoeUsername = getParameterWithPaths(device, parameterPaths.pppUsername);
        if (pppoeUsername && pppoeUsername !== '-' && pppoeUsername === customer.pppoe_username) {
          deviceCustomer = customer;
          coordinateSource = 'pppoe_username';
        }
        
        // 2. Coba cari berdasarkan device tag (phone number)
        if (!deviceCustomer && customer.phone) {
          const deviceTags = getParameterWithPaths(device, parameterPaths.deviceTags);
          if (deviceTags && deviceTags !== '-') {
            // Split tags dan cari customer berdasarkan phone number
            const tags = deviceTags.split(',').map(tag => tag.trim());
            for (const tag of tags) {
              if (tag && tag !== '-' && tag === customer.phone) {
                deviceCustomer = customer;
                coordinateSource = 'device_tag';
                break;
              }
            }
          }
        }
        
        // 3. Coba cari berdasarkan serial number
        if (!deviceCustomer) {
          const serialNumber = getParameterWithPaths(device, parameterPaths.serialNumber);
          if (serialNumber && serialNumber !== '-') {
            try {
              const customerBySerial = await billingManager.getCustomerBySerialNumber(serialNumber);
              if (customerBySerial && customerBySerial.id === customer.id) {
                deviceCustomer = customer;
                coordinateSource = 'serial_number';
              }
            } catch (error) {
              console.log(`Error finding customer by serial: ${error.message}`);
            }
          }
        }
        
        if (deviceCustomer) {
          const deviceWithCoords = {
            id: device._id,
            serialNumber: getParameterWithPaths(device, parameterPaths.serialNumber) || 'N/A',
            model: getParameterWithPaths(device, parameterPaths.model) || 'N/A',
            status: getDeviceStatus(device._lastInform),
            ssid: getParameterWithPaths(device, parameterPaths.ssid) || 'N/A',
            password: getParameterWithPaths(device, parameterPaths.password) || 'N/A',
            rxPower: getParameterWithPaths(device, parameterPaths.rxPower) || 'N/A',
            pppoeUsername: getParameterWithPaths(device, parameterPaths.pppUsername) || 'N/A',
            userConnected: getParameterWithPaths(device, parameterPaths.userConnected) || 'N/A',
            customerId: deviceCustomer.id,
            customerName: deviceCustomer.name,
            customerPhone: deviceCustomer.phone,
            latitude: deviceCustomer.latitude,
            longitude: deviceCustomer.longitude,
            coordinateSource: coordinateSource,
            lastInform: device._lastInform || 'N/A',
            tag: getParameterWithPaths(device, parameterPaths.deviceTags) || 'N/A',
            // Explicit 2.4G/5G breakdown like technician
            ssid24: (device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.SSID?._value)
              || (device?.VirtualParameters?.SSID) || 'N/A',
            password24: (device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.KeyPassphrase?._value) || 'N/A',
            pppoeIP: (device?.InternetGatewayDevice?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANPPPConnection?.['1']?.ExternalIPAddress?._value)
              || getParameterWithPaths(device, ['VirtualParameters.pppoeIP']) || 'N/A',
            uptime: (device?.InternetGatewayDevice?.DeviceInfo?.UpTime?._value)
              || (device?.InternetGatewayDevice?.DeviceInfo?.['1']?.UpTime?._value)
              || 'N/A',
            ssid5g: (device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['5']?.SSID?._value) || 'N/A',
            password5g: (device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['5']?.KeyPassphrase?._value) || 'N/A'
          };
          
          if (deviceCustomer.latitude && deviceCustomer.longitude) {
            devicesWithCoords.push(deviceWithCoords);
          } else {
            devicesWithoutCoords.push(deviceWithCoords);
          }
        }
      }
      
      return res.json({
        success: true,
        data: {
          devicesWithCoords,
          devicesWithoutCoords,
          statistics: {
            totalDevices: devicesWithCoords.length + devicesWithoutCoords.length,
            onlineDevices: devicesWithCoords.filter(d => d.status === 'Online').length,
            offlineDevices: devicesWithCoords.filter(d => d.status === 'Offline').length
          },
          coordinateSources: {
            pppoe_username: devicesWithCoords.filter(d => d.coordinateSource === 'pppoe_username').length,
            device_tag: devicesWithCoords.filter(d => d.coordinateSource === 'device_tag').length,
            serial_number: devicesWithCoords.filter(d => d.coordinateSource === 'serial_number').length
          }
        }
      });
    }
    
    // Jika tidak ada parameter query, return semua devices (existing logic)
    // ENHANCEMENT: Gunakan cached version untuk performa lebih baik
    const { getDevicesCached } = require('../config/genieacs');
    const devicesRaw = await getDevicesCached();
    
    // Mapping data dengan koordinat customer
    const devicesWithCoords = await Promise.all(devicesRaw.map(async (device) => {
      // Cari customer berdasarkan PPPoE username atau tag
      let customer = null;
      let coordinateSource = 'none';
      
      // 1. Coba cari berdasarkan PPPoE username
      const pppoeUsername = getParameterWithPaths(device, parameterPaths.pppUsername);
      if (pppoeUsername && pppoeUsername !== '-') {
        customer = await billingManager.getCustomerByPPPoE(pppoeUsername);
        if (customer) coordinateSource = 'pppoe_username';
      }
      
      // 2. Coba cari berdasarkan device tag (phone number)
      if (!customer) {
        const deviceTags = getParameterWithPaths(device, parameterPaths.deviceTags);
        if (deviceTags) {
          // Split tags dan cari customer berdasarkan phone number
          const tags = deviceTags.split(',').map(tag => tag.trim());
          for (const tag of tags) {
            if (tag && tag !== '-') {
              customer = await billingManager.getCustomerByPhone(tag);
              if (customer) {
                coordinateSource = 'device_tag';
                break;
              }
            }
          }
        }
      }
      
      // 3. Coba cari berdasarkan serial number
      if (!customer) {
        const serialNumber = getParameterWithPaths(device, parameterPaths.serialNumber);
        if (serialNumber && serialNumber !== '-') {
          customer = await billingManager.getCustomerBySerialNumber(serialNumber);
          if (customer) coordinateSource = 'serial_number';
        }
      }
      
      if (customer && customer.latitude && customer.longitude) {
        return {
          id: device._id,
          serialNumber: getParameterWithPaths(device, parameterPaths.serialNumber) || 'N/A',
          model: getParameterWithPaths(device, parameterPaths.model) || 'N/A',
          status: getDeviceStatus(device._lastInform),
          ssid: getParameterWithPaths(device, parameterPaths.ssid) || 'N/A',
          password: getParameterWithPaths(device, parameterPaths.password) || 'N/A',
          rxPower: getParameterWithPaths(device, parameterPaths.rxPower) || 'N/A',
          pppoeUsername: getParameterWithPaths(device, parameterPaths.pppUsername) || 'N/A',
          userConnected: getParameterWithPaths(device, parameterPaths.userConnected) || 'N/A',
          customerId: customer.id,
          customerName: customer.name,
          customerPhone: customer.phone,
          latitude: customer.latitude,
          longitude: customer.longitude,
          coordinateSource: coordinateSource,
          lastInform: device._lastInform || 'N/A',
          tag: getParameterWithPaths(device, parameterPaths.deviceTags) || 'N/A',
          ssid24: (device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.SSID?._value)
            || (device?.VirtualParameters?.SSID) || 'N/A',
          password24: (device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.KeyPassphrase?._value) || 'N/A',
          pppoeIP: (device?.InternetGatewayDevice?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANPPPConnection?.['1']?.ExternalIPAddress?._value)
            || getParameterWithPaths(device, ['VirtualParameters.pppoeIP']) || 'N/A',
          uptime: (device?.InternetGatewayDevice?.DeviceInfo?.UpTime?._value)
            || (device?.InternetGatewayDevice?.DeviceInfo?.['1']?.UpTime?._value)
            || 'N/A',
          ssid5g: (device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['5']?.SSID?._value) || 'N/A',
          password5g: (device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['5']?.KeyPassphrase?._value) || 'N/A'
        };
      }
      return null;
    }));
    
    // Filter devices yang punya koordinat
    const validDevicesWithCoords = devicesWithCoords.filter(device => device !== null);
    const devicesWithoutCoords = devicesRaw.length - validDevicesWithCoords.length;
    
    // Hitung statistik
    const totalDevices = devicesRaw.length;
    const onlineDevices = validDevicesWithCoords.filter(device => device.status === 'Online').length;
    const offlineDevices = validDevicesWithCoords.filter(device => device.status === 'Offline').length;
    
    // Hitung sumber koordinat
    const coordinateSources = {
      pppoe_username: validDevicesWithCoords.filter(device => device.coordinateSource === 'pppoe_username').length,
      device_tag: validDevicesWithCoords.filter(device => device.coordinateSource === 'device_tag').length,
      serial_number: validDevicesWithCoords.filter(device => device.coordinateSource === 'serial_number').length
    };
    
    // Ambil data lengkap dari database untuk mapping
    let odpConnections = [];
    let cableRoutes = [];
    let odps = [];
    
    try {
      console.log('🔍 Fetching complete mapping data from database...');
      const db = new sqlite3.Database(dbPath);
      
      // Ambil data ODP
      odps = await new Promise((resolve, reject) => {
        db.all(`
          SELECT o.*, 
                 COUNT(cr.id) as connected_customers,
                 COUNT(CASE WHEN cr.status = 'connected' THEN 1 END) as active_connections
          FROM odps o
          LEFT JOIN cable_routes cr ON o.id = cr.odp_id
          GROUP BY o.id
          ORDER BY o.name
        `, [], (err, rows) => {
          if (err) {
            console.error('❌ Database error getting ODPs:', err);
            reject(err);
          } else {
            console.log(`✅ Found ${rows ? rows.length : 0} ODPs`);
            resolve(rows || []);
          }
        });
      });
      
      // Ambil data cable routes dengan detail customer dan ODP
      cableRoutes = await new Promise((resolve, reject) => {
        db.all(`
          SELECT cr.*, 
                 c.name as customer_name, c.phone as customer_phone,
                 c.latitude as customer_latitude, c.longitude as customer_longitude,
                 o.name as odp_name, o.latitude as odp_latitude, o.longitude as odp_longitude
          FROM cable_routes cr
          JOIN customers c ON cr.customer_id = c.id
          JOIN odps o ON cr.odp_id = o.id
          WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        `, [], (err, rows) => {
          if (err) {
            console.error('❌ Database error getting cable routes:', err);
            reject(err);
          } else {
            console.log(`✅ Found ${rows ? rows.length : 0} cable routes`);
            resolve(rows || []);
          }
        });
      });
      
      // Ambil data ODP connections untuk backbone visualization
      odpConnections = await new Promise((resolve, reject) => {
        db.all(`
          SELECT oc.*, 
                 from_odp.name as from_odp_name, from_odp.code as from_odp_code,
                 from_odp.latitude as from_odp_latitude, from_odp.longitude as from_odp_longitude,
                 to_odp.name as to_odp_name, to_odp.code as to_odp_code,
                 to_odp.latitude as to_odp_latitude, to_odp.longitude as to_odp_longitude
          FROM odp_connections oc
          JOIN odps from_odp ON oc.from_odp_id = from_odp.id
          JOIN odps to_odp ON oc.to_odp_id = to_odp.id
          WHERE oc.status = 'active'
          ORDER BY oc.created_at DESC
        `, [], (err, rows) => {
          if (err) {
            console.error('❌ Database error getting ODP connections:', err);
            reject(err);
          } else {
            console.log(`✅ Found ${rows ? rows.length : 0} ODP connections`);
            resolve(rows || []);
          }
        });
      });
      
      db.close();
    } catch (error) {
      console.error('❌ Error getting database mapping data:', error.message);
    }

    // Ambil data customers untuk response lengkap
    const customers = await new Promise((resolve, reject) => {
      const customerDb = new sqlite3.Database(dbPath);
      customerDb.all(`
        SELECT id, name, phone, pppoe_username, latitude, longitude, status, 
               address, package_name, created_at
        FROM customers 
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        ORDER BY name
      `, [], (err, rows) => {
        if (err) {
          console.error('❌ Database error getting customers:', err);
          resolve([]);
        } else {
          console.log(`✅ Found ${rows ? rows.length : 0} customers with coordinates`);
          resolve(rows || []);
        }
        customerDb.close();
      });
    });

    console.log(`📊 API Response - Customers: ${customers.length}, Devices: ${validDevicesWithCoords.length}, ODPs: ${odps.length}, Cable Routes: ${cableRoutes.length}, ODP Connections: ${odpConnections.length}`);
    
    res.json({
      success: true,
      data: {
        customers: customers,
        devicesWithCoords: validDevicesWithCoords,
        devicesWithoutCoords: devicesWithoutCoords,
        odps: odps,
        cableRoutes: cableRoutes,
        odpConnections: odpConnections,
        statistics: {
          totalDevices,
          onlineDevices,
          offlineDevices,
          totalCustomers: customers.length,
          totalODPs: odps.length,
          totalCableRoutes: cableRoutes.length,
          connectedCables: cableRoutes.filter(c => c.status === 'connected').length,
          disconnectedCables: cableRoutes.filter(c => c.status === 'disconnected').length
        },
        coordinateSources
      }
    });
    
  } catch (error) {
    console.error('Error in mapping devices API:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API endpoint untuk update device coordinates berdasarkan customer
router.put('/api/mapping/devices/:deviceId/coordinates', adminAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { customerId, latitude, longitude } = req.body;
    
    if (!customerId || !latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID, latitude, dan longitude wajib diisi'
      });
    }
    
    const billingManager = require('../config/billing');
    
    // Update koordinat customer
    const result = await billingManager.updateCustomerCoordinates(parseInt(customerId), {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude)
    });
    
    if (result) {
      res.json({
        success: true,
        message: 'Koordinat device berhasil diperbarui',
        data: {
          deviceId,
          customerId: parseInt(customerId),
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude)
        }
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Customer tidak ditemukan'
      });
    }
    
  } catch (error) {
    console.error('Error updating device coordinates:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memperbarui koordinat device'
    });
  }
});

// API endpoint untuk bulk update device coordinates
router.post('/api/mapping/devices/bulk-coordinates', adminAuth, async (req, res) => {
  try {
    const { deviceCoordinates } = req.body;
    
    if (!deviceCoordinates || !Array.isArray(deviceCoordinates)) {
      return res.status(400).json({
        success: false,
        message: 'Data device coordinates harus berupa array'
      });
    }
    
    const billingManager = require('../config/billing');
    const results = [];
    let successCount = 0;
    let errorCount = 0;
    
    for (const coord of deviceCoordinates) {
      try {
        const { deviceId, customerId, latitude, longitude } = coord;
        
        if (!deviceId || !customerId || !latitude || !longitude) {
          results.push({
            deviceId,
            customerId,
            success: false,
            message: 'Data tidak lengkap'
          });
          errorCount++;
          continue;
        }
        
        // Update koordinat customer
        const result = await billingManager.updateCustomerCoordinates(parseInt(customerId), {
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude)
        });
        
        if (result) {
          results.push({
            deviceId,
            customerId,
            success: true,
            message: 'Koordinat berhasil diperbarui',
            data: {
              latitude: parseFloat(latitude),
              longitude: parseFloat(longitude)
            }
          });
          successCount++;
        } else {
          results.push({
            deviceId,
            customerId,
            success: false,
            message: 'Customer tidak ditemukan'
          });
          errorCount++;
        }
      } catch (error) {
        results.push({
          deviceId: coord.deviceId,
          customerId: coord.customerId,
          success: false,
          message: error.message
        });
        errorCount++;
      }
    }
    
    res.json({
      success: true,
      message: `Bulk update selesai. ${successCount} berhasil, ${errorCount} gagal`,
      data: {
        total: deviceCoordinates.length,
        success: successCount,
        error: errorCount,
        results
      }
    });
    
  } catch (error) {
    console.error('Error bulk updating device coordinates:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal melakukan bulk update koordinat device'
    });
  }
});

// ===== ENHANCEMENT: CACHE MONITORING API =====

// API endpoint untuk monitoring cache performance
router.get('/api/cache-stats', adminAuth, async (req, res) => {
  try {
    const { getCacheStats } = require('../config/genieacs');
    const stats = getCacheStats();
    
    res.json({
      success: true,
      data: {
        cache: stats,
        timestamp: new Date().toISOString(),
        performance: {
          memoryUsage: process.memoryUsage(),
          uptime: process.uptime()
        }
      }
    });
  } catch (error) {
    console.error('Error getting cache stats:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil statistik cache'
    });
  }
});

// API endpoint untuk clear cache
router.post('/api/cache-clear', adminAuth, async (req, res) => {
  try {
    const { clearDeviceCache, clearAllCache } = require('../config/genieacs');
    const { deviceId, clearAll = false } = req.body;
    
    console.log('Cache clear request:', { deviceId, clearAll });
    
    if (clearAll) {
      clearAllCache();
      res.json({
        success: true,
        message: 'All cache cleared successfully'
      });
    } else if (deviceId) {
      clearDeviceCache(deviceId);
      res.json({
        success: true,
        message: `Cache cleared for device ${deviceId}`
      });
    } else {
      // Default: clear all GenieACS devices cache
      clearDeviceCache();
      res.json({
        success: true,
        message: 'GenieACS devices cache cleared'
      });
    }
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({
      success: false,
      message: `Gagal clear cache: ${error.message}`,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
