const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const multer = require('multer');
const { getSettingsWithCache } = require('../config/settingsManager')
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');
const logger = require('../config/logger');
const { spawn } = require('child_process');

// Konfigurasi penyimpanan file
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../public/img'));
    },
    filename: function (req, file, cb) {
        // Selalu gunakan nama 'logo' dengan ekstensi file asli
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, 'logo' + ext);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB
    },
    fileFilter: function (req, file, cb) {
        // Hanya izinkan file gambar dan SVG
        if (file.mimetype.startsWith('image/') || file.originalname.toLowerCase().endsWith('.svg')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diizinkan'), false);
        }
    }
});

const settingsPath = path.join(__dirname, '../settings.json');

// GET: Render halaman Setting
router.get('/', (req, res) => {
    const settings = getSettingsWithCache();
    res.render('adminSetting', { settings });
});

// GET: Ambil semua setting
router.get('/data', (req, res) => {
    fs.readFile(settingsPath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Gagal membaca settings.json' });
        try {
            const json = JSON.parse(data);
            // Ensure Tripay base_url field exists so it appears in the admin form
            try {
                json.payment_gateway = json.payment_gateway || {};
                json.payment_gateway.tripay = json.payment_gateway.tripay || {};
                if (typeof json.payment_gateway.tripay.base_url === 'undefined') {
                    json.payment_gateway.tripay.base_url = '';
                }
            } catch (_) {}
            res.json(json);
        } catch (e) {
            res.status(500).json({ error: 'Format settings.json tidak valid' });
        }
    });
});

// GET: Securely serve Donation QR image from config with fallback to public
router.get('/donation-qr', (req, res) => {
    try {
        const configPath = path.join(__dirname, '../config/qr-donasi.jpg');
        const publicPath = path.join(__dirname, '../public/img/qr-donasi.jpg');
        const filePath = fs.existsSync(configPath) ? configPath : publicPath;

        if (!fs.existsSync(filePath)) {
            return res.status(404).send('QR image not found');
        }

        // Simple content-type based on extension (jpg)
        res.setHeader('Cache-Control', 'no-cache');
        res.type('jpg');
        fs.createReadStream(filePath).pipe(res);
    } catch (e) {
        logger.error('Error serving donation QR:', e);
        res.status(500).send('Failed to load QR image');
    }
});

// POST: Simpan perubahan setting
router.post('/save', (req, res) => {
    try {
        const newSettings = req.body;
        
        // Validasi input
        if (!newSettings || typeof newSettings !== 'object') {
            return res.status(400).json({ 
                success: false, 
                error: 'Data pengaturan tidak valid' 
            });
        }

        // Baca settings lama
        let oldSettings = {};
        try {
            oldSettings = getSettingsWithCache();
        } catch (e) {
            console.warn('Gagal membaca settings.json lama, menggunakan default:', e.message);
            // Jika file tidak ada atau corrupt, gunakan default
            oldSettings = {
                user_auth_mode: 'mikrotik',
                logo_filename: 'logo.png'
            };
        }

        // Merge: field baru overwrite field lama, field lama yang tidak ada di form tetap dipertahankan
        const mergedSettings = { ...oldSettings, ...newSettings };
        
        // Pastikan user_auth_mode selalu ada
        if (!('user_auth_mode' in mergedSettings)) {
            mergedSettings.user_auth_mode = 'mikrotik';
        }

        // Validasi dan sanitasi data sebelum simpan
        const sanitizedSettings = {};
        for (const [key, value] of Object.entries(mergedSettings)) {
            // Skip field yang tidak valid
            if (key === null || key === undefined || key === '') {
                continue;
            }
            
            // Konversi boolean string ke boolean
            if (typeof value === 'string') {
                if (value === 'true') {
                    sanitizedSettings[key] = true;
                } else if (value === 'false') {
                    sanitizedSettings[key] = false;
                } else {
                    sanitizedSettings[key] = value;
                }
            } else {
                sanitizedSettings[key] = value;
            }
        }

        // Tulis ke file dengan error handling yang proper
        fs.writeFile(settingsPath, JSON.stringify(sanitizedSettings, null, 2), 'utf8', (err) => {
            if (err) {
                console.error('Error menyimpan settings.json:', err);
                return res.status(500).json({ 
                    success: false,
                    message: 'Gagal menyimpan pengaturan'
                });
            }

            // Log perubahan setting
            const missing = [];
            if (!sanitizedSettings.server_port) missing.push('server_port');
            if (!sanitizedSettings.server_host) missing.push('server_host');

            // Hot-reload payment gateways so changes apply without restart
            let reloadInfo = null;
            try {
                const billingManager = require('../config/billing');
                reloadInfo = billingManager.reloadPaymentGateway();
            } catch (e) {
                logger.warn('Gagal reload payment gateway setelah simpan settings:', e.message);
            }

            // Clear hasil validasi konfigurasi lama dari session
            // Ini akan memaksa validasi ulang saat admin kembali ke dashboard
            if (req.session.configValidation) {
                console.log('🔄 [SETTINGS] Clearing old config validation results...');
                delete req.session.configValidation;
            }

            res.json({ 
                success: true, 
                message: 'Pengaturan berhasil disimpan! Hasil validasi konfigurasi akan di-update saat kembali ke dashboard.',
                missingFields: missing 
            });
        });

    } catch (error) {
        console.error('Error dalam route /save:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Terjadi kesalahan saat menyimpan pengaturan: ' + error.message 
        });
    }
});

