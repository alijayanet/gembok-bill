const AgentManager = require('./agentManager');
const AgentWhatsAppManager = require('./agentWhatsApp');
const billingManager = require('./billing');

class AgentWhatsAppCommands {
    constructor() {
        this.agentManager = new AgentManager();
        this.whatsappManager = new AgentWhatsAppManager();
        
        // Set WhatsApp socket when available
        if (typeof global !== 'undefined' && global.whatsappStatus && global.whatsappStatus.connected) {
            // Try to get socket from various sources
            let sock = null;
            
            // Check if there's a global whatsapp socket
            if (typeof global.getWhatsAppSocket === 'function') {
                sock = global.getWhatsAppSocket();
            } else if (global.whatsappSocket) {
                sock = global.whatsappSocket;
            } else if (global.whatsapp && typeof global.whatsapp.getSock === 'function') {
                sock = global.whatsapp.getSock();
            }
            
            if (sock) {
                this.whatsappManager.setSocket(sock);
                console.log('WhatsApp socket set for AgentWhatsAppManager in AgentWhatsAppCommands');
            } else {
                console.warn('WhatsApp socket not available for AgentWhatsAppManager in AgentWhatsAppCommands');
            }
        }
        
        this.billingManager = billingManager; // Gunakan instance singleton
    }

    // Handle incoming message
    async handleMessage(from, message) {
        try {
            // Extract phone number from WhatsApp JID or use directly if already a phone number
            let phoneNumber = from;
            if (from.includes('@s.whatsapp.net')) {
                phoneNumber = from.replace('@s.whatsapp.net', '');
            } else if (from.includes('@lid')) {
                phoneNumber = from.replace('@lid', '');
            }
            
            // Normalize phone number
            phoneNumber = phoneNumber.replace(/\D/g, '');
            if (phoneNumber.startsWith('0')) {
                phoneNumber = '62' + phoneNumber.slice(1);
            } else if (!phoneNumber.startsWith('62')) {
                phoneNumber = '62' + phoneNumber;
            }
            
            // Authenticate agent by phone number
            const agent = await this.agentManager.getAgentByPhone(phoneNumber);
            if (!agent) {
                // JANGAN kirim pesan untuk agent yang tidak dikenali
                // Ini akan mencegah respon otomatis terhadap setiap pesan
                console.log(`Agent tidak dikenali: ${from}`);
                return null;
                // return this.sendMessage(from, "❌ Anda tidak terdaftar sebagai agent. Silakan hubungi admin.");
            }

            // Parse command
            const command = this.parseCommand(message);
            
            // If command is not recognized, don't send any response
            if (!command) {
                // JANGAN kirim pesan untuk command yang tidak dikenali
                // Ini akan mencegah respon otomatis terhadap setiap pesan
                console.log(`Command tidak dikenali: ${message}`);
                return null;
            }
            
            switch (command.type) {
                case 'help':
                    return this.handleHelp(from);
                case 'saldo':
                    return this.handleCheckBalance(from, agent);
                case 'cek_tagihan':
                    return this.handleCheckBill(from, agent, command.params);
                case 'bayar_tagihan':
                    return this.handlePayBill(from, agent, command.params);
                case 'beli_voucher':
                    return this.handleBuyVoucher(from, agent, command.params);
                case 'jual':
                    return this.handleSellVoucher(from, agent, command.params);
                case 'bayar':
                    return this.handleProcessPayment(from, agent, command.params);
                case 'list_tagihan':
                    return this.handleListTagihan(from, agent);
                case 'list_bayar':
                    return this.handleListBayar(from, agent);
                case 'riwayat':
                    return this.handleTransactionHistory(from, agent);
                case 'request':
                    return this.handleRequestBalance(from, agent, command.params);
                default:
                    // JANGAN kirim pesan untuk command yang tidak dikenali
                    // Ini akan mencegah respon otomatis terhadap setiap pesan
                    console.log(`Command tidak dikenali: ${command.type}`);
                    return null;
                    // return this.sendMessage(from, "❌ Command tidak dikenali. Ketik *HELP* untuk melihat daftar command.");
            }
        } catch (error) {
            console.error('Error handling WhatsApp message:', error);
            // JANGAN kirim pesan error ke pengirim - hanya log error saja
            // Ini akan mencegah respon otomatis terhadap setiap pesan
            // return this.sendMessage(from, "❌ Terjadi kesalahan. Silakan coba lagi.");
            return null;
        }
    }

