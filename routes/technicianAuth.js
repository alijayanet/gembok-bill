const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const { getSetting } = require('../config/settingsManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');
const logger = require('../config/logger');

// Database connection
const dbPath = path.join(__dirname, '../data/billing.db');
const db = new sqlite3.Database(dbPath);

// Simple OTP store (following customer portal pattern)
const otpStore = {};

// WhatsApp integration untuk kirim OTP (following customer portal pattern)
let sendMessage;
try {
    const sendMessageModule = require('../config/sendMessage');
    sendMessage = sendMessageModule.sendMessage;
} catch (error) {
    console.log('WhatsApp not available for OTP sending');
    sendMessage = null;
}

/**
 * Technician Authentication Manager (following customer portal pattern)
 */
class TechnicianAuthManager {
    constructor() {
        this.otpLength = parseInt(getSetting('otp_length', '6'));
        this.otpExpiryMinutes = parseInt(getSetting('otp_expiry_minutes', '5'));
    }

    // Normalisasi nomor telepon ke format Indonesia: 62XXXXXXXXXXX (tanpa +)
    normalizePhone(phone) {
        if (!phone) return '';
        let p = String(phone).trim();
        // Hapus non-digit
        p = p.replace(/\D/g, '');
        // Jika diawali 0 -> ganti 62
        if (p.startsWith('0')) {
            p = '62' + p.slice(1);
        }
        // Jika tidak diawali 62, paksa 62 prefix
        if (!p.startsWith('62')) {
            p = '62' + p;
        }
        return p;
    }

    // Buat beberapa varian umum untuk kecocokan database
    generatePhoneVariants(phone) {
        const normalized = this.normalizePhone(phone);
        const plus62 = '+' + normalized; // +62XXXXXXXXXXX
        const local0 = normalized.replace(/^62/, '0'); // 08XXXXXXXXX
        return Array.from(new Set([normalized, plus62, local0]));
    }

    // Generate OTP code (same as customer portal)
    generateOTP() {
        const min = Math.pow(10, this.otpLength - 1);
        const max = Math.pow(10, this.otpLength) - 1;
        return Math.floor(min + Math.random() * (max - min)).toString();
    }

