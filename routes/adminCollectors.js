/**
 * Admin Collectors Management Routes
 * Routes untuk admin mengelola tukang tagih
 */

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const { getSetting } = require('../config/settingsManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');
const { adminAuth } = require('./adminAuth');

// List collectors
router.get('/', adminAuth, async (req, res) => {
    try {
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Get collectors with statistics
        const collectors = await new Promise((resolve, reject) => {
            db.all(`
                SELECT c.*, 
                       COUNT(cp.id) as total_payments,
                       COALESCE(SUM(cp.commission_amount), 0) as total_commission
                FROM collectors c
                LEFT JOIN collector_payments cp ON c.id = cp.collector_id 
                    AND cp.status = 'completed'
                GROUP BY c.id
                ORDER BY c.name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        const appSettings = await getAppSettings();
        
        db.close();
        
        res.render('admin/collectors', {
            title: 'Kelola Tukang Tagih',
            appSettings,
            collectors: collectors,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
        
    } catch (error) {
        console.error('Error loading collectors:', error);
        res.status(500).render('error', { 
            message: 'Error loading collectors',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Add collector form
router.get('/add', adminAuth, async (req, res) => {
    try {
        const appSettings = await getAppSettings();
        
        res.render('admin/collector-form', {
            title: 'Tambah Tukang Tagih',
            appSettings: appSettings,
            collector: null,
            action: 'add',
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
        
    } catch (error) {
        console.error('Error loading add collector form:', error);
        res.status(500).render('error', { 
            message: 'Error loading form',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Edit collector form
router.get('/:id/edit', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        const collector = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM collectors WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!collector) {
            db.close();
            return res.status(404).render('error', { 
                message: 'Tukang tagih tidak ditemukan'
            });
        }
        
        const appSettings = await getAppSettings();
        
        db.close();
        
        res.render('admin/collector-form', {
            title: 'Edit Tukang Tagih',
            appSettings: appSettings,
            collector: collector,
            action: 'edit',
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
        
    } catch (error) {
        console.error('Error loading edit collector form:', error);
        res.status(500).render('error', { 
            message: 'Error loading form',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Create collector
router.post('/', adminAuth, async (req, res) => {
    try {
        const { name, phone, email, address, commission_rate, status, password } = req.body;
        
        if (!name || !phone) {
            return res.status(400).json({
                success: false,
                message: 'Nama dan nomor telepon harus diisi'
            });
        }
        
        if (!password || password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password minimal 6 karakter'
            });
        }
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Check if phone already exists
        const existingCollector = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM collectors WHERE phone = ?', [phone], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (existingCollector) {
            db.close();
            return res.status(400).json({
                success: false,
                message: 'Nomor telepon sudah digunakan'
            });
        }
        
        // Hash password
        const hashedPassword = bcrypt.hashSync(password, 10);
        
        // Insert new collector
        const collectorId = await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO collectors (name, phone, email, address, commission_rate, status, password)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [name, phone, email, address, commission_rate || 5, status || 'active', hashedPassword], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            message: 'Tukang tagih berhasil ditambahkan',
            collector_id: collectorId
        });
        
    } catch (error) {
        console.error('Error creating collector:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating collector: ' + error.message
        });
    }
});

// Update collector
router.put('/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, email, address, commission_rate, status, password } = req.body;
        
        if (!name || !phone) {
            return res.status(400).json({
                success: false,
                message: 'Nama dan nomor telepon harus diisi'
            });
        }
        
        if (password && password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password minimal 6 karakter'
            });
        }
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Check if phone already exists (excluding current collector)
        const existingCollector = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM collectors WHERE phone = ? AND id != ?', [phone, id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (existingCollector) {
            db.close();
            return res.status(400).json({
                success: false,
                message: 'Nomor telepon sudah digunakan'
            });
        }
        
        // Prepare update data
        let updateQuery, updateParams;
        
        if (password) {
            // Update with password
            const hashedPassword = bcrypt.hashSync(password, 10);
            updateQuery = `
                UPDATE collectors 
                SET name = ?, phone = ?, email = ?, address = ?, commission_rate = ?, status = ?, password = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            updateParams = [name, phone, email, address, commission_rate, status, hashedPassword, id];
        } else {
            // Update without password
            updateQuery = `
                UPDATE collectors 
                SET name = ?, phone = ?, email = ?, address = ?, commission_rate = ?, status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            updateParams = [name, phone, email, address, commission_rate, status, id];
        }
        
        // Update collector
        await new Promise((resolve, reject) => {
            db.run(updateQuery, updateParams, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            message: 'Tukang tagih berhasil diperbarui'
        });
        
    } catch (error) {
        console.error('Error updating collector:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating collector: ' + error.message
        });
    }
});

// Delete collector
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Check if collector has payments
        const paymentCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM collector_payments WHERE collector_id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        
        if (paymentCount > 0) {
            db.close();
            return res.status(400).json({
                success: false,
                message: 'Tidak dapat menghapus tukang tagih yang sudah memiliki riwayat pembayaran'
            });
        }
        
        // Delete collector
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM collectors WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            message: 'Tukang tagih berhasil dihapus'
        });
        
    } catch (error) {
        console.error('Error deleting collector:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting collector: ' + error.message
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