    // Parse command from message
    parseCommand(message) {
        const text = message.toLowerCase().trim();
        
        if (text.includes('help') || text.includes('bantuan')) {
            return { type: 'help' };
        }
        
        if (text.includes('saldo') || text.includes('balance')) {
            return { type: 'saldo' };
        }
        
        if (text.includes('cek tagihan') || text.includes('cek_tagihan')) {
            const params = this.parseCheckBillParams(text);
            return { type: 'cek_tagihan', params };
        }
        
        if (text.includes('bayar tagihan') || text.includes('bayar_tagihan')) {
            const params = this.parsePayBillParams(text);
            return { type: 'bayar_tagihan', params };
        }
        
        if (text.includes('beli voucher') || text.includes('beli_voucher')) {
            const params = this.parseBuyVoucherParams(text);
            return { type: 'beli_voucher', params };
        }
        
        if (text.includes('jual') || text.includes('sell')) {
            const params = this.parseSellParams(text);
            return { type: 'jual', params };
        }
        
        if (text.includes('bayar') || text.includes('payment')) {
            const params = this.parsePaymentParams(text);
            return { type: 'bayar', params };
        }
        
        if (text.includes('request') || text.includes('minta')) {
            const params = this.parseRequestParams(text);
            return { type: 'request', params };
        }
        
        if (text.includes('list tagihan') || text.includes('list_tagihan')) {
            return { type: 'list_tagihan' };
        }

        if (text.includes('list bayar') || text.includes('list_bayar')) {
            return { type: 'list_bayar' };
        }

        if (text.includes('riwayat') || text.includes('history')) {
            return { type: 'riwayat' };
        }

        // Return null for unrecognized commands instead of undefined
        return null;
    }

    // Parse payment parameters
    parsePaymentParams(text) {
        // Format: BAYAR [NAMA_PELANGGAN] [NOMOR_HP] [JUMLAH] [KIRIM_WHATSAPP]
        const parts = text.split(' ');
        const bayarIndex = parts.findIndex(p => p.includes('bayar'));
        
        if (bayarIndex === -1 || parts.length < bayarIndex + 4) {
            return null;
        }
        
        return {
            customerName: parts[bayarIndex + 1],
            customerPhone: parts[bayarIndex + 2],
            amount: parseFloat(parts[bayarIndex + 3]),
            sendWhatsApp: parts[bayarIndex + 4] === 'ya' || parts[bayarIndex + 4] === 'yes'
        };
    }

    // Parse request balance parameters
    parseRequestParams(text) {
        // Format: REQUEST [JUMLAH] [CATATAN]
        const parts = text.split(' ');
        const requestIndex = parts.findIndex(p => p.includes('request') || p.includes('minta'));
        
        if (requestIndex === -1 || parts.length < requestIndex + 2) {
            return null;
        }
        
        return {
            amount: parseFloat(parts[requestIndex + 1]),
            notes: parts.slice(requestIndex + 2).join(' ')
        };
    }

    // Parse buy voucher parameters
    parseBuyVoucherParams(text) {
        // Format: BELI VOUCHER [PAKET] [NOMOR_HP]
        const parts = text.split(' ');
        const beliIndex = parts.findIndex(p => p.includes('beli'));
        
        if (beliIndex === -1 || parts.length < beliIndex + 3) {
            return null;
        }
        
        return {
            package: parts[beliIndex + 2], // PAKET
            customerPhone: parts[beliIndex + 3] || null // NOMOR_HP (optional)
        };
    }

    // Parse sell voucher parameters
    parseSellParams(text) {
        // Format: JUAL [PAKET] [NOMOR_HP]
        const parts = text.split(' ');
        const jualIndex = parts.findIndex(p => p.includes('jual'));
        
        if (jualIndex === -1 || parts.length < jualIndex + 2) {
            return null;
        }
        
        return {
            package: parts[jualIndex + 1], // PAKET
            customerPhone: parts[jualIndex + 2] || null // NOMOR_HP (optional)
        };
    }

