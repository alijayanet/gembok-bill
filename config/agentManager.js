const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { getSettingsWithCache } = require('./settingsManager');
const logger = require('./logger');

class AgentManager {
    constructor() {
        this.dbPath = './data/billing.db';  // Menggunakan database yang sama dengan sistem utama
        this.db = new sqlite3.Database(this.dbPath);
        this.createTables();
    }

    createTables() {
        const tables = [
            // Tabel Agent
            `CREATE TABLE IF NOT EXISTS agents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                phone TEXT UNIQUE NOT NULL,
                email TEXT,
                password TEXT NOT NULL,
                address TEXT,
                status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
                commission_rate DECIMAL(5,2) DEFAULT 5.00,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabel Saldo Agent
            `CREATE TABLE IF NOT EXISTS agent_balances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id INTEGER NOT NULL,
                balance DECIMAL(15,2) DEFAULT 0.00,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
            )`,

            // Tabel Transaksi Agent
            `CREATE TABLE IF NOT EXISTS agent_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id INTEGER NOT NULL,
                transaction_type TEXT NOT NULL CHECK (transaction_type IN ('deposit', 'withdrawal', 'voucher_sale', 'monthly_payment', 'commission', 'balance_request')),
                amount DECIMAL(15,2) NOT NULL,
                description TEXT,
                reference_id TEXT,
                status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
            )`,

            // Tabel Penjualan Voucher Agent
            `CREATE TABLE IF NOT EXISTS agent_voucher_sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id INTEGER NOT NULL,
                voucher_code TEXT UNIQUE NOT NULL,
                package_id TEXT NOT NULL,
                package_name TEXT NOT NULL,
                customer_phone TEXT,
                customer_name TEXT,
                price DECIMAL(10,2) NOT NULL,
                commission DECIMAL(10,2) DEFAULT 0.00,
                status TEXT DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired', 'cancelled')),
                sold_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                used_at DATETIME,
                notes TEXT,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
            )`,

            // Tabel Request Saldo Agent
            `CREATE TABLE IF NOT EXISTS agent_balance_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id INTEGER NOT NULL,
                amount DECIMAL(15,2) NOT NULL,
                status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
                admin_notes TEXT,
                requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                processed_at DATETIME,
                processed_by INTEGER,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
            )`,

            // Tabel Pembayaran Bulanan oleh Agent
            `CREATE TABLE IF NOT EXISTS agent_monthly_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id INTEGER NOT NULL,
                customer_id INTEGER NOT NULL,
                invoice_id INTEGER NOT NULL,
                payment_amount DECIMAL(15,2) NOT NULL,
                commission_amount DECIMAL(15,2) DEFAULT 0.00,
                payment_method TEXT DEFAULT 'cash',
                notes TEXT,
                status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
                paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
            )`,

            // Tabel Notifikasi Agent
            `CREATE TABLE IF NOT EXISTS agent_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id INTEGER NOT NULL,
                notification_type TEXT NOT NULL CHECK (notification_type IN ('voucher_sold', 'payment_received', 'balance_updated', 'request_approved', 'request_rejected', 'registration_success', 'registration_approved', 'registration_rejected')),
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
            )`,
            // Tabel Notifikasi Admin
            `CREATE TABLE IF NOT EXISTS admin_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT,
                title TEXT,
                message TEXT,
                agent_id INTEGER,
                status TEXT DEFAULT 'unread',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        tables.forEach(table => {
            this.db.run(table, (err) => {
                if (err) {
                    logger.error('Error creating agent table:', err);
                }
            });
        });

        // Create indexes
        this.createIndexes();
    }

    createIndexes() {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_agents_username ON agents(username)',
            'CREATE INDEX IF NOT EXISTS idx_agents_phone ON agents(phone)',
            'CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)',
            'CREATE INDEX IF NOT EXISTS idx_agent_balances_agent_id ON agent_balances(agent_id)',
            'CREATE INDEX IF NOT EXISTS idx_agent_transactions_agent_id ON agent_transactions(agent_id)',
            'CREATE INDEX IF NOT EXISTS idx_agent_transactions_type ON agent_transactions(transaction_type)',
            'CREATE INDEX IF NOT EXISTS idx_agent_transactions_created_at ON agent_transactions(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_agent_voucher_sales_agent_id ON agent_voucher_sales(agent_id)',
            'CREATE INDEX IF NOT EXISTS idx_agent_voucher_sales_code ON agent_voucher_sales(voucher_code)',
            'CREATE INDEX IF NOT EXISTS idx_agent_voucher_sales_status ON agent_voucher_sales(status)',
            'CREATE INDEX IF NOT EXISTS idx_agent_balance_requests_agent_id ON agent_balance_requests(agent_id)',
            'CREATE INDEX IF NOT EXISTS idx_agent_balance_requests_status ON agent_balance_requests(status)',
            'CREATE INDEX IF NOT EXISTS idx_agent_monthly_payments_agent_id ON agent_monthly_payments(agent_id)',
            'CREATE INDEX IF NOT EXISTS idx_agent_notifications_agent_id ON agent_notifications(agent_id)',
            'CREATE INDEX IF NOT EXISTS idx_agent_notifications_is_read ON agent_notifications(is_read)'
        ];

        indexes.forEach(index => {
            this.db.run(index, (err) => {
                if (err) {
                    logger.error('Error creating agent index:', err);
                }
            });
        });
    }

    // ===== AUTHENTICATION METHODS =====

    async authenticateAgent(username, password) {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM agents WHERE (username = ? OR phone = ?) AND status = "active"';
            this.db.get(sql, [username, username], async (err, agent) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (!agent) {
                    resolve({ success: false, message: 'Agent tidak ditemukan atau tidak aktif' });
                    return;
                }

                try {
                    const isValid = await bcrypt.compare(password, agent.password);
                    if (isValid) {
                        delete agent.password; // Remove password from response
                        resolve({ success: true, agent });
                    } else {
                        resolve({ success: false, message: 'Password salah' });
                    }
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    async createAgent(agentData) {
        return new Promise(async (resolve, reject) => {
            try {
                const hashedPassword = await bcrypt.hash(agentData.password, 10);
                const sql = `INSERT INTO agents (username, name, phone, email, password, address, commission_rate, status) 
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
                const db = this.db;
                db.run(sql, [
                    agentData.username,
                    agentData.name,
                    agentData.phone,
                    agentData.email || null,
                    hashedPassword,
                    agentData.address || null,
                    agentData.commission_rate || 5.00,
                    agentData.status || 'active' // default active
                ], function(err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    const agentId = this.lastID;
                    const balanceSql = 'INSERT INTO agent_balances (agent_id, balance) VALUES (?, 0.00)';
                    db.run(balanceSql, [agentId], (err) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve({ success: true, agentId });
                    });
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // ===== BALANCE METHODS =====

    async getAgentBalance(agentId) {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT balance FROM agent_balances WHERE agent_id = ?';
            this.db.get(sql, [agentId], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row ? row.balance : 0.00);
            });
        });
    }

    async updateAgentBalance(agentId, amount, transactionType, description, referenceId = null) {
        return new Promise((resolve, reject) => {
            const db = this.db;
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                // Update balance
                const updateBalanceSql = `
                    UPDATE agent_balances 
                    SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP 
                    WHERE agent_id = ?
                `;
                
                db.run(updateBalanceSql, [amount, agentId], (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        reject(err);
                        return;
                    }

                    // Insert transaction record
                    const insertTransactionSql = `
                        INSERT INTO agent_transactions (agent_id, transaction_type, amount, description, reference_id)
                        VALUES (?, ?, ?, ?, ?)
                    `;
                    
                    db.run(insertTransactionSql, [agentId, transactionType, amount, description, referenceId], (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        db.run('COMMIT', (err) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            resolve({ success: true, transactionId: this.lastID });
                        });
                    });
                });
            });
        });
    }

    // ===== VOUCHER SALES METHODS =====

    async sellVoucher(agentId, voucherCode, packageId, customerName, customerPhone) {
        try {
            // Get package data from voucher_pricing table
            const packageData = await this.getPackageById(packageId);
            if (!packageData) {
                return { success: false, message: 'Paket tidak ditemukan' };
            }

            // Check agent balance
            const currentBalance = await this.getAgentBalance(agentId);
            if (currentBalance < packageData.agentPrice) {
                return { 
                    success: false, 
                    message: `Saldo tidak cukup. Dibutuhkan: Rp ${packageData.agentPrice.toLocaleString()}, Tersedia: Rp ${currentBalance.toLocaleString()}` 
                };
            }

            const db = this.db; // Store database reference
            const self = this; // Store this reference for callbacks
            
            // Generate password for Mikrotik (same as voucher code for simplicity)
            const voucherPassword = voucherCode;
            
            return new Promise((resolve, reject) => {
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');

                    // Insert voucher sale dengan kolom lengkap
                    const insertVoucherSql = `
                        INSERT INTO agent_voucher_sales 
                        (agent_id, voucher_code, package_id, package_name, customer_phone, customer_name, 
                         price, commission, agent_price, commission_amount)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    
                    db.run(insertVoucherSql, [
                        agentId,
                        voucherCode,
                        packageData.id,
                        packageData.name,
                        customerPhone || null,
                        customerName || null,
                        packageData.customerPrice, // price = customer_price
                        packageData.commissionAmount, // commission = commission_amount
                        packageData.agentPrice, // agent_price
                        packageData.commissionAmount // commission_amount
                    ], function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        // Update agent balance (deduct agent price)
                        const updateBalanceSql = `
                            UPDATE agent_balances 
                            SET balance = balance - ?, last_updated = CURRENT_TIMESTAMP 
                            WHERE agent_id = ?
                        `;
                        
                        db.run(updateBalanceSql, [packageData.agentPrice, agentId], function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                reject(err);
                                return;
                            }

                            // Record transaction (hanya transaksi penjualan)
                            const insertTransactionSql = `
                                INSERT INTO agent_transactions (agent_id, transaction_type, amount, description, reference_id)
                                VALUES (?, 'voucher_sale', ?, ?, ?)
                            `;
                            
                            db.run(insertTransactionSql, [
                                agentId,
                                -packageData.agentPrice,
                                `Penjualan voucher ${packageData.name} (Customer: Rp ${packageData.customerPrice.toLocaleString()})`,
                                voucherCode
                            ], function(err) {
                                if (err) {
                                    db.run('ROLLBACK');
                                    reject(err);
                                    return;
                                }

                                db.run('COMMIT', async (err) => {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }
                                    
                                    // Add voucher to Mikrotik after successful database commit
                                    try {
                                        const { addHotspotUser } = require('./mikrotik');
                                        
                                        // Get agent information for Mikrotik comment
                                        const agent = await self.getAgentById(agentId);
                                        
                                        // Get hotspot profile from package data
                                        const hotspotProfile = packageData.hotspotProfile || 'default';
                                        
                                        // Determine username and password based on account type
                                        let mikrotikUsername, mikrotikPassword;
                                        const accountType = packageData.accountType || 'voucher';
                                        
                                        if (accountType === 'member') {
                                            // For MEMBER: username and password are different
                                            mikrotikUsername = `M${voucherCode}`;
                                            mikrotikPassword = voucherPassword;
                                        } else {
                                            // For VOUCHER: username and password are the same
                                            mikrotikUsername = voucherCode;
                                            mikrotikPassword = voucherCode;
                                        }
                                        
                                        // Create comment with agent information (optimized for Mikrotik)
                                        const agentComment = agent ? self.createAgentComment(agent.name, agent.phone, packageData.name) : `Voucher ${packageData.name}`;
                                        
                                        console.log(`🔧 Attempting to add user to Mikrotik: ${mikrotikUsername}/${mikrotikPassword} with profile ${hotspotProfile}`);
                                        console.log(`📝 Comment: ${agentComment}`);
                                        
                                        // Add user to Mikrotik hotspot
                                        const mikrotikResult = await addHotspotUser(
                                            mikrotikUsername, // username
                                            mikrotikPassword, // password
                                            hotspotProfile,   // profile
                                            agentComment      // comment
                                        );
                                        
                                        if (mikrotikResult.success) {
                                            console.log(`✅ Voucher ${voucherCode} berhasil ditambahkan ke Mikrotik dengan profile ${hotspotProfile}`);
                                            
                                            // Get new balance after transaction
                                            const newBalance = await self.getAgentBalance(agentId);
                                            
                                            resolve({ 
                                                success: true, 
                                                voucherCode,
                                                packageName: packageData.name,
                                                customerPrice: packageData.customerPrice,
                                                agentPrice: packageData.agentPrice,
                                                commissionAmount: packageData.commissionAmount,
                                                newBalance: newBalance,
                                                mikrotikUsername,
                                                mikrotikPassword,
                                                accountType,
                                                saleId: this.lastID,
                                                mikrotikAdded: true
                                            });
                                        } else {
                                            console.error(`❌ Gagal menambahkan voucher ${voucherCode} ke Mikrotik:`, mikrotikResult.message);
                                            
                                            // Even if Mikrotik fails, the database transaction is already committed
                                            // Log the error but don't fail the whole process
                                            const newBalance = await self.getAgentBalance(agentId);
                                            resolve({ 
                                                success: true, 
                                                voucherCode,
                                                packageName: packageData.name,
                                                customerPrice: packageData.customerPrice,
                                                agentPrice: packageData.agentPrice,
                                                commissionAmount: packageData.commissionAmount,
                                                newBalance: newBalance,
                                                saleId: this.lastID,
                                                mikrotikAdded: false,
                                                mikrotikError: mikrotikResult.message
                                            });
                                        }
                                    } catch (mikrotikError) {
                                        console.error('❌ Error saat menambahkan voucher ke Mikrotik:', mikrotikError.message);
                                        
                                        // Even if Mikrotik fails, the database transaction is already committed
                                        const newBalance = await self.getAgentBalance(agentId);
                                        resolve({ 
                                            success: true, 
                                            voucherCode,
                                            packageName: packageData.name,
                                            customerPrice: packageData.customerPrice,
                                            agentPrice: packageData.agentPrice,
                                            commissionAmount: packageData.commissionAmount,
                                            newBalance: newBalance,
                                            saleId: this.lastID,
                                            mikrotikAdded: false,
                                            mikrotikError: mikrotikError.message
                                        });
                                    }
                                });
                            });
                        });
                    });
                });
            });
        } catch (error) {
            console.error('Error in sellVoucher:', error);
            return { success: false, message: error.message };
        }
    }

    generateVoucherCode(packageData = null) {
        let digitType = 'mixed';
        let length = 8;
        let accountType = 'voucher';
        
        // Use package settings if available
        if (packageData) {
            digitType = packageData.voucherDigitType || 'mixed';
            length = packageData.voucherLength || 8;
            accountType = packageData.accountType || 'voucher';
        }
        
        // Define character sets
        let chars = '';
        switch (digitType) {
            case 'numbers':
                chars = '0123456789';
                break;
            case 'letters':
                chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                break;
            case 'mixed':
            default:
                chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                break;
        }
        
        // Generate random voucher code
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        // Add prefix based on account type
        if (accountType === 'member') {
            return `M${result}`;
        } else {
            return `V${result}`;
        }
    }

    // Helper function to create optimized agent comment for Mikrotik
    createAgentComment(agentName, agentPhone, packageName) {
        const maxLength = 150; // Conservative limit for Mikrotik
        
        // Clean and optimize agent name
        let optimizedName = agentName.trim();
        if (optimizedName.length > 25) {
            optimizedName = optimizedName.substring(0, 22) + '...';
        }
        
        // Clean phone number (remove non-numeric characters and take last 12 digits)
        const cleanPhone = agentPhone.replace(/[^0-9]/g, '').slice(-12);
        
        // Clean and optimize package name
        let optimizedPackage = packageName.trim();
        if (optimizedPackage.length > 20) {
            optimizedPackage = optimizedPackage.substring(0, 17) + '...';
        }
        
        // Create comment
        let comment = `vc Agent: ${optimizedName} (${cleanPhone}) - ${optimizedPackage}`;
        
        // If still too long, use abbreviated format
        if (comment.length > maxLength) {
            comment = `vc Agt: ${optimizedName.substring(0, 15)} (${cleanPhone}) - ${optimizedPackage.substring(0, 15)}`;
        }
        
        return comment;
    }

    // ===== MONTHLY PAYMENT METHODS =====

    async processMonthlyPayment(agentId, customerId, invoiceId, paymentAmount, paymentMethod = 'cash') {
        return new Promise((resolve, reject) => {
            const db = this.db; // Simpan referensi database
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                // Get agent commission rate and current balance
                const getAgentSql = `
                    SELECT a.commission_rate, ab.balance 
                    FROM agents a 
                    LEFT JOIN agent_balances ab ON a.id = ab.agent_id 
                    WHERE a.id = ?
                `;
                db.get(getAgentSql, [agentId], (err, agent) => {
                    if (err) {
                        db.run('ROLLBACK');
                        reject(err);
                        return;
                    }

                    if (!agent) {
                        db.run('ROLLBACK');
                        reject(new Error('Agent tidak ditemukan'));
                        return;
                    }

                    const currentBalance = agent.balance || 0;
                    const commission = (paymentAmount * agent.commission_rate / 100);

                    // Cek apakah saldo cukup (harus cukup untuk full amount)
                    if (currentBalance < paymentAmount) {
                        db.run('ROLLBACK');
                        resolve({ 
                            success: false, 
                            message: `Saldo tidak cukup. Saldo tersedia: Rp ${currentBalance.toLocaleString()}, Dibutuhkan: Rp ${paymentAmount.toLocaleString()}` 
                        });
                        return;
                    }

                    // Insert monthly payment record
                    const insertPaymentSql = `
                        INSERT INTO agent_monthly_payments 
                        (agent_id, customer_id, invoice_id, payment_amount, commission_amount, payment_method)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `;
                    
                    db.run(insertPaymentSql, [
                        agentId, customerId, invoiceId, paymentAmount, commission, paymentMethod
                    ], function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        // Tandai invoice sebagai LUNAS terlebih dahulu
                        const markInvoicePaidSql = `
                            UPDATE invoices
                            SET status = 'paid'
                            WHERE id = ? AND customer_id = ?
                        `;

                        db.run(markInvoicePaidSql, [invoiceId, customerId], (err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                reject(err);
                                return;
                            }

                            // Update agent balance: potong full amount + tambah komisi
                            const updateBalanceSql = `
                                UPDATE agent_balances 
                                SET balance = balance - ? + ?, last_updated = CURRENT_TIMESTAMP 
                                WHERE agent_id = ?
                            `;
                            
                            db.run(updateBalanceSql, [paymentAmount, commission, agentId], (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    reject(err);
                                    return;
                                }

                                // Record transaction untuk pemotongan saldo
                                const insertDeductionSql = `
                                    INSERT INTO agent_transactions (agent_id, transaction_type, amount, description, reference_id)
                                    VALUES (?, 'monthly_payment', ?, ?, ?)
                                `;
                                
                                db.run(insertDeductionSql, [
                                    agentId,
                                    -paymentAmount, // Negative amount untuk pemotongan full amount
                                    `Pembayaran pelanggan (ID: ${customerId})`,
                                    invoiceId.toString()
                                ], (err) => {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        reject(err);
                                        return;
                                    }

                                    // Record transaction untuk komisi
                                    const insertCommissionSql = `
                                        INSERT INTO agent_transactions (agent_id, transaction_type, amount, description, reference_id)
                                        VALUES (?, 'commission', ?, ?, ?)
                                    `;
                                    
                                    db.run(insertCommissionSql, [
                                        agentId,
                                        commission,
                                        `Komisi pembayaran (${agent.commission_rate}%)`,
                                        invoiceId.toString()
                                    ], (err) => {
                                        if (err) {
                                            db.run('ROLLBACK');
                                            reject(err);
                                            return;
                                        }

                                        db.run('COMMIT', (err) => {
                                            if (err) {
                                                reject(err);
                                                return;
                                            }
                                            resolve({ 
                                                success: true, 
                                                commission,
                                                paymentAmount,
                                                newBalance: currentBalance - paymentAmount + commission,
                                                paymentId: this.lastID
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    }

    // ===== PARTIAL PAYMENT METHODS =====

    async processPartialPayment(agentId, customerId, paymentAmount, paymentMethod = 'cash') {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');

                // Get agent commission rate and current balance
                const getAgentSql = `
                    SELECT a.commission_rate, ab.balance 
                    FROM agents a 
                    LEFT JOIN agent_balances ab ON a.id = ab.agent_id 
                    WHERE a.id = ?
                `;
                this.db.get(getAgentSql, [agentId], (err, agent) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        reject(err);
                        return;
                    }

                    if (!agent) {
                        this.db.run('ROLLBACK');
                        reject(new Error('Agent tidak ditemukan'));
                        return;
                    }

                    const currentBalance = agent.balance || 0;
                    const commission = (paymentAmount * agent.commission_rate / 100);

                    // Cek apakah saldo cukup
                    if (currentBalance < paymentAmount) {
                        this.db.run('ROLLBACK');
                        resolve({ 
                            success: false, 
                            message: `Saldo tidak cukup. Saldo tersedia: Rp ${currentBalance.toLocaleString()}, Dibutuhkan: Rp ${paymentAmount.toLocaleString()}` 
                        });
                        return;
                    }

                    // Get unpaid invoices for this customer (oldest first)
                    const getInvoicesSql = `
                        SELECT id, amount, due_date 
                        FROM invoices 
                        WHERE customer_id = ? AND status = 'unpaid'
                        ORDER BY due_date ASC, id ASC
                    `;
                    
                    this.db.all(getInvoicesSql, [customerId], (err, invoices) => {
                        if (err) {
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        if (!invoices || invoices.length === 0) {
                            this.db.run('ROLLBACK');
                            resolve({ 
                                success: false, 
                                message: 'Tidak ada tagihan unpaid untuk pelanggan ini' 
                            });
                            return;
                        }

                        // Auto allocate payment to invoices
                        let remaining = paymentAmount;
                        const paidInvoices = [];
                        let totalCommission = 0;

                        for (const invoice of invoices) {
                            if (remaining <= 0) break;
                            
                            const invoiceAmount = parseFloat(invoice.amount);
                            if (remaining >= invoiceAmount) {
                                // Pay full invoice
                                paidInvoices.push({
                                    id: invoice.id,
                                    amount: invoiceAmount,
                                    status: 'paid'
                                });
                                totalCommission += (invoiceAmount * agent.commission_rate / 100);
                                remaining -= invoiceAmount;
                            } else {
                                // Partial payment - not supported for now
                                break;
                            }
                        }

                        if (paidInvoices.length === 0) {
                            this.db.run('ROLLBACK');
                            resolve({ 
                                success: false, 
                                message: 'Tidak ada tagihan yang bisa dibayar dengan jumlah ini' 
                            });
                            return;
                        }

                        // Update invoices to paid
                        const updateInvoiceSql = 'UPDATE invoices SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?';
                        let updateCount = 0;
                        
                        const updateNextInvoice = () => {
                            if (updateCount >= paidInvoices.length) {
                                // All invoices updated, now update agent balance
                                const updateBalanceSql = `
                                    UPDATE agent_balances 
                                    SET balance = balance - ? + ?, last_updated = CURRENT_TIMESTAMP 
                                    WHERE agent_id = ?
                                `;
                                
                                this.db.run(updateBalanceSql, [paymentAmount, totalCommission, agentId], (err) => {
                                    if (err) {
                                        this.db.run('ROLLBACK');
                                        reject(err);
                                        return;
                                    }

                                    // Record transactions
                                    const insertTransactionSql = `
                                        INSERT INTO agent_transactions (agent_id, transaction_type, amount, description, reference_id)
                                        VALUES (?, ?, ?, ?, ?)
                                    `;
                                    
                                    // Record payment deduction
                                    this.db.run(insertTransactionSql, [
                                        agentId,
                                        'monthly_payment',
                                        -paymentAmount,
                                        `Pembayaran parsial pelanggan (ID: ${customerId})`,
                                        paidInvoices.map(inv => inv.id).join(',')
                                    ], function(err) {
                                        if (err) {
                                            this.db.run('ROLLBACK');
                                            reject(err);
                                            return;
                                        }

                                        // Record commission
                                        this.db.run(insertTransactionSql, [
                                            agentId,
                                            'commission',
                                            totalCommission,
                                            `Komisi pembayaran parsial (${agent.commission_rate}%)`,
                                            paidInvoices.map(inv => inv.id).join(',')
                                        ], function(err) {
                                            if (err) {
                                                this.db.run('ROLLBACK');
                                                reject(err);
                                                return;
                                            }

                                            this.db.run('COMMIT', (err) => {
                                                if (err) {
                                                    reject(err);
                                                    return;
                                                }
                                                resolve({ 
                                                    success: true, 
                                                    commission: totalCommission,
                                                    paymentAmount,
                                                    paidInvoices,
                                                    newBalance: currentBalance - paymentAmount + totalCommission
                                                });
                                            });
                                        });
                                    });
                                });
                                return;
                            }

                            const invoice = paidInvoices[updateCount];
                            db.run(updateInvoiceSql, ['paid', invoice.id], (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    reject(err);
                                    return;
                                }
                                updateCount++;
                                updateNextInvoice();
                            });
                        };

                        updateNextInvoice();
                    });
                });
            });
        });
    }

    // ===== BALANCE REQUEST METHODS =====

    async requestBalance(agentId, amount) {
        // Handle optional notes parameter
        const notes = arguments.length > 2 ? arguments[2] : null;
        
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO agent_balance_requests (agent_id, amount, admin_notes)
                VALUES (?, ?, ?)
            `;
            
            this.db.run(sql, [agentId, amount, notes], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ success: true, requestId: this.lastID });
            });
        });
    }

    async getBalanceRequests(status = null) {
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT abr.*, a.name as agent_name, a.phone as agent_phone
                FROM agent_balance_requests abr
                JOIN agents a ON abr.agent_id = a.id
            `;
            
            const params = [];
            if (status) {
                sql += ' WHERE abr.status = ?';
                params.push(status);
            }
            
            sql += ' ORDER BY abr.requested_at DESC';
            
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows);
            });
        });
    }

    async approveBalanceRequest(requestId, adminId, notes = null) {
        return new Promise((resolve, reject) => {
            const self = this; // Simpan referensi ke this
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');

                // Get request details
                const getRequestSql = 'SELECT * FROM agent_balance_requests WHERE id = ?';
                this.db.get(getRequestSql, [requestId], function(err, request) {
                    if (err) {
                        self.db.run('ROLLBACK');
                        reject(err);
                        return;
                    }

                    if (!request) {
                        self.db.run('ROLLBACK');
                        reject(new Error('Request tidak ditemukan'));
                        return;
                    }

                    // Update request status
                    const updateRequestSql = `
                        UPDATE agent_balance_requests 
                        SET status = 'approved', processed_at = CURRENT_TIMESTAMP, processed_by = ?, admin_notes = ?
                        WHERE id = ?
                    `;
                    
                    self.db.run(updateRequestSql, [adminId, notes, requestId], function(err) {
                        if (err) {
                            self.db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        // Update agent balance
                        const updateBalanceSql = `
                            UPDATE agent_balances 
                            SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP 
                            WHERE agent_id = ?
                        `;
                        
                        self.db.run(updateBalanceSql, [request.amount, request.agent_id], function(err) {
                            if (err) {
                                self.db.run('ROLLBACK');
                                reject(err);
                                return;
                            }

                            // Record transaction
                            const insertTransactionSql = `
                                INSERT INTO agent_transactions (agent_id, transaction_type, amount, description, reference_id)
                                VALUES (?, 'deposit', ?, ?, ?)
                            `;
                            
                            self.db.run(insertTransactionSql, [
                                request.agent_id,
                                request.amount,
                                `Deposit saldo disetujui admin`,
                                requestId.toString()
                            ], function(err) {
                                if (err) {
                                    self.db.run('ROLLBACK');
                                    reject(err);
                                    return;
                                }

                                self.db.run('COMMIT', (err) => {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }
                                    resolve({ success: true });
                                });
                            });
                        });
                    });
                });
            });
        });
    }

    // ===== NOTIFICATION METHODS =====

    async createNotification(agentId, type, title, message) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO agent_notifications (agent_id, notification_type, title, message)
                VALUES (?, ?, ?, ?)
            `;
            
            this.db.run(sql, [agentId, type, title, message], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ success: true, notificationId: this.lastID });
            });
        });
    }

    async getAgentNotifications(agentId, limit = 50) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT * FROM agent_notifications 
                WHERE agent_id = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            `;
            
            this.db.all(sql, [agentId, limit], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows);
            });
        });
    }

    async markNotificationAsRead(notificationId) {
        return new Promise((resolve, reject) => {
            const sql = 'UPDATE agent_notifications SET is_read = 1 WHERE id = ?';
            this.db.run(sql, [notificationId], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ success: true });
            });
        });
    }

    // ===== REPORTING METHODS =====


    async getAgentVoucherSales(agentId, limit = 100, offset = 0) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT * FROM agent_voucher_sales 
                WHERE agent_id = ? 
                ORDER BY sold_at DESC 
                LIMIT ? OFFSET ?
            `;
            
            this.db.all(sql, [agentId, limit, offset], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows);
            });
        });
    }

    async getAgentMonthlyPayments(agentId, limit = 100, offset = 0) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT amp.*, c.name as customer_name, c.phone as customer_phone
                FROM agent_monthly_payments amp
                LEFT JOIN customers c ON amp.customer_id = c.id
                WHERE amp.agent_id = ? 
                ORDER BY amp.paid_at DESC 
                LIMIT ? OFFSET ?
            `;
            
            this.db.all(sql, [agentId, limit, offset], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows);
            });
        });
    }

    // ===== STATISTICS METHODS =====

    async getAgentStats(agentId) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    (SELECT balance FROM agent_balances WHERE agent_id = ?) as current_balance,
                    (SELECT COUNT(*) FROM agent_voucher_sales WHERE agent_id = ?) as total_vouchers,
                    (SELECT COUNT(*) FROM agent_monthly_payments WHERE agent_id = ?) as total_payments,
                    (SELECT SUM(commission) FROM agent_voucher_sales WHERE agent_id = ?) as voucher_commission,
                    (SELECT SUM(commission_amount) FROM agent_monthly_payments WHERE agent_id = ?) as payment_commission,
                    (SELECT SUM(agent_price) FROM agent_voucher_sales WHERE agent_id = ?) as total_spent_vouchers,
                    (SELECT SUM(price) FROM agent_voucher_sales WHERE agent_id = ?) as total_sales_value
            `;
            
            this.db.get(sql, [agentId, agentId, agentId, agentId, agentId, agentId, agentId], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row);
            });
        });
    }

    // ===== UTILITY METHODS =====

    async getAllAgents() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT a.*, ab.balance 
                FROM agents a 
                LEFT JOIN agent_balances ab ON a.id = ab.agent_id
                ORDER BY a.created_at DESC
            `;
            
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows);
            });
        });
    }

    async getAgentById(agentId) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT a.*, ab.balance 
                FROM agents a 
                LEFT JOIN agent_balances ab ON a.id = ab.agent_id
                WHERE a.id = ?
            `;
            
            this.db.get(sql, [agentId], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row);
            });
        });
    }

    async getAgentByUsername(username) {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM agents WHERE username = ?';
            this.db.get(sql, [username], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row);
            });
        });
    }

    async getAgentByNameOrUsername(identifier) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT a.*, ab.balance 
                FROM agents a 
                LEFT JOIN agent_balances ab ON a.id = ab.agent_id
                WHERE LOWER(a.username) = LOWER(?) OR LOWER(a.name) = LOWER(?)
            `;
            
            this.db.get(sql, [identifier, identifier], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row);
            });
        });
    }

    async getAgentByPhone(phone) {
        // Normalisasi ke format 628...
        let normalized = phone.replace(/\D/g, '');
        if (normalized.startsWith('0')) normalized = '62' + normalized.slice(1);
        if (!normalized.startsWith('62')) normalized = '62' + normalized;
        // Juga buat versi 08...
        let local = normalized.replace(/^62/, '0');
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM agents WHERE (phone = ? OR phone = ?) AND status = "active"';
            this.db.get(sql, [normalized, local], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row);
            });
        });
    }

    async createAdminNotification(type, title, message, agentId = null) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO admin_notifications (type, title, message, agent_id, status, created_at)
                VALUES (?, ?, ?, ?, 'unread', CURRENT_TIMESTAMP)
            `;
            this.db.run(sql, [type, title, message, agentId], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ success: true, notificationId: this.lastID });
            });
        });
    }

    // Update agent status
    async updateAgentStatus(agentId, status) {
        return new Promise((resolve, reject) => {
            const sql = 'UPDATE agents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
            this.db.run(sql, [status, agentId], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (this.changes === 0) {
                    resolve({ success: false, message: 'Agent tidak ditemukan' });
                } else {
                    resolve({ success: true, message: 'Status agent berhasil diubah' });
                }
            });
        });
    }

    // Update agent
    async updateAgent(agentId, agentData) {
        return new Promise((resolve, reject) => {
            let sql = 'UPDATE agents SET username = ?, name = ?, phone = ?, email = ?, address = ?, status = ?, updated_at = CURRENT_TIMESTAMP';
            let params = [agentData.username, agentData.name, agentData.phone, agentData.email, agentData.address, agentData.status];
            
            // Add password update if provided
            if (agentData.password) {
                const bcrypt = require('bcrypt');
                const hashedPassword = bcrypt.hashSync(agentData.password, 10);
                sql += ', password = ?';
                params.push(hashedPassword);
            }
            
            sql += ' WHERE id = ?';
            params.push(agentId);
            
            this.db.run(sql, params, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (this.changes === 0) {
                    resolve({ success: false, message: 'Agent tidak ditemukan' });
                } else {
                    resolve({ success: true, message: 'Agent berhasil diupdate' });
                }
            });
        });
    }

    // Add balance to agent
    async addBalance(agentId, amount, notes = 'Saldo ditambahkan oleh admin') {
        return new Promise((resolve, reject) => {
            const db = this.db; // Store database reference
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                // Helper function to record transaction
                const recordTransaction = () => {
                    const insertTransactionSql = `
                        INSERT INTO agent_transactions (agent_id, transaction_type, amount, description, reference_id)
                        VALUES (?, 'deposit', ?, ?, ?)
                    `;
                    
                    db.run(insertTransactionSql, [
                        agentId,
                        amount,
                        notes,
                        'ADMIN_' + Date.now()
                    ], function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        db.run('COMMIT', (err) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            resolve({ 
                                success: true, 
                                message: 'Saldo berhasil ditambahkan',
                                transactionId: this.lastID
                            });
                        });
                    });
                };

                // First, check if agent_balance record exists
                const checkBalanceSql = 'SELECT balance FROM agent_balances WHERE agent_id = ?';
                db.get(checkBalanceSql, [agentId], function(err, row) {
                    if (err) {
                        db.run('ROLLBACK');
                        reject(err);
                        return;
                    }

                    if (row) {
                        // Update existing balance
                        const updateBalanceSql = `
                            UPDATE agent_balances 
                            SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP 
                            WHERE agent_id = ?
                        `;
                        
                        db.run(updateBalanceSql, [amount, agentId], function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                reject(err);
                                return;
                            }
                            recordTransaction();
                        });
                    } else {
                        // Insert new balance record
                        const insertBalanceSql = `
                            INSERT INTO agent_balances (agent_id, balance, last_updated)
                            VALUES (?, ?, CURRENT_TIMESTAMP)
                        `;
                        
                        db.run(insertBalanceSql, [agentId, amount], function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                reject(err);
                                return;
                            }
                            recordTransaction();
                        });
                    }
                });
            });
        });
    }

    // Delete agent and all related data
    async deleteAgent(agentId) {
        return new Promise((resolve, reject) => {
            const db = this.db; // Store database reference
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                // Delete in correct order to respect foreign key constraints
                const deleteQueries = [
                    'DELETE FROM agent_voucher_sales WHERE agent_id = ?',
                    'DELETE FROM agent_balances WHERE agent_id = ?',
                    'DELETE FROM agent_notifications WHERE agent_id = ?',
                    'DELETE FROM agent_transactions WHERE agent_id = ?',
                    'DELETE FROM agent_monthly_payments WHERE agent_id = ?',
                    'DELETE FROM agent_balance_requests WHERE agent_id = ?',
                    'DELETE FROM agents WHERE id = ?'
                ];
                
                // Execute all delete queries
                let completed = 0;
                let hasError = false;
                
                deleteQueries.forEach((query, index) => {
                    db.run(query, [agentId], function(err) {
                        if (err) {
                            console.error(`Error deleting from query ${index + 1}:`, err.message);
                            hasError = true;
                        }
                        
                        completed++;
                        
                        // Check if all queries are completed
                        if (completed === deleteQueries.length) {
                            if (hasError) {
                                db.run('ROLLBACK');
                                reject(new Error('Gagal menghapus data agent terkait'));
                            } else {
                                db.run('COMMIT');
                                resolve({ success: true, message: 'Agent dan semua data terkait berhasil dihapus' });
                            }
                        }
                    });
                });
            });
        });
    }

    async getAgentStatistics(agentId) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    -- Total voucher sales
                    (SELECT COUNT(*) FROM agent_voucher_sales WHERE agent_id = ?) as total_voucher_sales,
                    (SELECT COALESCE(SUM(price), 0) FROM agent_voucher_sales WHERE agent_id = ?) as total_voucher_revenue,
                    (SELECT COALESCE(SUM(commission), 0) FROM agent_voucher_sales WHERE agent_id = ?) as total_commission_earned,
                    
                    -- Total monthly payments
                    (SELECT COUNT(*) FROM agent_monthly_payments WHERE agent_id = ?) as total_monthly_payments,
                    (SELECT COALESCE(SUM(payment_amount), 0) FROM agent_monthly_payments WHERE agent_id = ?) as total_payment_amount,
                    
                    -- Balance requests
                    (SELECT COUNT(*) FROM agent_balance_requests WHERE agent_id = ?) as total_balance_requests,
                    (SELECT COALESCE(SUM(amount), 0) FROM agent_balance_requests WHERE agent_id = ? AND status = 'approved') as total_approved_requests,
                    
                    -- Recent activity (last 30 days)
                    (SELECT COUNT(*) FROM agent_voucher_sales WHERE agent_id = ? AND sold_at >= datetime('now', '-30 days')) as recent_voucher_sales,
                    (SELECT COUNT(*) FROM agent_monthly_payments WHERE agent_id = ? AND paid_at >= datetime('now', '-30 days')) as recent_payments,
                    
                    -- Current balance
                    (SELECT COALESCE(balance, 0) FROM agent_balances WHERE agent_id = ?) as current_balance
            `;
            
            this.db.get(sql, [
                agentId, agentId, agentId,  // voucher sales
                agentId, agentId,          // monthly payments  
                agentId, agentId,          // balance requests
                agentId, agentId,          // recent activity
                agentId                    // current balance
            ], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row);
            });
        });
    }

    // Get balance request statistics
    async getBalanceRequestStats() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
                    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
                FROM agent_balance_requests
            `;
            
            this.db.get(sql, [], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row);
            });
        });
    }

    // Get voucher sales statistics
    async getVoucherSalesStats() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    COUNT(*) as total,
                    COALESCE(SUM(price), 0) as total_value
                FROM agent_voucher_sales
            `;
            
            this.db.get(sql, [], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row);
            });
        });
    }

    // Get monthly payment statistics
    async getMonthlyPaymentStats() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    COUNT(*) as total,
                    COALESCE(SUM(payment_amount), 0) as total_value
                FROM agent_monthly_payments
            `;
            
            this.db.get(sql, [], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row);
            });
        });
    }

    // ===== WHATSAPP COMMAND METHODS =====

    async getAgentByPhone(phone) {
        // Normalisasi ke format 628...
        let normalized = phone.replace(/\D/g, '');
        if (normalized.startsWith('0')) normalized = '62' + normalized.slice(1);
        if (!normalized.startsWith('62')) normalized = '62' + normalized;
        // Juga buat versi 08...
        let local = normalized.replace(/^62/, '0');
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM agents WHERE (phone = ? OR phone = ?) AND status = "active"';
            this.db.get(sql, [normalized, local], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row);
            });
        });
    }

    async getAvailablePackages() {
        return new Promise((resolve, reject) => {
            // Get packages from voucher_pricing
            const sql = 'SELECT * FROM voucher_pricing WHERE is_active = 1 ORDER BY customer_price ASC';
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                  // Transform to package format
                  const packages = rows.map(row => ({
                      id: row.id,
                      name: row.package_name,
                      customerPrice: row.customer_price,
                      agentPrice: row.agent_price,
                      commissionAmount: row.commission_amount,
                      duration: row.duration,
                      durationType: row.duration_type || 'hours',
                      description: row.description,
                      voucherDigitType: row.voucher_digit_type || 'mixed',
                      voucherLength: row.voucher_length || 8,
                      accountType: row.account_type || 'voucher'
                  }));

                resolve(packages);
            });
        });
    }

    async getPackageById(packageId) {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM voucher_pricing WHERE id = ? AND is_active = 1';
            this.db.get(sql, [packageId], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                if (!row) {
                    resolve(null);
                    return;
                }
                
                  // Transform to package format
                  const packageData = {
                      id: row.id,
                      name: row.package_name,
                      customerPrice: row.customer_price,
                      agentPrice: row.agent_price,
                      commissionAmount: row.commission_amount,
                      duration: row.duration,
                      description: row.description,
                      voucherDigitType: row.voucher_digit_type || 'mixed',
                      voucherLength: row.voucher_length || 8,
                      accountType: row.account_type || 'voucher',
                      hotspotProfile: row.hotspot_profile || 'default'
                  };

                resolve(packageData);
            });
        });
    }



    async processPayment(agentId, customerName, customerPhone, amount) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');

                // Update agent balance (add)
                const updateBalanceSql = `
                    UPDATE agent_balances 
                    SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP 
                    WHERE agent_id = ?
                `;
                this.db.run(updateBalanceSql, [amount, agentId], (err) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        reject(err);
                        return;
                    }

                    // Record transaction
                    const transactionSql = `
                        INSERT INTO agent_transactions 
                        (agent_id, transaction_type, amount, description)
                        VALUES (?, 'monthly_payment', ?, ?)
                    `;
                    this.db.run(transactionSql, [agentId, amount, `Pembayaran dari ${customerName} (${customerPhone})`], (err) => {
                        if (err) {
                            this.db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        this.db.run('COMMIT');
                        
                        // Get new balance
                        const checkBalanceSql = 'SELECT balance FROM agent_balances WHERE agent_id = ?';
                        this.db.get(checkBalanceSql, [agentId], (err, balanceRow) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            
                            resolve({ 
                                success: true, 
                                newBalance: balanceRow.balance 
                            });
                        });
                    });
                });
            });
        });
    }



    async getAgentTransactions(agentId, page = 1, limit = 20, filter = 'all') {
        return new Promise((resolve, reject) => {
            const offset = (page - 1) * limit;
            let whereClause = 'WHERE t.agent_id = ?';
            let params = [agentId];
            
            // Add filter conditions
            if (filter === 'voucher') {
                whereClause += ' AND t.transaction_type = "voucher_sale"';
            } else if (filter === 'payment') {
                whereClause += ' AND t.transaction_type = "monthly_payment"';
            } else if (filter === 'balance') {
                whereClause += ' AND (t.transaction_type = "deposit" OR t.transaction_type = "withdrawal" OR t.transaction_type = "balance_request")';
            }
            
            const sql = `
                SELECT 
                    t.*,
                    avs.voucher_code,
                    avs.package_name,
                    avs.customer_phone,
                    avs.customer_name,
                    avs.price as voucher_price,
                    avs.commission as voucher_commission,
                    avs.agent_price,
                    avs.commission_amount
                FROM agent_transactions t
                LEFT JOIN agent_voucher_sales avs ON t.reference_id = avs.voucher_code AND t.transaction_type = 'voucher_sale'
                ${whereClause}
                ORDER BY t.created_at DESC 
                LIMIT ? OFFSET ?
            `;
            
            params.push(limit, offset);
            
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                // Get total count for pagination
                let countSql = `SELECT COUNT(*) as total FROM agent_transactions t ${whereClause.replace('t.', '')}`;
                this.db.get(countSql, [agentId], (countErr, countRow) => {
                    if (countErr) {
                        reject(countErr);
                        return;
                    }
                    
                    resolve({
                        data: rows || [],
                        pagination: {
                            page: page,
                            limit: limit,
                            total: countRow.total,
                            pages: Math.ceil(countRow.total / limit)
                        }
                    });
                });
            });
        });
    }

    close() {
        this.db.close();
    }
}

module.exports = AgentManager;

