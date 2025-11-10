const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { getSetting } = require('../config/settingsManager');
const { adminAuth } = require('./adminAuth');
const logger = require('../config/logger');

// Database connection
const dbPath = path.join(__dirname, '../data/billing.db');
const db = new sqlite3.Database(dbPath);

/**
 * GET /admin/technicians - Halaman manajemen teknisi
 */
router.get('/', adminAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        const statusFilter = (req.query.status || '').toLowerCase() === 'all' ? 'all' : 'active';

        // Get technicians with pagination
        const technicians = await new Promise((resolve, reject) => {
            const query = `
                SELECT id, name, phone, role, is_active, created_at, last_login, area_coverage, join_date, whatsapp_group_id
                FROM technicians
                ${statusFilter === 'active' ? 'WHERE is_active = 1' : ''}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            `;
            const params = [limit, offset];
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Get total count
        const totalTechnicians = await new Promise((resolve, reject) => {
            const sql = statusFilter === 'active' 
                ? 'SELECT COUNT(*) as count FROM technicians WHERE is_active = 1'
                : 'SELECT COUNT(*) as count FROM technicians';
            db.get(sql, [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        // Calculate statistics
        const stats = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN role = 'technician' THEN 1 ELSE 0 END) as technician,
                    SUM(CASE WHEN role = 'field_officer' THEN 1 ELSE 0 END) as field_officer,
                    SUM(CASE WHEN role = 'collector' THEN 1 ELSE 0 END) as collector
                FROM technicians
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0] || {});
            });
        });

        const totalPages = Math.ceil(totalTechnicians / limit);

        res.render('admin/technicians', {
            title: 'Kelola Teknisi - Admin Panel',
            page: 'technicians',
            technicians,
            stats,
            pagination: {
                currentPage: page,
                totalPages,
                totalTechnicians,
                hasNext: page < totalPages,
                hasPrev: page > 1
            },
            filterStatus: statusFilter,
            settings: {
                logo_filename: getSetting('logo_filename', 'logo.png'),
                company_header: getSetting('company_header', 'GEMBOK')
            },
            versionInfo: {
                version: '1.0.0',
                buildNumber: '001',
                versionDate: '2024-01-01',
                companyHeader: getSetting('company_header', 'GEMBOK')
            },
            versionBadge: {
                class: 'badge-primary',
                text: 'v1.0.0'
            }
        });

    } catch (error) {
        logger.error('Error loading technicians page:', error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * POST /admin/technicians/add - Tambah teknisi baru
 */
router.post('/add', adminAuth, async (req, res) => {
    try {
        const { name, phone, role, notes, whatsapp_group_id } = req.body;

        // Validasi input
        if (!name || !phone || !role) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nama, nomor telepon, dan role wajib diisi' 
            });
        }

        // Validasi role
        const validRoles = ['technician', 'field_officer', 'collector'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Role tidak valid' 
            });
        }

        // Clean phone number - hanya hapus karakter non-digit, tetap pertahankan format yang dimasukkan user
        let cleanPhone = phone.replace(/\D/g, '');

        // Check if phone already exists
        const existingTechnician = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM technicians WHERE phone = ?', [cleanPhone], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (existingTechnician) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nomor telepon sudah terdaftar' 
            });
        }

        // Insert new technician
        const result = await new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO technicians (name, phone, role, area_coverage, whatsapp_group_id, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `;

            db.run(sql, [name, cleanPhone, role, notes || 'Area Default', whatsapp_group_id || null], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });

        if (result.changes > 0) {
            logger.info(`New technician added: ${name} (${cleanPhone}) with role: ${role}`);
            
            res.json({ 
                success: true, 
                message: 'Teknisi berhasil ditambahkan',
                technician: {
                    id: result.id,
                    name,
                    phone: cleanPhone,
                    role,
                    area_coverage: notes || 'Area Default'
                }
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Gagal menambahkan teknisi' 
            });
        }

    } catch (error) {
        logger.error('Error adding technician:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Terjadi kesalahan server: ' + error.message 
        });
    }
});

/**
 * GET /admin/technicians/:id - Get technician details
 */
router.get('/:id', adminAuth, async (req, res) => {
    try {
        const technicianId = req.params.id;

        const technician = await new Promise((resolve, reject) => {
            db.get('SELECT *, whatsapp_group_id FROM technicians WHERE id = ?', [technicianId], (err, row) => {
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

        res.json({ 
            success: true, 
            technician 
        });

    } catch (error) {
        logger.error('Error getting technician details:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Terjadi kesalahan server' 
        });
    }
});

/**
 * PUT /admin/technicians/:id/update - Update technician
 */
router.put('/:id/update', adminAuth, async (req, res) => {
    try {
        const technicianId = req.params.id;
        const { name, phone, role, notes, whatsapp_group_id } = req.body;

        // Validasi input
        if (!name || !phone || !role) {
            return res.status(400).json({
                success: false,
                message: 'Nama, nomor telepon, dan role wajib diisi'
            });
        }

        // Validasi role
        const validRoles = ['technician', 'field_officer', 'collector'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Role tidak valid' 
            });
        }

        // Clean phone number - hanya hapus karakter non-digit, tetap pertahankan format yang dimasukkan user
        let cleanPhone = phone.replace(/\D/g, '');

        // Check if phone already exists for other technicians
        const existingTechnician = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM technicians WHERE phone = ? AND id != ?', [cleanPhone, technicianId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (existingTechnician) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nomor telepon sudah terdaftar oleh teknisi lain' 
            });
        }

        // Update technician
        const result = await new Promise((resolve, reject) => {
            const sql = `
                UPDATE technicians
                SET name = ?, phone = ?, role = ?, area_coverage = ?, whatsapp_group_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;

            db.run(sql, [name, cleanPhone, role, notes || 'Area Default', whatsapp_group_id || null, technicianId], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });

        if (result.changes > 0) {
            logger.info(`Technician updated: ${name} (${cleanPhone}) with role: ${role}`);
            
            res.json({ 
                success: true, 
                message: 'Teknisi berhasil diperbarui'
            });
        } else {
            res.status(404).json({ 
                success: false, 
                message: 'Teknisi tidak ditemukan' 
            });
        }

    } catch (error) {
        logger.error('Error updating technician:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Terjadi kesalahan server: ' + error.message 
        });
    }
});