    // Parse check bill parameters
    parseCheckBillParams(text) {
        // Format: CEK TAGIHAN [NAMA_PELANGGAN]
        const parts = text.split(' ');
        const cekIndex = parts.findIndex(p => p.includes('cek'));
        
        if (cekIndex === -1 || parts.length < cekIndex + 3) {
            return null;
        }
        
        return {
            customerName: parts.slice(cekIndex + 2).join(' ') // NAMA_PELANGGAN
        };
    }

    // Parse pay bill parameters
    parsePayBillParams(text) {
        // Format: BAYAR TAGIHAN [NAMA_PELANGGAN]
        const parts = text.split(' ');
        const bayarIndex = parts.findIndex(p => p.includes('bayar'));
        
        if (bayarIndex === -1 || parts.length < bayarIndex + 3) {
            return null;
        }
        
        return {
            customerName: parts.slice(bayarIndex + 2).join(' ') // NAMA_PELANGGAN
        };
    }

    // Handle help command
    async handleHelp(from) {
        const helpText = `🤖 *COMMAND AGENT WHATSAPP*

📋 *Daftar Command:*

📋 *CEK TAGIHAN [NAMA_PELANGGAN]* - Cek tagihan pelanggan
💰 *BAYAR TAGIHAN [NAMA_PELANGGAN]* - Bayar tagihan pelanggan
📋 *LIST TAGIHAN* - Lihat semua pelanggan yang belum bayar
💰 *LIST BAYAR* - Lihat semua pelanggan yang sudah bayar
🛒 *BELI VOUCHER [PAKET]* - Beli voucher (hanya untuk agent)
🛒 *BELI VOUCHER [PAKET] [NOMOR_HP]* - Beli voucher dan kirim ke pelanggan
📱 *JUAL [PAKET]* - Jual voucher (tanpa kirim ke konsumen)
📱 *JUAL [PAKET] [NOMOR_HP]* - Jual voucher + kirim ke konsumen
💰 *BAYAR [NAMA] [HP] [JUMLAH] [YA/TIDAK]* - Terima pembayaran
📤 *REQUEST [JUMLAH] [CATATAN]* - Request saldo ke admin
📊 *RIWAYAT* - Lihat riwayat transaksi

• SALDO
• CEK TAGIHAN John Doe
• BAYAR TAGIHAN John Doe
• LIST TAGIHAN
• LIST BAYAR
• BELI VOUCHER 3K
• BELI VOUCHER 10K 081234567890
• JUAL 3K
• JUAL 10K 081234567890
• BAYAR Jane 081234567891 50000 YA
• REQUEST 100000 Top up saldo
• RIWAYAT

❓ Ketik *HELP* untuk melihat menu ini lagi.`;

        return this.sendMessage(from, helpText);
    }

    // Handle check balance
    async handleCheckBalance(from, agent) {
        try {
            const balance = await this.agentManager.getAgentBalance(agent.id);
            const message = `💰 *SALDO AGENT*

👤 Agent: ${agent.name}
📱 Phone: ${agent.phone}
💰 Saldo: Rp ${balance.toLocaleString('id-ID')}

📅 Terakhir update: ${new Date().toLocaleString('id-ID')}`;

            return this.sendMessage(from, message);
        } catch (error) {
            return this.sendMessage(from, "❌ Gagal mengambil data saldo.");
        }
    }