// POST: Save Interval Settings
router.post('/save-intervals', (req, res) => {
    try {
        const intervalData = req.body;
        
        // Validasi input
        if (!intervalData || typeof intervalData !== 'object') {
            return res.status(400).json({ 
                success: false, 
                error: 'Data interval tidak valid' 
            });
        }

        // Validasi field yang diperlukan
        const requiredFields = [
            'rx_power_warning_interval_hours',
            'rxpower_recap_interval_hours',
            'offline_notification_interval_hours'
        ];

        for (const field of requiredFields) {
            if (!intervalData[field]) {
                return res.status(400).json({ 
                    success: false, 
                    error: `Field ${field} harus diisi` 
                });
            }
        }

        // Validasi nilai jam
        const hoursFields = [
            'rx_power_warning_interval_hours',
            'rxpower_recap_interval_hours',
            'offline_notification_interval_hours'
        ];

        for (const field of hoursFields) {
            const value = parseInt(intervalData[field]);
            if (isNaN(value) || value < 1 || value > 168) { // 1 jam - 7 hari
                return res.status(400).json({ 
                    success: false, 
                    error: `${field} harus berupa nilai jam valid (1-168 jam)` 
                });
            }
        }

        // Konversi jam ke millisecond
        const rxPowerWarningMs = parseInt(intervalData.rx_power_warning_interval_hours) * 60 * 60 * 1000;
        const rxPowerRecapMs = parseInt(intervalData.rxpower_recap_interval_hours) * 60 * 60 * 1000;
        const offlineNotifMs = parseInt(intervalData.offline_notification_interval_hours) * 60 * 60 * 1000;

        // Update intervalData dengan nilai millisecond
        intervalData.rx_power_warning_interval = rxPowerWarningMs.toString();
        intervalData.rxpower_recap_interval = rxPowerRecapMs.toString();
        intervalData.offline_notification_interval = offlineNotifMs.toString();

        // Baca settings lama
        let oldSettings = {};
        try {
            oldSettings = getSettingsWithCache();
        } catch (e) {
            console.warn('Gagal membaca settings.json lama, menggunakan default:', e.message);
            oldSettings = {};
        }

        // Merge dengan settings lama
        const mergedSettings = { ...oldSettings, ...intervalData };
        
        // Tulis ke file
        fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
        
        // Log perubahan
        logger.info('Interval settings updated via web interface', {
            rx_power_warning_interval_hours: intervalData.rx_power_warning_interval_hours,
            rxpower_recap_interval_hours: intervalData.rxpower_recap_interval_hours,
            offline_notification_interval_hours: intervalData.offline_notification_interval_hours
        });

        // Restart interval monitoring dengan pengaturan baru
        try {
            const intervalManager = require('../config/intervalManager');
            intervalManager.restartAll();
            logger.info('All monitoring intervals restarted with new settings');
        } catch (error) {
            logger.error('Error restarting intervals:', error.message);
            // Tidak menghentikan response karena settings sudah tersimpan
        }

        res.json({ 
            success: true, 
            message: 'Pengaturan interval berhasil disimpan dan diterapkan tanpa restart aplikasi',
            data: {
                rx_power_warning_interval_hours: intervalData.rx_power_warning_interval_hours,
                rxpower_recap_interval_hours: intervalData.rxpower_recap_interval_hours,
                offline_notification_interval_hours: intervalData.offline_notification_interval_hours
            }
        });

    } catch (error) {
        console.error('Error dalam route /save-intervals:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Terjadi kesalahan saat menyimpan pengaturan interval: ' + error.message 
        });
    }
});

// GET: Get interval status
router.get('/interval-status', (req, res) => {
    try {
        const intervalManager = require('../config/intervalManager');
        const status = intervalManager.getStatus();
        const settings = intervalManager.getCurrentSettings();
        
        res.json({
            success: true,
            status: status,
            settings: settings
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error getting interval status: ' + error.message
        });
    }
});