/**
 * POST /admin/technicians/:id/toggle-status - Toggle technician active status
 */
router.post('/:id/toggle-status', adminAuth, async (req, res) => {
    try {
        const technicianId = req.params.id;
        const { is_active } = req.body;

        if (typeof is_active !== 'boolean') {
            return res.status(400).json({ 
                success: false, 
                message: 'Status harus berupa boolean' 
            });
        }

        // Update technician status
        const result = await new Promise((resolve, reject) => {
            const sql = `
                UPDATE technicians 
                SET is_active = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            
            db.run(sql, [is_active ? 1 : 0, technicianId], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });

        if (result.changes > 0) {
            const statusText = is_active ? 'diaktifkan' : 'dinonaktifkan';
            logger.info(`Technician ${technicianId} status ${statusText}`);
            
            res.json({ 
                success: true, 
                message: `Teknisi berhasil ${statusText}`,
                is_active: is_active
            });
        } else {
            res.status(404).json({ 
                success: false, 
                message: 'Teknisi tidak ditemukan' 
            });
        }

    } catch (error) {
        logger.error('Error toggling technician status:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Terjadi kesalahan server: ' + error.message 
        });
    }
});

/**
 * POST /admin/technicians/bulk/activate
 * POST /admin/technicians/bulk/deactivate
 * POST /admin/technicians/bulk/delete
 */
router.post('/bulk/activate', adminAuth, async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
        if (ids.length === 0) return res.status(400).json({ success: false, message: 'Tidak ada ID yang dipilih' });

        const placeholders = ids.map(() => '?').join(',');
        const sql = `UPDATE technicians SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`;
        const result = await new Promise((resolve, reject) => {
            db.run(sql, ids, function(err){ if (err) reject(err); else resolve({ changes: this.changes }); });
        });
        return res.json({ success: true, message: `Berhasil mengaktifkan ${result.changes} teknisi` });
    } catch (error) {
        logger.error('Bulk activate technicians error:', error);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
});

router.post('/bulk/deactivate', adminAuth, async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
        if (ids.length === 0) return res.status(400).json({ success: false, message: 'Tidak ada ID yang dipilih' });

        const placeholders = ids.map(() => '?').join(',');
        const sql = `UPDATE technicians SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`;
        const result = await new Promise((resolve, reject) => {
            db.run(sql, ids, function(err){ if (err) reject(err); else resolve({ changes: this.changes }); });
        });
        return res.json({ success: true, message: `Berhasil menonaktifkan ${result.changes} teknisi` });
    } catch (error) {
        logger.error('Bulk deactivate technicians error:', error);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
});

router.post('/bulk/delete', adminAuth, async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
        if (ids.length === 0) return res.status(400).json({ success: false, message: 'Tidak ada ID yang dipilih' });

        // Cek job aktif per teknisi
        const canDelete = [];
        const blocked = [];
        for (const id of ids) {
            const activeJobs = await new Promise((resolve, reject) => {
                db.get(`SELECT COUNT(*) as count FROM installation_jobs WHERE assigned_technician_id = ? AND status IN ('assigned','in_progress')`, [id], (err, row) => {
                    if (err) reject(err); else resolve(row.count);
                });
            });
            if (activeJobs > 0) blocked.push(id); else canDelete.push(id);
        }

        let changes = 0;
        if (canDelete.length) {
            const placeholders = canDelete.map(() => '?').join(',');
            const sql = `UPDATE technicians SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`;
            const result = await new Promise((resolve, reject) => {
                db.run(sql, canDelete, function(err){ if (err) reject(err); else resolve({ changes: this.changes }); });
            });
            changes = result.changes;
        }

        const msgParts = [];
        if (changes) msgParts.push(`dihapus: ${changes}`);
        if (blocked.length) msgParts.push(`gagal (punya job aktif): ${blocked.length}`);
        return res.json({ success: true, message: `Bulk delete selesai (${msgParts.join(', ')})`, deleted: changes, blocked });
    } catch (error) {
        logger.error('Bulk delete technicians error:', error);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
});

/**
 * DELETE /admin/technicians/:id - Delete technician (soft delete)
 */
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        const technicianId = req.params.id;

        // Check if technician has any installation jobs (all statuses)
        const totalJobs = await new Promise((resolve, reject) => {
            db.get(`
                SELECT COUNT(*) as count 
                FROM installation_jobs 
                WHERE assigned_technician_id = ?
            `, [technicianId], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        // Check if technician has active installation jobs
        const activeJobs = await new Promise((resolve, reject) => {
            db.get(`
                SELECT COUNT(*) as count 
                FROM installation_jobs 
                WHERE assigned_technician_id = ? AND status IN ('assigned', 'in_progress')
            `, [technicianId], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        if (activeJobs > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Tidak dapat menghapus teknisi yang memiliki tugas aktif' 
            });
        }

        // If technician has no jobs at all → perform HARD DELETE
        if (totalJobs === 0) {
            const hardResult = await new Promise((resolve, reject) => {
                const delSql = `DELETE FROM technicians WHERE id = ?`;
                db.run(delSql, [technicianId], function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes });
                });
            });

            if (hardResult.changes > 0) {
                logger.info(`Technician ${technicianId} hard deleted (no related jobs)`);
                return res.json({ 
                    success: true, 
                    message: 'Teknisi berhasil dihapus permanen' 
                });
            }
        }

        // Otherwise do SOFT DELETE - set is_active to 0
        const result = await new Promise((resolve, reject) => {
            const sql = `
                UPDATE technicians 
                SET is_active = 0, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            db.run(sql, [technicianId], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });

        if (result.changes > 0) {
            logger.info(`Technician ${technicianId} soft deleted (has historical jobs)`);
            
            res.json({ 
                success: true, 
                message: 'Teknisi berhasil dihapus'
            });
        } else {
            res.status(404).json({ 
                success: false, 
                message: 'Teknisi tidak ditemukan' 
            });
        }

    } catch (error) {
        logger.error('Error deleting technician:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Terjadi kesalahan server: ' + error.message 
        });
    }
});

module.exports = router;