    // Handle sell voucher
    async handleSellVoucher(from, agent, params) {
        if (!params) {
            return this.sendMessage(from, "❌ Format salah. Gunakan: *JUAL [PAKET]* atau *JUAL [PAKET] [NOMOR_HP]*");
        }

        try {
            // Get available packages
            const packages = await this.agentManager.getAvailablePackages();
            const selectedPackage = packages.find(p => p.name.toLowerCase().includes(params.package.toLowerCase()));
            
            if (!selectedPackage) {
                return this.sendMessage(from, `❌ Paket tidak ditemukan. Paket tersedia: ${packages.map(p => p.name).join(', ')}`);
            }

            // Generate voucher code using package settings
            const voucherCode = this.agentManager.generateVoucherCode(selectedPackage);
            
            // Sell voucher
            const result = await this.agentManager.sellVoucher(
                agent.id,
                voucherCode,
                selectedPackage.id,
                params.customerName || 'Customer',
                params.customerPhone || ''
            );

            if (result.success) {
                let message = `🎉 *VOUCHER BERHASIL DIJUAL*

🎫 Kode Voucher: *${result.voucherCode}*
📦 Paket: ${result.packageName}
💰 Harga Jual: Rp ${result.customerPrice.toLocaleString('id-ID')}
💳 Harga Agent: Rp ${result.agentPrice.toLocaleString('id-ID')}
💵 Komisi: Rp ${result.commissionAmount.toLocaleString('id-ID')}

💰 Saldo tersisa: Rp ${result.newBalance.toLocaleString('id-ID')}`;

                // Send to customer if phone number provided
                if (params.customerPhone) {
                    // Prepare agent info for customer message
                    const agentInfo = {
                        name: agent.name,
                        phone: agent.phone
                    };
                    
                    await this.whatsappManager.sendVoucherToCustomer(
                        params.customerPhone,
                        params.customerName || 'Customer',
                        result.voucherCode,
                        result.packageName,
                        result.customerPrice,
                        agentInfo
                    );
                    message += `\n\n📱 Notifikasi telah dikirim ke pelanggan (${params.customerPhone}).`;
                } else {
                    message += `\n\nℹ️ Voucher siap diberikan ke pelanggan secara langsung.`;
                }

                return this.sendMessage(from, message);
            } else {
                return this.sendMessage(from, `❌ Gagal menjual voucher: ${result.message}`);
            }
        } catch (error) {
            return this.sendMessage(from, "❌ Terjadi kesalahan saat menjual voucher.");
        }
    }

    // Handle process payment
    async handleProcessPayment(from, agent, params) {
        if (!params) {
            return this.sendMessage(from, "❌ Format salah. Gunakan: *BAYAR [NAMA] [HP] [JUMLAH] [YA/TIDAK]*");
        }

        try {
            // Process payment
            const result = await this.agentManager.processPayment(
                agent.id,
                params.customerName,
                params.customerPhone,
                params.amount
            );

            if (result.success) {
                let message = `✅ *PEMBAYARAN BERHASIL DIPROSES*

👤 Pelanggan: ${params.customerName}
📱 Phone: ${params.customerPhone}
💰 Jumlah: Rp ${params.amount.toLocaleString('id-ID')}
👤 Agent: ${agent.name}
📅 Tanggal: ${new Date().toLocaleString('id-ID')}

💰 Saldo agent: Rp ${result.newBalance.toLocaleString('id-ID')}`;

                // Send to customer if requested
                if (params.sendWhatsApp) {
                    // Create customer object for sendPaymentNotification
                    const customer = {
                        name: params.customerName,
                        phone: params.customerPhone
                    };
                    
                    const paymentData = {
                        amount: params.amount,
                        method: 'WhatsApp',
                        commission: 0 // Commission info not available in this context
                    };
                    
                    await this.whatsappManager.sendPaymentNotification(agent, customer, paymentData);
                    message += `\n\n📱 Konfirmasi telah dikirim ke pelanggan.`;
                }

                return this.sendMessage(from, message);
            } else {
                return this.sendMessage(from, `❌ Gagal memproses pembayaran: ${result.message}`);
            }
        } catch (error) {
            return this.sendMessage(from, "❌ Terjadi kesalahan saat memproses pembayaran.");
        }
    }