// POST: Upload Logo
router.post('/upload-logo', upload.single('logo'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                error: 'Tidak ada file yang diupload' 
            });
        }

        // Dapatkan nama file yang sudah disimpan (akan selalu 'logo' + ekstensi)
        const filename = req.file.filename;
        const filePath = req.file.path;

        // Verifikasi file berhasil disimpan
        if (!fs.existsSync(filePath)) {
            return res.status(500).json({ 
                success: false, 
                error: 'File gagal disimpan' 
            });
        }

        // Baca settings.json
        let settings = {};
        
        try {
            settings = getSettingsWithCache();
        } catch (err) {
            console.error('Gagal membaca settings.json:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'Gagal membaca pengaturan' 
            });
        }

        // Hapus file logo lama jika ada
        if (settings.logo_filename && settings.logo_filename !== filename) {
            const oldLogoPath = path.join(__dirname, '../public/img', settings.logo_filename);
            if (fs.existsSync(oldLogoPath)) {
                try {
                    fs.unlinkSync(oldLogoPath);
                    console.log('Logo lama dihapus:', oldLogoPath);
                } catch (err) {
                    console.error('Gagal menghapus logo lama:', err);
                    // Lanjutkan meskipun gagal hapus file lama
                }
            }
        }

        // Update settings.json
        settings.logo_filename = filename;
        
        try {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            console.log('Settings.json berhasil diupdate dengan logo baru:', filename);
        } catch (err) {
            console.error('Gagal menyimpan settings.json:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'Gagal menyimpan pengaturan' 
            });
        }

        res.json({ 
            success: true, 
            filename: filename,
            message: 'Logo berhasil diupload dan disimpan'
        });

    } catch (error) {
        console.error('Error saat upload logo:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Terjadi kesalahan saat mengupload logo: ' + error.message 
        });
    }
});

// Error handler untuk multer
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
                success: false, 
                error: 'Ukuran file terlalu besar. Maksimal 2MB.' 
            });
        }
        return res.status(400).json({ 
            success: false, 
            error: 'Error upload file: ' + error.message 
        });
    }
    
    if (error) {
        return res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
    
    next();
});

// GET: Status WhatsApp
router.get('/wa-status', async (req, res) => {
    try {
        const { getWhatsAppStatus } = require('../config/whatsapp');
        const status = getWhatsAppStatus();
        
        // Pastikan QR code dalam format yang benar
        let qrCode = null;
        if (status.qrCode) {
            qrCode = status.qrCode;
        } else if (status.qr) {
            qrCode = status.qr;
        }
        
        res.json({
            connected: status.connected || false,
            qr: qrCode,
            phoneNumber: status.phoneNumber || null,
            status: status.status || 'disconnected',
            connectedSince: status.connectedSince || null
        });
    } catch (e) {
        console.error('Error getting WhatsApp status:', e);
        res.status(500).json({ 
            connected: false, 
            qr: null, 
            error: e.message 
        });
    }
});

// POST: Refresh QR WhatsApp
router.post('/wa-refresh', async (req, res) => {
    try {
        const { deleteWhatsAppSession } = require('../config/whatsapp');
        await deleteWhatsAppSession();
        
        // Tunggu sebentar sebelum memeriksa status baru
        setTimeout(() => {
            res.json({ success: true, message: 'Sesi WhatsApp telah direset. Silakan pindai QR code baru.' });
        }, 1000);
    } catch (e) {
        console.error('Error refreshing WhatsApp session:', e);
        res.status(500).json({ 
            success: false, 
            error: e.message 
        });
    }
});

// POST: Hapus sesi WhatsApp
router.post('/wa-delete', async (req, res) => {
    try {
        const { deleteWhatsAppSession } = require('../config/whatsapp');
        await deleteWhatsAppSession();
        res.json({ 
            success: true, 
            message: 'Sesi WhatsApp telah dihapus. Silakan pindai QR code baru untuk terhubung kembali.' 
        });
    } catch (e) {
        console.error('Error deleting WhatsApp session:', e);
        res.status(500).json({ 
            success: false, 
            error: e.message 
        });
    }
});

// Backup database
router.post('/backup', async (req, res) => {
    try {
        const dbPath = path.join(__dirname, '../data/billing.db');
        const backupPath = path.join(__dirname, '../data/backup');
        
        // Buat direktori backup jika belum ada
        if (!fs.existsSync(backupPath)) {
            fs.mkdirSync(backupPath, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(backupPath, `billing_backup_${timestamp}.db`);
        
        // Copy database file
        fs.copyFileSync(dbPath, backupFile);
        
        logger.info(`Database backup created: ${backupFile}`);
        
        res.json({
            success: true,
            message: 'Database backup berhasil dibuat',
            backup_file: path.basename(backupFile)
        });
    } catch (error) {
        logger.error('Error creating backup:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating backup',
            error: error.message
        });
    }
});

// Restore database
router.post('/restore', upload.single('backup_file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'File backup tidak ditemukan'
            });
        }
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        const backupPath = path.join(__dirname, '../data/backup', req.file.filename);
        
        // Backup database saat ini sebelum restore
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const currentBackup = path.join(__dirname, '../data/backup', `pre_restore_${timestamp}.db`);
        fs.copyFileSync(dbPath, currentBackup);
        
        // Restore database
        fs.copyFileSync(backupPath, dbPath);
        
        logger.info(`Database restored from: ${req.file.filename}`);
        
        res.json({
            success: true,
            message: 'Database berhasil di-restore',
            restored_file: req.file.filename
        });
    } catch (error) {
        logger.error('Error restoring database:', error);
        res.status(500).json({
            success: false,
            message: 'Error restoring database',
            error: error.message
        });
    }
});

