const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { findDeviceByTag } = require('../config/addWAN');
const { findDeviceByPPPoE } = require('../config/genieacs');
const { sendMessage } = require('../config/sendMessage');
const { getSettingsWithCache, getSetting } = require('../config/settingsManager');
const billingManager = require('../config/billing');
const router = express.Router();

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

// Validasi nomor pelanggan - PRIORITAS KE BILLING SYSTEM
async function isValidCustomer(phone) {
  try {
    // 1. Cek di database billing terlebih dahulu (coba semua varian)
    const variants = generatePhoneVariants(phone);
    console.log(`🔍 [VALIDATION] Checking customer with phone variants:`, variants);
    
    for (const v of variants) {
      try {
        const customer = await billingManager.getCustomerByPhone(v);
        if (customer) {
          console.log(`✅ [VALIDATION] Customer found in billing database: ${v} (input: ${phone})`);
          return true; // Pelanggan valid jika ada di billing
        }
      } catch (error) {
        console.log(`⚠️ [VALIDATION] Error checking variant ${v}:`, error.message);
      }
    }
    
    // 2. Jika tidak ada di billing, cek di GenieACS sebagai fallback dengan semua varian
    let device = null;
    for (const v of variants) {
      try {
        device = await findDeviceByTag(v);
        if (device) {
          console.log(`✅ [VALIDATION] Device found in GenieACS with tag: ${v}`);
          break;
        }
      } catch (error) {
        console.log(`⚠️ [VALIDATION] Error searching GenieACS with tag ${v}:`, error.message);
      }
    }
    
    // Jika tidak ditemukan di GenieACS, coba cari berdasarkan PPPoE username dari billing
    if (!device) {
      try {
        // Coba lagi dengan semua varian phone untuk PPPoE search
        for (const v of variants) {
          const customer = await billingManager.getCustomerByPhone(v);
          if (customer && customer.pppoe_username) {
            const { findDeviceByPPPoE } = require('../config/genieacs');
            device = await findDeviceByPPPoE(customer.pppoe_username);
            if (device) {
              console.log(`✅ [VALIDATION] Device found by PPPoE username: ${customer.pppoe_username} (phone: ${v})`);
              break;
            }
          }
        }
      } catch (error) {
        console.error('❌ [VALIDATION] Error finding device by PPPoE username:', error);
      }
    }
    
    if (device) {
      console.log(`✅ [VALIDATION] Customer found in GenieACS: ${phone}`);
      return true;
    }
    
    console.log(`❌ [VALIDATION] Customer not found in billing or GenieACS: ${phone}`);
    return false;
    
  } catch (error) {
    console.error('❌ [VALIDATION] Error in isValidCustomer:', error);
    return false;
  }
}

// Simpan OTP sementara di memory (bisa diganti redis/db)
const otpStore = {};

// parameterPaths dan getParameterWithPaths dari WhatsApp bot
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
  pppUsername: [
    'VirtualParameters.pppoeUsername',
    'VirtualParameters.pppUsername',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username'
  ],
  uptime: [
    'VirtualParameters.getdeviceuptime',
    'InternetGatewayDevice.DeviceInfo.UpTime'
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
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return 'N/A';
}

