/**
 * Telegram Bot Command Handlers
 * Handles all bot commands and user interactions
 */

const { Markup } = require('telegraf');
const TelegramAuth = require('./telegramAuth');
const telegramAuth = new TelegramAuth();
const mikrotikManager = require('./mikrotik');
const billingManager = require('./billing');
const { getSetting } = require('./settingsManager');

// Customer OTP cache (in production, use Redis or database with expiry)
const customerOtpCache = {};

class TelegramCommands {
    constructor(bot) {
        this.bot = bot;
        this.setupCommands();
    }

    /**
     * Setup all command handlers
     */
    setupCommands() {
        // Authentication commands
        this.bot.command('login', this.handleLogin.bind(this));
        this.bot.command('logout', this.handleLogout.bind(this));
        this.bot.command('whoami', this.handleWhoami.bind(this));

        // Dashboard commands
        this.bot.command('dashboard', this.handleDashboard.bind(this));
        this.bot.command('stats', this.handleStats.bind(this));

        // Customer commands
        this.bot.command('pelanggan', this.handlePelanggan.bind(this));

        // Invoice commands
        this.bot.command('invoice', this.handleInvoice.bind(this));
        this.bot.command('bayar', this.handleBayar.bind(this));
        this.bot.command('billing', this.handleBilling.bind(this));

        // MikroTik PPPoE commands
        this.bot.command('pppoe', this.handlePPPoE.bind(this));

        // MikroTik Hotspot commands
        this.bot.command('hotspot', this.handleHotspot.bind(this));
        this.bot.command('voucher', this.handleVoucher.bind(this));

        // MikroTik system commands
        this.bot.command('mikrotik', this.handleMikrotik.bind(this));
        this.bot.command('wifi', this.handleWifi.bind(this));
        this.bot.command('rebootONU', this.handleOnuRestart.bind(this));

        // MikroTik management commands
        this.bot.command('firewall', this.handleFirewall.bind(this));
        this.bot.command('queue', this.handleQueue.bind(this));
        this.bot.command('ip', this.handleIP.bind(this));

        // GenieACS ONU commands
        this.bot.command('onu', this.handleONU.bind(this));

        // Customer commands
        this.bot.command('loginpelanggan', this.handleCustomerLogin.bind(this));
        this.bot.command('verifyotp', this.handleCustomerVerifyOTP.bind(this));
        this.bot.command('cektagihan', this.handleCustomerCheckBilling.bind(this));
        this.bot.command('gantissid', this.handleCustomerChangeSSID.bind(this));
        this.bot.command('gantipassword', this.handleCustomerChangePassword.bind(this));
        this.bot.command('statuspelanggan', this.handleCustomerStatus.bind(this));
        this.bot.command('logoutpelanggan', this.handleCustomerLogout.bind(this));

        // Help and Menu commands
        this.bot.command('menu', this.handleMenu.bind(this));
        this.bot.command('help', this.handleHelp.bind(this));
        this.bot.command('start', this.handleStart.bind(this));
        this.bot.command('cari', this.handleCari.bind(this));

        // Handle Callback Queries (Buttons)
        this.bot.on('callback_query', this.handleCallbackQuery.bind(this));
    }

    /**
     * Check authentication middleware
     */
    async checkAuth(ctx) {
        const session = await telegramAuth.getSession(ctx.from.id);
        if (!session) {
            await ctx.reply('❌ Anda belum login. Gunakan /login <username> <password>');
            return null;
        }
        return session;
    }

    /**
     * Handle /start command
     */
    async handleStart(ctx) {
        const welcomeMessage = `
🤖 *Selamat datang di GEMBOK-BILL Bot*

Bot ini membantu Anda mengelola sistem ISP dengan mudah melalui Telegram.

*Untuk memulai:*
1️⃣ Login dengan: \`/login <username> <password>\`
2️⃣ Buka Menu Interaktif: \`/menu\`

*Contoh Login:*
• Admin: \`/login admin admin\`
• Teknisi: \`/login 081234567890 081234567890\`
        `;

        await ctx.replyWithMarkdown(welcomeMessage, Markup.inlineKeyboard([
            [Markup.button.callback('📱 Buka Menu Utama', 'main_menu')]
        ]));
    }

    /**
     * Handle /help command
     */
    async handleHelp(ctx) {
        const session = await telegramAuth.getSession(ctx.from.id);

        let helpMessage = `
📚 *GEMBOK-BILL Bot - Panduan Penggunaan*

*🔐 Authentication:*
• \`/login <username> <password>\` - Login ke bot
• \`/logout\` - Logout dari session
• \`/whoami\` - Cek info session
• \`/menu\` - Buka menu interaktif

*📊 Dashboard:*
• \`/dashboard\` - Tampilkan dashboard
• \`/stats\` - Statistik sistem

*👤 Pelanggan:*
• \`/pelanggan list\` - List semua pelanggan
• \`/pelanggan cek <phone>\` - Cek status pelanggan
• \`/pelanggan suspend <phone>\` - Suspend layanan
• \`/pelanggan restore <phone>\` - Restore layanan

*🧾 Invoice:*
• \`/invoice unpaid\` - List invoice belum bayar
• \`/invoice paid <phone>\` - List invoice sudah bayar
• \`/invoice overdue\` - List invoice overdue
• \`/invoice cek <phone>\` - Cek invoice pelanggan
• \`/invoice detail <invoice_id>\` - Detail invoice
• \`/invoice create <phone> <amount> <notes>\` - Buat invoice manual
• \`/bayar <invoice_id>\` - Proses pembayaran

*📊 Billing:*
• \`/billing stats\` - Statistik billing
• \`/billing report <bulan>\` - Laporan bulanan

*🌐 PPPoE:*
• \`/pppoe list\` - List PPPoE users
• \`/pppoe status <username>\` - Cek status
• \`/pppoe add <user> <pass> <profile>\` - Tambah user
• \`/pppoe edit <user> <field> <value>\` - Edit user
• \`/pppoe delete <username>\` - Hapus user
• \`/pppoe enable <username>\` - Enable user
• \`/pppoe disable <username>\` - Disable user
• \`/pppoe restore <username>\` - Restore user

*🎫 Hotspot:*
• \`/hotspot list\` - List hotspot users
• \`/hotspot status <username>\` - Cek status
• \`/hotspot add <user> <pass> <profile>\` - Tambah user
• \`/hotspot delete <username>\` - Hapus user
• \`/voucher <username> <profile>\` - Buat voucher

*⚙️ MikroTik System:*
• \`/mikrotik info\` - Info sistem MikroTik
• \`/mikrotik cpu\` - CPU usage
• \`/mikrotik memory\` - Memory usage
• \`/mikrotik interfaces\` - Daftar interface
• \`/mikrotik active\` - Koneksi aktif
• \`/mikrotik bandwidth\` - Bandwidth usage
• \`/mikrotik reboot\` - Reboot MikroTik
• \`/mikrotik logs\` - Lihat logs

*🔧 Management:*
• \`/firewall list\` - List firewall rules
• \`/firewall add <chain> <src> <action>\` - Tambah rule
• \`/firewall delete <id>\` - Hapus rule
• \`/queue list\` - List queue rules
• \`/queue add <name> <target> <limit>\` - Tambah queue
• \`/queue delete <id>\` - Hapus queue
• \`/ip list\` - List IP addresses
• \`/ip add <address> <interface>\` - Tambah IP
• \`/ip delete <id>\` - Hapus IP

*🔧 Technical:*
• \`/cari <nama atau no hp>\` - Cari pelanggan
• \`/wifi <phone> <ssid> <password>\` - Ganti WiFi
• \`/rebootONU <phone>\` - Restart ONU

*📡 GenieACS ONU:*
• \`/onu list\` - List semua ONU devices
• \`/onu status <phone>\` - Cek status ONU
• \`/onu info <phone>\` - Info detail ONU
• \`/onu tag <phone> <tag>\` - Tambah tag
• \`/onu untag <phone> <tag>\` - Hapus tag
• \`/onu factoryreset <phone>\` - Factory reset (admin only)

*👨‍👩‍👧 Customer Portal:*
• \`/loginpelanggan <phone> <password>\` - Login sebagai pelanggan
• \`/cektagihan\` - Cek tagihan Anda
• \`/statuspelanggan\` - Cek status layanan
• \`/gantissid <ssid>\` - Ganti WiFi SSID
• \`/gantipassword <password>\` - Ganti WiFi password
• \`/logoutpelanggan\` - Logout
        `;

        if (session && telegramAuth.isAdmin(session)) {
            helpMessage += `\n*🔧 Admin Only:*
• \`/mikrotik reboot\` - Reboot MikroTik
• Full access to all features
            `;
        }

        await ctx.replyWithMarkdown(helpMessage, Markup.inlineKeyboard([
            [Markup.button.callback('📱 Buka Menu Utama', 'main_menu')]
        ]));
    }

