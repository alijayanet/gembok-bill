const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const billingManager = require('../config/billing');
const logger = require('../config/logger');
const serviceSuspension = require('../config/serviceSuspension');
const { getSetting, getSettingsWithCache, setSetting, clearSettingsCache } = require('../config/settingsManager');
const { exec } = require('child_process');
const multer = require('multer');
const upload = multer();
const ExcelJS = require('exceljs');
const { adminAuth } = require('./adminAuth');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, '../public/img/packages');
        // Ensure directory exists
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Generate unique filename with timestamp
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const fileFilter = (req, file, cb) => {
    // Accept only image files
    if (file.mimetype === 'image/png' || file.mimetype === 'image/jpg' || file.mimetype === 'image/jpeg') {
        cb(null, true);
    } else {
        cb(new Error('Only PNG, JPG, and JPEG files are allowed'), false);
    }
};

const uploadPackageImage = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB limit
    }
});

// Ensure JSON body parsing for this router
router.use(express.json());
// Enable form submissions (application/x-www-form-urlencoded)
router.use(express.urlencoded({ extended: true }));

// Helper: validate optional base URL (allow empty, otherwise must start with http/https)
const isValidOptionalHttpUrl = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return true;
    return /^https?:\/\//i.test(s);
};

// Middleware untuk mendapatkan pengaturan aplikasi
const getAppSettings = (req, res, next) => {
    req.appSettings = {
        companyHeader: getSetting('company_header', 'ISP Monitor'),
        footerInfo: getSetting('footer_info', ''),
        logoFilename: getSetting('logo_filename', 'logo.png'),
        company_slogan: getSetting('company_slogan', ''),
        company_website: getSetting('company_website', ''),
        invoice_notes: getSetting('invoice_notes', ''),
        payment_bank_name: getSetting('payment_bank_name', ''),
        payment_account_number: getSetting('payment_account_number', ''),
        payment_account_holder: getSetting('payment_account_holder', ''),
        payment_cash_address: getSetting('payment_cash_address', ''),
        payment_cash_hours: getSetting('payment_cash_hours', ''),
        contact_phone: getSetting('contact_phone', ''),
        contact_email: getSetting('contact_email', ''),
        contact_address: getSetting('contact_address', ''),
        contact_whatsapp: getSetting('contact_whatsapp', ''),
        suspension_grace_period_days: getSetting('suspension_grace_period_days', '3'),
        isolir_profile: getSetting('isolir_profile', 'isolir')
    };
    next();
};

