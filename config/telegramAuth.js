/**
 * Telegram Bot Authentication Module
 * Handles user authentication and session management
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

class TelegramAuth {
    constructor() {
        this.dbPath = path.join(__dirname, '../data/billing.db');
        this.sessionTimeout = 24; // hours
    }

    /**
     * Get database connection
     */
    getDb() {
        return new sqlite3.Database(this.dbPath);
    }

    /**
     * Authenticate user with username and password
     * @param {string} username - Username
     * @param {string} password - Password
     * @returns {Promise<Object>} User object with role
     */
    async authenticate(username, password) {
        const db = this.getDb();

        return new Promise((resolve, reject) => {
            // Check admin credentials from settings
            const { getSetting } = require('./settingsManager');
            const adminUsername = getSetting('admin_username', 'admin');
            const adminPassword = getSetting('admin_password', 'admin');

            if (username === adminUsername && password === adminPassword) {
                db.close();
                resolve({
                    username: adminUsername,
                    role: 'admin',
                    name: 'Administrator'
                });
                return;
            }

            // Check technician credentials
            db.get(
                'SELECT * FROM technicians WHERE phone = ? AND is_active = 1',
                [username],
                async (err, technician) => {
                    if (err) {
                        db.close();
                        reject(err);
                        return;
                    }

                    if (technician) {
                        // For technicians, username is phone number and password is phone number
                        if (password === technician.phone) {
                            db.close();
                            resolve({
                                username: technician.phone,
                                role: 'technician',
                                name: technician.name,
                                id: technician.id
                            });
                            return;
                        }
                    }

                    // Check collector credentials
                    db.get(
                        'SELECT * FROM collectors WHERE phone = ? AND status = ?',
                        [username, 'active'],
                        async (err, collector) => {
                            db.close();

                            if (err) {
                                reject(err);
                                return;
                            }

                            if (collector) {
                                // Check if password column exists and has value
                                if (collector.password) {
                                    try {
                                        const match = await bcrypt.compare(password, collector.password);
                                        if (match) {
                                            resolve({
                                                username: collector.phone,
                                                role: 'collector',
                                                name: collector.name,
                                                id: collector.id
                                            });
                                            return;
                                        }
                                    } catch (bcryptErr) {
                                        // If bcrypt fails, try plain text comparison
                                        if (password === collector.password) {
                                            resolve({
                                                username: collector.phone,
                                                role: 'collector',
                                                name: collector.name,
                                                id: collector.id
                                            });
                                            return;
                                        }
                                    }
                                } else {
                                    // No password set, use phone as password
                                    if (password === collector.phone) {
                                        resolve({
                                            username: collector.phone,
                                            role: 'collector',
                                            name: collector.name,
                                            id: collector.id
                                        });
                                        return;
                                    }
                                }
                            }

                            reject(new Error('Invalid credentials'));
                        }
                    );
                }
            );
        });
    }

    /**
     * Create or update session
     * @param {number} telegramUserId - Telegram user ID
     * @param {Object} user - User object from authentication
     * @returns {Promise<Object>} Session object
     */
    async createSession(telegramUserId, user) {
        const db = this.getDb();
        const expiresAt = new Date(Date.now() + this.sessionTimeout * 60 * 60 * 1000);

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT OR REPLACE INTO telegram_sessions 
                (telegram_user_id, username, role, login_time, last_activity, expires_at) 
                VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`,
                [telegramUserId, user.username, user.role, expiresAt.toISOString()],
                function (err) {
                    db.close();
                    if (err) {
                        reject(err);
                    } else {
                        resolve({
                            id: this.lastID,
                            telegram_user_id: telegramUserId,
                            username: user.username,
                            role: user.role,
                            expires_at: expiresAt
                        });
                    }
                }
            );
        });
    }

    /**
     * Get active session
     * @param {number} telegramUserId - Telegram user ID
     * @returns {Promise<Object|null>} Session object or null
     */
    async getSession(telegramUserId) {
        const db = this.getDb();

        return new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM telegram_sessions 
                WHERE telegram_user_id = ? 
                AND datetime(expires_at) > datetime('now')`,
                [telegramUserId],
                (err, row) => {
                    if (err) {
                        db.close();
                        reject(err);
                        return;
                    }

                    if (row) {
                        // Update last activity
                        db.run(
                            'UPDATE telegram_sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = ?',
                            [row.id],
                            (updateErr) => {
                                db.close();
                                if (updateErr) {
                                    console.error('Failed to update last activity:', updateErr);
                                }
                                resolve(row);
                            }
                        );
                    } else {
                        db.close();
                        resolve(null);
                    }
                }
            );
        });
    }

    /**
     * Delete session (logout)
     * @param {number} telegramUserId - Telegram user ID
     * @returns {Promise<boolean>} Success status
     */
    async deleteSession(telegramUserId) {
        const db = this.getDb();

        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM telegram_sessions WHERE telegram_user_id = ?',
                [telegramUserId],
                function (err) {
                    db.close();
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.changes > 0);
                    }
                }
            );
        });
    }

    /**
     * Cleanup expired sessions
     * @returns {Promise<number>} Number of deleted sessions
     */
    async cleanupExpiredSessions() {
        const db = this.getDb();

        return new Promise((resolve, reject) => {
            db.run(
                "DELETE FROM telegram_sessions WHERE datetime(expires_at) <= datetime('now')",
                function (err) {
                    db.close();
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.changes);
                    }
                }
            );
        });
    }

    /**
     * Check if user has required role
     * @param {Object} session - Session object
     * @param {Array<string>} allowedRoles - Array of allowed roles
     * @returns {boolean} Has permission
     */
    hasPermission(session, allowedRoles = ['admin', 'technician']) {
        if (!session) return false;
        return allowedRoles.includes(session.role);
    }

    /**
     * Check if user is admin
     * @param {Object} session - Session object
     * @returns {boolean} Is admin
     */
    isAdmin(session) {
        return session && session.role === 'admin';
    }

    /**
     * Check if user is technician
     * @param {Object} session - Session object
     * @returns {boolean} Is technician
     */
    isTechnician(session) {
        return session && session.role === 'technician';
    }

    /**
     * Check if user is collector
     * @param {Object} session - Session object
     * @returns {boolean} Is collector
     */
    isCollector(session) {
        return session && session.role === 'collector';
    }
}

module.exports = new TelegramAuth();
