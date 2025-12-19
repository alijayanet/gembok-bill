#!/usr/bin/env node

/**
 * Script untuk mempersiapkan deploy via GitHub
 * Memastikan semua file yang diperlukan sudah siap
 */

const fs = require('fs');
const path = require('path');

class GitHubDeployPreparer {
    constructor() {
        this.projectRoot = path.join(__dirname, '..');
        this.backupPath = path.join(this.projectRoot, 'data/backup');
    }

    async createGitIgnore() {
        console.log('📝 Membuat .gitignore...');
        
        const gitignoreContent = `
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Database files
data/billing.db
data/billing.db-wal
data/billing.db-shm
data/test-*.db

# Logs
logs/*.log
*.log

# WhatsApp session
whatsapp-session/
*.session

# Backup files
data/backup/*.db
data/backup/*.json
data/backup/*.sql
data/backup/*.sh

# Environment files
.env
.env.local
.env.production

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# IDE files
.vscode/
.idea/
*.swp
*.swo

# Temporary files
tmp/
temp/
*.tmp
*.temp

# PM2 files
.pm2/
`;

        const gitignoreFile = path.join(this.projectRoot, '.gitignore');
        fs.writeFileSync(gitignoreFile, gitignoreContent);
        
        console.log('✅ .gitignore berhasil dibuat');
        return gitignoreFile;
    }

    async createDeployScript() {
        console.log('🚀 Membuat script deploy untuk GitHub...');
        
        const deployScript = `#!/bin/bash

# Script deploy untuk GitHub
# Generated: ${new Date().toISOString()}

echo "🚀 Memulai deploy dari GitHub..."

# 1. Update dari GitHub
echo "📥 Update dari GitHub..."
git pull origin main

# 2. Install dependencies
echo "📦 Install dependencies..."
npm install

# 3. Buat direktori yang diperlukan
echo "📁 Membuat direktori yang diperlukan..."
mkdir -p data/backup
mkdir -p logs
mkdir -p whatsapp-session

# 4. Set permissions
echo "🔐 Mengatur permissions..."
chmod 755 data/
chmod 755 logs/
chmod 755 whatsapp-session/
chmod 644 settings.json

# 5. Restart aplikasi (jika menggunakan PM2)
echo "🔄 Restart aplikasi..."
pm2 restart gembok-bill || pm2 start app.js --name gembok-bill

# 6. Verifikasi
echo "✅ Verifikasi deploy..."
pm2 status gembok-bill

echo "🎉 Deploy selesai!"
`;

        const deployFile = path.join(this.projectRoot, 'deploy.sh');
        fs.writeFileSync(deployFile, deployScript);
        fs.chmodSync(deployFile, '755');
        
        console.log('✅ Script deploy berhasil dibuat');
        return deployFile;
    }

