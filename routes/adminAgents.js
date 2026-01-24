const express = require('express');
const router = express.Router();
const AgentManager = require('../config/agentManager');
const { getSettingsWithCache, getSetting } = require('../config/settingsManager');
const logger = require('../config/logger');

// Import adminAuth middleware
const { adminAuth } = require('./adminAuth');

// Helper function to format phone number for WhatsApp
function formatPhoneNumberForWhatsApp(phoneNumber) {
    if (!phoneNumber) return null;

    // Remove all non-digit characters
    let cleanPhone = phoneNumber.replace(/[^0-9+]/g, '');

    // Add country code if not present
    if (cleanPhone.startsWith('0')) {
        cleanPhone = '62' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('+')) {
        cleanPhone = cleanPhone.substring(1);
    } else if (!cleanPhone.startsWith('62')) {
        cleanPhone = '62' + cleanPhone;
    }

    return cleanPhone + '@s.whatsapp.net';
}

// Initialize AgentManager
const agentManager = new AgentManager();

// ===== AGENT MANAGEMENT =====

// GET: Agents management page
router.get('/agents', adminAuth, async (req, res) => {
    try {
        res.render('admin/agents', {
            title: 'Agent Management',
            page: 'agents',
            appSettings: getSettingsWithCache()
        });
    } catch (error) {
        logger.error('Admin agents page error:', error);
        res.status(500).send('Error loading agents page');
    }
});

// GET: Agent registrations page
router.get('/agent-registrations', adminAuth, async (req, res) => {
    try {
        res.render('admin/agent-registrations', {
            title: 'Agent Registrations',
            page: 'agent-registrations',
            appSettings: getSettingsWithCache()
        });
    } catch (error) {
        logger.error('Admin agent registrations page error:', error);
        res.status(500).send('Error loading agent registrations page');
    }
});

// GET: Agent registrations API
router.get('/api/agent-registrations', adminAuth, async (req, res) => {
    try {
        const agents = await agentManager.getAllAgents();

        // Filter agents by status
        const pendingAgents = agents.filter(agent => agent.status === 'pending');
        const approvedAgents = agents.filter(agent => agent.status === 'active');
        const rejectedAgents = agents.filter(agent => agent.status === 'rejected');

        const stats = {
            pending: pendingAgents.length,
            approved: approvedAgents.length,
            rejected: rejectedAgents.length,
            total: agents.length
        };

        res.json({
            success: true,
            agents: agents,
            stats: stats
        });
    } catch (error) {
        logger.error('Get agent registrations error:', error);
        res.json({ success: false, message: 'Error loading agent registrations' });
    }
});

// POST: Approve agent registration
router.post('/api/agent-registrations/:agentId/approve', adminAuth, async (req, res) => {
    try {
        const agentId = req.params.agentId;

        // Update agent status to active
        await agentManager.updateAgentStatus(agentId, 'active');

        // Create notification for agent
        await agentManager.createNotification(
            agentId,
            'registration_approved',
            'Pendaftaran Disetujui',
            'Pendaftaran Anda sebagai agent telah disetujui. Anda dapat login dan mulai transaksi.'
        );

        logger.info(`Agent ${agentId} registration approved by admin`);

        res.json({ success: true, message: 'Agent berhasil disetujui' });
    } catch (error) {
        logger.error('Approve agent registration error:', error);
        res.json({ success: false, message: 'Error approving agent registration' });
    }
});

// POST: Reject agent registration
router.post('/api/agent-registrations/:agentId/reject', adminAuth, async (req, res) => {
    try {
        const agentId = req.params.agentId;
        const { reason } = req.body;

        // Update agent status to rejected
        await agentManager.updateAgentStatus(agentId, 'rejected');

        // Create notification for agent
        await agentManager.createNotification(
            agentId,
            'registration_rejected',
            'Pendaftaran Ditolak',
            `Pendaftaran Anda sebagai agent ditolak.${reason ? ' Alasan: ' + reason : ''} Silakan daftar ulang dengan data yang benar.`
        );

        logger.info(`Agent ${agentId} registration rejected by admin. Reason: ${reason || 'No reason provided'}`);

        res.json({ success: true, message: 'Agent berhasil ditolak' });
    } catch (error) {
        logger.error('Reject agent registration error:', error);
        res.json({ success: false, message: 'Error rejecting agent registration' });
    }
});