// Helper: Ambil info perangkat dan user terhubung - PRIORITAS KE BILLING SYSTEM
async function getCustomerDeviceData(phone) {
  try {
    // 1. Ambil data customer dari billing terlebih dahulu (coba semua varian phone)
    let customer = null;
    const phoneVariants = generatePhoneVariants(phone);
    
    console.log(`🔍 [SEARCH] Searching customer with phone variants:`, phoneVariants);
    
    for (const variant of phoneVariants) {
      try {
        customer = await billingManager.getCustomerByPhone(variant);
        if (customer) {
          console.log(`✅ [SEARCH] Customer found in billing with variant: ${variant}`);
          console.log(`📋 [SEARCH] Customer data:`, {
            name: customer.name,
            phone: customer.phone,
            username: customer.username,
            pppoe_username: customer.pppoe_username,
            package_id: customer.package_id
          });
          break;
        }
      } catch (error) {
        console.log(`⚠️ [SEARCH] Error searching with variant ${variant}:`, error.message);
      }
    }
    
    let device = null;
    let billingData = null;
    
    if (customer) {
      console.log(`✅ Customer found in billing: ${customer.name} (${customer.phone}) - searched with: ${phone}`);
      
      // 2. CUSTOMER BILLING: Cari device berdasarkan PPPoE username (FAST PATH)
      if (customer.pppoe_username || customer.username) {
        try {
          const { findDeviceByPPPoE, testPPPoEUsernameSearch } = require('../config/genieacs');
          const pppoeToSearch = customer.pppoe_username || customer.username;
          console.log(`🔍 [BILLING] Searching device by PPPoE username: ${pppoeToSearch}`);
          console.log(`📋 [BILLING] Customer data:`, {
            name: customer.name,
            phone: customer.phone,
            username: customer.username,
            pppoe_username: customer.pppoe_username,
            package_id: customer.package_id
          });
          
          // Debug: cek apakah username yang dicari benar
          console.log(`🔍 [BILLING] Will search for username: "${pppoeToSearch}"`);
          console.log(`🔍 [BILLING] Customer.pppoe_username: "${customer.pppoe_username}"`);
          console.log(`🔍 [BILLING] Customer.username: "${customer.username}"`);
          
          // Test langsung untuk username server@ilik jika ini customer yang dimaksud
          if (pppoeToSearch === 'server@ilik' || customer.pppoe_username === 'server@ilik' || customer.username === 'server@ilik') {
            console.log(`🧪 [TEST] Testing direct search for server@ilik...`);
            try {
              const testResult = await testPPPoEUsernameSearch('server@ilik');
              if (testResult) {
                console.log(`✅ [TEST] Direct test successful for server@ilik`);
                device = testResult;
              } else {
                console.log(`❌ [TEST] Direct test failed for server@ilik`);
              }
            } catch (testError) {
              console.error('❌ [TEST] Direct test error:', testError.message);
            }
          }
          
          // Jika test tidak berhasil, coba search normal
          if (!device) {
            device = await findDeviceByPPPoE(pppoeToSearch);
            if (device) {
              console.log(`✅ [BILLING] Device found by PPPoE username: ${pppoeToSearch}`);
              console.log(`📱 [BILLING] Device details:`, {
                id: device._id,
                serialNumber: device.DeviceID?.SerialNumber,
                model: device.DeviceID?.ProductClass,
                lastInform: device._lastInform
              });
            } else {
              console.log(`⚠️ [BILLING] No device found by PPPoE username: ${pppoeToSearch}`);
            }
          }
        } catch (error) {
          console.error('❌ [BILLING] Error finding device by PPPoE username:', error.message);
          console.error('❌ [BILLING] Full error:', error);
        }
      } else {
        console.log(`⚠️ [BILLING] No PPPoE username or username found in customer data`);
        console.log(`📋 [BILLING] Customer fields:`, Object.keys(customer));
        console.log(`📋 [BILLING] Customer.pppoe_username: "${customer.pppoe_username}"`);
        console.log(`📋 [BILLING] Customer.username: "${customer.username}"`);
      }
      
      // 3. Jika tidak ditemukan dengan PPPoE, coba dengan tag sebagai fallback
      if (!device) {
        console.log(`🔍 [BILLING] Trying tag search as fallback...`);
        const tagVariants = generatePhoneVariants(phone);
        
        for (const v of tagVariants) {
          try {
            device = await findDeviceByTag(v);
            if (device) {
              console.log(`✅ [BILLING] Device found by tag fallback: ${v}`);
              break;
            }
          } catch (error) {
            console.log(`⚠️ Error searching by tag ${v}:`, error.message);
          }
        }
      }
      
      // 4. Siapkan data billing
      try {
        const invoices = await billingManager.getInvoicesByCustomer(customer.id);
        billingData = {
          customer: customer,
          invoices: invoices || []
        };
      } catch (error) {
        console.error('Error getting billing data:', error);
        billingData = {
          customer: customer,
          invoices: []
        };
      }
      
    } else {
      // 5. CUSTOMER NON-BILLING: Cari device berdasarkan tag saja (FAST PATH)
      console.log(`⚠️ Customer not found in billing, searching GenieACS by tag only`);
      
      const tagVariants = generatePhoneVariants(phone);
      for (const v of tagVariants) {
        try {
          device = await findDeviceByTag(v);
          if (device) {
            console.log(`✅ [NON-BILLING] Device found by tag: ${v}`);
            break;
          }
        } catch (error) {
          console.log(`⚠️ Error searching by tag ${v}:`, error.message);
        }
      }
    }
    
    // 6. Jika tidak ada device di GenieACS, buat data default yang informatif
    if (!device) {
      console.log(`⚠️ No device found in GenieACS for: ${phone}`);
      
      const defaultData = {
        phone: phone,
        ssid: customer ? `WiFi-${customer.username}` : 'WiFi-Default',
        status: 'Unknown',
        lastInform: '-',
        softwareVersion: '-',
        rxPower: '-',
        pppoeIP: '-',
        pppoeUsername: customer ? (customer.pppoe_username || customer.username) : '-',
        totalAssociations: '0',
        connectedUsers: [],
        billingData: billingData,
        deviceFound: false,
        searchMethod: customer ? 'pppoe_username_fallback_tag' : 'tag_only',
        message: customer ? 
          'Device ONU tidak ditemukan di GenieACS. Silakan hubungi teknisi untuk setup device.' :
          'Customer tidak terdaftar di sistem billing. Silakan hubungi admin.'
      };
      
      return defaultData;
    }
    
    // 7. Jika ada device di GenieACS, ambil data lengkap
    console.log(`✅ Processing device data for: ${device._id}`);
    
    const ssid = device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.SSID?._value || 
                 device?.VirtualParameters?.SSID || 
                 (customer ? `WiFi-${customer.username}` : 'WiFi-Default');
    
    const lastInform = device?._lastInform
      ? new Date(device._lastInform).toLocaleString('id-ID')
      : device?.Events?.Inform
        ? new Date(device.Events.Inform).toLocaleString('id-ID')
        : device?.InternetGatewayDevice?.DeviceInfo?.['1']?.LastInform?._value
          ? new Date(device.InternetGatewayDevice.DeviceInfo['1'].LastInform._value).toLocaleString('id-ID')
          : '-';
    
    const status = lastInform !== '-' ? 'Online' : 'Unknown';
    
    // User terhubung (WiFi)
    let connectedUsers = [];
    try {
      const totalAssociations = getParameterWithPaths(device, parameterPaths.userConnected);
      if (totalAssociations && totalAssociations !== 'N/A' && totalAssociations > 0) {
        connectedUsers = Array.from({ length: parseInt(totalAssociations) }, (_, i) => ({
          id: i + 1,
          name: `User ${i + 1}`,
          ip: `192.168.1.${100 + i}`,
          mac: `00:00:00:00:00:${(i + 1).toString().padStart(2, '0')}`,
          connectedTime: 'Unknown'
        }));
      }
    } catch (error) {
      console.error('Error getting connected users:', error);
    }
    
    // Ambil data lengkap device
    const deviceData = {
      phone: phone,
      ssid: ssid,
      status: status,
      lastInform: lastInform,
      softwareVersion: device?.InternetGatewayDevice?.DeviceInfo?.SoftwareVersion?._value || 
                     device?.VirtualParameters?.softwareVersion || '-',
      rxPower: getParameterWithPaths(device, parameterPaths.rxPower),
      pppoeIP: device?.InternetGatewayDevice?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANPPPConnection?.['1']?.ExternalIPAddress?._value || 
               device?.VirtualParameters?.pppoeIP || '-',
      pppoeUsername: customer ? (customer.pppoe_username || customer.username) : 
                     getParameterWithPaths(device, parameterPaths.pppUsername),
      totalAssociations: getParameterWithPaths(device, parameterPaths.userConnected) || '0',
      connectedUsers: connectedUsers,
      billingData: billingData,
      deviceFound: true,
      deviceId: device._id,
      serialNumber: device.DeviceID?.SerialNumber || device._id,
      model: device.DeviceID?.ProductClass || 
             device.InternetGatewayDevice?.DeviceInfo?.ModelName?._value || '-',
      uptime: device?.InternetGatewayDevice?.DeviceInfo?.UpTime?._value || '-',
      searchMethod: customer ? 'pppoe_username' : 'tag',
      message: 'Device ONU ditemukan dan berfungsi normal'
    };
    
    return deviceData;
    
  } catch (error) {
    console.error('Error in getCustomerDeviceData:', error);
    
    // Return error data yang informatif
    return {
      phone: phone,
      ssid: 'Error',
      status: 'Error',
      lastInform: '-',
      softwareVersion: '-',
      rxPower: '-',
      pppoeIP: '-',
      pppoeUsername: '-',
      totalAssociations: '0',
      connectedUsers: [],
      billingData: null,
      deviceFound: false,
      error: error.message,
      message: 'Terjadi kesalahan saat mengambil data device. Silakan coba lagi atau hubungi teknisi.'
    };
  }
}

