/**
 * Collector Dashboard Routes
 * Routes untuk dashboard dan pembayaran tukang tagih
 */

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { getSetting } = require('../config/settingsManager');
const { collectorAuth } = require('./collectorAuth');
const billingManager = require('../config/billing');
const serviceSuspension = require('../config/serviceSuspension');
const whatsappNotifications = require('../config/whatsapp-notifications');

// Dashboard
router.get('/dashboard', collectorAuth, async (req, res) => {
    try {
        const collectorId = req.collector.id;
        
        // Get collector info menggunakan BillingManager
        const collector = await billingManager.getCollectorById(collectorId);
        
        if (!collector) {
            return res.status(404).render('error', { 
                message: 'Collector not found',
                error: {}
            });
        }
        
        // Validasi dan format data collector
        const validCollector = {
            ...collector,
            commission_rate: Math.max(0, Math.min(100, parseFloat(collector.commission_rate || 5))), // Pastikan 0-100%
            name: collector.name || 'Unknown Collector',
            phone: collector.phone || '',
            status: collector.status || 'active'
        };
        
        // Get statistics menggunakan BillingManager
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
        
        const [todayPayments, totalCommission, totalPayments, recentPayments] = await Promise.all([
            // Today's payments - menggunakan data real dari database
            billingManager.getCollectorTodayPayments(collectorId, startOfDay, endOfDay),
            // Total commission - menggunakan data real dari database
            billingManager.getCollectorTotalCommission(collectorId),
            // Total payments count - menggunakan data real dari database
            billingManager.getCollectorTotalPayments(collectorId),
            // Recent payments - menggunakan data real dari database
            billingManager.getCollectorRecentPayments(collectorId, 5)
        ]);
        
        const appSettings = await getAppSettings();
        
        res.render('collector/dashboard', {
            title: 'Dashboard Tukang Tagih',
            appSettings: appSettings,
            collector: collector,
            statistics: {
                todayPayments: todayPayments,
                totalCommission: totalCommission,
                totalPayments: totalPayments
            },
            recentPayments: recentPayments
        });
        
    } catch (error) {
        console.error('Error loading collector dashboard:', error);
        res.status(500).render('error', { 
            message: 'Error loading dashboard',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Payment form
router.get('/payment', collectorAuth, async (req, res) => {
    try {
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Get active customers
        const customers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM customers WHERE status = "active" ORDER BY name', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        const appSettings = await getAppSettings();
        const collector = req.collector;
        
        db.close();
        
        res.render('collector/payment', {
            title: 'Input Pembayaran',
            appSettings: appSettings,
            collector: collector,
            customers: customers
        });
        
    } catch (error) {
        console.error('Error loading payment form:', error);
        res.status(500).render('error', { 
            message: 'Error loading payment form',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Get customer invoices
router.get('/api/customer-invoices/:customerId', collectorAuth, async (req, res) => {
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

// Payments list
router.get('/payments', collectorAuth, async (req, res) => {
    try {
        const collectorId = req.collector.id;
        
        // Get collector info menggunakan BillingManager
        const collector = await billingManager.getCollectorById(collectorId);
        
        if (!collector) {
            return res.status(404).render('error', { 
                message: 'Collector not found',
                error: {}
            });
        }
        
        // Get all payments menggunakan BillingManager
        const payments = await billingManager.getCollectorAllPayments(collectorId);
        
        const appSettings = await getAppSettings();
        
        res.render('collector/payments', {
            title: 'Riwayat Pembayaran',
            appSettings: appSettings,
            collector: collector,
            payments: payments
        });
        
    } catch (error) {
        console.error('Error loading payments:', error);
        res.status(500).render('error', { 
            message: 'Error loading payments',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Customers list
router.get('/customers', collectorAuth, async (req, res) => {
    try {
        // Gunakan billingManager agar termasuk payment_status
        const allCustomers = await billingManager.getCustomers();
        const statusFilter = (req.query.status || '').toString().toLowerCase();
        const validFilters = new Set(['paid', 'unpaid', 'overdue', 'no_invoice']);
        let customers = (allCustomers || []).filter(c => c.status === 'active');
        if (validFilters.has(statusFilter)) {
            customers = customers.filter(c => (c.payment_status || '') === statusFilter);
        }
        const appSettings = await getAppSettings();
        const collector = req.collector;
        
        res.render('collector/customers', {
            title: 'Daftar Pelanggan',
            appSettings: appSettings,
            collector: collector,
            customers: customers,
            currentStatusFilter: validFilters.has(statusFilter) ? statusFilter : ''
        });
        
    } catch (error) {
        console.error('Error loading customers:', error);
        res.status(500).render('error', { 
            message: 'Error loading customers',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Profile page
router.get('/profile', collectorAuth, async (req, res) => {
    try {
        const collectorId = req.collector.id;
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Get collector info
        const collector = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM collectors WHERE id = ?', [collectorId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        const appSettings = await getAppSettings();
        
        db.close();
        
        res.render('collector/profile', {
            title: 'Profil Saya',
            appSettings: appSettings,
            collector: collector
        });
        
    } catch (error) {
        console.error('Error loading profile:', error);
        res.status(500).render('error', { 
            message: 'Error loading profile',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Edit profile page
router.get('/profile/edit', collectorAuth, async (req, res) => {
    try {
        const collectorId = req.collector.id;
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Get collector info
        const collector = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM collectors WHERE id = ?', [collectorId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        const appSettings = await getAppSettings();
        
        db.close();
        
        res.render('collector/profile-edit', {
            title: 'Edit Profil',
            appSettings: appSettings,
            collector: collector
        });
        
    } catch (error) {
        console.error('Error loading edit profile:', error);
        res.status(500).render('error', { 
            message: 'Error loading edit profile',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Update profile
router.post('/api/profile/update', collectorAuth, async (req, res) => {
    try {
        const collectorId = req.collector.id;
        const { name, phone, email } = req.body;
        
        if (!name || name.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Nama tidak boleh kosong'
            });
        }
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Update collector info
        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE collectors 
                SET name = ?, phone = ?, email = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [name.trim(), phone?.trim() || null, email?.trim() || null, collectorId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            message: 'Profil berhasil diperbarui'
        });
        
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating profile: ' + error.message
        });
    }
});

// Update password
router.post('/api/profile/update-password', collectorAuth, async (req, res) => {
    try {
        const collectorId = req.collector.id;
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Password lama dan password baru harus diisi'
            });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password baru minimal 6 karakter'
            });
        }
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Get current collector data
        const collector = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM collectors WHERE id = ?', [collectorId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!collector) {
            db.close();
            return res.status(404).json({
                success: false,
                message: 'Tukang tagih tidak ditemukan'
            });
        }
        
        // Verify current password (simple comparison for now)
        if (collector.password !== currentPassword) {
            db.close();
            return res.status(400).json({
                success: false,
                message: 'Password lama tidak benar'
            });
        }
        
        // Update password
        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE collectors 
                SET password = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [newPassword, collectorId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            message: 'Password berhasil diperbarui'
        });
        
    } catch (error) {
        console.error('Error updating password:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating password: ' + error.message
        });
    }
});

// Submit payment
router.post('/api/payment', collectorAuth, async (req, res) => {
    try {
        const collectorId = req.collector.id;
        const { customer_id, payment_amount, payment_method, notes, invoice_ids } = req.body;

        // Normalize values
        const paymentAmountNum = Number(payment_amount);
        let parsedInvoiceIds = [];
        if (Array.isArray(invoice_ids)) {
            parsedInvoiceIds = invoice_ids;
        } else if (typeof invoice_ids === 'string') {
            const trimmed = invoice_ids.trim();
            if (trimmed) {
                try {
                    parsedInvoiceIds = trimmed.startsWith('[') ? JSON.parse(trimmed) : trimmed.split(',');
                } catch (_) {
                    parsedInvoiceIds = trimmed.split(',');
                }
            }
        }
        parsedInvoiceIds = parsedInvoiceIds.map(v => Number(String(v).trim())).filter(v => !Number.isNaN(v));
        
        if (!customer_id || !paymentAmountNum) {
            return res.status(400).json({
                success: false,
                message: 'Customer ID dan jumlah pembayaran harus diisi'
            });
        }
        
        // Validasi jumlah pembayaran
        if (paymentAmountNum <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Jumlah pembayaran harus lebih dari 0'
            });
        }
        
        if (paymentAmountNum > 999999999) {
            return res.status(400).json({
                success: false,
                message: 'Jumlah pembayaran terlalu besar (maksimal 999,999,999)'
            });
        }
        
        // Get collector commission rate using BillingManager
        const collector = await billingManager.getCollectorById(collectorId);
        
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
        
        // Insert collector payment record
        const paymentId = await billingManager.recordCollectorPaymentRecord({
            collector_id: collectorId,
            customer_id: customer_id,
            amount: paymentAmountNum,
            payment_amount: paymentAmountNum,
            commission_amount: commissionAmount,
            payment_method: payment_method,
            notes: notes,
            status: 'completed'
        });
        
        let lastPaymentId = null;

        // Update invoices if specified, else auto-allocate to oldest unpaid invoices
        if (parsedInvoiceIds && parsedInvoiceIds.length > 0) {
            for (const invoiceId of parsedInvoiceIds) {
                // tandai lunas dengan mencatat metode dan tanggal pembayaran
                await billingManager.updateInvoiceStatus(invoiceId, 'paid', payment_method);
                // catat entri payment sesuai nilai invoice dengan collector info
                const inv = await billingManager.getInvoiceById(invoiceId);
                const invAmount = parseFloat(inv?.amount || 0) || 0;
                const newPayment = await billingManager.recordCollectorPayment({
                    invoice_id: invoiceId,
                    amount: invAmount,
                    payment_method,
                    reference_number: '',
                    notes: notes || `Collector ${collectorId}`,
                    collector_id: collectorId,
                    commission_amount: Math.round((invAmount * commissionRate) / 100)
                });
                lastPaymentId = newPayment?.id || lastPaymentId;
            }
        } else {
            // Auto allocate payment to unpaid invoices (oldest first)
            let remaining = paymentAmountNum || 0;
            if (remaining > 0) {
                const invoicesByCustomer = await billingManager.getInvoicesByCustomer(Number(customer_id));
                const unpaidInvoices = (invoicesByCustomer || [])
                    .filter(i => i.status === 'unpaid')
                    .sort((a, b) => new Date(a.due_date || a.id) - new Date(b.due_date || b.id));
                for (const inv of unpaidInvoices) {
                    const invAmount = parseFloat(inv.amount || 0) || 0;
                    if (remaining >= invAmount && invAmount > 0) {
                        await billingManager.updateInvoiceStatus(inv.id, 'paid', payment_method);
                        const newPayment = await billingManager.recordCollectorPayment({
                            invoice_id: inv.id,
                            amount: invAmount,
                            payment_method,
                            reference_number: '',
                            notes: notes || `Collector ${collectorId}`,
                            collector_id: collectorId,
                            commission_amount: Math.round((invAmount * commissionRate) / 100)
                        });
                        lastPaymentId = newPayment?.id || lastPaymentId;
                        remaining -= invAmount;
                        if (remaining <= 0) break;
                    } else {
                        break; // skip partial untuk konsistensi
                    }
                }
            }
        }

        // Kirim notifikasi WhatsApp jika ada payment yang dicatat
        try {
            if (lastPaymentId) {
                await whatsappNotifications.sendPaymentReceivedNotification(lastPaymentId);
            }
        } catch (notificationError) {
            console.error('Error sending payment notification:', notificationError);
            // Jangan gagalkan transaksi karena notifikasi
        }

        // Cek restore layanan jika semua tagihan pelanggan sudah lunas
        // Delay sedikit untuk memastikan database connection sudah ditutup
        setTimeout(async () => {
            try {
                const allInvoices = await billingManager.getInvoicesByCustomer(Number(customer_id));
                const unpaid = (allInvoices || []).filter(i => i.status === 'unpaid');
                if (unpaid.length === 0) {
                    const customer = await billingManager.getCustomerById(Number(customer_id));
                    if (customer && customer.status === 'suspended') {
                        await serviceSuspension.restoreCustomerService(customer);
                    }
                }
            } catch (restoreErr) {
                console.error('Immediate restore check failed:', restoreErr);
            }
        }, 1000); // Delay 1 detik

        res.json({
            success: true,
            message: 'Payment recorded successfully',
            payment_id: paymentId,
            commission_amount: commissionAmount
        });
        
    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({
            success: false,
            message: 'Error recording payment: ' + error.message
        });
    }
});

// Helper function to get app settings
async function getAppSettings() {
    try {
        return {
            companyHeader: getSetting('company_header', 'Sistem Billing'),
            companyName: getSetting('company_name', 'Sistem Billing'),
            footerInfo: getSetting('footer_info', ''),
            logoFilename: getSetting('logo_filename', 'logo.png'),
            company_slogan: getSetting('company_slogan', ''),
            company_website: getSetting('company_website', ''),
            invoice_notes: getSetting('invoice_notes', ''),
            contact_phone: getSetting('contact_phone', ''),
            contact_email: getSetting('contact_email', ''),
            contact_address: getSetting('contact_address', ''),
            contact_whatsapp: getSetting('contact_whatsapp', '')
        };
    } catch (error) {
        console.error('Error getting app settings:', error);
        return {
            companyHeader: 'Sistem Billing',
            companyName: 'Sistem Billing'
        };
    }
}

module.exports = router;