    /**
     * Handle /menu command
     */
    async handleMenu(ctx) {
        const session = await telegramAuth.getSession(ctx.from.id);

        if (!session) {
            return await ctx.reply('❌ Anda belum login. Silakan login terlebih dahulu dengan:\n`/login <username> <password>`', { parse_mode: 'Markdown' });
        }

        const menuKeyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('📊 Dashboard', 'menu_dashboard'),
                Markup.button.callback('📈 Statistik', 'menu_stats')
            ],
            [
                Markup.button.callback('👥 Pelanggan', 'menu_customers'),
                Markup.button.callback('🧾 Tagihan', 'menu_invoices')
            ],
            [
                Markup.button.callback('🌐 PPPoE', 'menu_pppoe'),
                Markup.button.callback('🎫 Hotspot', 'menu_hotspot')
            ],
            [
                Markup.button.callback('⚙️ MikroTik', 'menu_mikrotik'),
                Markup.button.callback('🚪 Logout', 'menu_logout')
            ]
        ]);

        await ctx.reply('📱 *Menu Utama GEMBOK-BILLING*', {
            parse_mode: 'Markdown',
            ...menuKeyboard
        });
    }

    /**
     * Handle Callback Queries from Buttons
     */
    async handleCallbackQuery(ctx) {
        const action = ctx.callbackQuery.data;
        const userId = ctx.from.id;

        try {
            // Check auth for all menu actions except 'main_menu'
            if (action !== 'main_menu') {
                const session = await telegramAuth.getSession(userId);
                if (!session) {
                    await ctx.answerCbQuery('❌ Session expired. Please login again.');
                    return await ctx.reply('❌ Anda belum login. Gunakan /login <username> <password>');
                }
            }

            // Answer callback query to stop loading state in Telegram
            await ctx.answerCbQuery();

            // Handle dynamic actions
            if (action.startsWith('pay_inv_')) {
                const invId = action.replace('pay_inv_', '');
                return await this.handleProcessPayment(ctx, invId);
            }

            switch (action) {
                case 'main_menu':
                    await this.handleMenu(ctx);
                    break;
                case 'menu_dashboard':
                    await this.handleDashboard(ctx);
                    break;
                case 'menu_stats':
                    await this.handleStats(ctx);
                    break;
                case 'menu_customers':
                    // Just show help for now or list 10 first
                    await this.handlePelangganList(ctx);
                    break;
                case 'menu_invoices':
                    await this.handleInvoiceMenu(ctx);
                    break;
                case 'menu_pppoe':
                    await this.handlePPPoEMenu(ctx);
                    break;

                // Invoice/Payment Actions
                case 'invoice_unpaid':
                    await this.handleInvoiceUnpaid(ctx);
                    break;
                case 'invoice_search_info':
                    await ctx.reply('🔍 *Cari Tagihan*\n\nKetik perintah:\n`/cari <nama atau no hp>`\n\nContoh:\n`/cari budi` atau `/cari 0812`', { parse_mode: 'Markdown' });
                    break;
                case 'menu_hotspot':
                    await this.handleHotspotMenu(ctx);
                    break;
                case 'menu_mikrotik':
                    await this.handleMikrotikInfo(ctx);
                    break;
                case 'menu_logout':
                    await this.handleLogout(ctx);
                    break;

                // Technical Actions
                case action.startsWith('wifi_info_') ? action : '___':
                    const phoneW = action.replace('wifi_info_', '');
                    await ctx.reply(`🔧 *Ganti SSID & Password WiFi*\n\nKetik perintah:\n\`/wifi ${phoneW} "NAMA_WIFI_BARU" "PASSWORD_BARU"\`\n\n*Penting:* Gunakan tanda kutip jika nama WiFi mengandung spasi.`, { parse_mode: 'Markdown' });
                    break;

                case action.startsWith('reboot_onu_') ? action : '___':
                    const phoneR = action.replace('reboot_onu_', '');
                    await this.handleOnuRestart(ctx, phoneR);
                    break;


                // PPPoE Actions
                case 'pppoe_list':
                    await this.handlePPPoEList(ctx);
                    break;
                case 'pppoe_status_info':
                    await ctx.reply('🔍 *Cek Status PPPoE*\n\nKetik perintah:\n`/pppoe status <username>`', { parse_mode: 'Markdown' });
                    break;
                case 'pppoe_add_info':
                    await ctx.reply('➕ *Tambah User PPPoE*\n\nKetik perintah:\n`/pppoe add <user> <pass> <profile>`\n\nContoh:\n`/pppoe add budi 123456 default`', { parse_mode: 'Markdown' });
                    break;
                case 'pppoe_delete_info':
                    await ctx.reply('❌ *Hapus User PPPoE*\n\nKetik perintah:\n`/pppoe delete <username>`', { parse_mode: 'Markdown' });
                    break;

                // Hotspot Actions
                case 'hotspot_list':
                    await this.handleHotspot(ctx); // Shows active list info
                    break;
                case 'hotspot_add_info':
                    await ctx.reply('➕ *Tambah User Hotspot*\n\nKetik perintah:\n`/hotspot add <user> <pass> <profile>`', { parse_mode: 'Markdown' });
                    break;
                case 'hotspot_voucher_info':
                    await ctx.reply('🎫 *Buat Voucher Hotspot*\n\nKetik perintah:\n`/voucher <jumlah> <profile>`', { parse_mode: 'Markdown' });
                    break;
                case 'hotspot_delete_info':
                    await ctx.reply('❌ *Hapus User Hotspot*\n\nKetik perintah:\n`/hotspot delete <username>`', { parse_mode: 'Markdown' });
                    break;

                default:
                    await ctx.reply('⚠️ Menu belum tersedia.');
            }
        } catch (error) {
            console.error('Callback error:', error);
            await ctx.reply('❌ Terjadi kesalahan saat memproses menu.');
        }
    }

    /**
     * Handle PPPoE Menu
     */
    async handlePPPoEMenu(ctx) {
        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('📋 List User', 'pppoe_list'),
                Markup.button.callback('🔍 Cek Status', 'pppoe_status_info')
            ],
            [
                Markup.button.callback('➕ Tambah User', 'pppoe_add_info'),
                Markup.button.callback('❌ Hapus User', 'pppoe_delete_info')
            ],
            [
                Markup.button.callback('🔙 Kembali ke Menu Utama', 'main_menu')
            ]
        ]);

        const text = '🌐 *Manajemen PPPoE MikroTik*\n\nSilakan pilih tindakan yang ingin dilakukan:';

        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        } else {
            await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        }
    }

    /**
     * Handle Hotspot Menu
     */
    async handleHotspotMenu(ctx) {
        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('📋 List Aktif', 'hotspot_list'),
                Markup.button.callback('🎫 Buat Voucher', 'hotspot_voucher_info')
            ],
            [
                Markup.button.callback('➕ Tambah User', 'hotspot_add_info'),
                Markup.button.callback('❌ Hapus User', 'hotspot_delete_info')
            ],
            [
                Markup.button.callback('🔙 Kembali ke Menu Utama', 'main_menu')
            ]
        ]);

        const text = '🎫 *Manajemen Hotspot MikroTik*\n\nSilakan pilih tindakan yang ingin dilakukan:';

        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        } else {
            await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        }
    }

    /**
     * Handle /login command
     */
    async handleLogin(ctx) {
        const args = ctx.message.text.split(' ').slice(1);

        if (args.length < 2) {
            await ctx.reply('❌ Format: /login <username> <password>\n\nContoh:\n/login admin admin\n/login 081234567890 081234567890');
            return;
        }

        const [username, password] = args;

        try {
            // Authenticate user
            const user = await telegramAuth.authenticate(username, password);

            // Create session
            await telegramAuth.createSession(ctx.from.id, user);

            const roleEmoji = user.role === 'admin' ? '👑' : user.role === 'technician' ? '🔧' : '👤';

            await ctx.reply(
                `✅ Login berhasil!\n\n` +
                `${roleEmoji} Nama: ${user.name}\n` +
                `📋 Role: ${user.role}\n` +
                `⏰ Session: 24 jam\n\n` +
                `Ketik /help untuk melihat perintah yang tersedia.`
            );
        } catch (error) {
            console.error('Login error:', error);
            await ctx.reply('❌ Login gagal! Username atau password salah.');
        }
    }

    /**
     * Handle /logout command
     */
    async handleLogout(ctx) {
        try {
            const deleted = await telegramAuth.deleteSession(ctx.from.id);
            if (deleted) {
                await ctx.reply('✅ Logout berhasil! Session telah dihapus.');
            } else {
                await ctx.reply('ℹ️ Anda belum login.');
            }
        } catch (error) {
            console.error('Logout error:', error);
            await ctx.reply('❌ Terjadi kesalahan saat logout.');
        }
    }

    /**
     * Handle /whoami command
     */
    async handleWhoami(ctx) {
        const session = await telegramAuth.getSession(ctx.from.id);

        if (!session) {
            await ctx.reply('❌ Anda belum login. Gunakan /login <username> <password>');
            return;
        }

        const expiresAt = new Date(session.expires_at);
        const now = new Date();
        const hoursLeft = Math.round((expiresAt - now) / (1000 * 60 * 60));

        const roleEmoji = session.role === 'admin' ? '👑' : session.role === 'technician' ? '🔧' : '👤';

        await ctx.reply(
            `${roleEmoji} *Session Info*\n\n` +
            `👤 Username: ${session.username}\n` +
            `📋 Role: ${session.role}\n` +
            `🕐 Login: ${new Date(session.login_time).toLocaleString('id-ID')}\n` +
            `⏰ Expires: ${hoursLeft} jam lagi\n` +
            `📱 Telegram ID: ${session.telegram_user_id}`,
            { parse_mode: 'Markdown' }
        );
    }

    /**
     * Handle /dashboard command
     */
    async handleDashboard(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        try {
            await ctx.reply('⏳ Memuat dashboard...');

            // Get statistics
            const customers = await billingManager.getAllCustomers();
            const activeCustomers = customers.filter(c => c.status === 'active');
            const suspendedCustomers = customers.filter(c => c.status === 'suspended');

            const allInvoices = await billingManager.getAllInvoices();
            const unpaidInvoices = allInvoices.filter(i => i.status === 'unpaid');
            const totalUnpaid = unpaidInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);

            const message = `
📊 *Dashboard GEMBOK-BILL*

👥 *Pelanggan:*
• Total: ${customers.length}
• Aktif: ${activeCustomers.length}
• Suspend: ${suspendedCustomers.length}

🧾 *Invoice:*
• Belum Bayar: ${unpaidInvoices.length}
• Total Tagihan: Rp ${totalUnpaid.toLocaleString('id-ID')}

⏰ Update: ${new Date().toLocaleString('id-ID')}
            `;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            console.error('Dashboard error:', error);
            await ctx.reply('❌ Gagal memuat dashboard: ' + error.message);
        }
    }

    /**
     * Handle /stats command
     */
    async handleStats(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        try {
            await ctx.reply('⏳ Memuat statistik...');

            const customers = await billingManager.getAllCustomers();
            const packages = await billingManager.getAllPackages();
            const invoices = await billingManager.getAllInvoices();
            const payments = await billingManager.getAllPayments();

            const paidInvoices = invoices.filter(i => i.status === 'paid');
            const totalRevenue = paidInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
            const totalPayments = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

            const message = `
📈 *Statistik Sistem*

📦 *Paket:* ${packages.length}
👥 *Pelanggan:* ${customers.length}
🧾 *Invoice:* ${invoices.length}
💰 *Pembayaran:* ${payments.length}

💵 *Revenue:*
• Total: Rp ${totalRevenue.toLocaleString('id-ID')}
• Dari Payments: Rp ${totalPayments.toLocaleString('id-ID')}

⏰ Update: ${new Date().toLocaleString('id-ID')}
            `;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            console.error('Stats error:', error);
            await ctx.reply('❌ Gagal memuat statistik: ' + error.message);
        }
    }

    /**
     * Handle /pelanggan command
     */
    async handlePelanggan(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply(
                '📋 *Perintah Pelanggan:*\n\n' +
                '• `/pelanggan list` - List semua pelanggan\n' +
                '• `/pelanggan cek <phone>` - Cek status\n' +
                '• `/pelanggan suspend <phone>` - Suspend\n' +
                '• `/pelanggan restore <phone>` - Restore',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const subCommand = args[0];

        try {
            switch (subCommand) {
                case 'list':
                    await this.handlePelangganList(ctx);
                    break;
                case 'cek':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /pelanggan cek <phone>');
                        return;
                    }
                    await this.handlePelangganCek(ctx, args[1]);
                    break;
                case 'suspend':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /pelanggan suspend <phone>');
                        return;
                    }
                    await this.handlePelangganSuspend(ctx, args[1], session);
                    break;
                case 'restore':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /pelanggan restore <phone>');
                        return;
                    }
                    await this.handlePelangganRestore(ctx, args[1], session);
                    break;
                default:
                    await ctx.reply('❌ Sub-command tidak dikenal. Gunakan: list, cek, suspend, restore');
            }
        } catch (error) {
            console.error('Pelanggan command error:', error);
            await ctx.reply('❌ Terjadi kesalahan: ' + error.message);
        }
    }

    /**
     * Handle pelanggan list
     */
    async handlePelangganList(ctx) {
        await ctx.reply('⏳ Memuat daftar pelanggan...');

        const customers = await billingManager.getAllCustomers();

        if (customers.length === 0) {
            await ctx.reply('ℹ️ Belum ada pelanggan.');
            return;
        }

        // Limit to first 20 customers
        const displayCustomers = customers.slice(0, 20);

        let message = `👥 *Daftar Pelanggan* (${customers.length} total)\n\n`;

        displayCustomers.forEach((customer, index) => {
            const statusEmoji = customer.status === 'active' ? '✅' : '⏸️';
            message += `${index + 1}. ${statusEmoji} ${customer.name}\n`;
            message += `   📞 ${customer.phone || 'N/A'}\n`;
            message += `   👤 ${customer.username || 'N/A'}\n\n`;
        });

        if (customers.length > 20) {
            message += `\n_Menampilkan 20 dari ${customers.length} pelanggan_`;
        }

        await ctx.replyWithMarkdown(message);
    }

    /**
     * Handle pelanggan cek
     */
    async handlePelangganCek(ctx, phone) {
        await ctx.reply('⏳ Mencari pelanggan...');

        const customer = await billingManager.getCustomerByPhone(phone);

        if (!customer) {
            await ctx.reply(`❌ Pelanggan dengan nomor ${phone} tidak ditemukan.`);
            return;
        }

        await this.handleShowDetailedCustomerInfo(ctx, customer);
    }

    /**
     * Handle pelanggan suspend
     */
    async handlePelangganSuspend(ctx, phone, session) {
        if (!telegramAuth.hasPermission(session, ['admin', 'technician'])) {
            await ctx.reply('❌ Anda tidak memiliki akses untuk suspend pelanggan.');
            return;
        }

        await ctx.reply('⏳ Melakukan suspend...');

        const customer = await billingManager.getCustomerByPhone(phone);

        if (!customer) {
            await ctx.reply(`❌ Pelanggan dengan nomor ${phone} tidak ditemukan.`);
            return;
        }

        // Suspend customer
        const serviceSuspension = require('./serviceSuspension');
        await serviceSuspension.suspendCustomer(customer.id, 'Suspended via Telegram Bot');

        await ctx.reply(`✅ Pelanggan ${customer.name} berhasil di-suspend.`);
    }

    /**
     * Handle pelanggan restore
     */
    async handlePelangganRestore(ctx, phone, session) {
        if (!telegramAuth.hasPermission(session, ['admin', 'technician'])) {
            await ctx.reply('❌ Anda tidak memiliki akses untuk restore pelanggan.');
            return;
        }

        await ctx.reply('⏳ Melakukan restore...');

        const customer = await billingManager.getCustomerByPhone(phone);

        if (!customer) {
            await ctx.reply(`❌ Pelanggan dengan nomor ${phone} tidak ditemukan.`);
            return;
        }

        // Restore customer
        const serviceSuspension = require('./serviceSuspension');
        await serviceSuspension.restoreCustomer(customer.id);

        await ctx.reply(`✅ Pelanggan ${customer.name} berhasil di-restore.`);
    }

    /**
     * Handle /invoice command
     */
    async handleInvoice(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply(
                '🧾 *Perintah Invoice:*\n\n' +
                '• `/invoice unpaid` - List invoice belum bayar\n' +
                '• `/invoice paid <phone>` - List invoice sudah bayar\n' +
                '• `/invoice overdue` - List invoice overdue\n' +
                '• `/invoice cek <phone>` - Cek invoice pelanggan\n' +
                '• `/invoice detail <invoice_id>` - Detail invoice\n' +
                '• `/invoice create <phone> <amount> <notes>` - Buat invoice manual',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const subCommand = args[0];

        try {
            switch (subCommand) {
                case 'unpaid':
                    await this.handleInvoiceUnpaid(ctx);
                    break;
                case 'paid':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /invoice paid <phone>');
                        return;
                    }
                    await this.handleInvoicePaid(ctx, args[1]);
                    break;
                case 'overdue':
                    await this.handleInvoiceOverdue(ctx);
                    break;
                case 'cek':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /invoice cek <phone>');
                        return;
                    }
                    await this.handleInvoiceCek(ctx, args[1]);
                    break;
                case 'detail':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /invoice detail <invoice_id>');
                        return;
                    }
                    await this.handleInvoiceDetail(ctx, args[1]);
                    break;
                case 'create':
                    if (args.length < 3) {
                        await ctx.reply('❌ Format: /invoice create <phone> <amount> <notes>');
                        return;
                    }
                    const notes = args.slice(3).join(' ') || 'Manual invoice';
                    await this.handleInvoiceCreate(ctx, args[1], args[2], notes);
                    break;
                default:
                    await ctx.reply('❌ Sub-command tidak dikenal. Gunakan: unpaid, paid, overdue, cek, detail, create');
            }
        } catch (error) {
            console.error('Invoice command error:', error);
            await ctx.reply('❌ Terjadi kesalahan: ' + error.message);
        }
    }

    /**
     * Handle /bayar command
     */
    async handleBayar(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);
        if (args.length === 0) {
            return await ctx.reply('❌ Format: `/bayar <ID_INVOICE>`\n\nContoh: `/bayar 123`\n\nAnda dapat menemukan ID invoice di daftar `/invoice unpaid`', { parse_mode: 'Markdown' });
        }

        const invoiceId = args[0];
        await this.handleProcessPayment(ctx, invoiceId);
    }

    /**
     * Internal helper to process a payment and notify
     */
    async handleProcessPayment(ctx, invoiceId) {
        try {
            await ctx.reply(`⏳ Memproses pembayaran tunai untuk Invoice #${invoiceId}...`);

            // Get invoice details first
            const invoice = await billingManager.getInvoiceById(invoiceId);
            if (!invoice) {
                return await ctx.reply(`❌ Invoice #${invoiceId} tidak ditemukan.`);
            }

            if (invoice.status === 'paid') {
                return await ctx.reply(`✅ Invoice #${invoiceId} sudah dalam status LUNAS.`);
            }

            // Process payment
            const result = await billingManager.processManualPayment(
                invoiceId,
                invoice.amount,
                'cash',
                `TELE-${Date.now()}`,
                `Dibayar tunai via Telegram oleh ${ctx.from.username || ctx.from.id}`
            );

            let successMsg = `✅ *Pembayaran Berhasil Dicatat!*\n\n`;
            successMsg += `📄 Invoice: #${invoiceId}\n`;
            successMsg += `💰 Jumlah: Rp ${parseFloat(invoice.amount).toLocaleString('id-ID')}\n`;
            successMsg += `👤 Pelanggan: ${invoice.customer_name || 'N/A'}\n`;

            if (result.restored) {
                successMsg += `\n🚀 *Layanan internet pelanggan telah otomatis diaktifkan kembali!*`;
            }

            await ctx.reply(successMsg, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Payment processing error:', error);
            await ctx.reply(`❌ Gagal memproses pembayaran: ${error.message}`);
        }
    }

    /**
     * Handle Invoice Menu
     */
    async handleInvoiceMenu(ctx) {
        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('🧾 List Belum Bayar', 'invoice_unpaid')
            ],
            [
                Markup.button.callback('🔍 Cari Tagihan/Pelanggan', 'invoice_search_info')
            ],
            [
                Markup.button.callback('🔙 Kembali ke Menu Utama', 'main_menu')
            ]
        ]);

        const text = '🧾 *Manajemen Tagihan & Pembayaran*\n\nSilakan pilih tindakan:';

        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        } else {
            await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        }
    }

    /**
     * Handle /cari command
     */
    async handleCari(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);
        if (args.length === 0) {
            return await ctx.reply('❌ Format: `/cari <nama atau no hp>`\n\nContoh: `/cari budi`', { parse_mode: 'Markdown' });
        }

        const searchTerm = args.join(' ');
        await ctx.reply(`🔍 Mencari pelanggan: *${searchTerm}*...`, { parse_mode: 'Markdown' });

        try {
            const customers = await billingManager.searchCustomers(searchTerm);

            if (!customers || customers.length === 0) {
                return await ctx.reply(`❌ Tidak ditemukan pelanggan dengan nama/HP: *${searchTerm}*`, { parse_mode: 'Markdown' });
            }

            // Show found customers
            for (const customer of customers) {
                await this.handleShowDetailedCustomerInfo(ctx, customer);
            }

        } catch (error) {
            console.error('Search error:', error);
            await ctx.reply(`❌ Terjadi kesalahan saat mencari: ${error.message}`);
        }
    }

    /**
     * Helper to show combined technical + billing info for a customer
     */
    async handleShowDetailedCustomerInfo(ctx, customer) {
        const statusEmoji = customer.status === 'active' ? '✅' : '⏸️';

        let message = `${statusEmoji} *PROFIL PELANGGAN*\n`;
        message += `━━━━━━━━━━━━━━━━━━━━\n`;
        message += `👤 *Nama:* ${customer.name}\n`;
        message += `📞 *HP:* ${customer.phone}\n`;
        message += `🆔 *User:* ${customer.username || '-'}\n`;
        message += `📍 *Alamat:* ${customer.address || '-'}\n`;
        message += `📊 *Status:* ${customer.status.toUpperCase()}\n`;

        // Try to fetch technical info from GenieACS
        let techMsg = `\n⚙️ *DATA TEKNIS (ONU)*\n`;
        try {
            let acsDevice = null;

            // Try searching by PPPoE or Phone
            if (customer.username) {
                acsDevice = await genieacs.findDeviceByPPPoE(customer.username).catch(() => null);
            }
            if (!acsDevice && customer.phone) {
                acsDevice = await genieacs.findDeviceByPhoneNumber(customer.phone).catch(() => null);
            }

            if (acsDevice) {
                const techSummary = await genieacs.getTechnicalSummary(acsDevice._id);
                if (techSummary) {
                    techMsg += `📟 *S/N:* \`${techSummary.serialNumber}\`\n`;
                    techMsg += `📉 *RX Power:* \`${techSummary.rxPower}\`\n`;
                    techMsg += `📶 *SSID:* ${techSummary.ssid}\n`;
                    techMsg += `⏰ *Uptime:* ${techSummary.uptime}\n`;
                    techMsg += `📦 *Model:* ${techSummary.model}\n`;
                    techMsg += `🔄 *Last Inform:* ${techSummary.lastInform}\n`;
                } else {
                    techMsg += `⚠️ Gagal mengambil detail summary.\n`;
                }
            } else {
                techMsg += `⚠️ Perangkat tidak terhubung/mapping ACS tidak ditemukan.\n`;
            }
        } catch (acsErr) {
            techMsg += `⚠️ Error GenieACS: ${acsErr.message}\n`;
        }

        message += techMsg;

        // Action Buttons for Technical
        const techKeyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('🔧 Pengaturan WiFi', `wifi_info_${customer.phone}`),
                Markup.button.callback('📡 Restart ONU', `reboot_onu_${customer.phone}`)
            ]
        ]);

        // Show Unpaid Invoices
        try {
            const invoices = await billingManager.getInvoicesByCustomerId(customer.id);
            const unpaid = invoices.filter(i => i.status === 'unpaid');

            if (unpaid.length > 0) {
                message += `\n⚠️ *TAGIHAN BELUM BAYAR:*`;
                await ctx.replyWithMarkdown(message, techKeyboard);

                for (const inv of unpaid) {
                    const amount = parseFloat(inv.amount || 0).toLocaleString('id-ID');
                    const invMsg = `📄 *Invoice #${inv.id}*\n💰 Tagihan: Rp ${amount}\n📅 Jatuh Tempo: ${inv.due_date ? new Date(inv.due_date).toLocaleDateString('id-ID') : '-'}`;

                    const keyboard = Markup.inlineKeyboard([
                        [Markup.button.callback('💵 Bayar Tunai', `pay_inv_${inv.id}`)]
                    ]);

                    await ctx.reply(invMsg, { parse_mode: 'Markdown', ...keyboard });
                }
            } else {
                message += `\n✅ *Semua tagihan sudah lunas.*`;
                await ctx.replyWithMarkdown(message, techKeyboard);
            }
        } catch (billErr) {
            message += `\n❌ Gagal memuat data tagihan.\n`;
            await ctx.replyWithMarkdown(message, techKeyboard);
        }
    }

    /**
     * Handle WiFi change command
     * /wifi <phone> <ssid> <password>
     */
    async handleWifi(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        if (!telegramAuth.hasPermission(session, ['admin', 'technician'])) {
            return await ctx.reply('❌ Anda tidak memiliki izin untuk mengubah pengaturan WiFi.');
        }

        const text = ctx.message.text;
        // Regex to match parts, handling quotes for SSID/Pass
        const regex = /^\/wifi\s+(\S+)\s+(?:"([^"]+)"|(\S+))\s+(?:"([^"]+)"|(\S+))/;
        const matches = text.match(regex);

        if (!matches) {
            return await ctx.reply('❌ Format salah.\nContoh: \`/wifi 0812xxx "My WiFi" "password123"\`', { parse_mode: 'Markdown' });
        }

        const phone = matches[1];
        const ssid = matches[2] || matches[3];
        const password = matches[4] || matches[5];

        await ctx.reply(`⏳ Menyiapkan pembaruan WiFi untuk pelanggan *${phone}*...\nSSID: \`${ssid}\`\nPass: \`${password}\``, { parse_mode: 'Markdown' });

        try {
            const device = await genieacs.findDeviceByPhoneNumber(phone);
            if (!device) {
                return await ctx.reply('❌ Perangkat tidak ditemukan di GenieACS.');
            }

            await genieacs.setParameterValues(device._id, {
                'SSID': ssid,
                'Password': password
            });

            await ctx.reply(`✅ *Sukses!* Tugas pembaruan WiFi telah dikirim ke perangkat.\n\n_Perubahan akan diterapkan saat perangkat sinkron (biasanya beberapa detik)._`, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('WiFi update error:', error);
            await ctx.reply(`❌ Gagal mengubah WiFi: ${error.message}`);
        }
    }

    /**
     * Handle ONU Reboot
     */
    async handleOnuRestart(ctx, phoneInput) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        if (!telegramAuth.hasPermission(session, ['admin', 'technician'])) {
            return await ctx.reply('❌ Anda tidak memiliki izin untuk restart ONU.');
        }

        // phoneInput can be from callback or message args
        let phone = phoneInput;
        if (!phone && ctx.message) {
            const args = ctx.message.text.split(' ').slice(1);
            if (args.length > 0) phone = args[0];
        }

        if (!phone) {
            return await ctx.reply('❌ Format: `/rebootONU <phone>`');
        }

        await ctx.reply(`⏳ Mencoba merestart ONU pelanggan: *${phone}*...`, { parse_mode: 'Markdown' });

        try {
            const device = await genieacs.findDeviceByPhoneNumber(phone);
            if (!device) {
                return await ctx.reply('❌ Perangkat tidak ditemukan.');
            }

            await genieacs.reboot(device._id);

            await ctx.reply(`✅ *Perintah Restart Terkirim!* ONU akan mati dan menyala kembali dalam beberapa saat.`, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('ONU reboot error:', error);
            await ctx.reply(`❌ Gagal merestart ONU: ${error.message}`);
        }
    }

    /**
     * Handle invoice unpaid
     */
    async handleInvoiceUnpaid(ctx) {
        await ctx.reply('⏳ Memuat invoice belum bayar...');

        const invoices = await billingManager.getAllInvoices();
        const unpaidInvoices = invoices.filter(i => i.status === 'unpaid');

        if (unpaidInvoices.length === 0) {
            await ctx.reply('✅ Tidak ada invoice yang belum dibayar.');
            return;
        }

        // Limit to first 10 for better UX with buttons
        const displayInvoices = unpaidInvoices.slice(0, 10);

        await ctx.reply(`🧾 *Invoice Belum Bayar* (${unpaidInvoices.length} total):`, { parse_mode: 'Markdown' });

        for (const invoice of displayInvoices) {
            const customer = await billingManager.getCustomerById(invoice.customer_id);
            const amount = parseFloat(invoice.amount || 0).toLocaleString('id-ID');
            const dueDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('id-ID') : 'N/A';

            let message = `📄 *Invoice #${invoice.id}*\n`;
            message += `👤 Pelanggan: ${customer ? customer.name : 'Unknown'}\n`;
            message += `💰 Tagihan: Rp ${amount}\n`;
            message += `📅 Jatuh Tempo: ${dueDate}`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('💵 Bayar Tunai', `pay_inv_${invoice.id}`)]
            ]);

            await ctx.reply(message, { parse_mode: 'Markdown', ...keyboard });
        }

        if (unpaidInvoices.length > 10) {
            await ctx.reply(`_Menampilkan 10 dari ${unpaidInvoices.length} invoice unpaid. Gunakan dashboard web untuk melihat selengkapnya._`, { parse_mode: 'Markdown' });
        }
    }

    /**
     * Handle invoice cek
     */
    async handleInvoiceCek(ctx, phone) {
        await ctx.reply('⏳ Mencari invoice...');

        const customer = await billingManager.getCustomerByPhone(phone);

        if (!customer) {
            await ctx.reply(`❌ Pelanggan dengan nomor ${phone} tidak ditemukan.`);
            return;
        }

        const invoices = await billingManager.getInvoicesByCustomerId(customer.id);

        if (invoices.length === 0) {
            await ctx.reply(`ℹ️ Tidak ada invoice untuk ${customer.name}.`);
            return;
        }

        let message = `🧾 *Invoice ${customer.name}*\n\n`;

        invoices.forEach(invoice => {
            const statusEmoji = invoice.status === 'paid' ? '✅' : '⏳';
            message += `${statusEmoji} ${invoice.invoice_number || `INV-${invoice.id}`}\n`;
            message += `   💰 Rp ${(invoice.amount || 0).toLocaleString('id-ID')}\n`;
            message += `   📊 ${invoice.status}\n`;
            message += `   📅 ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('id-ID') : 'N/A'}\n\n`;
        });

        await ctx.replyWithMarkdown(message);
    }

    /**
     * Handle invoice paid
     */
    async handleInvoicePaid(ctx, phone) {
        await ctx.reply('⏳ Mencari invoice yang sudah dibayar...');

        const customer = await billingManager.getCustomerByPhone(phone);

        if (!customer) {
            await ctx.reply(`❌ Pelanggan dengan nomor ${phone} tidak ditemukan.`);
            return;
        }

        const invoices = await billingManager.getInvoicesByCustomerId(customer.id);
        const paidInvoices = invoices.filter(i => i.status === 'paid');

        if (paidInvoices.length === 0) {
            await ctx.reply(`ℹ️ Tidak ada invoice yang sudah dibayar untuk ${customer.name}.`);
            return;
        }

        let message = `✅ *Invoice Sudah Dibayar (${paidInvoices.length})*\n\n`;

        paidInvoices.forEach(invoice => {
            message += `📄 ${invoice.invoice_number || `INV-${invoice.id}`}\n`;
            message += `   💰 Rp ${(invoice.amount || 0).toLocaleString('id-ID')}\n`;
            message += `   📅 ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('id-ID') : 'N/A'}\n\n`;
        });

        await ctx.replyWithMarkdown(message);
    }

    /**
     * Handle invoice overdue
     */
    async handleInvoiceOverdue(ctx) {
        await ctx.reply('⏳ Mencari invoice overdue...');

        const invoices = await billingManager.getAllInvoices();
        const today = new Date();
        const overdueInvoices = invoices.filter(i => {
            if (i.status !== 'unpaid') return false;
            if (!i.due_date) return false;
            const dueDate = new Date(i.due_date);
            return dueDate < today;
        });

        if (overdueInvoices.length === 0) {
            await ctx.reply('✅ Tidak ada invoice overdue.');
            return;
        }

        const displayInvoices = overdueInvoices.slice(0, 15);

        let message = `⚠️ *Invoice Overdue* (${overdueInvoices.length} total)\n\n`;

        for (const invoice of displayInvoices) {
            const customer = await billingManager.getCustomerById(invoice.customer_id);
            const amount = parseFloat(invoice.amount || 0).toLocaleString('id-ID');
            const dueDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('id-ID') : 'N/A';
            const daysOverdue = invoice.due_date ? Math.floor((today - new Date(invoice.due_date)) / (1000 * 60 * 60 * 24)) : 0;

            message += `📄 *Invoice #${invoice.id}*\n`;
            message += `👤 Pelanggan: ${customer ? customer.name : 'Unknown'}\n`;
            message += `💰 Tagihan: Rp ${amount}\n`;
            message += `📅 Jatuh Tempo: ${dueDate}\n`;
            message += `⏰ Overdue: ${daysOverdue} hari\n\n`;
        }

        if (overdueInvoices.length > 15) {
            message += `_Menampilkan 15 dari ${overdueInvoices.length} invoice overdue._`;
        }

        await ctx.replyWithMarkdown(message);
    }

    /**
     * Handle invoice detail
     */
    async handleInvoiceDetail(ctx, invoiceId) {
        await ctx.reply('⏳ Mengambil detail invoice...');

        const invoice = await billingManager.getInvoiceById(invoiceId);

        if (!invoice) {
            await ctx.reply(`❌ Invoice #${invoiceId} tidak ditemukan.`);
            return;
        }

        const customer = await billingManager.getCustomerById(invoice.customer_id);
        const statusEmoji = invoice.status === 'paid' ? '✅' : '⏳';
        const amount = parseFloat(invoice.amount || 0).toLocaleString('id-ID');
        const createdDate = invoice.created_at ? new Date(invoice.created_at).toLocaleString('id-ID') : 'N/A';
        const dueDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('id-ID') : 'N/A';

        let message = `📋 *Detail Invoice #${invoiceId}*\n\n`;
        message += `${statusEmoji} Status: ${invoice.status}\n\n`;
        message += `👤 Pelanggan: ${customer ? customer.name : 'Unknown'}\n`;
        message += `📱 Telepon: ${customer ? customer.phone : 'N/A'}\n`;
        message += `📄 Invoice: ${invoice.invoice_number || `INV-${invoiceId}`}\n`;
        message += `💰 Tagihan: Rp ${amount}\n`;
        message += `📦 Paket: ${invoice.package_name || 'N/A'}\n`;
        message += `📅 Dibuat: ${createdDate}\n`;
        message += `📆 Jatuh Tempo: ${dueDate}\n`;
        message += `📝 Catatan: ${invoice.notes || 'N/A'}`;

        await ctx.replyWithMarkdown(message);
    }

    /**
     * Handle invoice create
     */
    async handleInvoiceCreate(ctx, phone, amount, notes) {
        await ctx.reply('⏳ Membuat invoice manual...');

        try {
            const customer = await billingManager.getCustomerByPhone(phone);

            if (!customer) {
                await ctx.reply(`❌ Pelanggan dengan nomor ${phone} tidak ditemukan.`);
                return;
            }

            const invoiceAmount = parseFloat(amount);
            if (isNaN(invoiceAmount) || invoiceAmount <= 0) {
                await ctx.reply('❌ Jumlah tidak valid.');
                return;
            }

            const result = await billingManager.createManualInvoice(
                customer.id,
                invoiceAmount,
                notes
            );

            if (result && result.success) {
                await ctx.reply(
                    `✅ *Invoice Manual Berhasil Dibuat!*\n\n` +
                    `📄 Invoice: #${result.invoice_id}\n` +
                    `👤 Pelanggan: ${customer.name}\n` +
                    `💰 Tagihan: Rp ${invoiceAmount.toLocaleString('id-ID')}\n` +
                    `📝 Catatan: ${notes}`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal membuat invoice: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            console.error('Invoice create error:', error);
            await ctx.reply('❌ Gagal membuat invoice: ' + error.message);
        }
    }

    /**
     * Handle /billing command
     */
    async handleBilling(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply(
                '📊 *Perintah Billing:*\n\n' +
                '• `/billing stats` - Statistik billing\n' +
                '• `/billing report <bulan>` - Laporan bulanan\n\n' +
                'Contoh:\n' +
                '• `/billing report 2025-01` - Laporan Januari 2025',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const subCommand = args[0];

        try {
            switch (subCommand) {
                case 'stats':
                    await this.handleBillingStats(ctx);
                    break;
                case 'report':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /billing report <bulan>\nContoh: /billing report 2025-01');
                        return;
                    }
                    await this.handleBillingReport(ctx, args[1]);
                    break;
                default:
                    await ctx.reply('❌ Sub-command tidak dikenal. Gunakan: stats, report');
            }
        } catch (error) {
            console.error('Billing command error:', error);
            await ctx.reply('❌ Terjadi kesalahan: ' + error.message);
        }
    }

    /**
     * Handle billing stats
     */
    async handleBillingStats(ctx) {
        await ctx.reply('⏳ Mengambil statistik billing...');

        try {
            const invoices = await billingManager.getAllInvoices();
            const customers = await billingManager.getAllCustomers();

            const totalInvoices = invoices.length;
            const paidInvoices = invoices.filter(i => i.status === 'paid');
            const unpaidInvoices = invoices.filter(i => i.status === 'unpaid');
            const totalRevenue = paidInvoices.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);
            const unpaidAmount = unpaidInvoices.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);

            const today = new Date();
            const thisMonth = today.getMonth();
            const thisYear = today.getFullYear();

            const thisMonthPaid = paidInvoices.filter(i => {
                const created = new Date(i.created_at);
                return created.getMonth() === thisMonth && created.getFullYear() === thisYear;
            });
            const thisMonthRevenue = thisMonthPaid.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);

            let message = `📊 *Statistik Billing*\n\n`;
            message += `👥 Total Pelanggan: ${customers.length}\n\n`;
            message += `📄 Total Invoice: ${totalInvoices}\n`;
            message += `✅ Sudah Dibayar: ${paidInvoices.length}\n`;
            message += `⏳ Belum Dibayar: ${unpaidInvoices.length}\n\n`;
            message += `💰 Total Pendapatan: Rp ${totalRevenue.toLocaleString('id-ID')}\n`;
            message += `⏳ Tertunggak: Rp ${unpaidAmount.toLocaleString('id-ID')}\n\n`;
            message += `📅 Pendapatan Bulan Ini: Rp ${thisMonthRevenue.toLocaleString('id-ID')}\n`;
            message += `📊 Invoice Bulan Ini: ${thisMonthPaid.length}`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil statistik: ' + error.message);
        }
    }

    /**
     * Handle billing report
     */
    async handleBillingReport(ctx, monthStr) {
        await ctx.reply(`⏳ Mengambil laporan ${monthStr}...`);

        try {
            const invoices = await billingManager.getAllInvoices();
            const [year, month] = monthStr.split('-').map(Number);

            if (!year || !month || month < 1 || month > 12) {
                await ctx.reply('❌ Format bulan tidak valid. Gunakan format: YYYY-MM (contoh: 2025-01)');
                return;
            }

            const monthInvoices = invoices.filter(i => {
                const created = new Date(i.created_at);
                return created.getMonth() === month - 1 && created.getFullYear() === year;
            });

            const paidInvoices = monthInvoices.filter(i => i.status === 'paid');
            const unpaidInvoices = monthInvoices.filter(i => i.status === 'unpaid');
            const totalRevenue = paidInvoices.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);
            const unpaidAmount = unpaidInvoices.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);

            const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                               'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
            const monthName = monthNames[month - 1];

            let message = `📊 *Laporan ${monthName} ${year}*\n\n`;
            message += `📄 Total Invoice: ${monthInvoices.length}\n`;
            message += `✅ Sudah Dibayar: ${paidInvoices.length}\n`;
            message += `⏳ Belum Dibayar: ${unpaidInvoices.length}\n\n`;
            message += `💰 Pendapatan: Rp ${totalRevenue.toLocaleString('id-ID')}\n`;
            message += `⏳ Tertunggak: Rp ${unpaidAmount.toLocaleString('id-ID')}`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil laporan: ' + error.message);
        }
    }

    /**
     * Handle /pppoe command
     */
    async handlePPPoE(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply(
                '🌐 *Perintah PPPoE:*\n\n' +
                '• `/pppoe list` - List PPPoE users\n' +
                '• `/pppoe status <username>` - Cek status\n' +
                '• `/pppoe add <user> <pass> <profile>` - Tambah user\n' +
                '• `/pppoe edit <user> <field> <value>` - Edit user\n' +
                '• `/pppoe delete <username>` - Hapus user\n' +
                '• `/pppoe enable <username>` - Enable user\n' +
                '• `/pppoe disable <username>` - Disable user\n' +
                '• `/pppoe restore <username>` - Restore user',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const subCommand = args[0];

        try {
            switch (subCommand) {
                case 'list':
                    await this.handlePPPoEList(ctx);
                    break;
                case 'status':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /pppoe status <username>');
                        return;
                    }
                    await this.handlePPPoEStatus(ctx, args[1]);
                    break;
                case 'add':
                    if (args.length < 3) {
                        await ctx.reply('❌ Format: /pppoe add <username> <password> <profile>');
                        return;
                    }
                    await this.handlePPPoEAdd(ctx, args[1], args[2], args[3]);
                    break;
                case 'edit':
                    if (args.length < 3) {
                        await ctx.reply('❌ Format: /pppoe edit <username> <field> <value>');
                        return;
                    }
                    await this.handlePPPoEEdit(ctx, args[1], args[2], args[3]);
                    break;
                case 'delete':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /pppoe delete <username>');
                        return;
                    }
                    await this.handlePPPoEDelete(ctx, args[1]);
                    break;
                case 'enable':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /pppoe enable <username>');
                        return;
                    }
                    await this.handlePPPoEEnable(ctx, args[1]);
                    break;
                case 'disable':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /pppoe disable <username>');
                        return;
                    }
                    await this.handlePPPoEDisable(ctx, args[1]);
                    break;
                case 'restore':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /pppoe restore <username>');
                        return;
                    }
                    await this.handlePPPoERestore(ctx, args[1]);
                    break;
                default:
                    await ctx.reply('❌ Sub-command tidak dikenal. Gunakan: list, status, add, edit, delete, enable, disable, restore');
            }
        } catch (error) {
            console.error('PPPoE command error:', error);
            await ctx.reply('❌ Terjadi kesalahan: ' + error.message);
        }
    }

    /**
     * Handle pppoe list
     */
    async handlePPPoEList(ctx) {
        await ctx.reply('⏳ Memuat PPPoE users...');

        try {
            const users = await mikrotikManager.getPPPoEUsers();

            if (!users || users.length === 0) {
                await ctx.reply('ℹ️ Tidak ada PPPoE user.');
                return;
            }

            // Limit to first 15 users
            const displayUsers = users.slice(0, 15);

            let message = `🌐 *PPPoE Users* (${users.length} total)\n\n`;

            displayUsers.forEach((user, index) => {
                const statusEmoji = user.disabled === 'false' ? '✅' : '⏸️';
                message += `${index + 1}. ${statusEmoji} ${user.name}\n`;
                message += `   📊 Profile: ${user.profile || 'default'}\n`;
                if (user.service) {
                    message += `   🔗 Service: ${user.service}\n`;
                }
                message += '\n';
            });

            if (users.length > 15) {
                message += `\n_Menampilkan 15 dari ${users.length} users_`;
            }

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil data PPPoE: ' + error.message);
        }
    }

    /**
     * Handle pppoe status
     */
    async handlePPPoEStatus(ctx, username) {
        await ctx.reply('⏳ Mengecek status...');

        try {
            const user = await mikrotikManager.getPPPoEUserByUsername(username);

            if (!user) {
                await ctx.reply(`❌ PPPoE user ${username} tidak ditemukan.`);
                return;
            }

            const statusEmoji = user.disabled === 'false' ? '✅' : '⏸️';

            let message = `${statusEmoji} *PPPoE Status*\n\n`;
            message += `👤 Username: ${user.name}\n`;
            message += `📊 Profile: ${user.profile || 'default'}\n`;
            message += `📡 Service: ${user.service || 'N/A'}\n`;
            message += `🔒 Status: ${user.disabled === 'false' ? 'Enabled' : 'Disabled'}`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengecek status: ' + error.message);
        }
    }

    /**
     * Handle pppoe add
     */
    async handlePPPoEAdd(ctx, username, password, profile) {
        await ctx.reply('⏳ Menambahkan PPPoE user...');

        try {
            const result = await mikrotikManager.addPPPoESecret(username, password, profile);

            if (result && result.success) {
                await ctx.reply(
                    `✅ *PPPoE User Berhasil Ditambahkan!*\n\n` +
                    `👤 Username: ${username}\n` +
                    `📊 Profile: ${profile}\n` +
                    `🔒 Password: ${'•'.repeat(password.length)}`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal menambahkan PPPoE user: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            console.error('PPPoE add error:', error);
            await ctx.reply('❌ Gagal menambahkan PPPoE user: ' + error.message);
        }
    }

    /**
     * Handle pppoe edit
     */
    async handlePPPoEEdit(ctx, username, field, value) {
        await ctx.reply('⏳ Mengedit PPPoE user...');

        try {
            let result;

            switch (field) {
                case 'password':
                    result = await mikrotikManager.editPPPoEUser({ username, password: value });
                    break;
                case 'profile':
                    result = await mikrotikManager.setPPPoEProfile(username, value);
                    break;
                default:
                    await ctx.reply('❌ Field tidak dikenal. Gunakan: password, profile');
                    return;
            }

            if (result && result.success) {
                await ctx.reply(
                    `✅ *PPPoE User Berhasil Diupdate!*\n\n` +
                    `👤 Username: ${username}\n` +
                    `📝 Field: ${field}\n` +
                    `✅ Status: Berhasil diubah`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal mengedit PPPoE user: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            console.error('PPPoE edit error:', error);
            await ctx.reply('❌ Gagal mengedit PPPoE user: ' + error.message);
        }
    }

    /**
     * Handle pppoe delete
     */
    async handlePPPoEDelete(ctx, username) {
        await ctx.reply('⏳ Menghapus PPPoE user...');

        try {
            const result = await mikrotikManager.deletePPPoESecret(username);

            if (result && result.success) {
                await ctx.reply(
                    `✅ *PPPoE User Berhasil Dihapus!*\n\n` +
                    `👤 Username: ${username}\n` +
                    `🗑️ Status: Dihapus dari MikroTik`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal menghapus PPPoE user: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            console.error('PPPoE delete error:', error);
            await ctx.reply('❌ Gagal menghapus PPPoE user: ' + error.message);
        }
    }

    /**
     * Handle pppoe enable
     */
    async handlePPPoEEnable(ctx, username) {
        await ctx.reply('⏳ Mengaktifkan PPPoE user...');

        try {
            const result = await mikrotikManager.setPPPoEProfile(username, null, false);

            if (result && result.success) {
                await ctx.reply(
                    `✅ *PPPoE User Berhasil Diaktifkan!*\n\n` +
                    `👤 Username: ${username}\n` +
                    `🔒 Status: Enabled`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal mengaktifkan PPPoE user: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            console.error('PPPoE enable error:', error);
            await ctx.reply('❌ Gagal mengaktifkan PPPoE user: ' + error.message);
        }
    }

    /**
     * Handle pppoe disable
     */
    async handlePPPoEDisable(ctx, username) {
        await ctx.reply('⏳ Menonaktifkan PPPoE user...');

        try {
            const result = await mikrotikManager.setPPPoEProfile(username, null, true);

            if (result && result.success) {
                await ctx.reply(
                    `✅ *PPPoE User Berhasil Dinonaktifkan!*\n\n` +
                    `👤 Username: ${username}\n` +
                    `🔒 Status: Disabled`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal menonaktifkan PPPoE user: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            console.error('PPPoE disable error:', error);
            await ctx.reply('❌ Gagal menonaktifkan PPPoE user: ' + error.message);
        }
    }

    /**
     * Handle pppoe restore
     */
    async handlePPPoERestore(ctx, username) {
        await ctx.reply('⏳ Merestore PPPoE user...');

        try {
            const result = await mikrotikManager.setPPPoEProfile(username, null, false);

            if (result && result.success) {
                await ctx.reply(
                    `✅ *PPPoE User Berhasil Direstore!*\n\n` +
                    `👤 Username: ${username}\n` +
                    `🔄 Status: Restored to original profile`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal merestore PPPoE user: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            console.error('PPPoE restore error:', error);
            await ctx.reply('❌ Gagal merestore PPPoE user: ' + error.message);
        }
    }

    /**
     * Handle /hotspot command
     */
    async handleHotspot(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply(
                '🎫 *Perintah Hotspot:*\n\n' +
                '• `/hotspot list` - List hotspot users\n' +
                '• `/hotspot status <username>` - Cek status\n' +
                '• `/hotspot add <user> <pass> <profile>` - Tambah user\n' +
                '• `/hotspot delete <username>` - Hapus user\n' +
                '• `/voucher <username> <profile>` - Buat voucher',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const subCommand = args[0];

        try {
            switch (subCommand) {
                case 'list':
                    await this.handleHotspotList(ctx);
                    break;
                case 'status':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /hotspot status <username>');
                        return;
                    }
                    await this.handleHotspotStatus(ctx, args[1]);
                    break;
                case 'add':
                    if (args.length < 3) {
                        await ctx.reply('❌ Format: /hotspot add <username> <password> <profile>');
                        return;
                    }
                    await this.handleHotspotAdd(ctx, args[1], args[2], args[3]);
                    break;
                case 'delete':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /hotspot delete <username>');
                        return;
                    }
                    await this.handleHotspotDelete(ctx, args[1]);
                    break;
                default:
                    await ctx.reply('❌ Sub-command tidak dikenal. Gunakan: list, status, add, delete');
            }
        } catch (error) {
            console.error('Hotspot command error:', error);
            await ctx.reply('❌ Terjadi kesalahan: ' + error.message);
        }
    }

    /**
     * Handle hotspot list
     */
    async handleHotspotList(ctx) {
        await ctx.reply('⏳ Memuat hotspot users...');

        try {
            const result = await mikrotikManager.getActiveHotspotUsers();

            if (!result || !result.success || !result.data) {
                await ctx.reply('ℹ️ Tidak ada hotspot user aktif.');
                return;
            }

            const users = result.data;

            if (!Array.isArray(users)) {
                await ctx.reply('ℹ️ Data hotspot tidak valid.');
                return;
            }

            if (users.length === 0) {
                await ctx.reply('ℹ️ Tidak ada hotspot user aktif.');
                return;
            }

            const displayUsers = users.slice(0, 15);

            let message = `🎫 *Hotspot Users Aktif* (${users.length} total)\n\n`;

            displayUsers.forEach((user, index) => {
                message += `${index + 1}. 👤 ${user.user || user.name || 'Unknown'}\n`;
                message += `   📊 Profile: ${user.profile || 'default'}\n`;
                message += `   ⏰ Uptime: ${user.uptime || 'N/A'}\n\n`;
            });

            if (users.length > 15) {
                message += `\n_Menampilkan 15 dari ${users.length} users_`;
            }

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil data hotspot: ' + error.message);
        }
    }

    /**
     * Handle hotspot status
     */
    async handleHotspotStatus(ctx, username) {
        await ctx.reply('⏳ Mengecek status hotspot...');

        try {
            const users = await mikrotikManager.getActiveHotspotUsers();
            const user = users.find(u => (u.username === username || u.name === username));

            if (!user) {
                await ctx.reply(`❌ Hotspot user ${username} tidak ditemukan atau tidak aktif.`);
                return;
            }

            let message = `✅ *Hotspot Status*\n\n`;
            message += `👤 Username: ${user.username || user.name}\n`;
            message += `📊 Profile: ${user.profile || 'default'}\n`;
            message += `📡 IP Address: ${user.address || 'N/A'}\n`;
            message += `⏰ Uptime: ${user.uptime || 'N/A'}\n`;
            message += `📥 Bytes In: ${user.bytes_in || '0'}\n`;
            message += `📤 Bytes Out: ${user.bytes_out || '0'}`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengecek status: ' + error.message);
        }
    }

    /**
     * Handle hotspot add
     */
    async handleHotspotAdd(ctx, username, password, profile) {
        await ctx.reply('⏳ Menambahkan hotspot user...');

        try {
            const result = await mikrotikManager.addHotspotUser(username, password, profile);

            if (result && result.success) {
                await ctx.reply(
                    `✅ *Hotspot User Berhasil Ditambahkan!*\n\n` +
                    `👤 Username: ${username}\n` +
                    `📊 Profile: ${profile}\n` +
                    `🔒 Password: ${'•'.repeat(password.length)}`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal menambahkan hotspot user: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            console.error('Hotspot add error:', error);
            await ctx.reply('❌ Gagal menambahkan hotspot user: ' + error.message);
        }
    }

    /**
     * Handle hotspot delete
     */
    async handleHotspotDelete(ctx, username) {
        await ctx.reply('⏳ Menghapus hotspot user...');

        try {
            const result = await mikrotikManager.deleteHotspotUser(username);

            if (result && result.success) {
                await ctx.reply(
                    `✅ *Hotspot User Berhasil Dihapus!*\n\n` +
                    `👤 Username: ${username}\n` +
                    `🗑️ Status: Dihapus dari MikroTik`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal menghapus hotspot user: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            console.error('Hotspot delete error:', error);
            await ctx.reply('❌ Gagal menghapus hotspot user: ' + error.message);
        }
    }

    /**
     * Handle /voucher command
     */
    async handleVoucher(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (args.length < 2) {
            await ctx.reply(
                '🎫 *Format Voucher:*\n\n' +
                '• `/voucher <username> <profile>` - Buat voucher hotspot\n\n' +
                'Contoh:\n' +
                '• `/voucher user123 1hour`\n' +
                '• `/voucher guest456 2hour`',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const [username, profile] = args;

        await ctx.reply('⏳ Membuat voucher hotspot...');

        try {
            const date = new Date();
            const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
            const timeStr = date.toTimeString().slice(0, 5).replace(/:/g, '');
            const creator = session.username || 'telegram';

            const comment = `vc-${username}-${dateStr}-${timeStr}-${creator}`;

            const result = await mikrotikManager.addHotspotUser(username, profile, comment);

            if (result && result.success) {
                await ctx.reply(
                    `✅ *Voucher Berhasil Dibuat!*\n\n` +
                    `👤 Username: ${username}\n` +
                    `📊 Profile: ${profile}\n` +
                    `🔑 Comment: ${comment}\n\n` +
                    `📝 Catatan: Voucher ini otomatis dibuat dengan sistem comment tracking.`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal membuat voucher: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            console.error('Voucher creation error:', error);
            await ctx.reply('❌ Gagal membuat voucher: ' + error.message);
        }
    }

    /**
     * Handle /mikrotik command
     */
    async handleMikrotik(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply(
                '⚙️ *Perintah MikroTik:*\n\n' +
                '• `/mikrotik info` - Info sistem\n' +
                '• `/mikrotik cpu` - CPU usage\n' +
                '• `/mikrotik memory` - Memory usage\n' +
                '• `/mikrotik interfaces` - Daftar interface\n' +
                '• `/mikrotik active` - Koneksi aktif\n' +
                '• `/mikrotik bandwidth` - Bandwidth usage\n' +
                '• `/mikrotik reboot` - Reboot router\n' +
                '• `/mikrotik logs` - Lihat logs',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const subCommand = args[0];

        try {
            switch (subCommand) {
                case 'info':
                    await this.handleMikrotikInfo(ctx);
                    break;
                case 'cpu':
                    await this.handleMikrotikCPU(ctx);
                    break;
                case 'memory':
                    await this.handleMikrotikMemory(ctx);
                    break;
                case 'interfaces':
                    await this.handleMikrotikInterfaces(ctx);
                    break;
                case 'active':
                    await this.handleMikrotikActive(ctx);
                    break;
                case 'bandwidth':
                    await this.handleMikrotikBandwidth(ctx);
                    break;
                case 'reboot':
                    await this.handleMikrotikReboot(ctx);
                    break;
                case 'logs':
                    await this.handleMikrotikLogs(ctx);
                    break;
                default:
                    await ctx.reply('❌ Sub-command tidak dikenal. Gunakan: info, cpu, memory, interfaces, active, bandwidth, reboot, logs');
            }
        } catch (error) {
            console.error('MikroTik command error:', error);
            await ctx.reply('❌ Terjadi kesalahan: ' + error.message);
        }
    }

    /**
     * Handle mikrotik info
     */
    async handleMikrotikInfo(ctx) {
        await ctx.reply('⏳ Mengambil info MikroTik...');

        try {
            const info = await mikrotikManager.getSystemInfo();

            let message = `⚙️ *MikroTik System Info*\n\n`;
            message += `📛 Identity: ${info.identity || 'N/A'}\n`;
            message += `📦 Version: ${info.version || 'N/A'}\n`;
            message += `⏰ Uptime: ${info.uptime || 'N/A'}\n`;
            message += `🔧 Board: ${info['board-name'] || 'N/A'}`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil info: ' + error.message);
        }
    }

    /**
     * Handle mikrotik cpu
     */
    async handleMikrotikCPU(ctx) {
        await ctx.reply('⏳ Mengecek CPU usage...');

        try {
            const resources = await mikrotikManager.getSystemResources();

            let message = `💻 *CPU Usage*\n\n`;
            message += `📊 CPU Load: ${resources['cpu-load'] || 'N/A'}%\n`;
            message += `🔢 CPU Count: ${resources['cpu-count'] || 'N/A'}\n`;
            message += `⚡ CPU Frequency: ${resources['cpu-frequency'] || 'N/A'} MHz`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengecek CPU: ' + error.message);
        }
    }

    /**
     * Handle mikrotik memory
     */
    async handleMikrotikMemory(ctx) {
        await ctx.reply('⏳ Mengecek memory usage...');

        try {
            const resources = await mikrotikManager.getSystemResources();

            const totalMemory = parseInt(resources['total-memory']) || 0;
            const freeMemory = parseInt(resources['free-memory']) || 0;
            const usedMemory = totalMemory - freeMemory;
            const usagePercent = totalMemory > 0 ? ((usedMemory / totalMemory) * 100).toFixed(1) : 0;

            let message = `💾 *Memory Usage*\n\n`;
            message += `📊 Usage: ${usagePercent}%\n`;
            message += `📦 Total: ${(totalMemory / 1024 / 1024).toFixed(0)} MB\n`;
            message += `✅ Free: ${(freeMemory / 1024 / 1024).toFixed(0)} MB\n`;
            message += `🔴 Used: ${(usedMemory / 1024 / 1024).toFixed(0)} MB`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengecek memory: ' + error.message);
        }
    }

    /**
     * Handle mikrotik interfaces
     */
    async handleMikrotikInterfaces(ctx) {
        await ctx.reply('⏳ Mengambil daftar interface...');

        try {
            const result = await mikrotikManager.getInterfaces();

            if (!result || !result.success || !result.data) {
                await ctx.reply('ℹ️ Tidak ada interface ditemukan.');
                return;
            }

            const interfaces = result.data;

            if (!Array.isArray(interfaces)) {
                await ctx.reply('ℹ️ Data interface tidak valid.');
                return;
            }

            if (interfaces.length === 0) {
                await ctx.reply('ℹ️ Tidak ada interface ditemukan.');
                return;
            }

            let message = `🌐 *Daftar Interface* (${interfaces.length} total)\n\n`;

            interfaces.forEach((iface, index) => {
                const statusEmoji = iface.running === 'true' ? '✅' : '❌';
                message += `${index + 1}. ${statusEmoji} ${iface.name || 'Unknown'}\n`;
                message += `   📊 Type: ${iface.type || 'N/A'}\n`;
                message += `   🔗 MTU: ${iface.mtu || 'N/A'}\n`;
                message += `   📡 Running: ${iface.running === 'true' ? 'Yes' : 'No'}\n\n`;
            });

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil interface: ' + error.message);
        }
    }

    /**
     * Handle mikrotik active connections
     */
    async handleMikrotikActive(ctx) {
        await ctx.reply('⏳ Mengambil koneksi aktif...');

        try {
            const result = await mikrotikManager.getActivePPPoEConnections();

            if (!result || !result.success || !result.data) {
                await ctx.reply('ℹ️ Tidak ada koneksi aktif.');
                return;
            }

            const connections = result.data;

            if (!Array.isArray(connections)) {
                await ctx.reply('ℹ️ Data koneksi tidak valid.');
                return;
            }

            if (connections.length === 0) {
                await ctx.reply('ℹ️ Tidak ada koneksi aktif.');
                return;
            }

            const displayConnections = connections.slice(0, 15);

            let message = `📡 *Koneksi Aktif* (${connections.length} total)\n\n`;

            displayConnections.forEach((conn, index) => {
                message += `${index + 1}. 👤 ${conn.name || 'Unknown'}\n`;
                message += `   📊 Address: ${conn.address || 'N/A'}\n`;
                message += `   ⏰ Uptime: ${conn.uptime || 'N/A'}\n\n`;
            });

            if (connections.length > 15) {
                message += `\n_Menampilkan 15 dari ${connections.length} koneksi_`;
            }

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil koneksi aktif: ' + error.message);
        }
    }

    /**
     * Handle mikrotik bandwidth
     */
    async handleMikrotikBandwidth(ctx) {
        await ctx.reply('⏳ Mengambil info bandwidth...');

        try {
            const interfaceName = 'ether1';
            const traffic = await mikrotikManager.getInterfaceTraffic(interfaceName);

            const rxMbps = (traffic.rx / 1024 / 1024).toFixed(2);
            const txMbps = (traffic.tx / 1024 / 1024).toFixed(2);

            let message = `📊 *Bandwidth Usage (${interfaceName})*\n\n`;
            message += `📥 Download: ${rxMbps} Mbps\n`;
            message += `📤 Upload: ${txMbps} Mbps\n`;
            message += `🔄 Total: ${(parseFloat(rxMbps) + parseFloat(txMbps)).toFixed(2)} Mbps`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil bandwidth: ' + error.message);
        }
    }

    /**
     * Handle mikrotik reboot
     */
    async handleMikrotikReboot(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        if (!telegramAuth.hasPermission(session, ['admin'])) {
            await ctx.reply('❌ Hanya admin yang bisa reboot MikroTik.');
            return;
        }

        await ctx.reply('⏳ Merestart MikroTik...');

        try {
            const result = await mikrotikManager.restartRouter();

            if (result && result.success) {
                await ctx.reply(
                    `✅ *MikroTik Berhasil Direboot!*\n\n` +
                    `⏰ Router akan restart dalam beberapa detik.\n` +
                    `📡 Koneksi akan terputus sementara.`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal reboot MikroTik: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            console.error('MikroTik reboot error:', error);
            await ctx.reply('❌ Gagal reboot MikroTik: ' + error.message);
        }
    }

    /**
     * Handle mikrotik logs
     */
    async handleMikrotikLogs(ctx) {
        await ctx.reply('⏳ Mengambil logs MikroTik...');

        try {
            const result = await mikrotikManager.getSystemLogs();

            if (!result || !result.success || !result.data) {
                await ctx.reply('ℹ️ Tidak ada logs ditemukan.');
                return;
            }

            const logs = result.data;

            if (!Array.isArray(logs)) {
                await ctx.reply('ℹ️ Data logs tidak valid.');
                return;
            }

            if (logs.length === 0) {
                await ctx.reply('ℹ️ Tidak ada logs ditemukan.');
                return;
            }

            const displayLogs = logs.slice(0, 10);

            let message = `📋 *MikroTik Logs* (10 terbaru)\n\n`;

            displayLogs.forEach((log, index) => {
                const time = log.time || 'N/A';
                const topic = log.topics || 'system';
                const msg = log.message || 'No message';
                message += `${index + 1}. [${time}] [${topic}] ${msg}\n`;
            });

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil logs: ' + error.message);
        }
    }

    /**
     * Handle /firewall command
     */
    async handleFirewall(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply(
                '🔒 *Perintah Firewall:*\n\n' +
                '• `/firewall list` - List firewall rules\n' +
                '• `/firewall add <chain> <src-address> <action>` - Tambah rule\n' +
                '• `/firewall delete <id>` - Hapus rule',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const subCommand = args[0];

        try {
            switch (subCommand) {
                case 'list':
                    await this.handleFirewallList(ctx);
                    break;
                case 'add':
                    if (args.length < 3) {
                        await ctx.reply('❌ Format: /firewall add <chain> <src-address> <action>');
                        return;
                    }
                    await this.handleFirewallAdd(ctx, args[1], args[2], args[3]);
                    break;
                case 'delete':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /firewall delete <id>');
                        return;
                    }
                    await this.handleFirewallDelete(ctx, args[1]);
                    break;
                default:
                    await ctx.reply('❌ Sub-command tidak dikenal. Gunakan: list, add, delete');
            }
        } catch (error) {
            console.error('Firewall command error:', error);
            await ctx.reply('❌ Terjadi kesalahan: ' + error.message);
        }
    }

    /**
     * Handle firewall list
     */
    async handleFirewallList(ctx) {
        await ctx.reply('⏳ Mengambil firewall rules...');

        try {
            const result = await mikrotikManager.getFirewallRules();

            if (!result || !result.success || !result.data) {
                await ctx.reply('ℹ️ Tidak ada firewall rules ditemukan.');
                return;
            }

            const rules = result.data;

            if (!Array.isArray(rules)) {
                await ctx.reply('ℹ️ Data firewall tidak valid.');
                return;
            }

            if (rules.length === 0) {
                await ctx.reply('ℹ️ Tidak ada firewall rules ditemukan.');
                return;
            }

            const displayRules = rules.slice(0, 15);

            let message = `🔒 *Firewall Rules* (${rules.length} total)\n\n`;

            displayRules.forEach((rule, index) => {
                message += `${index + 1}. 📋 Rule #${rule['.id'] || index}\n`;
                message += `   🔗 Chain: ${rule.chain || 'N/A'}\n`;
                message += `   📊 Src: ${rule['src-address'] || 'any'}\n`;
                message += `   🎯 Action: ${rule.action || 'N/A'}\n\n`;
            });

            if (rules.length > 15) {
                message += `\n_Menampilkan 15 dari ${rules.length} rules_`;
            }

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil firewall rules: ' + error.message);
        }
    }

    /**
     * Handle firewall add
     */
    async handleFirewallAdd(ctx, chain, srcAddress, action) {
        await ctx.reply('⏳ Menambahkan firewall rule...');

        try {
            let message = `✅ *Firewall Rule Ditambahkan (Demo)*\n\n`;
            message += `🔗 Chain: ${chain}\n`;
            message += `📊 Src: ${srcAddress}\n`;
            message += `🎯 Action: ${action}\n\n`;
            message += `⚠️ Fitur ini memerlukan implementasi tambahan di mikrotik.js`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal menambahkan firewall rule: ' + error.message);
        }
    }

    /**
     * Handle firewall delete
     */
    async handleFirewallDelete(ctx, id) {
        await ctx.reply('⏳ Menghapus firewall rule...');

        try {
            let message = `✅ *Firewall Rule Dihapus (Demo)*\n\n`;
            message += `📋 Rule ID: ${id}\n\n`;
            message += `⚠️ Fitur ini memerlukan implementasi tambahan di mikrotik.js`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal menghapus firewall rule: ' + error.message);
        }
    }

    /**
     * Handle /queue command
     */
    async handleQueue(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply(
                '📊 *Perintah Queue:*\n\n' +
                '• `/queue list` - List queue rules\n' +
                '• `/queue add <name> <target> <max-limit>` - Tambah queue\n' +
                '• `/queue delete <id>` - Hapus queue',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const subCommand = args[0];

        try {
            switch (subCommand) {
                case 'list':
                    await this.handleQueueList(ctx);
                    break;
                case 'add':
                    if (args.length < 3) {
                        await ctx.reply('❌ Format: /queue add <name> <target> <max-limit>');
                        return;
                    }
                    await this.handleQueueAdd(ctx, args[1], args[2], args[3]);
                    break;
                case 'delete':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /queue delete <id>');
                        return;
                    }
                    await this.handleQueueDelete(ctx, args[1]);
                    break;
                default:
                    await ctx.reply('❌ Sub-command tidak dikenal. Gunakan: list, add, delete');
            }
        } catch (error) {
            console.error('Queue command error:', error);
            await ctx.reply('❌ Terjadi kesalahan: ' + error.message);
        }
    }

    /**
     * Handle queue list
     */
    async handleQueueList(ctx) {
        await ctx.reply('⏳ Mengambil queue rules...');

        try {
            let message = `📊 *Queue Rules*\n\n`;
            message += `⚠️ Fitur ini memerlukan implementasi tambahan di mikrotik.js\n\n`;
            message += `Contoh output:\n`;
            message += `1. 📋 Queue-1\n`;
            message += `   🎯 Target: 192.168.1.0/24\n`;
            message += `   📊 Max Limit: 10M/10M\n\n`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil queue rules: ' + error.message);
        }
    }

    /**
     * Handle queue add
     */
    async handleQueueAdd(ctx, name, target, maxLimit) {
        await ctx.reply('⏳ Menambahkan queue rule...');

        try {
            let message = `✅ *Queue Rule Ditambahkan (Demo)*\n\n`;
            message += `📋 Name: ${name}\n`;
            message += `🎯 Target: ${target}\n`;
            message += `📊 Max Limit: ${maxLimit}\n\n`;
            message += `⚠️ Fitur ini memerlukan implementasi tambahan di mikrotik.js`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal menambahkan queue rule: ' + error.message);
        }
    }

    /**
     * Handle queue delete
     */
    async handleQueueDelete(ctx, id) {
        await ctx.reply('⏳ Menghapus queue rule...');

        try {
            let message = `✅ *Queue Rule Dihapus (Demo)*\n\n`;
            message += `📋 Queue ID: ${id}\n\n`;
            message += `⚠️ Fitur ini memerlukan implementasi tambahan di mikrotik.js`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal menghapus queue rule: ' + error.message);
        }
    }

    /**
     * Handle /ip command
     */
    async handleIP(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply(
                '🌐 *Perintah IP Management:*\n\n' +
                '• `/ip list` - List IP addresses\n' +
                '• `/ip add <address> <interface>` - Tambah IP\n' +
                '• `/ip delete <id>` - Hapus IP',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const subCommand = args[0];

        try {
            switch (subCommand) {
                case 'list':
                    await this.handleIPList(ctx);
                    break;
                case 'add':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /ip add <address> <interface>');
                        return;
                    }
                    await this.handleIPAdd(ctx, args[1], args[2]);
                    break;
                case 'delete':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /ip delete <id>');
                        return;
                    }
                    await this.handleIPDelete(ctx, args[1]);
                    break;
                default:
                    await ctx.reply('❌ Sub-command tidak dikenal. Gunakan: list, add, delete');
            }
        } catch (error) {
            console.error('IP command error:', error);
            await ctx.reply('❌ Terjadi kesalahan: ' + error.message);
        }
    }

    /**
     * Handle IP list
     */
    async handleIPList(ctx) {
        await ctx.reply('⏳ Mengambil IP addresses...');

        try {
            const result = await mikrotikManager.getIPAddresses();

            if (!result || !result.success || !result.data) {
                await ctx.reply('ℹ️ Tidak ada IP address ditemukan.');
                return;
            }

            const ips = result.data;

            if (!Array.isArray(ips)) {
                await ctx.reply('ℹ️ Data IP tidak valid.');
                return;
            }

            if (ips.length === 0) {
                await ctx.reply('ℹ️ Tidak ada IP address ditemukan.');
                return;
            }

            const displayIPs = ips.slice(0, 15);

            let message = `🌐 *IP Addresses* (${ips.length} total)\n\n`;

            displayIPs.forEach((ip, index) => {
                message += `${index + 1}. 📋 ${ip.address || 'N/A'}\n`;
                message += `   🔗 Interface: ${ip.interface || 'N/A'}\n\n`;
            });

            if (ips.length > 15) {
                message += `\n_Menampilkan 15 dari ${ips.length} IP_`;
            }

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil IP addresses: ' + error.message);
        }
    }

    /**
     * Handle IP add
     */
    async handleIPAdd(ctx, address, iface) {
        await ctx.reply('⏳ Menambahkan IP address...');

        try {
            const result = await mikrotikManager.addIPAddress(iface, address);

            if (result && result.success) {
                await ctx.reply(
                    `✅ *IP Address Berhasil Ditambahkan!*\n\n` +
                    `📋 Address: ${address}\n` +
                    `🔗 Interface: ${iface}`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal menambahkan IP: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            await ctx.reply('❌ Gagal menambahkan IP: ' + error.message);
        }
    }

    /**
     * Handle /onu command
     */
    async handleONU(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply(
                '📡 *Perintah ONU (GenieACS):*\n\n' +
                '• `/onu list` - List semua ONU devices\n' +
                '• `/onu status <phone>` - Cek status ONU\n' +
                '• `/onu info <phone>` - Info detail ONU\n' +
                '• `/onu tag <phone> <tag>` - Tambah tag\n' +
                '• `/onu untag <phone> <tag>` - Hapus tag\n' +
                '• `/onu factoryreset <phone>` - Factory reset',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const subCommand = args[0];

        try {
            switch (subCommand) {
                case 'list':
                    await this.handleONUList(ctx);
                    break;
                case 'status':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /onu status <phone>');
                        return;
                    }
                    await this.handleONUStatus(ctx, args[1]);
                    break;
                case 'info':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /onu info <phone>');
                        return;
                    }
                    await this.handleONUInfo(ctx, args[1]);
                    break;
                case 'tag':
                    if (args.length < 3) {
                        await ctx.reply('❌ Format: /onu tag <phone> <tag>');
                        return;
                    }
                    await this.handleONUTag(ctx, args[1], args[2]);
                    break;
                case 'untag':
                    if (args.length < 3) {
                        await ctx.reply('❌ Format: /onu untag <phone> <tag>');
                        return;
                    }
                    await this.handleONUUntag(ctx, args[1], args[2]);
                    break;
                case 'factoryreset':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /onu factoryreset <phone>');
                        return;
                    }
                    await this.handleONUFactoryReset(ctx, args[1]);
                    break;
                default:
                    await ctx.reply('❌ Sub-command tidak dikenal. Gunakan: list, status, info, tag, untag, factoryreset');
            }
        } catch (error) {
            console.error('ONU command error:', error);
            await ctx.reply('❌ Terjadi kesalahan: ' + error.message);
        }
    }

    /**
     * Handle ONU list
     */
    async handleONUList(ctx) {
        await ctx.reply('⏳ Mengambil daftar ONU devices...');

        try {
            const genieacs = require('./genieacs');
            const devices = await genieacs.getDevices();

            if (!devices || devices.length === 0) {
                await ctx.reply('ℹ️ Tidak ada ONU device ditemukan.');
                return;
            }

            const displayDevices = devices.slice(0, 15);

            let message = `📡 *ONU Devices* (${devices.length} total)\n\n`;

            displayDevices.forEach((device, index) => {
                const serial = device.serialNumber || 'N/A';
                const lastInform = device.lastInform ? new Date(device.lastInform).toLocaleString() : 'N/A';
                const tags = device._tags || [];

                message += `${index + 1}. 🔧 ${serial}\n`;
                message += `   📊 Last Inform: ${lastInform}\n`;
                message += `   🏷️ Tags: ${tags.length > 0 ? tags.join(', ') : 'No tags'}\n\n`;
            });

            if (devices.length > 15) {
                message += `\n_Menampilkan 15 dari ${devices.length} devices_`;
            }

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil ONU devices: ' + error.message);
        }
    }

    /**
     * Handle ONU status
     */
    async handleONUStatus(ctx, phoneNumber) {
        await ctx.reply('⏳ Mengecek status ONU...');

        try {
            const genieacs = require('./genieacs');
            const device = await genieacs.getDeviceByPhoneNumber(phoneNumber);

            if (!device) {
                await ctx.reply(`❌ ONU device dengan nomor ${phoneNumber} tidak ditemukan.`);
                return;
            }

            const lastInform = device.lastInform ? new Date(device.lastInform).toLocaleString() : 'N/A';
            const serial = device.serialNumber || 'N/A';
            const model = device._deviceId?.['InternetGatewayDevice.DeviceInfo.Model'] || 'N/A';
            const tags = device._tags || [];
            const uptime = device._uptime || 'N/A';

            let message = `✅ *ONU Status*\n\n`;
            message += `🔧 Serial: ${serial}\n`;
            message += `📱 Phone: ${phoneNumber}\n`;
            message += `📊 Model: ${model}\n`;
            message += `⏰ Last Inform: ${lastInform}\n`;
            message += `⏱️ Uptime: ${uptime}\n`;
            message += `🏷️ Tags: ${tags.length > 0 ? tags.join(', ') : 'No tags'}`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengecek status: ' + error.message);
        }
    }

    /**
     * Handle ONU info
     */
    async handleONUInfo(ctx, phoneNumber) {
        await ctx.reply('⏳ Mengambil info detail ONU...');

        try {
            const genieacs = require('./genieacs');
            const device = await genieacs.getDeviceByPhoneNumber(phoneNumber);

            if (!device) {
                await ctx.reply(`❌ ONU device dengan nomor ${phoneNumber} tidak ditemukan.`);
                return;
            }

            const serial = device.serialNumber || 'N/A';
            const model = device._deviceId?.['InternetGatewayDevice.DeviceInfo.Model'] || 'N/A';
            const manufacturer = device._deviceId?.['InternetGatewayDevice.DeviceInfo.Manufacturer'] || 'N/A';
            const softwareVersion = device._deviceId?.['InternetGatewayDevice.DeviceInfo.SoftwareVersion'] || 'N/A';
            const hardwareVersion = device._deviceId?.['InternetGatewayDevice.DeviceInfo.HardwareVersion'] || 'N/A';
            const lastInform = device.lastInform ? new Date(device.lastInform).toLocaleString() : 'N/A';
            const tags = device._tags || [];
            const ip = device._deviceId?.['InternetGatewayDevice.DeviceInfo.IPAddress'] || 'N/A';

            let message = `📋 *ONU Detail Info*\n\n`;
            message += `🔧 Serial: ${serial}\n`;
            message += `📱 Phone: ${phoneNumber}\n`;
            message += `📊 Model: ${model}\n`;
            message += `🏭 Manufacturer: ${manufacturer}\n`;
            message += `💻 Software: ${softwareVersion}\n`;
            message += `⚙️ Hardware: ${hardwareVersion}\n`;
            message += `📡 IP Address: ${ip}\n`;
            message += `⏰ Last Inform: ${lastInform}\n`;
            message += `🏷️ Tags: ${tags.length > 0 ? tags.join(', ') : 'No tags'}`;

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            await ctx.reply('❌ Gagal mengambil info: ' + error.message);
        }
    }

    /**
     * Handle ONU tag
     */
    async handleONUTag(ctx, phoneNumber, tag) {
        await ctx.reply('⏳ Menambahkan tag ke ONU...');

        try {
            const genieacs = require('./genieacs');
            const device = await genieacs.getDeviceByPhoneNumber(phoneNumber);

            if (!device) {
                await ctx.reply(`❌ ONU device dengan nomor ${phoneNumber} tidak ditemukan.`);
                return;
            }

            const result = await genieacs.addTagToDevice(device._id, tag);

            if (result && result.success) {
                await ctx.reply(
                    `✅ *Tag Berhasil Ditambahkan!*\n\n` +
                    `📱 Phone: ${phoneNumber}\n` +
                    `🏷️ Tag: ${tag}`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal menambahkan tag: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            await ctx.reply('❌ Gagal menambahkan tag: ' + error.message);
        }
    }

    /**
     * Handle ONU untag
     */
    async handleONUUntag(ctx, phoneNumber, tag) {
        await ctx.reply('⏳ Menghapus tag dari ONU...');

        try {
            const genieacs = require('./genieacs');
            const device = await genieacs.getDeviceByPhoneNumber(phoneNumber);

            if (!device) {
                await ctx.reply(`❌ ONU device dengan nomor ${phoneNumber} tidak ditemukan.`);
                return;
            }

            const result = await genieacs.removeTagFromDevice(device._id, tag);

            if (result && result.success) {
                await ctx.reply(
                    `✅ *Tag Berhasil Dihapus!*\n\n` +
                    `� Phone: ${phoneNumber}\n` +
                    `🏷️ Tag: ${tag}`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`❌ Gagal menghapus tag: ${result ? result.message : 'Terjadi kesalahan'}`);
            }
        } catch (error) {
            await ctx.reply('❌ Gagal menghapus tag: ' + error.message);
        }
    }

    /**
     * Handle customer login
     */
    async handleCustomerLogin(ctx) {
        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply(
                '🔐 *Login Pelanggan*\n\n' +
                'Format: `/loginpelanggan <no_hp> [password]`\n\n' +
                'Contoh:\n' +
                '• `/loginpelanggan 08123456789 password123`\n' +
                '• `/loginpelanggan 08123456789` (jika OTP diaktifkan)',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const phone = args[0];
        const password = args[1];
        const userId = ctx.from.id;

        await ctx.reply('⏳ Memverifikasi login...');

        try {
            const customer = await billingManager.getCustomerByPhone(phone);

            if (!customer) {
                await ctx.reply('❌ Nomor telepon tidak terdaftar sebagai pelanggan.');
                return;
            }

            // Check if OTP is enabled in settings
            const otpEnabled = getSetting('customerPortalOtp', false);

            if (otpEnabled) {
                // OTP flow
                const otp = Math.floor(100000 + Math.random() * 900000).toString();

                customerOtpCache[userId] = {
                    phone: phone,
                    otp: otp,
                    customerId: customer.id,
                    timestamp: Date.now()
                };

                await ctx.reply(
                    '✅ *Kode OTP Anda: ' + otp + '*\n\n' +
                    'Kode ini berlaku selama 5 menit.\n' +
                    'Gunakan kode ini untuk login: `/verifyotp ' + otp + '`',
                    { parse_mode: 'Markdown' }
                );

                console.log('OTP for ' + phone + ': ' + otp);
            } else {
                // Direct login flow
                if (!password) {
                    await ctx.reply('❌ Password diperlukan. Format: `/loginpelanggan <phone> <password>`');
                    return;
                }

                // Verify password
                if (customer.password && customer.password !== password) {
                    await ctx.reply('❌ Password salah.');
                    return;
                }

                // Login successful
                await telegramAuth.createCustomerSession(userId, customer);

                await ctx.reply(
                    '✅ *Login Berhasil!*\n\n' +
                    '👤 Selamat datang, ' + customer.name + '\n' +
                    '📱 ' + customer.phone + '\n\n' +
                    'Gunakan perintah berikut:\n' +
                    '• `/cektagihan` - Cek tagihan\n' +
                    '• `/statuspelanggan` - Cek status layanan\n' +
                    '• `/gantissid <ssid>` - Ganti WiFi SSID\n' +
                    '• `/gantipassword <password>` - Ganti WiFi password\n' +
                    '• `/logoutpelanggan` - Logout',
                    { parse_mode: 'Markdown' }
                );
            }

        } catch (error) {
            console.error('Customer login error:', error);
            await ctx.reply('❌ Gagal login: ' + error.message);
        }
    }

    /**
     * Handle customer OTP verification
     */
    async handleCustomerVerifyOTP(ctx) {
        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply('❌ Format: `/verifyotp <kode_otp>`');
            return;
        }

        const otp = args[0];
        const userId = ctx.from.id;

        const cached = customerOtpCache[userId];

        if (!cached) {
            await ctx.reply('❌ Sesi login tidak ditemukan. Silakan login ulang: `/loginpelanggan <no_hp>`');
            return;
        }

        // Check if OTP is expired (5 minutes)
        if (Date.now() - cached.timestamp > 5 * 60 * 1000) {
            delete customerOtpCache[userId];
            await ctx.reply('❌ Kode OTP sudah kadaluarsa. Silakan login ulang.');
            return;
        }

        if (cached.otp !== otp) {
            await ctx.reply('❌ Kode OTP salah.');
            return;
        }

        // Login successful
        const customer = await billingManager.getCustomerById(cached.customerId);

        if (!customer) {
            await ctx.reply('❌ Data pelanggan tidak ditemukan.');
            return;
        }

        // Create customer session
        await telegramAuth.createCustomerSession(userId, customer);

        // Clear OTP cache
        delete customerOtpCache[userId];

        await ctx.reply(
            '✅ *Login Berhasil!*\n\n' +
            '👤 Selamat datang, ' + customer.name + '\n' +
            '📱 ' + customer.phone + '\n\n' +
            'Gunakan perintah berikut:\n' +
            '• `/cektagihan` - Cek tagihan\n' +
            '• `/statuspelanggan` - Cek status layanan\n' +
            '• `/gantissid <ssid>` - Ganti WiFi SSID\n' +
            '• `/gantipassword <password>` - Ganti WiFi password\n' +
            '• `/logoutpelanggan` - Logout',
            { parse_mode: 'Markdown' }
        );
    }

    /**
     * Check if user is logged in as customer
     */
    async checkCustomerAuth(ctx) {
        const session = await telegramAuth.getCustomerSession(ctx.from.id);
        if (!session) {
            await ctx.reply('❌ Anda belum login. Gunakan: `/loginpelanggan <no_hp>`');
            return null;
        }
        return session;
    }

    /**
     * Handle customer check billing
     */
    async handleCustomerCheckBilling(ctx) {
        const session = await this.checkCustomerAuth(ctx);
        if (!session) return;

        await ctx.reply('⏳ Mengambil data tagihan...');

        try {
            const invoices = await billingManager.getInvoicesByCustomerId(session.customer.id);
            const unpaidInvoices = invoices.filter(i => i.status === 'unpaid');

            if (unpaidInvoices.length === 0) {
                await ctx.reply('✅ Tidak ada tagihan yang belum dibayar.');
                return;
            }

            let message = `🧾 *Tagihan Anda* (${unpaidInvoices.length})\n\n`;

            unpaidInvoices.forEach(invoice => {
                const amount = parseFloat(invoice.amount || 0).toLocaleString('id-ID');
                const dueDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('id-ID') : 'N/A';

                message += `📄 ${invoice.invoice_number || `INV-${invoice.id}`}\n`;
                message += `   💰 Rp ${amount}\n`;
                message += `   📅 Jatuh Tempo: ${dueDate}\n\n`;
            });

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            console.error('Customer check billing error:', error);
            await ctx.reply('❌ Gagal mengambil tagihan: ' + error.message);
        }
    }

    /**
     * Handle customer change SSID
     */
    async handleCustomerChangeSSID(ctx) {
        const session = await this.checkCustomerAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply('❌ Format: `/gantissid <nama_ssid_baru>`');
            return;
        }

        const newSSID = args.join(' ');

        if (newSSID.length < 3 || newSSID.length > 32) {
            await ctx.reply('❌ Nama SSID harus 3-32 karakter.');
            return;
        }

        await ctx.reply('⏳ Mengganti WiFi SSID...');

        try {
            const genieacs = require('./genieacs');
            const device = await genieacs.getDeviceByPhoneNumber(session.customer.phone);

            if (!device) {
                await ctx.reply('❌ ONU tidak ditemukan. Hubungi admin.');
                return;
            }

            const result = await genieacs.setParameterValues(device._id, {
                'SSID': newSSID
            });

            if (result) {
                await ctx.reply(
                    `✅ *SSID Berhasil Diganti!*\n\n` +
                    `📡 SSID Baru: ${newSSID}\n` +
                    `⏰ Perubahan akan aktif dalam beberapa detik.`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply('❌ Gagal mengganti SSID.');
            }
        } catch (error) {
            console.error('Change SSID error:', error);
            await ctx.reply('❌ Gagal mengganti SSID: ' + error.message);
        }
    }

    /**
     * Handle customer change password
     */
    async handleCustomerChangePassword(ctx) {
        const session = await this.checkCustomerAuth(ctx);
        if (!session) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (args.length === 0) {
            await ctx.reply('❌ Format: `/gantipassword <password_baru>`');
            return;
        }

        const newPassword = args[0];

        if (newPassword.length < 8) {
            await ctx.reply('❌ Password minimal 8 karakter.');
            return;
        }

        await ctx.reply('⏳ Mengganti WiFi password...');

        try {
            const genieacs = require('./genieacs');
            const device = await genieacs.getDeviceByPhoneNumber(session.customer.phone);

            if (!device) {
                await ctx.reply('❌ ONU tidak ditemukan. Hubungi admin.');
                return;
            }

            const result = await genieacs.setParameterValues(device._id, {
                'Password': newPassword
            });

            if (result) {
                await ctx.reply(
                    `✅ *Password Berhasil Diganti!*\n\n` +
                    `🔒 Password Baru: ${'•'.repeat(newPassword.length)}\n` +
                    `⏰ Perubahan akan aktif dalam beberapa detik.\n\n` +
                    `⚠️ Jangan berikan password kepada orang lain.`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply('❌ Gagal mengganti password.');
            }
        } catch (error) {
            console.error('Change password error:', error);
            await ctx.reply('❌ Gagal mengganti password: ' + error.message);
        }
    }

    /**
     * Handle customer status
     */
    async handleCustomerStatus(ctx) {
        const session = await this.checkCustomerAuth(ctx);
        if (!session) return;

        await ctx.reply('⏳ Mengambil status layanan...');

        try {
            const customer = session.customer;
            const genieacs = require('./genieacs');
            const device = await genieacs.getDeviceByPhoneNumber(customer.phone);

            let message = `📊 *Status Layanan Anda*\n\n`;
            message += `👤 Nama: ${customer.name}\n`;
            message += `📱 Telepon: ${customer.phone}\n`;
            message += `📦 Paket: ${customer.package_name || 'N/A'}\n`;
            message += `📊 Status: ${customer.status === 'active' ? '✅ Aktif' : '❌ Nonaktif'}\n`;

            if (device) {
                const lastInform = device.lastInform ? new Date(device.lastInform).toLocaleString('id-ID') : 'N/A';
                message += `📡 ONU: Online\n`;
                message += `⏰ Last Update: ${lastInform}\n`;
            } else {
                message += `📡 ONU: Offline\n`;
            }

            await ctx.replyWithMarkdown(message);
        } catch (error) {
            console.error('Customer status error:', error);
            await ctx.reply('❌ Gagal mengambil status: ' + error.message);
        }
    }

    /**
     * Handle customer logout
     */
    async handleCustomerLogout(ctx) {
        const userId = ctx.from.id;

        await telegramAuth.deleteCustomerSession(userId);

        await ctx.reply(
            '✅ *Logout Berhasil!*\n\n' +
            'Terima kasih telah menggunakan layanan kami.\n\n' +
            'Untuk login kembali, gunakan: `/loginpelanggan <no_hp>`',
            { parse_mode: 'Markdown' }
        );
    }
}

module.exports = TelegramCommands;