// Get backup files list
router.get('/backups', async (req, res) => {
    try {
        const backupPath = path.join(__dirname, '../data/backup');
        
        if (!fs.existsSync(backupPath)) {
            return res.json({
                success: true,
                backups: []
            });
        }
        
        const files = fs.readdirSync(backupPath)
            .filter(file => file.endsWith('.db'))
            .map(file => {
                const filePath = path.join(backupPath, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    size: stats.size,
                    created: stats.birthtime
                };
            })
            .sort((a, b) => new Date(b.created) - new Date(a.created));
        
        res.json({
            success: true,
            backups: files
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error getting backup files',
            error: error.message
        });
    }
});

// Get activity logs - Temporarily disabled due to logger refactoring
router.get('/activity-logs', async (req, res) => {
    res.status(501).json({
        success: false,
        message: 'Activity logs feature temporarily disabled'
    });
});

// Clear old activity logs - Temporarily disabled due to logger refactoring
router.post('/clear-logs', async (req, res) => {
    res.status(501).json({
        success: false,
        message: 'Clear logs feature temporarily disabled'
    });
});

// GET: Test endpoint untuk upload logo (tanpa auth)
router.get('/test-upload', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Test Upload Logo</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .form-group { margin: 10px 0; }
                input[type="file"] { margin: 10px 0; }
                button { padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; }
                .result { margin: 10px 0; padding: 10px; border-radius: 5px; }
                .success { background: #d4edda; color: #155724; }
                .error { background: #f8d7da; color: #721c24; }
            </style>
        </head>
        <body>
            <h2>Test Upload Logo</h2>
            <form id="uploadForm" enctype="multipart/form-data">
                <div class="form-group">
                    <label>Pilih file logo:</label><br>
                    <input type="file" name="logo" accept="image/*,.svg" required>
                </div>
                <button type="submit">Upload Logo</button>
            </form>
            <div id="result"></div>
            
            <script>
                document.getElementById('uploadForm').addEventListener('submit', function(e) {
                    e.preventDefault();
                    
                    const formData = new FormData(this);
                    const resultDiv = document.getElementById('result');
                    
                    fetch('/admin/settings/upload-logo', {
                        method: 'POST',
                        body: formData
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            resultDiv.innerHTML = '<div class="result success">✓ ' + data.message + '</div>';
                        } else {
                            resultDiv.innerHTML = '<div class="result error">✗ ' + data.error + '</div>';
                        }
                    })
                    .catch(error => {
                        resultDiv.innerHTML = '<div class="result error">✗ Error: ' + error.message + '</div>';
                    });
                });
            </script>
        </body>
        </html>
    `);
});

// GET: Test endpoint untuk upload SVG (tanpa auth)
router.get('/test-svg', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const testHtmlPath = path.join(__dirname, '../test-svg-upload.html');
    
    if (fs.existsSync(testHtmlPath)) {
        res.sendFile(testHtmlPath);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Test SVG Upload</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .form-group { margin: 10px 0; }
                    input[type="file"] { margin: 10px 0; }
                    button { padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; }
                    .result { margin: 10px 0; padding: 10px; border-radius: 5px; }
                    .success { background: #d4edda; color: #155724; }
                    .error { background: #f8d7da; color: #721c24; }
                </style>
            </head>
            <body>
                <h2>Test SVG Upload</h2>
                <form id="uploadForm" enctype="multipart/form-data">
                    <div class="form-group">
                        <label>Pilih file SVG:</label><br>
                        <input type="file" name="logo" accept=".svg" required>
                    </div>
                    <button type="submit">Upload SVG Logo</button>
                </form>
                <div id="result"></div>
                
                <script>
                    document.getElementById('uploadForm').addEventListener('submit', function(e) {
                        e.preventDefault();
                        
                        const formData = new FormData(this);
                        const resultDiv = document.getElementById('result');
                        
                        fetch('/admin/settings/upload-logo', {
                            method: 'POST',
                            body: formData
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                resultDiv.innerHTML = '<div class="result success">✓ ' + data.message + '</div>';
                            } else {
                                resultDiv.innerHTML = '<div class="result error">✗ ' + data.error + '</div>';
                            }
                        })
                        .catch(error => {
                            resultDiv.innerHTML = '<div class="result error">✗ Error: ' + error.message + '</div>';
                        });
                    });
                </script>
            </body>
            </html>
        `);
    }
});