    // Handle request balance
    async handleRequestBalance(from, agent, params) {
        if (!params) {
            return this.sendMessage(from, "❌ Format salah. Gunakan: *REQUEST [JUMLAH] [CATATAN]*");
        }

        try {
            const result = await this.agentManager.requestBalance(
                agent.id,
                params.amount,
                params.notes
            );

            if (result.success) {
                // Create notification in database with valid type
                await this.agentManager.createNotification(
                    agent.id,
                    'balance_updated',
                    'Request Saldo Dikirim',
                    `Request saldo sebesar Rp ${params.amount.toLocaleString()} telah dikirim ke admin`
                );
                
                // Send WhatsApp notification to admin
                try {
                    const settings = require('./settingsManager').getSettingsWithCache();
                    const adminPhone = settings.admin_phone || settings.contact_phone;
                    
                    if (adminPhone && this.whatsappManager.sock) {
                        const adminMessage = `🔔 **REQUEST SALDO AGENT**

👤 **Agent:** ${agent.name}
📱 **HP:** ${agent.phone}
💰 **Jumlah:** Rp ${params.amount.toLocaleString()}
📅 **Tanggal:** ${new Date().toLocaleString('id-ID')}

Silakan login ke admin panel untuk memproses request ini.`;
                        
                        const formattedAdminPhone = this.whatsappManager.formatPhoneNumber(adminPhone) + '@s.whatsapp.net';
                        await this.whatsappManager.sock.sendMessage(formattedAdminPhone, { text: adminMessage });
                    }
                } catch (whatsappError) {
                    console.error('WhatsApp admin notification error:', whatsappError);
                    // Don't fail the transaction if WhatsApp fails
                }

                const message = `📤 *REQUEST SALDO BERHASIL*

💰 Jumlah: Rp ${params.amount.toLocaleString('id-ID')}
📝 Catatan: ${params.notes}
📅 Tanggal: ${new Date().toLocaleString('id-ID')}

⏳ Menunggu persetujuan admin...`;

                // Notify admin
                message += `\n\n📢 Request saldo telah diajukan dan akan diproses oleh admin.`;

                return this.sendMessage(from, message);
            } else {
                return this.sendMessage(from, `❌ Gagal mengajukan request: ${result.message}`);
            }
        } catch (error) {
            return this.sendMessage(from, "❌ Terjadi kesalahan saat mengajukan request.");
        }
    }

    // Handle list tagihan (unpaid customers)
    async handleListTagihan(from, agent) {
        try {
            // Get all unpaid invoices
            const unpaidInvoices = await this.billingManager.getUnpaidInvoices();

            if (unpaidInvoices.length === 0) {
                return this.sendMessage(from, "✅ *LIST TAGIHAN*\n\n📝 Tidak ada pelanggan yang memiliki tagihan belum dibayar.");
            }

            let message = `📋 *LIST TAGIHAN BELUM DIBAYAR*\n\n`;
            message += `📊 Total pelanggan: ${unpaidInvoices.length}\n\n`;

            // Group by customer and show details
            const customerGroups = {};
            unpaidInvoices.forEach(invoice => {
                if (!customerGroups[invoice.customer_id]) {
                    customerGroups[invoice.customer_id] = {
                        customer: invoice.customer_name,
                        phone: invoice.customer_phone,
                        invoices: []
                    };
                }
                customerGroups[invoice.customer_id].invoices.push(invoice);
            });

            let customerIndex = 1;
            for (const customerId in customerGroups) {
                const group = customerGroups[customerId];
                message += `${customerIndex}. 👤 ${group.customer}\n`;
                if (group.phone) {
                    message += `   📱 ${group.phone}\n`;
                }

                group.invoices.forEach((invoice, idx) => {
                    const dueDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('id-ID') : 'N/A';
                    const daysOverdue = invoice.due_date ?
                        Math.floor((new Date() - new Date(invoice.due_date)) / (1000 * 60 * 60 * 24)) : 0;

                    message += `   ${idx + 1}. 💰 Rp ${invoice.amount.toLocaleString('id-ID')}\n`;
                    message += `      📅 Due: ${dueDate}`;
                    if (daysOverdue > 0) {
                        message += ` (${daysOverdue} hari telat)`;
                    }
                    message += `\n`;
                    message += `      🆔 ${invoice.invoice_number}\n`;
                });
                message += `\n`;
                customerIndex++;
            }

            // Split message if too long (WhatsApp limit)
            if (message.length > 4000) {
                const parts = this.splitMessage(message, 4000);
                for (const part of parts) {
                    await this.sendMessage(from, part);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between parts
                }
            } else {
                return this.sendMessage(from, message);
            }

        } catch (error) {
            console.error('Error in handleListTagihan:', error);
            return this.sendMessage(from, "❌ Gagal mengambil data tagihan. Silakan coba lagi.");
        }
    }