// Mobile Admin Billing Dashboard
router.get('/mobile', getAppSettings, async (req, res) => {
    try {
        // Get basic stats for mobile dashboard
        const totalCustomers = await billingManager.getTotalCustomers();
        const totalInvoices = await billingManager.getTotalInvoices();
        const totalRevenue = await billingManager.getTotalRevenue();
        const pendingPayments = await billingManager.getPendingPayments();
        
        // Redirect to responsive desktop dashboard
        res.redirect('/admin/billing/dashboard');
    } catch (error) {
        logger.error('Error loading mobile billing dashboard:', error);
        res.status(500).render('error', { 
            message: 'Error loading mobile billing dashboard',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Mobile Customers Management
// Mobile Customers - Redirect to responsive desktop version
router.get('/mobile/customers', getAppSettings, async (req, res) => {
    try {
        // Redirect to responsive desktop version
        res.redirect('/admin/billing/customers');
    } catch (error) {
        logger.error('Error loading mobile customers:', error);
        res.status(500).render('error', { 
            message: 'Error loading mobile customers',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Mobile Invoices - Redirect to responsive desktop version
router.get('/mobile/invoices', getAppSettings, async (req, res) => {
    try {
        // Redirect to responsive desktop version
        res.redirect('/admin/billing/invoices');
    } catch (error) {
        logger.error('Error loading mobile invoices:', error);
        res.status(500).render('error', { 
            message: 'Error loading mobile invoices',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Mobile Payments - Redirect to responsive desktop version
router.get('/mobile/payments', getAppSettings, async (req, res) => {
    try {
        // Redirect to responsive desktop version
        res.redirect('/admin/billing/payments');
    } catch (error) {
        logger.error('Error loading mobile payments:', error);
        res.status(500).render('error', { 
            message: 'Error loading mobile payments',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Monthly Reset Management
router.post('/api/monthly-reset', adminAuth, async (req, res) => {
    try {
        console.log('🔄 Manual monthly reset requested...');
        
        const MonthlyResetSystem = require('../scripts/monthly-reset-simple');
        const resetSystem = new MonthlyResetSystem();
        
        const result = await resetSystem.runMonthlyReset();
        
        res.json({
            success: true,
            message: 'Monthly reset completed successfully',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error in manual monthly reset:', error);
        res.status(500).json({
            success: false,
            message: 'Error in monthly reset: ' + error.message
        });
    }
});

// Get monthly reset status
router.get('/api/monthly-reset-status', adminAuth, async (req, res) => {
    try {
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Get last reset date
        const lastReset = await new Promise((resolve, reject) => {
            db.get(`
                SELECT value FROM system_settings 
                WHERE key = 'monthly_reset_date'
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.value : null);
            });
        });
        
        // Get current month stats
        const currentStats = await new Promise((resolve, reject) => {
            const MonthlyResetSystem = require('../scripts/monthly-reset-simple');
            const resetSystem = new MonthlyResetSystem();
            resetSystem.getCurrentStatistics()
                .then(stats => resolve(stats))
                .catch(err => reject(err));
        });
        
        db.close();
        
        res.json({
            success: true,
            data: {
                lastReset: lastReset,
                currentStats: currentStats,
                nextReset: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error getting monthly reset status:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting reset status: ' + error.message
        });
    }
});

// Mobile Collector Management
router.get('/mobile/collector', getAppSettings, async (req, res) => {
    try {
        // Get collectors list for mobile
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Get collectors with statistics - dengan validasi data
        const collectors = await new Promise((resolve, reject) => {
            db.all(`
                SELECT c.*, 
                       COUNT(cp.id) as total_payments,
                       COALESCE(SUM(cp.payment_amount), 0) as total_collected,
                       COALESCE(SUM(cp.commission_amount), 0) as total_commission
                FROM collectors c
                LEFT JOIN collector_payments cp ON c.id = cp.collector_id 
                    AND cp.status = 'completed'
                GROUP BY c.id
                ORDER BY c.name
            `, (err, rows) => {
                if (err) reject(err);
                else {
                    // Validasi dan format data collectors
                    const validCollectors = (rows || []).map(row => ({
                        ...row,
                        commission_rate: Math.max(0, Math.min(100, parseFloat(row.commission_rate || 5))),
                        total_payments: parseInt(row.total_payments || 0),
                        total_collected: Math.round(parseFloat(row.total_collected || 0)),
                        total_commission: Math.round(parseFloat(row.total_commission || 0)),
                        name: row.name || 'Unknown Collector',
                        status: row.status || 'active'
                    }));
                    resolve(validCollectors);
                }
            });
        });
        
        // Calculate statistics
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
        
        const todayPayments = await new Promise((resolve, reject) => {
            db.get(`
                SELECT COALESCE(SUM(payment_amount), 0) as total
                FROM collector_payments 
                WHERE collected_at >= ? AND collected_at < ? AND status = 'completed'
            `, [startOfDay.toISOString(), endOfDay.toISOString()], (err, row) => {
                if (err) reject(err);
                else resolve(Math.round(parseFloat(row ? row.total : 0))); // Rounding untuk konsistensi
            });
        });
        
        const totalCollectors = collectors.length;
        
        db.close();
        
        res.render('admin/billing/mobile-collector', {
            title: 'Tukang Tagih - Mobile',
            appSettings: req.appSettings,
            collectors: collectors,
            statistics: {
                totalCollectors: totalCollectors,
                todayPayments: todayPayments
            }
        });
    } catch (error) {
        logger.error('Error loading mobile collectors:', error);
        res.status(500).render('error', { 
            message: 'Error loading mobile collectors',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// API: Get customer invoices for collector payment
router.get('/api/customer-invoices/:customerId', adminAuth, async (req, res) => {
    try {
        const { customerId } = req.params;
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        const invoices = await new Promise((resolve, reject) => {
            db.all(`
                SELECT i.*, p.name as package_name
                FROM invoices i
                LEFT JOIN packages p ON i.package_id = p.id
                WHERE i.customer_id = ? AND i.status = 'unpaid'
                ORDER BY i.created_at DESC
            `, [customerId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            data: invoices
        });
        
    } catch (error) {
        console.error('Error getting customer invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting customer invoices: ' + error.message
        });
    }
});

// API: Submit collector payment
router.post('/api/collector-payment', adminAuth, async (req, res) => {
    try {
        const { collector_id, customer_id, payment_amount, payment_method, notes, invoice_ids } = req.body;
        
        if (!collector_id || !customer_id || !payment_amount) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }
        
        // Validasi jumlah pembayaran
        const paymentAmountNum = Number(payment_amount);
        if (paymentAmountNum <= 0 || paymentAmountNum > 999999999) {
            return res.status(400).json({
                success: false,
                message: 'Jumlah pembayaran tidak valid (harus > 0 dan < 999,999,999)'
            });
        }
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Mulai transaction untuk operasi kompleks
        await new Promise((resolve, reject) => {
            db.run('BEGIN TRANSACTION', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        try {
            // Get collector commission rate
        const collector = await new Promise((resolve, reject) => {
            db.get('SELECT commission_rate FROM collectors WHERE id = ?', [collector_id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!collector) {
            return res.status(400).json({
                success: false,
                message: 'Collector not found'
            });
        }
        
        const commissionRate = collector.commission_rate || 5;
        
        // Validasi commission rate
        if (commissionRate < 0 || commissionRate > 100) {
            return res.status(400).json({
                success: false,
                message: 'Rate komisi tidak valid (harus antara 0-100%)'
            });
        }
        
        const commissionAmount = Math.round((paymentAmountNum * commissionRate) / 100); // Rounding untuk komisi
        
        // Insert collector payment (ensure legacy 'amount' column is populated)
        const paymentId = await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO collector_payments (
                    collector_id, customer_id, amount, payment_amount, commission_amount,
                    payment_method, notes, status, collected_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', CURRENT_TIMESTAMP)
            `, [collector_id, customer_id, paymentAmountNum, paymentAmountNum, commissionAmount, payment_method, notes], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
        
        // Update invoices if specified, else auto-allocate to oldest unpaid invoices
        if (invoice_ids && invoice_ids.length > 0) {
            for (const invoiceId of invoice_ids) {
                // Tandai invoice lunas
                await billingManager.updateInvoiceStatus(Number(invoiceId), 'paid', payment_method);
                // Catat entri payment sesuai nilai invoice dengan collector info
                const inv = await billingManager.getInvoiceById(Number(invoiceId));
                const invAmount = parseFloat(inv?.amount || 0) || 0;
                await billingManager.recordCollectorPayment({
                    invoice_id: Number(invoiceId),
                    amount: invAmount,
                    payment_method,
                    reference_number: '',
                    notes: notes || `Collector ${collector_id}`,
                    collector_id: collector_id,
                    commission_amount: Math.round((invAmount * commissionRate) / 100)
                });
            }
        } else {
            // Auto allocate payment to unpaid invoices (oldest first)
            let remaining = Number(payment_amount) || 0;
            if (remaining > 0) {
                const unpaidInvoices = await new Promise((resolve, reject) => {
                    db.all(`
                        SELECT id, amount FROM invoices 
                        WHERE customer_id = ? AND status = 'unpaid'
                        ORDER BY due_date ASC, id ASC
                    `, [customer_id], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    });
                });
                for (const inv of unpaidInvoices) {
                    const invAmount = Number(inv.amount) || 0;
                    if (remaining >= invAmount && invAmount > 0) {
                        await billingManager.updateInvoiceStatus(inv.id, 'paid', payment_method);
                        await billingManager.recordCollectorPayment({
                            invoice_id: inv.id,
                            amount: invAmount,
                            payment_method,
                            reference_number: '',
                            notes: notes || `Collector ${collector_id}`,
                            collector_id: collector_id,
                            commission_amount: Math.round((invAmount * commissionRate) / 100)
                        });
                        remaining -= invAmount;
                        if (remaining <= 0) break;
                    } else {
                        break; // skip partial for now
                    }
                }
            }
        }
        
            // Commit transaction jika semua operasi berhasil
            await new Promise((resolve, reject) => {
                db.run('COMMIT', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
        } catch (error) {
            // Rollback transaction jika ada error
            await new Promise((resolve) => {
                db.run('ROLLBACK', () => resolve());
            });
            throw error;
        } finally {
            db.close();
        }
        
        res.json({
            success: true,
            message: 'Payment recorded successfully',
            payment_id: paymentId,
            commission_amount: commissionAmount
        });
        
    } catch (error) {
        console.error('Error recording collector payment:', error);
        res.status(500).json({
            success: false,
            message: 'Error recording payment: ' + error.message
        });
    }
});

// Mobile Collector Payment Input
router.get('/mobile/collector/payment', getAppSettings, async (req, res) => {
    try {
        // Get collectors and customers for payment form
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        const [collectors, customers] = await Promise.all([
            new Promise((resolve, reject) => {
                db.all('SELECT * FROM collectors WHERE status = "active" ORDER BY name', (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            }),
            new Promise((resolve, reject) => {
                db.all('SELECT * FROM customers WHERE status = "active" ORDER BY name', (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            })
        ]);
        
        db.close();
        
        res.render('admin/billing/mobile-collector-payment', {
            title: 'Input Pembayaran - Mobile',
            appSettings: req.appSettings,
            collectors: collectors,
            customers: customers
        });
    } catch (error) {
        logger.error('Error loading collector payment form:', error);
        res.status(500).render('error', { 
            message: 'Error loading payment form',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Collector Reports
router.get('/collector-reports', getAppSettings, async (req, res) => {
    try {
        const { dateFrom, dateTo, collector } = req.query;
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Check if collectors table exists
        const tableExists = await new Promise((resolve, reject) => {
            db.get(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='collectors'
            `, (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            });
        });
        
        if (!tableExists) {
            db.close();
            return res.render('admin/billing/collector-reports', {
                title: 'Laporan Kolektor',
                appSettings: req.appSettings,
                collectors: [],
                summary: {
                    total_collectors: 0,
                    total_payments: 0,
                    total_commissions: 0,
                    total_setoran: 0
                },
                filters: {
                    dateFrom: dateFrom || '',
                    dateTo: dateTo || '',
                    collector: collector || ''
                },
                error: 'Tabel kolektor belum tersedia. Silakan tambahkan kolektor terlebih dahulu.'
            });
        }
        
        // Set default date range (last 30 days)
        const defaultDateTo = new Date();
        const defaultDateFrom = new Date();
        defaultDateFrom.setDate(defaultDateFrom.getDate() - 30);
        
        const startDate = dateFrom || defaultDateFrom.toISOString().split('T')[0];
        const endDate = dateTo || defaultDateTo.toISOString().split('T')[0];
        
        // Build date filter
        const dateFilter = `AND cp.collected_at >= '${startDate}' AND cp.collected_at <= '${endDate} 23:59:59'`;
        
        // Build collector filter
        const collectorFilter = collector ? `AND c.id = ${collector}` : '';
        
        // Get collectors with statistics
        const collectors = await new Promise((resolve, reject) => {
            db.all(`
                SELECT c.*, 
                       COUNT(cp.id) as total_payments,
                       COALESCE(SUM(cp.payment_amount), 0) as total_payment_amount,
                       COALESCE(SUM(cp.commission_amount), 0) as total_commission,
                       COALESCE(SUM(cp.payment_amount - cp.commission_amount), 0) as total_setoran
                FROM collectors c
                LEFT JOIN collector_payments cp ON c.id = cp.collector_id 
                    AND cp.status = 'completed'
                    ${dateFilter}
                WHERE c.status = 'active' ${collectorFilter}
                GROUP BY c.id
                ORDER BY c.name
            `, (err, rows) => {
                if (err) {
                    console.error('Error in collectors query:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
        
        // Get summary statistics
        const summary = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(DISTINCT c.id) as total_collectors,
                    COALESCE(SUM(cp.payment_amount), 0) as total_payments,
                    COALESCE(SUM(cp.commission_amount), 0) as total_commissions,
                    COALESCE(SUM(cp.payment_amount - cp.commission_amount), 0) as total_setoran
                FROM collectors c
                LEFT JOIN collector_payments cp ON c.id = cp.collector_id 
                    AND cp.status = 'completed'
                    ${dateFilter}
                WHERE c.status = 'active' ${collectorFilter}
            `, (err, row) => {
                if (err) {
                    console.error('Error in summary query:', err);
                    reject(err);
                } else {
                    resolve(row || {
                        total_collectors: 0,
                        total_payments: 0,
                        total_commissions: 0,
                        total_setoran: 0
                    });
                }
            });
        });
        
        db.close();
        
        res.render('admin/billing/collector-reports', {
            title: 'Laporan Kolektor',
            appSettings: req.appSettings,
            collectors: collectors,
            summary: summary,
            filters: {
                dateFrom: startDate,
                dateTo: endDate,
                collector: collector || ''
            }
        });
        
    } catch (error) {
        logger.error('Error loading collector reports:', error);
        res.status(500).render('error', { 
            message: 'Error loading collector reports',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Collector Details
router.get('/collector-details/:id', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const { dateFrom, dateTo } = req.query;
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Set default date range (last 30 days)
        const defaultDateTo = new Date();
        const defaultDateFrom = new Date();
        defaultDateFrom.setDate(defaultDateFrom.getDate() - 30);
        
        const startDate = dateFrom || defaultDateFrom.toISOString().split('T')[0];
        const endDate = dateTo || defaultDateTo.toISOString().split('T')[0];
        
        // Get collector details
        const collector = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM collectors WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!collector) {
            db.close();
            return res.status(404).render('error', { 
                message: 'Kolektor tidak ditemukan',
                error: {}
            });
        }
        
        // Get collector payments with date filter
        const payments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT cp.*, c.name as customer_name, c.phone as customer_phone
                FROM collector_payments cp
                LEFT JOIN customers c ON cp.customer_id = c.id
                WHERE cp.collector_id = ? 
                AND cp.collected_at >= ? 
                AND cp.collected_at <= ?
                ORDER BY cp.collected_at DESC
            `, [id, startDate, endDate + ' 23:59:59'], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        // Get collector statistics
        const stats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_payments,
                    COALESCE(SUM(payment_amount), 0) as total_payment_amount,
                    COALESCE(SUM(commission_amount), 0) as total_commission,
                    COALESCE(SUM(payment_amount - commission_amount), 0) as total_setoran
                FROM collector_payments 
                WHERE collector_id = ? 
                AND collected_at >= ? 
                AND collected_at <= ?
                AND status = 'completed'
            `, [id, startDate, endDate + ' 23:59:59'], (err, row) => {
                if (err) reject(err);
                else resolve(row || {
                    total_payments: 0,
                    total_payment_amount: 0,
                    total_commission: 0,
                    total_setoran: 0
                });
            });
        });
        
        db.close();
        
        res.render('admin/billing/collector-details', {
            title: `Detail Kolektor - ${collector.name}`,
            appSettings: req.appSettings,
            collector: collector,
            payments: payments,
            stats: stats,
            filters: {
                dateFrom: startDate,
                dateTo: endDate
            }
        });
        
    } catch (error) {
        logger.error('Error loading collector details:', error);
        res.status(500).render('error', { 
            message: 'Error loading collector details',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Collector Remittance
router.get('/collector-remittance', getAppSettings, async (req, res) => {
    try {
        // Get collectors with pending amounts from payments table
        const collectors = await billingManager.getCollectorsWithPendingAmounts();
        
        // Get recent remittances from expenses table (commission expenses)
        const remittances = await billingManager.getCommissionExpenses();
        
        res.render('admin/billing/collector-remittance', {
            title: 'Terima Setoran Kolektor',
            appSettings: req.appSettings,
            collectors: collectors,
            remittances: remittances
        });
        
    } catch (error) {
        logger.error('Error loading collector remittance:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat data setoran kolektor',
            error: error.message 
        });
    }
});

// API: Record Collector Remittance
router.post('/api/collector-remittance', adminAuth, async (req, res) => {
    try {
        const { collector_id, remittance_amount, payment_method, notes, remittance_date } = req.body;
        
        if (!collector_id || !remittance_amount || !payment_method) {
            return res.status(400).json({
                success: false,
                message: 'Semua field wajib diisi'
            });
        }
        
        // Use billing manager to record remittance
        const result = await billingManager.recordCollectorRemittance({
            collector_id,
            amount: parseFloat(remittance_amount),
            payment_method,
            notes: notes || '',
            remittance_date: remittance_date || new Date().toISOString()
        });
        
        res.json({
            success: true,
            message: 'Setoran berhasil diterima',
            data: result
        });
        
    } catch (error) {
        console.error('Error recording collector remittance:', error);
        res.status(500).json({
            success: false,
            message: 'Error recording remittance: ' + error.message
        });
    }
});

// Mobile Map Management - Now using responsive mapping-new.ejs
router.get('/mobile/map', getAppSettings, async (req, res) => {
    try {
        // Redirect to main mapping page (responsive)
        res.redirect('/admin/billing/mapping');
    } catch (error) {
        logger.error('Error loading mobile map:', error);
        res.status(500).render('error', { 
            message: 'Error loading mobile map',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// GET: Redirect untuk cable routes ke cable-network
router.get('/cables', adminAuth, (req, res) => {
    res.redirect('/admin/cable-network/cables');
});

// GET: Redirect untuk ODP ke cable-network
router.get('/odp', adminAuth, (req, res) => {
    res.redirect('/admin/cable-network/odp');
});

// Dashboard Billing
router.get('/dashboard', getAppSettings, async (req, res) => {
    try {
        // Jalankan cleanup data konsistensi terlebih dahulu
        await billingManager.cleanupDataConsistency();
        
        const stats = await billingManager.getBillingStats();
        const overdueInvoices = await billingManager.getOverdueInvoices();
        const recentInvoices = await billingManager.getInvoices();
        
        res.render('admin/billing/dashboard', {
            title: 'Dashboard Billing',
            stats,
            overdueInvoices: overdueInvoices.slice(0, 10),
            recentInvoices: recentInvoices.slice(0, 10),
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading billing dashboard:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat dashboard billing',
            error: error.message 
        });
    }
});

// Laporan Keuangan
router.get('/financial-report', getAppSettings, async (req, res) => {
    try {
        const { start_date, end_date, type } = req.query;
        
        // Default date range: current month
        const now = new Date();
        const startDate = start_date || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const endDate = end_date || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        
        const financialData = await billingManager.getFinancialReport(startDate, endDate, type);
        
        res.render('admin/billing/financial-report', {
            title: 'Laporan Keuangan',
            financialData,
            startDate,
            endDate,
            type: type || 'all',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading financial report:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat laporan keuangan',
            error: error.message 
        });
    }
});

// API untuk data laporan keuangan
router.get('/api/financial-report', async (req, res) => {
    try {
        const { start_date, end_date, type } = req.query;
        const financialData = await billingManager.getFinancialReport(start_date, end_date, type);
        res.json({ success: true, data: financialData });
    } catch (error) {
        logger.error('Error getting financial report data:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API untuk cleanup data konsistensi
router.post('/api/cleanup-data', adminAuth, async (req, res) => {
    try {
        await billingManager.cleanupDataConsistency();
        const stats = await billingManager.getBillingStats();
        
        res.json({ 
            success: true, 
            message: 'Data konsistensi berhasil diperbaiki',
            stats 
        });
    } catch (error) {
        logger.error('Error cleaning up data:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API untuk mendapatkan statistik real-time
router.get('/api/stats', adminAuth, async (req, res) => {
    try {
        const stats = await billingManager.getBillingStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Error getting billing stats:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Revenue summary API (payments-based)
router.get('/api/revenue/summary', adminAuth, async (req, res) => {
    try {
        const { from, to } = req.query;
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);

        function getDateStr(d) { return new Date(d).toISOString().split('T')[0]; }
        const todayStr = getDateStr(new Date());
        const weekAgoStr = getDateStr(new Date(Date.now() - 6 * 24 * 3600 * 1000));

        const dateFrom = from || weekAgoStr;
        const dateTo = to || todayStr;

        const [todayRevenue, weekRevenue, monthRevenue] = await Promise.all([
            new Promise((resolve, reject) => {
                db.get(`
                    SELECT COALESCE(SUM(amount),0) AS total
                    FROM payments
                    WHERE date(payment_date) = date(?)
                `, [todayStr], (err, row) => err ? reject(err) : resolve(row?.total || 0));
            }),
            new Promise((resolve, reject) => {
                db.get(`
                    SELECT COALESCE(SUM(amount),0) AS total
                    FROM payments
                    WHERE date(payment_date) BETWEEN date(?) AND date(?)
                `, [weekAgoStr, todayStr], (err, row) => err ? reject(err) : resolve(row?.total || 0));
            }),
            new Promise((resolve, reject) => {
                db.get(`
                    SELECT COALESCE(SUM(amount),0) AS total
                    FROM payments
                    WHERE strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now')
                `, [], (err, row) => err ? reject(err) : resolve(row?.total || 0));
            }),
        ]);

        db.close();
        res.json({ success: true, data: { todayRevenue, weekRevenue, monthRevenue, dateFrom, dateTo } });
    } catch (error) {
        logger.error('Error getting revenue summary:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Halaman Semua Invoice (Invoice List)
router.get('/invoice-list', getAppSettings, async (req, res) => {
    try {
        const { page = 1, limit = 50, status, customer_username, type } = req.query;
        const offset = (page - 1) * limit;
        
        // Get all invoices with pagination
        const invoices = await billingManager.getInvoices(null, limit, offset);
        const customers = await billingManager.getCustomers();
        const packages = await billingManager.getPackages();
        
        // Get total count for pagination
        const totalCount = await billingManager.getInvoicesCount();
        
        res.render('admin/billing/invoice-list', {
            title: 'Semua Invoice',
            invoices,
            customers,
            packages,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / limit),
                totalCount,
                limit: parseInt(limit)
            },
            filters: {
                status: status || '',
                customer_username: customer_username || '',
                type: type || ''
            },
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoice list:', error);
        res.status(500).render('error', {
            message: 'Error loading invoice list',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Halaman Invoice by Type
router.get('/invoices-by-type', adminAuth, async (req, res) => {
    try {
        // Get invoices by type
        const monthlyInvoices = await billingManager.getInvoicesByType('monthly');
        const voucherInvoices = await billingManager.getInvoicesByType('voucher');
        const manualInvoices = await billingManager.getInvoicesByType('manual');
        
        // Get stats by type
        const monthlyStats = await billingManager.getInvoiceStatsByType('monthly');
        const voucherStats = await billingManager.getInvoiceStatsByType('voucher');
        const manualStats = await billingManager.getInvoiceStatsByType('manual');
        
        res.render('admin/billing/invoices-by-type', {
            title: 'Invoice by Type',
            monthlyInvoices: monthlyInvoices.slice(0, 50), // Limit to 50 per type
            voucherInvoices: voucherInvoices.slice(0, 50),
            manualInvoices: manualInvoices.slice(0, 50),
            monthlyStats,
            voucherStats,
            manualStats
        });
    } catch (error) {
        logger.error('Error loading invoices by type:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat halaman invoice by type',
            error: error.message 
        });
    }
});

// API untuk cleanup voucher manual
router.post('/api/voucher-cleanup', adminAuth, async (req, res) => {
    try {
        const result = await billingManager.cleanupExpiredVoucherInvoices();
        
        res.json({
            success: result.success,
            message: result.message,
            cleaned: result.cleaned,
            expiredInvoices: result.expiredInvoices || []
        });
    } catch (error) {
        logger.error('Error in manual voucher cleanup:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal melakukan cleanup voucher',
            error: error.message
        });
    }
});

// API untuk melihat expired voucher invoices
router.get('/api/expired-vouchers', adminAuth, async (req, res) => {
    try {
        const expiredInvoices = await billingManager.getExpiredVoucherInvoices();
        
        res.json({
            success: true,
            data: expiredInvoices,
            count: expiredInvoices.length
        });
    } catch (error) {
        logger.error('Error getting expired voucher invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data expired voucher',
            error: error.message
        });
    }
});

// Halaman Monthly Summary
router.get('/monthly-summary', adminAuth, async (req, res) => {
    try {
        const summaries = await billingManager.getAllMonthlySummaries(24); // Last 24 months
        
        res.render('admin/billing/monthly-summary', {
            title: 'Summary Bulanan',
            summaries,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading monthly summary:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat summary bulanan',
            error: error.message 
        });
    }
});

// API untuk generate summary bulanan manual
router.post('/api/generate-monthly-summary', adminAuth, async (req, res) => {
    try {
        const result = await billingManager.generateMonthlySummary();
        
        res.json({
            success: result.success,
            message: result.message,
            year: result.year,
            month: result.month,
            stats: result.stats
        });
    } catch (error) {
        logger.error('Error generating monthly summary:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal generate summary bulanan',
            error: error.message
        });
    }
});

// API untuk manual monthly reset
router.post('/api/monthly-reset', adminAuth, async (req, res) => {
    try {
        const result = await billingManager.performMonthlyReset();
        
        res.json({
            success: result.success,
            message: result.message,
            year: result.year,
            month: result.month,
            previousYear: result.previousYear,
            previousMonth: result.previousMonth,
            collectorsProcessed: result.collectorsProcessed
        });
    } catch (error) {
        logger.error('Error performing monthly reset:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal melakukan monthly reset',
            error: error.message
        });
    }
});

// API untuk manual trigger monthly reset via scheduler
router.post('/api/trigger-monthly-reset', adminAuth, async (req, res) => {
    try {
        const scheduler = require('../config/scheduler');
        const result = await scheduler.triggerMonthlyReset();
        
        res.json({
            success: result.success,
            message: result.message,
            year: result.year,
            month: result.month,
            previousYear: result.previousYear,
            previousMonth: result.previousMonth,
            collectorsProcessed: result.collectorsProcessed
        });
    } catch (error) {
        logger.error('Error triggering monthly reset:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal trigger monthly reset',
            error: error.message
        });
    }
});

// API untuk mendapatkan summary bulanan
router.get('/api/monthly-summary', adminAuth, async (req, res) => {
    try {
        const { year, month } = req.query;
        
        if (year && month) {
            const summary = await billingManager.getMonthlySummary(parseInt(year), parseInt(month));
            res.json({
                success: true,
                data: summary
            });
        } else {
            const summaries = await billingManager.getAllMonthlySummaries(12);
            res.json({
                success: true,
                data: summaries
            });
        }
    } catch (error) {
        logger.error('Error getting monthly summary:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil summary bulanan',
            error: error.message
        });
    }
});

// Export laporan keuangan bulanan ke Excel
router.get('/export/monthly-summary.xlsx', adminAuth, async (req, res) => {
    try {
        const ExcelJS = require('exceljs');
        const summaries = await billingManager.getAllMonthlySummaries(24);
        
        // Buat workbook Excel
        const workbook = new ExcelJS.Workbook();
        
        // Sheet 1: Summary Data
        const summarySheet = workbook.addWorksheet('Summary Bulanan');
        summarySheet.columns = [
            { header: 'Tahun', key: 'year', width: 8 },
            { header: 'Bulan', key: 'month', width: 10 },
            { header: 'Total Pelanggan', key: 'total_customers', width: 15 },
            { header: 'Pelanggan Aktif', key: 'active_customers', width: 15 },
            { header: 'Invoice Bulanan', key: 'monthly_invoices', width: 15 },
            { header: 'Invoice Voucher', key: 'voucher_invoices', width: 15 },
            { header: 'Lunas Bulanan', key: 'paid_monthly_invoices', width: 15 },
            { header: 'Lunas Voucher', key: 'paid_voucher_invoices', width: 15 },
            { header: 'Belum Lunas Bulanan', key: 'unpaid_monthly_invoices', width: 18 },
            { header: 'Belum Lunas Voucher', key: 'unpaid_voucher_invoices', width: 18 },
            { header: 'Pendapatan Bulanan', key: 'monthly_revenue', width: 18 },
            { header: 'Pendapatan Voucher', key: 'voucher_revenue', width: 18 },
            { header: 'Total Pendapatan', key: 'total_revenue', width: 18 },
            { header: 'Belum Dibayar', key: 'total_unpaid', width: 15 },
            { header: 'Tanggal Generate', key: 'created_at', width: 20 }
        ];
        
        // Tambahkan data summary
        summaries.forEach(summary => {
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            summarySheet.addRow({
                year: summary.year,
                month: monthNames[summary.month - 1],
                total_customers: summary.total_customers,
                active_customers: summary.active_customers,
                monthly_invoices: summary.monthly_invoices,
                voucher_invoices: summary.voucher_invoices,
                paid_monthly_invoices: summary.paid_monthly_invoices,
                paid_voucher_invoices: summary.paid_voucher_invoices,
                unpaid_monthly_invoices: summary.unpaid_monthly_invoices,
                unpaid_voucher_invoices: summary.unpaid_voucher_invoices,
                monthly_revenue: summary.monthly_revenue,
                voucher_revenue: summary.voucher_revenue,
                total_revenue: summary.total_revenue,
                total_unpaid: summary.total_unpaid,
                created_at: new Date(summary.created_at).toLocaleDateString('id-ID')
            });
        });
        
        // Format currency untuk kolom revenue
        summarySheet.getColumn('monthly_revenue').numFmt = '"Rp" #,##0.00';
        summarySheet.getColumn('voucher_revenue').numFmt = '"Rp" #,##0.00';
        summarySheet.getColumn('total_revenue').numFmt = '"Rp" #,##0.00';
        summarySheet.getColumn('total_unpaid').numFmt = '"Rp" #,##0.00';
        
        // Sheet 2: Analisis Trend
        const trendSheet = workbook.addWorksheet('Analisis Trend');
        trendSheet.columns = [
            { header: 'Metrik', key: 'metric', width: 25 },
            { header: 'Nilai Terbaru', key: 'latest', width: 20 },
            { header: 'Nilai Sebelumnya', key: 'previous', width: 20 },
            { header: 'Growth (%)', key: 'growth', width: 15 },
            { header: 'Status', key: 'status', width: 15 }
        ];
        
        if (summaries.length >= 2) {
            const latest = summaries[0];
            const previous = summaries[1];
            
            const metrics = [
                { name: 'Total Revenue', latest: latest.total_revenue, previous: previous.total_revenue },
                { name: 'Monthly Revenue', latest: latest.monthly_revenue, previous: previous.monthly_revenue },
                { name: 'Voucher Revenue', latest: latest.voucher_revenue, previous: previous.voucher_revenue },
                { name: 'Total Customers', latest: latest.total_customers, previous: previous.total_customers },
                { name: 'Active Customers', latest: latest.active_customers, previous: previous.active_customers },
                { name: 'Monthly Invoices', latest: latest.monthly_invoices, previous: previous.monthly_invoices },
                { name: 'Voucher Invoices', latest: latest.voucher_invoices, previous: previous.voucher_invoices }
            ];
            
            metrics.forEach(metric => {
                const growth = ((metric.latest - metric.previous) / metric.previous * 100).toFixed(1);
                let status = 'Stable';
                if (growth > 5) status = 'Growth';
                else if (growth < -5) status = 'Decline';
                
                trendSheet.addRow({
                    metric: metric.name,
                    latest: metric.latest,
                    previous: metric.previous,
                    growth: growth + '%',
                    status: status
                });
            });
        }
        
        // Sheet 3: KPI Summary
        const kpiSheet = workbook.addWorksheet('KPI Summary');
        kpiSheet.columns = [
            { header: 'KPI', key: 'kpi', width: 30 },
            { header: 'Nilai', key: 'value', width: 20 },
            { header: 'Keterangan', key: 'description', width: 40 }
        ];
        
        if (summaries.length > 0) {
            const latest = summaries[0];
            const avgRevenue = summaries.reduce((sum, s) => sum + s.total_revenue, 0) / summaries.length;
            const bestMonth = summaries.reduce((max, s) => s.total_revenue > max.total_revenue ? s : max);
            
            const kpis = [
                { kpi: 'Total Revenue Terbaru', value: `Rp ${latest.total_revenue.toLocaleString('id-ID')}`, description: 'Pendapatan total bulan terbaru' },
                { kpi: 'Rata-rata Revenue', value: `Rp ${avgRevenue.toLocaleString('id-ID')}`, description: 'Rata-rata pendapatan per bulan' },
                { kpi: 'Bulan Terbaik', value: `${bestMonth.month}/${bestMonth.year}`, description: `Rp ${bestMonth.total_revenue.toLocaleString('id-ID')}` },
                { kpi: 'Total Pelanggan', value: latest.total_customers, description: 'Jumlah pelanggan terdaftar' },
                { kpi: 'Pelanggan Aktif', value: latest.active_customers, description: 'Pelanggan dengan status aktif' },
                { kpi: 'Collection Rate', value: `${((latest.paid_monthly_invoices + latest.paid_voucher_invoices) / (latest.monthly_invoices + latest.voucher_invoices) * 100).toFixed(1)}%`, description: 'Persentase invoice yang dibayar' }
            ];
            
            kpis.forEach(kpi => {
                kpiSheet.addRow(kpi);
            });
        }
        
        // Set response header
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=laporan-keuangan-bulanan-${new Date().toISOString().split('T')[0]}.xlsx`);
        
        // Write to response
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (error) {
        logger.error('Error exporting monthly summary:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Export laporan keuangan ke Excel
router.get('/export/financial-report.xlsx', async (req, res) => {
    try {
        const { start_date, end_date, type } = req.query;
        const financialData = await billingManager.getFinancialReport(start_date, end_date, type);
        
        // Buat workbook Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Laporan Keuangan');
        
        // Set header
        worksheet.columns = [
            { header: 'Tanggal', key: 'date', width: 15 },
            { header: 'Tipe', key: 'type', width: 12 },
            { header: 'Jumlah', key: 'amount', width: 15 },
            { header: 'Metode Pembayaran', key: 'payment_method', width: 20 },
            { header: 'Gateway', key: 'gateway_name', width: 15 },
            { header: 'No. Invoice', key: 'invoice_number', width: 20 },
            { header: 'Pelanggan', key: 'customer_name', width: 25 },
            { header: 'Telepon', key: 'customer_phone', width: 15 }
        ];
        
        // Tambahkan data transaksi
        financialData.transactions.forEach(transaction => {
            worksheet.addRow({
                date: new Date(transaction.date).toLocaleDateString('id-ID'),
                type: transaction.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
                amount: transaction.amount || 0,
                payment_method: transaction.payment_method || '-',
                gateway_name: transaction.gateway_name || '-',
                invoice_number: transaction.invoice_number || '-',
                customer_name: transaction.customer_name || '-',
                customer_phone: transaction.customer_phone || '-'
            });
        });
        
        // Tambahkan summary di sheet terpisah
        const summarySheet = workbook.addWorksheet('Ringkasan');
        summarySheet.columns = [
            { header: 'Item', key: 'item', width: 25 },
            { header: 'Nilai', key: 'value', width: 20 }
        ];
        
        summarySheet.addRow({ item: 'Total Pemasukan', value: `Rp ${financialData.summary.totalIncome.toLocaleString('id-ID')}` });
        summarySheet.addRow({ item: 'Total Pengeluaran', value: `Rp ${financialData.summary.totalExpense.toLocaleString('id-ID')}` });
        summarySheet.addRow({ item: 'Laba Bersih', value: `Rp ${financialData.summary.netProfit.toLocaleString('id-ID')}` });
        summarySheet.addRow({ item: 'Jumlah Transaksi', value: financialData.summary.transactionCount });
        summarySheet.addRow({ item: 'Periode', value: `${financialData.dateRange.startDate} - ${financialData.dateRange.endDate}` });
        
        // Set response header
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=laporan-keuangan-${start_date}-${end_date}.xlsx`);
        
        // Write to response
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (error) {
        logger.error('Error exporting financial report:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update active gateway (JSON API used by page)
router.post('/payment-settings/active-gateway', async (req, res) => {
    try {
        const { activeGateway } = req.body || {};
        if (!activeGateway || !['midtrans', 'xendit', 'tripay'].includes(activeGateway)) {
            return res.status(400).json({ success: false, message: 'activeGateway tidak valid' });
        }
        const all = getSettingsWithCache();
        const pg = all.payment_gateway || {};
        pg.active = activeGateway;
        const ok = setSetting('payment_gateway', pg);
        if (!ok) throw new Error('Gagal menyimpan settings.json');
        try { billingManager.reloadPaymentGateway(); } catch (_) {}
        return res.json({ success: true, message: 'Gateway aktif diperbarui', active: activeGateway });
    } catch (error) {
        logger.error('Error updating active gateway:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Save per-gateway settings (JSON API)
router.post('/payment-settings/:gateway', async (req, res) => {
    try {
        const gateway = String(req.params.gateway || '').toLowerCase();
        if (!['midtrans', 'xendit', 'tripay'].includes(gateway)) {
            return res.status(400).json({ success: false, message: 'Gateway tidak dikenali' });
        }

        const toBool = (v, def=false) => {
            if (typeof v === 'boolean') return v;
            if (v === 'on' || v === 'true' || v === '1') return true;
            if (v === 'off' || v === 'false' || v === '0') return false;
            return def;
        };

        const all = getSettingsWithCache();
        const pg = all.payment_gateway || {};

        if (gateway === 'midtrans') {
            if (req.body.base_url !== undefined && !isValidOptionalHttpUrl(req.body.base_url)) {
                return res.status(400).json({ success: false, message: 'Midtrans base_url harus diawali http:// atau https://' });
            }
            pg.midtrans = {
                ...(pg.midtrans || {}),
                enabled: toBool(req.body.enabled, pg.midtrans?.enabled ?? true),
                production: toBool(req.body.production, pg.midtrans?.production ?? false),
                server_key: req.body.server_key !== undefined ? req.body.server_key : (pg.midtrans?.server_key || ''),
                client_key: req.body.client_key !== undefined ? req.body.client_key : (pg.midtrans?.client_key || ''),
                merchant_id: req.body.merchant_id !== undefined ? req.body.merchant_id : (pg.midtrans?.merchant_id || ''),
                base_url: req.body.base_url !== undefined ? String(req.body.base_url || '').trim() : (pg.midtrans?.base_url || '')
            };
        } else if (gateway === 'xendit') {
            if (req.body.base_url !== undefined && !isValidOptionalHttpUrl(req.body.base_url)) {
                return res.status(400).json({ success: false, message: 'Xendit base_url harus diawali http:// atau https://' });
            }
            pg.xendit = {
                ...(pg.xendit || {}),
                enabled: toBool(req.body.enabled, pg.xendit?.enabled ?? false),
                production: toBool(req.body.production, pg.xendit?.production ?? false),
                api_key: req.body.api_key !== undefined ? req.body.api_key : (pg.xendit?.api_key || ''),
                callback_token: req.body.callback_token !== undefined ? req.body.callback_token : (pg.xendit?.callback_token || ''),
                base_url: req.body.base_url !== undefined ? String(req.body.base_url || '').trim() : (pg.xendit?.base_url || '')
            };
        } else if (gateway === 'tripay') {
            if (req.body.base_url !== undefined && !isValidOptionalHttpUrl(req.body.base_url)) {
                return res.status(400).json({ success: false, message: 'Tripay base_url harus diawali http:// atau https://' });
            }
            pg.tripay = {
                ...(pg.tripay || {}),
                enabled: toBool(req.body.enabled, pg.tripay?.enabled ?? false),
                production: toBool(req.body.production, pg.tripay?.production ?? false),
                api_key: req.body.api_key !== undefined ? req.body.api_key : (pg.tripay?.api_key || ''),
                private_key: req.body.private_key !== undefined ? req.body.private_key : (pg.tripay?.private_key || ''),
                merchant_code: req.body.merchant_code !== undefined ? req.body.merchant_code : (pg.tripay?.merchant_code || ''),
                base_url: req.body.base_url !== undefined ? String(req.body.base_url || '').trim() : (pg.tripay?.base_url || pg.base_url || '')
                // Method is now selected by customer, removed from admin settings
            };
        }

        all.payment_gateway = pg;
        const ok = setSetting('payment_gateway', pg);
        if (!ok) throw new Error('Gagal menyimpan settings.json');
        try { billingManager.reloadPaymentGateway(); } catch (_) {}
        return res.json({ success: true, message: 'Konfigurasi disimpan', gateway });
    } catch (error) {
        logger.error('Error saving per-gateway settings:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Test gateway connectivity (basic status)
router.post('/payment-settings/test/:gateway', async (req, res) => {
    try {
        const gateway = String(req.params.gateway || '').toLowerCase();
        const status = await billingManager.getGatewayStatus();
        if (!status[gateway]) {
            return res.status(400).json({ success: false, message: 'Gateway tidak dikenali' });
        }
        return res.json({ success: true, message: 'Status dibaca', data: status[gateway] });
    } catch (error) {
        logger.error('Error testing gateway:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Payment Settings (Midtrans & Xendit)
router.get('/payment-settings', getAppSettings, async (req, res) => {
    try {
        const settings = getSettingsWithCache();
        const pg = settings.payment_gateway || {};
        const mid = pg.midtrans || {};
        const xe = pg.xendit || {};
        const saved = req.query.saved === '1';

        // Get current gateway status
        let gatewayStatus = {};
        try { gatewayStatus = await billingManager.getGatewayStatus(); } catch (_) {}

        res.render('admin/billing/payment-settings', {
            title: 'Payment Gateway Settings',
            appSettings: req.appSettings,
            settings,
            pg,
            mid,
            xe,
            gatewayStatus,
            saved
        });
    } catch (error) {
        logger.error('Error loading payment settings page:', error);
        res.status(500).render('error', {
            message: 'Error loading payment settings page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

router.post('/payment-settings', async (req, res) => {
    try {
        const all = getSettingsWithCache();
        const pg = all.payment_gateway || {};
        pg.active = req.body.active || pg.active || 'midtrans';

        // Normalize booleans
        const toBool = (v, def=false) => {
            if (typeof v === 'boolean') return v;
            if (v === 'on' || v === 'true' || v === '1') return true;
            if (v === 'off' || v === 'false' || v === '0') return false;
            return def;
        };

        // Validate base_url inputs from combined form (if present)
        if (req.body.midtrans_base_url !== undefined && !isValidOptionalHttpUrl(req.body.midtrans_base_url)) {
            return res.status(400).render('error', { message: 'Midtrans base_url harus diawali http:// atau https://', error: '', appSettings: req.appSettings });
        }
        if (req.body.xendit_base_url !== undefined && !isValidOptionalHttpUrl(req.body.xendit_base_url)) {
            return res.status(400).render('error', { message: 'Xendit base_url harus diawali http:// atau https://', error: '', appSettings: req.appSettings });
        }

        // Midtrans
        pg.midtrans = {
            ...(pg.midtrans || {}),
            enabled: toBool(req.body.midtrans_enabled, pg.midtrans?.enabled ?? true),
            production: toBool(req.body.midtrans_production, pg.midtrans?.production ?? false),
            server_key: req.body.midtrans_server_key !== undefined ? req.body.midtrans_server_key : (pg.midtrans?.server_key || ''),
            client_key: req.body.midtrans_client_key !== undefined ? req.body.midtrans_client_key : (pg.midtrans?.client_key || ''),
            merchant_id: req.body.midtrans_merchant_id !== undefined ? req.body.midtrans_merchant_id : (pg.midtrans?.merchant_id || ''),
            base_url: req.body.midtrans_base_url !== undefined ? String(req.body.midtrans_base_url || '').trim() : (pg.midtrans?.base_url || '')
        };

        // Xendit
        pg.xendit = {
            ...(pg.xendit || {}),
            enabled: toBool(req.body.xendit_enabled, pg.xendit?.enabled ?? false),
            production: toBool(req.body.xendit_production, pg.xendit?.production ?? false),
            api_key: req.body.xendit_api_key !== undefined ? req.body.xendit_api_key : (pg.xendit?.api_key || ''),
            callback_token: req.body.xendit_callback_token !== undefined ? req.body.xendit_callback_token : (pg.xendit?.callback_token || ''),
            base_url: req.body.xendit_base_url !== undefined ? String(req.body.xendit_base_url || '').trim() : (pg.xendit?.base_url || '')
        };

        // Persist back as a whole object
        all.payment_gateway = pg;
        const ok = setSetting('payment_gateway', pg);
        if (!ok) throw new Error('Failed to write settings.json');

        // Hot-reload gateways without restarting the server
        try { billingManager.reloadPaymentGateway(); } catch (_) {}

        // Redirect back with success
        return res.redirect('/admin/billing/payment-settings?saved=1');
    } catch (error) {
        logger.error('Error saving payment settings:', error);
        return res.status(500).render('error', {
            message: 'Error saving payment settings',
            error: error.message
        });
    }
});

// Customers list for live table updates
router.get('/customers/list', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        return res.json({ success: true, customers });
    } catch (error) {
        logger.error('Error loading customers list:', error);
        return res.status(500).json({ success: false, message: 'Error loading customers list', error: error.message });
    }
});

// Customers summary for live updates
router.get('/customers/summary', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const total = customers.length;
        const paid = customers.filter(c => c.payment_status === 'paid').length;
        const unpaid = customers.filter(c => c.payment_status === 'unpaid').length;
        const noInvoice = customers.filter(c => c.payment_status === 'no_invoice').length;
        const active = customers.filter(c => c.status === 'active').length;
        const isolir = customers.filter(c => c.payment_status === 'overdue' || c.status === 'suspended').length;

        return res.json({
            success: true,
            data: { total, paid, unpaid, noInvoice, active, isolir }
        });
    } catch (error) {
        logger.error('Error loading customers summary:', error);
        return res.status(500).json({ success: false, message: 'Error loading customers summary', error: error.message });
    }
});

// Bulk delete customers
router.post('/customers/bulk-delete', async (req, res) => {
    try {
        const { phones } = req.body || {};
        if (!Array.isArray(phones) || phones.length === 0) {
            return res.status(400).json({ success: false, message: 'Daftar pelanggan (phones) kosong atau tidak valid' });
        }

        const results = [];
        let success = 0;
        let failed = 0;

        for (const phone of phones) {
            try {
                const deleted = await billingManager.deleteCustomer(String(phone));
                results.push({ phone, success: true });
                success++;
            } catch (e) {
                // Map known errors to friendly messages
                let msg = e.message || 'Gagal menghapus';
                if (msg.includes('invoice(s) still exist')) {
                    msg = 'Masih memiliki tagihan, hapus tagihan terlebih dahulu';
                } else if (msg.includes('Customer not found')) {
                    msg = 'Pelanggan tidak ditemukan';
                }
                results.push({ phone, success: false, message: msg });
                failed++;
            }
        }

        return res.json({ success: true, summary: { success, failed, total: phones.length }, results });
    } catch (error) {
        logger.error('Error bulk deleting customers:', error);
        return res.status(500).json({ success: false, message: 'Gagal melakukan hapus massal pelanggan', error: error.message });
    }
});

// Export customers to XLSX
router.get('/export/customers.xlsx', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Customers');

        // Header lengkap dengan koordinat map dan data lainnya
        const headers = [
            'ID', 'Username', 'Nama', 'Phone', 'PPPoE Username', 'Email', 'Alamat',
            'Latitude', 'Longitude', 'Package ID', 'Package Name', 'PPPoE Profile', 
            'Status', 'Auto Suspension', 'Billing Day', 'Join Date', 'Created At'
        ];
        
        // Set header dengan styling
        const headerRow = worksheet.addRow(headers);
        headerRow.font = { bold: true };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE6E6FA' }
        };

        // Set column widths
        worksheet.columns = [
            { header: 'ID', key: 'id', width: 8 },
            { header: 'Username', key: 'username', width: 15 },
            { header: 'Nama', key: 'name', width: 25 },
            { header: 'Phone', key: 'phone', width: 15 },
            { header: 'PPPoE Username', key: 'pppoe_username', width: 20 },
            { header: 'Email', key: 'email', width: 25 },
            { header: 'Alamat', key: 'address', width: 35 },
            { header: 'Latitude', key: 'latitude', width: 12 },
            { header: 'Longitude', key: 'longitude', width: 12 },
            { header: 'Package ID', key: 'package_id', width: 10 },
            { header: 'Package Name', key: 'package_name', width: 20 },
            { header: 'PPPoE Profile', key: 'pppoe_profile', width: 15 },
            { header: 'Status', key: 'status', width: 10 },
            { header: 'Auto Suspension', key: 'auto_suspension', width: 15 },
            { header: 'Billing Day', key: 'billing_day', width: 12 },
            { header: 'Join Date', key: 'join_date', width: 15 },
            { header: 'Created At', key: 'created_at', width: 15 }
        ];

        customers.forEach(c => {
            const row = worksheet.addRow([
                c.id || '',
                c.username || '',
                c.name || '',
                c.phone || '',
                c.pppoe_username || '',
                c.email || '',
                c.address || '',
                c.latitude || '',
                c.longitude || '',
                c.package_id || '',
                c.package_name || '',
                c.pppoe_profile || 'default',
                c.status || 'active',
                typeof c.auto_suspension !== 'undefined' ? c.auto_suspension : 1,
                c.billing_day || 15,
                c.join_date ? new Date(c.join_date).toLocaleDateString('id-ID') : '',
                c.created_at ? new Date(c.created_at).toLocaleDateString('id-ID') : ''
            ]);

            // Highlight rows dengan koordinat valid
            if (c.latitude && c.longitude) {
                row.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF0F8FF' }
                };
            }
        });

        // Add summary sheet
        const summarySheet = workbook.addWorksheet('Summary');
        summarySheet.addRow(['Export Summary']);
        summarySheet.addRow(['Total Customers', customers.length]);
        summarySheet.addRow(['Customers with Coordinates', customers.filter(c => c.latitude && c.longitude).length]);
        summarySheet.addRow(['Customers without Coordinates', customers.filter(c => !c.latitude || !c.longitude).length]);
        summarySheet.addRow(['Export Date', new Date().toLocaleString('id-ID')]);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="customers_complete.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        logger.error('Error exporting customers (XLSX):', error);
        res.status(500).json({ success: false, message: 'Error exporting customers (XLSX)', error: error.message });
    }
});

// Import customers from XLSX file
router.post('/import/customers/xlsx', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'File XLSX tidak ditemukan' });
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            return res.status(400).json({ success: false, message: 'Worksheet tidak ditemukan dalam file' });
        }

        // Build header map from first row with support for both formats
        const headerRow = worksheet.getRow(1);
        const headerMap = {};
        headerRow.eachCell((cell, colNumber) => {
            const key = String(cell.value || '').toLowerCase().trim();
            if (key) headerMap[key] = colNumber;
        });

        // Support for Indonesian headers (from new export format)
        const indonesianHeaderMap = {
            'nama': 'name',
            'phone': 'phone',
            'pppoe username': 'pppoe_username',
            'email': 'email',
            'alamat': 'address',
            'package id': 'package_id',
            'pppoe profile': 'pppoe_profile',
            'status': 'status',
            'auto suspension': 'auto_suspension',
            'billing day': 'billing_day'
        };

        // Create unified header map
        const unifiedHeaderMap = {};
        Object.keys(headerMap).forEach(key => {
            const normalizedKey = indonesianHeaderMap[key] || key;
            unifiedHeaderMap[normalizedKey] = headerMap[key];
        });

        const getVal = (row, key) => {
            const col = unifiedHeaderMap[key];
            return col ? (row.getCell(col).value ?? '') : '';
        };

        let created = 0, updated = 0, failed = 0;
        const errors = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // skip header
            try {
                const name = String(getVal(row, 'name') || '').trim();
                const phone = String(getVal(row, 'phone') || '').trim();
                if (!name || !phone) {
                    failed++; errors.push({ row: rowNumber, error: 'Nama/Phone wajib' }); return;
                }

                const raw = {
                    name,
                    phone,
                    pppoe_username: String(getVal(row, 'pppoe_username') || '').trim(),
                    email: String(getVal(row, 'email') || '').trim(),
                    address: String(getVal(row, 'address') || '').trim(),
                    package_id: getVal(row, 'package_id') ? Number(getVal(row, 'package_id')) : null,
                    pppoe_profile: String(getVal(row, 'pppoe_profile') || 'default').trim(),
                    status: String(getVal(row, 'status') || 'active').trim(),
                    auto_suspension: (() => {
                        const v = getVal(row, 'auto_suspension');
                        const n = parseInt(String(v), 10);
                        return Number.isFinite(n) ? n : 1;
                    })(),
                    billing_day: (() => {
                        // If the cell is empty or whitespace, default to 1
                        const rawVal = getVal(row, 'billing_day');
                        const rawStr = String(rawVal ?? '').trim();
                        if (rawStr === '') return 1;
                        const v = parseInt(rawStr, 10);
                        const n = Number.isFinite(v) ? Math.min(Math.max(v, 1), 28) : 1;
                        return n;
                    })()
                };

                // Process upsert
                // Wrap in async using IIFE pattern not available here; queue in array then Promise.all is complex.
                // For simplicity, push to pending array.
                row._pending = raw; // temp store
            } catch (e) {
                failed++;
                errors.push({ row: rowNumber, error: e.message });
            }
        });

        // Now sequentially process rows for DB ops
        for (let r = 2; r <= worksheet.rowCount; r++) {
            const row = worksheet.getRow(r);
            const raw = row._pending;
            if (!raw) continue;
            try {
                // Validasi data wajib
                if (!raw.name || !raw.phone) {
                    failed++;
                    errors.push({ row: r, error: 'Nama dan nomor telepon wajib diisi' });
                    continue;
                }

                // Validasi nomor telepon format
                const phoneRegex = /^[0-9+\-\s()]+$/;
                if (!phoneRegex.test(raw.phone)) {
                    failed++;
                    errors.push({ row: r, error: 'Format nomor telepon tidak valid' });
                    continue;
                }

                const existing = await billingManager.getCustomerByPhone(raw.phone);
                const customerData = {
                    name: raw.name.trim(),
                    phone: raw.phone.trim(),
                    pppoe_username: raw.pppoe_username ? raw.pppoe_username.trim() : '',
                    email: raw.email ? raw.email.trim() : '',
                    address: raw.address ? raw.address.trim() : '',
                    package_id: raw.package_id || null,
                    pppoe_profile: raw.pppoe_profile || 'default',
                    status: raw.status || 'active',
                    auto_suspension: typeof raw.auto_suspension !== 'undefined' ? parseInt(raw.auto_suspension) : 1,
                    billing_day: raw.billing_day ? Math.min(Math.max(parseInt(raw.billing_day), 1), 28) : 15
                };

                if (existing) {
                    await billingManager.updateCustomer(raw.phone, customerData);
                    updated++;
                    logger.info(`Updated customer: ${raw.name} (${raw.phone})`);
                } else {
                    const result = await billingManager.createCustomer(customerData);
                    created++;
                    logger.info(`Created customer: ${raw.name} (${raw.phone}) with ID: ${result.id}`);
                }
            } catch (e) {
                failed++;
                errors.push({ row: r, error: e.message });
                logger.error(`Error processing row ${r}:`, e);
            }
        }

        res.json({ success: true, summary: { created, updated, failed }, errors });
    } catch (error) {
        logger.error('Error importing customers (XLSX):', error);
        res.status(500).json({ success: false, message: 'Error importing customers (XLSX)', error: error.message });
    }
});

// Export customers to JSON
router.get('/export/customers.json', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=customers.json');
        res.json({ success: true, customers });
    } catch (error) {
        logger.error('Error exporting customers (JSON):', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting customers (JSON)',
            error: error.message
        });
    }
});

// Import customers from JSON file
router.post('/import/customers/json', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'File JSON tidak ditemukan' });
        }

        const content = req.file.buffer.toString('utf8');
        let payload;
        try {
            payload = JSON.parse(content);
        } catch (e) {
            return res.status(400).json({ success: false, message: 'Format JSON tidak valid' });
        }

        const items = Array.isArray(payload) ? payload : (payload.customers || []);
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada data pelanggan pada file' });
        }

        let created = 0, updated = 0, failed = 0;
        const errors = [];

        for (const raw of items) {
            try {
                const name = (raw.name || '').toString().trim();
                const phone = (raw.phone || '').toString().trim();
                if (!name || !phone) {
                    failed++; errors.push({ phone, error: 'Nama/Phone wajib' }); continue;
                }

                const existing = await billingManager.getCustomerByPhone(phone);
                const customerData = {
                    name,
                    phone,
                    pppoe_username: raw.pppoe_username || '',
                    email: raw.email || '',
                    address: raw.address || '',
                    package_id: raw.package_id || null,
                    pppoe_profile: raw.pppoe_profile || 'default',
                    status: raw.status || 'active',
                    auto_suspension: raw.auto_suspension !== undefined ? parseInt(raw.auto_suspension, 10) : 1,
                    billing_day: raw.billing_day ? Math.min(Math.max(parseInt(raw.billing_day), 1), 28) : 1
                };

                if (existing) {
                    await billingManager.updateCustomer(phone, customerData);
                    updated++;
                } else {
                    await billingManager.createCustomer(customerData);
                    created++;
                }
            } catch (e) {
                failed++;
                errors.push({ phone: raw && raw.phone, error: e.message });
            }
        }

        res.json({ success: true, summary: { created, updated, failed }, errors });
    } catch (error) {
        logger.error('Error importing customers (JSON):', error);
        res.status(500).json({
            success: false,
            message: 'Error importing customers (JSON)',
            error: error.message
        });
    }
});

// Auto Invoice Management
router.get('/auto-invoice', getAppSettings, async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const activeCustomers = customers.filter(c => c.status === 'active' && c.package_id);
        
        const currentDate = new Date();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        
        const thisMonthInvoices = await billingManager.getInvoices();
        const thisMonthInvoicesCount = thisMonthInvoices.filter(invoice => {
            const invoiceDate = new Date(invoice.created_at);
            return invoiceDate >= startOfMonth && invoiceDate <= endOfMonth;
        }).length;
        
        // Calculate next run date
        const nextRunDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
        
        res.render('admin/billing/auto-invoice', {
            title: 'Auto Invoice Management',
            activeCustomersCount: activeCustomers.length,
            thisMonthInvoicesCount,
            nextRunDate: nextRunDate.toLocaleDateString('id-ID'),
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading auto invoice page:', error);
        res.status(500).render('error', { 
            message: 'Error loading auto invoice page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Generate invoices manually
router.post('/auto-invoice/generate', async (req, res) => {
    try {
        const invoiceScheduler = require('../config/scheduler');
        await invoiceScheduler.triggerMonthlyInvoices();
        
        res.json({
            success: true,
            message: 'Invoice generation completed',
            count: 'auto' // Will be logged by scheduler
        });
    } catch (error) {
        logger.error('Error generating invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating invoices: ' + error.message
        });
    }
});

// Preview invoices that will be generated
router.get('/auto-invoice/preview', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const activeCustomers = customers.filter(c => c.status === 'active' && c.package_id);
        
        const currentDate = new Date();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        
        const customersNeedingInvoices = [];
        
        for (const customer of activeCustomers) {
            // Check if invoice already exists for this month
            const existingInvoices = await billingManager.getInvoicesByCustomerAndDateRange(
                customer.username,
                startOfMonth,
                endOfMonth
            );
            
            if (existingInvoices.length === 0) {
                // Get customer's package
                const package = await billingManager.getPackageById(customer.package_id);
                if (package) {
                    const dueDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 15);
                    
                    // Calculate price with PPN
                    const basePrice = package.price;
                    const taxRate = (package.tax_rate === 0 || (typeof package.tax_rate === 'number' && package.tax_rate > -1))
                        ? Number(package.tax_rate)
                        : 11.00;
                    const priceWithTax = billingManager.calculatePriceWithTax(basePrice, taxRate);
                    
                    customersNeedingInvoices.push({
                        username: customer.username,
                        name: customer.name,
                        package_name: package.name,
                        package_price: basePrice,
                        tax_rate: taxRate,
                        price_with_tax: priceWithTax,
                        due_date: dueDate.toISOString().split('T')[0]
                    });
                }
            }
        }
        
        res.json({
            success: true,
            customers: customersNeedingInvoices
        });
    } catch (error) {
        logger.error('Error previewing invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error previewing invoices: ' + error.message
        });
    }
});

// Save auto invoice settings
router.post('/auto-invoice/settings', async (req, res) => {
    try {
        const { due_date_day, auto_invoice_enabled, invoice_notes } = req.body;
        
        // Save settings to database or config file
        // For now, we'll just log the settings
        logger.info('Auto invoice settings updated:', {
            due_date_day,
            auto_invoice_enabled,
            invoice_notes
        });
        
        res.json({
            success: true,
            message: 'Settings saved successfully'
        });
    } catch (error) {
        logger.error('Error saving auto invoice settings:', error);
        res.status(500).json({
            success: false,
            message: 'Error saving settings: ' + error.message
        });
    }
});

// WhatsApp Settings Routes
router.get('/whatsapp-settings', getAppSettings, async (req, res) => {
    try {
        res.render('admin/billing/whatsapp-settings', {
            title: 'WhatsApp Notification Settings',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading WhatsApp settings page:', error);
        res.status(500).render('error', {
            message: 'Error loading WhatsApp settings page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Get WhatsApp templates
router.get('/whatsapp-settings/templates', async (req, res) => {
    try {
        const whatsappNotifications = require('../config/whatsapp-notifications');
        const templates = whatsappNotifications.getTemplates();
        
        res.json({
            success: true,
            templates: templates
        });
    } catch (error) {
        logger.error('Error getting WhatsApp templates:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting templates: ' + error.message
        });
    }
});

// Save WhatsApp templates
router.post('/whatsapp-settings/templates', async (req, res) => {
    try {
        const whatsappNotifications = require('../config/whatsapp-notifications');
        const templateData = req.body;
        
        // Update templates (more efficient for multiple updates)
        const updatedCount = whatsappNotifications.updateTemplates(templateData);
        
        res.json({
            success: true,
            message: `${updatedCount} templates saved successfully`
        });
    } catch (error) {
        logger.error('Error saving WhatsApp templates:', error);
        res.status(500).json({
            success: false,
            message: 'Error saving templates: ' + error.message
        });
    }
});

// Get WhatsApp rate limit settings
router.get('/whatsapp-settings/rate-limit', async (req, res) => {
    try {
        // Prefer nested object if exists, fallback to flattened keys
        const nested = getSetting('whatsapp_rate_limit', null);
        const settings = nested && typeof nested === 'object' ? {
            maxMessagesPerBatch: nested.maxMessagesPerBatch ?? 10,
            delayBetweenBatches: nested.delayBetweenBatches ?? 30,
            delayBetweenMessages: nested.delayBetweenMessages ?? 2,
            maxRetries: nested.maxRetries ?? 2,
            dailyMessageLimit: nested.dailyMessageLimit ?? 0,
            enabled: nested.enabled ?? true
        } : {
            maxMessagesPerBatch: getSetting('whatsapp_rate_limit.maxMessagesPerBatch', 10),
            delayBetweenBatches: getSetting('whatsapp_rate_limit.delayBetweenBatches', 30),
            delayBetweenMessages: getSetting('whatsapp_rate_limit.delayBetweenMessages', 2),
            maxRetries: getSetting('whatsapp_rate_limit.maxRetries', 2),
            dailyMessageLimit: getSetting('whatsapp_rate_limit.dailyMessageLimit', 0),
            enabled: getSetting('whatsapp_rate_limit.enabled', true)
        };
        
        res.json({
            success: true,
            settings: settings
        });
    } catch (error) {
        logger.error('Error getting WhatsApp rate limit settings:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting rate limit settings: ' + error.message
        });
    }
});

// Save WhatsApp rate limit settings
router.post('/whatsapp-settings/rate-limit', async (req, res) => {
    try {
        const { maxMessagesPerBatch, delayBetweenBatches, delayBetweenMessages, maxRetries, dailyMessageLimit, enabled } = req.body;
        
        // Validate input
        if (maxMessagesPerBatch < 1 || maxMessagesPerBatch > 100) {
            return res.status(400).json({
                success: false,
                message: 'Maksimal pesan per batch harus antara 1-100'
            });
        }
        
        if (delayBetweenBatches < 1 || delayBetweenBatches > 300) {
            return res.status(400).json({
                success: false,
                message: 'Jeda antar batch harus antara 1-300 detik'
            });
        }
        
        if (delayBetweenMessages < 0 || delayBetweenMessages > 10) {
            return res.status(400).json({
                success: false,
                message: 'Jeda antar pesan harus antara 0-10 detik'
            });
        }
        
        if (maxRetries < 0 || maxRetries > 5) {
            return res.status(400).json({
                success: false,
                message: 'Maksimal retry harus antara 0-5'
            });
        }
        
        if (dailyMessageLimit < 0 || dailyMessageLimit > 1000) {
            return res.status(400).json({
                success: false,
                message: 'Batas harian harus antara 0-1000'
            });
        }
        
        // Save settings
        const parsed = {
            maxMessagesPerBatch: parseInt(maxMessagesPerBatch),
            delayBetweenBatches: parseInt(delayBetweenBatches),
            delayBetweenMessages: parseInt(delayBetweenMessages),
            maxRetries: parseInt(maxRetries),
            dailyMessageLimit: parseInt(dailyMessageLimit),
            enabled: (enabled === true || enabled === 'true')
        };
        // Save flattened keys for backward compatibility
        setSetting('whatsapp_rate_limit.maxMessagesPerBatch', parsed.maxMessagesPerBatch);
        setSetting('whatsapp_rate_limit.delayBetweenBatches', parsed.delayBetweenBatches);
        setSetting('whatsapp_rate_limit.delayBetweenMessages', parsed.delayBetweenMessages);
        setSetting('whatsapp_rate_limit.maxRetries', parsed.maxRetries);
        setSetting('whatsapp_rate_limit.dailyMessageLimit', parsed.dailyMessageLimit);
        setSetting('whatsapp_rate_limit.enabled', parsed.enabled);
        // Also save as nested object for readability
        setSetting('whatsapp_rate_limit', parsed);
        // Ensure new reads reflect immediately
        clearSettingsCache();
        
        res.json({
            success: true,
            message: 'Pengaturan rate limiting berhasil disimpan'
        });
    } catch (error) {
        logger.error('Error saving WhatsApp rate limit settings:', error);
        res.status(500).json({
            success: false,
            message: 'Error saving rate limit settings: ' + error.message
        });
    }
});

// WhatsApp Groups Settings
router.get('/whatsapp-settings/groups', async (req, res) => {
    try {
        // Prefer nested object if exists
        const nested = getSetting('whatsapp_groups', null);
        const enabled = nested && typeof nested === 'object' ? (nested.enabled !== false) : getSetting('whatsapp_groups.enabled', true);
        // groups can be stored as array or object with numeric keys
        let ids = nested && Array.isArray(nested.ids) ? nested.ids : getSetting('whatsapp_groups.ids', []);
        if (!Array.isArray(ids)) {
            const asObj = getSetting('whatsapp_groups', {});
            ids = [];
            Object.keys(asObj).forEach(k => {
                if (k.match(/^ids\.\d+$/)) {
                    ids.push(asObj[k]);
                }
            });
        }
        res.json({ success: true, groups: { enabled, ids } });
    } catch (error) {
        logger.error('Error getting WhatsApp groups:', error);
        res.status(500).json({ success: false, message: 'Error getting WhatsApp groups: ' + error.message });
    }
});

router.post('/whatsapp-settings/groups', async (req, res) => {
    try {
        const enabled = req.body.enabled === true || req.body.enabled === 'true';
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];

        // Basic validation for WhatsApp group JIDs
        for (const id of ids) {
            if (typeof id !== 'string' || !id.endsWith('@g.us')) {
                return res.status(400).json({ success: false, message: `Invalid group id: ${id}` });
            }
        }

        // Save flattened keys
        setSetting('whatsapp_groups.enabled', enabled);
        setSetting('whatsapp_groups.ids', ids);
        // Save nested object for readability
        setSetting('whatsapp_groups', { enabled, ids });
        // Also write numeric keys for compatibility
        ids.forEach((val, idx) => setSetting(`whatsapp_groups.ids.${idx}`, val));
        // Ensure cache refresh
        clearSettingsCache();

        res.json({ success: true, message: 'WhatsApp groups updated' });
    } catch (error) {
        logger.error('Error saving WhatsApp groups:', error);
        res.status(500).json({ success: false, message: 'Error saving WhatsApp groups: ' + error.message });
    }
});

// ===== System Update (Git + PM2) =====
// Check update status: compare local HEAD with origin/<branch>
router.get('/system/check-update', async (req, res) => {
    try {
        const branch = (req.query.branch && String(req.query.branch).trim()) || getSetting('git_default_branch', 'main');
        const repoPath = getSetting('repo_path', process.cwd());
        const opts = { cwd: repoPath, windowsHide: true, shell: process.platform === 'win32' ? undefined : '/bin/bash' };

        exec('git fetch --all --prune', opts, (errFetch, outFetch, errFetchStderr) => {
            if (errFetch) {
                return res.status(500).json({ success: false, message: 'Check update failed', error: errFetchStderr || errFetch.message, log: outFetch, repoPath });
            }
            exec('git rev-parse HEAD', opts, (errHead, outHead, errHeadStderr) => {
                if (errHead) {
                    return res.status(500).json({ success: false, message: 'Check update failed', error: errHeadStderr || errHead.message, log: outHead, repoPath });
                }
                exec(`git rev-parse origin/${branch}`, opts, (errRemote, outRemote, errRemoteStderr) => {
                    if (errRemote) {
                        return res.status(500).json({ success: false, message: 'Check update failed', error: errRemoteStderr || errRemote.message, log: outRemote, repoPath });
                    }
                    exec(`git log --oneline --decorate --no-merges --max-count=10 --graph HEAD..origin/${branch}`, opts, (errLog, outLog, errLogStderr) => {
                        if (errLog) {
                            // log dapat kosong bila tidak ada update; treat as success dengan commits kosong
                            return res.json({ success: true, hasUpdate: outHead.trim() !== outRemote.trim(), branch, local: outHead.trim(), remote: outRemote.trim(), commits: '', repoPath });
                        }
                        const local = outHead.trim();
                        const remote = outRemote.trim();
                        const hasUpdate = local !== remote;
                        res.json({ success: true, hasUpdate, branch, local, remote, commits: outLog.trim(), repoPath });
                    });
                });
            });
        });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Unexpected error', error: e.message });
    }
});

// Run update: git reset to origin/<branch> + npm ci + pm2 reload
router.post('/system/update', async (req, res) => {
    try {
        const branch = (req.body && req.body.branch && String(req.body.branch).trim()) || getSetting('git_default_branch', 'main');
        const appName = getSetting('pm2_app_name', 'gembok-bill');
        const repoPath = getSetting('repo_path', process.cwd());
        const opts = { cwd: repoPath, windowsHide: true, shell: process.platform === 'win32' ? undefined : '/bin/bash' };

        const updateCmd = [
            `git fetch --all --prune`,
            `git reset --hard origin/${branch}`,
            `npm ci || npm install`
        ].join(' && ');

        exec(updateCmd, opts, (error, stdout, stderr) => {
            if (error) {
                return res.status(500).json({ success: false, message: 'Update failed', error: stderr || error.message, log: stdout, repoPath });
            }
            const pm2Target = getSetting('pm2_restart_target', appName);
            if (!pm2Target) {
                return res.json({ success: true, message: 'Update completed (PM2 restart skipped - no target)', log: stdout, repoPath });
            }
            const pm2Cmd = `pm2 restart ${pm2Target} || pm2 reload ${pm2Target}`;
            exec(pm2Cmd, opts, (pm2Err, pm2Out, pm2ErrStderr) => {
                if (pm2Err) {
                    return res.status(200).json({ success: true, message: 'Update completed, PM2 restart failed', log: stdout + '\n' + pm2Out, pm2Error: pm2ErrStderr || pm2Err.message, repoPath });
                }
                exec('pm2 save', opts, () => {
                    return res.json({ success: true, message: 'Update completed & PM2 restarted', log: stdout + '\n' + pm2Out, repoPath });
                });
            });
        });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Unexpected error', error: e.message });
    }
});

// Get WhatsApp status
router.get('/whatsapp-settings/status', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const activeCustomers = customers.filter(c => c.status === 'active' && c.phone);
        
        const invoices = await billingManager.getInvoices();
        const pendingInvoices = invoices.filter(i => i.status === 'unpaid');
        
        // Get WhatsApp status from global
        const whatsappStatus = global.whatsappStatus || { connected: false, status: 'disconnected' };
        
        res.json({
            success: true,
            whatsappStatus: whatsappStatus.connected ? 'Connected' : 'Disconnected',
            activeCustomers: activeCustomers.length,
            pendingInvoices: pendingInvoices.length,
            nextReminder: 'Daily at 09:00'
        });
    } catch (error) {
        logger.error('Error getting WhatsApp status:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting status: ' + error.message
        });
    }
});

// Test WhatsApp notification
router.post('/whatsapp-settings/test', async (req, res) => {
    try {
        const whatsappNotifications = require('../config/whatsapp-notifications');
        const { phoneNumber, templateKey } = req.body;
        
        // Test data for different templates
        const testData = {
            invoice_created: {
                customer_name: 'Test Customer',
                invoice_number: 'INV-2024-001',
                amount: '500,000',
                due_date: '15 Januari 2024',
                package_name: 'Paket Premium',
                package_speed: '50 Mbps',
                notes: 'Tagihan bulanan'
            },
            due_date_reminder: {
                customer_name: 'Test Customer',
                invoice_number: 'INV-2024-001',
                amount: '500,000',
                due_date: '15 Januari 2024',
                days_remaining: '3',
                package_name: 'Paket Premium',
                package_speed: '50 Mbps'
            },
            payment_received: {
                customer_name: 'Test Customer',
                invoice_number: 'INV-2024-001',
                amount: '500,000',
                payment_method: 'Transfer Bank',
                payment_date: '10 Januari 2024',
                reference_number: 'TRX123456'
            },
            service_disruption: {
                disruption_type: 'Gangguan Jaringan',
                affected_area: 'Seluruh Area',
                estimated_resolution: '2 jam',
                support_phone: getSetting('contact_whatsapp', '081947215703')
            },
            service_announcement: {
                announcement_content: 'Pengumuman penting untuk semua pelanggan.'
            },
            service_suspension: {
                customer_name: 'Test Customer',
                reason: 'Tagihan terlambat lebih dari 7 hari'
            },
            service_restoration: {
                customer_name: 'Test Customer',
                package_name: 'Paket Premium',
                package_speed: '50 Mbps'
            },
            welcome_message: {
                customer_name: 'Test Customer',
                package_name: 'Paket Premium',
                package_speed: '50 Mbps',
                wifi_password: 'test123456',
                support_phone: getSetting('contact_whatsapp', '081947215703')
            }
        };
        
        const result = await whatsappNotifications.testNotification(phoneNumber, templateKey, testData[templateKey]);
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Test notification sent successfully'
            });
        } else {
            res.json({
                success: false,
                message: result.error
            });
        }
    } catch (error) {
        logger.error('Error sending test notification:', error);
        res.status(500).json({
            success: false,
            message: 'Error sending test notification: ' + error.message
        });
    }
});

// Send broadcast message
router.post('/whatsapp-settings/broadcast', async (req, res) => {
    try {
        const whatsappNotifications = require('../config/whatsapp-notifications');
        const { type, message, disruptionType, affectedArea, estimatedResolution } = req.body;
        
        let result;
        
        if (type === 'service_disruption') {
            result = await whatsappNotifications.sendServiceDisruptionNotification({
                type: disruptionType || 'Gangguan Jaringan',
                area: affectedArea || 'Seluruh Area',
                estimatedTime: estimatedResolution || 'Sedang dalam penanganan'
            });
        } else if (type === 'service_announcement') {
            result = await whatsappNotifications.sendServiceAnnouncement({
                content: message
            });
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid broadcast type'
            });
        }
        
        if (result.success) {
            res.json({
                success: true,
                sent: result.sent,
                failed: result.failed,
                total: result.total,
                customer_sent: result.customer_sent || 0,
                customer_failed: result.customer_failed || 0,
                group_sent: result.group_sent || 0,
                group_failed: result.group_failed || 0,
                message: `Broadcast sent successfully. Customer: ${result.customer_sent || 0} ok / ${result.customer_failed || 0} fail, Group: ${result.group_sent || 0} ok / ${result.group_failed || 0} fail`
            });
        } else {
            res.json({
                success: false,
                message: result.error
            });
        }
    } catch (error) {
        logger.error('Error sending broadcast:', error);
        res.status(500).json({
            success: false,
            message: 'Error sending broadcast: ' + error.message
        });
    }
});

// Paket Management
router.get('/packages', getAppSettings, async (req, res) => {
    try {
        const packages = await billingManager.getPackages();
        res.render('admin/billing/packages', {
            title: 'Kelola Paket',
            packages,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading packages:', error);
        res.status(500).render('error', { 
            message: 'Error loading packages',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

router.post('/packages', uploadPackageImage.single('package_image'), async (req, res) => {
    try {
        const { name, speed, price, tax_rate, description, pppoe_profile } = req.body;
        const packageData = {
            name: name.trim(),
            speed: speed.trim(),
            price: parseFloat(price),
            tax_rate: parseFloat(tax_rate) >= 0 ? parseFloat(tax_rate) : 0,
            description: description.trim(),
            pppoe_profile: pppoe_profile ? pppoe_profile.trim() : 'default'
        };

        // Add image filename if uploaded
        if (req.file) {
            packageData.image_filename = req.file.filename;
        }

        if (!packageData.name || !packageData.speed || !packageData.price) {
            return res.status(400).json({
                success: false,
                message: 'Nama, kecepatan, dan harga harus diisi'
            });
        }

        const newPackage = await billingManager.createPackage(packageData);
        logger.info(`Package created: ${newPackage.name} with tax_rate: ${newPackage.tax_rate}`);
        
        res.json({
            success: true,
            message: 'Paket berhasil ditambahkan',
            package: newPackage
        });
    } catch (error) {
        logger.error('Error creating package:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating package',
            error: error.message
        });
    }
});

router.put('/packages/:id', uploadPackageImage.single('package_image'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, speed, price, tax_rate, description, pppoe_profile } = req.body;
        const packageData = {
            name: name.trim(),
            speed: speed.trim(),
            price: parseFloat(price),
            tax_rate: parseFloat(tax_rate) >= 0 ? parseFloat(tax_rate) : 0,
            description: description.trim(),
            pppoe_profile: pppoe_profile ? pppoe_profile.trim() : 'default'
        };

        // Add image filename if uploaded
        if (req.file) {
            packageData.image_filename = req.file.filename;
        }

        if (!packageData.name || !packageData.speed || !packageData.price) {
            return res.status(400).json({
                success: false,
                message: 'Nama, kecepatan, dan harga harus diisi'
            });
        }

        const updatedPackage = await billingManager.updatePackage(id, packageData);
        logger.info(`Package updated: ${updatedPackage.name} with tax_rate: ${updatedPackage.tax_rate}`);
        
        res.json({
            success: true,
            message: 'Paket berhasil diupdate',
            package: updatedPackage
        });
    } catch (error) {
        logger.error('Error updating package:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating package',
            error: error.message
        });
    }
});

router.delete('/packages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await billingManager.deletePackage(id);
        logger.info(`Package deleted: ${id}`);
        res.json({
            success: true,
            message: 'Paket berhasil dihapus'
        });
    } catch (error) {
        logger.error('Error deleting package:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting package',
            error: error.message
        });
    }
});

// Get package detail (HTML view)
router.get('/packages/:id', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const package = await billingManager.getPackageById(parseInt(id));
        
        if (!package) {
            return res.status(404).render('error', {
                message: 'Paket tidak ditemukan',
                error: 'Package not found',
                appSettings: req.appSettings
            });
        }

        const customers = await billingManager.getCustomersByPackage(parseInt(id));
        
        res.render('admin/billing/package-detail', {
            title: 'Detail Paket',
            package,
            customers,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading package detail:', error);
        res.status(500).render('error', {
            message: 'Error loading package detail',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Get package data for editing (JSON API)
router.get('/api/packages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const package = await billingManager.getPackageById(parseInt(id));
        
        if (!package) {
            return res.status(404).json({
                success: false,
                message: 'Paket tidak ditemukan'
            });
        }
        
        res.json({
            success: true,
            package: package
        });
    } catch (error) {
        logger.error('Error getting package data:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting package data',
            error: error.message
        });
    }
});

router.delete('/packages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await billingManager.deletePackage(id);
        logger.info(`Package deleted: ${id}`);
        
        res.json({
            success: true,
            message: 'Paket berhasil dihapus'
        });
    } catch (error) {
        logger.error('Error deleting package:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting package',
            error: error.message
        });
    }
});

// Customer Management
router.get('/customers', getAppSettings, async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const packages = await billingManager.getPackages();
        
        // Get ODPs for dropdown selection (termasuk sub ODP)
        const odps = await new Promise((resolve, reject) => {
            const db = require('../config/billing').db;
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
        
        res.render('admin/billing/customers', {
            title: 'Kelola Pelanggan',
            customers,
            packages,
            odps,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading customers:', error);
        res.status(500).render('error', { 
            message: 'Error loading customers',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

router.post('/customers', async (req, res) => {
    try {
        const { name, username, phone, pppoe_username, email, address, package_id, odp_id, pppoe_profile, auto_suspension, billing_day, create_pppoe_user, pppoe_password, static_ip, assigned_ip, mac_address, latitude, longitude, cable_type, cable_length, port_number, cable_status, cable_notes } = req.body;
        
        // Validate required fields
        if (!name || !username || !phone || !package_id) {
            return res.status(400).json({
                success: false,
                message: 'Nama, username, telepon, dan paket harus diisi'
            });
        }
        
        // Validate username format
        if (!/^[a-z0-9_]+$/.test(username)) {
            return res.status(400).json({
                success: false,
                message: 'Username hanya boleh berisi huruf kecil, angka, dan underscore'
            });
        }

        // Get package to get default profile if not specified
        let profileToUse = pppoe_profile;
        if (!profileToUse) {
            const packageData = await billingManager.getPackageById(package_id);
            profileToUse = packageData?.pppoe_profile || 'default';
        }

        const customerData = {
            name,
            username,
            phone,
            pppoe_username,
            email,
            address,
            package_id,
            odp_id: odp_id || null,
            pppoe_profile: profileToUse,
            status: 'active',
            auto_suspension: auto_suspension !== undefined ? parseInt(auto_suspension) : 1,
            billing_day: (() => {
                const v = parseInt(billing_day, 10);
                if (Number.isFinite(v)) return Math.min(Math.max(v, 1), 28);
                return 15;
            })(),
            static_ip: static_ip || null,
            assigned_ip: assigned_ip || null,
            mac_address: mac_address || null,
            latitude: latitude !== undefined && latitude !== '' ? parseFloat(latitude) : undefined,
            longitude: longitude !== undefined && longitude !== '' ? parseFloat(longitude) : undefined,
            // Cable connection data
            cable_type: cable_type || null,
            cable_length: cable_length ? parseInt(cable_length) : null,
            port_number: port_number ? parseInt(port_number) : null,
            cable_status: cable_status || 'connected',
            cable_notes: cable_notes || null
        };

        const result = await billingManager.createCustomer(customerData);

        // Optional: create PPPoE user in Mikrotik
        let pppoeCreate = { attempted: false, created: false, message: '' };
        try {
            const shouldCreate = create_pppoe_user === 1 || create_pppoe_user === '1' || create_pppoe_user === true || create_pppoe_user === 'true';
            if (shouldCreate && pppoe_username) {
                pppoeCreate.attempted = true;
                // determine profile (already computed as profileToUse)
                const passwordToUse = (pppoe_password && String(pppoe_password).trim())
                    ? String(pppoe_password).trim()
                    : (Math.random().toString(36).slice(-8) + Math.floor(Math.random()*10));

                const { addPPPoEUser } = require('../config/mikrotik');
                const addRes = await addPPPoEUser({ username: pppoe_username, password: passwordToUse, profile: profileToUse });
                if (addRes && addRes.success) {
                    pppoeCreate.created = true;
                    pppoeCreate.message = 'User PPPoE berhasil dibuat di Mikrotik';
                } else {
                    pppoeCreate.created = false;
                    pppoeCreate.message = (addRes && addRes.message) ? addRes.message : 'Gagal membuat user PPPoE';
                }
            }
        } catch (e) {
            logger.warn('Gagal membuat user PPPoE di Mikrotik (opsional): ' + e.message);
            pppoeCreate.created = false;
            pppoeCreate.message = e.message;
        }

        res.json({
            success: true,
            message: 'Pelanggan berhasil ditambahkan',
            customer: result,
            pppoeCreate
        });
    } catch (error) {
        logger.error('Error creating customer:', error);
        
        // Handle specific error messages
        let errorMessage = 'Gagal menambahkan pelanggan';
        let statusCode = 500;
        
        if (error.message.includes('UNIQUE constraint failed')) {
            if (error.message.includes('phone')) {
                errorMessage = 'Nomor telepon sudah terdaftar. Silakan gunakan nomor telepon yang berbeda.';
            } else if (error.message.includes('username')) {
                errorMessage = 'Username sudah digunakan. Silakan coba lagi.';
            } else {
                errorMessage = 'Data sudah ada dalam sistem. Silakan cek kembali.';
            }
            statusCode = 400;
        } else if (error.message.includes('FOREIGN KEY constraint failed')) {
            errorMessage = 'Paket yang dipilih tidak valid. Silakan pilih paket yang tersedia.';
            statusCode = 400;
        } else if (error.message.includes('not null constraint')) {
            errorMessage = 'Data wajib tidak boleh kosong. Silakan lengkapi semua field yang diperlukan.';
            statusCode = 400;
        }
        
        res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error: error.message
        });
    }
});

// Get customer detail
router.get('/customers/:phone', getAppSettings, async (req, res) => {
    try {
        const { phone } = req.params;
        logger.info(`Loading customer detail for phone: ${phone}`);
        
        const customer = await billingManager.getCustomerByPhone(phone);
        logger.info(`Customer found:`, customer);
        
        if (!customer) {
            logger.warn(`Customer not found for phone: ${phone}`);
            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                error: 'Customer not found',
                appSettings: req.appSettings
            });
        }

        const invoices = await billingManager.getInvoicesByCustomer(customer.id);
        const packages = await billingManager.getPackages();
        // Load trouble report history for this customer (by phone)
        let troubleReports = [];
        try {
            const { getTroubleReportsByPhone } = require('../config/troubleReport');
            troubleReports = getTroubleReportsByPhone(customer.phone || phone) || [];
        } catch (e) {
            logger.warn('Unable to load trouble reports for customer:', e.message);
        }
        
        logger.info(`Rendering customer detail page for: ${phone}`);
        
        // Try to render with minimal data first
        try {
            res.render('admin/billing/customer-detail', {
                title: 'Detail Pelanggan',
                customer,
                invoices: invoices || [],
                packages: packages || [],
                troubleReports,
                appSettings: req.appSettings
            });
        } catch (renderError) {
            logger.error('Error rendering customer detail page:', renderError);
            res.status(500).render('error', {
                message: 'Error rendering customer detail page',
                error: renderError.message,
                appSettings: req.appSettings
            });
        }
    } catch (error) {
        logger.error('Error loading customer detail:', error);
        res.status(500).render('error', {
            message: 'Error loading customer detail',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// API route for getting customer data (for editing)
router.get('/api/customers/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        logger.info(`API: Loading customer data for editing phone: ${phone}`);
        
        const customer = await billingManager.getCustomerByPhone(phone);
        
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        return res.json({
            success: true,
            customer: customer,
            message: 'Customer data loaded successfully'
        });
    } catch (error) {
        logger.error('API: Error loading customer data:', error);
        return res.status(500).json({
            success: false,
            message: 'Error loading customer data',
            error: error.message
        });
    }
});

// Debug route for customer detail
router.get('/customers/:username/debug', getAppSettings, async (req, res) => {
    try {
        const { username } = req.params;
        logger.info(`Debug: Loading customer detail for username: ${username}`);
        
        const customer = await billingManager.getCustomerByUsername(username);
        logger.info(`Debug: Customer found:`, customer);
        
        if (!customer) {
            return res.json({
                success: false,
                message: 'Customer not found',
                username: username
            });
        }

        const invoices = await billingManager.getInvoicesByCustomer(customer.id);
        const packages = await billingManager.getPackages();
        
        return res.json({
            success: true,
            customer: customer,
            invoices: invoices,
            packages: packages,
            message: 'Debug data loaded successfully'
        });
    } catch (error) {
        logger.error('Debug: Error loading customer detail:', error);
        return res.json({
            success: false,
            message: 'Error loading customer detail',
            error: error.message
        });
    }
});

// Test route with simple template (no auth for debugging)
router.get('/customers/:username/test', async (req, res) => {
    try {
        const { username } = req.params;
        logger.info(`Test: Loading customer detail for username: ${username}`);
        
        const customer = await billingManager.getCustomerByUsername(username);
        logger.info(`Test: Customer found:`, customer);
        
        if (!customer) {
            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                error: 'Customer not found',
                appSettings: {}
            });
        }

        const invoices = await billingManager.getInvoicesByCustomer(customer.id);
        const packages = await billingManager.getPackages();
        
        logger.info(`Test: Rendering simple template for: ${username}`);
        res.render('admin/billing/customer-detail-test', {
            title: 'Detail Pelanggan - Test',
            customer,
            invoices: invoices || [],
            packages: packages || [],
            appSettings: {}
        });
    } catch (error) {
        logger.error('Test: Error loading customer detail:', error);
        res.status(500).render('error', {
            message: 'Error loading customer detail',
            error: error.message,
            appSettings: {}
        });
    }
});

router.put('/customers/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const { name, username, pppoe_username, email, address, package_id, odp_id, pppoe_profile, status, auto_suspension, billing_day, latitude, longitude, static_ip, assigned_ip, mac_address, cable_type, cable_length, port_number, cable_status, cable_notes } = req.body;
        
        
        // Validate required fields
        if (!name || !username || !package_id) {
            return res.status(400).json({
                success: false,
                message: 'Nama, username, dan paket harus diisi'
            });
        }
        
        // Validate username format
        if (!/^[a-z0-9_]+$/.test(username)) {
            return res.status(400).json({
                success: false,
                message: 'Username hanya boleh berisi huruf kecil, angka, dan underscore'
            });
        }
        
        // Get current customer data
        const currentCustomer = await billingManager.getCustomerByPhone(phone);
        if (!currentCustomer) {
            return res.status(404).json({
                success: false,
                message: 'Pelanggan tidak ditemukan'
            });
        }

        // Get package to get default profile if not specified
        let profileToUse = pppoe_profile;
        if (!profileToUse && package_id) {
            const packageData = await billingManager.getPackageById(package_id);
            profileToUse = packageData?.pppoe_profile || 'default';
        } else if (!profileToUse) {
            profileToUse = currentCustomer.pppoe_profile || 'default';
        }

        // Extract new phone from request body, fallback to current if not provided
        const newPhone = req.body.phone || currentCustomer.phone;
        
        const customerData = {
            name: name,
            username: username,
            phone: newPhone,
            pppoe_username: pppoe_username || currentCustomer.pppoe_username,
            email: email || currentCustomer.email,
            address: address || currentCustomer.address,
            package_id: package_id,
            odp_id: odp_id !== undefined ? odp_id : currentCustomer.odp_id,
            pppoe_profile: profileToUse,
            status: status || currentCustomer.status,
            auto_suspension: auto_suspension !== undefined ? parseInt(auto_suspension) : currentCustomer.auto_suspension,
            billing_day: (function(){
                const v = parseInt(billing_day, 10);
                if (Number.isFinite(v)) return Math.min(Math.max(v, 1), 28);
                return currentCustomer.billing_day ?? 1;
            })(),
            latitude: latitude !== undefined ? parseFloat(latitude) : currentCustomer.latitude,
            longitude: longitude !== undefined ? parseFloat(longitude) : currentCustomer.longitude,
            static_ip: static_ip !== undefined ? static_ip : currentCustomer.static_ip,
            assigned_ip: assigned_ip !== undefined ? assigned_ip : currentCustomer.assigned_ip,
            mac_address: mac_address !== undefined ? mac_address : currentCustomer.mac_address,
            // Cable connection data
            cable_type: cable_type !== undefined ? cable_type : currentCustomer.cable_type,
            cable_length: cable_length !== undefined ? parseInt(cable_length) : currentCustomer.cable_length,
            port_number: port_number !== undefined ? parseInt(port_number) : currentCustomer.port_number,
            cable_status: cable_status !== undefined ? cable_status : currentCustomer.cable_status,
            cable_notes: cable_notes !== undefined ? cable_notes : currentCustomer.cable_notes
        };

        // Use current phone for lookup, allow phone to be updated in customerData
        const result = await billingManager.updateCustomerByPhone(phone, customerData);

        // Jika update berhasil dan customer memiliki PPPoE, update profil di Mikrotik
        if (result && customerData.pppoe_username) {
            try {
                // Cek apakah paket benar-benar berubah
                const updatedCustomer = await billingManager.getCustomerByPhone(customerData.phone || phone);
                if (updatedCustomer && updatedCustomer.package_id !== currentCustomer.package_id) {
                    logger.info(`[BILLING] Package changed for ${updatedCustomer.username}, updating Mikrotik PPPoE profile...`);
                    await serviceSuspension.restoreCustomerService(updatedCustomer, 'Package changed');
                    logger.info(`[BILLING] Mikrotik PPPoE profile updated successfully for ${updatedCustomer.username}`);
                }
            } catch (mikrotikError) {
                logger.error(`[BILLING] Failed to update Mikrotik profile for ${customerData.username}:`, mikrotikError.message);
                // Jangan gagal kan update customer jika Mikrotik error
            }
        }

        res.json({
            success: true,
            message: 'Pelanggan berhasil diupdate',
            customer: result
        });
    } catch (error) {
        logger.error('Error updating customer:', error);
        
        // Handle specific error messages
        let errorMessage = 'Gagal mengupdate pelanggan';
        let statusCode = 500;
        
        if (error.message.includes('Pelanggan tidak ditemukan')) {
            errorMessage = 'Pelanggan tidak ditemukan';
            statusCode = 404;
        } else if (error.message.includes('UNIQUE constraint failed')) {
            if (error.message.includes('phone')) {
                errorMessage = 'Nomor telepon sudah terdaftar. Silakan gunakan nomor telepon yang berbeda.';
            } else if (error.message.includes('username')) {
                errorMessage = 'Username sudah digunakan. Silakan coba lagi.';
            } else {
                errorMessage = 'Data sudah ada dalam sistem. Silakan cek kembali.';
            }
            statusCode = 400;
        } else if (error.message.includes('FOREIGN KEY constraint failed')) {
            errorMessage = 'Paket yang dipilih tidak valid. Silakan pilih paket yang tersedia.';
            statusCode = 400;
        } else if (error.message.includes('not null constraint')) {
            errorMessage = 'Data wajib tidak boleh kosong. Silakan lengkapi semua field yang diperlukan.';
            statusCode = 400;
        }
        
        res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error: error.message
        });
    }
});

// Delete customer
router.delete('/customers/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        
        const deletedCustomer = await billingManager.deleteCustomer(phone);
        logger.info(`Customer deleted: ${phone}`);
        
        res.json({
            success: true,
            message: 'Pelanggan berhasil dihapus',
            customer: deletedCustomer
        });
    } catch (error) {
        logger.error('Error deleting customer:', error);
        
        // Handle specific error messages
        let errorMessage = 'Gagal menghapus pelanggan';
        let statusCode = 500;
        
        if (error.message.includes('Customer not found')) {
            errorMessage = 'Pelanggan tidak ditemukan';
            statusCode = 404;
        } else if (error.message.includes('invoice(s) still exist')) {
            errorMessage = 'Tidak dapat menghapus pelanggan karena masih memiliki tagihan. Silakan hapus semua tagihan terlebih dahulu.';
            statusCode = 400;
        } else if (error.message.includes('foreign key constraint')) {
            errorMessage = 'Tidak dapat menghapus pelanggan karena masih memiliki data terkait. Silakan hapus data terkait terlebih dahulu.';
            statusCode = 400;
        }
        
        res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error: error.message
        });
    }
});

// Invoice Management
router.get('/invoices', getAppSettings, async (req, res) => {
    try {
        const invoices = await billingManager.getInvoices();
        const customers = await billingManager.getCustomers();
        const packages = await billingManager.getPackages();
        
        res.render('admin/billing/invoices', {
            title: 'Kelola Tagihan',
            invoices,
            customers,
            packages,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoices:', error);
        res.status(500).render('error', { 
            message: 'Error loading invoices',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

router.post('/invoices', async (req, res) => {
    try {
        const { customer_id, package_id, amount, due_date, notes, base_amount, tax_rate } = req.body;
        const safeNotes = (notes || '').toString().trim();
        const invoiceData = {
            customer_id: parseInt(customer_id),
            package_id: parseInt(package_id),
            amount: parseFloat(amount),
            due_date: due_date,
            notes: safeNotes
        };
        
        // Add PPN data if available
        if (base_amount !== undefined && tax_rate !== undefined) {
            invoiceData.base_amount = parseFloat(base_amount);
            invoiceData.tax_rate = parseFloat(tax_rate);
        }

        if (!invoiceData.customer_id || !invoiceData.package_id || !invoiceData.amount || !invoiceData.due_date) {
            return res.status(400).json({
                success: false,
                message: 'Semua field harus diisi'
            });
        }

        const newInvoice = await billingManager.createInvoice(invoiceData);
        logger.info(`Invoice created: ${newInvoice.invoice_number}`);
        
        // Send WhatsApp notification
        try {
            const whatsappNotifications = require('../config/whatsapp-notifications');
            await whatsappNotifications.sendInvoiceCreatedNotification(invoiceData.customer_id, newInvoice.id);
        } catch (notificationError) {
            logger.error('Error sending invoice notification:', notificationError);
            // Don't fail the invoice creation if notification fails
        }
        
        res.json({
            success: true,
            message: 'Tagihan berhasil dibuat',
            invoice: newInvoice
        });
    } catch (error) {
        logger.error('Error creating invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating invoice',
            error: error.message
        });
    }
});

router.put('/invoices/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, payment_method } = req.body;

        const updatedInvoice = await billingManager.updateInvoiceStatus(id, status, payment_method);
        logger.info(`Invoice status updated: ${id} to ${status}`);
        
        res.json({
            success: true,
            message: 'Status tagihan berhasil diupdate',
            invoice: updatedInvoice
        });
    } catch (error) {
        logger.error('Error updating invoice status:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating invoice status',
            error: error.message
        });
    }
});

// View individual invoice
router.get('/invoices/:id', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        
        if (!invoice) {
            return res.status(404).render('error', {
                message: 'Invoice tidak ditemukan',
                error: 'Invoice with ID ' + id + ' not found',
                appSettings: req.appSettings
            });
        }
        
        res.render('admin/billing/invoice-detail', {
            title: 'Detail Invoice',
            invoice,
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

// Print invoice
router.get('/invoices/:id/print', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        
        if (!invoice) {
            return res.status(404).render('error', {
                message: 'Invoice tidak ditemukan',
                error: 'Invoice with ID ' + id + ' not found',
                appSettings: req.appSettings
            });
        }
        
        res.render('admin/billing/invoice-print', {
            title: 'Cetak Invoice',
            invoice,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoice print:', error);
        res.status(500).render('error', {
            message: 'Error loading invoice print',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Edit invoice
router.get('/invoices/:id/edit', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        const customers = await billingManager.getCustomers();
        const packages = await billingManager.getPackages();
        
        if (!invoice) {
            return res.status(404).render('error', {
                message: 'Invoice tidak ditemukan',
                error: 'Invoice with ID ' + id + ' not found',
                appSettings: req.appSettings
            });
        }
        
        res.render('admin/billing/invoice-edit', {
            title: 'Edit Invoice',
            invoice,
            customers,
            packages,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoice edit:', error);
        res.status(500).render('error', {
            message: 'Error loading invoice edit',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Update invoice
router.put('/invoices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { customer_id, package_id, amount, due_date, notes } = req.body;
        
        const updateData = {
            customer_id: parseInt(customer_id),
            package_id: parseInt(package_id),
            amount: parseFloat(amount),
            due_date: due_date,
            notes: notes ? notes.trim() : ''
        };

        if (!updateData.customer_id || !updateData.package_id || !updateData.amount || !updateData.due_date) {
            return res.status(400).json({
                success: false,
                message: 'Semua field harus diisi'
            });
        }

        const updatedInvoice = await billingManager.updateInvoice(id, updateData);
        logger.info(`Invoice updated: ${updatedInvoice.invoice_number}`);
        
        res.json({
            success: true,
            message: 'Invoice berhasil diperbarui',
            invoice: updatedInvoice
        });
    } catch (error) {
        logger.error('Error updating invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating invoice',
            error: error.message
        });
    }
});

// Delete invoice
router.delete('/invoices/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const deletedInvoice = await billingManager.deleteInvoice(id);
        logger.info(`Invoice deleted: ${deletedInvoice.invoice_number}`);
        
        res.json({
            success: true,
            message: 'Invoice berhasil dihapus',
            invoice: deletedInvoice
        });
    } catch (error) {
        logger.error('Error deleting invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting invoice',
            error: error.message
        });
    }
});

// Bulk delete invoices
router.post('/invoices/bulk-delete', adminAuth, async (req, res) => {
    try {
        const { ids } = req.body || {};
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'Daftar ID tagihan kosong atau tidak valid' });
        }

        const results = [];
        let success = 0;
        let failed = 0;

        for (const rawId of ids) {
            try {
                const id = parseInt(rawId, 10);
                if (!Number.isFinite(id)) throw new Error('ID tidak valid');
                const deletedInvoice = await billingManager.deleteInvoice(id);
                results.push({ id, success: true, invoice_number: deletedInvoice?.invoice_number });
                success++;
            } catch (e) {
                results.push({ id: rawId, success: false, message: e.message });
                failed++;
            }
        }

        return res.json({ success: true, summary: { success, failed, total: ids.length }, results });
    } catch (error) {
        logger.error('Error bulk deleting invoices:', error);
        return res.status(500).json({ success: false, message: 'Gagal melakukan hapus massal tagihan', error: error.message });
    }
});

// Payment Management - Collector Transactions Only
router.get('/payments', getAppSettings, async (req, res) => {
    try {
        const payments = await billingManager.getCollectorPayments();
        
        res.render('admin/billing/payments', {
            title: 'Transaksi Kolektor',
            payments,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading payments:', error);
        res.status(500).render('error', { 
            message: 'Error loading payments',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// All Payments - Admin and Collector
router.get('/all-payments', getAppSettings, async (req, res) => {
    try {
        const payments = await billingManager.getPayments();
        
        res.render('admin/billing/payments', {
            title: 'Riwayat Pembayaran',
            payments,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading all payments:', error);
        res.status(500).render('error', { 
            message: 'Error loading all payments',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

router.post('/payments', async (req, res) => {
    try {
        const { invoice_id, amount, payment_method, reference_number, notes } = req.body;
        
        // Validate required fields first
        if (!invoice_id || !amount || !payment_method) {
            return res.status(400).json({
                success: false,
                message: 'Invoice ID, jumlah, dan metode pembayaran harus diisi'
            });
        }
        
        const paymentData = {
            invoice_id: parseInt(invoice_id),
            amount: parseFloat(amount),
            payment_method: payment_method.trim(),
            reference_number: reference_number ? reference_number.trim() : '',
            notes: notes ? notes.trim() : ''
        };

        const newPayment = await billingManager.recordPayment(paymentData);
        
        // Update invoice status to paid
        await billingManager.updateInvoiceStatus(paymentData.invoice_id, 'paid', paymentData.payment_method);
        
        logger.info(`Payment recorded: ${newPayment.id}`);
        
        // Send WhatsApp notification
        try {
            const whatsappNotifications = require('../config/whatsapp-notifications');
            await whatsappNotifications.sendPaymentReceivedNotification(newPayment.id);
        } catch (notificationError) {
            logger.error('Error sending payment notification:', notificationError);
            // Don't fail the payment recording if notification fails
        }
        
        // Attempt immediate restore if eligible
        try {
            const paidInvoice = await billingManager.getInvoiceById(paymentData.invoice_id);
            if (paidInvoice && paidInvoice.customer_id) {
                const customer = await billingManager.getCustomerById(paidInvoice.customer_id);
                if (customer && customer.status === 'suspended') {
                    const invoices = await billingManager.getInvoicesByCustomer(customer.id);
                    const unpaid = invoices.filter(i => i.status === 'unpaid');
                    if (unpaid.length === 0) {
                        await serviceSuspension.restoreCustomerService(customer);
                    }
                }
            }
        } catch (restoreErr) {
            logger.error('Immediate restore check failed:', restoreErr);
        }
        
        res.json({
            success: true,
            message: 'Pembayaran berhasil dicatat',
            payment: newPayment
        });
    } catch (error) {
        logger.error('Error recording payment:', error);
        res.status(500).json({
            success: false,
            message: 'Error recording payment',
            error: error.message
        });
    }
});

// Export customers to CSV
router.get('/export/customers', getAppSettings, async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        
        // Create CSV content
        let csvContent = 'ID,Username,Nama,Phone,Email,Address,Package,Status,Payment Status,Created At\n';
        
        customers.forEach(customer => {
            const row = [
                customer.id,
                customer.username,
                customer.name,
                customer.phone,
                customer.email || '',
                customer.address || '',
                customer.package_name || '',
                customer.status,
                customer.payment_status,
                new Date(customer.created_at).toLocaleDateString('id-ID')
            ].map(field => `"${field}"`).join(',');
            
            csvContent += row + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=customers.csv');
        res.send(csvContent);
        
    } catch (error) {
        logger.error('Error exporting customers:', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting customers',
            error: error.message
        });
    }
});

// Export invoices to CSV
router.get('/export/invoices', getAppSettings, async (req, res) => {
    try {
        const invoices = await billingManager.getInvoices();
        
        // Create CSV content
        let csvContent = 'ID,Invoice Number,Customer,Amount,Status,Due Date,Created At\n';
        
        invoices.forEach(invoice => {
            const row = [
                invoice.id,
                invoice.invoice_number,
                invoice.customer_name,
                invoice.amount,
                invoice.status,
                new Date(invoice.due_date).toLocaleDateString('id-ID'),
                new Date(invoice.created_at).toLocaleDateString('id-ID')
            ].map(field => `"${field}"`).join(',');
            
            csvContent += row + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=invoices.csv');
        res.send(csvContent);
        
    } catch (error) {
        logger.error('Error exporting invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting invoices',
            error: error.message
        });
    }
});

// Export payments to CSV
router.get('/export/payments', getAppSettings, async (req, res) => {
    try {
        const payments = await billingManager.getPayments();
        
        // Create CSV content
        let csvContent = 'ID,Invoice Number,Customer,Amount,Payment Method,Payment Date,Reference,Notes\n';
        
        payments.forEach(payment => {
            const row = [
                payment.id,
                payment.invoice_number,
                payment.customer_name,
                payment.amount,
                payment.payment_method,
                new Date(payment.payment_date).toLocaleDateString('id-ID'),
                payment.reference_number || '',
                payment.notes || ''
            ].map(field => `"${field}"`).join(',');
            
            csvContent += row + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=payments.csv');
        res.send(csvContent);
        
    } catch (error) {
        logger.error('Error exporting payments:', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting payments',
            error: error.message
        });
    }
});

// API Routes untuk AJAX
// Get package profiles for customer form
router.get('/api/packages', async (req, res) => {
    try {
        const packages = await billingManager.getPackages();
        res.json({
            success: true,
            packages: packages
        });
    } catch (error) {
        logger.error('Error getting packages API:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});



// API endpoint untuk ODPs
router.get('/api/odps', adminAuth, async (req, res) => {
    try {
        const db = require('../config/billing').db;
        const odps = await new Promise((resolve, reject) => {
            db.all(`
                SELECT o.id, o.name, o.code, o.capacity, o.used_ports, o.status, o.parent_odp_id,
                       o.latitude, o.longitude, o.address, o.notes,
                       p.name as parent_name
                FROM odps o
                LEFT JOIN odps p ON o.parent_odp_id = p.id
                ORDER BY o.name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        res.json({
            success: true,
            odps: odps
        });
    } catch (error) {
        logger.error('Error getting ODPs for mobile mapping:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading ODPs data'
        });
    }
});

// Helper function untuk mendapatkan parameter value dari device
function getParameterValue(device, parameterName) {
    if (!device || !parameterName) return null;
    
    // Coba akses langsung
    if (device[parameterName] !== undefined) {
        return device[parameterName];
    }
    
    // Coba dengan path array
    const pathParts = parameterName.split('.');
    let current = device;
    
    for (const part of pathParts) {
        if (current && typeof current === 'object' && current[part] !== undefined) {
            current = current[part];
        } else {
            return null;
        }
    }
    
    // Jika current adalah object dengan _value property, return _value
    if (current && typeof current === 'object' && current._value !== undefined) {
        return current._value;
    }
    
    // Jika current adalah string/number, return langsung
    if (typeof current === 'string' || typeof current === 'number') {
        return current;
    }
    
    return current;
}

// API endpoint untuk mendapatkan PPPoE users dari Mikrotik
router.get('/api/pppoe-users', async (req, res) => {
    try {
        const { getPPPoEUsers } = require('../config/mikrotik');
        const pppoeUsers = await getPPPoEUsers();
        
        res.json({
            success: true,
            data: pppoeUsers.map(user => ({
                username: user.name,
                profile: user.profile,
                active: user.active || false
            }))
        });
    } catch (error) {
        console.error('Error fetching PPPoE users:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data PPPoE users',
            error: error.message
        });
    }
});

// API endpoint untuk devices
router.get('/api/devices', async (req, res) => {
    try {
        console.log('🔍 Loading devices from GenieACS...');
        const { getDevicesCached } = require('../config/genieacs');
        let devices = [];
        
        try {
            devices = await getDevicesCached();
            console.log(`📊 Found ${devices.length} devices from GenieACS`);
        } catch (genieacsError) {
            console.log('⚠️ GenieACS not available, creating fallback data...');
            // Create fallback data from customers
            const db = require('../config/billing').db;
            const customers = await new Promise((resolve, reject) => {
                db.all(`
                    SELECT id, name, phone, pppoe_username, latitude, longitude 
                    FROM customers 
                    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
                    LIMIT 10
                `, [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });
            
            devices = customers.map((customer, index) => ({
                _id: `fallback_${customer.id}`,
                'Device.DeviceInfo.SerialNumber': `SIM${customer.id.toString().padStart(4, '0')}`,
                'Device.DeviceInfo.ModelName': 'Simulated ONU',
                'InternetGatewayDevice.DeviceInfo.UpTime': index % 2 === 0 ? '7 days' : null,
                'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID': `SSID_${customer.id}`,
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username': customer.pppoe_username,
                _lastInform: new Date().toISOString()
            }));
            
            console.log(`📊 Created ${devices.length} fallback devices from customers`);
        }
        
        // Process devices with customer information
        const processedDevices = [];
        
        for (const device of devices) {
            // Debug: log first device structure
            if (processedDevices.length === 0) {
                console.log('🔍 Sample device structure:', Object.keys(device));
                console.log('🔍 Sample device data:', JSON.stringify(device, null, 2).substring(0, 500) + '...');
                
                // Test parameter extraction
                console.log('🧪 Testing parameter extraction:');
                console.log('- Serial from ID:', device._id);
                console.log('- VirtualParameters.getSerialNumber:', getParameterValue(device, 'VirtualParameters.getSerialNumber'));
                console.log('- DeviceID.SerialNumber:', getParameterValue(device, 'DeviceID.SerialNumber'));
                console.log('- DeviceID.ProductClass:', getParameterValue(device, 'DeviceID.ProductClass'));
                console.log('- DeviceID.Manufacturer:', getParameterValue(device, 'DeviceID.Manufacturer'));
                console.log('- VirtualParameters.getdeviceuptime:', getParameterValue(device, 'VirtualParameters.getdeviceuptime'));
                console.log('- Device.DeviceInfo.VirtualParameters.getdeviceuptime:', getParameterValue(device, 'Device.DeviceInfo.VirtualParameters.getdeviceuptime'));
                console.log('- InternetGatewayDevice.DeviceInfo.UpTime:', getParameterValue(device, 'InternetGatewayDevice.DeviceInfo.UpTime'));
                console.log('- Last Inform:', device._lastInform);
                console.log('- SSID:', getParameterValue(device, 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID'));
                console.log('- PPPoE Username:', getParameterValue(device, 'VirtualParameters.pppoeUsername'));
                
                // Test status detection
                const uptime1 = getParameterValue(device, 'VirtualParameters.getdeviceuptime');
                const uptime2 = getParameterValue(device, 'Device.DeviceInfo.VirtualParameters.getdeviceuptime');
                const uptime3 = getParameterValue(device, 'InternetGatewayDevice.DeviceInfo.UpTime');
                const lastInform = device._lastInform;
                const hasUptime = (uptime1 && uptime1 > 0) || (uptime2 && uptime2 > 0) || (uptime3 && uptime3 > 0);
                const isRecentInform = lastInform && (Date.now() - new Date(lastInform).getTime()) < 5 * 60 * 1000;
                console.log('- Status Detection - Uptime1:', uptime1, 'Uptime2:', uptime2, 'Uptime3:', uptime3);
                console.log('- Status Detection - HasUptime:', hasUptime, 'IsRecentInform:', isRecentInform);
                console.log('- Status Detection - Final Status:', hasUptime || isRecentInform ? 'Online' : 'Offline');
                
                // Test model extraction
                const deviceId = device._id || '';
                const modelMatch = deviceId.match(/-([A-Z0-9]+)-/);
                console.log('- Model from ID regex:', modelMatch ? modelMatch[1] : 'No match');
            }
            
            // Extract serial number - try multiple sources
            const deviceId = device._id || '';
            const virtualSerial = getParameterValue(device, 'VirtualParameters.getSerialNumber');
            const deviceIdSerial = getParameterValue(device, 'DeviceID.SerialNumber');
            const extractedSerial = deviceId.replace(/%2D/g, '-').replace(/-XPON-.*/, '');
            
            const serialNumber = virtualSerial || deviceIdSerial || extractedSerial || 'N/A';
            
            const processedDevice = {
                id: device._id,
                serialNumber: serialNumber,
                model: (() => {
                    // Try DeviceID.ProductClass first, then extract from device ID
                    const productClass = getParameterValue(device, 'DeviceID.ProductClass');
                    
                    if (productClass && typeof productClass === 'string') {
                        return productClass;
                    }
                    
                    // Extract model from device ID (e.g., "F663NV3A" from "44FB5A-F663NV3A-ZTEGCB7552E1")
                    const modelMatch = deviceId.match(/-([A-Z0-9]+)-/);
                    return modelMatch ? modelMatch[1] : 'Unknown';
                })(),
                status: (() => {
                    // Try multiple uptime parameters for different device types
                    const uptime1 = getParameterValue(device, 'VirtualParameters.getdeviceuptime');
                    const uptime2 = getParameterValue(device, 'Device.DeviceInfo.VirtualParameters.getdeviceuptime');
                    const uptime3 = getParameterValue(device, 'InternetGatewayDevice.DeviceInfo.UpTime');
                    const lastInform = device._lastInform;
                    
                    // Check if device has uptime > 0
                    const hasUptime = (uptime1 && uptime1 > 0) || (uptime2 && uptime2 > 0) || (uptime3 && uptime3 > 0);
                    
                    // Check if device has recent inform (within last 5 minutes)
                    const isRecentInform = lastInform && (Date.now() - new Date(lastInform).getTime()) < 5 * 60 * 1000;
                    
                    // Device is online if it has uptime OR recent inform
                    return hasUptime || isRecentInform ? 'Online' : 'Offline';
                })(),
                ssid: getParameterValue(device, 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID') || 'N/A',
                lastInform: device._lastInform || new Date().toISOString(),
                latitude: null,
                longitude: null,
                customerName: null,
                customerPhone: null
            };
            
            // Try to find customer by PPPoE username - try multiple sources
            const pppoeUsername = getParameterValue(device, 'VirtualParameters.pppoeUsername') || 
                                 getParameterValue(device, 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username');
            if (pppoeUsername && pppoeUsername !== '-') {
                try {
                    const db = require('../config/billing').db;
                    const customer = await new Promise((resolve, reject) => {
                        db.get(`
                            SELECT id, name, phone, latitude, longitude 
                            FROM customers 
                            WHERE pppoe_username = ? AND latitude IS NOT NULL AND longitude IS NOT NULL
                        `, [pppoeUsername], (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });
                    
                    if (customer) {
                        processedDevice.latitude = customer.latitude;
                        processedDevice.longitude = customer.longitude;
                        processedDevice.customerName = customer.name;
                        processedDevice.customerPhone = customer.phone;
                    }
                } catch (customerError) {
                    console.log(`⚠️ Error finding customer for device ${processedDevice.serialNumber}:`, customerError.message);
                }
            }
            
            processedDevices.push(processedDevice);
        }
        
        console.log(`✅ Processed ${processedDevices.length} devices`);
        
        res.json({
            success: true,
            devices: processedDevices
        });
    } catch (error) {
        console.error('❌ Error getting devices:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading devices data: ' + error.message
        });
    }
});

// API endpoint untuk cables
router.get('/api/cables', adminAuth, async (req, res) => {
    try {
        const db = require('../config/billing').db;
        const cables = await new Promise((resolve, reject) => {
            db.all(`
                SELECT c.id, c.name, c.from_odp_id, c.to_odp_id, c.cable_type, c.length,
                       c.status, c.notes,
                       o1.name as from_odp_name, o1.latitude as from_lat, o1.longitude as from_lng,
                       o2.name as to_odp_name, o2.latitude as to_lat, o2.longitude as to_lng
                FROM cable_routes c
                LEFT JOIN odps o1 ON c.from_odp_id = o1.id
                LEFT JOIN odps o2 ON c.to_odp_id = o2.id
                WHERE o1.latitude IS NOT NULL AND o1.longitude IS NOT NULL
                  AND o2.latitude IS NOT NULL AND o2.longitude IS NOT NULL
                ORDER BY c.name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Format cables for map
        const formattedCables = cables.map(cable => ({
            id: cable.id,
            name: cable.name,
            from: [cable.from_lat, cable.from_lng],
            to: [cable.to_lat, cable.to_lng],
            type: cable.cable_type,
            length: cable.length,
            status: cable.status
        }));
        
        res.json({
            success: true,
            cables: formattedCables
        });
    } catch (error) {
        logger.error('Error getting cables for mobile mapping:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading cables data'
        });
    }
});

router.get('/api/customers', adminAuth, async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        res.json({
            success: true,
            customers: customers
        });
    } catch (error) {
        logger.error('Error getting customers API:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

router.get('/api/invoices', async (req, res) => {
    try {
        const { customer_username } = req.query;
        const invoices = await billingManager.getInvoices(customer_username);
        res.json(invoices);
    } catch (error) {
        logger.error('Error getting invoices API:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/invoices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice tidak ditemukan'
            });
        }
        
        res.json({
            success: true,
            invoice: invoice
        });
    } catch (error) {
        logger.error('Error getting invoice by ID API:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Route /api/stats sudah ada di atas dengan adminAuth middleware

router.get('/api/overdue', async (req, res) => {
    try {
        const overdueInvoices = await billingManager.getOverdueInvoices();
        res.json(overdueInvoices);
    } catch (error) {
        logger.error('Error getting overdue invoices API:', error);
        res.status(500).json({ error: error.message });
    }
});

// Service Suspension Management Routes
router.post('/service-suspension/suspend/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { reason } = req.body;
        
        // Validasi input
        if (!username || username.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Username tidak boleh kosong'
            });
        }

        const customer = await billingManager.getCustomerByUsername(username.trim());
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer tidak ditemukan'
            });
        }

        // Cek apakah customer sudah suspended
        if (customer.status === 'suspended') {
            return res.status(400).json({
                success: false,
                message: 'Customer sudah dalam status suspended'
            });
        }

        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.suspendCustomerService(customer, reason || 'Manual suspension');
        
        res.json({
            success: result.success,
            message: result.success ? 'Service suspended successfully' : 'Failed to suspend service',
            results: result.results,
            customer: result.customer,
            reason: result.reason || (reason || 'Manual suspension')
        });
    } catch (error) {
        logger.error('Error suspending service:', error);
        res.status(500).json({
            success: false,
            message: 'Error suspending service: ' + error.message
        });
    }
});

router.post('/service-suspension/restore/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { reason } = req.body || {};
        
        // Validasi input
        if (!username || username.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Username tidak boleh kosong'
            });
        }

        const customer = await billingManager.getCustomerByUsername(username.trim());
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer tidak ditemukan'
            });
        }

        // Cek apakah customer sudah active
        if (customer.status === 'active') {
            return res.status(400).json({
                success: false,
                message: 'Customer sudah dalam status active'
            });
        }

        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.restoreCustomerService(customer, reason || 'Manual restore');
        
        res.json({
            success: result.success,
            message: result.success ? 'Service restored successfully' : 'Failed to restore service',
            results: result.results,
            customer: result.customer,
            reason: result.reason || (reason || 'Manual restore')
        });
    } catch (error) {
        logger.error('Error restoring service:', error);
        res.status(500).json({
            success: false,
            message: 'Error restoring service: ' + error.message
        });
    }
});

router.post('/service-suspension/check-overdue', async (req, res) => {
    try {
        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.checkAndSuspendOverdueCustomers();
        
        res.json({
            success: true,
            message: 'Overdue customers check completed',
            ...result
        });
    } catch (error) {
        logger.error('Error checking overdue customers:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking overdue customers: ' + error.message
        });
    }
});

router.post('/service-suspension/check-paid', async (req, res) => {
    try {
        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.checkAndRestorePaidCustomers();
        
        res.json({
            success: true,
            message: 'Paid customers check completed',
            ...result
        });
    } catch (error) {
        logger.error('Error checking paid customers:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking paid customers: ' + error.message
        });
    }
});

// Service Suspension Settings Page
router.get('/service-suspension', getAppSettings, async (req, res) => {
    try {
        res.render('admin/billing/service-suspension', {
            title: 'Service Suspension',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading service suspension page:', error);
        res.status(500).render('error', { 
            message: 'Error loading service suspension page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Service Suspension: Grace Period Setting API
router.get('/service-suspension/grace-period', adminAuth, async (req, res) => {
    try {
        const value = getSetting('suspension_grace_period_days', '3');
        res.json({ success: true, grace_period_days: value });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/service-suspension/grace-period', adminAuth, async (req, res) => {
    try {
        const { grace_period_days } = req.body || {};
        if (!grace_period_days || typeof grace_period_days !== 'string') {
            return res.status(400).json({ success: false, message: 'grace_period_days tidak valid' });
        }

        const days = parseInt(grace_period_days.trim(), 10);
        if (isNaN(days) || days < 1 || days > 30) {
            return res.status(400).json({ success: false, message: 'Grace period harus antara 1-30 hari' });
        }

        const ok = setSetting('suspension_grace_period_days', days.toString());
        if (!ok) {
            return res.status(500).json({ success: false, message: 'Gagal menyimpan ke settings.json' });
        }

        // Clear cache agar pengaturan baru langsung berlaku
        clearSettingsCache();

        res.json({ success: true, grace_period_days: days.toString() });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Service Suspension: Isolir Profile Setting API
router.get('/service-suspension/isolir-profile', adminAuth, async (req, res) => {
    try {
        const value = getSetting('isolir_profile', 'isolir');
        res.json({ success: true, isolir_profile: value });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/service-suspension/isolir-profile', adminAuth, async (req, res) => {
    try {
        const { isolir_profile } = req.body || {};
        if (!isolir_profile || typeof isolir_profile !== 'string') {
            return res.status(400).json({ success: false, message: 'isolir_profile tidak valid' });
        }

        const profile = isolir_profile.trim();
        if (!profile) {
            return res.status(400).json({ success: false, message: 'Profile tidak boleh kosong' });
        }

        const ok = setSetting('isolir_profile', profile);
        if (!ok) {
            return res.status(500).json({ success: false, message: 'Gagal menyimpan ke settings.json' });
        }

        // Clear cache agar pengaturan baru langsung berlaku
        clearSettingsCache();

        res.json({ success: true, isolir_profile: profile });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Payment Monitor
router.get('/payment-monitor', getAppSettings, async (req, res) => {
    try {
        res.render('admin/billing/payment-monitor', {
            title: 'Payment Monitor',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading payment monitor:', error);
        res.status(500).render('error', { 
            message: 'Error loading payment monitor',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Payment Settings Routes
router.get('/payment-settings', getAppSettings, async (req, res) => {
    try {
        const settings = getSettingsWithCache();
        res.render('admin/billing/payment-settings', {
            title: 'Payment Gateway Settings',
            settings: settings,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading payment settings:', error);
        res.status(500).render('error', { 
            message: 'Error loading payment settings',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Update active gateway
router.post('/payment-settings/active-gateway', async (req, res) => {
    try {
        const { activeGateway } = req.body;
        const settings = getSettingsWithCache();
        
        settings.payment_gateway.active = activeGateway;
        // Persist to settings.json via settingsManager
        setSetting('payment_gateway', settings.payment_gateway);
        // Hot-reload gateways
        const reloadInfo = billingManager.reloadPaymentGateway();
        
        res.json({
            success: true,
            message: 'Active gateway updated successfully',
            reload: reloadInfo
        });
    } catch (error) {
        logger.error('Error updating active gateway:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating active gateway',
            error: error.message
        });
    }
});

// Update gateway configuration
router.post('/payment-settings/:gateway', async (req, res) => {
    try {
        const { gateway } = req.params;
        const config = req.body;
        const settings = getSettingsWithCache();
        
        if (!settings.payment_gateway[gateway]) {
            return res.status(400).json({
                success: false,
                message: `Gateway ${gateway} not found`
            });
        }
        
        // Update gateway configuration
        settings.payment_gateway[gateway] = {
            ...settings.payment_gateway[gateway],
            ...config
        };
        
        // Persist to settings.json via settingsManager
        setSetting('payment_gateway', settings.payment_gateway);
        // Hot-reload gateways
        const reloadInfo = billingManager.reloadPaymentGateway();
        
        res.json({
            success: true,
            message: `${gateway} configuration updated successfully`,
            reload: reloadInfo
        });
    } catch (error) {
        logger.error(`Error updating ${req.params.gateway} configuration:`, error);
        res.status(500).json({
            success: false,
            message: `Error updating ${req.params.gateway} configuration`,
            error: error.message
        });
    }
});

// Test gateway connection
router.post('/payment-settings/test/:gateway', async (req, res) => {
    try {
        const { gateway } = req.params;
        const PaymentGatewayManager = require('../config/paymentGateway');
        const paymentManager = new PaymentGatewayManager();
        
        // Test the gateway by trying to create a test payment
        const testInvoice = {
            invoice_number: 'TEST-001',
            amount: 10000,
            package_name: 'Test Package',
            customer_name: 'Test Customer',
            customer_phone: '08123456789',
            customer_email: 'test@example.com'
        };
        
        // Guard: Tripay minimum amount validation to avoid gateway rejection
        if (gateway === 'tripay' && Number(testInvoice.amount) < 10000) {
            return res.status(400).json({
                success: false,
                message: 'Minimal nominal Tripay adalah Rp 10.000'
            });
        }
        
        const result = await paymentManager.createPayment(testInvoice, gateway);
        
        res.json({
            success: true,
            message: `${gateway} connection test successful`,
            data: result
        });
    } catch (error) {
        logger.error(`Error testing ${req.params.gateway} connection:`, error);
        res.status(500).json({
            success: false,
            message: `${req.params.gateway} connection test failed: ${error.message}`
        });
    }
});

// Manual Isolir by Invoice ID
router.post('/invoices/:id/isolir', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const reason = (req.body && req.body.reason) || 'Isolir manual dari Admin';

        const invoice = await billingManager.getInvoiceById(id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });

        const customer = await billingManager.getCustomerById(invoice.customer_id);
        if (!customer) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });

        const result = await serviceSuspension.suspendCustomerService(customer, reason);
        return res.json({ success: !!result?.success, data: result, message: result?.success ? 'Isolir berhasil' : (result?.error || 'Gagal isolir') });
    } catch (error) {
        logger.error('Error manual isolir:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Manual Restore by Invoice ID
router.post('/invoices/:id/restore', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const reason = (req.body && req.body.reason) || 'Restore manual dari Admin';

        const invoice = await billingManager.getInvoiceById(id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });

        const customer = await billingManager.getCustomerById(invoice.customer_id);
        if (!customer) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });

        const result = await serviceSuspension.restoreCustomerService(customer, reason);
        return res.json({ success: !!result?.success, data: result, message: result?.success ? 'Restore berhasil' : (result?.error || 'Gagal restore') });
    } catch (error) {
        logger.error('Error manual restore:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Route untuk mengelola expenses
router.get('/expenses', getAppSettings, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const expenses = await billingManager.getExpenses(start_date, end_date);
        
        res.render('admin/billing/expenses', {
            title: 'Manajemen Pengeluaran',
            expenses,
            startDate: start_date || '',
            endDate: end_date || '',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading expenses:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat data pengeluaran',
            error: error.message 
        });
    }
});

// API untuk menambah expense
router.post('/api/expenses', async (req, res) => {
    try {
        const { description, amount, category, expense_date, payment_method, notes } = req.body;
        
        if (!description || !amount || !category || !expense_date) {
            return res.status(400).json({ 
                success: false, 
                message: 'Semua field wajib diisi' 
            });
        }
        
        const expense = await billingManager.addExpense({
            description,
            amount: parseFloat(amount),
            category,
            expense_date,
            payment_method: payment_method || '',
            notes: notes || ''
        });
        
        res.json({ success: true, data: expense, message: 'Pengeluaran berhasil ditambahkan' });
    } catch (error) {
        logger.error('Error adding expense:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API untuk update expense
router.put('/api/expenses/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { description, amount, category, expense_date, payment_method, notes } = req.body;
        
        if (!description || !amount || !category || !expense_date) {
            return res.status(400).json({ 
                success: false, 
                message: 'Semua field wajib diisi' 
            });
        }
        
        const expense = await billingManager.updateExpense(parseInt(id), {
            description,
            amount: parseFloat(amount),
            category,
            expense_date,
            payment_method: payment_method || '',
            notes: notes || ''
        });
        
        res.json({ success: true, data: expense, message: 'Pengeluaran berhasil diperbarui' });
    } catch (error) {
        logger.error('Error updating expense:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API untuk delete expense
router.delete('/api/expenses/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await billingManager.deleteExpense(parseInt(id));
        
        res.json({ success: true, data: result, message: 'Pengeluaran berhasil dihapus' });
    } catch (error) {
        logger.error('Error deleting expense:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API untuk statistik komisi kolektor
router.get('/api/commission-stats', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const stats = await billingManager.getCommissionStats(start_date, end_date);
        
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Error getting commission stats:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Root billing page - redirect to dashboard
router.get('/', getAppSettings, async (req, res) => {
    res.redirect('/admin/billing/dashboard');
});

// Devices page
router.get('/devices', getAppSettings, async (req, res) => {
    try {
        res.render('admin/billing/devices', {
            title: 'Network Devices',
            user: req.user,
            settings: req.appSettings
        });
    } catch (error) {
        console.error('Error rendering devices page:', error);
        res.status(500).render('error', { 
            message: 'Error loading devices page',
            error: error 
        });
    }
});

// New Mapping page
router.get('/mapping-new', getAppSettings, async (req, res) => {
    try {
        res.render('admin/billing/mapping-new', {
            title: 'Network Mapping - New',
            user: req.user,
            settings: req.appSettings
        });
    } catch (error) {
        console.error('Error rendering new mapping page:', error);
        res.status(500).render('error', { 
            message: 'Error loading mapping page',
            error: error 
        });
    }
});

// Mapping page - Redirect to new mapping page
router.get('/mapping', getAppSettings, async (req, res) => {
    try {
        // Redirect to new mapping page
        return res.redirect('/admin/billing/mapping-new');
    } catch (error) {
        logger.error('Error redirecting to mapping page:', error);
        res.status(500).render('error', {
            message: 'Error redirecting to mapping page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Mobile Mapping page
router.get('/mobile/mapping', getAppSettings, async (req, res) => {
    try {
        // Get mapping data for mobile
        const customers = await billingManager.getCustomers();
        const customersWithCoords = customers.filter(c => c.latitude && c.longitude);
        
        // Calculate stats
        const totalCustomers = customersWithCoords.length;
        const activeCustomers = customersWithCoords.filter(c => c.status === 'active').length;
        const suspendedCustomers = customersWithCoords.filter(c => c.status === 'suspended').length;
        
        // Use responsive mapping-new.ejs instead of separate mobile version
        res.redirect('/admin/billing/mapping');
    } catch (error) {
        logger.error('Error loading mobile mapping page:', error);
        res.status(500).render('error', {
            message: 'Error loading mobile mapping page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// API untuk mapping data
router.get('/api/mapping/data', async (req, res) => {
    try {
        const MappingUtils = require('../utils/mappingUtils');
        
        // Ambil data customers dengan koordinat
        const customers = await billingManager.getCustomers();
        const customersWithCoords = customers.filter(c => c.latitude && c.longitude);
        
        // Validasi koordinat customer
        const validatedCustomers = customersWithCoords.map(customer => 
            MappingUtils.validateCustomerCoordinates(customer)
        );
        
        // Hitung statistik mapping
        const totalCustomers = validatedCustomers.length;
        const validCoordinates = validatedCustomers.filter(c => c.coordinateStatus === 'valid').length;
        const defaultCoordinates = validatedCustomers.filter(c => c.coordinateStatus === 'default').length;
        const invalidCoordinates = validatedCustomers.filter(c => c.coordinateStatus === 'invalid').length;
        
        // Hitung area coverage jika ada minimal 3 koordinat
        let coverageArea = 0;
        if (validCoordinates >= 3) {
            const validCoords = validatedCustomers
                .filter(c => c.coordinateStatus === 'valid')
                .map(c => ({ latitude: c.latitude, longitude: c.longitude }));
            coverageArea = MappingUtils.calculateCoverageArea(validCoords);
        }
        
        // Buat clusters untuk customer
        const customerClusters = MappingUtils.createClusters(
            validatedCustomers.map(c => ({ latitude: c.latitude, longitude: c.longitude })),
            2000 // 2km cluster radius
        );
        
        res.json({
            success: true,
            data: {
                customers: validatedCustomers,
                clusters: customerClusters,
                statistics: {
                    totalCustomers,
                    validCoordinates,
                    defaultCoordinates,
                    invalidCoordinates,
                    coverageArea: parseFloat(coverageArea)
                }
            }
        });
    } catch (error) {
        logger.error('Error getting mapping data:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal mengambil data mapping' 
        });
    }
});

// API untuk analisis coverage area
router.get('/api/mapping/coverage', async (req, res) => {
    try {
        const MappingUtils = require('../utils/mappingUtils');
        
        // Ambil data customers
        const customers = await billingManager.getCustomers();
        const customersWithCoords = customers.filter(c => c.latitude && c.longitude);
        
        if (customersWithCoords.length < 3) {
            return res.json({
                success: false,
                message: 'Minimal 3 koordinat diperlukan untuk analisis coverage'
            });
        }
        
        // Hitung bounding box
        const coordinates = customersWithCoords.map(c => ({ 
            latitude: c.latitude, 
            longitude: c.longitude 
        }));
        
        const boundingBox = MappingUtils.getBoundingBox(coordinates);
        const center = MappingUtils.getCenterCoordinate(coordinates);
        const coverageArea = MappingUtils.calculateCoverageArea(coordinates);
        
        // Analisis density per area
        const clusters = MappingUtils.createClusters(coordinates, 1000); // 1km radius
        const highDensityAreas = clusters.filter(c => c.count >= 5);
        const mediumDensityAreas = clusters.filter(c => c.count >= 3 && c.count < 5);
        const lowDensityAreas = clusters.filter(c => c.count < 3);
        
        res.json({
            success: true,
            data: {
                coverageArea: parseFloat(coverageArea),
                boundingBox,
                center,
                densityAnalysis: {
                    highDensity: highDensityAreas.length,
                    mediumDensity: mediumDensityAreas.length,
                    lowDensity: lowDensityAreas.length,
                    totalClusters: clusters.length
                },
                clusters: {
                    high: highDensityAreas,
                    medium: mediumDensityAreas,
                    low: lowDensityAreas
                }
            }
        });
    } catch (error) {
        logger.error('Error analyzing coverage:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal menganalisis coverage area' 
        });
    }
});

// API untuk update koordinat customer
router.put('/api/mapping/customers/:id/coordinates', async (req, res) => {
    try {
        const { id } = req.params;
        const { latitude, longitude } = req.body;
        
        if (!latitude || !longitude) {
            return res.status(400).json({
                success: false,
                message: 'Latitude dan longitude wajib diisi'
            });
        }
        
        const MappingUtils = require('../utils/mappingUtils');
        
        // Validasi koordinat
        if (!MappingUtils.isValidCoordinate(latitude, longitude)) {
            return res.status(400).json({
                success: false,
                message: 'Koordinat tidak valid'
            });
        }
        
        // Update koordinat customer
        const result = await billingManager.updateCustomerCoordinates(parseInt(id), {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude)
        });
        
        if (result) {
            res.json({
                success: true,
                message: 'Koordinat customer berhasil diperbarui',
                data: {
                    id: parseInt(id),
                    latitude: parseFloat(latitude),
                    longitude: parseFloat(longitude),
                    formattedCoordinates: MappingUtils.formatCoordinates(latitude, longitude)
                }
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Customer tidak ditemukan'
            });
        }
    } catch (error) {
        logger.error('Error updating customer coordinates:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal memperbarui koordinat customer'
        });
    }
});

// API untuk bulk update koordinat
router.post('/api/mapping/customers/bulk-coordinates', async (req, res) => {
    try {
        const { coordinates } = req.body;
        
        if (!coordinates || !Array.isArray(coordinates)) {
            return res.status(400).json({
                success: false,
                message: 'Data koordinat harus berupa array'
            });
        }
        
        const MappingUtils = require('../utils/mappingUtils');
        const results = [];
        let successCount = 0;
        let errorCount = 0;
        
        for (const coord of coordinates) {
            try {
                const { customer_id, latitude, longitude } = coord;
                
                if (!customer_id || !latitude || !longitude) {
                    results.push({
                        customer_id,
                        success: false,
                        message: 'Data tidak lengkap'
                    });
                    errorCount++;
                    continue;
                }
                
                // Validasi koordinat
                if (!MappingUtils.isValidCoordinate(latitude, longitude)) {
                    results.push({
                        customer_id,
                        success: false,
                        message: 'Koordinat tidak valid'
                    });
                    errorCount++;
                    continue;
                }
                
                // Update koordinat
                const result = await billingManager.updateCustomerCoordinates(parseInt(customer_id), {
                    latitude: parseFloat(latitude),
                    longitude: parseFloat(longitude)
                });
                
                if (result) {
                    results.push({
                        customer_id,
                        success: true,
                        message: 'Koordinat berhasil diperbarui',
                        data: {
                            latitude: parseFloat(latitude),
                            longitude: parseFloat(longitude),
                            formattedCoordinates: MappingUtils.formatCoordinates(latitude, longitude)
                        }
                    });
                    successCount++;
                } else {
                    results.push({
                        customer_id,
                        success: false,
                        message: 'Customer tidak ditemukan'
                    });
                    errorCount++;
                }
            } catch (error) {
                results.push({
                    customer_id: coord.customer_id,
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
                total: coordinates.length,
                success: successCount,
                error: errorCount,
                results
            }
        });
    } catch (error) {
        logger.error('Error bulk updating coordinates:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal melakukan bulk update koordinat'
        });
    }
});

// API untuk export mapping data
router.get('/api/mapping/export', async (req, res) => {
    try {
        const { format = 'json' } = req.query;
        
        // Ambil data mapping
        const customers = await billingManager.getCustomers();
        const customersWithCoords = customers.filter(c => c.latitude && c.longitude);
        
        if (format === 'csv') {
            // Export sebagai CSV
            const csvData = customersWithCoords.map(c => ({
                id: c.id,
                name: c.name,
                phone: c.phone,
                username: c.username,
                latitude: c.latitude,
                longitude: c.longitude,
                package_name: c.package_name || 'N/A',
                status: c.status,
                address: c.address || 'N/A'
            }));
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="mapping_data.csv"');
            
            // CSV header
            const headers = Object.keys(csvData[0]).join(',');
            const rows = csvData.map(row => Object.values(row).map(val => `"${val}"`).join(','));
            
            res.send([headers, ...rows].join('\n'));
        } else {
            // Export sebagai JSON
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="mapping_data.json"');
            
            res.json({
                exportDate: new Date().toISOString(),
                totalCustomers: customersWithCoords.length,
                data: customersWithCoords
            });
        }
    } catch (error) {
        logger.error('Error exporting mapping data:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal export data mapping'
        });
    }
});

// Calculate price with tax for package
router.get('/api/packages/:id/price-with-tax', async (req, res) => {
    try {
        const { id } = req.params;
        const package = await billingManager.getPackageById(parseInt(id));
        
        if (!package) {
            return res.status(404).json({
                success: false,
                message: 'Package not found'
            });
        }
        
        const basePrice = package.price;
        const taxRate = (package.tax_rate === 0 || (typeof package.tax_rate === 'number' && package.tax_rate > -1))
            ? Number(package.tax_rate)
            : 11.00;
        const priceWithTax = billingManager.calculatePriceWithTax(basePrice, taxRate);
        
        res.json({
            success: true,
            package: {
                id: package.id,
                name: package.name,
                base_price: basePrice,
                tax_rate: taxRate,
                price_with_tax: priceWithTax
            }
        });
    } catch (error) {
        logger.error('Error calculating price with tax:', error);
        res.status(500).json({
            success: false,
            message: 'Error calculating price with tax',
            error: error.message
        });
    }
});

// GET: View individual payment
router.get('/payments/:id', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get payment data (placeholder - implement getPayment method if needed)
        const payment = {
            id: id,
            customer_name: 'John Doe',
            amount: 150000,
            method: 'Transfer Bank',
            status: 'Pending',
            date: new Date().toISOString(),
            reference: 'PAY' + id.toString().padStart(6, '0'),
            description: 'Pembayaran tagihan bulanan'
        };
        
        res.render('admin/billing/mobile-payment-detail', {
            title: 'Detail Pembayaran - Mobile',
            appSettings: req.appSettings,
            payment: payment
        });
    } catch (error) {
        logger.error('Error loading payment detail:', error);
        res.status(500).render('error', { 
            message: 'Error loading payment detail',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// GET: Billing Settings
router.get('/settings', getAppSettings, async (req, res) => {
    try {
        const settings = getSettingsWithCache();
        
        res.render('admin/billing/settings', {
            title: 'Pengaturan Billing - Mobile',
            appSettings: req.appSettings,
            settings: settings
        });
    } catch (error) {
        logger.error('Error loading billing settings:', error);
        res.status(500).render('error', { 
            message: 'Error loading billing settings',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// API: Get list of unpaid invoices (tagihan)
router.get('/api/list-tagihan', adminAuth, async (req, res) => {
    try {
        const unpaidInvoices = await billingManager.getUnpaidInvoices();

        // Group by customer for better display
        const customerGroups = {};
        unpaidInvoices.forEach(invoice => {
            if (!customerGroups[invoice.customer_id]) {
                customerGroups[invoice.customer_id] = {
                    customer_name: invoice.customer_name,
                    customer_phone: invoice.customer_phone,
                    total_amount: 0,
                    invoices: []
                };
            }
            customerGroups[invoice.customer_id].total_amount += parseFloat(invoice.amount);
            customerGroups[invoice.customer_id].invoices.push(invoice);
        });

        res.json({
            success: true,
            data: {
                total_customers: Object.keys(customerGroups).length,
                total_invoices: unpaidInvoices.length,
                customers: customerGroups
            }
        });

    } catch (error) {
        console.error('Error getting unpaid invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting unpaid invoices: ' + error.message
        });
    }
});

// API: Get list of paid invoices (bayar)
router.get('/api/list-bayar', adminAuth, async (req, res) => {
    try {
        const paidInvoices = await billingManager.getPaidInvoices();

        // Group by customer for better display
        const customerGroups = {};
        paidInvoices.forEach(invoice => {
            if (!customerGroups[invoice.customer_id]) {
                customerGroups[invoice.customer_id] = {
                    customer_name: invoice.customer_name,
                    customer_phone: invoice.customer_phone,
                    total_amount: 0,
                    invoices: []
                };
            }
            customerGroups[invoice.customer_id].total_amount += parseFloat(invoice.amount);
            customerGroups[invoice.customer_id].invoices.push(invoice);
        });

        res.json({
            success: true,
            data: {
                total_customers: Object.keys(customerGroups).length,
                total_invoices: paidInvoices.length,
                customers: customerGroups
            }
        });

    } catch (error) {
        console.error('Error getting paid invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting paid invoices: ' + error.message
        });
    }
});

// GET: Billing Reports
router.get('/reports', getAppSettings, async (req, res) => {
    try {
        const settings = getSettingsWithCache();
        
        // Get basic stats for reports
        const totalCustomers = await billingManager.getTotalCustomers();
        const totalInvoices = await billingManager.getTotalInvoices();
        const totalRevenue = await billingManager.getTotalRevenue();
        const pendingPayments = await billingManager.getPendingPayments();
        
        res.render('admin/billing/reports', {
            title: 'Laporan Billing - Mobile',
            appSettings: req.appSettings,
            stats: {
                totalCustomers,
                totalInvoices,
                totalRevenue,
                pendingPayments
            }
        });
    } catch (error) {
        logger.error('Error loading billing reports:', error);
        res.status(500).render('error', { 
            message: 'Error loading billing reports',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

module.exports = router;