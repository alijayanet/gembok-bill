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
                } else {
                    // Customer tidak ada di billing, buat temporary username
                    req.session.customer_username = `temp_${phone}`;
                    req.session.customer_phone = phone;
                    username = `temp_${phone}`;
                    console.log(`⚠️ [SESSION_FIX] Customer not in billing, created temp username: ${username} for phone: ${phone}`);
                }
            } catch (error) {
                console.error(`❌ [SESSION_FIX] Error getting customer from billing:`, error);
                // Fallback ke temporary username
                req.session.customer_username = `temp_${phone}`;
                req.session.customer_phone = phone;
                username = `temp_${phone}`;
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

        next();
    } catch (error) {
        console.error('Error in ensureCustomerSession middleware:', error);
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

        // Check session access (removed debug logs for production)
        
        // Pastikan tagihan milik customer yang login
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
router.get('/profile', getAppSettings, async (req, res) => {
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
        console.log(`📄 [PRINT] Print request - username: ${username}, invoice_id: ${req.params.id}`);
        
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
        
        if (!invoice || invoice.customer_username !== username) {
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

        if (invoice.customer_username !== username) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
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