const logger = require('./logger');
const { getAdminHelpMessage, getTechnicianHelpMessage, getCustomerHelpMessage, getGeneralHelpMessage, getVersionMessage, getSystemInfoMessage } = require('./help-messages');
const WhatsAppTroubleCommands = require('./whatsapp-trouble-commands');
const WhatsAppPPPoECommands = require('./whatsapp-pppoe-commands');
const AgentAdminCommands = require('./agentAdminCommands');
const BillingManager = require('./billing');
const { getCompanyHeader, getFooterInfo } = require('./message-templates');

class WhatsAppMessageHandlers {
    constructor(whatsappCore, whatsappCommands) {
        this.core = whatsappCore;
        this.commands = whatsappCommands;
        this.troubleCommands = new WhatsAppTroubleCommands(whatsappCore);
        this.pppoeCommands = new WhatsAppPPPoECommands(whatsappCore);
        this.agentAdminCommands = new AgentAdminCommands();

        // Parameter paths for different device parameters (from genieacs-commands.js)
        this.parameterPaths = {
            rxPower: [
                'VirtualParameters.RXPower',
                'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RXPower',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_ALU-COM_RxPower',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.RxPower',
                'Device.Optical.Interface.1.RxPower'
            ],
            pppoeIP: [
                'VirtualParameters.pppoeIP',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress',
                'Device.PPP.Interface.1.IPCPExtensions.RemoteIPAddress'
            ],
            pppUsername: [
                'VirtualParameters.pppoeUsername',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
                'Device.PPP.Interface.1.Username'
            ],
            uptime: [
                'VirtualParameters.getdeviceuptime',
                'InternetGatewayDevice.DeviceInfo.UpTime',
                'Device.DeviceInfo.UpTime'
            ],
            firmware: [
                'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
                'Device.DeviceInfo.SoftwareVersion'
            ],
            userConnected: [
                'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations',
                'VirtualParameters.activedevices',
                'Device.WiFi.AccessPoint.1.AssociatedDeviceNumberOfEntries'
            ],
            temperature: [
                'VirtualParameters.gettemp',
                'InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureValue',
                'Device.DeviceInfo.TemperatureStatus.TemperatureValue'
            ],
            serialNumber: [
                'VirtualParameters.getSerialNumber',
                'InternetGatewayDevice.DeviceInfo.SerialNumber'
            ],
            ponMode: [
                'VirtualParameters.getponmode'
            ],
            pppUptime: [
                'VirtualParameters.getpppuptime'
            ]
        };
    }

    // Phone helpers: normalize and variants (08..., 62..., +62...)
    normalizePhone(input) {
        if (!input) return '';
        let s = String(input).replace(/[^0-9+]/g, '');
        if (s.startsWith('+')) s = s.slice(1);
        if (s.startsWith('0')) return '62' + s.slice(1);
        if (s.startsWith('62')) return s;
        // Fallback: if it looks like local without leading 0, prepend 62
        if (/^8[0-9]{7,13}$/.test(s)) return '62' + s;
        return s;
    }

    generatePhoneVariants(input) {
        const raw = String(input || '');
        const norm = this.normalizePhone(raw);
        const local = norm.startsWith('62') ? '0' + norm.slice(2) : raw;
        const plus = norm.startsWith('62') ? '+62' + norm.slice(2) : raw;
        const shortLocal = local.startsWith('0') ? local.slice(1) : local;
        return Array.from(new Set([raw, norm, local, plus, shortLocal].filter(Boolean)));
    }

    // Main message handler
    async handleIncomingMessage(sock, message) {
        try {
            // Validasi input
            if (!message || !message.key) {
                logger.warn('Invalid message received', { message: typeof message });
                return;
            }

            // Ekstrak informasi pesan
            const remoteJid = message.key.remoteJid;
            if (!remoteJid) {
                logger.warn('Message without remoteJid received', { messageKey: message.key });
                return;
            }

            // Skip jika pesan dari grup dan bukan dari admin
            if (remoteJid.includes('@g.us')) {
                logger.debug('Message from group received', { groupJid: remoteJid });
                const participant = message.key.participant;
                if (!participant || !this.core.isAdminNumber(participant.split('@')[0])) {
                    logger.debug('Group message not from admin, ignoring', { participant });
                    return;
                }
                logger.info('Group message from admin, processing', { participant });
            }

            // Cek tipe pesan dan ekstrak teks
            let messageText = '';
            if (!message.message) {
                logger.debug('Message without content received', { messageType: 'unknown' });
                return;
            }

            if (message.message.conversation) {
                messageText = message.message.conversation;
                logger.debug('Conversation message received');
            } else if (message.message.extendedTextMessage) {
                messageText = message.message.extendedTextMessage.text;
                logger.debug('Extended text message received');
            } else {
                logger.debug('Unsupported message type received', {
                    messageTypes: Object.keys(message.message)
                });
                return;
            }

            // Ekstrak nomor pengirim dan LID
            let senderNumber;
            let senderLid = null;
            let realSenderNumber = null; // Nomor asli dari database jika menggunakan LID

            try {
                // Cek apakah pengirim menggunakan LID
                if (remoteJid.endsWith('@lid')) {
                    senderLid = remoteJid;
                    logger.debug(`Message from LID detected: ${senderLid}`);

                    // Coba cari nomor HP berdasarkan LID di database
                    try {
                        const billing = new BillingManager();
                        const customer = await billing.getCustomerByWhatsAppLid(senderLid);

                        if (customer) {
                            realSenderNumber = customer.phone;
                            senderNumber = realSenderNumber; // Gunakan nomor HP asli untuk logic selanjutnya

                            // Normalisasi nomor HP
                            if (senderNumber.startsWith('0')) senderNumber = '62' + senderNumber.slice(1);

                            logger.info(`✅ Resolved LID ${senderLid} to customer phone: ${senderNumber}`);
                        } else {
                            // Jika tidak ditemukan, gunakan bagian depan LID tapi ini mungkin bukan nomor HP valid
                            senderNumber = remoteJid.split('@')[0];
                            logger.info(`⚠️ LID ${senderLid} not found in database. Using raw ID: ${senderNumber}`);
                        }
                    } catch (err) {
                        logger.error('Error resolving LID:', err);
                        senderNumber = remoteJid.split('@')[0];
                    }
                } else {
                    // Normal message (non-LID)
                    senderNumber = remoteJid.split('@')[0];
                }
            } catch (error) {
                logger.error('Error extracting sender number', { remoteJid, error: error.message });
                return;
            }

            logger.info(`Message received`, { sender: senderNumber, messageLength: messageText.length });
            logger.debug(`Message content`, { sender: senderNumber, message: messageText });

            // Cek apakah pengirim adalah admin
            const isAdmin = this.core.isAdminNumber(senderNumber);
            logger.debug(`Sender admin status`, { sender: senderNumber, isAdmin });

            // Jika pesan kosong, abaikan
            if (!messageText.trim()) {
                logger.debug('Empty message, ignoring');
                return;
            }

            // Proses pesan
            await this.processMessage(remoteJid, senderNumber, messageText, isAdmin, senderLid);

        } catch (error) {
            logger.error('Error in handleIncomingMessage', { error: error.message, stack: error.stack });
        }
    }

    // Process message and route to appropriate handler
    async processMessage(remoteJid, senderNumber, messageText, isAdmin, senderLid = null) {
        const command = messageText.trim().toLowerCase();
        const originalCommand = messageText.trim();

        try {
            // Cek apakah pengirim bisa akses fitur teknisi
            const canAccessTechnician = this.core.canAccessTechnicianFeatures(senderNumber);

            // Debug logging
            logger.info(`🔍 [ROUTING] Processing command: "${originalCommand}" (lowercase: "${command}")`);
            logger.info(`🔍 [ROUTING] Sender: ${senderNumber}, isAdmin: ${isAdmin}, canAccessTechnician: ${canAccessTechnician}`);
            console.log(`🔍 [ROUTING DEBUG] isAdmin=${isAdmin}, typeof isAdmin=${typeof isAdmin}`);


            // REGISTRASI LID (Priority High - sebelum admin/technician check)
            // SETLID untuk registrasi WhatsApp LID Admin
            if (command.startsWith('setlid ') || command.startsWith('!setlid ') || command.startsWith('/setlid ')) {
                await this.handleSetLidCommand(remoteJid, senderNumber, messageText, senderLid);
                return;
            }

            // Perintah REG untuk registrasi WhatsApp LID pelanggan
            if (command.startsWith('reg ') || command.startsWith('!reg ') || command.startsWith('/reg ')) {
                await this.handleRegCommand(remoteJid, senderNumber, messageText, senderLid);
                return;
            }

            // Admin commands (termasuk command teknisi)
            if (isAdmin) {
                logger.info(`🔍 [ROUTING] Routing to handleAdminCommands`);
                console.log(`🔍 [ROUTING] Calling handleAdminCommands for command: "${command}"`);
                await this.handleAdminCommands(remoteJid, senderNumber, command, messageText);
                return;
            }

            console.log(`🔍 [ROUTING] NOT routing to admin handler, isAdmin=${isAdmin}`);

            // Technician commands (untuk teknisi yang bukan admin)
            if (canAccessTechnician && !isAdmin) {
                logger.info(`🔍 [ROUTING] Routing to handleTechnicianCommands`);
                await this.handleTechnicianCommands(remoteJid, senderNumber, command, messageText);
                return;
            }

            // Customer commands
            logger.info(`🔍 [ROUTING] Routing to handleCustomerCommands`);
            await this.handleCustomerCommands(remoteJid, senderNumber, command, messageText);

        } catch (error) {
            logger.error('Error processing message', {
                command,
                sender: senderNumber,
                error: error.message
            });

            // Send error message to user
            await this.commands.sendMessage(remoteJid,
                `❌ *ERROR*\n\nTerjadi kesalahan saat memproses perintah:\n${error.message}`
            );
        }
    }

