const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class BackupManager {
    constructor() {
        this.dataDir = path.join(process.cwd(), 'data');
        this.backupDir = path.join(process.cwd(), 'backups');
        this.dbPath = path.join(this.dataDir, 'billing.db');

        // Ensure backup directory exists
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    // Generate a backup of the current database
    async generateBackup() {
        try {
            if (!fs.existsSync(this.dbPath)) {
                throw new Error('Database file not found');
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFilename = `billing_backup_${timestamp}.sqlite`;
            const backupPath = path.join(this.backupDir, backupFilename);

            // Copy file securely
            fs.copyFileSync(this.dbPath, backupPath);
            logger.info(`Database backup created: ${backupFilename}`);

            return {
                success: true,
                filename: backupFilename,
                path: backupPath
            };
        } catch (error) {
            logger.error('Backup generation failed:', error);
            throw error;
        }
    }

    // Restore database from a file path
    async restoreBackup(sourcePath) {
        try {
            if (!fs.existsSync(sourcePath)) {
                throw new Error('Backup file not found');
            }

            // Create a temporary backup of current state before overwriting
            try {
                const tempBackup = path.join(this.backupDir, `pre_restore_${Date.now()}.sqlite`);
                if (fs.existsSync(this.dbPath)) {
                    fs.copyFileSync(this.dbPath, tempBackup);
                    logger.info(`Pre-restore backup created: ${path.basename(tempBackup)}`);
                }
            } catch (e) {
                logger.warn('Failed to create pre-restore backup:', e.message);
            }

            // Overwrite database
            fs.copyFileSync(sourcePath, this.dbPath);
            logger.info('Database restored successfully from:', sourcePath);

            return { success: true };
        } catch (error) {
            logger.error('Database restore failed:', error);
            throw error;
        }
    }
}

module.exports = new BackupManager();
