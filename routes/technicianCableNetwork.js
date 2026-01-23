const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('../config/logger');
const { technicianAuth } = require('./technicianAuth');
const { getSetting } = require('../config/settingsManager');
const CableNetworkUtils = require('../utils/cableNetworkUtils');

// Database path
const dbPath = path.join(__dirname, '../data/billing.db');

// Helper function untuk koneksi database
function getDatabase() {
    return new sqlite3.Database(dbPath);
}

// ===== TECHNICIAN CABLE NETWORK API =====

// GET: API untuk data ODP dan Cable Routes untuk technician mapping
router.get('/api/cable-network-data', technicianAuth, async (req, res) => {
    try {
        const db = getDatabase();
        
        // Ambil data ODP
        const odps = await new Promise((resolve, reject) => {
            db.all(`
                SELECT o.*, 
                       COUNT(cr.id) as connected_customers,
                       COUNT(CASE WHEN cr.status = 'connected' THEN 1 END) as active_connections
                FROM odps o
                LEFT JOIN cable_routes cr ON o.id = cr.odp_id
                GROUP BY o.id
                ORDER BY o.name
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Ambil data cable routes dengan detail
        const cableRoutes = await new Promise((resolve, reject) => {
            db.all(`
                SELECT cr.*, 
                       c.name as customer_name, c.phone as customer_phone,
                       c.latitude as customer_latitude, c.longitude as customer_longitude,
                       o.name as odp_name, o.latitude as odp_latitude, o.longitude as odp_longitude
                FROM cable_routes cr
                JOIN customers c ON cr.customer_id = c.id
                JOIN odps o ON cr.odp_id = o.id
                WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Ambil data network segments
        const networkSegments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT ns.*, 
                       o1.name as start_odp_name, o1.latitude as start_latitude, o1.longitude as start_longitude,
                       o2.name as end_odp_name, o2.latitude as end_latitude, o2.longitude as end_longitude
                FROM network_segments ns
                JOIN odps o1 ON ns.start_odp_id = o1.id
                LEFT JOIN odps o2 ON ns.end_odp_id = o2.id
                WHERE ns.status = 'active'
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        db.close();
        
        // Analisis statistik untuk teknisi
        const odpAnalysis = CableNetworkUtils.analyzeODPCapacity(odps);
        const cableAnalysis = CableNetworkUtils.analyzeCableStatus(cableRoutes);
        
        res.json({
            success: true,
            data: {
                odps: odps,
                cableRoutes: cableRoutes,
                networkSegments: networkSegments,
                analysis: {
                    odps: odpAnalysis,
                    cables: cableAnalysis
                },
                technician: {
                    name: req.session.technician_name,
                    phone: req.session.technician_phone
                }
            }
        });
        
    } catch (error) {
        logger.error('Error getting technician cable network data:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data cable network'
        });
    }
});

// GET: API untuk statistik cable network untuk teknisi
router.get('/api/cable-network-stats', technicianAuth, async (req, res) => {
    try {
        const db = getDatabase();
        
        // Statistik ODP
        const odpStats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_odps,
                    SUM(capacity) as total_capacity,
                    SUM(used_ports) as total_used_ports,
                    COUNT(CASE WHEN status = 'active' THEN 1 END) as active_odps,
                    COUNT(CASE WHEN status = 'maintenance' THEN 1 END) as maintenance_odps
                FROM odps
            `, [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        // Statistik Cable Routes
        const cableStats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_cables,
                    SUM(cable_length) as total_length,
                    COUNT(CASE WHEN status = 'connected' THEN 1 END) as connected_cables,
                    COUNT(CASE WHEN status = 'disconnected' THEN 1 END) as disconnected_cables,
                    COUNT(CASE WHEN status = 'maintenance' THEN 1 END) as maintenance_cables,
                    COUNT(CASE WHEN status = 'damaged' THEN 1 END) as damaged_cables
                FROM cable_routes
            `, [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            data: {
                odps: odpStats,
                cables: cableStats,
                utilization: odpStats.total_capacity > 0 ? 
                    (odpStats.total_used_ports / odpStats.total_capacity) * 100 : 0
            }
        });
        
    } catch (error) {
        logger.error('Error getting technician cable network stats:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil statistik cable network'
        });
    }
});

// GET: API untuk detail ODP untuk teknisi
router.get('/api/odp/:id', technicianAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();
        
        // Ambil detail ODP
        const odp = await new Promise((resolve, reject) => {
            db.get(`
                SELECT o.*, 
                       COUNT(CASE WHEN cr.customer_id IS NOT NULL THEN cr.id END) as connected_customers,
                       COUNT(CASE WHEN cr.status = 'connected' AND cr.customer_id IS NOT NULL THEN 1 END) as active_connections
                FROM odps o
                LEFT JOIN cable_routes cr ON o.id = cr.odp_id
                WHERE o.id = ?
                GROUP BY o.id
            `, [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!odp) {
            db.close();
            return res.status(404).json({
                success: false,
                message: 'ODP tidak ditemukan'
            });
        }
        
        // Ambil cable routes yang terhubung ke ODP ini (hanya yang memiliki customer)
        const cableRoutes = await new Promise((resolve, reject) => {
            db.all(`
                SELECT cr.*, 
                       c.name as customer_name, c.phone as customer_phone,
                       c.latitude as customer_latitude, c.longitude as customer_longitude
                FROM cable_routes cr
                JOIN customers c ON cr.customer_id = c.id
                WHERE cr.odp_id = ? AND cr.customer_id IS NOT NULL
                ORDER BY cr.status, c.name
            `, [id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            data: {
                odp: odp,
                cableRoutes: cableRoutes
            }
        });
        
    } catch (error) {
        logger.error('Error getting ODP details for technician:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil detail ODP'
        });
    }
});

// GET: API untuk search ODP untuk teknisi
router.get('/api/search-odp', technicianAuth, async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q || q.length < 2) {
            return res.json({
                success: true,
                data: []
            });
        }
        
        const db = getDatabase();
        
        const odps = await new Promise((resolve, reject) => {
            db.all(`
                SELECT o.*, 
                       COUNT(cr.id) as connected_customers
                FROM odps o
                LEFT JOIN cable_routes cr ON o.id = cr.odp_id
                WHERE o.name LIKE ? OR o.code LIKE ? OR o.address LIKE ?
                GROUP BY o.id
                ORDER BY o.name
                LIMIT 10
            `, [`%${q}%`, `%${q}%`, `%${q}%`], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            data: odps
        });
        
    } catch (error) {
        logger.error('Error searching ODP for technician:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mencari ODP'
        });
    }
});