// GET: List all agents
router.get('/agents/list', adminAuth, async (req, res) => {
    try {
        console.log('🔍 [DEBUG] Agents list route called');
        console.log('🔍 [DEBUG] Session:', req.session?.isAdmin ? 'Authenticated' : 'Not authenticated');
        const agents = await agentManager.getAllAgents();
        console.log('🔍 [DEBUG] Agents data:', agents?.length || 0, 'agents');
        res.json({ success: true, agents });
    } catch (error) {
        console.error('🔍 [DEBUG] Agents list error:', error);
        logger.error('Get agents list error:', error);
        res.json({ success: false, message: 'Error loading agents' });
    }
});

// GET: Get balance requests
router.get('/agents/balance-requests', adminAuth, async (req, res) => {
    try {
        console.log('🔍 [DEBUG] Balance requests route called');
        console.log('🔍 [DEBUG] Session:', req.session?.isAdmin ? 'Authenticated' : 'Not authenticated');
        // Only fetch pending requests by default
        const requests = await agentManager.getBalanceRequests('pending');
        console.log('🔍 [DEBUG] Balance requests data:', requests?.length || 0, 'requests');
        res.json({ success: true, requests });
    } catch (error) {
        console.error('🔍 [DEBUG] Balance requests error:', error);
        logger.error('Get balance requests error:', error);
        res.json({ success: false, message: 'Error loading balance requests' });
    }
});

// GET: Agent detail page
router.get('/agents/:id', adminAuth, async (req, res) => {
    try {
        const agentId = parseInt(req.params.id);
        if (isNaN(agentId)) {
            return res.status(400).json({ success: false, message: 'Invalid agent ID' });
        }

        const agent = await agentManager.getAgentById(agentId);
        if (!agent) {
            return res.status(404).json({ success: false, message: 'Agent not found' });
        }

        res.render('admin/agent-detail', {
            agent,
            appSettings: getSettingsWithCache()
        });
    } catch (error) {
        logger.error('Agent detail page error:', error);
        res.status(500).json({ success: false, message: 'Error loading agent detail page' });
    }
});

// GET: Get agent details with statistics
router.get('/agents/:id/details', adminAuth, async (req, res) => {
    try {
        const agentId = parseInt(req.params.id);
        if (isNaN(agentId)) {
            return res.json({ success: false, message: 'Invalid agent ID' });
        }

        const agent = await agentManager.getAgentById(agentId);
        if (!agent) {
            return res.json({ success: false, message: 'Agent not found' });
        }

        // Get agent statistics
        const stats = await agentManager.getAgentStatistics(agentId);

        res.json({
            success: true,
            agent,
            statistics: stats
        });
    } catch (error) {
        logger.error('Get agent details error:', error);
        res.json({ success: false, message: 'Error loading agent details' });
    }
});

// GET: Get agent transaction history
router.get('/agents/:id/transactions', adminAuth, async (req, res) => {
    try {
        const agentId = parseInt(req.params.id);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const filter = req.query.filter || 'all';

        if (isNaN(agentId)) {
            return res.json({ success: false, message: 'Invalid agent ID' });
        }

        const transactions = await agentManager.getAgentTransactions(agentId, page, limit, filter);

        res.json({
            success: true,
            transactions: transactions.data,
            pagination: transactions.pagination
        });
    } catch (error) {
        logger.error('Get agent transactions error:', error);
        res.json({ success: false, message: 'Error loading agent transactions' });
    }
});

