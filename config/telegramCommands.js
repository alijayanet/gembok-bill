/**
 * Telegram Bot Command Handlers
 * Handles all bot commands and user interactions
 */

const { Markup } = require('telegraf');
const telegramAuth = require('./telegramAuth');
const billingManager = require('./billing');
const mikrotikManager = require('./mikrotik');
const genieacs = require('./genieacs');
const { getSetting, getSettingsWithCache } = require('./settingsManager');

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

        // MikroTik PPPoE commands
        this.bot.command('pppoe', this.handlePPPoE.bind(this));

        // MikroTik Hotspot commands
        this.bot.command('hotspot', this.handleHotspot.bind(this));
        this.bot.command('voucher', this.handleVoucher.bind(this));

        // MikroTik system commands
        this.bot.command('mikrotik', this.handleMikrotik.bind(this));
        this.bot.command('wifi', this.handleWifi.bind(this));
        this.bot.command('rebootONU', this.handleOnuRestart.bind(this));

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
• \`/invoice cek <phone>\` - Cek invoice pelanggan

*🌐 MikroTik PPPoE:*
• \`/pppoe list\` - List PPPoE users
• \`/pppoe status <username>\` - Cek status PPPoE

*🎫 Hotspot:*
• \`/hotspot list\` - List hotspot users
• \`/voucher <username> <profile>\` - Buat voucher

*⚙️ MikroTik System:*
• \`/mikrotik info\` - Info sistem MikroTik
• \`/mikrotik cpu\` - CPU usage
• \`/mikrotik memory\` - Memory usage
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
                '• `/invoice cek <phone>` - Cek invoice pelanggan',
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
                case 'cek':
                    if (args.length < 2) {
                        await ctx.reply('❌ Format: /invoice cek <phone>');
                        return;
                    }
                    await this.handleInvoiceCek(ctx, args[1]);
                    break;
                default:
                    await ctx.reply('❌ Sub-command tidak dikenal. Gunakan: unpaid, cek');
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
                '• `/pppoe status <username>` - Cek status',
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
                default:
                    await ctx.reply('❌ Sub-command tidak dikenal. Gunakan: list, status');
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
     * Handle /hotspot command
     */
    async handleHotspot(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        await ctx.reply(
            '🎫 *Perintah Hotspot:*\n\n' +
            '• `/hotspot list` - List hotspot users\n' +
            '• `/voucher <username> <profile>` - Buat voucher',
            { parse_mode: 'Markdown' }
        );
    }

    /**
     * Handle /voucher command
     */
    async handleVoucher(ctx) {
        const session = await this.checkAuth(ctx);
        if (!session) return;

        await ctx.reply('🎫 Fitur voucher akan segera tersedia!');
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
                '• `/mikrotik memory` - Memory usage',
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
                default:
                    await ctx.reply('❌ Sub-command tidak dikenal. Gunakan: info, cpu, memory');
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
}

module.exports = TelegramCommands;
