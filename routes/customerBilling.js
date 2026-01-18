const express = require('express');
const router = express.Router();
const billingManager = require('../config/billing');
const logger = require('../config/logger');
const { getSetting } = require('../config/settingsManager');

// Middleware untuk memastikan session consistency
const ensureCustomerSession = async (req, res, next) => {
    try {
        // Prioritas 1: cek customer_username
        let username = req.session?.customer_username;
        const phone = req.session?.phone || req.session?.customer_phone;

        console.log(`🔍 [SESSION_CHECK] URL: ${req.url}, Username: ${username}, Phone: ${phone}`);

        // Jika tidak ada customer_username tapi ada phone, ambil dari billing
        if (!username && phone) {
            console.log(`🔄 [SESSION_FIX] No customer_username but phone exists: ${phone}, fetching from billing`);
            try {
                const customer = await billingManager.getCustomerByPhone(phone);
                if (customer) {
                    req.session.customer_username = customer.username;
                    req.session.customer_phone = phone;
                    username = customer.username;
                    console.log(`✅ [SESSION_FIX] Set customer_username: ${username} for phone: ${phone}`);

                    // IMPORTANT: Save session explicitly before continuing
                    await new Promise((resolve, reject) => {
                        req.session.save((err) => {
                            if (err) {
                                console.error(`❌ [SESSION_FIX] Failed to save session:`, err);
                                reject(err);
                            } else {
                                console.log(`💾 [SESSION_FIX] Session saved successfully`);
                                resolve();
                            }
                        });
                    });
                } else {
                    // Customer tidak ada di billing, buat temporary username
                    req.session.customer_username = `temp_${phone}`;
                    req.session.customer_phone = phone;
                    username = `temp_${phone}`;
                    console.log(`⚠️ [SESSION_FIX] Customer not in billing, created temp username: ${username} for phone: ${phone}`);

                    // Save session for temp user too
                    await new Promise((resolve) => {
                        req.session.save((err) => {
                            if (err) console.error(`❌ [SESSION_FIX] Failed to save temp session:`, err);
                            resolve();
                        });
                    });
                }
            } catch (error) {
                console.error(`❌ [SESSION_FIX] Error getting customer from billing:`, error);
                // Fallback ke temporary username
                req.session.customer_username = `temp_${phone}`;
                req.session.customer_phone = phone;
                username = `temp_${phone}`;

                // Save fallback session
                await new Promise((resolve) => {
                    req.session.save((err) => {
                        if (err) console.error(`❌ [SESSION_FIX] Failed to save fallback session:`, err);
                        resolve();
                    });
                });
            }
        }

        // Jika session username masih temp_ tetapi ada phone, coba sinkronkan ulang ke username asli
        if (username && typeof username === 'string' && username.startsWith('temp_') && phone) {
            try {
                const customerFix = await billingManager.getCustomerByPhone(phone);
                if (customerFix && customerFix.username) {
                    req.session.customer_username = customerFix.username;
                    req.session.customer_phone = phone;
                    username = customerFix.username;
                    console.log(`✅ [SESSION_FIX] Replaced temp username with real username: ${username} for phone: ${phone}`);

                    // Save updated session
                    await new Promise((resolve) => {
                        req.session.save((err) => {
                            if (err) console.error(`❌ [SESSION_FIX] Failed to save updated session:`, err);
                            resolve();
                        });
                    });
                }
            } catch (e) {
                console.warn(`⚠️ [SESSION_FIX] Retry getCustomerByPhone failed: ${e.message}`);
            }
        }

        // Jika masih tidak ada customer_username atau phone, redirect ke login
        if (!username && !phone) {
            console.log(`❌ [SESSION_FIX] No session found, redirecting to login`);
            return res.redirect('/customer/login');
        }

        console.log(`✅ [SESSION_CHECK] Session OK - proceeding with username: ${username}`);
        next();
    } catch (error) {
        console.error('❌ [SESSION_ERROR] Error in ensureCustomerSession middleware:', error);
        return res.redirect('/customer/login');
    }
};

