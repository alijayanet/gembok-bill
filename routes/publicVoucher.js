const express = require('express');
const router = express.Router();
const { getHotspotProfiles } = require('../config/mikrotik');
const { getSettingsWithCache } = require('../config/settingsManager');
const billingManager = require('../config/billing');
const logger = require('../config/logger');

// Helper function to get color based on price
function getPriceColor(price) {
    if (price <= 5000) return 'primary';
    if (price <= 10000) return 'success';
    if (price <= 20000) return 'info';
    if (price <= 30000) return 'warning';
    return 'danger';
}

// Helper function untuk mendapatkan customer_id voucher publik
async function getVoucherCustomerId() {
    return new Promise((resolve, reject) => {
        billingManager.db.get('SELECT id FROM customers WHERE username = ?', ['voucher_public'], (err, row) => {
            if (err) {
                reject(err);
            } else if (row) {
                resolve(row.id);
            } else {
                // Jika tidak ada, buat customer voucher baru dengan ID yang aman (1021)
                billingManager.db.run(`
                    INSERT INTO customers (id, username, name, phone, email, address, package_id, status, join_date, 
                                          pppoe_username, pppoe_profile, auto_suspension, billing_day, 
                                          latitude, longitude, created_by_technician_id, static_ip, mac_address, assigned_ip)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    1021, // ID yang aman, jauh dari range billing (1000+)
                    'voucher_public', 'Voucher Publik', '0000000000', 'voucher@public.com', 'Sistem Voucher Publik',
                    1, 'active', new Date().toISOString(), 'voucher_public', 'voucher', 0, 1,
                    0, 0, null, null, null, null
                ], function (err) {
                    if (err) reject(err);
                    else resolve(this.lastID || 1021);
                });
            }
        });
    });
}

// Helper function untuk mengambil setting voucher online
async function getVoucherOnlineSettings() {
    return new Promise((resolve, reject) => {
        // Coba ambil dari tabel voucher_online_settings jika ada
        billingManager.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='voucher_online_settings'", (err, row) => {
            if (err) {
                console.error('Error checking voucher_online_settings table:', err);
                resolve({}); // Return empty object jika error
                return;
            }

            if (row) {
                // Tabel ada, ambil data
                billingManager.db.all('SELECT * FROM voucher_online_settings', (err, rows) => {
                    if (err) {
                        console.error('Error getting voucher online settings:', err);
                        resolve({});
                        return;
                    }

                    const settings = {};
                    rows.forEach(row => {
                        settings[row.package_id] = {
                            name: row.name || `${row.package_id} - Paket`,
                            profile: row.profile,
                            digits: row.digits || 5,
                            price: row.price || 0,
                            duration: row.duration || 24,
                            duration_type: row.duration_type || 'hours',
                            enabled: row.enabled === 1
                        };
                    });

                    resolve(settings);
                });
            } else {
                // Tabel belum ada, buat default settings
                console.log('voucher_online_settings table not found, using default settings');
                resolve({
                    '3k': { profile: '3k', enabled: true, price: 3000, duration: 24, duration_type: 'hours' },
                    '5k': { profile: '5k', enabled: true, price: 5000, duration: 48, duration_type: 'hours' },
                    '10k': { profile: '10k', enabled: true, price: 10000, duration: 120, duration_type: 'hours' },
                    '15k': { profile: '15k', enabled: true, price: 15000, duration: 192, duration_type: 'hours' },
                    '25k': { profile: '25k', enabled: true, price: 25000, duration: 360, duration_type: 'hours' },
                    '50k': { profile: '50k', enabled: true, price: 50000, duration: 720, duration_type: 'hours' }
                });
            }
        });
    });
}

// Test route
router.get('/test', (req, res) => {
    res.json({ success: true, message: 'Voucher router works!' });
});

// GET: API untuk payment methods (sama dengan invoice)
router.get('/api/payment-methods', async (req, res) => {
    try {
        const PaymentGatewayManager = require('../config/paymentGateway');
        const paymentGateway = new PaymentGatewayManager();

        const methods = await paymentGateway.getAvailablePaymentMethods();

        res.json({
            success: true,
            methods: methods
        });
    } catch (error) {
        console.error('Error getting payment methods:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting payment methods',
            error: error.message
        });
    }
});

// GET: Halaman voucher publik
router.get('/', async (req, res) => {
    try {
        // Ambil profile hotspot
        const profilesResult = await getHotspotProfiles();
        let profiles = [];
        if (profilesResult.success && Array.isArray(profilesResult.data)) {
            profiles = profilesResult.data;
        }

        // Ambil settings
        const settings = getSettingsWithCache();

        // Ambil settings voucher online dari database
        const voucherSettings = await getVoucherOnlineSettings();

        // Ambil paket voucher dari database voucher_pricing
        const voucherPackagesFromDB = await new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM voucher_pricing WHERE is_active = 1 ORDER BY customer_price ASC';
            billingManager.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });


        // Format paket dari database atau gunakan data dari voucher_online_settings jika tidak ada
        let allPackages;
        if (Object.keys(voucherSettings).length > 0) {
            // Gunakan data dari voucher_online_settings (prioritas utama)
            allPackages = Object.keys(voucherSettings).map(packageId => {
                const setting = voucherSettings[packageId];
                // Format nama paket berdasarkan nama yang disimpan di database
                const packageName = setting.name || `${packageId} - Paket`;
                // Format durasi menggunakan data dari database
                const durationText = getDurationText(packageId, setting.duration, setting.duration_type);

                return {
                    id: packageId,
                    name: packageName,
                    duration: durationText,
                    duration_value: setting.duration || 24,
                    duration_type: setting.duration_type || 'hours',
                    price: setting.price || 0,
                    profile: setting.profile || 'default',
                    description: packageName,
                    color: getPriceColor(setting.price || 0),
                    enabled: setting.enabled !== false
                };
            });
        } else if (voucherPackagesFromDB.length > 0) {
            // Fallback ke data dari voucher_pricing jika voucher_online_settings kosong
            allPackages = voucherPackagesFromDB.map(pkg => {
                // Format durasi menggunakan data dari database
                const durationText = getDurationText(pkg.package_id || `pkg-${pkg.id}`, pkg.duration, pkg.duration_type);

                // Format harga
                const price = pkg.customer_price;

                // Format nama paket
                const packageName = pkg.package_name;

                return {
                    id: `pkg-${pkg.id}`,
                    name: packageName,
                    duration: durationText,
                    duration_value: pkg.duration || 24,
                    duration_type: pkg.duration_type || 'hours',
                    price: price,
                    profile: pkg.hotspot_profile || 'default',
                    description: pkg.description || `Voucher ${packageName}`,
                    color: getPriceColor(price),
                    enabled: true
                };
            });
        } else {
            // Fallback ke data hardcoded jika kedua tabel kosong
            allPackages = [
                {
                    id: '3k',
                    name: '3rb - 1 Hari',
                    duration: getDurationText('3k'),
                    duration_value: 24,
                    duration_type: 'hours',
                    price: 3000,
                    profile: voucherSettings['3k']?.profile || '3k',
                    description: 'Akses WiFi 1 hari penuh',
                    color: 'primary',
                    enabled: voucherSettings['3k']?.enabled !== false
                },
                {
                    id: '5k',
                    name: '5rb - 2 Hari',
                    duration: getDurationText('5k'),
                    duration_value: 48,
                    duration_type: 'hours',
                    price: 5000,
                    profile: voucherSettings['5k']?.profile || '5k',
                    description: 'Akses WiFi 2 hari penuh',
                    color: 'success',
                    enabled: voucherSettings['5k']?.enabled !== false
                },
                {
                    id: '10k',
                    name: '10rb - 5 Hari',
                    duration: getDurationText('10k'),
                    duration_value: 120,
                    duration_type: 'hours',
                    price: 10000,
                    profile: voucherSettings['10k']?.profile || '10k',
                    description: 'Akses WiFi 5 hari penuh',
                    color: 'info',
                    enabled: voucherSettings['10k']?.enabled !== false
                },
                {
                    id: '15k',
                    name: '15rb - 8 Hari',
                    duration: getDurationText('15k'),
                    duration_value: 192,
                    duration_type: 'hours',
                    price: 15000,
                    profile: voucherSettings['15k']?.profile || '15k',
                    description: 'Akses WiFi 8 hari penuh',
                    color: 'warning',
                    enabled: voucherSettings['15k']?.enabled !== false
                },
                {
                    id: '25k',
                    name: '25rb - 15 Hari',
                    duration: getDurationText('25k'),
                    duration_value: 360,
                    duration_type: 'hours',
                    price: 25000,
                    profile: voucherSettings['25k']?.profile || '25k',
                    description: 'Akses WiFi 15 hari penuh',
                    color: 'danger',
                    enabled: voucherSettings['25k']?.enabled !== false
                },
                {
                    id: '50k',
                    name: '50rb - 30 Hari',
                    duration: getDurationText('50k'),
                    duration_value: 720,
                    duration_type: 'hours',
                    price: 50000,
                    profile: voucherSettings['50k']?.profile || '50k',
                    description: 'Akses WiFi 30 hari penuh',
                    color: 'secondary',
                    enabled: voucherSettings['50k']?.enabled !== false
                }
            ];
        }

        // Urutkan paket berdasarkan harga dari yang terkecil ke yang terbesar
        allPackages.sort((a, b) => a.price - b.price);

        // Filter hanya paket yang enabled
        const voucherPackages = allPackages.filter(pkg => pkg.enabled);

        res.render('publicVoucher', {
            title: 'Beli Voucher Hotspot',
            voucherPackages,
            profiles,
            settings,
            error: req.query.error,
            success: req.query.success
        });

    } catch (error) {
        console.error('Error rendering public voucher page:', error);
        res.render('publicVoucher', {
            title: 'Beli Voucher Hotspot',
            voucherPackages: [],
            profiles: [],
            settings: {},
            error: 'Gagal memuat halaman voucher: ' + error.message,
            success: null
        });
    }
});

// POST: Proses pembelian voucher
router.post('/purchase', async (req, res) => {
    try {
        const { packageId, customerPhone, customerName, quantity = 1, gateway = 'tripay', method = 'BRIVA' } = req.body;

        if (!packageId || !customerPhone || !customerName) {
            return res.status(400).json({
                success: false,
                message: 'Data tidak lengkap'
            });
        }

        // Ambil settings voucher online dari database
        const voucherSettings = await getVoucherOnlineSettings();

        // Ambil paket voucher dari database voucher_pricing
        const voucherPackagesFromDB = await new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM voucher_pricing WHERE is_active = 1 ORDER BY customer_price ASC';
            billingManager.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        // Format paket dari database atau gunakan data dari voucher_online_settings jika tidak ada
        let allPackages;
        if (Object.keys(voucherSettings).length > 0) {
            // Gunakan data dari voucher_online_settings (prioritas utama)
            allPackages = Object.keys(voucherSettings).map(packageId => {
                const setting = voucherSettings[packageId];
                // Format nama paket berdasarkan nama yang disimpan di database
                const packageName = setting.name || `${packageId} - Paket`;
                // Format durasi menggunakan data dari database
                const durationText = getDurationText(packageId, setting.duration, setting.duration_type);

                return {
                    id: packageId,
                    name: packageName,
                    duration: durationText,
                    price: setting.price || 0,
                    profile: setting.profile || 'default',
                    description: packageName,
                    color: getPriceColor(setting.price || 0),
                    enabled: setting.enabled !== false
                };
            });
        } else if (voucherPackagesFromDB.length > 0) {
            // Fallback ke data dari voucher_pricing jika voucher_online_settings kosong
            allPackages = voucherPackagesFromDB.map(pkg => {
                // Format durasi menggunakan data dari database
                const durationText = getDurationText(pkg.package_id || `pkg-${pkg.id}`, pkg.duration, pkg.duration_type);

                // Format harga
                const price = pkg.customer_price;

                // Format nama paket
                const packageName = pkg.package_name;

                return {
                    id: `pkg-${pkg.id}`,
                    name: packageName,
                    duration: durationText,
                    price: price,
                    profile: pkg.hotspot_profile || 'default',
                    description: pkg.description || `Voucher ${packageName}`,
                    color: getPriceColor(price),
                    enabled: true
                };
            });
        } else {
            // Fallback ke data hardcoded jika kedua tabel kosong
            allPackages = [
                {
                    id: '3k',
                    name: '3rb - 1 Hari',
                    duration: getDurationText('3k'),
                    price: 3000,
                    profile: voucherSettings['3k']?.profile || '3k',
                    description: 'Akses WiFi 1 hari penuh',
                    color: 'primary',
                    enabled: voucherSettings['3k']?.enabled !== false
                },
                {
                    id: '5k',
                    name: '5rb - 2 Hari',
                    duration: getDurationText('5k'),
                    price: 5000,
                    profile: voucherSettings['5k']?.profile || '5k',
                    description: 'Akses WiFi 2 hari penuh',
                    color: 'success',
                    enabled: voucherSettings['5k']?.enabled !== false
                },
                {
                    id: '10k',
                    name: '10rb - 5 Hari',
                    duration: getDurationText('10k'),
                    price: 10000,
                    profile: voucherSettings['10k']?.profile || '10k',
                    description: 'Akses WiFi 5 hari penuh',
                    color: 'info',
                    enabled: voucherSettings['10k']?.enabled !== false
                },
                {
                    id: '15k',
                    name: '15rb - 8 Hari',
                    duration: getDurationText('15k'),
                    price: 15000,
                    profile: voucherSettings['15k']?.profile || '15k',
                    description: 'Akses WiFi 8 hari penuh',
                    color: 'warning',
                    enabled: voucherSettings['15k']?.enabled !== false
                },
                {
                    id: '25k',
                    name: '25rb - 15 Hari',
                    duration: getDurationText('25k'),
                    price: 25000,
                    profile: voucherSettings['25k']?.profile || '25k',
                    description: 'Akses WiFi 15 hari penuh',
                    color: 'danger',
                    enabled: voucherSettings['25k']?.enabled !== false
                },
                {
                    id: '50k',
                    name: '50rb - 30 Hari',
                    duration: getDurationText('50k'),
                    price: 50000,
                    profile: voucherSettings['50k']?.profile || '50k',
                    description: 'Akses WiFi 30 hari penuh',
                    color: 'secondary',
                    enabled: voucherSettings['50k']?.enabled !== false
                }
            ];
        }

        // Urutkan paket berdasarkan harga dari yang terkecil ke yang terbesar
        allPackages.sort((a, b) => a.price - b.price);

        // Filter hanya paket yang enabled
        const voucherPackages = allPackages.filter(pkg => pkg.enabled);
        // Temukan paket berdasarkan ID (bisa berupa ID database atau ID hardcoded)
        let selectedPackage = voucherPackages.find(pkg => pkg.id === packageId);

        // Jika tidak ditemukan, coba cari dengan ID database (format: pkg-1, pkg-2, dll)
        if (!selectedPackage) {
            selectedPackage = voucherPackages.find(pkg => pkg.id === `pkg-${packageId}`);
        }

        // Jika masih tidak ditemukan, fallback ke pencarian berdasarkan nama paket
        if (!selectedPackage) {
            selectedPackage = voucherPackages.find(pkg =>
                pkg.name.toLowerCase().includes(packageId.toLowerCase()) ||
                pkg.name.toLowerCase().includes(packageId.replace('k', 'K').toLowerCase())
            );
        }

        if (!selectedPackage) {
            return res.status(400).json({
                success: false,
                message: 'Paket voucher tidak ditemukan'
            });
        }

        // Untuk kompatibilitas backward, pastikan packageId dalam format yang benar
        const actualPackageId = selectedPackage.id.startsWith('pkg-')
            ? selectedPackage.id.replace('pkg-', '')
            : selectedPackage.id;

        const totalAmount = selectedPackage.price * parseInt(quantity);

        // 1. Simpan data purchase tanpa generate voucher dulu
        // Voucher akan di-generate setelah payment success untuk menghindari voucher terbuang
        console.log('Saving voucher purchase for package:', packageId, 'quantity:', quantity);

        // 2. Simpan data voucher ke tabel voucher_purchases (tanpa voucher_data dulu)
        const voucherDataString = JSON.stringify([]); // Kosong dulu, akan diisi setelah payment success
        console.log('Voucher purchase data to save (vouchers will be generated after payment success)');

        const voucherPurchase = await saveVoucherPurchase({
            invoiceId: null, // akan diupdate setelah invoice dibuat
            customerName: customerName,
            customerPhone: customerPhone,
            amount: totalAmount,
            description: `Voucher Hotspot ${selectedPackage.name} x${quantity}`,
            packageId: actualPackageId,
            quantity: parseInt(quantity),
            profile: selectedPackage.profile,
            voucherData: voucherDataString, // Simpan voucher yang sudah di-generate
            status: 'pending'
        });

        console.log('Saved voucher purchase with ID:', voucherPurchase.id);
        console.log('Voucher purchase saved, vouchers will be generated after payment success');

        try {
            // 3. Buat invoice menggunakan billingManager untuk konsistensi
            const invoiceNumber = `INV-VCR-${Date.now()}-${voucherPurchase.id}`;
            const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            const voucherCustomerId = await getVoucherCustomerId();

            // Use a valid package ID from packages table if possible, otherwise use 1 as placeholder
            // This is to avoid FOREIGN KEY constraint failure in invoices table
            const finalPackageId = !isNaN(actualPackageId) ? parseInt(actualPackageId) : 1;

            // Create invoice using billingManager method
            const invoiceResult = await billingManager.createInvoice({
                customer_id: voucherCustomerId,
                invoice_number: invoiceNumber,
                amount: totalAmount,
                due_date: dueDate,
                notes: `Voucher Hotspot ${selectedPackage.name} x${quantity}`,
                package_id: finalPackageId,
                package_name: selectedPackage.name,
                invoice_type: 'voucher',
                status: 'pending'
            });

            const invoiceDbId = invoiceResult.id;

            // Update voucher purchase dengan invoice_number (string) agar sinkron dengan invoice
            await new Promise((resolve, reject) => {
                billingManager.db.run('UPDATE voucher_purchases SET invoice_id = ? WHERE id = ?', [invoiceNumber, voucherPurchase.id], function (err) {
                    if (err) reject(err);
                    else resolve();
                });
            });

            console.log('Invoice created successfully:', invoiceNumber, 'DB ID:', invoiceDbId);

            // 4. Buat payment gateway transaction menggunakan Tripay
            console.log('Creating payment for invoice DB ID:', invoiceDbId);

            // Gunakan method yang sama dengan invoice bulanan, tapi dengan paymentType voucher
            // Override nomor telepon dengan input konsumen agar cocok dengan akun e-wallet (DANA, dll)
            const paymentResult = await billingManager.createOnlinePaymentWithMethod(
                invoiceDbId,
                gateway,
                method,
                'voucher',
                customerPhone
            );
            console.log('Payment result:', paymentResult);

            if (!paymentResult || !paymentResult.payment_url) {
                throw new Error('Gagal membuat payment URL');
            }

            res.json({
                success: true,
                message: 'Pembelian voucher berhasil dibuat',
                data: {
                    purchaseId: voucherPurchase.id,
                    invoiceId: invoiceNumber,
                    paymentUrl: paymentResult.payment_url,
                    amount: totalAmount,
                    package: selectedPackage,
                    note: 'Voucher akan di-generate setelah pembayaran berhasil'
                }
            });
        } catch (paymentError) {
            console.error('Payment creation error:', paymentError);
            // Jika payment gagal, update status voucher menjadi failed
            try {
                await new Promise((resolve, reject) => {
                    billingManager.db.run('UPDATE voucher_purchases SET status = ? WHERE id = ?', ['failed', voucherPurchase.id], function (err) {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            } catch (updateError) {
                console.error('Failed to update voucher status:', updateError);
            }

            throw paymentError;
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal memproses pembelian voucher: ' + error.message
        });
    }
});

// GET: Halaman sukses pembelian voucher
router.get('/success/:purchaseId', async (req, res) => {
    try {
        const { purchaseId } = req.params;

        const purchase = await new Promise((resolve, reject) => {
            billingManager.db.get('SELECT * FROM voucher_purchases WHERE id = ?', [purchaseId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!purchase) {
            return res.render('voucherError', {
                title: 'Voucher Tidak Ditemukan',
                error: 'Voucher tidak ditemukan',
                message: 'Purchase ID tidak valid atau voucher sudah expired'
            });
        }

        let vouchers = [];
        if (purchase.voucher_data) {
            try {
                vouchers = JSON.parse(purchase.voucher_data);
            } catch (e) {
                console.error('Error parsing voucher data:', e);
            }
        }

        // Don't close billingManager.db as it's a singleton

        // Ambil settings untuk informasi tambahan
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminContact = settings['admins.0'] || '-';

        // Format data untuk template
        const voucherData = {
            purchaseId: purchase.id,
            packageName: purchase.description || 'Voucher WiFi',
            duration: getPackageDuration(purchase.voucher_package),
            price: purchase.amount,
            vouchers: vouchers,
            customerName: purchase.customer_name,
            customerPhone: purchase.customer_phone,
            status: purchase.status
        };

        res.render('voucherSuccess', {
            title: 'Voucher Berhasil Dibeli',
            purchase,
            vouchers,
            voucherData,
            success: true,
            company_header,
            adminContact,
            settings
        });

    } catch (error) {
        console.error('Error rendering voucher success page:', error);

        // Ambil settings untuk error page juga
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';

        res.render('voucherError', {
            title: 'Error',
            error: 'Gagal memuat halaman voucher',
            message: error.message,
            company_header,
            settings
        });
    }
});

// GET: Halaman hasil pembayaran dari payment gateway
router.get('/finish', async (req, res) => {
    try {
        const { order_id, transaction_status } = req.query;

        if (!order_id) {
            const settings = getSettingsWithCache();
            const company_header = settings.company_header || 'Voucher Hotspot';

            return res.render('voucherError', {
                title: 'Error',
                error: 'Order ID tidak ditemukan',
                message: 'Parameter order_id tidak ditemukan dalam URL',
                company_header,
                settings
            });
        }

        const purchase = await new Promise((resolve, reject) => {
            billingManager.db.get('SELECT * FROM voucher_purchases WHERE invoice_id = ?', [order_id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!purchase) {
            const settings = getSettingsWithCache();
            const company_header = settings.company_header || 'Voucher Hotspot';

            return res.render('voucherError', {
                title: 'Voucher Tidak Ditemukan',
                error: 'Voucher tidak ditemukan',
                message: 'Purchase dengan order ID tersebut tidak ditemukan',
                company_header,
                settings
            });
        }

        let vouchers = [];
        if (purchase.voucher_data) {
            try {
                vouchers = JSON.parse(purchase.voucher_data);
            } catch (e) {
                console.error('Error parsing voucher data:', e);
            }
        }

        // Don't close billingManager.db as it's a singleton

        // Tentukan status berdasarkan transaction_status
        let status = 'pending';
        if (transaction_status === 'settlement' || transaction_status === 'capture') {
            status = 'success';
        } else if (transaction_status === 'expire' || transaction_status === 'cancel') {
            status = 'failed';
        }

        // Ambil settings untuk informasi tambahan
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminContact = settings['admins.0'] || '-';

        res.render('voucherFinish', {
            title: 'Hasil Pembayaran Voucher',
            purchase,
            vouchers,
            status,
            transaction_status,
            order_id,
            company_header,
            adminContact,
            settings
        });

    } catch (error) {
        console.error('Error rendering voucher finish page:', error);

        // Ambil settings untuk error page juga
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';

        res.render('voucherError', {
            title: 'Error',
            error: 'Gagal memuat halaman hasil pembayaran',
            message: error.message,
            company_header,
            settings
        });
    }
});

// Helper function untuk mendapatkan durasi paket
function getPackageDuration(packageId) {
    const durations = {
        '3k': '1 hari',
        '5k': '2 hari',
        '10k': '5 hari',
        '15k': '8 hari',
        '25k': '15 hari',
        '50k': '30 hari'
    };
    return durations[packageId] || 'Tidak diketahui';
}

// Helper function untuk mendapatkan teks durasi berdasarkan ID paket
function getDurationText(packageId) {
    const durations = {
        '3k': '1 Hari',
        '5k': '2 Hari',
        '10k': '5 Hari',
        '15k': '8 Hari',
        '25k': '15 Hari',
        '50k': '30 Hari'
    };
    return durations[packageId] || '1 Hari';
}

// Memperbaiki fungsi getDurationText untuk menggunakan data yang lebih dinamis
function getDurationText(packageId, duration, durationType) {
    // Jika duration dan durationType tersedia, gunakan itu
    if (duration !== undefined && durationType !== undefined) {
        if (durationType === 'days') {
            return `${duration} Hari`;
        } else if (durationType === 'hours') {
            // Konversi jam ke hari jika memungkinkan
            if (duration === 24) return '1 Hari';
            if (duration === 48) return '2 Hari';
            if (duration === 72) return '3 Hari';
            if (duration === 96) return '4 Hari';
            if (duration === 120) return '5 Hari';
            if (duration === 144) return '6 Hari';
            if (duration === 168) return '7 Hari';
            if (duration === 192) return '8 Hari';
            if (duration === 240) return '10 Hari';
            if (duration === 360) return '15 Hari';
            if (duration === 720) return '30 Hari';
            return `${duration} Jam`;
        }
    }

    // Fallback ke mapping statis jika tidak ada data durasi
    const defaultDurations = {
        '3k': '1 Hari',
        '5k': '2 Hari',
        '10k': '5 Hari',
        '15k': '8 Hari',
        '25k': '15 Hari',
        '50k': '30 Hari'
    };
    return defaultDurations[packageId] || '1 Hari';
}

// Helper function untuk format pesan voucher WhatsApp
function formatVoucherMessage(vouchers, purchase, settings) {
    let message = `🛒 *${settings.company_header || 'VOUCHER HOTSPOT'} BERHASIL DIBELI*\n\n`;
    message += `👤 Nama: ${purchase.customer_name}\n`;
    message += `📱 No HP: ${purchase.customer_phone}\n`;
    message += `💰 Total: Rp ${purchase.amount.toLocaleString('id-ID')}\n\n`;

    message += `🎫 *DETAIL VOUCHER:*\n\n`;

    vouchers.forEach((voucher, index) => {
        message += `${index + 1}. *${voucher.username}*\n`;
        message += `   Password: ${voucher.password}\n`;
        message += `   Profile: ${voucher.profile}\n\n`;
    });

    message += `🌐 *CARA PENGGUNAAN:*\n`;
    message += `1. Hubungkan ke WiFi hotspot\n`;
    message += `2. Buka browser dan login ke hotspot\n`;
    message += `3. Masukkan Username & Password di atas\n`;
    message += `4. Klik Login\n\n`;

    message += `⏰ *MASA AKTIF:* Sesuai paket yang dipilih\n\n`;
    message += `📞 *BANTUAN:* Hubungi ${settings.contact_phone || settings['admins.0'] || 'admin'} jika ada kendala\n\n`;
    message += `Terima kasih telah menggunakan layanan ${settings.company_header || 'kami'}! 🚀`;

    return message;
}

// Helper function untuk format pesan voucher dengan link success page
function formatVoucherMessageWithSuccessPage(vouchers, purchase, successUrl, settings) {
    let message = `🛒 *${settings.company_header || 'VOUCHER HOTSPOT'} BERHASIL DIBELI*\n\n`;
    message += `👤 Nama: ${purchase.customer_name}\n`;
    message += `📱 No HP: ${purchase.customer_phone}\n`;
    message += `💰 Total: Rp ${purchase.amount.toLocaleString('id-ID')}\n\n`;

    message += `🎫 *DETAIL VOUCHER:*\n\n`;

    vouchers.forEach((voucher, index) => {
        message += `${index + 1}. *${voucher.username}*\n`;
        message += `   Password: ${voucher.password}\n`;
        message += `   Profile: ${voucher.profile}\n\n`;
    });

    message += `🌐 *LIHAT DETAIL LENGKAP:*\n`;
    message += `${successUrl}\n\n`;

    message += `🌐 *CARA PENGGUNAAN:*\n`;
    message += `1. Hubungkan ke WiFi hotspot\n`;
    message += `2. Buka browser dan login ke hotspot\n`;
    message += `3. Masukkan Username & Password di atas\n`;
    message += `4. Klik Login\n\n`;

    message += `⏰ *MASA AKTIF:* Sesuai paket yang dipilih\n\n`;
    message += `📞 *BANTUAN:* Hubungi ${settings.contact_phone || settings['admins.0'] || 'admin'} jika ada kendala\n\n`;
    message += `Terima kasih telah menggunakan layanan ${settings.company_header || 'kami'}! 🚀`;

    return message;
}

// Function untuk handle voucher webhook (bisa dipanggil dari universal webhook)
async function handleVoucherWebhook(body, headers) {
    try {
        console.log('Received voucher payment webhook:', body);

        // Gunakan PaymentGatewayManager untuk konsistensi
        const PaymentGatewayManager = require('../config/paymentGateway');
        const paymentGateway = new PaymentGatewayManager();

        // Tentukan gateway berdasarkan payload
        let gateway = 'tripay'; // Default ke tripay
        if (body.transaction_status) {
            gateway = 'midtrans';
        } else if (body.status === 'PAID' || body.status === 'EXPIRED' || body.status === 'FAILED') {
            gateway = 'tripay';
        } else if (body.status === 'settled' || body.status === 'expired' || body.status === 'failed') {
            gateway = 'xendit';
        }

        console.log(`Processing webhook with gateway: ${gateway}`);

        // Process webhook menggunakan PaymentGatewayManager
        let webhookResult;
        try {
            webhookResult = await paymentGateway.handleWebhook({ body, headers }, gateway);
            console.log('Webhook result:', webhookResult);
        } catch (webhookError) {
            console.log('Webhook signature validation failed, processing manually:', webhookError.message);

            // Fallback: proses manual untuk voucher payment
            webhookResult = {
                order_id: body.order_id || body.merchant_ref,
                status: body.status || body.transaction_status,
                amount: body.amount || body.gross_amount,
                payment_type: body.payment_type || body.payment_method
            };

            // Normalize status
            if (webhookResult.status === 'PAID' || webhookResult.status === 'settlement' || webhookResult.status === 'capture') {
                webhookResult.status = 'success';
            }
        }

        const { order_id, status, amount, payment_type } = webhookResult;

        if (!order_id) {
            console.log('No order_id found in webhook payload');
            return {
                success: false,
                message: 'Order ID tidak ditemukan dalam webhook payload'
            };
        }

        // Cari purchase berdasarkan order_id
        const db = billingManager.db;

        let purchase;
        try {
            // Coba cari berdasarkan order_id langsung Terlebih Dahulu (EXACT MATCH)
            // Ini karena kita menyimpan invoice_id sebagai full invoice number (e.g., INV-VCR-...)
            purchase = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM voucher_purchases WHERE invoice_id = ?', [order_id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            // Jika tidak ketemu, coba cari dengan menghapus prefix INV- (Case legacy)
            if (!purchase) {
                const invoiceIdFallback = order_id.replace('INV-', '');
                purchase = await new Promise((resolve, reject) => {
                    db.get('SELECT * FROM voucher_purchases WHERE invoice_id = ?', [invoiceIdFallback], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });
            }
        } catch (error) {
            console.error('Error finding purchase:', error);
        }

        if (!purchase) {
            console.log(`Purchase dengan order_id ${order_id} tidak ditemukan di database`);
            return {
                success: false,
                message: 'Voucher tidak ditemukan',
                details: `Purchase dengan order_id ${order_id} tidak ditemukan. Kemungkinan sudah expired atau order_id tidak valid.`,
                suggestions: [
                    'Periksa kembali link pembayaran yang benar',
                    'Pastikan pembayaran dilakukan dalam batas waktu yang ditentukan',
                    'Hubungi admin jika mengalami kesulitan'
                ]
            };
        }

        // Cek status pembayaran menggunakan status yang sudah dinormalisasi
        if (status === 'success' || status === 'settlement' || status === 'capture') {
            console.log('Payment successful for purchase ID:', purchase.id);

            // Generate voucher SETELAH payment success untuk menghindari voucher terbuang
            let generatedVouchers = [];
            try {
                console.log('Generating vouchers after payment success...');
                generatedVouchers = await generateHotspotVouchersWithRetry({
                    profile: purchase.voucher_profile,
                    count: purchase.voucher_quantity,
                    packageId: purchase.voucher_package,
                    customerName: purchase.customer_name,
                    customerPhone: purchase.customer_phone
                });

                if (generatedVouchers && generatedVouchers.length > 0) {
                    console.log('Vouchers generated successfully:', generatedVouchers.length);
                } else {
                    console.log('No vouchers generated');
                }
            } catch (voucherError) {
                console.error('Error generating vouchers:', voucherError);
                // Log error tapi jangan gagalkan webhook
            }

            // Update status purchase menjadi completed
            await new Promise((resolve, reject) => {
                const updateSql = `UPDATE voucher_purchases 
                                 SET status = 'completed', 
                                     voucher_data = ?, 
                                     updated_at = datetime('now')
                                 WHERE id = ?`;
                db.run(updateSql, [JSON.stringify(generatedVouchers), purchase.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Update status invoice menjadi paid
            try {
                console.log('Updating invoice status to paid for invoice_id:', purchase.invoice_id);
                await billingManager.updateInvoiceStatus(purchase.invoice_id, 'paid', gateway);
                console.log('Invoice status updated successfully');
            } catch (invoiceError) {
                console.error('Error updating invoice status:', invoiceError);
                // Log error tapi jangan gagalkan webhook
            }

            // Kirim voucher via WhatsApp jika ada nomor HP
            if (purchase.customer_phone) {
                try {
                    const { sendMessage } = require('../config/sendMessage');
                    const { getSettingsWithCache } = require('../config/settingsManager');
                    const settings = getSettingsWithCache();

                    // Gunakan settings untuk membuat URL yang konsisten
                    const baseUrl = settings.server_host || 'localhost';
                    const port = settings.server_port || '3003';
                    const protocol = baseUrl.includes('localhost') || baseUrl.match(/^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\./) ? 'http' : 'https';
                    const successUrl = `${protocol}://${baseUrl}:${port}/voucher/success/${purchase.id}`;

                    const voucherText = formatVoucherMessageWithSuccessPage(generatedVouchers, purchase, successUrl, settings);
                    const deliveryResult = await sendVoucherWithRetry(purchase.customer_phone, voucherText);

                    // Log delivery result
                    await logVoucherDelivery(purchase.id, purchase.customer_phone, deliveryResult.success, deliveryResult.message);

                    if (deliveryResult.success) {
                        console.log('Voucher sent successfully via WhatsApp');
                    } else {
                        console.log('Failed to send voucher via WhatsApp:', deliveryResult.message);
                    }
                } catch (whatsappError) {
                    console.error('Error sending voucher via WhatsApp:', whatsappError);
                    await logVoucherDelivery(purchase.id, purchase.customer_phone, false, whatsappError.message);
                }
            }

            // Don't close billingManager.db as it's a singleton
            return {
                success: true,
                message: 'Voucher berhasil dibuat dan dikirim',
                purchase_id: purchase.id,
                vouchers_generated: generatedVouchers.length,
                whatsapp_sent: purchase.customer_phone ? true : false
            };

        } else if (status === 'failed' || status === 'expired' || status === 'cancelled') {
            console.log('Payment failed/expired for purchase ID:', purchase.id);

            // Update status menjadi failed
            await new Promise((resolve, reject) => {
                db.run('UPDATE voucher_purchases SET status = ?, updated_at = datetime(\'now\') WHERE id = ?',
                    [status, purchase.id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });

            // Don't close billingManager.db as it's a singleton
            return {
                success: false,
                message: `Pembayaran ${status}`,
                purchase_id: purchase.id
            };

        } else {
            console.log('Payment status unknown:', status);
            // Don't close billingManager.db as it's a singleton
            return {
                success: false,
                message: 'Status pembayaran tidak dikenali',
                status: status,
                purchase_id: purchase.id
            };
        }

    } catch (error) {
        console.error('Voucher webhook error:', error);
        return {
            success: false,
            message: 'Error processing voucher webhook: ' + error.message
        };
    }
}

// Webhook handler untuk voucher payment success
router.post('/payment-webhook', async (req, res) => {
    try {
        const result = await handleVoucherWebhook(req.body, req.headers);
        res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        console.error('Voucher webhook route error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error: ' + error.message
        });
    }
});

// Helper functions yang diperlukan
async function generateHotspotVouchersWithRetry(purchaseData, maxRetries = 3) {
    const { generateHotspotVouchers } = require('../config/mikrotik');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Attempt ${attempt} to generate vouchers for purchase:`, purchaseData);

            // Generate user-friendly voucher format
            const timestamp = Date.now().toString().slice(-6); // Ambil 6 digit terakhir timestamp
            const prefix = `V${timestamp}`; // Format: V123456

            const result = await generateHotspotVouchers(
                purchaseData.count || 1,
                prefix,
                purchaseData.profile || 'default',
                'all',
                '',
                '',
                'alphanumeric'
            );

            if (result.success && result.vouchers && result.vouchers.length > 0) {
                console.log(`Successfully generated ${result.vouchers.length} vouchers on attempt ${attempt}`);
                return result.vouchers;
            } else {
                console.log(`Attempt ${attempt} failed:`, result.message);
                if (attempt === maxRetries) {
                    throw new Error(`Failed to generate vouchers after ${maxRetries} attempts: ${result.message}`);
                }
            }
        } catch (error) {
            console.error(`Attempt ${attempt} error:`, error.message);
            if (attempt === maxRetries) {
                throw error;
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

async function generateHotspotVouchers(count, prefix, profile, comment, limitUptime, limitBytes, passwordType) {
    const { generateHotspotVouchers } = require('../config/mikrotik');
    return await generateHotspotVouchers(count, prefix, profile, comment, limitUptime, limitBytes, passwordType);
}

async function sendVoucherWithRetry(phone, message, maxRetries = 3) {
    const { sendMessage } = require('../config/sendMessage');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Attempt ${attempt} to send voucher to ${phone}`);
            const result = await sendMessage(phone, message);

            // sendMessage mengembalikan true/false, bukan object
            if (result === true) {
                console.log(`Successfully sent voucher to ${phone} on attempt ${attempt}`);
                return { success: true, message: 'Voucher sent successfully' };
            } else {
                console.log(`Attempt ${attempt} failed: WhatsApp sendMessage returned false`);
                if (attempt === maxRetries) {
                    return { success: false, message: `Failed to send voucher after ${maxRetries} attempts: WhatsApp connection issue` };
                }
            }
        } catch (error) {
            console.error(`Attempt ${attempt} error:`, error.message);
            if (attempt === maxRetries) {
                return { success: false, message: `Failed to send voucher after ${maxRetries} attempts: ${error.message}` };
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

async function logVoucherDelivery(purchaseId, phone, success, message) {
    return new Promise((resolve, reject) => {
        // Tentukan status berdasarkan success flag
        const status = success ? 'sent' : 'failed';

        billingManager.db.run(`
            INSERT INTO voucher_delivery_logs (purchase_id, phone, status, error_message, created_at)
            VALUES (?, ?, ?, ?, datetime('now'))
        `, [purchaseId, phone, status, message], (err) => {
            if (err) {
                console.error('Error logging voucher delivery:', err);
                reject(err);
            } else {
                console.log(`Voucher delivery logged: ${phone} - ${status}`);
                resolve();
            }
        });
    });
}

async function saveVoucherPurchase(purchaseData) {
    return new Promise((resolve, reject) => {
        billingManager.db.run(`
            INSERT INTO voucher_purchases (invoice_id, customer_name, customer_phone, voucher_package, 
                                         voucher_profile, voucher_quantity, amount, description, 
                                         voucher_data, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `, [
            purchaseData.invoiceId,
            purchaseData.customerName,
            purchaseData.customerPhone,
            purchaseData.packageId,
            purchaseData.profile,
            purchaseData.quantity,
            purchaseData.amount,
            purchaseData.description,
            purchaseData.voucherData,
            purchaseData.status || 'pending'
        ], function (err) {
            if (err) reject(err);
            else resolve({ id: this.lastID });
        });
    });
}

async function cleanupFailedVoucher(purchaseId) {
    return new Promise((resolve, reject) => {
        billingManager.db.run('DELETE FROM voucher_purchases WHERE id = ?', [purchaseId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Export functions for testing
module.exports = {
    router,
    handleVoucherWebhook,
    generateHotspotVouchersWithRetry,
    generateHotspotVouchers,
    sendVoucherWithRetry,
    logVoucherDelivery,
    saveVoucherPurchase,
    cleanupFailedVoucher
};