// POST: Add new agent
router.post('/agents/add', adminAuth, async (req, res) => {
    try {
        const { username, name, phone, email, address, password, commission_rate } = req.body;

        if (!username || !name || !phone || !password) {
            return res.json({ success: false, message: 'Username, nama, nomor HP, dan password harus diisi' });
        }

        const agentData = {
            username,
            name,
            phone,
            email: email || null,
            address: address || null,
            password,
            commission_rate: parseFloat(commission_rate) || 5.00
        };

        const result = await agentManager.createAgent(agentData);

        if (result.success) {
            // Send WhatsApp notification to admin
            try {
                const AgentWhatsAppManager = require('../config/agentWhatsApp');
                const whatsappManager = new AgentWhatsAppManager();

                // Import the helper function
                const { getSetting } = require('../config/settingsManager');

                if (whatsappManager.sock) {
                    const adminNumbers = [];
                    let i = 0;
                    while (true) {
                        const adminNum = getSetting(`admins.${i}`);
                        if (!adminNum) break;
                        adminNumbers.push(adminNum);
                        i++;
                    }

                    const adminMessage = `*AGENT BARU DITAMBAHKAN OLEH ADMIN*

👤 **Nama:** ${name}
🆔 **Username:** ${username}
📱 **HP:** ${phone}
📧 **Email:** ${email || '-'}
🏠 **Alamat:** ${address || '-'}
💰 **Komisi:** ${commission_rate}%
🆔 **ID Agent:** ${result.agentId}

Agent dapat login menggunakan username dan password yang diberikan.`;

                    for (const adminNum of adminNumbers) {
                        try {
                            // Format phone number properly for WhatsApp
                            const formattedAdminNum = formatPhoneNumberForWhatsApp(adminNum);
                            await whatsappManager.sock.sendMessage(formattedAdminNum, { text: adminMessage });
                        } catch (e) {
                            logger.error('WA admin notif error:', e);
                        }
                    }

                    // Send WhatsApp notification to agent
                    try {
                        const serverHost = getSetting('server_host', 'localhost');
                        const serverPort = getSetting('server_port', '3001');
                        const portalUrl = getSetting('portal_url', `http://${serverHost}:${serverPort}/agent/login`);
                        const adminContact = getSetting('contact_whatsapp', getSetting('contact_phone', '-'));

                        const agentMessage = `*PENDAFTARAN BERHASIL*

Selamat datang di Portal Agent!

Akun Anda sudah aktif dan siap digunakan.

*Username:* ${username}
*Password:* ${password}
*Login Portal:* ${portalUrl}

Untuk mulai transaksi, silakan lakukan deposit terlebih dahulu melalui menu "Deposit" di portal agent.

Jika butuh bantuan, hubungi admin di WhatsApp: ${adminContact}

Terima kasih telah bergabung!`;

                        // Format phone number properly for WhatsApp
                        const formattedAgentPhone = formatPhoneNumberForWhatsApp(phone);
                        await whatsappManager.sock.sendMessage(formattedAgentPhone, { text: agentMessage });
                        logger.info(`Agent welcome notification sent to ${formattedAgentPhone}`);
                    } catch (e) {
                        logger.error(`WA agent welcome notif error for ${phone}:`, e);
                    }
                }
            } catch (whatsappError) {
                logger.error('WhatsApp notification error:', whatsappError);
                // Don't fail the transaction if WhatsApp fails
            }

            res.json({ success: true, message: 'Agent berhasil ditambahkan' });
        } else {
            res.json({ success: false, message: 'Gagal menambahkan agent' });
        }
    } catch (error) {
        logger.error('Add agent error:', error);
        res.json({ success: false, message: 'Terjadi kesalahan saat menambahkan agent' });
    }
});


// PUT: Update agent
router.put('/agents/:id', adminAuth, async (req, res) => {
    try {
        const agentId = req.params.id;
        const { name, phone, email, address, commission_rate, status } = req.body;

        const result = await agentManager.updateAgent(agentId, {
            name,
            phone,
            email,
            address,
            commission_rate,
            status
        });

        if (result.success) {
            res.json({ success: true, message: 'Agent berhasil diupdate' });
        } else {
            res.json({ success: false, message: result.message || 'Gagal mengupdate agent' });
        }
    } catch (error) {
        logger.error('Update agent error:', error);
        res.json({ success: false, message: 'Terjadi kesalahan saat mengupdate agent' });
    }
});

// DELETE: Delete agent
router.delete('/agents/:id', adminAuth, async (req, res) => {
    try {
        const agentId = req.params.id;

        const result = await agentManager.deleteAgent(agentId);

        if (result.success) {
            res.json({ success: true, message: result.message });
        } else {
            res.json({ success: false, message: result.message || 'Gagal menghapus agent' });
        }
    } catch (error) {
        logger.error('Delete agent error:', error);
        res.json({ success: false, message: 'Terjadi kesalahan saat menghapus agent' });
    }
});

// ===== BALANCE REQUESTS =====

