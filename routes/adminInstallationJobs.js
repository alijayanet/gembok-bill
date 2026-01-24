const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { adminAuth } = require('./adminAuth');
const { getSetting } = require('../config/settingsManager');
const logger = require('../config/logger');

// Database connection
const dbPath = path.join(__dirname, '../data/billing.db');
const db = new sqlite3.Database(dbPath);

// Billing manager untuk akses data packages dan technicians
const billingManager = require('../config/billing');

/**
 * Installation Jobs - Halaman daftar jadwal instalasi
 */
router.get('/', adminAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const status = req.query.status || '';
        const technician = req.query.technician || '';

        // Build query conditions
        let whereConditions = [];
        let params = [];

        if (search) {
            whereConditions.push('(job_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (status && status !== 'all') {
            whereConditions.push('ij.status = ?');
            params.push(status);
        }

        if (technician && technician !== 'all') {
            whereConditions.push('assigned_technician_id = ?');
            params.push(technician);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // Get installation jobs with pagination
        const installationJobs = await new Promise((resolve, reject) => {
            const query = `
                SELECT ij.*, 
                       p.name as package_name,
                       t.name as technician_name
                FROM installation_jobs ij
                LEFT JOIN packages p ON ij.package_id = p.id
                LEFT JOIN technicians t ON ij.assigned_technician_id = t.id
                ${whereClause}
                ORDER BY ij.created_at DESC 
                LIMIT ? OFFSET ?
            `;

            db.all(query, [...params, limit, offset], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Get total count
        const totalJobs = await new Promise((resolve, reject) => {
            const countQuery = `SELECT COUNT(*) as count FROM installation_jobs ij ${whereClause}`;
            db.get(countQuery, params, (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const totalPages = Math.ceil(totalJobs / limit);

        // Get technicians for filter dropdown
        const technicians = await new Promise((resolve, reject) => {
            db.all('SELECT id, name, phone FROM technicians WHERE is_active = 1 ORDER BY name', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Calculate statistics
        const stats = await new Promise((resolve, reject) => {
            db.all(`
                SELECT status, COUNT(*) as count 
                FROM installation_jobs 
                GROUP BY status
            `, (err, rows) => {
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

        res.render('admin/installation-jobs', {
            title: 'Manajemen Jadwal Instalasi',
            installationJobs,
            technicians,
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
            selectedTechnician: technician,
            settings: {
                logo_filename: getSetting('logo_filename', 'logo.png'),
                company_header: getSetting('company_header', 'GEMBOK')
            },
            versionInfo: {
                version: '2.1.2',
                buildNumber: '20251013',
                versionDate: '2025-10-13',
                companyHeader: getSetting('company_header', 'GEMBOK')
            },
            versionBadge: {
                class: 'badge-success',
                text: 'v2.1.2'
            }
        });

    } catch (error) {
        logger.error('Error loading installation jobs:', error);
        res.status(500).send('Internal Server Error: ' + error.message);
    }
});

/**
 * Create New Installation Job - Form page
 */
router.get('/create', adminAuth, async (req, res) => {
    try {
        // Get packages untuk dropdown
        const packages = await billingManager.getPackages();

        // Get technicians untuk assignment
        const technicians = await new Promise((resolve, reject) => {
            db.all('SELECT id, name, phone FROM technicians WHERE is_active = 1 ORDER BY name', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        res.render('admin/installation-job-form', {
            title: 'Buat Jadwal Instalasi Baru',
            packages,
            technicians,
            job: null, // null for create mode
            settings: {
                logo_filename: getSetting('logo_filename', 'logo.png'),
                company_header: getSetting('company_header', 'GEMBOK')
            },
            versionInfo: {
                version: '2.1.2',
                buildNumber: '20251013',
                versionDate: '2025-10-13',
                companyHeader: getSetting('company_header', 'GEMBOK')
            },
            versionBadge: {
                class: 'badge-primary',
                text: 'v2.1.2'
            }
        });

    } catch (error) {
        logger.error('Error loading create installation job form:', error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * Create Installation Job - POST handler
 */
router.post('/create', adminAuth, async (req, res) => {
    try {
        const {
            customer_id,
            customer_name: raw_customer_name,
            customer_phone: raw_customer_phone,
            customer_address: raw_customer_address,
            newCustomerName,
            newCustomerPhone,
            newCustomerAddress,
            package_id, installation_date, installation_time,
            assigned_technician_id, priority, notes, equipment_needed,
            estimated_duration, customer_latitude, customer_longitude
        } = req.body;

        // Ambil data customer: jika customer_id ada, load dari DB; jika tidak, gunakan input baru
        let customer_name = raw_customer_name || newCustomerName;
        let customer_phone = raw_customer_phone || newCustomerPhone;
        let customer_address = raw_customer_address || newCustomerAddress;

        if (customer_id) {
            const existingCustomer = await new Promise((resolve, reject) => {
                db.get('SELECT id, name, phone, address FROM customers WHERE id = ?', [customer_id], (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });
            if (!existingCustomer) {
                return res.status(400).json({ success: false, message: 'Customer tidak ditemukan' });
            }
            customer_name = existingCustomer.name;
            customer_phone = existingCustomer.phone;
            customer_address = existingCustomer.address;
        }

        // Validation minimal: harus ada paket dan salah satu sumber data customer (customer_id atau data baru lengkap)
        if (!package_id || !customer_name || !customer_phone || !customer_address) {
            return res.status(400).json({
                success: false,
                message: 'Paket dan data customer (nama, telepon, alamat) wajib diisi'
            });
        }

        // Generate job number
        const now = new Date();
        const datePrefix = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

        const lastJobNumber = await new Promise((resolve, reject) => {
            db.get(
                'SELECT job_number FROM installation_jobs WHERE job_number LIKE ? ORDER BY job_number DESC LIMIT 1',
                [`INS-${datePrefix}-%`],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.job_number : null);
                }
            );
        });

        let jobCounter = 1;
        if (lastJobNumber) {
            const lastCounter = parseInt(lastJobNumber.split('-').pop());
            jobCounter = lastCounter + 1;
        }

        const jobNumber = `INS-${datePrefix}-${String(jobCounter).padStart(3, '0')}`;

        // Insert installation job
        const jobId = await new Promise((resolve, reject) => {
            const insertQuery = `
                INSERT INTO installation_jobs (
                    job_number, customer_name, customer_phone, customer_address,
                    package_id, installation_date, installation_time, assigned_technician_id,
                    status, priority, notes, equipment_needed, estimated_duration,
                    customer_latitude, customer_longitude, created_by_admin_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const initialStatus = assigned_technician_id ? 'assigned' : 'scheduled';

            // Pastikan installation_date tidak NULL jika kolom NOT NULL di DB
            const today = new Date();
            const defaultDate = today.toISOString().slice(0, 10); // YYYY-MM-DD
            const defaultTime = '00:00';
            const safeInstallationDate = installation_date || defaultDate;
            const safeInstallationTime = installation_time || defaultTime;

            db.run(insertQuery, [
                jobNumber, customer_name, customer_phone, customer_address,
                package_id, safeInstallationDate, safeInstallationTime, assigned_technician_id || null,
                initialStatus, priority || 'normal', notes || null, equipment_needed || null,
                estimated_duration || 120, customer_latitude || null, customer_longitude || null,
                req.session.adminUser || 'admin'
            ], function (err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });

        // Log status history
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO installation_job_status_history (
                    job_id, old_status, new_status, changed_by_type, changed_by_id, notes
                ) VALUES (?, NULL, ?, 'admin', ?, ?)
            `, [jobId, (assigned_technician_id ? 'assigned' : 'scheduled'), req.session.adminUser || 'admin', `Job instalasi dibuat: ${jobNumber}`], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Jika teknisi dipilih saat create, kirim notifikasi WhatsApp ke teknisi
        if (assigned_technician_id) {
            try {
                // Ambil detail job yang baru dibuat (termasuk nama paket)
                const job = await new Promise((resolve, reject) => {
                    db.get(`
                        SELECT ij.*, p.name as package_name, p.price as package_price
                        FROM installation_jobs ij
                        LEFT JOIN packages p ON ij.package_id = p.id
                        WHERE ij.id = ?
                    `, [jobId], (err, row) => {
                        if (err) reject(err); else resolve(row);
                    });
                });

                // Ambil detail teknisi
                const technician = await new Promise((resolve, reject) => {
                    db.get('SELECT id, name, phone, role FROM technicians WHERE id = ? AND is_active = 1', [assigned_technician_id], (err, row) => {
                        if (err) reject(err); else resolve(row);
                    });
                });

                if (technician) {
                    const whatsappNotifications = require('../config/whatsapp-notifications');

                    const customer = {
                        name: customer_name,
                        phone: customer_phone,
                        address: customer_address
                    };
                    const pkg = { name: job.package_name, price: job.package_price };

                    await whatsappNotifications.sendInstallationJobNotification(
                        technician,
                        job,
                        customer,
                        pkg
                    );
                }
            } catch (e) {
                logger.error('Error sending technician notification on create:', e);
            }
        }

        res.json({
            success: true,
            message: 'Jadwal instalasi berhasil dibuat',
            jobNumber,
            jobId
        });

    } catch (error) {
        logger.error('Error creating installation job:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal membuat jadwal instalasi: ' + error.message
        });
    }
});

/**
 * Edit Installation Job - Form page
 */
router.get('/edit/:id', adminAuth, async (req, res) => {
    try {
        const jobId = req.params.id;

        // Get job data
        const job = await new Promise((resolve, reject) => {
            db.get(`
                SELECT ij.*, p.name as package_name, t.name as technician_name
                FROM installation_jobs ij
                LEFT JOIN packages p ON ij.package_id = p.id
                LEFT JOIN technicians t ON ij.assigned_technician_id = t.id
                WHERE ij.id = ?
            `, [jobId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!job) {
            return res.status(404).send('Jadwal instalasi tidak ditemukan');
        }

        // Get packages dan technicians
        const packages = await billingManager.getPackages();
        const technicians = await new Promise((resolve, reject) => {
            db.all('SELECT id, name, phone FROM technicians WHERE is_active = 1 ORDER BY name', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        res.render('admin/installation-job-form', {
            title: `Edit Jadwal Instalasi - ${job.job_number}`,
            packages,
            technicians,
            job, // pass job data for edit mode
            settings: {
                logo_filename: getSetting('logo_filename', 'logo.png'),
                company_header: getSetting('company_header', 'GEMBOK')
            },
            versionInfo: {
                version: '2.1.2',
                buildNumber: '20251013',
                versionDate: '2025-10-13',
                companyHeader: getSetting('company_header', 'GEMBOK')
            },
            versionBadge: {
                class: 'badge-primary',
                text: 'v2.1.2'
            }
        });

    } catch (error) {
        logger.error('Error loading edit installation job form:', error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * Update Installation Job - PUT handler
 */
router.put('/update/:id', adminAuth, async (req, res) => {
    try {
        const jobId = req.params.id;
        const {
            customer_name, customer_phone, customer_address,
            package_id, installation_date, installation_time,
            assigned_technician_id, priority, notes, equipment_needed,
            estimated_duration, customer_latitude, customer_longitude, status
        } = req.body;

        // Get current job data
        const currentJob = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM installation_jobs WHERE id = ?', [jobId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!currentJob) {
            return res.status(404).json({
                success: false,
                message: 'Jadwal instalasi tidak ditemukan'
            });
        }

        // Update installation job
        await new Promise((resolve, reject) => {
            const updateQuery = `
                UPDATE installation_jobs SET
                    customer_name = ?, customer_phone = ?, customer_address = ?,
                    package_id = ?, installation_date = ?, installation_time = ?,
                    assigned_technician_id = ?, priority = ?, notes = ?,
                    equipment_needed = ?, estimated_duration = ?,
                    customer_latitude = ?, customer_longitude = ?, status = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;

            db.run(updateQuery, [
                customer_name, customer_phone, customer_address,
                package_id, installation_date, installation_time,
                assigned_technician_id || null, priority || 'normal', notes || null,
                equipment_needed || null, estimated_duration || 120,
                customer_latitude || null, customer_longitude || null,
                status || currentJob.status, jobId
            ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Log status change if status changed
        if (status && status !== currentJob.status) {
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO installation_job_status_history (
                        job_id, old_status, new_status, changed_by_type, changed_by_id, notes
                    ) VALUES (?, ?, ?, 'admin', ?, ?)
                `, [
                    jobId, currentJob.status, status,
                    req.session.adminUser || 'admin',
                    `Status diubah dari ${currentJob.status} ke ${status}`
                ], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }

        res.json({
            success: true,
            message: 'Jadwal instalasi berhasil diperbarui'
        });

    } catch (error) {
        logger.error('Error updating installation job:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal memperbarui jadwal instalasi: ' + error.message
        });
    }
});

/**
 * Delete Installation Job
 */
router.delete('/delete/:id', adminAuth, async (req, res) => {
    try {
        const jobId = req.params.id;

        // Check if job exists
        const job = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM installation_jobs WHERE id = ?', [jobId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Jadwal instalasi tidak ditemukan'
            });
        }

        // Don't allow deletion of completed jobs
        if (job.status === 'completed') {
            return res.status(400).json({
                success: false,
                message: 'Tidak dapat menghapus jadwal instalasi yang sudah selesai'
            });
        }

        // Delete job (cascading deletes will handle history and equipment)
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM installation_jobs WHERE id = ?', [jobId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        res.json({
            success: true,
            message: 'Jadwal instalasi berhasil dihapus'
        });

    } catch (error) {
        logger.error('Error deleting installation job:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menghapus jadwal instalasi: ' + error.message
        });
    }
});

/**
 * Cancel Installation Job
 */
router.put('/cancel/:id', adminAuth, async (req, res) => {
    try {
        const jobId = req.params.id;
        const reason = req.body?.reason || 'Dibatalkan oleh admin';

        // Get current job data
        const job = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM installation_jobs WHERE id = ?', [jobId], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });

        if (!job) {
            return res.status(404).json({ success: false, message: 'Jadwal instalasi tidak ditemukan' });
        }

        if (job.status === 'cancelled') {
            return res.json({ success: true, message: 'Job sudah dibatalkan sebelumnya' });
        }

        // Update status to cancelled
        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE installation_jobs
                SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [jobId], (err) => { if (err) reject(err); else resolve(); });
        });

        // Log history
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO installation_job_status_history (
                    job_id, old_status, new_status, changed_by_type, changed_by_id, notes
                ) VALUES (?, ?, 'cancelled', 'admin', ?, ?)
            `, [jobId, job.status, req.session.adminUser || 'admin', reason], (err) => {
                if (err) reject(err); else resolve();
            });
        });

        return res.json({ success: true, message: 'Job berhasil dibatalkan' });
    } catch (error) {
        logger.error('Error cancelling installation job:', error);
        return res.status(500).json({ success: false, message: 'Gagal membatalkan job: ' + error.message });
    }
});

/**
 * Start Installation Job
 */
router.put('/start/:id', adminAuth, async (req, res) => {
    try {
        const jobId = req.params.id;

        const job = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM installation_jobs WHERE id = ?', [jobId], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });

        if (!job) return res.status(404).json({ success: false, message: 'Job tidak ditemukan' });
        if (job.status === 'cancelled' || job.status === 'completed') {
            return res.status(400).json({ success: false, message: 'Job tidak dapat dimulai' });
        }

        await new Promise((resolve, reject) => {
            db.run(`UPDATE installation_jobs SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [jobId], (err) => {
                if (err) reject(err); else resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO installation_job_status_history (job_id, old_status, new_status, changed_by_type, changed_by_id, notes)
                VALUES (?, ?, 'in_progress', 'admin', ?, ?)
            `, [jobId, job.status, req.session.adminUser || 'admin', 'Job dimulai'], (err) => {
                if (err) reject(err); else resolve();
            });
        });

        return res.json({ success: true, message: 'Job berhasil dimulai' });
    } catch (error) {
        logger.error('Error starting installation job:', error);
        return res.status(500).json({ success: false, message: 'Gagal memulai job: ' + error.message });
    }
});

/**
 * Complete Installation Job
 */
router.put('/complete/:id', adminAuth, async (req, res) => {
    try {
        const jobId = req.params.id;
        const note = req.body?.note || 'Job ditandai selesai oleh admin';

        const job = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM installation_jobs WHERE id = ?', [jobId], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });

        if (!job) return res.status(404).json({ success: false, message: 'Job tidak ditemukan' });
        if (job.status === 'cancelled') return res.status(400).json({ success: false, message: 'Job sudah dibatalkan' });
        if (job.status === 'completed') return res.json({ success: true, message: 'Job sudah selesai sebelumnya' });
        if (job.status !== 'in_progress' && job.status !== 'assigned') {
            return res.status(400).json({ success: false, message: 'Hanya job yang sedang proses/ditugaskan yang dapat diselesaikan' });
        }

        await new Promise((resolve, reject) => {
            db.run(`UPDATE installation_jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [jobId], (err) => {
                if (err) reject(err); else resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO installation_job_status_history (job_id, old_status, new_status, changed_by_type, changed_by_id, notes)
                VALUES (?, ?, 'completed', 'admin', ?, ?)
            `, [jobId, job.status, req.session.adminUser || 'admin', note], (err) => {
                if (err) reject(err); else resolve();
            });
        });

        return res.json({ success: true, message: 'Job berhasil ditandai selesai' });
    } catch (error) {
        logger.error('Error completing installation job:', error);
        return res.status(500).json({ success: false, message: 'Gagal menandai selesai: ' + error.message });
    }
});

/**
 * Assign Technician to Job
 */
router.post('/assign/:id', adminAuth, async (req, res) => {
    try {
        const jobId = req.params.id;
        const { technician_id } = req.body;

        if (!technician_id) {
            return res.status(400).json({
                success: false,
                message: 'ID teknisi harus diisi'
            });
        }

        // Get current job data
        const currentJob = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM installation_jobs WHERE id = ?', [jobId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!currentJob) {
            return res.status(404).json({
                success: false,
                message: 'Jadwal instalasi tidak ditemukan'
            });
        }

        // Update assignment and status
        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE installation_jobs SET
                    assigned_technician_id = ?,
                    status = CASE 
                        WHEN status = 'scheduled' THEN 'assigned'
                        ELSE status
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [technician_id, jobId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Log assignment
        const newStatus = currentJob.status === 'scheduled' ? 'assigned' : currentJob.status;
        if (newStatus !== currentJob.status) {
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO installation_job_status_history (
                        job_id, old_status, new_status, changed_by_type, changed_by_id, notes
                    ) VALUES (?, ?, ?, 'admin', ?, ?)
                `, [
                    jobId, currentJob.status, newStatus,
                    req.session.adminUser || 'admin',
                    `Teknisi ditugaskan: ID ${technician_id}`
                ], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }

        res.json({
            success: true,
            message: 'Teknisi berhasil ditugaskan'
        });

    } catch (error) {
        logger.error('Error assigning technician to job:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menugaskan teknisi: ' + error.message
        });
    }
});

/**
 * View Job Details Page
 */
router.get('/view/:id', adminAuth, async (req, res) => {
    try {
        const jobId = req.params.id;

        const job = await new Promise((resolve, reject) => {
            db.get(`
                SELECT ij.*, 
                       p.name as package_name, p.price as package_price,
                       t.name as technician_name, t.phone as technician_phone
                FROM installation_jobs ij
                LEFT JOIN packages p ON ij.package_id = p.id
                LEFT JOIN technicians t ON ij.assigned_technician_id = t.id
                WHERE ij.id = ?
            `, [jobId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!job) {
            return res.status(404).render('admin/error', {
                title: 'Job Tidak Ditemukan',
                message: 'Jadwal instalasi yang dicari tidak ditemukan',
                settings: {
                    logo_filename: getSetting('logo_filename', 'logo.png'),
                    company_header: getSetting('company_header', 'GEMBOK')
                },
                versionInfo: {
                    version: '2.1.2',
                    buildNumber: '20251013',
                    versionDate: '2025-10-13',
                    companyHeader: getSetting('company_header', 'GEMBOK')
                },
                versionBadge: {
                    class: 'badge-primary',
                    text: 'v2.1.2'
                }
            });
        }

        // Get status history
        const statusHistory = await new Promise((resolve, reject) => {
            db.all(`
                SELECT * FROM installation_job_status_history 
                WHERE job_id = ? 
                ORDER BY created_at DESC
            `, [jobId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Get available technicians for reassignment
        const technicians = await new Promise((resolve, reject) => {
            db.all('SELECT id, name, phone, role FROM technicians WHERE is_active = 1 ORDER BY name', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        res.render('admin/installation-job-detail', {
            title: 'Detail Job Instalasi',
            job,
            statusHistory,
            technicians,
            settings: {
                logo_filename: getSetting('logo_filename', 'logo.png'),
                company_header: getSetting('company_header', 'GEMBOK')
            },
            versionInfo: {
                version: '2.1.2',
                buildNumber: '20251013',
                versionDate: '2025-10-13',
                companyHeader: getSetting('company_header', 'GEMBOK')
            },
            versionBadge: {
                class: 'badge-primary',
                text: 'v2.1.2'
            }
        });

    } catch (error) {
        logger.error('Error viewing job details:', error);
        res.status(500).render('admin/error', {
            title: 'Error',
            message: 'Terjadi kesalahan saat memuat detail job instalasi',
            settings: {
                logo_filename: getSetting('logo_filename', 'logo.png'),
                company_header: getSetting('company_header', 'GEMBOK')
            },
            versionInfo: {
                version: '2.1.2',
                buildNumber: '20251013',
                versionDate: '2025-10-13',
                companyHeader: getSetting('company_header', 'GEMBOK')
            },
            versionBadge: {
                class: 'badge-primary',
                text: 'v2.1.2'
            }
        });
    }
});

/**
 * Get Job Details for API
 */
router.get('/api/:id', adminAuth, async (req, res) => {
    try {
        const jobId = req.params.id;

        const job = await new Promise((resolve, reject) => {
            db.get(`
                SELECT ij.*, 
                       p.name as package_name, p.price as package_price,
                       t.name as technician_name, t.phone as technician_phone
                FROM installation_jobs ij
                LEFT JOIN packages p ON ij.package_id = p.id
                LEFT JOIN technicians t ON ij.assigned_technician_id = t.id
                WHERE ij.id = ?
            `, [jobId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Jadwal instalasi tidak ditemukan'
            });
        }

        res.json({
            success: true,
            job
        });

    } catch (error) {
        logger.error('Error getting job details:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil detail jadwal instalasi'
        });
    }
});

/**
 * Assign Technician to Installation Job
 */
router.post('/assign-technician', adminAuth, async (req, res) => {
    try {
        const { jobId, technicianId, notes, priority } = req.body;

        if (!jobId || !technicianId) {
            return res.status(400).json({
                success: false,
                message: 'Job ID dan Technician ID diperlukan'
            });
        }

        // Get job details
        const job = await new Promise((resolve, reject) => {
            db.get(`
                SELECT ij.*, 
                       p.name as package_name, p.price as package_price,
                       c.name as customer_name, c.phone as customer_phone, c.address as customer_address
                FROM installation_jobs ij
                LEFT JOIN packages p ON ij.package_id = p.id
                LEFT JOIN customers c ON ij.customer_id = c.id
                WHERE ij.id = ?
            `, [jobId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Job instalasi tidak ditemukan'
            });
        }

        // Get technician details
        const technician = await new Promise((resolve, reject) => {
            db.get('SELECT id, name, phone, role FROM technicians WHERE id = ? AND is_active = 1', [technicianId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!technician) {
            return res.status(404).json({
                success: false,
                message: 'Teknisi tidak ditemukan atau tidak aktif'
            });
        }

        // Update job assignment
        await new Promise((resolve, reject) => {
            const updateQuery = `
                UPDATE installation_jobs 
                SET assigned_technician_id = ?, 
                    status = 'assigned',
                    priority = ?,
                    notes = COALESCE(?, notes),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;

            db.run(updateQuery, [technicianId, priority || 'normal', notes || null, jobId], function (err) {
                if (err) reject(err);
                else resolve(this);
            });
        });

        // Send WhatsApp notification to technician
        try {
            const whatsappNotifications = require('../config/whatsapp-notifications');

            // Prepare customer data
            const customer = {
                name: job.customer_name,
                phone: job.customer_phone,
                address: job.customer_address
            };

            // Prepare package data
            const package = {
                name: job.package_name,
                price: job.package_price
            };

            // Send notification
            const notificationResult = await whatsappNotifications.sendInstallationJobNotification(
                technician,
                job,
                customer,
                package
            );

            if (notificationResult.success) {
                logger.info(`WhatsApp notification sent to technician ${technician.name} for job ${job.job_number}`);
            } else {
                logger.warn(`Failed to send WhatsApp notification to technician ${technician.name}:`, notificationResult.error);
            }

        } catch (notificationError) {
            logger.error('Error sending WhatsApp notification:', notificationError);
            // Don't fail the assignment if notification fails
        }

        res.json({
            success: true,
            message: `Teknisi ${technician.name} berhasil ditugaskan untuk job ${job.job_number}`,
            data: {
                jobId,
                technicianId,
                technicianName: technician.name,
                status: 'assigned',
                priority: priority || 'normal',
                notes: notes || null
            }
        });

    } catch (error) {
        logger.error('Error assigning technician:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menugaskan teknisi: ' + error.message
        });
    }
});

/**
 * Search customers for installation job creation
 */
router.get('/api/search-customers', adminAuth, async (req, res) => {
    try {
        const { q: searchTerm } = req.query;

        if (!searchTerm || searchTerm.length < 2) {
            return res.json({
                success: true,
                customers: [],
                message: 'Minimal 2 karakter untuk pencarian'
            });
        }

        // Search customers in billing database
        const customers = await billingManager.searchCustomers(searchTerm);

        res.json({
            success: true,
            customers: customers || [],
            count: customers ? customers.length : 0
        });

    } catch (error) {
        logger.error('Error searching customers:', error);
        res.status(500).json({
            success: false,
            message: 'Error searching customers',
            error: error.message
        });
    }
});

/**
 * Get customer details by ID
 */
router.get('/api/customer/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const customer = await billingManager.getCustomerById(id);

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer tidak ditemukan'
            });
        }

        res.json({
            success: true,
            customer
        });

    } catch (error) {
        logger.error('Error getting customer details:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting customer details',
            error: error.message
        });
    }
});

module.exports = router;