    // Handle list bayar (paid customers)
    async handleListBayar(from, agent) {
        try {
            // Get all paid invoices
            const paidInvoices = await this.billingManager.getPaidInvoices();

            if (paidInvoices.length === 0) {
                return this.sendMessage(from, "✅ *LIST PEMBAYARAN*\n\n📝 Tidak ada pelanggan yang sudah melakukan pembayaran.");
            }

            let message = `💰 *LIST PELANGGAN SUDAH BAYAR*\n\n`;
            message += `📊 Total pelanggan: ${paidInvoices.length}\n\n`;

            // Group by customer and show details
            const customerGroups = {};
            paidInvoices.forEach(invoice => {
                if (!customerGroups[invoice.customer_id]) {
                    customerGroups[invoice.customer_id] = {
                        customer: invoice.customer_name,
                        phone: invoice.customer_phone,
                        invoices: []
                    };
                }
                customerGroups[invoice.customer_id].invoices.push(invoice);
            });

            let customerIndex = 1;
            for (const customerId in customerGroups) {
                const group = customerGroups[customerId];
                message += `${customerIndex}. 👤 ${group.customer}\n`;
                if (group.phone) {
                    message += `   📱 ${group.phone}\n`;
                }

                group.invoices.forEach((invoice, idx) => {
                    const paymentDate = invoice.payment_date ?
                        new Date(invoice.payment_date).toLocaleDateString('id-ID') : 'N/A';

                    message += `   ${idx + 1}. 💰 Rp ${invoice.amount.toLocaleString('id-ID')}\n`;
                    message += `      💳 Dibayar: ${paymentDate}\n`;
                    message += `      🆔 ${invoice.invoice_number}\n`;
                    if (invoice.payment_method) {
                        message += `      💳 Via: ${invoice.payment_method}\n`;
                    }
                });
                message += `\n`;
                customerIndex++;
            }

            // Split message if too long (WhatsApp limit)
            if (message.length > 4000) {
                const parts = this.splitMessage(message, 4000);
                for (const part of parts) {
                    await this.sendMessage(from, part);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between parts
                }
            } else {
                return this.sendMessage(from, message);
            }

        } catch (error) {
            console.error('Error in handleListBayar:', error);
            return this.sendMessage(from, "❌ Gagal mengambil data pembayaran. Silakan coba lagi.");
        }
    }

    // Utility function to split long messages
    splitMessage(message, maxLength) {
        const parts = [];
        let currentPart = '';

        const lines = message.split('\n');

        for (const line of lines) {
            if ((currentPart + line + '\n').length <= maxLength) {
                currentPart += line + '\n';
            } else {
                if (currentPart) {
                    parts.push(currentPart.trim());
                    currentPart = line + '\n';
                }
            }
        }

        if (currentPart) {
            parts.push(currentPart.trim());
        }

        return parts;
    }

    // Handle transaction history
    async handleTransactionHistory(from, agent) {
        try {
            const transactions = await this.agentManager.getAgentTransactions(agent.id, 10);
            
            let message = `📊 *RIWAYAT TRANSAKSI TERAKHIR*

👤 Agent: ${agent.name}
📅 Periode: 10 transaksi terakhir

`;

            if (transactions.length === 0) {
                message += "📝 Belum ada transaksi.";
            } else {
                transactions.forEach((tx, index) => {
                    const date = new Date(tx.created_at).toLocaleDateString('id-ID');
                    const time = new Date(tx.created_at).toLocaleTimeString('id-ID');
                    const amount = tx.amount.toLocaleString('id-ID');
                    
                    message += `${index + 1}. ${tx.transaction_type.toUpperCase()}\n`;
                    message += `   💰 Rp ${amount}\n`;
                    message += `   📅 ${date} ${time}\n`;
                    if (tx.description) {
                        message += `   📝 ${tx.description}\n`;
                    }
                    message += `\n`;
                });
            }

            return this.sendMessage(from, message);
        } catch (error) {
            return this.sendMessage(from, "❌ Gagal mengambil riwayat transaksi.");
        }
    }

    // Send message via WhatsApp
    async sendMessage(to, message) {
        try {
            // Try to get socket from whatsapp module
            let sock = null;
            try {
                const whatsapp = require('./whatsapp');
                sock = whatsapp.getSock ? whatsapp.getSock() : null;
            } catch (e) {
                console.log('Could not get socket from whatsapp module');
            }
            
            if (sock && sock.sendMessage) {
                await sock.sendMessage(to, { text: message });
                console.log(`📤 [AGENT] Sent message to ${to}: ${message}`);
            } else {
                console.log(`📤 [AGENT] [MOCK] Would send to ${to}: ${message}`);
            }
            return null; // Don't return true, let agentWhatsAppIntegration handle the response
        } catch (error) {
            console.error('Error sending WhatsApp message:', error);
            return null;
        }
    }
    
