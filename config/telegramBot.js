/**
 * Telegram Bot Main Module
 * Main entry point for Telegram bot functionality
 */

const { Telegraf } = require('telegraf');
const TelegramCommands = require('./telegramCommands');
const telegramAuth = require('./telegramAuth');
const { getSetting } = require('./settingsManager');
const logger = require('./logger');

class TelegramBot {
    constructor() {
        this.bot = null;
        this.commands = null;
        this.isRunning = false;
        this.isStarting = false;
        this.cleanupInterval = null;
    }

    async start() {
        if (this.isRunning) {
            logger.info('Telegram bot is already running');
            return;
        }

        if (this.isStarting) {
            logger.warn('Telegram bot is currently starting, please wait...');
            return;
        }

        try {
            this.isStarting = true;
            logger.info('Starting Telegram bot initialization...');

            // Check if bot is enabled
            const enabled = getSetting('telegram_bot.enabled', false);
            if (!enabled) {
                logger.info('Telegram bot is disabled in settings');
                this.isStarting = false;
                return;
            }

            // Get bot token
            const botToken = getSetting('telegram_bot.bot_token', '');
            if (!botToken || botToken === 'YOUR_BOT_TOKEN_HERE') {
                logger.warn('Telegram bot token not configured. Please set telegram_bot.bot_token in settings.json');
                this.isStarting = false;
                return;
            }

            logger.info('Creating Telegraf instance...');
            this.bot = new Telegraf(botToken);

            // Setup error handling
            this.bot.catch((err, ctx) => {
                logger.error('Telegram bot error:', err);
                if (ctx && ctx.reply) {
                    ctx.reply('❌ Terjadi kesalahan pada bot.').catch(() => { });
                }
            });

            // Initialize command handlers
            logger.info('Initializing Telegram commands...');
            this.commands = new TelegramCommands(this.bot);

            // Setup session cleanup
            this.setupSessionCleanup();

            // Start bot - We don't await the full launch promise here because it might take time
            logger.info('Launching Telegram bot (Long Polling)...');

            // Explicit delete webhook to be safe
            await this.bot.telegram.deleteWebhook().catch(() => { });

            this.bot.launch({
                polling: {
                    timeout: 30,
                    limit: 100,
                    allowedUpdates: ['message', 'callback_query']
                }
            }).then(() => {
                this.isRunning = true;
                this.isStarting = false;
                logger.info('✅ Telegram bot started successfully and is now polling');
                console.log('🤖 Telegram bot is running...');
            }).catch(err => {
                this.isRunning = false;
                this.isStarting = false;
                logger.error('❌ Failed to launch Telegram bot polling:', err.message);
                this.bot = null;
            });

            // Give it a small delay before returning so the UI reflects "Starting/Active" better
            await new Promise(resolve => setTimeout(resolve, 3000));

            return true;

        } catch (error) {
            this.isRunning = false;
            this.isStarting = false;
            this.bot = null;
            logger.error('Failed to initialize Telegram bot:', error);
            throw error;
        }
    }

    async stop(signal) {
        if (!this.isRunning && !this.bot && !this.isStarting) return;

        logger.info(`Stopping Telegram bot (${signal || 'MANUAL'})...`);

        // Clear cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        try {
            if (this.bot) {
                // Remove error handler before stopping
                this.bot.catch(() => { });
                await this.bot.stop(signal || 'SIGTERM');
            }
        } catch (error) {
            logger.error('Error during Telegram bot stop:', error.message);
        } finally {
            this.bot = null;
            this.isRunning = false;
            this.isStarting = false;
            logger.info('Telegram bot stopped');
        }
    }

    /**
     * Setup automatic session cleanup
     */
    setupSessionCleanup() {
        const autoCleanup = getSetting('telegram_bot.auto_session_cleanup', true);

        if (!autoCleanup) {
            logger.info('Automatic session cleanup is disabled');
            return;
        }

        // Run cleanup every hour
        this.cleanupInterval = setInterval(async () => {
            try {
                const deleted = await telegramAuth.cleanupExpiredSessions();
                if (deleted > 0) {
                    logger.info(`Cleaned up ${deleted} expired Telegram sessions`);
                }
            } catch (error) {
                logger.error('Error cleaning up Telegram sessions:', error);
            }
        }, 60 * 60 * 1000); // 1 hour

        logger.info('Automatic session cleanup enabled (every 1 hour)');
    }

    /**
     * Get bot instance
     */
    getBot() {
        return this.bot;
    }

    /**
     * Check if bot is running
     */
    isActive() {
        return this.isRunning;
    }

    /**
     * Restart the bot
     */
    async restart() {
        logger.info('Manual restart of Telegram bot requested');
        await this.stop('RESTART');
        // Wait 3 seconds to ensure previous connection is closed
        await new Promise(resolve => setTimeout(resolve, 3000));
        return await this.start();
    }

    /**
     * Send message to user
     * @param {number} telegramUserId - Telegram user ID
     * @param {string} message - Message to send
     * @param {Object} options - Additional options
     */
    async sendMessage(telegramUserId, message, options = {}) {
        if (!this.bot || !this.isRunning) {
            throw new Error('Bot is not running');
        }

        try {
            await this.bot.telegram.sendMessage(telegramUserId, message, options);
            return true;
        } catch (error) {
            logger.error(`Failed to send message to ${telegramUserId}:`, error);
            return false;
        }
    }

    /**
     * Send notification to all admins
     * @param {string} message - Message to send
     */
    async notifyAdmins(message) {
        if (!this.bot || !this.isRunning) {
            return;
        }

        try {
            // Get all admin sessions
            const db = telegramAuth.getDb();

            return new Promise((resolve, reject) => {
                db.all(
                    "SELECT telegram_user_id FROM telegram_sessions WHERE role = 'admin' AND datetime(expires_at) > datetime('now')",
                    async (err, rows) => {
                        db.close();

                        if (err) {
                            reject(err);
                            return;
                        }

                        // Send to all admins
                        const promises = rows.map(row =>
                            this.sendMessage(row.telegram_user_id, message, { parse_mode: 'Markdown' })
                        );

                        await Promise.all(promises);
                        resolve(rows.length);
                    }
                );
            });
        } catch (error) {
            logger.error('Failed to notify admins:', error);
        }
    }

    /**
     * Get bot statistics
     */
    async getStatistics() {
        const db = telegramAuth.getDb();

        return new Promise((resolve, reject) => {
            db.all(
                `SELECT 
                    role,
                    COUNT(*) as count,
                    COUNT(CASE WHEN datetime(expires_at) > datetime('now') THEN 1 END) as active_count
                FROM telegram_sessions
                GROUP BY role`,
                (err, rows) => {
                    db.close();

                    if (err) {
                        reject(err);
                        return;
                    }

                    const stats = {
                        total: 0,
                        active: 0,
                        by_role: {}
                    };

                    rows.forEach(row => {
                        stats.total += row.count;
                        stats.active += row.active_count;
                        stats.by_role[row.role] = {
                            total: row.count,
                            active: row.active_count
                        };
                    });

                    resolve(stats);
                }
            );
        });
    }
}

// Create singleton instance
const telegramBot = new TelegramBot();

module.exports = telegramBot;