    // Handle REG command for LID registration
    async handleRegCommand(remoteJid, senderNumber, messageText, senderLid) {
        try {
            const billing = new BillingManager();

            // Extract search term (nama atau nomor)
            const searchTerm = messageText.split(' ').slice(1).join(' ').trim();

            const formatWithHeaderFooter = (content) => {
                const header = getCompanyHeader();
                const footer = getFooterInfo();
                return `📱 *${header}*\n\n${content}\n\n_${footer}_`;
            };

            if (!searchTerm) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *FORMAT SALAH*\n\n` +
                    `Gunakan format:\n` +
                    `• REG [nama pelanggan]\n` +
                    `• REG [nomor HP]\n\n` +
                    `Contoh:\n` +
                    `• REG Budi Santoso\n` +
                    `• REG 081234567890`
                ));
                return;
            }

            // Check if LID is available
            if (!senderLid) {
                // Jika tidak terdeteksi sebagai LID, mungkin user menggunakan WA biasa tapi ingin register? 
                // Tapi fitur ini spesifik untuk mapping LID. 
                // Jika user pakai WA biasa, remoteJid SUDAH nomor HPnya (ideally).
                // Tapi kita kasih warning aja.
                if (!remoteJid.endsWith('@lid')) {
                    // Jika bukan LID, cek apakah nomor ini sudah terdaftar?
                    // Kalau sudah, info saja "Nomor ini sudah terdaftar otomatis".
                    const customer = await billing.getCustomerByPhone(senderNumber);
                    if (customer) {
                        await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                            `✅ *SUDAH TERDAFTAR*\n\n` +
                            `Nomor WhatsApp ini sudah terdaftar sebagai:\n` +
                            `👤 *Nama:* ${customer.name}\n` +
                            `📞 *Nomor:* ${customer.phone}\n\n` +
                            `Anda tidak perlu melakukan registrasi ulang.`
                        ));
                        return;
                    }
                }

                if (!senderLid && !remoteJid.endsWith('@lid')) {
                    // Fallback create dummy LID from remoteJid if needed? No, just warn.
                    // Actually, let's allow "REG" to work for normal numbers too to confirm identity
                }
            }

            // Determine if search term is phone number (only digits) or name
            const isPhoneNumber = /^\d+$/.test(searchTerm.replace(/[\s\-\+]/g, ''));

            let customers = [];

            if (isPhoneNumber) {
                // Search by phone number
                const customer = await billing.getCustomerByPhone(searchTerm);
                if (customer) {
                    customers = [customer];
                }
            } else {
                // Search by name
                customers = await billing.getCustomerByNameOrPhone(searchTerm);
                // getCustomerByNameOrPhone returns single object, not array. Need to check billing.js again.
                // It returns SINGLE row. So wrap in array if found.
                if (customers) {
                    customers = [customers];
                }
            }

            // Note: billing.findCustomersByNameOrPhone might be what we want for multiple results?
            // checking billing.js... getCustomerByNameOrPhone returns 1 row via db.get.
            // If we want likely matches, we might need a search function that returns multiple rows.
            // But for now let's stick to strict matching to avoid confusion.

            if (!customers || customers.length === 0) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *PELANGGAN TIDAK DITEMUKAN*\n\n` +
                    `Tidak ada pelanggan dengan ${isPhoneNumber ? 'nomor' : 'nama'}: ${searchTerm}\n\n` +
                    `Silakan coba lagi dengan:\n` +
                    `• Nama lengkap pelanggan, atau\n` +
                    `• Nomor HP yang terdaftar`
                ));
                return;
            }

            // Single customer found
            const customer = customers[0];

            // Check if customer already has a WhatsApp LID
            if (customer.whatsapp_lid) {
                // Jika senderLid ada dan match
                if (senderLid && customer.whatsapp_lid === senderLid) {
                    await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                        `✅ *SUDAH TERDAFTAR*\n\n` +
                        `WhatsApp ini sudah terhubung dengan akun:\n\n` +
                        `👤 *Nama:* ${customer.name}\n` +
                        `📞 *Nomor:* ${customer.phone}\n` +
                        `📦 *Paket:* ${customer.package_name || 'Tidak ada paket'}`
                    ));
                    return;
                } else if (senderLid && customer.whatsapp_lid !== senderLid) {
                    // Jika sudah punya LID tapi beda, konfirmasi ganti?
                    // Saat ini auto-replace atau reject? 
                    // Amannya reject dan minta hubungi admin.
                    await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                        `⚠️ *KONFIRMASI DIPERLUKAN*\n\n` +
                        `Pelanggan "${customer.name}" sudah memiliki WhatsApp ID lain yang terhubung.\n\n` +
                        `Jika Anda ganti HP/WA, silakan hubungi admin untuk reset data.`
                    ));
                    return;
                }
            }

            // Register the WhatsApp LID
            try {
                // Gunakan LID jika ada, jika tidak gunakan remoteJid (untuk WA biasa)
                const targetLid = senderLid || remoteJid;

                await billing.updateCustomerWhatsAppLid(customer.id, targetLid);

                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `✅ *REGISTRASI BERHASIL*\n\n` +
                    `WhatsApp Anda berhasil didaftarkan!\n\n` +
                    `📋 *Data Pelanggan:*\n` +
                    `👤 *Nama:* ${customer.name}\n` +
                    `📞 *Nomor:* ${customer.phone}\n` +
                    `📦 *Paket:* ${customer.package_name || 'Tidak ada paket'}\n` +
                    `💰 *Harga:* ${customer.package_price ? 'Rp ' + customer.package_price.toLocaleString('id-ID') : '-'}\n\n` +
                    `Sekarang Anda dapat menggunakan perintah bot dengan WhatsApp ini.\n\n` +
                    `Ketik *MENU* untuk melihat daftar perintah.`
                ));

                logger.info(`✅ WhatsApp LID registered: ${targetLid} for customer ${customer.name} (${customer.phone})`);
            } catch (error) {
                logger.error('Error registering WhatsApp LID:', error);
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *REGISTRASI GAGAL*\n\n` +
                    `Terjadi kesalahan: ${error.message}\n\n` +
                    `Silakan hubungi admin untuk bantuan.`
                ));
            }

        } catch (error) {
            logger.error('Error in REG command:', error);
            await this.commands.sendMessage(remoteJid, `❌ *TERJADI KESALAHAN*\n\nError: ${error.message}`);
        }
    }

    // Handle SETLID command for Admin LID registration
    async handleSetLidCommand(remoteJid, senderNumber, messageText, senderLid) {
        try {
            const billing = new BillingManager();

            // Extract password
            const password = messageText.split(' ').slice(1).join(' ').trim();
            const adminPassword = this.core.getSetting('admin_password');

            const formatWithHeaderFooter = (content) => {
                const header = getCompanyHeader();
                const footer = getFooterInfo();
                return `📱 *${header}*\n\n${content}\n\n_${footer}_`;
            };

            if (!password) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *FORMAT SALAH*\n\n` +
                    `Gunakan format:\n` +
                    `• SETLID [password_admin]\n\n` +
                    `Untuk mendaftarkan WhatsApp ini sebagai Admin.`
                ));
                return;
            }

            // Verify admin password
            if (password !== adminPassword) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *PASSWORD SALAH*\n\n` +
                    `Password admin yang Anda masukkan salah.`
                ));
                return;
            }

            // Check if LID is available
            if (!senderLid) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `⚠️ *BUKAN LID*\n\n` +
                    `Akun WhatsApp Anda tidak terdeteksi menggunakan LID.\n` +
                    `Anda tetap bisa menggunakan nomor ini sebagai admin (via settings).`
                ));
                // Bisa lanjutkan jika mau support nomor biasa, tapi ini fitur spesifik LID
                // Mari kita izinkan untuk mapping nomor biasa ke akun 'admin' dummy jika perlu
            }

            // But wait, SETLID tujuannya agar admin bisa dikenali sbg admin meski pakai LID.
            // Admin biasanya tidak punya akun customer di billing (kecuali dibuat dummy).
            // Jadi kita harus simpan mapping ini di suatu tempat.
            // Opsi 1: Simpan di settings.json (admins array) -> Tapi ini butuh write file & restart
            // Opsi 2: Simpan di table customers (buat admin jadi customer) -> Ini yg dipakai REG

            // Karena user minta "SETLID", asumsikan dia ingin mapping ke akun.
            // Tapi admin numbers ada di settings.json. 
            // Kalau LID berubah-ubah, susah kalau hardcode di settings.json.

            // Solusi: Kita cari customer dengan nomor HP yg ada di settings 'admins'.
            // Kalau belum ada, admin harus buat akun customer dulu dengan nomor HP adminnya.

            // Cari customer yg phone-nya match salah satu admin number?
            // Atau cukup cari customer dengan nomor HP senderNumber (yg mungkin sudah ter-resolve atau belum)?
            // Jika belum ter-resolve, senderNumber adalah LID prefix (angka acak). 
            // Jadi kita tidak bisa cari by phone.

            // User harus input nomor HP aslinya juga? 
            // "SETLID [password] [nomor_hp_asli]" ? 
            // Atau cukup "SETLID [password]" lalu kita cari customer bernama "Admin" atau sejenisnya?

            // LEBIH BAIK: "SETLID [password] [nomor_hp_admin]"
            // Perintah ini akan melink-kan LID pengirim ke customer dengan nomor_hp_admin.

            const parts = messageText.split(' ');
            if (parts.length < 3) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *FORMAT KURANG LENGKAP*\n\n` +
                    `Gunakan format:\n` +
                    `• SETLID [password_admin] [nomor_hp_admin]\n\n` +
                    `Contoh:\n` +
                    `• SETLID rahasia123 081234567890`
                ));
                return;
            }

            const targetPhone = parts[2];

            // Cari customer dengan nomor HP tersebut
            const customer = await billing.getCustomerByPhone(targetPhone);

            if (!customer) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *PELANGGAN TIDAK DITEMUKAN*\n\n` +
                    `Tidak ditemukan data pelanggan dengan nomor HP: ${targetPhone}\n\n` +
                    `Silakan buat akun pelanggan dummy untuk Admin dengan nomor tersebut terlebih dahulu.`
                ));
                return;
            }

            // Update LID
            const targetLid = senderLid || remoteJid;
            await billing.updateCustomerWhatsAppLid(customer.id, targetLid);

            await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                `✅ *ADMIN LID BERHASIL DISET*\n\n` +
                `WhatsApp LID Anda berhasil ditautkan ke akun:\n` +
                `👤 *Nama:* ${customer.name}\n` +
                `📞 *Nomor:* ${customer.phone}\n\n` +
                `Sistem sekarang mengenali Anda sebagai: ${customer.phone}\n` +
                `Silakan coba kirim perintah *ADMIN* atau *MENU*.`
            ));

        } catch (error) {
            logger.error('Error in SETLID command:', error);
            await this.commands.sendMessage(remoteJid, `❌ *ERROR*: ${error.message}`);
        }
    }

    // Handle technician commands (untuk teknisi yang bukan admin)
    async handleTechnicianCommands(remoteJid, senderNumber, command, messageText) {
        // Command yang bisa diakses teknisi (tidak bisa akses semua fitur admin)

        logger.info(`🔍 [TECHNICIAN] Processing command: "${command}" from ${senderNumber}`);

        // Help Commands
        if (command === 'teknisi') {
            logger.info(`🔍 [TECHNICIAN] Handling teknisi command`);
            await this.sendTechnicianHelp(remoteJid);
            return;
        }

        if (command === 'help') {
            await this.sendTechnicianHelp(remoteJid);
            return;
        }

        // Trouble Report Commands (PRIORITAS TINGGI)
        if (command === 'trouble') {
            await this.troubleCommands.handleListTroubleReports(remoteJid);
            return;
        }

        if (command.startsWith('status ')) {
            const reportId = messageText.split(' ')[1];
            await this.troubleCommands.handleTroubleReportStatus(remoteJid, reportId);
            return;
        }

        if (command.startsWith('update ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const newStatus = params[1];
                const notes = params.slice(2).join(' ');
                await this.troubleCommands.handleUpdateTroubleReport(remoteJid, reportId, newStatus, notes);
            }
            return;
        }

        if (command.startsWith('selesai ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 1) {
                const reportId = params[0];
                const notes = params.slice(1).join(' ');
                await this.troubleCommands.handleResolveTroubleReport(remoteJid, reportId, notes);
            }
            return;
        }

        // Search Commands (untuk teknisi)
        if (command.startsWith('cari ')) {
            const searchTerm = messageText.split(' ').slice(1).join(' ');
            await this.handleSearchCustomer(remoteJid, searchTerm);
            return;
        }

        if (command.startsWith('catatan ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const notes = params.slice(1).join(' ');
                await this.troubleCommands.handleAddNoteToTroubleReport(remoteJid, reportId, notes);
            }
            return;
        }

        if (command === 'help trouble') {
            await this.troubleCommands.handleTroubleReportHelp(remoteJid);
            return;
        }

        // PPPoE Commands (PEMASANGAN BARU)
        if (command.startsWith('addpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 3) {
                const username = params[0];
                const password = params[1];
                const profile = params[2];
                const ipAddress = params[3] || null;
                const customerInfo = params.slice(4).join(' ') || null;
                await this.pppoeCommands.handleAddPPPoE(remoteJid, username, password, profile, ipAddress, customerInfo);
            }
            return;
        }

        if (command.startsWith('editpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 3) {
                const username = params[0];
                const field = params[1];
                const newValue = params.slice(2).join(' ');
                await this.pppoeCommands.handleEditPPPoE(remoteJid, username, field, newValue);
            }
            return;
        }

        if (command.startsWith('checkpppoe ')) {
            const username = messageText.split(' ')[1];
            await this.pppoeCommands.handleCheckPPPoEStatus(remoteJid, username);
            return;
        }

        if (command.startsWith('restartpppoe ')) {
            const username = messageText.split(' ')[1];
            await this.pppoeCommands.handleRestartPPPoE(remoteJid, username);
            return;
        }

        if (command === 'help pppoe') {
            await this.pppoeCommands.handlePPPoEHelp(remoteJid);
            return;
        }

        // System Info Commands
        if (command === 'version') {
            const versionMessage = getVersionMessage();
            await this.commands.sendMessage(remoteJid, versionMessage);
            return;
        }

        if (command === 'info') {
            const systemInfoMessage = getSystemInfoMessage();
            await this.commands.sendMessage(remoteJid, systemInfoMessage);
            return;
        }

        // Basic device commands (terbatas)
        if (command.startsWith('cek ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleCekStatus(remoteJid, customerNumber);
            return;
        }

        if (command.startsWith('cekstatus ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleCekStatus(remoteJid, customerNumber);
            return;
        }

        // Search Commands
        if (command.startsWith('cari ')) {
            logger.info(`🔍 [TECHNICIAN] Handling cari command`);
            const searchTerm = messageText.split(' ').slice(1).join(' ');
            await this.handleSearchCustomer(remoteJid, searchTerm);
            return;
        }

        // Debug GenieACS Commands (case insensitive)
        if (command.toLowerCase().startsWith('debuggenieacs ')) {
            logger.info(`🔍 [TECHNICIAN] Handling debuggenieacs command`);
            const phoneNumber = messageText.split(' ')[1];
            await this.handleDebugGenieACS(remoteJid, phoneNumber);
            return;
        }

        // Simple debug command
        if (command.toLowerCase().startsWith('debug ')) {
            logger.info(`🔍 [TECHNICIAN] Handling debug command`);
            const phoneNumber = messageText.split(' ')[1];
            await this.handleDebugGenieACS(remoteJid, phoneNumber);
            return;
        }

        // List all devices command
        if (command === 'listdevices') {
            logger.info(`🔍 [TECHNICIAN] Handling listdevices command`);
            await this.handleListDevices(remoteJid);
            return;
        }

        // Unknown command for technician
        console.log(`Perintah tidak dikenali dari teknisi: ${command}`);
        // await this.commands.sendMessage(remoteJid, 
        //     `❓ *PERINTAH TIDAK DIKENAL*\n\nPerintah "${command}" tidak dikenali.\n\nKetik *teknisi* untuk melihat menu teknisi.`
        // );
    }

    // Handle admin commands
    async handleAdminCommands(remoteJid, senderNumber, command, messageText) {
        // Tangkap SEMUA perintah yang mengandung kata 'agent' lebih dulu
        if (command.includes('agent') || command === 'agent' || command.includes('daftaragent')) {
            logger.info(`DEBUG Routing ke handler agent admin: "${command}"`);
            this.agentAdminCommands._sendMessage = async (jid, message) => {
                await this.commands.sendMessage(jid, message);
            };
            await this.agentAdminCommands.handleAgentAdminCommands(remoteJid, senderNumber, command, messageText);
            return;
        }

        // Handler admin WhatsApp lain (cek, refresh, menu, status, dsb)
        if (command.startsWith('cek ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleCekStatus(remoteJid, customerNumber);
            return;
        }

        if (command.startsWith('cekstatus ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleCekStatus(remoteJid, customerNumber);
            return;
        }

        if (command === 'cekall') {
            await this.commands.handleCekAll(remoteJid);
            return;
        }

        if (command.startsWith('refresh ')) {
            const deviceId = messageText.split(' ')[1];
            await this.commands.handleRefresh(remoteJid, deviceId);
            return;
        }

        if (command.startsWith('gantissid ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const customerNumber = params[0];
                const newSSID = params.slice(1).join(' ');
                await this.commands.handleGantiSSID(remoteJid, customerNumber, newSSID);
            }
            return;
        }

        if (command.startsWith('gantipass ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const customerNumber = params[0];
                const newPassword = params.slice(1).join(' ');
                await this.commands.handleGantiPassword(remoteJid, customerNumber, newPassword);
            }
            return;
        }

        if (command.startsWith('reboot ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleReboot(remoteJid, customerNumber);
            return;
        }

        // Search Commands
        if (command.startsWith('cari ')) {
            logger.info(`🔍 [TECHNICIAN] Handling cari command`);
            const searchTerm = messageText.split(' ').slice(1).join(' ');
            await this.handleSearchCustomer(remoteJid, searchTerm);
            return;
        }

        // Debug GenieACS Commands (case insensitive)
        if (command.toLowerCase().startsWith('debuggenieacs ')) {
            logger.info(`🔍 [TECHNICIAN] Handling debuggenieacs command`);
            const phoneNumber = messageText.split(' ')[1];
            await this.handleDebugGenieACS(remoteJid, phoneNumber);
            return;
        }

        // Simple debug command
        if (command.toLowerCase().startsWith('debug ')) {
            logger.info(`🔍 [TECHNICIAN] Handling debug command`);
            const phoneNumber = messageText.split(' ')[1];
            await this.handleDebugGenieACS(remoteJid, phoneNumber);
            return;
        }

        // List all devices command
        if (command === 'listdevices') {
            logger.info(`🔍 [TECHNICIAN] Handling listdevices command`);
            await this.handleListDevices(remoteJid);
            return;
        }

        if (command.startsWith('tag ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const deviceId = params[0];
                const tag = params.slice(1).join(' ');
                await this.commands.handleAddTag(remoteJid, deviceId, tag);
            }
            return;
        }

        if (command.startsWith('untag ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const deviceId = params[0];
                const tag = params.slice(1).join(' ');
                await this.commands.handleRemoveTag(remoteJid, deviceId, tag);
            }
            return;
        }

        if (command.startsWith('tags ')) {
            const deviceId = messageText.split(' ')[1];
            await this.commands.handleListTags(remoteJid, deviceId);
            return;
        }

        if (command.startsWith('addtag ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const deviceId = params[0];
                const customerNumber = params[1];
                await this.commands.handleAddTag(remoteJid, deviceId, customerNumber);
            }
            return;
        }

        // System Commands
        if (command === 'status') {
            await this.commands.handleStatus(remoteJid);
            return;
        }

        if (command === 'restart') {
            await this.commands.handleRestart(remoteJid);
            return;
        }

        if (command === 'ya' || command === 'iya' || command === 'yes') {
            await this.commands.handleConfirmRestart(remoteJid);
            return;
        }

        if (command === 'tidak' || command === 'no' || command === 'batal') {
            if (global.pendingRestart && global.restartRequestedBy === remoteJid) {
                global.pendingRestart = false;
                global.restartRequestedBy = null;
                await this.commands.sendMessage(remoteJid,
                    `✅ *RESTART DIBATALKAN*\n\nRestart aplikasi telah dibatalkan.`
                );
            }
            return;
        }

        if (command === 'debug resource') {
            await this.commands.handleDebugResource(remoteJid);
            return;
        }

        if (command === 'checkgroup') {
            await this.commands.handleCheckGroup(remoteJid);
            return;
        }

        if (command.startsWith('setheader ')) {
            const newHeader = messageText.split(' ').slice(1).join(' ');
            await this.commands.handleSetHeader(remoteJid, newHeader);
            return;
        }

        // Trouble Report Commands
        if (command === 'trouble') {
            await this.troubleCommands.handleListTroubleReports(remoteJid);
            return;
        }

        if (command.startsWith('status ')) {
            const reportId = messageText.split(' ')[1];
            await this.troubleCommands.handleTroubleReportStatus(remoteJid, reportId);
            return;
        }

        if (command.startsWith('update ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const newStatus = params[1];
                const notes = params.slice(2).join(' ');
                await this.troubleCommands.handleUpdateTroubleReport(remoteJid, reportId, newStatus, notes);
            }
            return;
        }

        if (command.startsWith('selesai ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const notes = params.slice(1).join(' ');
                await this.troubleCommands.handleResolveTroubleReport(remoteJid, reportId, notes);
            }
            return;
        }

        if (command.startsWith('catatan ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const notes = params.slice(1).join(' ');
                await this.troubleCommands.handleAddNoteToTroubleReport(remoteJid, reportId, notes);
            }
            return;
        }

        if (command === 'help trouble') {
            await this.troubleCommands.handleTroubleReportHelp(remoteJid);
            return;
        }

        // PPPoE Commands
        if (command.startsWith('addpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 3) {
                const username = params[0];
                const password = params[1];
                const profile = params[2];
                const ipAddress = params[3] || null;
                const customerInfo = params.slice(4).join(' ') || null;
                await this.pppoeCommands.handleAddPPPoE(remoteJid, username, password, profile, ipAddress, customerInfo);
            }
            return;
        }

        if (command.startsWith('editpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 3) {
                const username = params[0];
                const field = params[1];
                const newValue = params.slice(2).join(' ');
                await this.pppoeCommands.handleEditPPPoE(remoteJid, username, field, newValue);
            }
            return;
        }

        if (command.startsWith('delpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 1) {
                const username = params[0];
                const reason = params.slice(1).join(' ') || null;
                await this.pppoeCommands.handleDeletePPPoE(remoteJid, username, reason);
            }
            return;
        }

        if (command.startsWith('pppoe ')) {
            const filter = messageText.split(' ').slice(1).join(' ');
            await this.pppoeCommands.handleListPPPoE(remoteJid, filter);
            return;
        }

        if (command === 'pppoe') {
            await this.pppoeCommands.handleListPPPoE(remoteJid);
            return;
        }

        if (command.startsWith('checkpppoe ')) {
            const username = messageText.split(' ')[1];
            await this.pppoeCommands.handleCheckPPPoEStatus(remoteJid, username);
            return;
        }

        if (command.startsWith('restartpppoe ')) {
            const username = messageText.split(' ')[1];
            await this.pppoeCommands.handleRestartPPPoE(remoteJid, username);
            return;
        }

        if (command === 'help pppoe') {
            await this.pppoeCommands.handlePPPoEHelp(remoteJid);
            return;
        }

        // Help Commands
        if (command === 'admin') {
            await this.sendAdminHelp(remoteJid);
            return;
        }

        if (command === 'teknisi') {
            await this.sendTechnicianHelp(remoteJid);
            return;
        }

        if (command === 'menu' || command === 'help') {
            await this.sendAdminHelp(remoteJid);
            return;
        }

        // System Info Commands
        if (command === 'version') {
            const versionMessage = getVersionMessage();
            await this.commands.sendMessage(remoteJid, versionMessage);
            return;
        }

        if (command === 'info') {
            const systemInfoMessage = getSystemInfoMessage();
            await this.commands.sendMessage(remoteJid, systemInfoMessage);
            return;
        }

        // Unknown command
        // JANGAN kirim pesan untuk command yang tidak dikenali
        // Ini akan mencegah respon otomatis terhadap setiap pesan
        console.log(`Perintah tidak dikenali dari admin: ${command}`);
        // await this.commands.sendMessage(remoteJid, 
        //     `❓ *PERINTAH TIDAK DIKENAL*
        //
        // Perintah "${command}" tidak dikenali.
        //
        // Ketik *admin* untuk melihat menu lengkap.`
        // );
    }

    // Handle customer commands
    async handleCustomerCommands(remoteJid, senderNumber, command, messageText) {
        // Customer-specific commands
        if (command === 'status') {
            await this.handleCustomerStatus(remoteJid, senderNumber);
            return;
        }

        if (command === 'menu' || command === 'help') {
            await this.sendCustomerHelp(remoteJid);
            return;
        }

        if (command === 'info') {
            await this.handleCustomerInfo(remoteJid, senderNumber);
            return;
        }

        // Search Commands (untuk pelanggan - akses terbatas)
        if (command.startsWith('cari ')) {
            const searchTerm = messageText.split(' ').slice(1).join(' ');
            await this.handleCustomerSearch(remoteJid, searchTerm);
            return;
        }

        // System Info Commands
        if (command === 'version') {
            const versionMessage = getVersionMessage();
            await this.commands.sendMessage(remoteJid, versionMessage);
            return;
        }

        // Unknown command for customer
        // JANGAN kirim pesan untuk command yang tidak dikenali
        // Ini akan mencegah respon otomatis terhadap setiap pesan
        console.log(`Perintah tidak dikenali dari pelanggan: ${command}`);
        // await this.commands.sendMessage(remoteJid, 
        //     `❓ *PERINTAH TIDAK DIKENAL*\n\nPerintah "${command}" tidak dikenali.\n\nKetik *menu* untuk melihat menu pelanggan.`
        // );
    }

    // Send admin help message
    async sendAdminHelp(remoteJid) {
        const helpMessage = getAdminHelpMessage();
        await this.commands.sendMessage(remoteJid, helpMessage);
    }

    // Send technician help message
    async sendTechnicianHelp(remoteJid) {
        const helpMessage = getTechnicianHelpMessage();
        await this.commands.sendMessage(remoteJid, helpMessage);
    }

    // Send customer help message
    async sendCustomerHelp(remoteJid) {
        const helpMessage = getCustomerHelpMessage();
        await this.commands.sendMessage(remoteJid, helpMessage);
    }

    // Handle customer status request
    async handleCustomerStatus(remoteJid, senderNumber) {
        try {
            await this.commands.sendMessage(remoteJid,
                `📱 *STATUS PELANGGAN*\n\nSedang mengecek status perangkat Anda...\nMohon tunggu sebentar.`
            );

            // Gunakan getCustomerComprehensiveData untuk mendapatkan status lengkap
            // senderNumber seharusnya sudah berupa nomor HP (resolved dari LID jika ada)
            const customerData = await this.getCustomerComprehensiveData(senderNumber);

            const formatWithHeaderFooter = (content) => {
                const header = getCompanyHeader();
                const footer = getFooterInfo();
                return `📱 *${header}*\n\n${content}\n\n_${footer}_`;
            };

            if (!customerData.deviceFound && !customerData.billingData.customer) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *DATA TIDAK DITEMUKAN*\n\n` +
                    `Nomor WhatsApp Anda (${senderNumber}) tidak terdaftar sebagai pelanggan.\n\n` +
                    `Jika Anda pelanggan baru, silakan hubungi admin untuk registrasi.`
                ));
                return;
            }

            let message = ``;

            // Info Pelanggan
            if (customerData.billingData && customerData.billingData.customer) {
                const c = customerData.billingData.customer;
                message += `👤 *INFO PELANGGAN*\n`;
                message += `• Nama: ${c.name}\n`;
                message += `• Paket: ${c.package_name || '-'}\n`;
                message += `• Tagihan: ${c.payment_status === 'paid' ? '✅ Lunas' : '⚠️ Belum Lunas'}\n\n`;
            }

            // Info Perangkat
            if (customerData.deviceFound) {
                message += `🔧 *STATUS PERANGKAT*\n`;
                message += `• Status: ${customerData.status === 'Online' ? '🟢 ONLINE' : '🔴 OFFLINE'}\n`;
                message += `• Sinyal (RX): ${customerData.rxPower}\n`;

                if (customerData.status === 'Online') {
                    message += `• Pengguna Aktif: ${customerData.connectedUsers}\n`;
                    message += `• Uptime: ${customerData.uptime}\n`;
                }

                message += `• Terakhir Update: ${customerData.lastInform}\n`;
            } else {
                message += `🔧 *STATUS PERANGKAT*\n`;
                message += `⚠️ Data perangkat tidak ditemukan / offline lama.\n`;
            }

            await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(message));

        } catch (error) {
            logger.error('Error handling customer status', {
                sender: senderNumber,
                error: error.message
            });

            await this.commands.sendMessage(remoteJid,
                `❌ *ERROR*\n\nTerjadi kesalahan saat mengecek status:\n${error.message}`
            );
        }
    }

    // Handle customer info request
    async handleCustomerInfo(remoteJid, senderNumber) {
        try {
            const billingManager = require('./billing');

            await this.commands.sendMessage(remoteJid,
                `📋 *INFO LAYANAN*\n\nSedang mengambil informasi layanan Anda...\nMohon tunggu sebentar.`
            );

            const customer = await billingManager.getCustomerByPhone(senderNumber);

            const formatWithHeaderFooter = (content) => {
                const header = getCompanyHeader();
                const footer = getFooterInfo();
                return `📋 *${header}*\n\n${content}\n\n_${footer}_`;
            };

            if (!customer) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *DATA TIDAK DITEMUKAN*\n\n` +
                    `Nomor WhatsApp Anda (${senderNumber}) tidak terdaftar.\n` +
                    `Silakan hubungi admin untuk bantuan.`
                ));
                return;
            }

            // Get invoices
            const invoices = await billingManager.getInvoicesByCustomer(customer.id);
            const unpaidInvoice = invoices.find(inv => inv.status === 'unpaid');

            let message = `👤 *PROFIL PELANGGAN*\n\n`;
            message += `• Nama: ${customer.name}\n`;
            message += `• No. HP: ${customer.phone}\n`;
            message += `• Alamat: ${customer.address || '-'}\n`;
            message += `• Terdaftar: ${customer.join_date ? new Date(customer.join_date).toLocaleDateString('id-ID') : '-'}\n\n`;

            message += `📦 *PAKET INTERNET*\n`;
            message += `• Nama: ${customer.package_name || 'Standar'}\n`;
            message += `• Kecepatan: ${customer.package_speed || '-'}\n`;
            message += `• Harga: Rp ${customer.package_price ? customer.package_price.toLocaleString('id-ID') : '0'}/bulan\n`;
            message += `• Jatuh Tempo: Tgl ${customer.billing_day || 15} setiap bulan\n\n`;

            message += `💰 *STATUS TAGIHAN*\n`;
            if (unpaidInvoice) {
                message += `⚠️ *BELUM LUNAS*\n`;
                message += `• Periode: ${unpaidInvoice.period || '-'}\n`;
                message += `• Jumlah: Rp ${unpaidInvoice.amount.toLocaleString('id-ID')}\n`;
                message += `• Tempo: ${new Date(unpaidInvoice.due_date).toLocaleDateString('id-ID')}\n`;
                message += `\nSilakan lakukan pembayaran agar layanan tidak terganggu.`;
            } else {
                message += `✅ *LUNAS*\n`;
                message += `Terima kasih telah melakukan pembayaran tepat waktu.`;
            }

            await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(message));

        } catch (error) {
            logger.error('Error handling customer info', {
                sender: senderNumber,
                error: error.message
            });

            await this.commands.sendMessage(remoteJid,
                `❌ *ERROR*\n\nTerjadi kesalahan saat mengambil info:\n${error.message}`
            );
        }
    }

    // Handle customer search command (limited access)
    async handleCustomerSearch(remoteJid, searchTerm) {
        try {
            if (!searchTerm || searchTerm.trim() === '') {
                await this.commands.sendMessage(remoteJid,
                    `❌ *FORMAT SALAH!*\n\n` +
                    `Format: cari [nama_pelanggan]\n` +
                    `Contoh:\n` +
                    `• cari andi\n` +
                    `• cari santo`
                );
                return;
            }

            // Import billing manager
            const billingManager = require('./billing');

            // Send processing message
            await this.commands.sendMessage(remoteJid,
                `🔍 *MENCARI PELANGGAN*\n\nSedang mencari data pelanggan dengan kata kunci: "${searchTerm}"\nMohon tunggu sebentar...`
            );

            // Search customers
            const customers = await billingManager.findCustomersByNameOrPhone(searchTerm);

            if (customers.length === 0) {
                await this.commands.sendMessage(remoteJid,
                    `❌ *PELANGGAN TIDAK DITEMUKAN!*\n\n` +
                    `Tidak ada pelanggan yang ditemukan dengan kata kunci: "${searchTerm}"\n\n` +
                    `💡 *Tips pencarian:*\n` +
                    `• Gunakan nama lengkap atau sebagian\n` +
                    `• Pastikan ejaan benar`
                );
                return;
            }

            // Format search results (limited info for customers)
            let message = `🔍 *HASIL PENCARIAN PELANGGAN*\n\n`;
            message += `Kata kunci: "${searchTerm}"\n`;
            message += `Ditemukan: ${customers.length} pelanggan\n\n`;

            for (let i = 0; i < customers.length; i++) {
                const customer = customers[i];
                const status = customer.status === 'active' ? '🟢 Aktif' : '🔴 Nonaktif';

                message += `📋 *${i + 1}. ${customer.name}*\n`;
                message += `📱 Phone: ${customer.phone}\n`;
                message += `📦 Paket: ${customer.package_name || 'N/A'} (${customer.package_speed || 'N/A'})\n`;
                message += `💰 Harga: Rp ${customer.package_price ? customer.package_price.toLocaleString('id-ID') : 'N/A'}\n`;
                message += `📊 Status: ${status}\n`;

                if (customer.address) {
                    message += `📍 Alamat: ${customer.address}\n`;
                }

                message += `\n`;
            }

            // Add usage instructions
            message += `💡 *Untuk informasi lebih detail, hubungi admin.*`;

            await this.commands.sendMessage(remoteJid, message);

        } catch (error) {
            logger.error('Error handling customer search', {
                searchTerm,
                error: error.message
            });

            await this.commands.sendMessage(remoteJid,
                `❌ *ERROR SISTEM!*\n\n` +
                `Terjadi kesalahan saat mencari pelanggan:\n${error.message}\n\n` +
                `Silakan coba lagi atau hubungi admin.`
            );
        }
    }

    // Handle search customer command
    async handleSearchCustomer(remoteJid, searchTerm) {
        try {
            if (!searchTerm || searchTerm.trim() === '') {
                await this.commands.sendMessage(remoteJid,
                    `❌ *FORMAT SALAH!*\n\n` +
                    `Format: cari [nama_pelanggan/pppoe_username]\n` +
                    `Contoh:\n` +
                    `• cari andi\n` +
                    `• cari santo\n` +
                    `• cari leha\n` +
                    `• cari 081234567890`
                );
                return;
            }

            // Import billing manager and genieacs
            const billingManager = require('./billing');
            const genieacsApi = require('./genieacs');

            // Send processing message
            await this.commands.sendMessage(remoteJid,
                `🔍 *MENCARI PELANGGAN*\n\nSedang mencari data pelanggan dengan kata kunci: "${searchTerm}"\nMohon tunggu sebentar...`
            );

            // Search customers
            const customers = await billingManager.findCustomersByNameOrPhone(searchTerm);

            if (customers.length === 0) {
                await this.commands.sendMessage(remoteJid,
                    `❌ *PELANGGAN TIDAK DITEMUKAN!*\n\n` +
                    `Tidak ada pelanggan yang ditemukan dengan kata kunci: "${searchTerm}"\n\n` +
                    `💡 *Tips pencarian:*\n` +
                    `• Gunakan nama lengkap atau sebagian\n` +
                    `• Gunakan PPPoE username\n` +
                    `• Gunakan nomor telepon\n` +
                    `• Pastikan ejaan benar`
                );
                return;
            }

            // Format search results
            let message = `🔍 *HASIL PENCARIAN PELANGGAN*\n\n`;
            message += `Kata kunci: "${searchTerm}"\n`;
            message += `Ditemukan: ${customers.length} pelanggan\n\n`;

            for (let i = 0; i < customers.length; i++) {
                const customer = customers[i];
                const status = customer.status === 'active' ? '🟢 Aktif' : '🔴 Nonaktif';
                const paymentStatus = customer.payment_status === 'overdue' ? '🔴 Overdue' :
                    customer.payment_status === 'unpaid' ? '🟡 Belum Bayar' :
                        customer.payment_status === 'paid' ? '🟢 Lunas' : '⚪ No Invoice';

                message += `📋 *${i + 1}. ${customer.name}*\n`;
                message += `📱 Phone: ${customer.phone}\n`;
                message += `👤 Username: ${customer.username || 'N/A'}\n`;
                message += `🌐 PPPoE: ${customer.pppoe_username || 'N/A'}\n`;
                message += `📦 Paket: ${customer.package_name || 'N/A'} (${customer.package_speed || 'N/A'})\n`;
                message += `💰 Harga: Rp ${customer.package_price ? customer.package_price.toLocaleString('id-ID') : 'N/A'}\n`;
                message += `📊 Status: ${status}\n`;
                message += `💳 Payment: ${paymentStatus}\n`;

                if (customer.address) {
                    message += `📍 Alamat: ${customer.address}\n`;
                }

                // Get comprehensive data using customer dashboard logic
                try {
                    const customerData = await this.getCustomerComprehensiveData(customer.phone);

                    if (customerData.deviceFound) {
                        message += `\n🔧 *DATA PERANGKAT GENIEACS:*\n`;
                        message += `• Status: ${customerData.status}\n`;
                        message += `• Last Inform: ${customerData.lastInform}\n`;
                        message += `• Device ID: ${customerData.deviceId}\n`;
                        message += `• Serial: ${customerData.serialNumber}\n`;
                        message += `• Manufacturer: ${customerData.manufacturer}\n`;
                        message += `• Model: ${customerData.model}\n`;
                        message += `• Hardware: ${customerData.hardwareVersion}\n`;
                        message += `• Firmware: ${customerData.firmware}\n`;
                        message += `• Device Uptime: ${customerData.uptime}\n`;
                        message += `• PPP Uptime: ${customerData.pppUptime}\n`;
                        message += `• PPPoE IP: ${customerData.pppoeIP}\n`;
                        message += `• PPPoE Username: ${customerData.pppoeUsername}\n`;
                        message += `• RX Power: ${customerData.rxPower} dBm\n`;
                        message += `• Temperature: ${customerData.temperature}°C\n`;
                        message += `• SSID 2.4G: ${customerData.ssid}\n`;
                        message += `• SSID 5G: ${customerData.ssid5G}\n`;
                        message += `• User Terkoneksi: ${customerData.connectedUsers}\n`;
                        message += `• PON Mode: ${customerData.ponMode}\n`;

                        if (customerData.tags && customerData.tags.length > 0) {
                            message += `• Tags: ${customerData.tags.join(', ')}\n`;
                        }
                    } else {
                        message += `\n🔧 *DATA PERANGKAT:* ${customerData.message}\n`;
                        message += `• PPPoE Username: ${customer.pppoe_username || 'N/A'}\n`;
                        message += `• Username: ${customer.username || 'N/A'}\n`;
                    }
                } catch (deviceError) {
                    logger.error(`❌ [SEARCH] Error getting device data for ${customer.phone}:`, deviceError.message);
                    message += `\n🔧 *DATA PERANGKAT:* Error mengambil data perangkat\n`;
                    message += `• Error: ${deviceError.message}\n`;
                }

                message += `\n`;
            }

            // Add usage instructions
            message += `💡 *Cara menggunakan data di atas:*\n`;
            message += `• Gunakan nomor telepon untuk perintah cek status\n`;
            message += `• Contoh: cek ${customers[0].phone}\n`;
            message += `• Atau: cekstatus ${customers[0].phone}`;

            await this.commands.sendMessage(remoteJid, message);

        } catch (error) {
            logger.error('Error handling search customer', {
                searchTerm,
                error: error.message
            });

            await this.commands.sendMessage(remoteJid,
                `❌ *ERROR SISTEM!*\n\n` +
                `Terjadi kesalahan saat mencari pelanggan:\n${error.message}\n\n` +
                `Silakan coba lagi atau hubungi admin.`
            );
        }
    }

    // Get comprehensive customer data using customer dashboard logic
    async getCustomerComprehensiveData(phone) {
        try {
            // 1. Ambil data customer dari billing terlebih dahulu (coba semua varian phone)
            let customer = null;
            const phoneVariants = this.generatePhoneVariants(phone);

            logger.info(`🔍 [COMPREHENSIVE] Searching customer with phone variants:`, phoneVariants);

            for (const variant of phoneVariants) {
                try {
                    const billingManager = require('./billing');
                    customer = await billingManager.getCustomerByPhone(variant);
                    if (customer) {
                        logger.info(`✅ [COMPREHENSIVE] Customer found in billing with variant: ${variant}`);
                        break;
                    }
                } catch (error) {
                    logger.warn(`⚠️ [COMPREHENSIVE] Error searching with variant ${variant}:`, error.message);
                }
            }

            let device = null;
            let billingData = null;

            if (customer) {
                logger.info(`✅ [COMPREHENSIVE] Customer found in billing: ${customer.name} (${customer.phone}) - searched with: ${phone}`);

                // 2. CUSTOMER BILLING: Cari device berdasarkan PPPoE username (FAST PATH)
                if (customer.pppoe_username || customer.username) {
                    try {
                        const { genieacsApi } = require('./genieacs');
                        const pppoeToSearch = customer.pppoe_username || customer.username;
                        logger.info(`🔍 [COMPREHENSIVE] Searching device by PPPoE username: ${pppoeToSearch}`);

                        device = await genieacsApi.findDeviceByPPPoE(pppoeToSearch);
                        if (device) {
                            logger.info(`✅ [COMPREHENSIVE] Device found by PPPoE username: ${pppoeToSearch}`);
                        } else {
                            logger.warn(`⚠️ [COMPREHENSIVE] No device found by PPPoE username: ${pppoeToSearch}`);
                        }
                    } catch (error) {
                        logger.error('❌ [COMPREHENSIVE] Error finding device by PPPoE username:', error.message);
                    }
                }

                // 3. Jika tidak ditemukan dengan PPPoE, coba dengan tag sebagai fallback
                if (!device) {
                    logger.info(`🔍 [COMPREHENSIVE] Trying tag search as fallback...`);
                    const { genieacsApi } = require('./genieacs');
                    const tagVariants = this.generatePhoneVariants(phone);

                    for (const v of tagVariants) {
                        try {
                            device = await genieacsApi.findDeviceByPhoneNumber(v);
                            if (device) {
                                logger.info(`✅ [COMPREHENSIVE] Device found by tag fallback: ${v}`);
                                break;
                            }
                        } catch (error) {
                            logger.warn(`⚠️ [COMPREHENSIVE] Error searching by tag ${v}:`, error.message);
                        }
                    }
                }

                // 4. Siapkan data billing
                try {
                    const billingManager = require('./billing');
                    const invoices = await billingManager.getInvoicesByCustomer(customer.id);
                    billingData = {
                        customer: customer,
                        invoices: invoices || []
                    };
                } catch (error) {
                    logger.error('❌ [COMPREHENSIVE] Error getting billing data:', error);
                    billingData = {
                        customer: customer,
                        invoices: []
                    };
                }

            } else {
                // 5. CUSTOMER NON-BILLING: Cari device berdasarkan tag saja (FAST PATH)
                logger.info(`⚠️ [COMPREHENSIVE] Customer not found in billing, searching GenieACS by tag only`);

                const { genieacsApi } = require('./genieacs');
                const tagVariants = this.generatePhoneVariants(phone);
                for (const v of tagVariants) {
                    try {
                        device = await genieacsApi.findDeviceByPhoneNumber(v);
                        if (device) {
                            logger.info(`✅ [COMPREHENSIVE] Device found by tag: ${v}`);
                            break;
                        }
                    } catch (error) {
                        logger.warn(`⚠️ [COMPREHENSIVE] Error searching by tag ${v}:`, error.message);
                    }
                }
            }

            // 6. Jika tidak ada device di GenieACS, buat data default yang informatif
            if (!device) {
                logger.info(`⚠️ [COMPREHENSIVE] No device found in GenieACS for: ${phone}`);

                return {
                    phone: phone,
                    ssid: customer ? `WiFi-${customer.username}` : 'WiFi-Default',
                    status: 'Unknown',
                    lastInform: '-',
                    firmware: '-',
                    rxPower: '-',
                    pppoeIP: '-',
                    pppoeUsername: customer ? (customer.pppoe_username || customer.username) : '-',
                    connectedUsers: '0',
                    billingData: billingData,
                    deviceFound: false,
                    searchMethod: customer ? 'pppoe_username_fallback_tag' : 'tag_only',
                    message: customer ?
                        'Device ONU tidak ditemukan di GenieACS. Silakan hubungi teknisi untuk setup device.' :
                        'Customer tidak terdaftar di sistem billing. Silakan hubungi admin.'
                };
            }

            // 7. Jika ada device di GenieACS, ambil data lengkap
            logger.info(`✅ [COMPREHENSIVE] Processing device data for: ${device._id}`);

            const ssid = device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.SSID?._value ||
                device?.VirtualParameters?.SSID ||
                (customer ? `WiFi-${customer.username}` : 'WiFi-Default');

            const lastInform = device?._lastInform
                ? new Date(device._lastInform).toLocaleString('id-ID')
                : device?.Events?.Inform
                    ? new Date(device.Events.Inform).toLocaleString('id-ID')
                    : device?.InternetGatewayDevice?.DeviceInfo?.['1']?.LastInform?._value
                        ? new Date(device.InternetGatewayDevice.DeviceInfo['1'].LastInform._value).toLocaleString('id-ID')
                        : '-';

            const status = lastInform !== '-' ? 'Online' : 'Unknown';

            // Extract device parameters
            const rxPower = this.getParameterWithPaths(device, this.parameterPaths.rxPower) || '-';
            const pppoeIP = this.getParameterWithPaths(device, this.parameterPaths.pppoeIP) || '-';
            const pppoeUsername = customer ? (customer.pppoe_username || customer.username) :
                this.getParameterWithPaths(device, this.parameterPaths.pppUsername) || '-';
            const connectedUsers = this.getParameterWithPaths(device, this.parameterPaths.userConnected) || '0';
            const temperature = this.getParameterWithPaths(device, this.parameterPaths.temperature) || '-';
            const ponMode = this.getParameterWithPaths(device, this.parameterPaths.ponMode) || '-';
            const pppUptime = this.getParameterWithPaths(device, this.parameterPaths.pppUptime) || '-';
            const firmware = device?.InternetGatewayDevice?.DeviceInfo?.SoftwareVersion?._value ||
                device?.VirtualParameters?.softwareVersion || '-';
            const uptime = device?.InternetGatewayDevice?.DeviceInfo?.UpTime?._value || '-';
            const serialNumber = device.DeviceID?.SerialNumber ||
                device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value ||
                device._id;
            const manufacturer = device.InternetGatewayDevice?.DeviceInfo?.Manufacturer?._value || '-';
            const model = device.DeviceID?.ProductClass ||
                device.InternetGatewayDevice?.DeviceInfo?.ModelName?._value || '-';
            const hardwareVersion = device.InternetGatewayDevice?.DeviceInfo?.HardwareVersion?._value || '-';

            // SSID 5G
            const ssid5G = this.getSSIDValue(device, '5') || 'N/A';

            // Tags
            const tags = device._tags || [];

            return {
                phone: phone,
                ssid: ssid,
                status: status,
                lastInform: lastInform,
                deviceId: device._id,
                serialNumber: serialNumber,
                manufacturer: manufacturer,
                model: model,
                hardwareVersion: hardwareVersion,
                firmware: firmware,
                uptime: uptime,
                pppUptime: pppUptime,
                pppoeIP: pppoeIP,
                pppoeUsername: pppoeUsername,
                rxPower: rxPower,
                temperature: temperature,
                ssid5G: ssid5G,
                connectedUsers: connectedUsers,
                ponMode: ponMode,
                tags: tags,
                billingData: billingData,
                deviceFound: true,
                searchMethod: customer ? 'pppoe_username_fallback_tag' : 'tag_only'
            };

        } catch (error) {
            logger.error('❌ [COMPREHENSIVE] Error in getCustomerComprehensiveData:', error);
            return {
                phone: phone,
                deviceFound: false,
                message: `Error: ${error.message}`,
                searchMethod: 'error'
            };
        }
    }

    // Helper method to check device status
    getDeviceStatus(lastInform) {
        if (!lastInform) return false;
        const now = Date.now();
        const lastInformTime = new Date(lastInform).getTime();
        const timeDiff = now - lastInformTime;
        // Consider device online if last inform was within 5 minutes
        return timeDiff < 5 * 60 * 1000;
    }

    // Helper method to format uptime (from genieacs-commands.js)
    formatUptime(uptimeValue) {
        if (!uptimeValue || uptimeValue === 'N/A') return 'N/A';

        // If already formatted (like "5d 04:50:18"), return as is
        if (typeof uptimeValue === 'string' && uptimeValue.includes('d ')) {
            return uptimeValue;
        }

        // If it's seconds, convert to formatted string
        if (!isNaN(uptimeValue)) {
            const seconds = parseInt(uptimeValue);
            const days = Math.floor(seconds / (24 * 3600));
            const hours = Math.floor((seconds % (24 * 3600)) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;

            let result = '';
            if (days > 0) result += `${days}d `;
            if (hours > 0) result += `${hours}h `;
            if (minutes > 0) result += `${minutes}m `;
            if (secs > 0) result += `${secs}s`;

            return result.trim() || '0s';
        }

        return uptimeValue;
    }

    // Helper method to get device parameters from GenieACS device object
    getDeviceParameters(device) {
        const getParameterWithPaths = (device, paths) => {
            if (!device || !paths || !Array.isArray(paths)) return 'N/A';

            for (const path of paths) {
                try {
                    const value = this.getParameterValue(device, path);
                    if (value && value !== 'N/A') {
                        return value;
                    }
                } catch (error) {
                    // Continue to next path
                }
            }
            return 'N/A';
        };

        const getParameterValue = (device, path) => {
            if (!device || !path) return 'N/A';

            try {
                const pathParts = path.split('.');
                let current = device;

                for (const part of pathParts) {
                    if (current && typeof current === 'object') {
                        current = current[part];
                    } else {
                        return 'N/A';
                    }
                }

                // Handle GenieACS parameter format
                if (current && typeof current === 'object' && current._value !== undefined) {
                    return current._value;
                }

                // Handle direct value
                if (current !== null && current !== undefined && current !== '') {
                    return current;
                }

                return 'N/A';
            } catch (error) {
                return 'N/A';
            }
        };

        const getSSIDValue = (device, configIndex) => {
            try {
                // Try method 1: Using bracket notation for WLANConfiguration
                if (device.InternetGatewayDevice &&
                    device.InternetGatewayDevice.LANDevice &&
                    device.InternetGatewayDevice.LANDevice['1'] &&
                    device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration &&
                    device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex] &&
                    device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex].SSID) {

                    const ssidObj = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex].SSID;
                    if (ssidObj._value !== undefined) {
                        return ssidObj._value;
                    }
                }

                // Try method 2: Using getParameterWithPaths
                const ssidPath = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${configIndex}.SSID`;
                const ssidValue = getParameterWithPaths(device, [ssidPath]);
                if (ssidValue && ssidValue !== 'N/A') {
                    return ssidValue;
                }

                return 'N/A';
            } catch (error) {
                return 'N/A';
            }
        };

        const formatUptime = (uptimeValue) => {
            if (!uptimeValue || uptimeValue === 'N/A') return 'N/A';

            // If already formatted (like "5d 04:50:18"), return as is
            if (typeof uptimeValue === 'string' && uptimeValue.includes('d ')) {
                return uptimeValue;
            }

            // If it's seconds, convert to formatted string
            if (!isNaN(uptimeValue)) {
                const seconds = parseInt(uptimeValue);
                const days = Math.floor(seconds / (24 * 3600));
                const hours = Math.floor((seconds % (24 * 3600)) / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                const secs = seconds % 60;

                let result = '';
                if (days > 0) result += `${days}d `;
                if (hours > 0) result += `${hours}h `;
                if (minutes > 0) result += `${minutes}m `;
                if (secs > 0) result += `${secs}s`;

                return result.trim() || '0s';
            }

            return uptimeValue;
        };

        // Parameter paths for different device parameters
        const parameterPaths = {
            rxPower: [
                'VirtualParameters.RXPower',
                'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RXPower',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_ALU-COM_RxPower',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.RxPower',
                'Device.Optical.Interface.1.RxPower'
            ],
            pppoeIP: [
                'VirtualParameters.pppoeIP',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress',
                'Device.PPP.Interface.1.IPCPExtensions.RemoteIPAddress'
            ],
            uptime: [
                'VirtualParameters.getdeviceuptime',
                'InternetGatewayDevice.DeviceInfo.UpTime',
                'Device.DeviceInfo.UpTime'
            ],
            firmware: [
                'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
                'Device.DeviceInfo.SoftwareVersion'
            ],
            userConnected: [
                'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations',
                'VirtualParameters.activedevices',
                'Device.WiFi.AccessPoint.1.AssociatedDeviceNumberOfEntries'
            ],
            temperature: [
                'VirtualParameters.gettemp',
                'InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureValue',
                'Device.DeviceInfo.TemperatureStatus.TemperatureValue'
            ],
            serialNumber: [
                'VirtualParameters.getSerialNumber',
                'InternetGatewayDevice.DeviceInfo.SerialNumber'
            ],
            ponMode: [
                'VirtualParameters.getponmode'
            ]
        };

        return {
            serialNumber: getParameterWithPaths(device, parameterPaths.serialNumber),
            firmware: getParameterWithPaths(device, parameterPaths.firmware),
            rxPower: getParameterWithPaths(device, parameterPaths.rxPower),
            pppoeIP: getParameterWithPaths(device, parameterPaths.pppoeIP),
            uptime: formatUptime(getParameterWithPaths(device, parameterPaths.uptime)),
            temperature: getParameterWithPaths(device, parameterPaths.temperature),
            connectedUsers: getParameterWithPaths(device, parameterPaths.userConnected),
            ponMode: getParameterWithPaths(device, parameterPaths.ponMode),
            ssid: getSSIDValue(device, '1'),
            ssid5G: getSSIDValue(device, '5')
        };
    }

    // Handle list all devices command
    async handleListDevices(remoteJid) {
        try {
            const genieacsApi = require('./genieacs');

            await this.commands.sendMessage(remoteJid,
                `🔍 *LIST ALL DEVICES*\n\nSedang mengambil daftar semua perangkat dari GenieACS...\nMohon tunggu...`
            );

            const allDevices = await genieacsApi.getDevices();

            if (!allDevices || allDevices.length === 0) {
                await this.commands.sendMessage(remoteJid,
                    `❌ *TIDAK ADA PERANGKAT!*\n\nTidak ada perangkat yang ditemukan di GenieACS.`
                );
                return;
            }

            let message = `📱 *DAFTAR SEMUA PERANGKAT*\n\n`;
            message += `Total perangkat: ${allDevices.length}\n\n`;

            // Tampilkan 10 perangkat pertama dengan detail
            const devicesToShow = allDevices.slice(0, 10);

            for (let i = 0; i < devicesToShow.length; i++) {
                const device = devicesToShow[i];
                message += `${i + 1}. *Device ID:* ${device._id}\n`;
                message += `   *Tags:* ${device._tags ? device._tags.join(', ') : 'None'}\n`;
                message += `   *Last Inform:* ${device._lastInform ? new Date(device._lastInform).toLocaleString() : 'N/A'}\n`;

                // Cek PPPoE username
                const pppoeUsername = this.getParameterWithPaths(device, this.parameterPaths.pppUsername);
                if (pppoeUsername !== 'N/A') {
                    message += `   *PPPoE Username:* ${pppoeUsername}\n`;
                }

                // Cek serial number
                const serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 'N/A';
                if (serialNumber !== 'N/A') {
                    message += `   *Serial:* ${serialNumber}\n`;
                }

                message += `\n`;
            }

            if (allDevices.length > 10) {
                message += `... dan ${allDevices.length - 10} perangkat lainnya\n\n`;
            }

            // Tampilkan semua tags yang ada
            const allTags = new Set();
            allDevices.forEach(device => {
                if (device._tags) {
                    device._tags.forEach(tag => allTags.add(tag));
                }
            });

            if (allTags.size > 0) {
                message += `🏷️ *SEMUA TAGS YANG ADA:*\n`;
                const tagsArray = Array.from(allTags).sort();
                message += tagsArray.join(', ');
            }

            await this.commands.sendMessage(remoteJid, message);

        } catch (error) {
            logger.error('Error in handleListDevices:', error);
            await this.commands.sendMessage(remoteJid,
                `❌ *ERROR SISTEM!*\n\nTerjadi kesalahan saat mengambil daftar perangkat:\n${error.message}`
            );
        }
    }

    // Handle debug GenieACS command
    async handleDebugGenieACS(remoteJid, phoneNumber) {
        try {
            if (!phoneNumber) {
                await this.commands.sendMessage(remoteJid,
                    `❌ *FORMAT SALAH!*\n\n` +
                    `Format: debuggenieacs [nomor_telepon]\n` +
                    `Contoh: debuggenieacs 087786722675`
                );
                return;
            }

            await this.commands.sendMessage(remoteJid,
                `🔍 *DEBUG GENIEACS*\n\nSedang mengecek data GenieACS untuk nomor: ${phoneNumber}\nMohon tunggu...`
            );

            // Get comprehensive data using customer dashboard logic
            const customerData = await this.getCustomerComprehensiveData(phoneNumber);

            let message = `🔍 *DEBUG GENIEACS*\n\n`;
            message += `📱 *Nomor:* ${phoneNumber}\n`;
            message += `🔍 *Search Method:* ${customerData.searchMethod}\n`;
            message += `📊 *Device Found:* ${customerData.deviceFound ? '✅ Ya' : '❌ Tidak'}\n\n`;

            if (customerData.billingData && customerData.billingData.customer) {
                const customer = customerData.billingData.customer;
                message += `👤 *DATA BILLING:*\n`;
                message += `• Nama: ${customer.name}\n`;
                message += `• Username: ${customer.username || 'N/A'}\n`;
                message += `• PPPoE Username: ${customer.pppoe_username || 'N/A'}\n`;
                message += `• Status: ${customer.status || 'N/A'}\n`;
                message += `• Package: ${customer.package_id || 'N/A'}\n\n`;
            } else {
                message += `❌ *BILLING:* Customer tidak ditemukan di database billing\n\n`;
            }

            if (customerData.deviceFound) {
                message += `🔧 *DATA PERANGKAT GENIEACS:*\n`;
                message += `• Status: ${customerData.status}\n`;
                message += `• Last Inform: ${customerData.lastInform}\n`;
                message += `• Device ID: ${customerData.deviceId}\n`;
                message += `• Serial: ${customerData.serialNumber}\n`;
                message += `• Manufacturer: ${customerData.manufacturer}\n`;
                message += `• Model: ${customerData.model}\n`;
                message += `• Hardware: ${customerData.hardwareVersion}\n`;
                message += `• Firmware: ${customerData.firmware}\n`;
                message += `• Device Uptime: ${customerData.uptime}\n`;
                message += `• PPP Uptime: ${customerData.pppUptime}\n`;
                message += `• PPPoE IP: ${customerData.pppoeIP}\n`;
                message += `• PPPoE Username: ${customerData.pppoeUsername}\n`;
                message += `• RX Power: ${customerData.rxPower} dBm\n`;
                message += `• Temperature: ${customerData.temperature}°C\n`;
                message += `• SSID 2.4G: ${customerData.ssid}\n`;
                message += `• SSID 5G: ${customerData.ssid5G}\n`;
                message += `• User Terkoneksi: ${customerData.connectedUsers}\n`;
                message += `• PON Mode: ${customerData.ponMode}\n`;

                if (customerData.tags && customerData.tags.length > 0) {
                    message += `• Tags: ${customerData.tags.join(', ')}\n`;
                }
            } else {
                message += `❌ *PERANGKAT:* ${customerData.message}\n`;
            }

            await this.commands.sendMessage(remoteJid, message);

        } catch (error) {
            logger.error('Error in handleDebugGenieACS:', error);
            await this.commands.sendMessage(remoteJid,
                `❌ *ERROR SISTEM!*\n\nTerjadi kesalahan saat debug GenieACS:\n${error.message}`
            );
        }
    }

    // Handle welcome message for super admin
    async handleSuperAdminWelcome(sock) {
        if (!global.superAdminWelcomeSent && this.core.getSuperAdmin() && this.core.getSetting('superadmin_welcome_enabled', true)) {
            try {
                const superAdminJid = this.core.createJID(this.core.getSuperAdmin());
                if (superAdminJid) {
                    await sock.sendMessage(superAdminJid, {
                        text: `${this.core.getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
👋 *Selamat datang*

Aplikasi WhatsApp Bot berhasil dijalankan.

Rekening Donasi Untuk Pengembangan aplikasi
# 4206 01 003953 53 1 BRI an WARJAYA

E-Wallet : 081947215703

${this.core.getSetting('footer_info', 'Internet Tanpa Batas')}`
                    });
                    global.superAdminWelcomeSent = true;
                    logger.info('Pesan selamat datang terkirim ke super admin');
                }
            } catch (err) {
                logger.error('Gagal mengirim pesan selamat datang ke super admin:', err);
            }
        }
    }
}

module.exports = WhatsAppMessageHandlers;