    // Handle check bill
    async handleCheckBill(from, agent, params) {
        if (!params || !params.customerName) {
            return this.sendMessage(from, " Format salah. Gunakan: *CEK TAGIHAN [NAMA_PELANGGAN]*");
        }
        
        try {
            // Find customer by name or phone
            const customer = await this.billingManager.getCustomerByNameOrPhone(params.customerName);
            if (!customer) {
                return this.sendMessage(from, ` Pelanggan dengan nama "${params.customerName}" tidak ditemukan.`);
            }
            
            // Get customer bills and filter unpaid ones
            const allBills = await this.billingManager.getInvoicesByCustomer(customer.id);
            const bills = allBills.filter(bill => bill.status === 'unpaid');
            if (bills.length === 0) {
                return this.sendMessage(from, ` Pelanggan "${params.customerName}" tidak memiliki tagihan yang belum dibayar.`);
            }
            
            let message = `📋 *TAGIHAN PELANGGAN: ${params.customerName}*

`;
            bills.forEach((bill, index) => {
                const status = bill.status === 'unpaid' ? 'Belum Dibayar' : 'Sudah Dibayar';
                message += `${index + 1}. Jumlah: Rp ${bill.amount.toLocaleString('id-ID')} - Status: ${status}\n`;
                if (bill.due_date) {
                    message += `   Jatuh Tempo: ${new Date(bill.due_date).toLocaleDateString('id-ID')}\n`;
                }
                message += '\n';
            });
            
            return this.sendMessage(from, message);
        } catch (error) {
            return this.sendMessage(from, " Gagal mengambil data tagihan.");
        }
    }
    
    // Handle pay bill
    async handlePayBill(from, agent, params) {
        if (!params || !params.customerName) {
            return this.sendMessage(from, " Format salah. Gunakan: *BAYAR TAGIHAN [NAMA_PELANGGAN]*");
        }
        
        try {
            // Find customer by name or phone
            const customer = await this.billingManager.getCustomerByNameOrPhone(params.customerName);
            if (!customer) {
                return this.sendMessage(from, ` Pelanggan dengan nama "${params.customerName}" tidak ditemukan.`);
            }
            
            // Get all invoices and filter unpaid ones
            const allInvoices = await this.billingManager.getInvoicesByCustomer(customer.id);
            const unpaidInvoices = allInvoices.filter(invoice => invoice.status === 'unpaid');
            if (unpaidInvoices.length === 0) {
                return this.sendMessage(from, ` Pelanggan "${params.customerName}" tidak memiliki tagihan yang belum dibayar.`);
            }
            
            // Process payment for the first unpaid invoice
            const invoice = unpaidInvoices[0];
            console.log('[AGENT][DEBUG] invoice:', invoice);
            const result = await this.billingManager.recordPayment({
                invoice_id: invoice.id,
                amount: invoice.base_amount, // potong saldo agent sesuai harga agent
                payment_method: 'agent_payment',
                reference_number: agent.id,
                notes: ''
            });
            
            if (result.success) {
                // Update status invoice menjadi paid
                await this.billingManager.updateInvoiceStatus(invoice.id, 'paid', 'agent_payment');
                // Potong saldo agent dan catat transaksi
                await this.agentManager.updateAgentBalance(
                    agent.id,
                    -invoice.base_amount, // potong saldo agent
                    'monthly_payment',
                    `Pembayaran tagihan pelanggan ${params.customerName}`,
                    invoice.id
                );
                // Ambil saldo akhir agent
                const saldoAkhir = await this.agentManager.getAgentBalance(agent.id);
                const komisi = invoice.amount - invoice.base_amount;
                let message = `✅ *PEMBAYARAN TAGIHAN BERHASIL*

👤 Pelanggan: ${params.customerName}
💰 Jumlah dibayar pelanggan: Rp ${invoice.amount.toLocaleString('id-ID')}
💵 Saldo agent terpotong: Rp ${invoice.base_amount.toLocaleString('id-ID')}
🎁 Komisi: Rp ${komisi.toLocaleString('id-ID')}
📅 Tanggal: ${new Date().toLocaleString('id-ID')}
`;
                // Send confirmation to customer if phone is available
                if (customer.phone) {
                    await this.sendMessage(customer.phone, `✅ Pembayaran tagihan atas nama ${customer.name} sebesar Rp ${invoice.amount.toLocaleString('id-ID')} telah berhasil!`);
                    message += `📱 Konfirmasi telah dikirim ke pelanggan.`;
                }
                // Tambahkan saldo akhir ke pesan
                message += `\n💰 Saldo akhir: Rp ${saldoAkhir.toLocaleString('id-ID')}`;
                
                return this.sendMessage(from, message);
            } else {
                return this.sendMessage(from, ` Gagal memproses pembayaran: ${result.message}`);
            }
        } catch (error) {
            console.error('[AGENT][ERROR] handlePayBill:', error);
            return this.sendMessage(from, " Terjadi kesalahan saat memproses pembayaran.");
        }
    }
    
