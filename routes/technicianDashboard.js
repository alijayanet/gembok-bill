const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { getSetting } = require('../config/settingsManager');
const { technicianAuth, authManager } = require('./technicianAuth');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');
const logger = require('../config/logger');

// Database connection
const dbPath = path.join(__dirname, '../data/billing.db');
const db = new sqlite3.Database(dbPath);

// Billing manager untuk akses data
const billingManager = require('../config/billing');
const { addPPPoESecret, getPPPoEProfiles } = require('../config/mikrotik');

function getDb() {
    return typeof billingManager.getDb === 'function' ? billingManager.getDb() : billingManager.db;
}

/**
 * Dashboard Teknisi - Halaman utama terpisah dari admin
 */
router.get('/dashboard', technicianAuth, async (req, res) => {
    try {
        // Get the same data as admin dashboard but with technician context
        let genieacsTotal = 0, genieacsOnline = 0, genieacsOffline = 0;
        let mikrotikTotal = 0, mikrotikAktif = 0, mikrotikOffline = 0;
        let settings = {};

        try {
            // Import functions for dashboard data
            const { getDevices } = require('../config/genieacs');
            const { getActivePPPoEConnections, getInactivePPPoEUsers } = require('../config/mikrotik');
            const { getSettingsWithCache } = require('../config/settingsManager');
            const { getVersionInfo, getVersionBadge } = require('../config/version-utils');

            // Baca settings.json
            settings = getSettingsWithCache();

            // GenieACS data
            // ENHANCEMENT: Gunakan cached version untuk performa lebih baik
            const { getDevicesCached } = require('../config/genieacs');
            const devices = await getDevicesCached();
            genieacsTotal = devices.length;
            const now = Date.now();
            genieacsOnline = devices.filter(dev => dev._lastInform && (now - new Date(dev._lastInform).getTime()) < 3600 * 1000).length;
            genieacsOffline = genieacsTotal - genieacsOnline;

            // Mikrotik data
            const aktifResult = await getActivePPPoEConnections();
            mikrotikAktif = aktifResult.success ? aktifResult.data.length : 0;
            const offlineResult = await getInactivePPPoEUsers();
            mikrotikOffline = offlineResult.success ? offlineResult.totalInactive : 0;
            mikrotikTotal = (offlineResult.success ? offlineResult.totalSecrets : 0);

        } catch (e) {
            console.error('Error getting dashboard data for technician:', e);
            // Use default values if error
        }

        // Log activity
        await authManager.logActivity(req.technician.id, 'dashboard_access', 'Mengakses dashboard');

        // Render using technician dashboard template
        res.render('technician/dashboard', {
            title: 'Dashboard Teknisi',
            technician: req.technician,
            genieacsTotal,
            genieacsOnline,
            genieacsOffline,
            mikrotikTotal,
            mikrotikAktif,
            mikrotikOffline,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        logger.error('Error loading technician dashboard:', error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * Monitoring - Halaman monitoring (reuse adminGenieacs.ejs)
 */
router.get('/monitoring', technicianAuth, async (req, res) => {
    try {
        // Get the same data as admin GenieACS page
        const { getDevices } = require('../config/genieacs');
        const { getSettingsWithCache } = require('../config/settingsManager');

        // Get devices data
        // ENHANCEMENT: Gunakan cached version untuk performa lebih baik
        const { getDevicesCached } = require('../config/genieacs');
        const devicesRaw = await getDevicesCached();

        // Use the exact same parameter paths as admin GenieACS
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

        // Use the exact same getParameterWithPaths function as admin
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

        // Map devices data exactly like admin GenieACS
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

        // Calculate statistics
        const genieacsTotal = devicesRaw.length;
        const now = Date.now();
        const genieacsOnline = devicesRaw.filter(dev => dev._lastInform && (now - new Date(dev._lastInform).getTime()) < 3600 * 1000).length;
        const genieacsOffline = genieacsTotal - genieacsOnline;
        const settings = getSettingsWithCache();

        // Log activity
        await authManager.logActivity(req.technician.id, 'monitoring_access', 'Mengakses halaman monitoring GenieACS');

        // Render using adminGenieacs.ejs but with technician context
        res.render('adminGenieacs', {
            title: 'Monitoring GenieACS - Portal Teknisi',
            devices,
            settings,
            genieacsTotal,
            genieacsOnline,
            genieacsOffline,
            isTechnicianView: true,
            technician: req.technician,
            technicianRole: req.technician.role,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        logger.error('Error loading technician monitoring:', error);
        res.render('adminGenieacs', {
            title: 'Monitoring GenieACS - Portal Teknisi',
            devices: [],
            settings: {},
            genieacsTotal: 0,
            genieacsOnline: 0,
            genieacsOffline: 0,
            error: 'Gagal mengambil data device.',
            isTechnicianView: true,
            technician: req.technician,
            technicianRole: req.technician.role,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    }
});

/**
 * Customers - Halaman manajemen pelanggan untuk teknisi (reuse admin/billing/customers.ejs)
 */
router.get('/customers', technicianAuth, async (req, res) => {
    try {
        // Ambil data customers & packages
        const allCustomers = await billingManager.getCustomers();
        const packages = await billingManager.getPackages();

        // Get ODPs for dropdown selection (termasuk sub ODP)
        const odps = await new Promise((resolve, reject) => {
            const db = getDb();
            db.all(`
                SELECT o.id, o.name, o.code, o.capacity, o.used_ports, o.status, o.parent_odp_id,
                       p.name as parent_name, p.code as parent_code
                FROM odps o
                LEFT JOIN odps p ON o.parent_odp_id = p.id
                WHERE o.status = 'active' 
                ORDER BY p.name, o.name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Query params untuk pencarian & pagination
        const search = (req.query.search || '').trim();
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = 20;

        // Filter sederhana di sisi server (name/phone/username)
        const filtered = !search
            ? allCustomers
            : allCustomers.filter(c => {
                const s = search.toLowerCase();
                return (
                    (c.name || '').toLowerCase().includes(s) ||
                    (c.phone || '').toLowerCase().includes(s) ||
                    (c.username || '').toLowerCase().includes(s)
                );
            });

        const totalCustomers = filtered.length;
        const totalPages = Math.max(1, Math.ceil(totalCustomers / limit));
        const currentPage = Math.min(page, totalPages);
        const offset = (currentPage - 1) * limit;
        const customers = filtered.slice(offset, offset + limit);

        // Log activity
        await authManager.logActivity(req.technician.id, 'customers_access', 'Mengakses halaman pelanggan');

        // Render technician customers view
        res.render('technician/customers', {
            title: 'Kelola Pelanggan - Portal Teknisi',
            page: 'customers',
            customers,
            packages,
            odps,
            search,
            pagination: {
                currentPage,
                totalPages,
                totalCustomers,
                hasNext: currentPage < totalPages,
                hasPrev: currentPage > 1
            },
            technician: req.technician,
            // View ini mengakses settings.company_header
            settings: {
                company_header: getSetting('company_header', 'GEMBOK'),
                footer_info: getSetting('footer_info', 'Portal Teknisi'),
                logo_filename: getSetting('logo_filename', 'logo.png')
            },
            isTechnicianView: true,
            technician: req.technician,
            technicianRole: req.technician.role,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        logger.error('Error loading technician customers:', error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * Add Customer - Tambah pelanggan baru
 */
router.post('/customers/add', technicianAuth, async (req, res) => {
    try {
        const { name, username: reqUsername, phone, email, address, package_id, odp_id, pppoe_username, pppoe_profile, create_pppoe_now, create_pppoe_user, pppoe_password, auto_suspension, billing_day, latitude, longitude, static_ip, assigned_ip, mac_address } = req.body;

        // Validasi input
        if (!name || !phone || !package_id) {
            return res.status(400).json({
                success: false,
                message: 'Nama, nomor telepon, dan paket wajib diisi'
            });
        }

        // Normalisasi nomor telepon ke 62XXXXXXXXXXX
        const normalizedPhone = normalizePhone(phone);

        // Username wajib jika disamakan dengan admin; jika kosong, auto-generate
        const username = (reqUsername && String(reqUsername).trim()) || generateUsername(name, normalizedPhone);

        // Data customer
        const customerData = {
            username,
            name,
            phone: normalizedPhone,
            email: email || null,
            address: address || null,
            package_id: parseInt(package_id),
            odp_id: odp_id || null,
            pppoe_username: pppoe_username || null,
            pppoe_profile: pppoe_profile || null,
            auto_suspension: typeof auto_suspension !== 'undefined' ? parseInt(auto_suspension) : 1,
            billing_day: billing_day ? parseInt(billing_day) : 15,
            latitude: latitude !== undefined && latitude !== '' ? parseFloat(latitude) : undefined,
            longitude: longitude !== undefined && longitude !== '' ? parseFloat(longitude) : undefined,
            static_ip: static_ip || null,
            assigned_ip: assigned_ip || null,
            mac_address: mac_address || null,
            created_by_technician_id: req.technician.id
        };

        // Lengkapi pppoe_profile dari paket jika belum ada
        if (!customerData.pppoe_profile && customerData.package_id) {
            try {
                const pkg = await billingManager.getPackageById(customerData.package_id);
                if (pkg && pkg.pppoe_profile) customerData.pppoe_profile = pkg.pppoe_profile;
            } catch (_) { }
        }

        // Tambah customer via billing manager
        const newCustomer = await billingManager.createCustomer(customerData);

        // Opsional: buat PPPoE secret langsung di Mikrotik (terima create_pppoe_user atau create_pppoe_now)
        const createNow = String(create_pppoe_now).toLowerCase() === 'true' || String(create_pppoe_user).toLowerCase() === 'true';
        if (createNow) {
            try {
                const pppUser = (pppoe_username && pppoe_username.trim()) ? pppoe_username.trim() : username;
                const pppProfile = (customerData.pppoe_profile && String(customerData.pppoe_profile).trim()) ? String(customerData.pppoe_profile).trim() : 'default';
                // Password: pakai isian atau samakan dengan username
                const pppPass = (pppoe_password && String(pppoe_password).trim().length >= 6) ? String(pppoe_password).trim() : pppUser;
                const mkResult = await addPPPoESecret(pppUser, pppPass, pppProfile, '');
                await authManager.logActivity(
                    req.technician.id,
                    'pppoe_create',
                    `Create PPPoE secret ${pppUser} (profile: ${pppProfile})`,
                    { customer_id: newCustomer.id, pppoe_username: pppUser, profile: pppProfile, mikrotik: mkResult?.success }
                );
            } catch (mkErr) {
                // Jangan gagal total jika Mikrotik gagal
                console.warn('Failed to create PPPoE secret on Mikrotik:', mkErr.message);
            }
        }

        // Log activity
        await authManager.logActivity(
            req.technician.id,
            'customer_add',
            `Menambah pelanggan baru: ${name}`,
            { customer_id: newCustomer.id, customer_name: name }
        );

        res.json({
            success: true,
            message: 'Pelanggan berhasil ditambahkan',
            customer: newCustomer
        });

    } catch (error) {
        logger.error('Error adding customer by technician:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menambah pelanggan: ' + error.message
        });
    }
});

// API: ambil daftar PPPoE Profiles dari Mikrotik
router.get('/api/mikrotik/pppoe-profiles', technicianAuth, async (req, res) => {
    try {
        const result = await getPPPoEProfiles();
        if (!result?.success) {
            return res.status(500).json({ success: false, message: result?.message || 'Gagal mengambil PPPoE profiles' });
        }
        const profiles = (result.data || []).map(p => ({ name: p.name, rate_limit: p['rate-limit'] || null }));
        res.json({ success: true, profiles });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


/**
 * Update customer (PUT)
 */
router.put('/api/customers/:id', technicianAuth, async (req, res) => {
    try {
        const customerId = parseInt(req.params.id);
        if (!customerId) {
            return res.status(400).json({ success: false, message: 'ID customer tidak valid' });
        }

        const {
            name,
            phone,
            email,
            address,
            package_id,
            status,
            pppoe_username,
            odp_id
        } = req.body;

        // Validate required fields
        if (!name || !phone) {
            return res.status(400).json({
                success: false,
                message: 'Nama dan nomor telepon harus diisi'
            });
        }

        // Validate phone format
        const phoneRegex = /^(\+62|62|0)[0-9]{9,13}$/;
        if (!phoneRegex.test(phone)) {
            return res.status(400).json({
                success: false,
                message: 'Format nomor telepon tidak valid'
            });
        }

        // Check if customer exists
        const existingCustomer = await billingManager.getCustomerById(customerId);
        if (!existingCustomer) {
            return res.status(404).json({
                success: false,
                message: 'Customer tidak ditemukan'
            });
        }

        // Validate package if provided
        if (package_id) {
            const packages = await billingManager.getPackages();
            const packageExists = packages.some(pkg => pkg.id === parseInt(package_id));
            if (!packageExists) {
                return res.status(400).json({
                    success: false,
                    message: 'Package tidak valid'
                });
            }
        }

        // Validate ODP if provided
        if (odp_id) {
            const db = getDb();
            const odp = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM odps WHERE id = ? AND status = "active"', [odp_id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            if (!odp) {
                return res.status(400).json({
                    success: false,
                    message: 'ODP tidak valid atau tidak aktif'
                });
            }
        }

        // Update customer using billingManager (same as admin) to ensure cable routes sync
        const updateData = {
            id: customerId,
            name: name || existingCustomer.name,
            phone: phone || existingCustomer.phone,
            email: email || existingCustomer.email,
            address: address || existingCustomer.address,
            package_id: package_id || existingCustomer.package_id,
            status: status || existingCustomer.status,
            pppoe_username: pppoe_username || existingCustomer.pppoe_username,
            odp_id: odp_id !== undefined ? odp_id : existingCustomer.odp_id
        };

        // Use billingManager.updateCustomerById to ensure cable routes are synced
        const updatedCustomer = await billingManager.updateCustomerById(customerId, updateData);

        // Log activity
        await authManager.logActivity(req.technician.id, 'customer_edit', `Mengedit customer ${name} (ID: ${customerId})`);

        res.json({
            success: true,
            message: 'Customer berhasil diupdate',
            customer: updatedCustomer
        });

    } catch (error) {
        logger.error('Error updating customer by technician:', error);
        // Tambahkan error detail ke response untuk debugging
        res.status(500).json({
            success: false,
            message: 'Gagal mengupdate customer',
            error: error && error.message ? error.message : error
        });
    }
});

/**
 * Update customer (PUT)
 */
router.put('/customers/:id', technicianAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { name, phone, email, address, latitude, longitude, package_id, odp_id, pppoe_username, pppoe_profile, status } = req.body;
        if (!id) return res.status(400).json({ success: false, message: 'ID tidak valid' });

        const existing = await billingManager.getCustomerById(id);
        if (!existing) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });

        const normalizedPhone = phone ? normalizePhone(phone) : existing.phone;

        const updateData = {
            id,
            name: name ?? existing.name,
            phone: normalizedPhone,
            email: email ?? existing.email,
            address: address ?? existing.address,
            latitude: latitude ?? existing.latitude,
            longitude: longitude ?? existing.longitude,
            package_id: package_id ? parseInt(package_id) : existing.package_id,
            odp_id: odp_id !== undefined ? odp_id : existing.odp_id,
            pppoe_username: pppoe_username ?? existing.pppoe_username,
            pppoe_profile: pppoe_profile ?? existing.pppoe_profile,
            status: status ?? existing.status
        };

        const updated = await billingManager.updateCustomerById(id, updateData);

        // Log activity
        await authManager.logActivity(
            req.technician.id,
            'customer_update',
            `Update pelanggan: ${updateData.name}`,
            { customer_id: id }
        );

        res.json({ success: true, message: 'Pelanggan berhasil diperbarui', customer: updated || updateData });
    } catch (error) {
        logger.error('Error updating customer by technician:', error);
        res.status(500).json({ success: false, message: 'Gagal memperbarui pelanggan: ' + error.message });
    }
});

/**
 * Delete customer (DELETE)
 */
router.delete('/customers/:id', technicianAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (!id) return res.status(400).json({ success: false, message: 'ID tidak valid' });
        const existing = await billingManager.getCustomerById(id);
        if (!existing) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });

        // Hapus berdasar ID (menggunakan method baru yang sinkron dengan cable routes)
        const result = await billingManager.deleteCustomerById(id);

        // Log activity
        await authManager.logActivity(
            req.technician.id,
            'customer_delete',
            `Hapus pelanggan: ${existing.name}`,
            { customer_id: id }
        );

        res.json({ success: true, message: 'Pelanggan berhasil dihapus', deleted: Boolean(result) });
    } catch (error) {
        logger.error('Error deleting customer by technician:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus pelanggan: ' + error.message });
    }
});

/**
 * API Endpoints untuk Edit Customer
 */

// API untuk mendapatkan packages
router.get('/api/packages', technicianAuth, async (req, res) => {
    try {
        const packages = await billingManager.getPackages();
        res.json({
            success: true,
            packages: packages
        });
    } catch (error) {
        logger.error('Error getting packages for technician:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data packages'
        });
    }
});

// API untuk mendapatkan ODPs
router.get('/api/odps', technicianAuth, async (req, res) => {
    try {
        const db = getDb();
        const odps = await new Promise((resolve, reject) => {
            db.all(`
                SELECT id, name, code, capacity, used_ports, status
                FROM odps 
                WHERE status = 'active'
                ORDER BY name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        res.json({
            success: true,
            odps: odps
        });
    } catch (error) {
        logger.error('Error getting ODPs for technician:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data ODPs'
        });
    }
});

/**
 * API Endpoints untuk Mapping Technician
 */

// API untuk mendapatkan data customers (untuk mapping)
router.get('/api/customers', technicianAuth, async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        res.json({
            success: true,
            customers: customers
        });
    } catch (error) {
        logger.error('Error getting customers API for technician:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API untuk mendapatkan single customer (untuk edit)
router.get('/api/customers/:id', technicianAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (!id) return res.status(400).json({ success: false, message: 'ID tidak valid' });
        const customer = await billingManager.getCustomerById(id);
        if (!customer) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });
        res.json({ success: true, customer });
    } catch (error) {
        logger.error('Error get customer by technician:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data pelanggan' });
    }
});

// API untuk mendapatkan data packages (untuk mapping filter)
router.get('/api/packages', technicianAuth, async (req, res) => {
    try {
        const packages = await billingManager.getPackages();
        res.json({
            success: true,
            packages: packages
        });
    } catch (error) {
        logger.error('Error getting packages API for technician:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API untuk mendapatkan statistik (untuk mapping)
router.get('/api/statistics', technicianAuth, async (req, res) => {
    try {
        const { getDevices } = require('../config/genieacs');
        // ENHANCEMENT: Gunakan cached version untuk performa lebih baik
        const { getDevicesCached } = require('../config/genieacs');
        const devices = await getDevicesCached();
        const now = Date.now();
        const onlineDevices = devices.filter(dev => dev._lastInform && (now - new Date(dev._lastInform).getTime()) < 3600 * 1000).length;

        res.json({
            success: true,
            data: {
                totalDevices: devices.length,
                onlineDevices: onlineDevices,
                offlineDevices: devices.length - onlineDevices
            }
        });
    } catch (error) {
        logger.error('Error getting statistics API for technician:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API untuk mendapatkan data mapping devices
router.get('/api/mapping/devices', technicianAuth, async (req, res) => {
    try {
        const { getDevices } = require('../config/genieacs');
        const { pppoe, phone } = req.query;

        // Jika ada parameter query, filter devices berdasarkan kriteria
        if (pppoe || phone) {
            let customer = null;
            const buildPhoneVariants = (input) => {
                const norm = normalizePhone(String(input || ''));
                const local = norm.replace(/^62/, '0');
                const plus = '+' + norm;
                const shortLocal = local.startsWith('0') ? local.slice(1) : local;
                return Array.from(new Set([norm, local, plus, shortLocal].filter(Boolean)));
            };

            // Cari customer berdasarkan parameter
            if (pppoe) {
                customer = await billingManager.getCustomerByPPPoE(pppoe);
            } else if (phone) {
                const variants = buildPhoneVariants(phone);
                for (const v of variants) {
                    customer = await billingManager.getCustomerByPhone(v);
                    if (customer) break;
                }
            }

            if (!customer) {
                return res.json({
                    success: true,
                    data: {
                        devicesWithCoords: [],
                        devicesWithoutCoords: [],
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
            // ENHANCEMENT: Gunakan cached version untuk performa lebih baik
            const { getDevicesCached } = require('../config/genieacs');
            const devicesRaw = await getDevicesCached();
            const devicesWithCoords = [];
            const devicesWithoutCoords = [];

            for (const device of devicesRaw) {
                let deviceCustomer = null;
                let coordinateSource = 'none';

                // Coba berbagai cara untuk mencocokkan device dengan customer
                const devicePPPoE = device.VirtualParameters?.pppoeUsername || device.VirtualParameters?.pppUsername;
                const tags = Array.isArray(device.Tags) ? device.Tags.join(',') : (device.Tags || device._tags || '');
                const tagString = typeof tags === 'string' ? tags : '';
                const variants = buildPhoneVariants(customer.phone);

                if (devicePPPoE && customer.pppoe_username && devicePPPoE === customer.pppoe_username) {
                    deviceCustomer = customer;
                    coordinateSource = 'pppoe_username';
                } else if (tagString && variants.some(v => tagString.includes(v))) {
                    deviceCustomer = customer;
                    coordinateSource = 'device_tag';
                }

                if (deviceCustomer && deviceCustomer.latitude && deviceCustomer.longitude) {
                    const now = Date.now();
                    const isOnline = device._lastInform && (now - new Date(device._lastInform).getTime()) < 3600 * 1000;
                    const ssid5g = device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['5']?.SSID?._value || '-';
                    const pass5g = device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['5']?.KeyPassphrase?._value || '-';
                    const pppoeIP = device.InternetGatewayDevice?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANPPPConnection?.['1']?.ExternalIPAddress?._value || '-';
                    const uptime = (device.InternetGatewayDevice?.DeviceInfo?.UpTime?._value
                        || device.InternetGatewayDevice?.DeviceInfo?.['1']?.UpTime?._value
                        || device.VirtualParameters?.getdeviceuptime
                        || '-')

                    devicesWithCoords.push({
                        id: device._id,
                        serialNumber: device.DeviceID?.SerialNumber || device._id,
                        model: device.DeviceID?.ProductClass,
                        latitude: deviceCustomer.latitude,
                        longitude: deviceCustomer.longitude,
                        status: isOnline ? 'Online' : 'Offline',
                        lastInform: device._lastInform,
                        pppoeUsername: devicePPPoE || '-',
                        ssid: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.SSID?._value || '-',
                        password: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.KeyPassphrase?._value || '-',
                        userConnected: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.TotalAssociations?._value || '0',
                        rxPower: device.VirtualParameters?.RXPower || device.VirtualParameters?.redaman || '-',
                        customerId: deviceCustomer.id,
                        customerName: deviceCustomer.name,
                        customerPhone: deviceCustomer.phone,
                        packageId: deviceCustomer.package_id,
                        coordinateSource: coordinateSource,
                        tag: device.Tags ? (Array.isArray(device.Tags) ? device.Tags.join(', ') : device.Tags) : '-',
                        uptime: uptime,
                        pppoeIP: pppoeIP,
                        ssid5g: ssid5g,
                        password5g: pass5g
                    });
                } else {
                    const now = Date.now();
                    const isOnline = device._lastInform && (now - new Date(device._lastInform).getTime()) < 3600 * 1000;
                    const ssid5g = device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['5']?.SSID?._value || '-';
                    const pass5g = device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['5']?.KeyPassphrase?._value || '-';
                    const pppoeIP = device.InternetGatewayDevice?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANPPPConnection?.['1']?.ExternalIPAddress?._value || '-';
                    const uptime = (device.InternetGatewayDevice?.DeviceInfo?.UpTime?._value
                        || device.InternetGatewayDevice?.DeviceInfo?.['1']?.UpTime?._value
                        || device.VirtualParameters?.getdeviceuptime
                        || '-')
                    devicesWithoutCoords.push({
                        id: device._id,
                        serialNumber: device.DeviceID?.SerialNumber || device._id,
                        model: device.DeviceID?.ProductClass,
                        pppoeUsername: devicePPPoE || '-',
                        lastInform: device._lastInform || null,
                        status: isOnline ? 'Online' : 'Offline',
                        ssid: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.SSID?._value || '-',
                        password: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.KeyPassphrase?._value || '-',
                        userConnected: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.TotalAssociations?._value || '0',
                        rxPower: device.VirtualParameters?.RXPower || device.VirtualParameters?.redaman || '-',
                        uptime: uptime,
                        pppoeIP: pppoeIP,
                        ssid5g: ssid5g,
                        password5g: pass5g
                    });
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
                        device_tag: 0,
                        serial_number: 0
                    }
                }
            });
        }

        // Jika tidak ada parameter, kembalikan semua devices dengan koordinat
        // ENHANCEMENT: Gunakan cached version untuk performa lebih baik
        const { getDevicesCached } = require('../config/genieacs');
        const allDevices = await getDevicesCached();
        const customers = await billingManager.getCustomers();
        const devicesWithCoords = [];
        const devicesWithoutCoords = [];

        // Map devices dengan customer coordinates
        for (const device of allDevices) {
            let deviceCustomer = null;
            let coordinateSource = 'none';

            const devicePPPoE = device.VirtualParameters?.pppoeUsername || device.VirtualParameters?.pppUsername;

            if (devicePPPoE) {
                deviceCustomer = customers.find(c => c.pppoe_username === devicePPPoE);
                if (deviceCustomer) {
                    coordinateSource = 'pppoe_username';
                }
            }

            if (deviceCustomer && deviceCustomer.latitude && deviceCustomer.longitude) {
                const now = Date.now();
                const isOnline = device._lastInform && (now - new Date(device._lastInform).getTime()) < 3600 * 1000;

                devicesWithCoords.push({
                    id: device._id,
                    serialNumber: device.DeviceID?.SerialNumber || device._id,
                    model: device.DeviceID?.ProductClass,
                    latitude: deviceCustomer.latitude,
                    longitude: deviceCustomer.longitude,
                    status: isOnline ? 'Online' : 'Offline',
                    lastInform: device._lastInform,
                    pppoeUsername: devicePPPoE || '-',
                    ssid: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.SSID?._value || '-',
                    password: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.KeyPassphrase?._value || '-',
                    userConnected: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.TotalAssociations?._value || '0',
                    rxPower: device.VirtualParameters?.RXPower || device.VirtualParameters?.redaman || '-',
                    customerId: deviceCustomer.id,
                    customerName: deviceCustomer.name,
                    customerPhone: deviceCustomer.phone,
                    packageId: deviceCustomer.package_id,
                    coordinateSource: coordinateSource,
                    tag: device.Tags ? (Array.isArray(device.Tags) ? device.Tags.join(', ') : device.Tags) : '-'
                });
            } else {
                devicesWithoutCoords.push({
                    id: device._id,
                    serialNumber: device.DeviceID?.SerialNumber || device._id,
                    model: device.DeviceID?.ProductClass,
                    pppoeUsername: devicePPPoE || '-'
                });
            }
        }

        // Ambil data ODP connections untuk backbone visualization
        let odpConnections = [];
        try {
            const db = new sqlite3.Database(dbPath);
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
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });
            db.close();
        } catch (error) {
            console.log('Error getting ODP connections for technician:', error.message);
        }

        res.json({
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
                    device_tag: 0,
                    serial_number: 0
                },
                odpConnections: odpConnections
            }
        });

    } catch (error) {
        logger.error('Error getting mapping devices for technician:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data mapping devices'
        });
    }
});

/**
 * Mapping - Halaman monitoring mapping (reuse admin/billing/mapping.ejs)
 */
router.get('/mapping', technicianAuth, async (req, res) => {
    try {
        // Log activity
        await authManager.logActivity(req.technician.id, 'mapping_access', 'Mengakses halaman mapping');

        // Ambil data pelanggan untuk ditampilkan di peta
        const customers = await billingManager.getCustomers();

        // Render mapping khusus teknisi
        res.render('technician/mapping', {
            title: 'Network Mapping - Portal Teknisi',
            settings: {
                company_header: getSetting('company_header', 'GEMBOK'),
                footer_info: getSetting('footer_info', 'Portal Teknisi'),
                logo_filename: getSetting('logo_filename', 'logo.png')
            },
            customers,
            isTechnicianView: true,
            technician: req.technician,
            technicianRole: req.technician.role,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        logger.error('Error loading technician mapping:', error);
        res.status(500).render('error', {
            message: 'Error loading mapping page',
            error: error.message,
            appSettings: {
                companyHeader: getSetting('company_header', 'GEMBOK'),
                footerInfo: getSetting('footer_info', 'Portal Teknisi')
            }
        });
    }
});

// API untuk edit device GenieACS (untuk mapping)
router.put('/genieacs/devices/:deviceId', technicianAuth, async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { ssid, password, ssid5g, tag } = req.body;

        // Import GenieACS functions
        const { updateDevice } = require('../config/genieacs');

        // Prepare device parameters to update
        const updates = {};

        if (ssid !== undefined && ssid !== '') {
            updates['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID'] = ssid;
            // SSID 5GHz: gunakan ssid5g bila dikirim, fallback {ssid}-5G
            const ssid5 = (typeof ssid5g === 'string' && ssid5g.trim()) ? ssid5g.trim() : `${ssid}-5G`;
            updates['InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID'] = ssid5;
        }

        if (password !== undefined && password !== '') {
            updates['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase'] = password;
            updates['InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase'] = password;
        }

        if (tag !== undefined) {
            updates['Tags'] = tag;
        }

        // Update device di GenieACS
        const result = await updateDevice(deviceId, updates);

        if (result.success) {
            // Log activity
            await authManager.logActivity(
                req.technician.id,
                'device_update',
                `Update device ${deviceId}`,
                { device_id: deviceId, updates: Object.keys(updates) }
            );

            res.json({
                success: true,
                message: 'Device berhasil diperbarui',
                data: result.data
            });
        } else {
            res.status(400).json({
                success: false,
                message: result.message || 'Gagal memperbarui device'
            });
        }
    } catch (error) {
        logger.error('Error updating device by technician:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error: ' + error.message
        });
    }
});

/**
 * Installations - Halaman instalasi baru (show installation jobs from admin)
 */
router.get('/installations', technicianAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const status = req.query.status || ''; // Filter untuk status instalasi

        // Build query conditions for technician access
        let whereConditions = ['(assigned_technician_id = ? OR assigned_technician_id IS NULL)'];
        let params = [req.technician.id];

        if (search) {
            whereConditions.push('(job_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (status && status !== 'all') {
            whereConditions.push('status = ?');
            params.push(status);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // Get installation jobs assigned to this technician
        const installationJobs = await new Promise((resolve, reject) => {
            const query = `
                SELECT ij.*, 
                       p.name as package_name, p.price as package_price,
                       t.name as technician_name
                FROM installation_jobs ij
                LEFT JOIN packages p ON ij.package_id = p.id
                LEFT JOIN technicians t ON ij.assigned_technician_id = t.id
                ${whereClause}
                ORDER BY ij.installation_date ASC, ij.created_at DESC 
                LIMIT ? OFFSET ?
            `;

            db.all(query, [...params, limit, offset], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Get total count
        const totalJobs = await new Promise((resolve, reject) => {
            const countQuery = `SELECT COUNT(*) as count FROM installation_jobs ${whereClause}`;
            db.get(countQuery, params, (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const totalPages = Math.ceil(totalJobs / limit);

        // Calculate statistics for this technician
        const stats = await new Promise((resolve, reject) => {
            db.all(`
                SELECT status, COUNT(*) as count 
                FROM installation_jobs 
                WHERE assigned_technician_id = ? OR assigned_technician_id IS NULL
                GROUP BY status
            `, [req.technician.id], (err, rows) => {
                if (err) reject(err);
                else {
                    const statistics = {
                        total: totalJobs,
                        scheduled: 0,
                        assigned: 0,
                        in_progress: 0,
                        completed: 0,
                        cancelled: 0
                    };

                    rows.forEach(row => {
                        statistics[row.status] = row.count;
                    });

                    resolve(statistics);
                }
            });
        });

        // Log activity
        await authManager.logActivity(req.technician.id, 'installations_access', 'Mengakses halaman instalasi');

        // Create a new template specifically for technician installation jobs
        res.render('technician/installations', {
            title: 'Jadwal Instalasi - Portal Teknisi',
            technician: req.technician,
            installationJobs,
            stats,
            pagination: {
                currentPage: page,
                totalPages,
                totalJobs,
                hasNext: page < totalPages,
                hasPrev: page > 1
            },
            search,
            status,
            settings: {
                company_header: getSetting('company_header', 'GEMBOK'),
                footer_info: getSetting('footer_info', 'Portal Teknisi')
            },
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        logger.error('Error loading technician installations:', error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * Trouble Tickets - Halaman laporan gangguan (reuse admin/trouble-reports.ejs)
 */
router.get('/troubletickets', technicianAuth, async (req, res) => {
    try {
        // Get trouble reports with technician-specific filtering
        const reports = await getTroubleReportsForTechnician(req.technician.id, req.technician.role);

        // Calculate stats
        const stats = {
            total: reports.length,
            open: reports.filter(r => r.status === 'open').length,
            inProgress: reports.filter(r => r.status === 'in_progress').length,
            resolved: reports.filter(r => r.status === 'resolved').length,
            closed: reports.filter(r => r.status === 'closed').length
        };

        // Log activity
        await authManager.logActivity(req.technician.id, 'troubletickets_access', 'Mengakses laporan gangguan');

        // Render using admin/trouble-reports.ejs but with technician context
        res.render('admin/trouble-reports', {
            title: 'Laporan Gangguan - Portal Teknisi',
            reports,
            stats,
            appSettings: {
                companyHeader: getSetting('company_header', 'GEMBOK'),
                footerInfo: getSetting('footer_info', 'Portal Teknisi'),
                logoFilename: getSetting('logo_filename', 'logo.png'),
                company_slogan: getSetting('company_slogan', ''),
                company_website: getSetting('company_website', ''),
                invoice_notes: getSetting('invoice_notes', '')
            },
            settings: {
                company_header: getSetting('company_header', 'GEMBOK'),
                footer_info: getSetting('footer_info', 'Portal Teknisi')
            },
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge(),
            // Add technician context to differentiate from admin
            isTechnicianView: true,
            technician: req.technician,
            technicianRole: req.technician.role
        });

    } catch (error) {
        logger.error('Error loading technician trouble tickets:', error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * Trouble Ticket Detail - Halaman detail laporan gangguan (reuse admin/trouble-report-detail.ejs)
 */
router.get('/troubletickets/detail/:id', technicianAuth, async (req, res) => {
    try {
        const reportId = req.params.id;

        // Import trouble report functions
        const { getTroubleReportById } = require('../config/troubleReport');
        const report = getTroubleReportById(reportId);

        if (!report) {
            return res.status(404).send('Laporan gangguan tidak ditemukan');
        }

        // Check if technician has access to this report
        const canAccess = await canTechnicianAccessReport(req.technician.id, req.technician.role, report);
        if (!canAccess) {
            return res.status(403).send('Akses ditolak untuk laporan ini');
        }

        // Log activity
        await authManager.logActivity(
            req.technician.id,
            'troubleticket_detail_view',
            `Melihat detail laporan #${reportId}`,
            { report_id: reportId }
        );

        // Render using admin/trouble-report-detail.ejs with technician context
        res.render('admin/trouble-report-detail', {
            title: `Detail Laporan #${reportId} - Portal Teknisi`,
            report,
            appSettings: {
                companyHeader: getSetting('company_header', 'GEMBOK'),
                footerInfo: getSetting('footer_info', 'Portal Teknisi'),
                logoFilename: getSetting('logo_filename', 'logo.png'),
                company_slogan: getSetting('company_slogan', ''),
                company_website: getSetting('company_website', ''),
                invoice_notes: getSetting('invoice_notes', '')
            },
            settings: {
                company_header: getSetting('company_header', 'GEMBOK'),
                footer_info: getSetting('footer_info', 'Portal Teknisi')
            },
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge(),
            // Add technician context to differentiate from admin
            isTechnicianView: true,
            technician: req.technician,
            technicianRole: req.technician.role
        });

    } catch (error) {
        logger.error('Error loading trouble ticket detail:', error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * Update trouble ticket status
 */
router.post('/troubletickets/:id/update', technicianAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, technician_notes } = req.body;

        // Update trouble ticket status
        const updated = await updateTroubleTicketStatus(id, status, technician_notes, req.technician.id);

        if (!updated) {
            return res.status(404).json({
                success: false,
                message: 'Laporan gangguan tidak ditemukan'
            });
        }

        // Log activity
        await authManager.logActivity(
            req.technician.id,
            'troubleticket_update',
            `Update status laporan #${id} menjadi ${status}`,
            { ticket_id: id, new_status: status }
        );

        res.json({
            success: true,
            message: 'Status laporan gangguan berhasil diperbarui'
        });

    } catch (error) {
        logger.error('Error updating trouble ticket:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal memperbarui status: ' + error.message
        });
    }
});

/**
 * Payments - Halaman monitoring dan penerimaan pembayaran (khusus kolektor)
 */
router.get('/payments', technicianAuth, async (req, res) => {
    try {
        // Cek apakah teknisi adalah kolektor
        if (req.technician.role !== 'collector' && req.technician.role !== 'field_officer') {
            return res.status(403).send('Akses ditolak. Hanya kolektor yang dapat mengakses halaman ini.');
        }

        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        const status = req.query.status || 'all';

        // Get payments data
        const payments = await getPaymentsForCollector(req.technician.id, status, limit, offset);
        const totalPayments = await getTotalPaymentsForCollector(req.technician.id, status);
        const totalPages = Math.ceil(totalPayments / limit);

        // Get payment statistics
        const paymentStats = await getPaymentStatsForCollector(req.technician.id);

        res.render('technician/collectors', {
            technician: req.technician,
            payments,
            paymentStats,
            pagination: {
                currentPage: page,
                totalPages,
                totalPayments,
                hasNext: page < totalPages,
                hasPrev: page > 1
            },
            statusFilter: status,
            settings: {
                company_header: getSetting('company_header', 'GEMBOK'),
                footer_info: getSetting('footer_info', 'Portal Teknisi')
            },
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        logger.error('Error loading technician payments:', error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * Record Payment - Catat pembayaran yang diterima kolektor
 */
router.post('/payments/record', technicianAuth, async (req, res) => {
    try {
        // Cek role kolektor
        if (req.technician.role !== 'collector' && req.technician.role !== 'field_officer') {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const { invoice_id, amount, payment_method, reference_number, notes } = req.body;

        if (!invoice_id || !amount) {
            return res.status(400).json({
                success: false,
                message: 'Invoice ID dan jumlah pembayaran wajib diisi'
            });
        }


        const paymentId = await billingManager.recordCollectorPayment({
            collector_id: req.technician.id,
            invoice_id: parseInt(invoice_id),
            amount: parseFloat(amount),
            payment_method: payment_method || 'cash',
            reference_number: reference_number || null,
            notes: notes || null,
            commission_amount: 0 // Default for technicians who aren't in collectors table
        });

        // Log activity
        await authManager.logActivity(
            req.technician.id,
            'payment_record',
            `Mencatat pembayaran invoice #${invoice_id}`,
            { invoice_id, amount, payment_method }
        );

        res.json({
            success: true,
            message: 'Pembayaran berhasil dicatat',
            payment_id: paymentId
        });

    } catch (error) {
        logger.error('Error recording payment by collector:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mencatat pembayaran: ' + error.message
        });
    }
});

/**
 * HELPER FUNCTIONS
 */

async function getDashboardStats() {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT 
                (SELECT COUNT(*) FROM customers WHERE status = 'active') as active_customers,
                (SELECT COUNT(*) FROM customers WHERE status = 'suspended') as suspended_customers,
                (SELECT COUNT(*) FROM invoices WHERE status = 'unpaid') as unpaid_invoices,
                (SELECT COUNT(*) FROM invoices WHERE status = 'paid') as paid_invoices
        `;

        db.get(sql, [], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row || {});
            }
        });
    });
}

async function getRecentActivities(technicianId) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT * FROM technician_activities 
            WHERE technician_id = ? 
            ORDER BY created_at DESC 
            LIMIT 10
        `;

        db.all(sql, [technicianId], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows || []);
            }
        });
    });
}

async function getPendingTasks(role) {
    // Return different tasks based on role
    const tasks = [];

    if (role === 'technician' || role === 'field_officer') {
        tasks.push(
            { title: 'Laporan Gangguan Pending', count: 0, url: '/technician/troubletickets' },
            { title: 'Instalasi Baru', count: 0, url: '/technician/installations' }
        );
    }

    if (role === 'collector' || role === 'field_officer') {
        tasks.push(
            { title: 'Tagihan Belum Ditagih', count: 0, url: '/technician/payments' },
            { title: 'Pembayaran Pending Verifikasi', count: 0, url: '/technician/payments?status=pending' }
        );
    }

    return tasks;
}

async function getMonitoringData() {
    // Simplified monitoring data for technicians
    return {
        system_status: 'operational',
        active_connections: 0,
        total_bandwidth: '0 Mbps',
        last_updated: new Date().toISOString()
    };
}

async function getCustomersForTechnician(search, limit, offset) {
    return new Promise((resolve, reject) => {
        let sql = `
            SELECT c.*, p.name as package_name, p.speed as package_speed
            FROM customers c
            LEFT JOIN packages p ON c.package_id = p.id
        `;

        const params = [];

        if (search) {
            sql += ` WHERE c.name LIKE ? OR c.phone LIKE ? OR c.username LIKE ?`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        sql += ` ORDER BY c.join_date DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows || []);
            }
        });
    });
}

async function getTotalCustomers(search) {
    return new Promise((resolve, reject) => {
        let sql = `SELECT COUNT(*) as total FROM customers`;
        const params = [];

        if (search) {
            sql += ` WHERE name LIKE ? OR phone LIKE ? OR username LIKE ?`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row?.total || 0);
            }
        });
    });
}

async function getCustomersWithCoordinates() {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT c.*, p.name as package_name 
            FROM customers c
            LEFT JOIN packages p ON c.package_id = p.id
            WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
            ORDER BY c.name
        `;

        db.all(sql, [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows || []);
            }
        });
    });
}

// Helper function untuk instalasi baru
async function getInstallationRequests(search, limit, offset, status = 'pending') {
    return new Promise((resolve, reject) => {
        let sql = `
            SELECT c.*, p.name as package_name, p.speed as package_speed
            FROM customers c
            LEFT JOIN packages p ON c.package_id = p.id
            WHERE c.status = ?
        `;

        const params = [status];

        if (search) {
            sql += ` AND (c.name LIKE ? OR c.phone LIKE ? OR c.username LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        sql += ` ORDER BY c.join_date DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows || []);
            }
        });
    });
}

async function getTotalInstallations(search, status = 'pending') {
    return new Promise((resolve, reject) => {
        let sql = `SELECT COUNT(*) as total FROM customers WHERE status = ?`;
        const params = [status];

        if (search) {
            sql += ` AND (name LIKE ? OR phone LIKE ? OR username LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row?.total || 0);
            }
        });
    });
}

// Helper function untuk trouble tickets
async function getTroubleReportsForTechnician(technicianId, role) {
    // Import trouble report functions
    try {
        const { getAllTroubleReports } = require('../config/troubleReport');
        const allReports = getAllTroubleReports();

        // Filter berdasarkan role teknisi
        if (role === 'technician') {
            // Teknisi hanya melihat laporan yang assigned ke dia atau belum di-assign
            return allReports.filter(report =>
                !report.assigned_technician_id ||
                report.assigned_technician_id === technicianId
            );
        } else if (role === 'field_officer') {
            // Field officer bisa melihat semua laporan
            return allReports;
        } else {
            // Role lain (collector) hanya melihat laporan terbatas
            return allReports.filter(report => report.status === 'resolved' || report.status === 'closed');
        }
    } catch (error) {
        console.error('Error loading trouble reports:', error);
        return [];
    }
}

// Helper function to check if technician can access a specific report
async function canTechnicianAccessReport(technicianId, role, report) {
    try {
        // Field officer can access all reports
        if (role === 'field_officer') {
            return true;
        }

        // Technician can access unassigned reports or reports assigned to them
        if (role === 'technician') {
            return !report.assigned_technician_id || report.assigned_technician_id === technicianId;
        }

        // Collector can access resolved/closed reports
        if (role === 'collector') {
            return report.status === 'resolved' || report.status === 'closed';
        }

        // Default: no access
        return false;
    } catch (error) {
        console.error('Error checking technician access:', error);
        return false;
    }
}

async function updateTroubleTicketStatus(ticketId, status, notes, technicianId) {
    try {
        const { updateTroubleReportStatus } = require('../config/troubleReport');

        // Format catatan dengan informasi teknisi
        const technicianNote = notes ? `[Teknisi]: ${notes}` : '';

        // Call the function with the correct parameter signature
        return updateTroubleReportStatus(ticketId, status, technicianNote, true);
    } catch (error) {
        console.error('Error updating trouble ticket:', error);
        return false;
    }
}

async function getPaymentsForCollector(collectorId, status, limit, offset) {
    return new Promise((resolve, reject) => {
        let sql = `
            SELECT cp.*, i.invoice_number, i.amount as invoice_amount, 
                   c.name as customer_name, c.phone as customer_phone
            FROM collector_payments cp
            JOIN invoices i ON cp.invoice_id = i.id
            JOIN customers c ON i.customer_id = c.id
            WHERE cp.collector_id = ?
        `;

        const params = [collectorId];

        if (status !== 'all') {
            sql += ` AND cp.status = ?`;
            params.push(status);
        }

        sql += ` ORDER BY cp.created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows || []);
            }
        });
    });
}

async function getTotalPaymentsForCollector(collectorId, status) {
    return new Promise((resolve, reject) => {
        let sql = `SELECT COUNT(*) as total FROM collector_payments WHERE collector_id = ?`;
        const params = [collectorId];

        if (status !== 'all') {
            sql += ` AND status = ?`;
            params.push(status);
        }

        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row?.total || 0);
            }
        });
    });
}

async function getPaymentStatsForCollector(collectorId) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT 
                COUNT(*) as total_payments,
                SUM(amount) as total_amount,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
                COUNT(CASE WHEN status = 'verified' THEN 1 END) as verified_count
            FROM collector_payments 
            WHERE collector_id = ?
        `;

        db.get(sql, [collectorId], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row || {});
            }
        });
    });
}

function generateUsername(name, phone) {
    // Generate username dari nama dan nomor telepon
    const cleanName = name.toLowerCase().replace(/[^a-z]/g, '');
    const phoneDigits = phone.slice(-4);
    return `${cleanName}${phoneDigits}`;
}

function normalizePhone(phone) {
    if (!phone) return '';
    let p = String(phone).trim();
    p = p.replace(/\D/g, '');
    if (p.startsWith('0')) p = '62' + p.slice(1);
    if (!p.startsWith('62')) p = '62' + p;
    return p;
}

// Update installation job status
router.post('/installations/update-status', async (req, res) => {
    try {
        const { jobId, status, notes } = req.body;

        if (!jobId || !status) {
            return res.status(400).json({
                success: false,
                message: 'Job ID dan status diperlukan'
            });
        }

        // Validate status
        const validStatuses = ['scheduled', 'assigned', 'in_progress', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Status tidak valid'
            });
        }

        // Get current job data first
        const currentJob = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM installation_jobs WHERE id = ?', [jobId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!currentJob) {
            return res.status(404).json({
                success: false,
                message: 'Job instalasi tidak ditemukan'
            });
        }

        // Update installation job status
        const updateQuery = `
            UPDATE installation_jobs 
            SET status = ?, 
                notes = COALESCE(?, notes),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;

        db.run(updateQuery, [status, notes || null, jobId], function (err) {
            if (err) {
                console.error('Error updating installation status:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Gagal mengupdate status instalasi'
                });
            }

            if (this.changes === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Job instalasi tidak ditemukan'
                });
            }

            // Log the status change
            console.log(`Installation job ${jobId} status updated to ${status}`);

            // Send WhatsApp notification to technician about status update
            (async () => {
                try {
                    const whatsappNotifications = require('../config/whatsapp-notifications');

                    // Get technician details
                    const technician = await new Promise((resolve, reject) => {
                        db.get('SELECT id, name, phone, role FROM technicians WHERE id = ?', [req.session.technicianId], (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });

                    if (technician) {
                        // Prepare customer data
                        const customer = {
                            name: currentJob.customer_name,
                            phone: currentJob.customer_phone,
                            address: currentJob.customer_address
                        };

                        // Send status update notification
                        const notificationResult = await whatsappNotifications.sendInstallationStatusUpdateNotification(
                            technician,
                            currentJob,
                            customer,
                            status,
                            notes
                        );

                        if (notificationResult.success) {
                            console.log(`WhatsApp status update notification sent to technician ${technician.name} for job ${currentJob.job_number}`);
                        } else {
                            console.warn(`Failed to send WhatsApp status update notification to technician ${technician.name}:`, notificationResult.error);
                        }

                        // If installation is completed, send completion notification
                        if (status === 'completed') {
                            const completionNotificationResult = await whatsappNotifications.sendInstallationCompletionNotification(
                                technician,
                                currentJob,
                                customer,
                                notes
                            );

                            if (completionNotificationResult.success) {
                                console.log(`WhatsApp completion notification sent to technician ${technician.name} for job ${currentJob.job_number}`);
                            } else {
                                console.warn(`Failed to send WhatsApp completion notification to technician ${technician.name}:`, notificationResult.error);
                            }
                        }
                    }

                } catch (notificationError) {
                    console.error('Error sending WhatsApp notification:', notificationError);
                    // Don't fail the status update if notification fails
                }
            })();

            res.json({
                success: true,
                message: 'Status instalasi berhasil diupdate',
                data: {
                    jobId,
                    status,
                    notes,
                    updatedAt: new Date().toISOString()
                }
            });
        });

    } catch (error) {
        console.error('Error in update installation status:', error);
        res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan server'
        });
    }
});

// ===== ENHANCEMENT: CACHE MONITORING API FOR TECHNICIAN =====

// API endpoint untuk monitoring cache performance
router.get('/genieacs/api/cache-stats', technicianAuth, async (req, res) => {
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
router.post('/genieacs/api/cache-clear', technicianAuth, async (req, res) => {
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

/**
 * API ROUTES FOR DASHBOARD STATS
 */

// API: GenieACS Stats untuk dashboard
router.get('/api/genieacs-stats', technicianAuth, async (req, res) => {
    try {
        const { getDevicesCached } = require('../config/genieacs');
        const devices = await getDevicesCached();

        const total = devices.length;
        const now = Date.now();
        const online = devices.filter(dev => dev._lastInform && (now - new Date(dev._lastInform).getTime()) < 3600 * 1000).length;
        const offline = total - online;

        res.json({
            success: true,
            total,
            online,
            offline
        });
    } catch (error) {
        logger.error('Error getting GenieACS stats:', error);
        res.json({
            success: false,
            total: 0,
            online: 0,
            offline: 0
        });
    }
});

// API: Customer Stats untuk dashboard
router.get('/api/customer-stats', technicianAuth, async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const total = customers.length;

        res.json({
            success: true,
            total
        });
    } catch (error) {
        logger.error('Error getting customer stats:', error);
        res.json({
            success: false,
            total: 0
        });
    }
});

/**
 * MAPPING ROUTES
 */

/**
 * Mapping Network untuk Teknisi
 */
router.get('/mobile/mapping', technicianAuth, async (req, res) => {
    try {
        // Log activity
        await authManager.logActivity(req.technician.id, 'mapping_access', 'Mengakses network mapping');

        res.render('technician/mapping', {
            title: 'Network Mapping - Teknisi',
            technician: req.technician,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        logger.error('Error loading technician mapping:', error);
        res.status(500).send('Internal Server Error');
    }
});

// API: Mapping data untuk teknisi (menggunakan data real dari database seperti admin)
router.get('/api/mapping-data', technicianAuth, async (req, res) => {
    try {
        // Fix database connection issue
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);

        // Get ODPs data from database
        const odps = await new Promise((resolve, reject) => {
            db.all(`
                SELECT o.id, o.name, o.code, o.capacity, o.used_ports, o.status,
                       o.latitude, o.longitude, o.address, o.notes
                FROM odps o
                WHERE o.latitude IS NOT NULL AND o.longitude IS NOT NULL
                ORDER BY o.name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Get cables data from database (sesuai struktur tabel yang sebenarnya)
        const cables = await new Promise((resolve, reject) => {
            db.all(`
                SELECT c.id, c.customer_id, c.odp_id, c.cable_length, c.cable_type,
                       c.status, c.port_number, c.notes,
                       o.name as odp_name, o.latitude as odp_lat, o.longitude as odp_lng,
                       cust.name as customer_name, cust.latitude as customer_lat, cust.longitude as customer_lng
                FROM cable_routes c
                LEFT JOIN odps o ON c.odp_id = o.id
                LEFT JOIN customers cust ON c.customer_id = cust.id
                WHERE o.latitude IS NOT NULL AND o.longitude IS NOT NULL
                  AND cust.latitude IS NOT NULL AND cust.longitude IS NOT NULL
                ORDER BY c.id
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Get backbone data from database (menggunakan odp_connections table untuk routing antar ODP)
        const backbone = await new Promise((resolve, reject) => {
            db.all(`
                SELECT oc.id, CONCAT('ODP-', oc.from_odp_id, '-', oc.to_odp_id) as name, 
                       oc.from_odp_id, oc.to_odp_id, oc.connection_type, oc.cable_length,
                       oc.status, oc.cable_capacity, oc.notes,
                       o1.name as start_odp_name, o1.latitude as start_lat, o1.longitude as start_lng,
                       o2.name as end_odp_name, o2.latitude as end_lat, o2.longitude as end_lng
                FROM odp_connections oc
                LEFT JOIN odps o1 ON oc.from_odp_id = o1.id
                LEFT JOIN odps o2 ON oc.to_odp_id = o2.id
                WHERE o1.latitude IS NOT NULL AND o1.longitude IS NOT NULL
                  AND o2.latitude IS NOT NULL AND o2.longitude IS NOT NULL
                ORDER BY oc.id
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Get customers data with real coordinates from database
        const customers = await new Promise((resolve, reject) => {
            db.all(`
                SELECT c.id, c.name, c.phone, c.email, c.address, c.latitude, c.longitude,
                       c.pppoe_username, c.status, c.package_id, c.odp_id,
                       o.name as odp_name
                FROM customers c
                LEFT JOIN odps o ON c.odp_id = o.id
                WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
                ORDER BY c.name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Format cables for map (sesuai struktur tabel cable_routes)
        const formattedCables = cables.map(cable => ({
            id: cable.id,
            name: `Cable-${cable.id}`,
            start_lat: cable.odp_lat,
            start_lng: cable.odp_lng,
            end_lat: cable.customer_lat,
            end_lng: cable.customer_lng,
            length: cable.cable_length,
            type: cable.cable_type,
            status: cable.status,
            from_odp: cable.odp_name,
            to_customer: cable.customer_name
        }));

        // Generate cables dynamically from customers and ODPs
        const dynamicCables = customers
            .filter(cust => cust.odp_id && cust.latitude && cust.longitude)
            .map(cust => {
                const odp = odps.find(o => o.id === cust.odp_id);
                if (!odp) return null;
                return {
                    id: `odp${odp.id}-cust${cust.id}`,
                    name: `Cable-ODP${odp.id}-CUST${cust.id}`,
                    start_lat: odp.latitude,
                    start_lng: odp.longitude,
                    end_lat: cust.latitude,
                    end_lng: cust.longitude,
                    from_odp: odp.name,
                    to_customer: cust.name,
                    status: cust.status
                };
            })
            .filter(Boolean);

        // Format backbone for map (sesuai struktur tabel odp_connections)
        const formattedBackbone = backbone.map(backboneItem => ({
            id: backboneItem.id,
            name: backboneItem.name,
            start_lat: backboneItem.start_lat,
            start_lng: backboneItem.start_lng,
            end_lat: backboneItem.end_lat,
            end_lng: backboneItem.end_lng,
            length: backboneItem.cable_length,
            type: backboneItem.connection_type,
            status: backboneItem.status,
            capacity: backboneItem.cable_capacity,
            from_odp: backboneItem.start_odp_name,
            to_odp: backboneItem.end_odp_name
        }));

        logger.info(`✅ Loaded mapping data: ${odps.length} ODPs, ${customers.length} customers, ${dynamicCables.length} cables, ${formattedBackbone.length} backbone routes`);

        // Close database connection
        db.close();

        res.json({
            success: true,
            data: {
                odps: odps,
                customers: customers,
                cables: dynamicCables,
                backbone: formattedBackbone
            }
        });
    } catch (error) {
        // Ensure database is closed on error
        try {
            if (db) db.close();
        } catch (closeError) {
            logger.error('Error closing database:', closeError);
        }

        logger.error('Error getting mapping data:', error);
        res.json({
            success: false,
            message: 'Failed to load mapping data: ' + error.message
        });
    }
});

// TEST: Mapping data tanpa authentication (untuk debugging)
router.get('/api/test-mapping-data', async (req, res) => {
    try {
        // Fix database connection issue
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);

        // Get ODPs data from database
        const odps = await new Promise((resolve, reject) => {
            db.all(`SELECT * FROM odps WHERE latitude IS NOT NULL AND longitude IS NOT NULL`, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Close database connection
        db.close();

        console.log(`✅ Test mapping data: ${odps.length} ODPs found`);

        res.json({
            success: true,
            data: {
                odps: odps,
                message: `${odps.length} ODPs loaded successfully`
            }
        });
    } catch (error) {
        console.error('Test mapping error:', error);
        res.json({
            success: false,
            message: 'Test mapping failed: ' + error.message
        });
    }
});

/**
 * MONITORING ROUTES
 */

/**
 * Device Monitoring untuk Teknisi
 */
router.get('/mobile/monitoring', technicianAuth, async (req, res) => {
    try {
        // Log activity
        await authManager.logActivity(req.technician.id, 'monitoring_access', 'Mengakses device monitoring');

        res.render('technician/monitoring', {
            title: 'Device Monitoring - Teknisi',
            technician: req.technician,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        logger.error('Error loading technician monitoring:', error);
        res.status(500).send('Internal Server Error');
    }
});

// API: Monitoring data untuk teknisi
router.get('/api/monitoring-data', technicianAuth, async (req, res) => {
    try {
        const { getDevicesCached } = require('../config/genieacs');
        const devicesRaw = await getDevicesCached();

        // ParameterPaths yang sama dengan admin GenieACS
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

        // Helper function untuk mengambil parameter dengan multiple paths
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
            return 'N/A';
        }

        // Helper function untuk menentukan status device
        function getDeviceStatus(lastInform) {
            if (!lastInform) return 'Offline';
            const lastInformTime = new Date(lastInform);
            const now = new Date();
            const diffMinutes = (now - lastInformTime) / (1000 * 60);
            return diffMinutes <= 60 ? 'Online' : 'Offline';
        }

        // Process devices data dengan parameter lengkap
        const devices = devicesRaw.map(device => {
            const status = getDeviceStatus(device._lastInform);

            return {
                _id: device._id,
                id: device._id,
                serialNumber: getParameterWithPaths(device, parameterPaths.serialNumber),
                model: getParameterWithPaths(device, parameterPaths.model),
                status: status,
                isOnline: status === 'Online',
                lastInform: device._lastInform,
                lastInformFormatted: device._lastInform ? new Date(device._lastInform).toLocaleString('id-ID') : 'N/A',
                username: getParameterWithPaths(device, parameterPaths.pppUsername),
                pppoeUsername: getParameterWithPaths(device, parameterPaths.pppUsername),
                rxPower: getParameterWithPaths(device, parameterPaths.rxPower),
                ssid: getParameterWithPaths(device, parameterPaths.ssid),
                password: getParameterWithPaths(device, parameterPaths.password),
                userConnected: getParameterWithPaths(device, parameterPaths.userConnected),
                tag: getParameterWithPaths(device, parameterPaths.deviceTags)
            };
        });

        // Calculate statistics
        const statistics = {
            total: devices.length,
            online: devices.filter(d => d.isOnline).length,
            offline: devices.filter(d => !d.isOnline).length
        };

        res.json({
            success: true,
            devices,
            statistics
        });
    } catch (error) {
        logger.error('Error getting monitoring data:', error);
        res.json({
            success: false,
            message: 'Failed to load monitoring data'
        });
    }
});

/**
 * CUSTOMER MANAGEMENT ROUTES
 */

/**
 * Customer Management untuk Teknisi
 */
router.get('/mobile/customers', technicianAuth, async (req, res) => {
    try {
        // Log activity
        await authManager.logActivity(req.technician.id, 'customers_access', 'Mengakses customer management');

        res.render('technician/customers', {
            title: 'Customer Management - Teknisi',
            technician: req.technician,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        logger.error('Error loading technician customers:', error);
        res.status(500).send('Internal Server Error');
    }
});

// API: Customer data untuk teknisi
router.get('/api/customer-data', technicianAuth, async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();

        // Calculate statistics
        const statistics = {
            total: customers.length,
            active: customers.filter(c => c.status === 'active').length,
            suspended: customers.filter(c => c.status === 'suspended').length,
            pending: customers.filter(c => c.status === 'pending').length
        };

        res.json({
            success: true,
            customers,
            statistics
        });
    } catch (error) {
        logger.error('Error getting customer data:', error);
        res.json({
            success: false,
            message: 'Failed to load customer data'
        });
    }
});

// API: Suspend customer (untuk teknisi)
router.post('/api/suspend-customer/:customerId', technicianAuth, async (req, res) => {
    try {
        const { customerId } = req.params;

        // Get customer data
        const customer = await billingManager.getCustomerById(customerId);
        if (!customer) {
            return res.json({
                success: false,
                message: 'Customer not found'
            });
        }

        // Use service suspension system
        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.suspendCustomerService(customer);

        if (result.success) {
            // Log activity
            await authManager.logActivity(req.technician.id, 'customer_suspend', `Suspended customer ${customer.username || customer.pppoe_username}`, {
                customerId,
                customerUsername: customer.username || customer.pppoe_username
            });

            res.json({
                success: true,
                message: 'Customer suspended successfully'
            });
        } else {
            res.json({
                success: false,
                message: result.message || 'Failed to suspend customer'
            });
        }
    } catch (error) {
        logger.error('Error suspending customer:', error);
        res.json({
            success: false,
            message: 'Failed to suspend customer'
        });
    }
});

// API: Restore customer (untuk teknisi)
router.post('/api/restore-customer/:customerId', technicianAuth, async (req, res) => {
    try {
        const { customerId } = req.params;

        // Get customer data
        const customer = await billingManager.getCustomerById(customerId);
        if (!customer) {
            return res.json({
                success: false,
                message: 'Customer not found'
            });
        }

        // Use service suspension system
        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.restoreCustomerService(customer);

        if (result.success) {
            // Log activity
            await authManager.logActivity(req.technician.id, 'customer_restore', `Restored customer ${customer.username || customer.pppoe_username}`, {
                customerId,
                customerUsername: customer.username || customer.pppoe_username
            });

            res.json({
                success: true,
                message: 'Customer restored successfully'
            });
        } else {
            res.json({
                success: false,
                message: result.message || 'Failed to restore customer'
            });
        }
    } catch (error) {
        logger.error('Error restoring customer:', error);
        res.json({
            success: false,
            message: 'Failed to restore customer'
        });
    }
});

/**
 * MOBILE ROUTES
 */

/**
 * Mobile Dashboard Teknisi
 */
router.get('/mobile/dashboard', technicianAuth, async (req, res) => {
    try {
        // Get the same data as admin dashboard but with technician context
        let genieacsTotal = 0, genieacsOnline = 0, genieacsOffline = 0;
        let mikrotikTotal = 0, mikrotikAktif = 0, mikrotikOffline = 0;
        let settings = {};

        try {
            // Import functions for dashboard data
            const { getDevices } = require('../config/genieacs');
            const { getActivePPPoEConnections, getInactivePPPoEUsers } = require('../config/mikrotik');
            const { getSettingsWithCache } = require('../config/settingsManager');

            // Baca settings.json
            settings = getSettingsWithCache();

            // GenieACS data
            const { getDevicesCached } = require('../config/genieacs');
            const devices = await getDevicesCached();
            genieacsTotal = devices.length;
            const now = Date.now();
            genieacsOnline = devices.filter(dev => dev._lastInform && (now - new Date(dev._lastInform).getTime()) < 3600 * 1000).length;
            genieacsOffline = genieacsTotal - genieacsOnline;

            // Mikrotik data
            const aktifResult = await getActivePPPoEConnections();
            mikrotikAktif = aktifResult.success ? aktifResult.data.length : 0;
            const offlineResult = await getInactivePPPoEUsers();
            mikrotikOffline = offlineResult.success ? offlineResult.totalInactive : 0;
            mikrotikTotal = (offlineResult.success ? offlineResult.totalSecrets : 0);

        } catch (e) {
            console.error('Error getting dashboard data for technician mobile:', e);
            // Use default values if error
        }

        // Log activity
        await authManager.logActivity(req.technician.id, 'mobile_dashboard_access', 'Mengakses mobile dashboard');

        // Render mobile dashboard
        res.render('technician/dashboard', {
            title: 'Dashboard Teknisi',
            page: 'dashboard',
            genieacsTotal,
            genieacsOnline,
            genieacsOffline,
            mikrotikTotal,
            mikrotikAktif,
            mikrotikOffline,
            settings,
            technician: req.technician,
            isTechnicianView: true,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        logger.error('Error loading technician mobile dashboard:', error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * Mobile Monitoring Teknisi
 */
router.get('/mobile/monitoring', technicianAuth, async (req, res) => {
    try {
        // Get the same data as admin GenieACS page
        const { getDevices } = require('../config/genieacs');
        const { getSettingsWithCache } = require('../config/settingsManager');

        // Get devices data
        const { getDevicesCached } = require('../config/genieacs');
        const devicesRaw = await getDevicesCached();

        // Use the exact same parameter paths as admin GenieACS
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

        // Use the exact same getParameterWithPaths function as admin
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

        // Map devices data exactly like admin GenieACS
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

        // Calculate statistics
        const genieacsTotal = devicesRaw.length;
        const now = Date.now();
        const genieacsOnline = devicesRaw.filter(dev => dev._lastInform && (now - new Date(dev._lastInform).getTime()) < 3600 * 1000).length;
        const genieacsOffline = genieacsTotal - genieacsOnline;
        const settings = getSettingsWithCache();

        // Log activity
        await authManager.logActivity(req.technician.id, 'mobile_monitoring_access', 'Mengakses mobile monitoring');

        // Render mobile monitoring
        res.render('technician/monitoring', {
            title: 'Monitoring Device - Portal Teknisi',
            devices,
            settings,
            genieacsTotal,
            genieacsOnline,
            genieacsOffline,
            isTechnicianView: true,
            technician: req.technician,
            technicianRole: req.technician.role,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        logger.error('Error loading technician mobile monitoring:', error);
        res.render('technician/monitoring', {
            title: 'Monitoring Device - Portal Teknisi',
            devices: [],
            settings: {},
            genieacsTotal: 0,
            genieacsOnline: 0,
            genieacsOffline: 0,
            error: 'Gagal mengambil data device.',
            isTechnicianView: true,
            technician: req.technician,
            technicianRole: req.technician.role,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    }
});

/**
 * Mobile Customers Teknisi
 */
router.get('/mobile/customers', technicianAuth, async (req, res) => {
    try {
        // Ambil data customers & packages
        const allCustomers = await billingManager.getCustomers();
        const packages = await billingManager.getPackages();

        // Get ODPs for dropdown selection (termasuk sub ODP)
        const odps = await new Promise((resolve, reject) => {
            const db = getDb();
            db.all(`
                SELECT o.id, o.name, o.code, o.capacity, o.used_ports, o.status, o.parent_odp_id,
                       p.name as parent_name, p.code as parent_code
                FROM odps o
                LEFT JOIN odps p ON o.parent_odp_id = p.id
                WHERE o.status = 'active' 
                ORDER BY p.name, o.name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Query params untuk pencarian & pagination
        const search = (req.query.search || '').trim();
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = 20;

        // Filter sederhana di sisi server (name/phone/username)
        const filtered = !search
            ? allCustomers
            : allCustomers.filter(c => {
                const s = search.toLowerCase();
                return (
                    (c.name || '').toLowerCase().includes(s) ||
                    (c.phone || '').toLowerCase().includes(s) ||
                    (c.username || '').toLowerCase().includes(s)
                );
            });

        const totalCustomers = filtered.length;
        const totalPages = Math.max(1, Math.ceil(totalCustomers / limit));
        const currentPage = Math.min(page, totalPages);
        const offset = (currentPage - 1) * limit;
        const customers = filtered.slice(offset, offset + limit);

        // Log activity
        await authManager.logActivity(req.technician.id, 'mobile_customers_access', 'Mengakses mobile pelanggan');

        // Render mobile customers
        res.render('technician/customers', {
            title: 'Kelola Pelanggan - Portal Teknisi',
            page: 'customers',
            customers,
            packages,
            odps,
            search,
            pagination: {
                currentPage,
                totalPages,
                totalCustomers,
                hasNext: currentPage < totalPages,
                hasPrev: currentPage > 1
            },
            settings: {
                company_header: getSetting('company_header', 'GEMBOK'),
                footer_info: getSetting('footer_info', 'Portal Teknisi'),
                logo_filename: getSetting('logo_filename', 'logo.png')
            },
            isTechnicianView: true,
            technician: req.technician,
            technicianRole: req.technician.role,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        logger.error('Error loading technician mobile customers:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Route untuk Tukang Tagih (Collectors)
router.get('/collectors', technicianAuth, async (req, res) => {
    try {
        // Get collectors data untuk technician
        const collectors = await new Promise((resolve, reject) => {
            const query = `
                SELECT c.*, 
                       COUNT(cp.id) as total_payments,
                       SUM(cp.amount) as total_amount
                FROM collectors c
                LEFT JOIN collector_payments cp ON c.id = cp.collector_id
                GROUP BY c.id
                ORDER BY c.name ASC
            `;
            db.all(query, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Log activity
        await authManager.logActivity(req.technician.id, 'collectors_access', 'Mengakses halaman tukang tagih');

        res.render('technician/collectors', {
            title: 'Tukang Tagih - Portal Teknisi',
            technician: req.technician,
            collectors: collectors,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        console.error('Error loading collectors:', error);
        res.status(500).render('error', {
            message: 'Gagal memuat data tukang tagih',
            error: error
        });
    }
});

// Route untuk Settings/Pengaturan
router.get('/settings', technicianAuth, async (req, res) => {
    try {
        // Log activity
        await authManager.logActivity(req.technician.id, 'settings_access', 'Mengakses halaman pengaturan');

        res.render('technician/settings', {
            title: 'Pengaturan - Portal Teknisi',
            technician: req.technician,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        console.error('Error loading settings:', error);
        res.status(500).render('error', {
            message: 'Gagal memuat halaman pengaturan',
            error: error
        });
    }
});

// Route untuk update password
router.post('/settings/update-password', technicianAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        // Validasi input
        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Semua field harus diisi'
            });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Password baru dan konfirmasi password tidak sama'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password baru minimal 6 karakter'
            });
        }

        // Verify current password
        const technician = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM technicians WHERE id = ?', [req.technician.id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!technician) {
            return res.status(404).json({
                success: false,
                message: 'Teknisi tidak ditemukan'
            });
        }

        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, technician.password);
        if (!isCurrentPasswordValid) {
            return res.status(400).json({
                success: false,
                message: 'Password lama tidak benar'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await new Promise((resolve, reject) => {
            db.run('UPDATE technicians SET password = ? WHERE id = ?', [hashedPassword, req.technician.id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Log activity
        await authManager.logActivity(req.technician.id, 'password_change', 'Mengubah password');

        res.json({
            success: true,
            message: 'Password berhasil diubah'
        });
    } catch (error) {
        console.error('Error updating password:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengubah password'
        });
    }
});

module.exports = router;