// GET: API untuk cable routes berdasarkan status untuk teknisi
router.get('/api/cable-routes-by-status', technicianAuth, async (req, res) => {
    try {
        const { status } = req.query;
        
        const db = getDatabase();
        
        let query = `
            SELECT cr.*, 
                   c.name as customer_name, c.phone as customer_phone,
                   c.latitude as customer_latitude, c.longitude as customer_longitude,
                   o.name as odp_name, o.latitude as odp_latitude, o.longitude as odp_longitude
            FROM cable_routes cr
            JOIN customers c ON cr.customer_id = c.id
            JOIN odps o ON cr.odp_id = o.id
            WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        `;
        
        const params = [];
        
        if (status && status !== 'all') {
            query += ' AND cr.status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY cr.status, c.name';
        
        const cableRoutes = await new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            data: cableRoutes
        });
        
    } catch (error) {
        logger.error('Error getting cable routes by status for technician:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil cable routes'
        });
    }
});

// GET: API untuk maintenance log untuk teknisi
router.get('/api/maintenance-log', technicianAuth, async (req, res) => {
    try {
        const db = getDatabase();
        
        const maintenanceLogs = await new Promise((resolve, reject) => {
            db.all(`
                SELECT ml.*, 
                       cr.id as cable_route_id,
                       c.name as customer_name,
                       o.name as odp_name,
                       t.name as technician_name
                FROM cable_maintenance_logs ml
                LEFT JOIN cable_routes cr ON ml.cable_route_id = cr.id
                LEFT JOIN customers c ON cr.customer_id = c.id
                LEFT JOIN odps o ON cr.odp_id = o.id
                LEFT JOIN technicians t ON ml.performed_by = t.id
                ORDER BY ml.maintenance_date DESC, ml.created_at DESC
                LIMIT 50
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            data: maintenanceLogs
        });
        
    } catch (error) {
        logger.error('Error getting maintenance log for technician:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil maintenance log'
        });
    }
});

// ===== ODP CRUD OPERATIONS FOR TECHNICIANS =====

// POST: Create new ODP
router.post('/api/odp', technicianAuth, async (req, res) => {
    try {
        const { name, code, latitude, longitude, address, capacity, notes, status } = req.body;
        
        if (!name || !code || !latitude || !longitude) {
            return res.status(400).json({
                success: false,
                message: 'Nama, kode, latitude, dan longitude harus diisi'
            });
        }
        
        const db = getDatabase();
        
        const result = await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO odps (name, code, latitude, longitude, address, capacity, notes, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `, [name, code, latitude, longitude, address, capacity || 16, notes || '', status || 'active'], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            message: 'ODP berhasil ditambahkan',
            data: result
        });
        
    } catch (error) {
        logger.error('Error creating ODP for technician:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menambahkan ODP'
        });
    }
});

// PUT: Update ODP
router.put('/api/odp/:id', technicianAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, code, latitude, longitude, address, capacity, notes, status } = req.body;
        
        if (!name || !code || !latitude || !longitude) {
            return res.status(400).json({
                success: false,
                message: 'Nama, kode, latitude, dan longitude harus diisi'
            });
        }
        
        const db = getDatabase();
        
        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE odps 
                SET name = ?, code = ?, latitude = ?, longitude = ?, address = ?, 
                    capacity = ?, notes = ?, status = ?, updated_at = datetime('now')
                WHERE id = ?
            `, [name, code, latitude, longitude, address, capacity, notes, status, id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            message: 'ODP berhasil diupdate'
        });
        
    } catch (error) {
        logger.error('Error updating ODP for technician:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengupdate ODP'
        });
    }
});

// DELETE: Delete ODP
router.delete('/api/odp/:id', technicianAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const db = getDatabase();
        
        // Check if ODP has connected customers
        const odp = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM cable_routes WHERE odp_id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (odp.count > 0) {
            db.close();
            return res.status(400).json({
                success: false,
                message: 'Tidak dapat menghapus ODP yang masih memiliki koneksi kabel'
            });
        }
        
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM odps WHERE id = ?', [id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            message: 'ODP berhasil dihapus'
        });
        
    } catch (error) {
        logger.error('Error deleting ODP for technician:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menghapus ODP'
        });
    }
});

// GET: Render ODP management page
router.get('/odp', technicianAuth, async (req, res) => {
    try {
        const technician = req.technician || {};
        res.render('technician/odp', { 
            technician: technician,
            page: 'odp'
        });
    } catch (error) {
        logger.error('Error rendering ODP page:', error);
        res.status(500).send('Gagal memuat halaman ODP');
    }
});

module.exports = router;