    async createServerSettingsTemplate() {
        console.log('⚙️ Membuat template settings untuk server...');
        
        const serverSettingsTemplate = {
            "admins.0": "6281947215703",
            "admin_username": "admin",
            "admin_password": "admin",
            "genieacs_url": "http://SERVER_IP:7557",
            "genieacs_username": "admin",
            "genieacs_password": "admin",
            "mikrotik_host": "SERVER_IP",
            "mikrotik_port": "8728",
            "mikrotik_user": "admin",
            "mikrotik_password": "admin",
            "main_interface": "ether1-ISP",
            "pppoe_monitor_enable": true,
            "technician_numbers.0": "62838076656",
            "technician_numbers.1": "62822180947",
            "technician_group_id": "120363031495796203@g.us",
            "whatsapp_keep_alive": true,
            "whatsapp_restart_on_error": true,
            "rx_power_warning": "-35",
            "rx_power_critical": "-37",
            "rx_power_notification_enable": true,
            "rx_power_warning_interval": "36000000",
            "company_header": "GEMBOK-BILL",
            "footer_info": "Info Hubungi : 081947215703",
            "app_name": "GEMBOK-BILLING",
            "customerPortalOtp": false,
            "otp_length": "4",
            "otp_expiry_minutes": "5",
            "server_host": "SERVER_IP",
            "server_port": "3003",
            "pppoe_notifications.enabled": true,
            "pppoe_notifications.loginNotifications": true,
            "pppoe_notifications.logoutNotifications": true,
            "pppoe_notifications.includeOfflineList": true,
            "pppoe_notifications.maxOfflineListCount": "20",
            "trouble_report.enabled": true,
            "trouble_report.categories": "Internet Lambat,Tidak Bisa Browsing,WiFi Tidak Muncul,Koneksi Putus-Putus,Lainnya",
            "trouble_report.auto_ticket": true,
            "rxpower_recap_enable": true,
            "rxpower_recap_interval": "21600000",
            "offline_notification_enable": true,
            "offline_notification_interval": "43200000",
            "offline_device_threshold_hours": "24",
            "user_auth_mode": "mikrotik",
            "logo_filename": "logo.png",
            "company_website": "https://alijaya.net",
            "company_slogan": "Solusi Internet Terdepan",
            "invoice_notes": "Pembayaran dapat dilakukan melalui transfer bank atau pembayaran tunai di kantor kami. Terima kasih atas kepercayaan Anda.",
            "payment_bank_name": "BRI",
            "payment_account_number": "4206-01-003953-53-1",
            "payment_account_holder": "WARJAYA",
            "payment_cash_address": "Jl. Pantai Tanjungpura Desa Ujunggebang",
            "payment_cash_hours": "08:00 - 20:00",
            "contact_phone": "081-9472-15703",
            "contact_email": "alijayanet@gmail.com",
            "contact_address": "Jl. Pantai Tanjungpura Desa Ujunggebang",
            "contact_whatsapp": "081947215703",
            "payment_gateway": {
                "active": "midtrans",
                "midtrans": {
                    "enabled": true,
                    "production": false,
                    "server_key": "SB-Mid-server-XXXXXXXXXXXXXXXXXXXXXXXX",
                    "client_key": "SB-Mid-client-XXXXXXXXXXXXXXXXXXXXXXXX",
                    "merchant_id": "G123456789"
                },
                "xendit": {
                    "enabled": false,
                    "production": false,
                    "api_key": "xnd_public_development_XXXXXXXXXXXXXXXXXXXXXXXX",
                    "callback_token": "your_callback_token_here"
                },
                "tripay": {
                    "enabled": true,
                    "production": false,
                    "api_key": "your_tripay_api_key_here",
                    "private_key": "your_tripay_private_key_here",
                    "merchant_code": "your_merchant_code_here"
                }
            },
            "auto_suspension_enabled": true,
            "suspension_grace_period_days": "1",
            "isolir_profile": "isolir",
            "static_ip_suspension_method": "address_list",
            "suspension_bandwidth_limit": "1k/1k",
            "whatsapp_rate_limit": {
                "maxMessagesPerBatch": 10,
                "delayBetweenBatches": 30,
                "delayBetweenMessages": 2,
                "maxRetries": 2,
                "dailyMessageLimit": 0,
                "enabled": true
            },
            "app_version": "2.1.1",
            "version_name": "WhatsApp Modular + Role System + Network Mapping",
            "version_date": "2025-09-30",
            "version_notes": "Added technician role, trouble report, PPPoE WhatsApp commands, PPN feature, and Network Mapping",
            "build_number": "20250930",
            "rx_power_warning_interval_hours": "10",
            "rxpower_recap_interval_hours": "6",
            "offline_notification_interval_hours": "12",
            "voucher_cleanup": {
                "enabled": true,
                "expiry_hours": "24",
                "cleanup_interval_hours": "6",
                "delete_expired_invoices": true,
                "log_cleanup_actions": true
            },
            "hotspot_config": {
                "wifi_name": "GEMBOK-WIFI",
                "hotspot_url": "http://SERVER_IP",
                "hotspot_ip": "SERVER_IP"
            }
        };

        const templateFile = path.join(this.projectRoot, 'settings.server.template.json');
        fs.writeFileSync(templateFile, JSON.stringify(serverSettingsTemplate, null, 2));
        
        console.log('✅ Template settings server berhasil dibuat');
        return templateFile;
    }