    // Handle buy voucher
    async handleBuyVoucher(from, agent, params) {
        if (!params || !params.package) {
            return this.sendMessage(from, " Format salah. Gunakan: *BELI VOUCHER [PAKET]* atau *BELI VOUCHER [PAKET] [NOMOR_PELANGGAN]*");
        }
        
        try {
            // Get agent balance and available packages
            const balance = await this.agentManager.getAgentBalance(agent.id);
            const packages = await this.agentManager.getAvailablePackages();
            const selectedPackage = packages.find(p => p.name.toLowerCase().includes(params.package.toLowerCase()));
            
            if (!selectedPackage) {
                return this.sendMessage(from, ` Paket "${params.package}" tidak ditemukan. Paket tersedia: ${packages.map(p => p.name).join(', ')}`);
            }
            
            const price = selectedPackage.price; // Use dynamic price from database
            if (balance < price) {
                return this.sendMessage(from, ` Saldo tidak mencukupi. Saldo: Rp ${balance.toLocaleString('id-ID')}, Dibutuhkan: Rp ${price.toLocaleString('id-ID')}`);
            }
            
            // Generate voucher code using package settings
            const voucherCode = this.agentManager.generateVoucherCode(selectedPackage);
            
            // Sell voucher using the same method as web agent
            const result = await this.agentManager.sellVoucher(
                agent.id,
                voucherCode,
                selectedPackage.id,
                params.customerPhone || 'Customer',
                params.customerPhone || ''
            );

            if (result.success) {
                let message = `🎉 *VOUCHER BERHASIL DIBELI*

🎫 Kode Voucher: *${result.voucherCode}*
📦 Paket: ${result.packageName}
💰 Harga Jual: Rp ${result.customerPrice.toLocaleString('id-ID')}
💳 Harga Agent: Rp ${result.agentPrice.toLocaleString('id-ID')}
💵 Komisi: Rp ${result.commissionAmount.toLocaleString('id-ID')}

💰 Saldo tersisa: Rp ${result.newBalance.toLocaleString('id-ID')}`;

                // Send to customer if phone number provided
                if (params.customerPhone) {
                    // Prepare agent info for customer message
                    const agentInfo = {
                        name: agent.name,
                        phone: agent.phone
                    };
                    
                    await this.whatsappManager.sendVoucherToCustomer(
                        params.customerPhone,
                        params.customerName || 'Customer',
                        result.voucherCode,
                        result.packageName,
                        result.customerPrice,
                        agentInfo
                    );
                    message += `\n\n📱 Notifikasi telah dikirim ke pelanggan (${params.customerPhone}).`;
                } else {
                    message += `\n\nℹ️ Voucher siap diberikan ke pelanggan secara langsung.`;
                }

                return this.sendMessage(from, message);
            } else {
                return this.sendMessage(from, `❌ Gagal menjual voucher: ${result.message}`);
            }
        } catch (error) {
            return this.sendMessage(from, "❌ Terjadi kesalahan saat membeli voucher. Silakan coba lagi.");
        }
    }
}

module.exports = AgentWhatsAppCommands;