// Helper: Update SSID (real ke GenieACS) - Legacy
async function updateSSID(phone, newSSID) {
  try {
    // Cari device berdasarkan nomor telepon (tag)
    let device = await findDeviceByTag(phone);
    
    // Jika tidak ditemukan, coba cari berdasarkan PPPoE username dari billing
    if (!device) {
      try {
        const customer = await billingManager.getCustomerByPhone(phone);
        if (customer && customer.pppoe_username) {
          const { findDeviceByPPPoE } = require('../config/genieacs');
          device = await findDeviceByPPPoE(customer.pppoe_username);
        }
      } catch (error) {
        console.error('Error finding device by PPPoE username:', error);
      }
    }
    
    if (!device) return false;
    const deviceId = device._id;
    const encodedDeviceId = encodeURIComponent(deviceId);
    const settings = getSettingsWithCache();
    const genieacsUrl = settings.genieacs_url || 'http://localhost:7557';
    const username = settings.genieacs_username || '';
    const password = settings.genieacs_password || '';
    // Update SSID 2.4GHz
    await axios.post(
      `${genieacsUrl}/devices/${encodedDeviceId}/tasks?connection_request`,
      {
        name: "setParameterValues",
        parameterValues: [
          ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
        ]
      },
      { auth: { username, password } }
    );
    // Update SSID 5GHz (index 5-8, ambil yang berhasil saja)
    const newSSID5G = `${newSSID}-5G`;
    const ssid5gIndexes = [5, 6, 7, 8];
    for (const idx of ssid5gIndexes) {
      try {
        await axios.post(
          `${genieacsUrl}/devices/${encodedDeviceId}/tasks?connection_request`,
          {
            name: "setParameterValues",
            parameterValues: [
              [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`, newSSID5G, "xsd:string"]
            ]
          },
          { auth: { username, password } }
        );
        break;
      } catch (e) {}
    }
    // Hanya refresh, tidak perlu reboot
    await axios.post(
      `${genieacsUrl}/devices/${encodedDeviceId}/tasks?connection_request`,
      { name: "refreshObject", objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration" },
      { auth: { username, password } }
    );
    return true;
  } catch (e) {
    return false;
  }
}

// Helper: Update SSID Optimized (seperti WhatsApp command) - Fast Response
async function updateSSIDOptimized(phone, newSSID) {
  try {
    console.log(`🔄 Optimized SSID update for phone: ${phone} to: ${newSSID}`);
    
    // Cari device berdasarkan nomor pelanggan dengan multiple format
    let device = null;
    
    // Method 1: Coba dengan format asli
    device = await findDeviceByTag(phone);
    
    // Method 2: Jika gagal, coba dengan format alternatif
    if (!device) {
      const phoneVariants = [];
      
      // Jika format internasional (62), coba format lokal (0)
      if (phone.startsWith('62')) {
        phoneVariants.push('0' + phone.substring(2));
      }
      // Jika format lokal (0), coba format internasional (62)
      else if (phone.startsWith('0')) {
        phoneVariants.push('62' + phone.substring(1));
      }
      // Jika tanpa prefix, coba kedua format
      else {
        phoneVariants.push('0' + phone);
        phoneVariants.push('62' + phone);
      }
      
      // Coba setiap variant
      for (const variant of phoneVariants) {
        console.log(`🔍 Trying phone variant: ${variant}`);
        device = await findDeviceByTag(variant);
        if (device) {
          console.log(`✅ Device found with variant: ${variant}`);
          break;
        }
      }
    }
    
    // Method 3: Jika masih gagal, coba dengan PPPoE username
    if (!device) {
      try {
        const customer = await billingManager.getCustomerByPhone(phone);
        if (customer && customer.pppoe_username) {
          const { findDeviceByPPPoE } = require('../config/genieacs');
          device = await findDeviceByPPPoE(customer.pppoe_username);
          if (device) {
            console.log(`✅ Device found by PPPoE username: ${customer.pppoe_username}`);
          }
        }
      } catch (error) {
        console.error('Error finding device by PPPoE username:', error);
      }
    }
    
    if (!device) {
      console.log(`❌ SSID update failed for ${phone}: Device tidak ditemukan`);
      return { success: false, message: 'Device tidak ditemukan' };
    }
    
    const deviceId = device._id;
    const encodedDeviceId = encodeURIComponent(deviceId);
    const settings = getSettingsWithCache();
    const genieacsUrl = settings.genieacs_url || 'http://localhost:7557';
    const username = settings.genieacs_username || '';
    const password = settings.genieacs_password || '';
    
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
      console.log(`✅ SSID update completed for ${phone}: ${newSSID}`);
      
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
      console.error(`❌ SSID update failed for ${phone}: ${results[0].reason?.message || 'Unknown error'}`);
      return { success: false, message: 'Gagal update SSID' };
    }
    
  } catch (error) {
    console.error('Error in updateSSIDOptimized:', error);
    return { success: false, message: error.message };
  }
}
// Helper: Add admin number and company info to customer data
function addAdminNumber(customerData) {
  const adminNumber = getSetting('admins.0', '6281947215703');
  const companyHeader = getSetting('company_header', 'ALIJAYA DIGITAL NETWORK');
  
  // Convert to display format (remove country code if present)
  const displayNumber = adminNumber.startsWith('62') ? '0' + adminNumber.slice(2) : adminNumber;
  
  if (customerData && typeof customerData === 'object') {
    customerData.adminNumber = displayNumber;
    customerData.adminNumberWA = adminNumber;
    customerData.companyHeader = companyHeader;
  }
  return customerData;
}

// Helper: Update Password (real ke GenieACS) - Legacy
async function updatePassword(phone, newPassword) {
  try {
    if (newPassword.length < 8) return false;
    
    // Cari device berdasarkan nomor telepon (tag)
    let device = await findDeviceByTag(phone);
    
    // Jika tidak ditemukan, coba cari berdasarkan PPPoE username dari billing
    if (!device) {
      try {
        const customer = await billingManager.getCustomerByPhone(phone);
        if (customer && customer.pppoe_username) {
          const { findDeviceByPPPoE } = require('../config/genieacs');
          device = await findDeviceByPPPoE(customer.pppoe_username);
        }
      } catch (error) {
        console.error('Error finding device by PPPoE username:', error);
      }
    }
    
    if (!device) return false;
    const deviceId = device._id;
    const encodedDeviceId = encodeURIComponent(deviceId);
    const settings = getSettingsWithCache();
    const genieacsUrl = settings.genieacs_url || 'http://localhost:7557';
    const username = settings.genieacs_username || '';
    const password = settings.genieacs_password || '';
    const tasksUrl = `${genieacsUrl}/devices/${encodedDeviceId}/tasks`;
    // Update password 2.4GHz
    await axios.post(`${tasksUrl}?connection_request`, {
      name: "setParameterValues",
      parameterValues: [
        ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", newPassword, "xsd:string"],
        ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
      ]
    }, { auth: { username, password } });
    // Update password 5GHz
    await axios.post(`${tasksUrl}?connection_request`, {
      name: "setParameterValues",
      parameterValues: [
        ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase", newPassword, "xsd:string"],
        ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
      ]
    }, { auth: { username, password } });
    // Refresh
    await axios.post(`${tasksUrl}?connection_request`, {
      name: "refreshObject",
      objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
    }, { auth: { username, password } });
    return true;
  } catch (e) {
    return false;
  }
}

// Helper: Update Password Optimized (seperti WhatsApp command) - Fast Response
async function updatePasswordOptimized(phone, newPassword) {
  try {
    console.log(`🔄 Optimized password update for phone: ${phone}`);
    
    // Cari device berdasarkan nomor pelanggan dengan multiple format
    let device = null;
    
    // Method 1: Coba dengan format asli
    device = await findDeviceByTag(phone);
    
    // Method 2: Jika gagal, coba dengan format alternatif
    if (!device) {
      const phoneVariants = [];
      
      // Jika format internasional (62), coba format lokal (0)
      if (phone.startsWith('62')) {
        phoneVariants.push('0' + phone.substring(2));
      }
      // Jika format lokal (0), coba format internasional (62)
      else if (phone.startsWith('0')) {
        phoneVariants.push('62' + phone.substring(1));
      }
      // Jika tanpa prefix, coba kedua format
      else {
        phoneVariants.push('0' + phone);
        phoneVariants.push('62' + phone);
      }
      
      // Coba setiap variant
      for (const variant of phoneVariants) {
        console.log(`🔍 Trying phone variant: ${variant}`);
        device = await findDeviceByTag(variant);
        if (device) {
          console.log(`✅ Device found with variant: ${variant}`);
          break;
        }
      }
    }
    
    // Method 3: Jika masih gagal, coba dengan PPPoE username
    if (!device) {
      try {
        const customer = await billingManager.getCustomerByPhone(phone);
        if (customer && customer.pppoe_username) {
          const { findDeviceByPPPoE } = require('../config/genieacs');
          device = await findDeviceByPPPoE(customer.pppoe_username);
          if (device) {
            console.log(`✅ Device found by PPPoE username: ${customer.pppoe_username}`);
          }
        }
      } catch (error) {
        console.error('Error finding device by PPPoE username:', error);
      }
    }
    
    if (!device) {
      console.log(`❌ Password update failed for ${phone}: Device tidak ditemukan`);
      return { success: false, message: 'Device tidak ditemukan' };
    }
    
    const deviceId = device._id;
    const encodedDeviceId = encodeURIComponent(deviceId);
    const settings = getSettingsWithCache();
    const genieacsUrl = settings.genieacs_url || 'http://localhost:7557';
    const username = settings.genieacs_username || '';
    const password = settings.genieacs_password || '';
    
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
      console.log(`✅ Password update completed for ${phone}`);
      return { success: true };
    } else {
      console.error(`❌ Password update failed for ${phone}: ${results[0].reason?.message || 'Unknown error'}`);
      return { success: false, message: 'Gagal update password' };
    }
    
  } catch (error) {
    console.error('Error in updatePasswordOptimized:', error);
    return { success: false, message: error.message };
  }
}

// GET: Login page
router.get('/login', (req, res) => {
  const settings = getSettingsWithCache();
  res.render('login', { settings, error: null });
});

// GET: Base customer portal - redirect appropriately
router.get('/', (req, res) => {
  const phone = req.session && req.session.phone;
  if (phone) return res.redirect('/customer/dashboard');
  return res.redirect('/customer/login');
});

// POST: Proses login - Optimized dengan AJAX support
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const settings = getSettingsWithCache();
    
    // Fast validation: terima 08..., 62..., +62...
    const valid = !!phone && (/^08[0-9]{8,13}$/.test(phone) || /^\+?62[0-9]{8,13}$/.test(phone));
    if (!valid) {
      if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.status(400).json({ success: false, message: 'Nomor HP harus valid (08..., 62..., atau +62...)' });
      } else {
        return res.render('login', { settings, error: 'Nomor HP tidak valid.' });
      }
    }

    const pass = String(password || '').trim();
    if (!pass) {
      if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.status(400).json({ success: false, message: 'Password harus diisi' });
      } else {
        return res.render('login', { settings, error: 'Password harus diisi.' });
      }
    }
    
    const normalizedPhone = normalizePhone(phone);

    const customer = await billingManager.getCustomerByPhone(normalizedPhone);
    if (!customer) {
      if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.status(401).json({ success: false, message: 'Nomor HP tidak terdaftar.' });
      } else {
        return res.render('login', { settings, error: 'Nomor HP tidak valid atau belum terdaftar.' });
      }
    }

    const expectedPassword = (customer.password && String(customer.password).trim()) ? String(customer.password).trim() : '123456';
    if (pass !== expectedPassword) {
      if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.status(401).json({ success: false, message: 'Password salah.' });
      } else {
        return res.render('login', { settings, error: 'Password salah.' });
      }
    }

    if (!customer.password || String(customer.password).trim() === '') {
      try {
        await billingManager.setCustomerPortalPasswordById(customer.id, '123456');
      } catch (_) { }
    }
    
    // Aktifkan OTP jika setting bernilai true (boolean) atau 'true' (string)
    if (settings.customerPortalOtp === true || String(settings.customerPortalOtp).toLowerCase() === 'true') {
      // Generate OTP sesuai jumlah digit di settings
      const otpLength = parseInt(settings.otp_length || '6', 10);
      const min = Math.pow(10, otpLength - 1);
      const max = Math.pow(10, otpLength) - 1;
      const otp = Math.floor(min + Math.random() * (max - min)).toString();
      const expiryMin = parseInt(settings.otp_expiry_minutes || '5', 10);
      otpStore[normalizePhone(customer.phone)] = { otp, expires: Date.now() + (isNaN(expiryMin) ? 5 : expiryMin) * 60 * 1000 };
      
      // Kirim OTP ke WhatsApp pelanggan
      try {
        const waJid = normalizePhone(customer.phone) + '@s.whatsapp.net';
        const msg = `🔐 *KODE OTP PORTAL PELANGGAN*\n\n` +
          `Kode OTP Anda adalah: *${otp}*\n\n` +
          `⏰ Kode ini berlaku selama ${(isNaN(expiryMin) ? 5 : expiryMin)} menit\n` +
          `🔒 Jangan bagikan kode ini kepada siapapun`;
        
        await sendMessage(waJid, msg);
        console.log(`OTP berhasil dikirim ke ${normalizePhone(customer.phone)}: ${otp}`);
      } catch (error) {
        console.error(`Gagal mengirim OTP ke ${normalizePhone(customer.phone)}:`, error);
      }
      
      if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.json({ success: true, message: 'OTP berhasil dikirim', redirect: `/customer/otp?phone=${encodeURIComponent(normalizePhone(customer.phone))}` });
      } else {
        return res.render('otp', { phone: normalizePhone(customer.phone), error: null, otp_length: otpLength, settings });
      }
    } else {
      const sessionPhone = normalizePhone(customer.phone);
      req.session.phone = sessionPhone;
      
      // Set customer_username untuk konsistensi dengan billing
      try {
        req.session.customer_username = customer.username;
        req.session.customer_phone = sessionPhone;
        console.log(`✅ [LOGIN] Set session customer_username: ${customer.username} for phone: ${sessionPhone}`);
      } catch (error) {
        console.error(`❌ [LOGIN] Error setting session:`, error);
        req.session.customer_username = `temp_${sessionPhone}`;
        req.session.customer_phone = sessionPhone;
      }
      
      if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.json({ success: true, message: 'Login berhasil', redirect: '/customer/dashboard' });
      } else {
        return res.redirect('/customer/dashboard');
      }
    }
  } catch (error) {
    console.error('Login error:', error);
    
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat login' });
    } else {
      return res.render('login', { settings: getSettingsWithCache(), error: 'Terjadi kesalahan saat login.' });
    }
  }
});

// GET: Halaman OTP
router.get('/otp', (req, res) => {
  const { phone } = req.query;
  const settings = getSettingsWithCache();
  res.render('otp', { phone: normalizePhone(phone), error: null, otp_length: settings.otp_length || 6, settings });
});

// POST: Verifikasi OTP
router.post('/otp', async (req, res) => {
  const { phone, otp } = req.body;
  const normalizedPhone = normalizePhone(phone);
  const data = otpStore[normalizedPhone];
  const settings = getSettingsWithCache();
  if (!data || data.otp !== otp || Date.now() > data.expires) {
    return res.render('otp', { phone: normalizedPhone, error: 'OTP salah atau sudah kadaluarsa.', otp_length: settings.otp_length || 6, settings });
  }
  // Sukses login
  delete otpStore[normalizedPhone];
  req.session = req.session || {};
  req.session.phone = normalizedPhone;
  
  // Set customer_username untuk konsistensi dengan billing
  try {
    const billingManager = require('../config/billing');
    const customer = await billingManager.getCustomerByPhone(normalizedPhone);
    if (customer) {
      req.session.customer_username = customer.username;
      req.session.customer_phone = normalizedPhone;
      console.log(`✅ [OTP_LOGIN] Set session customer_username: ${customer.username} for phone: ${normalizedPhone}`);
    } else {
      // Customer belum ada di billing, set temporary username
      req.session.customer_username = `temp_${normalizedPhone}`;
      req.session.customer_phone = normalizedPhone;
      console.log(`⚠️ [OTP_LOGIN] No billing customer found for phone: ${normalizedPhone}, set temp username`);
    }
  } catch (error) {
    console.error(`❌ [OTP_LOGIN] Error getting customer from billing:`, error);
    // Fallback ke temporary username
    req.session.customer_username = `temp_${normalizedPhone}`;
    req.session.customer_phone = normalizedPhone;
  }
  
  return res.redirect('/customer/dashboard');
});

// GET: Halaman billing pelanggan
router.get('/billing', async (req, res) => {
  const phone = req.session && req.session.phone;
  if (!phone) return res.redirect('/customer/login');
  const settings = getSettingsWithCache();
  
  try {
    const customer = await billingManager.getCustomerByPhone(phone);
    
    if (!customer) {
      // Pelanggan belum ada di sistem billing, tapi tetap bisa akses halaman billing
      console.log(`⚠️ [BILLING_REDIRECT] Customer not found in billing system for phone: ${phone}, but allowing access`);
      
      // Buat session customer_username sementara berdasarkan phone
      req.session.customer_username = `temp_${phone}`;
      req.session.customer_phone = phone; // Backup phone untuk referensi
      
      // Redirect ke billing dashboard yang akan menangani customer tanpa data billing
      return res.redirect('/customer/billing/dashboard');
    }
    
    const invoices = await billingManager.getInvoicesByCustomer(customer.id);
    
    // Set customer_username session for customer billing compatibility
    req.session.customer_username = customer.username;
    req.session.customer_phone = phone; // Backup phone untuk referensi
    console.log(`✅ [BILLING_REDIRECT] Set session customer_username: ${customer.username} for phone: ${phone}`);
    
    // Redirect to new customer billing dashboard with payment method selection
    res.redirect('/customer/billing/dashboard');
  } catch (error) {
    console.error('Error loading billing page:', error);
    res.render('error', { 
      message: 'Terjadi kesalahan saat memuat data tagihan',
      settings 
    });
  }
});

// POST: Restart device
router.post('/restart-device', async (req, res) => {
  // Prioritas: customer_username dari billing, fallback ke phone
  const customerUsername = req.session && req.session.customer_username;
  const phone = req.session && req.session.phone;
  
  if (!customerUsername && !phone) {
    return res.status(401).json({ success: false, message: 'Session tidak valid' });
  }
  
  try {
    console.log(`🔄 Restart device request from customer: ${customerUsername || phone}`);
    console.log(`🔄 Session data - customer_username: ${customerUsername}, phone: ${phone}`);
    
    // Ambil data customer dari billing
    let customer = null;
    if (phone) {
      try {
        const billingManager = require('../config/billing');
        customer = await billingManager.getCustomerByPhone(phone);
        console.log(`📋 [RESTART] Customer from billing:`, customer ? {
          id: customer.id, 
          username: customer.username, 
          pppoe_username: customer.pppoe_username,
          phone: customer.phone
        } : 'Not found');
      } catch (error) {
        console.error(`❌ [RESTART] Error getting customer from billing:`, error);
      }
    }
    
    let device = null;
    
    // Prioritas 1: Cari berdasarkan PPPoE Username dari billing
    if (customer && customer.pppoe_username) {
      console.log(`🔍 [RESTART] Searching by PPPoE username: ${customer.pppoe_username}`);
      try {
        device = await findDeviceByPPPoE(customer.pppoe_username);
        if (device) {
          console.log(`✅ [RESTART] Device found by PPPoE username: ${customer.pppoe_username}`);
        }
      } catch (error) {
        console.error(`❌ [RESTART] Error finding device by PPPoE:`, error);
      }
    }
    
    // Prioritas 2: Fallback ke pencarian berdasarkan tag (berbagai format)
    if (!device) {
      const searchVariants = [];
      
      if (customer) {
        // Gunakan data customer dari billing
        searchVariants.push(
          customer.username,           // Username billing
          customer.phone,             // Phone dari billing 
          customer.pppoe_username     // PPPoE username
        );
        
        // Extract nomor dari customer username jika format cust_xxxx_xxxxxx
        if (customer.username && customer.username.startsWith('cust_')) {
          const extracted = customer.username.replace(/^cust_/, '').replace(/_/g, '');
          searchVariants.push(extracted);
          searchVariants.push('0' + extracted);
        }
      }
      
      // Selalu coba dengan phone variants, bahkan tanpa billing data
      if (phone) {
        searchVariants.push(
          phone,                          // Format asli (087828060111)
          phone.replace(/^0/, '62'),     // 62878280601111  
          phone.replace(/^0/, '+62'),    // +62878280601111
          phone.replace(/^0/, ''),       // 87828060111
          phone.substring(1)             // 87828060111
        );
      }
      
      // Jika tidak ada billing data, coba dengan customerUsername dari session
      if (!customer && customerUsername) {
        console.log(`📱 [RESTART] No billing data, trying session customerUsername: ${customerUsername}`);
        searchVariants.push(customerUsername);
        
        // Extract dari customer username jika format cust_xxxx_xxxxxx
        if (customerUsername.startsWith('cust_')) {
          const extracted = customerUsername.replace(/^cust_/, '').replace(/_/g, '');
          searchVariants.push(extracted);
          searchVariants.push('0' + extracted);
        }
      }
      
      // Remove duplicates dan filter empty values
      const uniqueVariants = [...new Set(searchVariants.filter(v => v && v.trim()))];
      console.log(`📱 [RESTART] Searching device by tag with variants:`, uniqueVariants);
      
      // Cari device berdasarkan tag variants
      for (const variant of uniqueVariants) {
        console.log(`🔍 [RESTART] Trying tag variant: ${variant}`);
        device = await findDeviceByTag(variant);
        if (device) {
          console.log(`✅ [RESTART] Device found by tag variant: ${variant}`);
          break;
        }
      }
    }
    
    if (!device) {
      console.log(`❌ Device not found for customer: ${customerUsername || phone}`);
      console.log(`❌ Customer data:`, customer ? {
        username: customer.username,
        pppoe_username: customer.pppoe_username,
        phone: customer.phone
      } : 'No billing data');
      return res.status(404).json({ 
        success: false, 
        message: `Perangkat tidak ditemukan untuk customer: ${customerUsername || phone}` 
      });
    }
    
    console.log(`✅ Device found: ${device._id}`);
    
    // Cek status device
    const lastInform = device._lastInform ? new Date(device._lastInform) : null;
    const minutesAgo = lastInform ? Math.floor((Date.now() - lastInform.getTime()) / (1000 * 60)) : 999;
    
    if (minutesAgo > 5) {
      console.log(`⚠️ Device is offline. Last inform: ${lastInform ? lastInform.toLocaleString() : 'Never'}`);
      console.log(`⏰ Time since last inform: ${minutesAgo} minutes`);
      return res.status(400).json({ 
        success: false, 
        message: 'Perangkat offline. Restart hanya tersedia untuk perangkat yang online.' 
      });
    }
    
    console.log(`✅ Device is online. Last inform: ${lastInform.toLocaleString()}`);
    
    // Ambil konfigurasi GenieACS
    const settings = getSettingsWithCache();
    const genieacsUrl = settings.genieacs_url || 'http://localhost:7557';
    const username = settings.genieacs_username || 'admin';
    const password = settings.genieacs_password || 'admin';
    
    console.log(`🔗 GenieACS URL: ${genieacsUrl}`);
    
    // Encode device ID
    const deviceId = device._id;
    let encodedDeviceId = deviceId;
    
    try {
      // Coba encode device ID
      encodedDeviceId = encodeURIComponent(deviceId);
      console.log(`🔧 Using encoded device ID: ${encodedDeviceId}`);
    } catch (error) {
      console.log(`🔧 Using original device ID: ${deviceId}`);
    }
    
    // Kirim task restart ke GenieACS
    try {
      console.log(`📤 Sending restart task to GenieACS for device: ${deviceId}`);
      
      const response = await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks`, {
        name: "reboot"
      }, {
        auth: { username, password },
        timeout: 10000
      });
      
      console.log(`✅ GenieACS response:`, response.data);
      console.log(`🔄 Restart command sent successfully. Device will be offline during restart process.`);
      
      // Kirim notifikasi WhatsApp ke pelanggan
      try {
        const waJid = phone.replace(/^0/, '62') + '@s.whatsapp.net';
        const msg = `🔄 *RESTART PERANGKAT*\n\nPerintah restart telah dikirim ke perangkat Anda.\n\n⏰ Perangkat akan restart dalam beberapa detik dan koneksi internet akan terputus sementara (1-2 menit).\n\n📱 Silakan tunggu hingga perangkat selesai restart.`;
        await sendMessage(waJid, msg);
        console.log(`✅ WhatsApp notification sent to ${phone}`);
      } catch (e) {
        console.error('❌ Gagal mengirim notifikasi restart:', e);
      }
      
      res.json({ 
        success: true, 
        message: 'Perintah restart berhasil dikirim. Perangkat akan restart dalam beberapa detik.' 
      });
      
    } catch (taskError) {
      console.error(`❌ Error sending restart task:`, taskError.response?.data || taskError.message);
      
      // Fallback: coba dengan device ID asli
      try {
        console.log(`🔄 Trying with original device ID: ${deviceId}`);
        const response = await axios.post(`${genieacsUrl}/devices/${deviceId}/tasks`, {
          name: "reboot"
        }, {
          auth: { username, password },
          timeout: 10000
        });
        
        console.log(`✅ Fallback restart successful`);
        res.json({ 
          success: true, 
          message: 'Perintah restart berhasil dikirim. Perangkat akan restart dalam beberapa detik.' 
        });
        
      } catch (fallbackError) {
        console.error(`❌ Fallback restart failed:`, fallbackError.response?.data || fallbackError.message);
        res.status(500).json({ 
          success: false, 
          message: 'Gagal mengirim perintah restart. Silakan coba lagi atau hubungi admin.' 
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Error restart device:', error.message);
    console.error('❌ Error details:', error.response?.data || error);
    res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan saat restart perangkat. Silakan coba lagi.' 
    });
  }
});

// GET: Dashboard pelanggan
router.get('/dashboard', async (req, res) => {
  const phone = req.session && req.session.phone;
  if (!phone) return res.redirect('/customer/login');
  const settings = getSettingsWithCache();
  
  try {
    const data = await getCustomerDeviceData(phone);
    
    // Pastikan data tidak null
    if (!data) {
      console.log(`❌ No data returned for phone: ${phone}`);
      return res.render('dashboard', { 
        customer: { phone, ssid: '-', status: 'Tidak ditemukan', lastInform: '-' }, 
        connectedUsers: [], 
        notif: 'Data perangkat tidak ditemukan.',
        settings,
        billingData: null
      });
    }
    
    const customerWithAdmin = addAdminNumber(data);
    res.render('dashboard', { 
      customer: customerWithAdmin, 
      connectedUsers: data.connectedUsers || [],
      settings,
      billingData: data.billingData || null,
      notif: null
    });
  } catch (error) {
    console.error('Error loading dashboard:', error);
    // Fallback jika ada error, tetap tampilkan data minimal
    const fallbackCustomer = addAdminNumber({ 
      phone, 
      ssid: '-', 
      status: 'Error', 
      lastInform: '-',
      softwareVersion: '-',
      rxPower: '-',
      pppoeIP: '-',
      pppoeUsername: '-',
      totalAssociations: '0'
    });
    res.render('dashboard', { 
      customer: fallbackCustomer, 
      connectedUsers: [], 
      notif: 'Terjadi kesalahan saat memuat data.',
      settings,
      billingData: null
    });
  }
});

// POST: Ganti SSID (Legacy - redirect to homepage with notification)
router.post('/change-ssid', async (req, res) => {
  const phone = req.session && req.session.phone;
  if (!phone) return res.redirect('/customer/login');
  const { ssid } = req.body;
  const ok = await updateSSIDOptimized(phone, ssid);
  if (ok) {
    // Kirim notifikasi WhatsApp ke pelanggan
    const waJid = phone.replace(/^0/, '62') + '@s.whatsapp.net';
    const msg = `✅ *PERUBAHAN NAMA WIFI*\n\nNama WiFi Anda telah diubah menjadi:\n• WiFi 2.4GHz: ${ssid}\n• WiFi 5GHz: ${ssid}-5G\n\nSilakan hubungkan ulang perangkat Anda ke WiFi baru.`;
    try { await sendMessage(waJid, msg); } catch (e) {}
  }
  const data = await getCustomerDeviceData(phone);
  const customerWithAdmin = addAdminNumber(data || { phone, ssid: '-', status: '-', lastChange: '-' });
  res.render('dashboard', { 
    customer: customerWithAdmin, 
    connectedUsers: data ? data.connectedUsers : [], 
    notif: ok ? 'Nama WiFi (SSID) berhasil diubah.' : 'Gagal mengubah SSID.',
    settings: getSettingsWithCache()
  });
});

// API: Ganti SSID (Ajax endpoint - optimized like WhatsApp)
router.post('/api/change-ssid', async (req, res) => {
  const phone = req.session && req.session.phone;
  if (!phone) return res.status(401).json({ success: false, message: 'Session tidak valid' });
  
  const { ssid } = req.body;
  
  if (!ssid || ssid.length < 3 || ssid.length > 32) {
    return res.status(400).json({ success: false, message: 'SSID harus berisi 3-32 karakter!' });
  }
  
  try {
    // Kirim response cepat ke frontend
    res.json({ 
      success: true, 
      message: 'SSID sedang diproses...',
      newSSID: ssid,
      processing: true
    });
    
    // Proses update di background (non-blocking)
    updateSSIDOptimized(phone, ssid).then(result => {
      if (result.success) {
        // Kirim notifikasi WhatsApp ke pelanggan (non-blocking)
        const waJid = phone.replace(/^0/, '62') + '@s.whatsapp.net';
        const msg = `✅ *PERUBAHAN NAMA WIFI*\n\nNama WiFi Anda telah diubah menjadi:\n• WiFi 2.4GHz: ${ssid}\n• WiFi 5GHz: ${ssid}-5G\n\nSilakan hubungkan ulang perangkat Anda ke WiFi baru.`;
        sendMessage(waJid, msg).catch(e => {
          console.error('Error sending WhatsApp notification:', e);
        });
        
        console.log(`✅ SSID update completed for ${phone}: ${ssid}`);
      } else {
        console.error(`❌ SSID update failed for ${phone}: ${result.message}`);
      }
    }).catch(error => {
      console.error('Error in background SSID update:', error);
    });
    
  } catch (error) {
    console.error('Error in change SSID API:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// POST: Ganti Password (Legacy - untuk backward compatibility)
router.post('/change-password', async (req, res) => {
  const phone = req.session && req.session.phone;
  if (!phone) return res.redirect('/customer/login');
  const { password } = req.body;
  const ok = await updatePassword(phone, password);
  if (ok) {
    // Kirim notifikasi WhatsApp ke pelanggan
    const waJid = phone.replace(/^0/, '62') + '@s.whatsapp.net';
    const msg = `✅ *PERUBAHAN PASSWORD WIFI*\n\nPassword WiFi Anda telah diubah menjadi:\n• Password Baru: ${password}\n\nSilakan hubungkan ulang perangkat Anda dengan password baru.`;
    try { await sendMessage(waJid, msg); } catch (e) {}
  }
  const data = await getCustomerDeviceData(phone);
  const customerWithAdmin = addAdminNumber(data || { phone, ssid: '-', status: '-', lastChange: '-' });
  res.render('dashboard', { 
    customer: customerWithAdmin, 
    connectedUsers: data ? data.connectedUsers : [], 
    notif: ok ? 'Password WiFi berhasil diubah.' : 'Gagal mengubah password.',
    settings: getSettingsWithCache()
  });
});

// API: Ganti Password (Ajax endpoint - optimized like WhatsApp)
router.post('/api/change-password', async (req, res) => {
  const phone = req.session && req.session.phone;
  if (!phone) return res.status(401).json({ success: false, message: 'Session tidak valid' });
  
  const { password } = req.body;
  
  if (!password || password.length < 8 || password.length > 63) {
    return res.status(400).json({ success: false, message: 'Password harus berisi 8-63 karakter!' });
  }
  
  try {
    // Kirim response cepat ke frontend
    res.json({ 
      success: true, 
      message: 'Password sedang diproses...',
      processing: true
    });
    
    // Proses update di background (non-blocking)
    updatePasswordOptimized(phone, password).then(result => {
      if (result.success) {
        // Kirim notifikasi WhatsApp ke pelanggan (non-blocking)
        const waJid = phone.replace(/^0/, '62') + '@s.whatsapp.net';
        const msg = `✅ *PERUBAHAN PASSWORD WIFI*\n\nPassword WiFi Anda telah diubah menjadi:\n• Password Baru: ${password}\n\nSilakan hubungkan ulang perangkat Anda dengan password baru.`;
        sendMessage(waJid, msg).catch(e => {
          console.error('Error sending WhatsApp notification:', e);
        });
        
        console.log(`✅ Password update completed for ${phone}`);
      } else {
        console.error(`❌ Password update failed for ${phone}: ${result.message}`);
      }
    }).catch(error => {
      console.error('Error in background password update:', error);
    });
    
  } catch (error) {
    console.error('Error in change password API:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// POST: Logout pelanggan
// Logout route - support both GET and POST methods
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/customer/login');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/customer/login');
  });
});

// Import dan gunakan route laporan gangguan
const troubleReportRouter = require('./troubleReport');
router.use('/trouble', troubleReportRouter);

module.exports = router; 
 
// GET: Dashboard pelanggan versi mobile (UI modern, card tappable)
// Catatan: Tidak mengubah route lama. Menggunakan data sama seperti dashboard biasa
router.get('/dashboard/mobile', async (req, res) => {
  const phone = req.session && req.session.phone;
  if (!phone) return res.redirect('/customer/login');
  const settings = getSettingsWithCache();
  try {
    const data = await getCustomerDeviceData(phone);
    if (!data) {
      return res.render('dashboard-mobile', {
        customer: { phone, ssid: '-', status: 'Tidak ditemukan', lastInform: '-' },
        connectedUsers: [],
        notif: 'Data perangkat tidak ditemukan.',
        settings,
        billingData: null
      });
    }
    const customerWithAdmin = addAdminNumber(data);
    res.render('dashboard-mobile', {
      customer: customerWithAdmin,
      connectedUsers: data.connectedUsers || [],
      settings,
      billingData: data.billingData || null,
      notif: null
    });
  } catch (error) {
    console.error('Error loading mobile dashboard:', error);
    const fallbackCustomer = addAdminNumber({
      phone,
      ssid: '-',
      status: 'Error',
      lastInform: '-',
      softwareVersion: '-',
      rxPower: '-',
      pppoeIP: '-',
      pppoeUsername: '-',
      totalAssociations: '0'
    });
    res.render('dashboard-mobile', {
      customer: fallbackCustomer,
      connectedUsers: [],
      notif: 'Terjadi kesalahan saat memuat data.',
      settings,
      billingData: null
    });
  }
});
