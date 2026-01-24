const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const MikrotikAPI = require('../config/mikrotik');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');

// Get pricing list
router.get('/api/list', (req, res) => {
    const db = new sqlite3.Database('./data/billing.db');
    
    const sql = 'SELECT * FROM voucher_pricing ORDER BY customer_price ASC';
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching pricing data:', err);
            res.json({ success: false, message: 'Gagal mengambil data harga voucher' });
            return;
        }
        
        res.json(rows || []);
        db.close();
    });
});

// Get hotspot profiles from Mikrotik
router.get('/api/hotspot-profiles', async (req, res) => {
    try {
        const result = await MikrotikAPI.getHotspotProfiles();
        
        if (result.success && result.data) {
            // Transform data to match expected format
            const profiles = result.data.map(profile => ({
                name: profile.name || profile['.id'],
                timeLimit: profile['session-timeout'] || 'Unlimited',
                id: profile['.id']
            }));
            
            res.json({ success: true, profiles: profiles });
        } else {
            res.json({ success: false, message: result.message || 'Gagal mengambil daftar profile hotspot', profiles: [] });
        }
    } catch (error) {
        console.error('Error fetching hotspot profiles:', error);
        res.json({ success: false, message: 'Gagal mengambil daftar profile hotspot', error: error.message, profiles: [] });
    }
});

// Get single pricing
router.get('/api/get/:id', (req, res) => {
    const db = new sqlite3.Database('./data/billing.db');
    const id = req.params.id;
    
    const sql = 'SELECT * FROM voucher_pricing WHERE id = ?';
    db.get(sql, [id], (err, row) => {
        if (err) {
            console.error('Error fetching pricing data:', err);
            res.json({ success: false, message: 'Gagal mengambil data harga voucher' });
            return;
        }
        
        if (!row) {
            res.json({ success: false, message: 'Harga voucher tidak ditemukan' });
            return;
        }
        
        res.json(row);
        db.close();
    });
});

// Create new pricing
router.post('/api/create', (req, res) => {
    const db = new sqlite3.Database('./data/billing.db');
    const { packageName, customerPrice, agentPrice, duration, durationType, accountType, hotspotProfile, description, isActive, voucherDigitType, voucherLength } = req.body;
    
    // Calculate commission automatically (for backward compatibility)
    const commissionAmount = customerPrice - agentPrice;
    
    const sql = `
        INSERT INTO voucher_pricing 
        (package_name, customer_price, agent_price, commission_amount, duration, duration_type, account_type, hotspot_profile, description, is_active, voucher_digit_type, voucher_length)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(sql, [
        packageName, 
        customerPrice, 
        agentPrice, 
        commissionAmount, 
        duration, 
        durationType || 'hours', 
        accountType || 'voucher', 
        hotspotProfile || 'default',
        description, 
        isActive ? 1 : 0, 
        voucherDigitType || 'mixed', 
        voucherLength || 8
    ], function(err) {
        if (err) {
            console.error('Error creating pricing:', err);
            res.json({ success: false, message: 'Gagal membuat harga voucher' });
            return;
        }
        
        res.json({ success: true, id: this.lastID });
        db.close();
    });
});

// Update pricing
router.put('/api/update/:id', (req, res) => {
    const db = new sqlite3.Database('./data/billing.db');
    const id = req.params.id;
    const { packageName, customerPrice, agentPrice, duration, durationType, accountType, hotspotProfile, description, isActive, voucherDigitType, voucherLength } = req.body;
    
    // Calculate commission automatically (for backward compatibility)
    const commissionAmount = customerPrice - agentPrice;
    
    const sql = `
        UPDATE voucher_pricing 
        SET package_name = ?, customer_price = ?, agent_price = ?, commission_amount = ?, 
            duration = ?, duration_type = ?, account_type = ?, hotspot_profile = ?, description = ?, 
            is_active = ?, voucher_digit_type = ?, voucher_length = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `;
    
    db.run(sql, [
        packageName, 
        customerPrice, 
        agentPrice, 
        commissionAmount, 
        duration, 
        durationType || 'hours', 
        accountType || 'voucher', 
        hotspotProfile || 'default',
        description, 
        isActive ? 1 : 0, 
        voucherDigitType || 'mixed', 
        voucherLength || 8, 
        id
    ], function(err) {
        if (err) {
            console.error('Error updating pricing:', err);
            res.json({ success: false, message: 'Gagal mengupdate harga voucher' });
            return;
        }
        
        res.json({ success: true });
        db.close();
    });
});

// Delete pricing
router.delete('/api/delete/:id', (req, res) => {
    const db = new sqlite3.Database('./data/billing.db');
    const id = req.params.id;
    
    const sql = 'DELETE FROM voucher_pricing WHERE id = ?';
    db.run(sql, [id], function(err) {
        if (err) {
            console.error('Error deleting pricing:', err);
            res.json({ success: false, message: 'Gagal menghapus harga voucher' });
            return;
        }
        
        res.json({ success: true });
        db.close();
    });
});

// Main page
router.get('/', (req, res) => {
    res.render('admin/voucher-pricing', {
        page: 'voucher-pricing',
        title: 'Kelola Harga Voucher',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
    });
});

module.exports = router;