// GET: Halaman test notifikasi pembayaran
router.get('/test-payment-notification', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Test Notifikasi Pembayaran</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h2 { color: #333; text-align: center; margin-bottom: 30px; }
                .form-group { margin: 20px 0; }
                label { display: block; margin-bottom: 5px; font-weight: bold; color: #555; }
                input[type="text"], input[type="number"] { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 16px; box-sizing: border-box; }
                button { width: 100%; padding: 15px; background: #007bff; color: white; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; margin-top: 20px; }
                button:hover { background: #0056b3; }
                .result { margin: 20px 0; padding: 15px; border-radius: 5px; font-weight: bold; }
                .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
                .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
                .info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>🧪 Test Notifikasi Pembayaran WhatsApp</h2>
                <div class="info">
                    <strong>Info:</strong> Halaman ini untuk testing apakah notifikasi pembayaran berhasil dikirim ke pelanggan via WhatsApp.
                </div>
                
                <form id="testForm">
                    <div class="form-group">
                        <label>Nomor WhatsApp Pelanggan:</label>
                        <input type="text" name="customer_phone" placeholder="6281234567890" required>
                    </div>
                    
                    <div class="form-group">
                        <label>Nama Pelanggan:</label>
                        <input type="text" name="customer_name" placeholder="Nama Lengkap" required>
                    </div>
                    
                    <div class="form-group">
                        <label>Nomor Tagihan:</label>
                        <input type="text" name="invoice_number" placeholder="INV-2024-001" required>
                    </div>
                    
                    <div class="form-group">
                        <label>Jumlah Pembayaran:</label>
                        <input type="number" name="amount" placeholder="50000" required>
                    </div>
                    
                    <button type="submit">📱 Kirim Test Notifikasi</button>
                </form>
                
                <div id="result"></div>
            </div>
            
            <script>
                document.getElementById('testForm').addEventListener('submit', function(e) {
                    e.preventDefault();
                    
                    const formData = new FormData(this);
                    const resultDiv = document.getElementById('result');
                    const submitBtn = document.querySelector('button[type="submit"]');
                    
                    // Disable button dan show loading
                    submitBtn.disabled = true;
                    submitBtn.textContent = '⏳ Mengirim...';
                    resultDiv.innerHTML = '<div class="info">⏳ Mengirim notifikasi test...</div>';
                    
                    // Convert FormData to JSON
                    const data = {};
                    formData.forEach((value, key) => data[key] = value);
                    
                    fetch('/admin/settings/test-payment-notification', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(data)
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            resultDiv.innerHTML = '<div class="success">✅ ' + data.message + '</div>';
                        } else {
                            resultDiv.innerHTML = '<div class="error">❌ ' + data.message + '</div>';
                        }
                    })
                    .catch(error => {
                        resultDiv.innerHTML = '<div class="error">❌ Error: ' + error.message + '</div>';
                    })
                    .finally(() => {
                        // Re-enable button
                        submitBtn.disabled = false;
                        submitBtn.textContent = '📱 Kirim Test Notifikasi';
                    });
                });
            </script>
        </body>
        </html>
    `);
});

// POST: Test notifikasi pembayaran
router.post('/test-payment-notification', async (req, res) => {
    try {
        const { customer_phone, customer_name, invoice_number, amount } = req.body;
        
        if (!customer_phone || !customer_name || !invoice_number || !amount) {
            return res.status(400).json({
                success: false,
                message: 'Semua field harus diisi: customer_phone, customer_name, invoice_number, amount'
            });
        }

        // Simulasi data customer dan invoice untuk testing
        const mockCustomer = {
            name: customer_name,
            phone: customer_phone
        };
        
        const mockInvoice = {
            invoice_number: invoice_number,
            amount: parseFloat(amount)
        };

        // Import billing manager untuk testing notifikasi
        const billingManager = require('../config/billing');
        
        // Test kirim notifikasi
        await billingManager.sendPaymentSuccessNotification(mockCustomer, mockInvoice);
        
        res.json({
            success: true,
            message: `Notifikasi pembayaran berhasil dikirim ke ${customer_phone}`,
            data: {
                customer: mockCustomer,
                invoice: mockInvoice
            }
        });
        
    } catch (error) {
        logger.error('Error testing payment notification:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengirim notifikasi test',
            error: error.message
        });
    }
});





// GET: Ambil daftar grup WhatsApp yang sudah terkoneksi
router.get('/whatsapp-groups', async (req, res) => {
    // Set content type header untuk memastikan response selalu JSON
    res.setHeader('Content-Type', 'application/json');

    try {
        console.log('🔍 Getting WhatsApp groups...');

        // Import WhatsApp untuk mendapatkan koneksi
        const whatsapp = require('../config/whatsapp');

        if (!whatsapp || !whatsapp.getSock()) {
            console.log('❌ WhatsApp not connected');
            return res.status(400).json({
                success: false,
                message: 'WhatsApp belum terkoneksi. Silakan scan QR code terlebih dahulu.',
                groups: [],
                status: 'disconnected',
                timestamp: new Date().toISOString()
            });
        }

        const sock = whatsapp.getSock();
        console.log('✅ WhatsApp connected, fetching groups...');

        // Dapatkan semua grup dengan timeout
        const groups = await Promise.race([
            sock.groupFetchAllParticipating(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout: Gagal mengambil grup WhatsApp')), 10000)
            )
        ]);

        const groupList = Object.values(groups || {});
        console.log(`📊 Found ${groupList.length} groups`);

        // Format data grup
        const formattedGroups = groupList.map(group => ({
            id: group.id || '',
            name: group.subject || 'Tidak ada nama',
            description: group.desc || 'Tidak ada deskripsi',
            owner: group.owner || 'Tidak diketahui',
            participants: group.participants ? group.participants.length : 0,
            created: group.creation ? new Date(group.creation * 1000).toLocaleString('id-ID') : 'Tidak diketahui',
            isAdmin: group.participants ? group.participants.some(p => p.id === sock.user.id && p.admin) : false
        }));

        console.log('✅ Groups formatted successfully');

        res.json({
            success: true,
            message: `Berhasil mendapatkan ${formattedGroups.length} grup WhatsApp`,
            groups: formattedGroups,
            status: 'connected',
            total: formattedGroups.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error getting WhatsApp groups:', error);
        logger.error('Error getting WhatsApp groups:', error);

        // Pastikan selalu return JSON response
        res.status(500).json({
            success: false,
            message: error.message.includes('Timeout')
                ? 'Timeout: Gagal mengambil grup WhatsApp'
                : 'Gagal mengambil daftar grup WhatsApp',
            error: error.message,
            groups: [],
            status: 'error',
            timestamp: new Date().toISOString()
        });
    }
});

// POST: Refresh daftar grup WhatsApp
router.post('/whatsapp-groups/refresh', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    try {
        console.log('🔄 Refreshing WhatsApp groups...');

        // Import WhatsApp untuk mendapatkan koneksi
        const whatsapp = require('../config/whatsapp');

        if (!whatsapp || !whatsapp.getSock()) {
            console.log('❌ WhatsApp not connected');
            return res.status(400).json({
                success: false,
                message: 'WhatsApp belum terkoneksi. Silakan scan QR code terlebih dahulu.',
                timestamp: new Date().toISOString()
            });
        }

        const sock = whatsapp.getSock();

        // Refresh data grup dengan timeout
        await Promise.race([
            sock.groupFetchAllParticipating(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout: Gagal refresh grup WhatsApp')), 5000)
            )
        ]);

        console.log('✅ WhatsApp groups refreshed successfully');

        res.json({
            success: true,
            message: 'Daftar grup WhatsApp berhasil direfresh',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error refreshing WhatsApp groups:', error);
        logger.error('Error refreshing WhatsApp groups:', error);

        res.status(500).json({
            success: false,
            message: error.message.includes('Timeout')
                ? 'Timeout: Gagal refresh grup WhatsApp'
                : 'Gagal refresh daftar grup WhatsApp',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// GET: Detail grup WhatsApp tertentu
router.get('/whatsapp-groups/:groupId', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    try {
        const { groupId } = req.params;
        console.log(`🔍 Getting details for group: ${groupId}`);

        // Import WhatsApp untuk mendapatkan koneksi
        const whatsapp = require('../config/whatsapp');

        if (!whatsapp || !whatsapp.getSock()) {
            console.log('❌ WhatsApp not connected');
            return res.status(400).json({
                success: false,
                message: 'WhatsApp belum terkoneksi.',
                timestamp: new Date().toISOString()
            });
        }

        const sock = whatsapp.getSock();

        // Dapatkan detail grup dengan timeout
        const group = await Promise.race([
            sock.groupMetadata(groupId),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout: Gagal mengambil detail grup')), 8000)
            )
        ]);

        if (!group) {
            console.log('❌ Group not found');
            return res.status(404).json({
                success: false,
                message: 'Grup tidak ditemukan',
                timestamp: new Date().toISOString()
            });
        }

        // Dapatkan informasi partisipan
        const participants = group.participants.map(p => ({
            id: p.id,
            isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
            isSuperAdmin: p.admin === 'superadmin'
        }));

        console.log(`✅ Group details retrieved: ${group.subject}`);

        res.json({
            success: true,
            group: {
                id: group.id,
                name: group.subject || 'Tidak ada nama',
                description: group.desc || 'Tidak ada deskripsi',
                owner: group.owner || 'Tidak diketahui',
                participants: participants,
                totalParticipants: participants.length,
                created: group.creation ? new Date(group.creation * 1000).toLocaleString('id-ID') : 'Tidak diketahui',
                isAdmin: participants.some(p => p.id === sock.user.id && p.isAdmin)
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error getting WhatsApp group detail:', error);
        logger.error('Error getting WhatsApp group detail:', error);

        res.status(500).json({
            success: false,
            message: error.message.includes('Timeout')
                ? 'Timeout: Gagal mengambil detail grup WhatsApp'
                : 'Gagal mengambil detail grup WhatsApp',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// POST: Generate Mikrotik Isolation Script
router.post('/generate-isolation-script', (req, res) => {
    try {
        const { 
            method = 'address_list', 
            bandwidthLimit = '1k/1k', 
            networkRange = '192.168.1.0/24', 
            dnsServers = '8.8.8.8,8.8.4.4' 
        } = req.body;

        // Generate script berdasarkan metode yang dipilih
        let script = generateIsolationScript(method, bandwidthLimit, networkRange, dnsServers);
        
        res.json({
            success: true,
            script: script,
            method: method,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Error generating isolation script:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal generate script isolir',
            error: error.message
        });
    }
});

// Fungsi untuk generate script isolir
function generateIsolationScript(method, bandwidthLimit, networkRange, dnsServers) {
    const timestamp = new Date().toISOString();
    const dnsArray = dnsServers.split(',').map(dns => dns.trim());
    
    let script = `# ========================================
# MIKROTIK ISOLATION SYSTEM SCRIPT
# Generated by Gembok Bill System
# Date: ${timestamp}
# Method: ${method.toUpperCase()}
# ========================================

# Script ini berisi konfigurasi untuk isolir pelanggan IP statik
# Jalankan script ini di Mikrotik RouterOS

`;

    // Setup Address List (selalu diperlukan)
    script += `# ========================================
# 1. SETUP ADDRESS LIST
# ========================================

# Buat address list untuk blocked customers
/ip firewall address-list add list=blocked_customers address=0.0.0.0 comment="Placeholder - Auto managed by Gembok Bill"

`;

    // Firewall Rules
    script += `# ========================================
# 2. FIREWALL RULES
# ========================================

# Rule 1: Block traffic dari blocked customers (FORWARD chain)
/ip firewall filter add chain=forward src-address-list=blocked_customers action=drop comment="Block suspended customers (static IP) - Gembok Bill" place-before=0

# Rule 2: Block access to router dari blocked customers (INPUT chain)
/ip firewall filter add chain=input src-address-list=blocked_customers action=drop comment="Block suspended customers from accessing router (static IP) - Gembok Bill"

`;

    // Metode spesifik
    switch (method) {
        case 'dhcp_block':
            script += `# ========================================
# 3. DHCP SERVER CONFIGURATION
# ========================================

# Setup DHCP server untuk block method
/ip dhcp-server setup
/ip dhcp-server network add address=${networkRange} gateway=${networkRange.split('/')[0].replace(/\d+$/, '1')} dns=${dnsArray.join(',')}

`;
            break;
            
        case 'bandwidth_limit':
            script += `# ========================================
# 3. QUEUE CONFIGURATION
# ========================================

# Buat queue parent untuk suspended customers
/queue simple add name="suspended_customers" target=${networkRange} max-limit=${bandwidthLimit} comment="Suspended customers queue"

`;
            break;
            
        case 'firewall_rule':
            script += `# ========================================
# 3. INDIVIDUAL FIREWALL RULES
# ========================================

# Individual firewall rules akan dibuat per IP saat isolir
# Gunakan commands di bagian manual untuk membuat rule individual

`;
            break;
    }

    // Monitoring Commands
    script += `# ========================================
# 4. MONITORING COMMANDS
# ========================================

# Cek address list blocked customers:
# /ip firewall address-list print where list=blocked_customers

# Cek firewall rules:
# /ip firewall filter print where comment~"Block suspended customers"

`;

    if (method === 'dhcp_block') {
        script += `# Cek DHCP leases yang diblokir:
# /ip dhcp-server lease print where blocked=yes

`;
    }

    if (method === 'bandwidth_limit') {
        script += `# Cek queue suspended:
# /queue simple print where name~"suspended"

`;
    }

    // Manual Commands
    script += `# ========================================
# 5. MANUAL ISOLATION COMMANDS
# ========================================

# Isolir pelanggan (ganti IP_ADDRESS dengan IP pelanggan):
# /ip firewall address-list add list=blocked_customers address=IP_ADDRESS comment="SUSPENDED - [ALASAN] - [TANGGAL]"

# Contoh:
# /ip firewall address-list add list=blocked_customers address=192.168.1.100 comment="SUSPENDED - Telat bayar - 2024-01-15"

# Restore pelanggan (hapus dari address list):
# /ip firewall address-list remove [find where address=IP_ADDRESS and list=blocked_customers]

# Contoh:
# /ip firewall address-list remove [find where address=192.168.1.100 and list=blocked_customers]

`;

    // Bulk Operations
    script += `# ========================================
# 6. BULK OPERATIONS
# ========================================

# Isolir multiple IP sekaligus:
# :foreach i in={192.168.1.100;192.168.1.101;192.168.1.102} do={/ip firewall address-list add list=blocked_customers address=$i comment="BULK SUSPEND - [TANGGAL]"}

# Restore semua pelanggan yang diisolir:
# /ip firewall address-list remove [find where list=blocked_customers and comment~"SUSPENDED"]

`;

    // Troubleshooting
    script += `# ========================================
# 7. TROUBLESHOOTING
# ========================================

# Cek apakah rule firewall aktif:
# /ip firewall filter print where disabled=no and comment~"Block suspended customers"

# Cek address list entries:
# /ip firewall address-list print where list=blocked_customers

# Test connectivity dari IP yang diisolir:
# /ping 8.8.8.8 src-address=IP_YANG_DIISOLIR

# Cek log firewall:
# /log print where topics~"firewall"

`;

    // End
    script += `# ========================================
# END OF SCRIPT
# ========================================

# Catatan:
# 1. Pastikan script ini dijalankan dengan akses admin penuh
# 2. Sesuaikan IP range dengan konfigurasi network Anda
# 3. Test konfigurasi di environment non-production terlebih dahulu
# 4. Backup konfigurasi Mikrotik sebelum menjalankan script
# 5. Monitor log setelah implementasi untuk memastikan berfungsi dengan baik
`;

    return script;
}

// Test endpoint tanpa authentication
router.post('/test-generate-isolation-script', (req, res) => {
    try {
        const { 
            method = 'address_list', 
            bandwidthLimit = '1k/1k', 
            networkRange = '192.168.1.0/24', 
            dnsServers = '8.8.8.8,8.8.4.4' 
        } = req.body;

        // Generate script berdasarkan metode yang dipilih
        let script = generateIsolationScript(method, bandwidthLimit, networkRange, dnsServers);
        
        res.json({
            success: true,
            script: script,
            method: method,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Error generating isolation script:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal generate script isolir',
            error: error.message
        });
    }
});

// ===== DNS MANAGEMENT API ENDPOINTS =====

// POST: Test koneksi GenieACS
router.post('/api/test-genieacs-connection', async (req, res) => {
    try {
        const result = await runConsoleScript('1');
        res.json({
            success: result.success,
            message: result.message,
            output: result.output
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error testing GenieACS connection: ' + error.message
        });
    }
});

// POST: Get GenieACS devices
router.post('/api/get-genieacs-devices', async (req, res) => {
    try {
        const result = await runConsoleScript('2');
        res.json({
            success: result.success,
            message: result.message,
            output: result.output
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error getting GenieACS devices: ' + error.message
        });
    }
});

// POST: Configure DNS for specific device
router.post('/api/configure-genieacs-dns', async (req, res) => {
    try {
        const { deviceId, dnsServer } = req.body;
        
        if (!deviceId) {
            return res.status(400).json({
                success: false,
                message: 'Device ID harus diisi'
            });
        }
        
        const result = await runConsoleScript('3', `${deviceId}\n${dnsServer || '192.168.8.89'}`);
        res.json({
            success: result.success,
            message: result.message,
            output: result.output
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error configuring DNS: ' + error.message
        });
    }
});

// POST: Configure DNS for all online devices
router.post('/api/configure-all-genieacs-dns', async (req, res) => {
    try {
        const result = await runConsoleScript('4');
        res.json({
            success: result.success,
            message: result.message,
            output: result.output
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error configuring all DNS: ' + error.message
        });
    }
});

// Helper function to run console script
function runConsoleScript(option, additionalInput = '') {
    return new Promise((resolve, reject) => {
        const scriptPath = './scripts/simple-genieacs-dns.js';
        
        const child = spawn('node', [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true
        });
        
        let output = '';
        let error = '';
        
        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            error += data.toString();
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                resolve({
                    success: true,
                    message: 'Script executed successfully',
                    output: output
                });
            } else {
                resolve({
                    success: false,
                    message: error || 'Script execution failed',
                    output: output
                });
            }
        });
        
        child.on('error', (err) => {
            reject(err);
        });
        
        // Send input to script
        child.stdin.write(option + '\n');
        if (additionalInput) {
            child.stdin.write(additionalInput + '\n');
        }
        child.stdin.end();
    });
}

// Export fungsi untuk testing
module.exports = {
    router,
    generateIsolationScript
};