// POST: Approve balance request
router.post('/agents/approve-request', adminAuth, async (req, res) => {
    try {
        const { requestId, adminNotes } = req.body;
        const adminId = req.session.adminId || 1; // Use admin session ID or default

        const result = await agentManager.approveBalanceRequest(requestId, adminId, adminNotes);

        if (result.success) {
            // Send WhatsApp notification to agent
            try {
                const AgentWhatsAppManager = require('../config/agentWhatsApp');
                const whatsappManager = new AgentWhatsAppManager();

                // Get request details for notification
                const sqlite3 = require('sqlite3').verbose();
                const db = new sqlite3.Database('./data/billing.db');

                db.get(`
                    SELECT abr.*, a.name as agent_name, a.phone as agent_phone, ab.balance as current_balance
                    FROM agent_balance_requests abr
                    JOIN agents a ON abr.agent_id = a.id
                    LEFT JOIN agent_balances ab ON a.id = ab.agent_id
                    WHERE abr.id = ?
                `, [requestId], async (err, request) => {
                    db.close();

                    if (!err && request) {
                        const agent = {
                            name: request.agent_name,
                            phone: request.agent_phone
                        };

                        const requestData = {
                            amount: request.amount,
                            requestedAt: request.requested_at,
                            adminNotes: adminNotes,
                            previousBalance: request.current_balance - request.amount,
                            newBalance: request.current_balance
                        };

                        await whatsappManager.sendRequestApprovedNotification(agent, requestData);
                    }
                });
            } catch (whatsappError) {
                logger.error('WhatsApp notification error:', whatsappError);
                // Don't fail the transaction if WhatsApp fails
            }

            res.json({ success: true, message: 'Request saldo berhasil disetujui' });
        } else {
            res.json({ success: false, message: 'Gagal menyetujui request saldo' });
        }
    } catch (error) {
        logger.error('Approve balance request error:', error);
        res.json({ success: false, message: 'Terjadi kesalahan saat menyetujui request' });
    }
});

// POST: Reject balance request
router.post('/agents/reject-request', adminAuth, async (req, res) => {
    try {
        const { requestId, rejectReason } = req.body;

        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');

        const updateSql = `
            UPDATE agent_balance_requests 
            SET status = 'rejected', processed_at = CURRENT_TIMESTAMP, admin_notes = ?
            WHERE id = ?
        `;

        db.run(updateSql, [rejectReason, requestId], function (err) {
            if (err) {
                db.close();
                return res.json({ success: false, message: 'Gagal menolak request saldo' });
            }

            // Send WhatsApp notification to agent
            try {
                const AgentWhatsAppManager = require('../config/agentWhatsApp');
                const whatsappManager = new AgentWhatsAppManager();

                // Get request details for notification
                db.get(`
                    SELECT abr.*, a.name as agent_name, a.phone as agent_phone
                    FROM agent_balance_requests abr
                    JOIN agents a ON abr.agent_id = a.id
                    WHERE abr.id = ?
                `, [requestId], async (err, request) => {
                    db.close();

                    if (!err && request) {
                        const agent = {
                            name: request.agent_name,
                            phone: request.agent_phone
                        };

                        const requestData = {
                            amount: request.amount,
                            requestedAt: request.requested_at,
                            rejectReason: rejectReason
                        };

                        await whatsappManager.sendRequestRejectedNotification(agent, requestData);
                    }
                });
            } catch (whatsappError) {
                logger.error('WhatsApp notification error:', whatsappError);
                // Don't fail the transaction if WhatsApp fails
            }

            res.json({ success: true, message: 'Request saldo berhasil ditolak' });
        });
    } catch (error) {
        logger.error('Reject balance request error:', error);
        res.json({ success: false, message: 'Terjadi kesalahan saat menolak request' });
    }
});

// ===== AGENT STATISTICS =====

// GET: Get agent statistics
router.get('/agents/stats', adminAuth, async (req, res) => {
    try {
        // Use agentManager methods instead of direct database connection
        const agents = await agentManager.getAllAgents();
        const balanceStats = await agentManager.getBalanceRequestStats();
        const voucherStats = await agentManager.getVoucherSalesStats();
        const paymentStats = await agentManager.getMonthlyPaymentStats();

        const stats = {
            totalAgents: agents.length,
            activeAgents: agents.filter(agent => agent.status === 'active').length,
            totalBalanceRequests: balanceStats.total || 0,
            pendingBalanceRequests: balanceStats.pending || 0,
            totalVoucherSales: voucherStats.total || 0,
            totalVoucherSalesValue: voucherStats.total_value || 0,
            totalMonthlyPayments: paymentStats.total || 0,
            totalMonthlyPaymentsValue: paymentStats.total_value || 0
        };

        res.json({ success: true, stats });
    } catch (error) {
        logger.error('Get agent stats error:', error);
        res.json({ success: false, message: 'Error loading agent statistics' });
    }
});

// ===== AGENT TRANSACTIONS =====

// GET: Get agent voucher sales
router.get('/agents/:id/vouchers', adminAuth, async (req, res) => {
    try {
        const agentId = req.params.id;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const sales = await agentManager.getAgentVoucherSales(agentId, limit, offset);
        res.json({ success: true, sales });
    } catch (error) {
        logger.error('Get agent voucher sales error:', error);
        res.json({ success: false, message: 'Error loading agent voucher sales' });
    }
});