// Middleware untuk mendapatkan pengaturan aplikasi
const getAppSettings = (req, res, next) => {
    req.appSettings = {
        companyHeader: getSetting('company_header', 'ISP Monitor'),
        footerInfo: getSetting('footer_info', ''),
        logoFilename: getSetting('logo_filename', 'logo.png'),
        payment_bank_name: getSetting('payment_bank_name', 'BCA'),
        payment_account_number: getSetting('payment_account_number', '1234567890'),
        payment_account_holder: getSetting('payment_account_holder', 'ALIJAYA DIGITAL NETWORK'),
        payment_cash_address: getSetting('payment_cash_address', 'Jl. Contoh No. 123'),
        payment_cash_hours: getSetting('payment_cash_hours', '08:00 - 17:00'),
        contact_whatsapp: getSetting('contact_whatsapp', '081947215703'),
        contact_phone: getSetting('contact_phone', '0812-3456-7890')
    };
    next();
};

// Dashboard Billing Customer
router.get('/dashboard', ensureCustomerSession, getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        const phone = req.session.customer_phone || req.session.phone;

        if (!username) {
            return res.redirect('/customer/login');
        }

        // Handle temporary customer (belum ada di billing)
        if (username.startsWith('temp_')) {
            console.log(`📋 [BILLING_DASHBOARD] Temporary customer detected: ${username}, phone: ${phone}`);

            // Render dashboard dengan data kosong untuk customer tanpa billing
            return res.render('customer/billing/dashboard', {
                title: 'Dashboard Billing',
                customer: null,
                invoices: [],
                payments: [],
                stats: {
                    totalInvoices: 0,
                    paidInvoices: 0,
                    unpaidInvoices: 0,
                    overdueInvoices: 0,
                    totalPaid: 0,
                    totalUnpaid: 0
                },
                appSettings: req.appSettings,
                phone: phone
            });
        }

        const customer = await billingManager.getCustomerByUsername(username);
        if (!customer) {
            // Jika tidak ditemukan berdasarkan username, coba cari berdasarkan phone
            if (phone) {
                const customerByPhone = await billingManager.getCustomerByPhone(phone);
                if (!customerByPhone) {
                    console.log(`⚠️ [BILLING_DASHBOARD] Customer not found for username: ${username} or phone: ${phone}, treating as no billing data`);

                    // Render dashboard dengan data kosong
                    return res.render('customer/billing/dashboard', {
                        title: 'Dashboard Billing',
                        customer: null,
                        invoices: [],
                        payments: [],
                        stats: {
                            totalInvoices: 0,
                            paidInvoices: 0,
                            unpaidInvoices: 0,
                            overdueInvoices: 0,
                            totalPaid: 0,
                            totalUnpaid: 0
                        },
                        appSettings: req.appSettings,
                        phone: phone
                    });
                }
            }

            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                error: 'Terjadi kesalahan. Silakan coba lagi.',
                appSettings: req.appSettings,
                req: req
            });
        }

        const invoices = await billingManager.getInvoices(username);
        const payments = await billingManager.getPayments();

        // Filter payments untuk customer ini
        const customerPayments = payments.filter(payment => {
            return invoices.some(invoice => invoice.id === payment.invoice_id);
        });

        // Ambil riwayat laporan gangguan berdasarkan nomor telepon customer
        let troubleReports = [];
        try {
            const { getTroubleReportsByPhone } = require('../config/troubleReport');
            troubleReports = getTroubleReportsByPhone(customer.phone) || [];
        } catch (e) {
            logger.warn('Unable to load trouble reports for customer dashboard:', e.message);
        }

        // Hitung statistik customer
        const totalInvoices = invoices.length;
        const paidInvoices = invoices.filter(inv => inv.status === 'paid').length;
        const unpaidInvoices = invoices.filter(inv => inv.status === 'unpaid').length;
        const overdueInvoices = invoices.filter(inv =>
            inv.status === 'unpaid' && new Date(inv.due_date) < new Date()
        ).length;
        const totalPaid = invoices
            .filter(inv => inv.status === 'paid')
            .reduce((sum, inv) => sum + parseFloat(inv.amount), 0);
        const totalUnpaid = invoices
            .filter(inv => inv.status === 'unpaid')
            .reduce((sum, inv) => sum + parseFloat(inv.amount), 0);

        res.render('customer/billing/dashboard', {
            title: 'Dashboard Billing',
            customer,
            invoices: invoices.slice(0, 5), // 5 tagihan terbaru
            payments: customerPayments.slice(0, 5), // 5 pembayaran terbaru
            troubleReports: troubleReports.slice(-5), // 5 laporan terbaru
            stats: {
                totalInvoices,
                paidInvoices,
                unpaidInvoices,
                overdueInvoices,
                totalPaid,
                totalUnpaid
            },
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading customer billing dashboard:', error);
        res.status(500).render('error', {
            message: 'Error loading billing dashboard',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Halaman Tagihan Customer
router.get('/invoices', ensureCustomerSession, getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        const phone = req.session.customer_phone || req.session.phone;
        if (!username) {
            return res.redirect('/customer/login');
        }

        let customer = null;
        let invoices = [];

        // Handle temporary customer (belum ada di billing)
        if (username.startsWith('temp_') && phone) {
            console.log(`📋 [INVOICES] Temporary customer detected: ${username}, phone: ${phone}`);

            // For temporary customers, try to find customer by phone
            try {
                customer = await billingManager.getCustomerByPhone(phone);
                if (customer) {
                    console.log(`✅ [INVOICES] Found customer by phone for temp customer: ${username}`);
                    // Get invoices for this customer
                    invoices = await billingManager.getInvoicesByCustomer(customer.id);
                } else {
                    console.log(`⚠️ [INVOICES] No customer found by phone for temp customer: ${username}`);
                    // Render invoices page with empty data for temporary customer
                    return res.render('customer/billing/invoices', {
                        title: 'Tagihan Saya',
                        customer: {
                            id: null,
                            username: username,
                            name: 'Pelanggan Sementara',
                            phone: phone,
                            address: 'Alamat belum diatur',
                            email: null,
                            package_id: null
                        },
                        invoices: [],
                        appSettings: req.appSettings
                    });
                }
            } catch (customerError) {
                console.error(`❌ [INVOICES] Error getting customer by phone:`, customerError);
            }
        } else {
            // For non-temporary customers, get by username
            customer = await billingManager.getCustomerByUsername(username);
            if (customer) {
                invoices = await billingManager.getInvoices(username);
            }
        }

        if (!customer) {
            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                error: 'Terjadi kesalahan. Silakan coba lagi.',
                appSettings: req.appSettings,
                req: req
            });
        }

        res.render('customer/billing/invoices', {
            title: 'Tagihan Saya',
            customer,
            invoices,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading customer invoices:', error);
        res.status(500).render('error', {
            message: 'Error loading invoices',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Detail Tagihan Customer
router.get('/invoices/:id', ensureCustomerSession, getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        const phone = req.session.customer_phone || req.session.phone;
        if (!username) {
            return res.redirect('/customer/login');
        }

        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);

        if (!invoice) {
            return res.status(404).render('error', {
                message: 'Tagihan tidak ditemukan',
                error: 'Terjadi kesalahan. Silakan coba lagi.',
                appSettings: req.appSettings,
                req: req
            });
        }

        // Handle temporary customer (belum ada di billing)
        if (username.startsWith('temp_') && phone) {
            console.log(`📋 [INVOICE_DETAIL] Temporary customer detected: ${username}, phone: ${phone}`);

            // For temporary customers, try to find customer by phone and check if invoice belongs to them
            try {
                const billingManager = require('../config/billing');
                const customerByPhone = await billingManager.getCustomerByPhone(phone);

                if (customerByPhone && invoice.customer_id === customerByPhone.id) {
                    console.log(`✅ [INVOICE_DETAIL] Invoice matches customer by phone for temp customer: ${username}`);

                    const payments = await billingManager.getPayments(id);

                    return res.render('customer/billing/invoice-detail', {
                        title: `Tagihan ${invoice.invoice_number}`,
                        invoice,
                        payments,
                        appSettings: req.appSettings
                    });
                } else {
                    console.log(`❌ [INVOICE_DETAIL] Invoice doesn't match customer by phone for temp customer: ${username}`);
                }
            } catch (customerError) {
                console.error(`❌ [INVOICE_DETAIL] Error checking customer by phone:`, customerError);
            }

            // If we reach here, access is denied
            return res.status(403).render('error', {
                message: 'Akses ditolak',
                error: `Session username: "${username}" (temporary) tidak cocok dengan invoice customer`,
                appSettings: req.appSettings,
                req: req
            });
        }

        // Pastikan tagihan milik customer yang login (for non-temporary customers)
        if (invoice.customer_username !== username) {
            return res.status(403).render('error', {
                message: 'Akses ditolak',
                error: `Session username: "${username}" tidak cocok dengan invoice customer_username: "${invoice.customer_username}"`,
                appSettings: req.appSettings,
                req: req
            });
        }

        const payments = await billingManager.getPayments(id);

        res.render('customer/billing/invoice-detail', {
            title: `Tagihan ${invoice.invoice_number}`,
            invoice,
            payments,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoice detail:', error);
        res.status(500).render('error', {
            message: 'Error loading invoice detail',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Halaman Riwayat Pembayaran Customer
router.get('/payments', ensureCustomerSession, getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.redirect('/customer/login');
        }

        const customer = await billingManager.getCustomerByUsername(username);
        if (!customer) {
            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                error: 'Terjadi kesalahan. Silakan coba lagi.',
                appSettings: req.appSettings,
                req: req
            });
        }

        const invoices = await billingManager.getInvoices(username);
        const allPayments = await billingManager.getPayments();

        // Filter payments untuk customer ini
        const customerPayments = allPayments.filter(payment => {
            return invoices.some(invoice => invoice.id === payment.invoice_id);
        });

        res.render('customer/billing/payments', {
            title: 'Riwayat Pembayaran',
            customer,
            payments: customerPayments,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading customer payments:', error);
        res.status(500).render('error', {
            message: 'Error loading payments',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Halaman Profil Customer
router.get('/profile', ensureCustomerSession, getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        const phone = req.session.customer_phone || req.session.phone;
        if (!username) {
            return res.redirect('/customer/login');
        }

        let customer = null;

        // Handle temporary customer (belum ada di billing)
        if (username.startsWith('temp_') && phone) {
            console.log(`📋 [PROFILE] Temporary customer detected: ${username}, phone: ${phone}`);

            // For temporary customers, try to find customer by phone
            try {
                customer = await billingManager.getCustomerByPhone(phone);
                if (customer) {
                    console.log(`✅ [PROFILE] Found customer by phone for temp customer: ${username}`);
                } else {
                    console.log(`⚠️ [PROFILE] No customer found by phone for temp customer: ${username}`);
                    // Render profile with minimal data for temporary customer
                    const packages = await billingManager.getPackages();

                    return res.render('customer/billing/profile', {
                        title: 'Profil Saya',
                        customer: {
                            id: null,
                            username: username,
                            name: 'Pelanggan Sementara',
                            phone: phone,
                            address: 'Alamat belum diatur',
                            email: null,
                            package_id: null
                        },
                        packages,
                        appSettings: req.appSettings
                    });
                }
            } catch (customerError) {
                console.error(`❌ [PROFILE] Error getting customer by phone:`, customerError);
            }
        } else {
            // For non-temporary customers, get by username
            customer = await billingManager.getCustomerByUsername(username);
        }

        if (!customer) {
            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                error: 'Terjadi kesalahan. Silakan coba lagi.',
                appSettings: req.appSettings,
                req: req
            });
        }

        const packages = await billingManager.getPackages();

        res.render('customer/billing/profile', {
            title: 'Profil Saya',
            customer,
            packages,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading customer profile:', error);
        res.status(500).render('error', {
            message: 'Error loading profile',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// API Routes untuk AJAX
router.get('/api/invoices', async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const invoices = await billingManager.getInvoices(username);
        res.json(invoices);
    } catch (error) {
        logger.error('Error getting customer invoices API:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/payments', async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const invoices = await billingManager.getInvoices(username);
        const allPayments = await billingManager.getPayments();

        // Filter payments untuk customer ini
        const customerPayments = allPayments.filter(payment => {
            return invoices.some(invoice => invoice.id === payment.invoice_id);
        });

        res.json(customerPayments);
    } catch (error) {
        logger.error('Error getting customer payments API:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/profile', async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const customer = await billingManager.getCustomerByUsername(username);
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        res.json(customer);
    } catch (error) {
        logger.error('Error getting customer profile API:', error);
        res.status(500).json({ error: error.message });
    }
});

// Download Invoice PDF (placeholder)
router.get('/invoices/:id/download', getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.redirect('/customer/login');
        }

        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);

        if (!invoice || invoice.customer_username !== username) {
            return res.status(404).render('error', {
                message: 'Tagihan tidak ditemukan',
                error: 'Terjadi kesalahan. Silakan coba lagi.',
                appSettings: req.appSettings,
                req: req
            });
        }

        // TODO: Implement PDF generation
        res.json({
            success: true,
            message: 'Fitur download PDF akan segera tersedia',
            invoice_number: invoice.invoice_number
        });
    } catch (error) {
        logger.error('Error downloading invoice:', error);
        res.status(500).json({ error: error.message });
    }
});

// Print Invoice
router.get('/invoices/:id/print', ensureCustomerSession, getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        const phone = req.session.customer_phone || req.session.phone;
        console.log(`📄 [PRINT] Print request - username: ${username}, phone: ${phone}, invoice_id: ${req.params.id}`);

        if (!username) {
            console.log(`❌ [PRINT] No customer_username in session`);
            return res.redirect('/customer/login');
        }

        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);

        console.log(`📄 [PRINT] Invoice found:`, invoice ? {
            id: invoice.id,
            customer_username: invoice.customer_username,
            invoice_number: invoice.invoice_number,
            status: invoice.status
        } : 'null');

        if (!invoice) {
            console.log(`❌ [PRINT] Invoice not found`);
            return res.status(404).render('error', {
                message: 'Tagihan tidak ditemukan',
                error: 'Terjadi kesalahan. Silakan coba lagi.',
                appSettings: req.appSettings,
                req: req
            });
        }

        // Handle temporary customer (belum ada di billing)
        if (username.startsWith('temp_') && phone) {
            console.log(`📋 [PRINT] Temporary customer detected: ${username}, phone: ${phone}`);

            // For temporary customers, try to find customer by phone and check if invoice belongs to them
            try {
                const billingManager = require('../config/billing');
                const customerByPhone = await billingManager.getCustomerByPhone(phone);

                if (customerByPhone && invoice.customer_id === customerByPhone.id) {
                    console.log(`✅ [PRINT] Invoice matches customer by phone for temp customer: ${username}`);

                    const payments = await billingManager.getPayments(id);

                    return res.render('customer/billing/invoice-print', {
                        title: `Print Tagihan ${invoice.invoice_number}`,
                        invoice,
                        payments,
                        appSettings: req.appSettings
                    });
                } else {
                    console.log(`❌ [PRINT] Invoice doesn't match customer by phone for temp customer: ${username}`);
                }
            } catch (customerError) {
                console.error(`❌ [PRINT] Error checking customer by phone:`, customerError);
            }

            // If we reach here, access is denied
            console.log(`❌ [PRINT] Access denied for temp customer - invoice.customer_username: ${invoice?.customer_username}, session username: ${username}`);
            return res.status(404).render('error', {
                message: 'Tagihan tidak ditemukan',
                error: 'Terjadi kesalahan. Silakan coba lagi.',
                appSettings: req.appSettings,
                req: req
            });
        }

        if (invoice.customer_username !== username) {
            console.log(`❌ [PRINT] Access denied - invoice.customer_username: ${invoice?.customer_username}, session username: ${username}`);
            return res.status(404).render('error', {
                message: 'Tagihan tidak ditemukan',
                error: 'Terjadi kesalahan. Silakan coba lagi.',
                appSettings: req.appSettings,
                req: req
            });
        }

        const payments = await billingManager.getPayments(id);

        res.render('customer/billing/invoice-print', {
            title: `Print Tagihan ${invoice.invoice_number}`,
            invoice,
            payments,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error printing invoice:', error);
        res.status(500).render('error', {
            message: 'Error printing invoice',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Get available payment methods for customer
router.get('/api/payment-methods', async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        const PaymentGatewayManager = require('../config/paymentGateway');
        const paymentGateway = new PaymentGatewayManager();

        const methods = await paymentGateway.getAvailablePaymentMethods();

        res.json({
            success: true,
            methods: methods
        });
    } catch (error) {
        logger.error('Error getting payment methods:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting payment methods',
            error: error.message
        });
    }
});

// Create online payment for customer
router.post('/create-payment', async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        const { invoice_id, gateway, method } = req.body;

        // Process customer payment request

        if (!invoice_id) {
            return res.status(400).json({
                success: false,
                message: 'Invoice ID is required'
            });
        }

        // Get invoice and verify ownership
        const invoice = await billingManager.getInvoiceById(invoice_id);
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found'
            });
        }

        // Handle temporary customer (belum ada di billing)
        if (username.startsWith('temp_')) {
            const phone = req.session.customer_phone || req.session.phone;
            if (phone) {
                try {
                    const billingManager = require('../config/billing');
                    const customerByPhone = await billingManager.getCustomerByPhone(phone);

                    if (customerByPhone && invoice.customer_id === customerByPhone.id) {
                        console.log(`✅ [PAYMENT] Invoice matches customer by phone for temp customer: ${username}`);
                        // Allow the payment to proceed
                    } else {
                        return res.status(403).json({
                            success: false,
                            message: 'Access denied - invoice does not match your account'
                        });
                    }
                } catch (customerError) {
                    console.error(`❌ [PAYMENT] Error checking customer by phone:`, customerError);
                    return res.status(403).json({
                        success: false,
                        message: 'Access denied'
                    });
                }
            } else {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied - no phone number in session'
                });
            }
        } else {
            // For non-temporary customers, check username match
            if (invoice.customer_username !== username) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }
        }

        if (invoice.status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Invoice sudah dibayar'
            });
        }

        // Note: Tripay minimum amount validation removed for production
        // In production mode, Tripay doesn't have minimum amount restriction

        // Create online payment with specific method for Tripay
        const result = await billingManager.createOnlinePaymentWithMethod(invoice_id, gateway, method);

        logger.info(`Customer ${username} created payment for invoice ${invoice_id} using ${gateway}${method && method !== 'all' ? ' - ' + method : ''}`);

        res.json({
            success: true,
            message: 'Payment created successfully',
            data: result
        });
    } catch (error) {
        console.error(`[CUSTOMER_PAYMENT] Error:`, error);
        logger.error('Error creating customer payment:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create payment'
        });
    }
});

module.exports = router; 