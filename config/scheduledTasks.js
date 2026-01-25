const logger = require('./logger');
const whatsappNotifications = require('./whatsapp-notifications');
const billingManager = require('./billing');

class ScheduledTasksManager {
    constructor() {
        this.isRunning = false;
        this.tasks = [];
    }

    /**
     * Initialize scheduled tasks
     */
    initialize() {
        if (this.isRunning) {
            logger.warn('Scheduled tasks already running');
            return;
        }

        logger.info('Initializing scheduled tasks...');

        // Schedule due date reminder task (runs daily at 8 AM)
        this.scheduleTask('0 8 * * *', async () => {
            await this.sendDueDateReminders();
        });

        this.isRunning = true;
        logger.info('Scheduled tasks initialized successfully');
    }

    /**
     * Schedule a task using node-cron syntax
     * @param {string} cronExpression - Cron expression (minute hour day month dayOfWeek)
     * @param {Function} task - Task function to execute
     */
    scheduleTask(cronExpression, task) {
        const CronJob = require('cron').CronJob;
        const job = new CronJob(cronExpression, task, null, true, 'Asia/Jakarta');
        job.start();
        this.tasks.push(job);
        logger.info(`Scheduled task: ${cronExpression}`);
    }

    /**
     * Send due date reminders for invoices
     */
    async sendDueDateReminders() {
        try {
            logger.info('Running due date reminder task...');

            // Get all unpaid invoices that are due within the next 7 days
            const db = require('./billing').db;
            const today = new Date();
            const sevenDaysLater = new Date(today);
            sevenDaysLater.setDate(today.getDate() + 7);

            const invoices = await new Promise((resolve, reject) => {
                db.all(`
                    SELECT i.*, c.name as customer_name, c.phone as customer_phone, p.name as package_name, p.speed as package_speed
                    FROM invoices i
                    JOIN customers c ON i.customer_id = c.id
                    JOIN packages p ON i.package_id = p.id
                    WHERE i.status = 'unpaid'
                    AND i.due_date >= ?
                    AND i.due_date <= ?
                    ORDER BY i.due_date ASC
                `, [today.toISOString().split('T')[0], sevenDaysLater.toISOString().split('T')[0]], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });

            logger.info(`Found ${invoices.length} invoices due in the next 7 days`);

            // Send reminder for each invoice
            for (const invoice of invoices) {
                try {
                    const result = await whatsappNotifications.sendDueDateReminder(invoice.id);
                    if (result.success) {
                        logger.info(`Due date reminder sent for invoice ${invoice.invoice_number} to ${invoice.customer_name}`);
                    } else {
                        logger.error(`Failed to send due date reminder for invoice ${invoice.invoice_number}: ${result.error}`);
                    }
                } catch (error) {
                    logger.error(`Error sending due date reminder for invoice ${invoice.invoice_number}:`, error);
                }
            }

            logger.info('Due date reminder task completed');
        } catch (error) {
            logger.error('Error in due date reminder task:', error);
        }
    }

    /**
     * Stop all scheduled tasks
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        logger.info('Stopping all scheduled tasks...');
        this.tasks.forEach(task => task.stop());
        this.tasks = [];
        this.isRunning = false;
        logger.info('All scheduled tasks stopped');
    }
}

module.exports = new ScheduledTasksManager();