// GET: Get agent monthly payments
router.get('/agents/:id/payments', adminAuth, async (req, res) => {
    try {
        const agentId = req.params.id;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const payments = await agentManager.getAgentMonthlyPayments(agentId, limit, offset);
        res.json({ success: true, payments });
    } catch (error) {
        logger.error('Get agent monthly payments error:', error);
        res.json({ success: false, message: 'Error loading agent monthly payments' });
    }
});

// ===== MANUAL BALANCE ADJUSTMENT =====

// POST: Manual balance adjustment
router.post('/agents/:id/adjust-balance', adminAuth, async (req, res) => {
    try {
        const agentId = req.params.id;
        const { amount, description } = req.body;

        if (!amount || !description) {
            return res.json({ success: false, message: 'Jumlah dan deskripsi harus diisi' });
        }

        const result = await agentManager.updateAgentBalance(
            agentId,
            parseFloat(amount),
            'deposit',
            description
        );

        if (result.success) {
            res.json({ success: true, message: 'Saldo agent berhasil disesuaikan' });
        } else {
            res.json({ success: false, message: 'Gagal menyesuaikan saldo agent' });
        }
    } catch (error) {
        logger.error('Adjust agent balance error:', error);
        res.json({ success: false, message: 'Terjadi kesalahan saat menyesuaikan saldo' });
    }
});

// POST: Toggle agent status
router.post('/agents/:id/toggle-status', adminAuth, async (req, res) => {
    try {
        const agentId = parseInt(req.params.id);
        const { status } = req.body;

        if (isNaN(agentId)) {
            return res.json({ success: false, message: 'Invalid agent ID' });
        }

        if (!['active', 'inactive', 'suspended'].includes(status)) {
            return res.json({ success: false, message: 'Invalid status' });
        }

        const result = await agentManager.updateAgentStatus(agentId, status);

        if (result.success) {
            res.json({ success: true, message: `Agent status berhasil diubah menjadi ${status}` });
        } else {
            res.json({ success: false, message: result.message });
        }
    } catch (error) {
        logger.error('Toggle agent status error:', error);
        res.json({ success: false, message: 'Terjadi kesalahan saat mengubah status agent' });
    }
});

// POST: Update agent
router.post('/agents/update', adminAuth, async (req, res) => {
    try {
        const { id, username, name, phone, email, address, password, status } = req.body;

        if (!id || !username || !name || !phone) {
            return res.json({ success: false, message: 'Data yang diperlukan tidak lengkap' });
        }

        const result = await agentManager.updateAgent(id, {
            username,
            name,
            phone,
            email,
            address,
            password,
            status
        });

        if (result.success) {
            res.json({ success: true, message: 'Agent berhasil diupdate' });
        } else {
            res.json({ success: false, message: result.message });
        }
    } catch (error) {
        logger.error('Update agent error:', error);
        res.json({ success: false, message: 'Terjadi kesalahan saat mengupdate agent' });
    }
});

// POST: Add balance to agent
router.post('/agents/add-balance', adminAuth, async (req, res) => {
    try {
        const { agentId, amount, notes } = req.body;

        if (!agentId || !amount) {
            return res.json({ success: false, message: 'Data yang diperlukan tidak lengkap' });
        }

        if (parseInt(amount) < 1000) {
            return res.json({ success: false, message: 'Jumlah saldo minimal Rp 1.000' });
        }

        const result = await agentManager.addBalance(agentId, parseInt(amount), notes || 'Saldo ditambahkan oleh admin');

        if (result.success) {
            // Send WhatsApp notification to agent
            try {
                const AgentWhatsAppManager = require('../config/agentWhatsApp');
                const whatsappManager = new AgentWhatsAppManager();

                // Get agent details
                const agent = await agentManager.getAgentById(agentId);
                if (agent && whatsappManager.sock) {
                    const balanceData = {
                        previousBalance: agent.balance - parseInt(amount),
                        currentBalance: agent.balance,
                        change: parseInt(amount),
                        description: notes || 'Saldo ditambahkan oleh admin'
                    };

                    await whatsappManager.sendBalanceUpdateNotification(agent, balanceData);
                }
            } catch (whatsappError) {
                logger.error('WhatsApp notification error:', whatsappError);
                // Don't fail the transaction if WhatsApp fails
            }

            res.json({ success: true, message: 'Saldo berhasil ditambahkan' });
        } else {
            res.json({ success: false, message: result.message });
        }
    } catch (error) {
        logger.error('Add balance error:', error);
        res.json({ success: false, message: 'Terjadi kesalahan saat menambahkan saldo' });
    }
});

module.exports = router;