    async createReadmeForDeploy() {
        console.log('📖 Membuat README untuk deploy...');
        
        const readmeContent = `# 🚀 GEMBOK-BILL - Deploy Guide

## 📋 Quick Deploy

### 1. Clone Repository
\`\`\`bash
git clone https://github.com/alijayanet/gembok-bill
cd gembok-bill
\`\`\`

### 2. Install Dependencies
\`\`\`bash
npm install
\`\`\`

### 3. Configure Settings
\`\`\`bash
# Copy template settings
cp settings.server.template.json settings.json

# Edit settings sesuai server
nano settings.json
\`\`\`

### 4. Setup Database
\`\`\`bash
# Database akan dibuat otomatis saat pertama kali run
# Atau restore dari backup:
# cp backup/billing.db data/billing.db
\`\`\`

### 5. Run Application
\`\`\`bash
# Development
npm run dev

# Production
npm start

# Atau dengan PM2
pm2 start app.js --name gembok-bill
pm2 save
pm2 startup
\`\`\`

## 🔧 Configuration

### Server Settings
Edit \`settings.json\` dengan konfigurasi server Anda:

- **server_host**: IP server Anda
- **server_port**: Port aplikasi (default: 3003)
- **genieacs_url**: URL GenieACS server
- **mikrotik_host**: IP Mikrotik router
- **admin_password**: Password admin (ubah dari default)

### Database
- Database SQLite akan dibuat otomatis di \`data/billing.db\`
- Backup database tersimpan di \`data/backup/\`
- Restore database via admin panel

### WhatsApp Bot
- WhatsApp session akan dibuat otomatis
- Scan QR code saat pertama kali run
- Session tersimpan di \`whatsapp-session/\`

## 📊 Features

### ✅ Backup & Restore
- Database backup otomatis
- Manual backup via admin panel
- Restore database dengan mudah
- Export data ke Excel

### ✅ Export Excel
- Export customers lengkap
- Export financial reports
- Export dengan styling dan summary

### ✅ WhatsApp Bot
- Admin commands
- Technician commands
- Customer commands
- Auto-notifications

### ✅ Network Mapping
- ODP management
- Cable routing
- Real-time device status
- Technician access

## 🔧 Troubleshooting

### Database Error
\`\`\`bash
# Cek permissions
chmod 755 data/
chmod 644 data/billing.db

# Restore dari backup
cp data/backup/latest.db data/billing.db
\`\`\`

### Dependencies Error
\`\`\`bash
# Clear cache dan install ulang
rm -rf node_modules package-lock.json
npm install
\`\`\`

### WhatsApp Error
\`\`\`bash
# Hapus session dan restart
rm -rf whatsapp-session/
pm2 restart gembok-bill
\`\`\`

## 📞 Support

- **Documentation**: README.md
- **Issues**: GitHub Issues
- **Contact**: 081947215703

---

**GEMBOK-BILL v2.1.1** - WhatsApp Modular + Role System + Network Mapping
`;

        const readmeFile = path.join(this.projectRoot, 'DEPLOY_README.md');
        fs.writeFileSync(readmeFile, readmeContent);
        
        console.log('✅ README deploy berhasil dibuat');
        return readmeFile;
    }

    async createPackageJsonScripts() {
        console.log('📦 Menambahkan scripts ke package.json...');
        
        try {
            const packageJsonPath = path.join(this.projectRoot, 'package.json');
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            
            // Tambahkan scripts untuk deploy
            packageJson.scripts = {
                ...packageJson.scripts,
                "deploy": "git pull origin main && npm install && pm2 restart gembok-bill",
                "backup": "node scripts/fix-backup-restore.js",
                "sync": "node scripts/sync-server-data.js",
                "check": "node scripts/check-deploy-readiness.js"
            };

            fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
            
            console.log('✅ Scripts berhasil ditambahkan ke package.json');
            return true;
        } catch (error) {
            console.log('❌ Error menambahkan scripts:', error.message);
            return false;
        }
    }

    async runPreparation() {
        console.log('🚀 Memulai persiapan deploy via GitHub...\n');
        
        // 1. Buat .gitignore
        await this.createGitIgnore();
        console.log('');
        
        // 2. Buat script deploy
        await this.createDeployScript();
        console.log('');
        
        // 3. Buat template settings server
        await this.createServerSettingsTemplate();
        console.log('');
        
        // 4. Buat README deploy
        await this.createReadmeForDeploy();
        console.log('');
        
        // 5. Tambahkan scripts ke package.json
        await this.createPackageJsonScripts();
        console.log('');
        
        console.log('✅ Persiapan deploy selesai!');
        console.log('');
        console.log('📁 File yang dibuat:');
        console.log('  - .gitignore');
        console.log('  - deploy.sh');
        console.log('  - settings.server.template.json');
        console.log('  - DEPLOY_README.md');
        console.log('  - package.json (updated)');
        console.log('');
        console.log('📝 Langkah selanjutnya:');
        console.log('1. Commit semua file ke GitHub');
        console.log('2. Clone repository di server');
        console.log('3. Jalankan npm install');
        console.log('4. Konfigurasi settings.json');
        console.log('5. Jalankan aplikasi');
    }
}

// Main execution
async function main() {
    const preparer = new GitHubDeployPreparer();
    await preparer.runPreparation();
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = GitHubDeployPreparer;