    // Cek apakah nomor adalah teknisi yang valid
    async isValidTechnician(phone) {
        const variants = this.generatePhoneVariants(phone);
        return new Promise((resolve, reject) => {
            const placeholders = variants.map(() => '?').join(',');
            const sql = `SELECT * FROM technicians WHERE is_active = 1 AND phone IN (${placeholders}) LIMIT 1`;
            db.get(sql, variants, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row || null);
                }
            });
        });
    }

    // Generate dan simpan OTP (following customer portal pattern)
    async generateAndSaveOTP(phone) {
        const otp = this.generateOTP();
        const expiryMin = this.otpExpiryMinutes;
        
        // Store OTP in memory (same as customer portal)
        otpStore[phone] = { 
            otp, 
            expires: Date.now() + expiryMin * 60 * 1000 
        };
        
        return { otpCode: otp };
    }

    // Kirim OTP via WhatsApp (following customer portal pattern)
    async sendOTPViaWhatsApp(phone, otpCode) {
        if (!sendMessage) {
            throw new Error('WhatsApp service not available');
        }

        const message = `🔐 *KODE OTP PORTAL TEKNISI*\n\nKode OTP Anda: *${otpCode}*\n\n⏰ Berlaku selama ${this.otpExpiryMinutes} menit\n🔒 Jangan bagikan kode ini kepada siapa pun\n\n*${getSetting('company_header', 'GEMBOK TEKNISI PORTAL')}*`;

        try {
            const jid = `${phone}@s.whatsapp.net`;
            await sendMessage(jid, message);
            logger.info(`OTP sent to technician: ${phone}`);
            return true;
        } catch (error) {
            logger.error('Failed to send OTP via WhatsApp:', error);
            throw error;
        }
    }

    // Verifikasi OTP (following customer portal pattern)
    async verifyOTP(phone, otpCode) {
        const data = otpStore[phone];
        
        if (!data || data.otp !== otpCode || Date.now() > data.expires) {
            return { valid: false, reason: 'invalid_or_expired' };
        }
        
        // Remove OTP after successful verification
        delete otpStore[phone];
        return { valid: true };
    }

    // Create session untuk teknisi
    async createTechnicianSession(technician, req) {
        const sessionId = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 jam

        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO technician_sessions (session_id, technician_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`;
            const ipAddress = req.ip || req.connection?.remoteAddress || 'unknown';
            const userAgent = req.get('User-Agent') || 'unknown';

            db.run(sql, [sessionId, technician.id, expiresAt.toISOString(), ipAddress, userAgent], function(err) {
                if (err) {
                    reject(err);
                } else {
                    // Update last login teknisi
                    const updateSql = `UPDATE technicians SET last_login = datetime('now') WHERE id = ?`;
                    db.run(updateSql, [technician.id]);

                    resolve({ sessionId, expiresAt, sessionDbId: this.lastID });
                }
            });
        });
    }

    // Validate session
    async validateSession(sessionId) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT ts.*, t.* 
                FROM technician_sessions ts 
                JOIN technicians t ON ts.technician_id = t.id 
                WHERE ts.session_id = ? AND ts.expires_at > datetime('now') AND ts.is_active = 1 AND t.is_active = 1
            `;
            
            db.get(sql, [sessionId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    if (row) {
                        // Update last activity
                        const updateSql = `UPDATE technician_sessions SET last_activity = datetime('now') WHERE session_id = ?`;
                        db.run(updateSql, [sessionId]);
                    }
                    resolve(row || null);
                }
            });
        });
    }

    // Log aktivitas teknisi
    async logActivity(technicianId, activityType, description, metadata = null) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO technician_activities (technician_id, activity_type, description, metadata) VALUES (?, ?, ?, ?)`;
            const metadataStr = metadata ? JSON.stringify(metadata) : null;

            db.run(sql, [technicianId, activityType, description, metadataStr], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
        });
    }
}

// Instance manager
const authManager = new TechnicianAuthManager();

/**
 * Middleware untuk cek autentikasi teknisi
 */
function technicianAuth(req, res, next) {
    const sessionId = req.session?.technicianSessionId;
    
    if (!sessionId) {
        const acceptsJson = req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1) || req.headers['content-type'] === 'application/json';
        if (acceptsJson) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        return res.redirect('/technician/login');
    }

    authManager.validateSession(sessionId)
        .then(session => {
            if (!session) {
                req.session.technicianSessionId = null;
                const acceptsJson = req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1) || req.headers['content-type'] === 'application/json';
                if (acceptsJson) {
                    return res.status(401).json({ success: false, message: 'Unauthorized' });
                }
                return res.redirect('/technician/login');
            }

            // Tambahkan info teknisi ke request
            req.technician = {
                id: session.technician_id,
                name: session.name,
                phone: session.phone,
                role: session.role,
                area_coverage: session.area_coverage
            };

            next();
        })
        .catch(error => {
            logger.error('Error validating technician session:', error);
            res.status(500).send('Internal Server Error');
        });
}

/**
 * ROUTES
 */

// GET: Halaman login teknisi
router.get('/login', (req, res) => {
    const settings = {
        company_header: getSetting('company_header', 'GEMBOK'),
        footer_info: getSetting('footer_info', 'Portal Teknisi'),
        otp_length: authManager.otpLength,
        otp_expiry_minutes: authManager.otpExpiryMinutes,
        customerPortalOtp: getSetting('customerPortalOtp', false) // Tambah status OTP
    };

    res.render('technicianLogin', { 
        error: null, 
        success: null,
        step: 'phone',
        phone: null,
        settings,
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
    });
});

// POST: Request OTP
router.post('/request-otp', async (req, res) => {
    try {
        const { phone } = req.body;
        const { getSetting } = require('../config/settingsManager');

        if (!phone) {
            return res.render('technicianLogin', { 
                error: 'Nomor telepon harus diisi',
                success: null,
                step: 'phone',
                phone: null,
                settings: { company_header: getSetting('company_header', 'GEMBOK') },
                versionInfo: getVersionInfo(),
                versionBadge: getVersionBadge()
            });
        }

        // Format nomor telepon
        let formattedPhone = phone.replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '62' + formattedPhone.slice(1);
        }
        if (!formattedPhone.startsWith('62')) {
            formattedPhone = '62' + formattedPhone;
        }

        // Cek apakah teknisi valid
        const technician = await authManager.isValidTechnician(formattedPhone);
        if (!technician) {
            return res.render('technicianLogin', { 
                error: 'Nomor telepon tidak terdaftar sebagai teknisi',
                success: null,
                step: 'phone',
                phone: null,
                settings: { company_header: getSetting('company_header', 'GEMBOK') },
                versionInfo: getVersionInfo(),
                versionBadge: getVersionBadge()
            });
        }

        // Cek setting OTP (mengikuti customer portal pattern)
        const otpSetting = getSetting('customerPortalOtp', false);
        const otpEnabled = (otpSetting === true || otpSetting === 'true');
        
        console.log(`[TECHNICIAN_LOGIN] OTP Setting: ${otpSetting}, Enabled: ${otpEnabled}`);
        
        if (otpEnabled) {
            // OTP aktif - generate dan kirim OTP
            const { otpCode } = await authManager.generateAndSaveOTP(formattedPhone);
            
            try {
                await authManager.sendOTPViaWhatsApp(formattedPhone, otpCode);
                
                // Simpan phone di session untuk step selanjutnya
                req.session.pendingTechnicianPhone = formattedPhone;
                
                res.render('technicianLogin', { 
                    error: null,
                    success: `Kode OTP telah dikirim ke nomor ${formattedPhone} via WhatsApp`,
                    step: 'otp',
                    phone: formattedPhone,
                    settings: { 
                        company_header: getSetting('company_header', 'GEMBOK'),
                        otp_length: authManager.otpLength 
                    },
                    versionInfo: getVersionInfo(),
                    versionBadge: getVersionBadge()
                });
            } catch (whatsappError) {
                logger.error('Failed to send OTP:', whatsappError);
                res.render('technicianLogin', { 
                    error: 'Gagal mengirim OTP. Silakan coba lagi atau hubungi admin.',
                    success: null,
                    step: 'phone',
                    phone: null,
                    settings: { company_header: getSetting('company_header', 'GEMBOK') },
                    versionInfo: getVersionInfo(),
                    versionBadge: getVersionBadge()
                });
            }
        } else {
            // OTP nonaktif - langsung login (seperti customer portal)
            console.log(`[TECHNICIAN_LOGIN] OTP disabled, proceeding with direct login for: ${formattedPhone}`);
            
            try {
                // Create session langsung tanpa OTP
                const session = await authManager.createTechnicianSession(technician, req);
                req.session.technicianSessionId = session.sessionId;
                req.session.pendingTechnicianPhone = null;

                // Log aktivitas login
                await authManager.logActivity(technician.id, 'login', 'Login ke portal teknisi (tanpa OTP)', {
                    ip: req.ip,
                    userAgent: req.get('User-Agent')
                });

                logger.info(`Technician logged in without OTP: ${technician.name} (${technician.phone})`);
                
                res.redirect('/technician/dashboard');
            } catch (error) {
                logger.error('Error during direct login:', error);
                res.render('technicianLogin', { 
                    error: 'Terjadi kesalahan saat login. Silakan coba lagi.',
                    success: null,
                    step: 'phone',
                    phone: null,
                    settings: { company_header: getSetting('company_header', 'GEMBOK') },
                    versionInfo: getVersionInfo(),
                    versionBadge: getVersionBadge()
                });
            }
        }

    } catch (error) {
        logger.error('Error requesting OTP:', error);
        res.render('technicianLogin', { 
            error: 'Terjadi kesalahan sistem. Silakan coba lagi.',
            success: null,
            step: 'phone',
            phone: null,
            settings: { company_header: getSetting('company_header', 'GEMBOK') },
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    }
});

// POST: Verify OTP dan login
router.post('/verify-otp', async (req, res) => {
    try {
        const { otp_code } = req.body;
        const phone = req.session.pendingTechnicianPhone;

        if (!phone || !otp_code) {
            return res.redirect('/technician/login');
        }

        // Verifikasi OTP
        const verification = await authManager.verifyOTP(phone, otp_code);
        
        if (!verification.valid) {
            return res.render('technicianLogin', { 
                error: 'Kode OTP tidak valid atau sudah kadaluarsa',
                success: null,
                step: 'otp',
                phone: phone,
                settings: { 
                    company_header: getSetting('company_header', 'GEMBOK'),
                    otp_length: authManager.otpLength 
                },
                versionInfo: getVersionInfo(),
                versionBadge: getVersionBadge()
            });
        }

        // Get technician data
        const technician = await authManager.isValidTechnician(phone);
        if (!technician) {
            return res.redirect('/technician/login');
        }

        // Create session
        const session = await authManager.createTechnicianSession(technician, req);
        req.session.technicianSessionId = session.sessionId;
        req.session.pendingTechnicianPhone = null;

        // Log aktivitas login
        await authManager.logActivity(technician.id, 'login', 'Login ke portal teknisi', {
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        logger.info(`Technician logged in: ${technician.name} (${technician.phone})`);
        
        res.redirect('/technician/dashboard');

    } catch (error) {
        logger.error('Error verifying OTP:', error);
        res.render('technicianLogin', { 
            error: 'Terjadi kesalahan sistem. Silakan coba lagi.',
            success: null,
            step: 'phone',
            phone: null,
            settings: { company_header: getSetting('company_header', 'GEMBOK') }
        });
    }
});

// GET: Logout
router.get('/logout', technicianAuth, async (req, res) => {
    try {
        const sessionId = req.session.technicianSessionId;
        
        if (sessionId) {
            // Deactivate session
            const sql = `UPDATE technician_sessions SET is_active = 0 WHERE session_id = ?`;
            db.run(sql, [sessionId]);

            // Log aktivitas logout
            await authManager.logActivity(req.technician.id, 'logout', 'Logout dari portal teknisi');
        }

        req.session.technicianSessionId = null;
        res.redirect('/technician/login');
        
    } catch (error) {
        logger.error('Error during logout:', error);
        req.session.technicianSessionId = null;
        res.redirect('/technician/login');
    }
});

// GET: Redirect root to dashboard
router.get('/', (req, res) => {
    const sessionId = req.session?.technicianSessionId;
    if (sessionId) {
        res.redirect('/technician/dashboard');
    } else {
        res.redirect('/technician/login');
    }
});

module.exports = { router, technicianAuth, authManager };