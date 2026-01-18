const logger = require('./logger');
const billingManager = require('./billing');
const { getMikrotikConnection } = require('./mikrotik');
const { findDeviceByPhoneNumber, findDeviceByPPPoE, setParameterValues } = require('./genieacs');
const { getSetting } = require('./settingsManager');
const staticIPSuspension = require('./staticIPSuspension');

class ServiceSuspensionManager {
    constructor() {
        this.isRunning = false;
    }

    /**
     * Pastikan profile isolir (berdasarkan setting) tersedia di Mikrotik jika perlu
     * Hanya auto-create bila nama profil = 'isolir'
     */
    async ensureIsolirProfile() {
        try {
            const mikrotik = await getMikrotikConnection();

            const selectedProfile = getSetting('isolir_profile', 'isolir');
            // Cek apakah profile isolir sudah ada
            const profiles = await mikrotik.write('/ppp/profile/print', [
                `?name=${selectedProfile}`
            ]);

            if (profiles && profiles.length > 0) {
                logger.info(`Isolir profile '${selectedProfile}' already exists in Mikrotik`);
                return profiles[0]['.id'];
            }

            // Jika user memilih nama lain selain 'isolir' (case insensitive), jangan auto-create
            // Kecuali jika namanya 'isolir' atau 'ISOLIR', kita bantu buatkan
            if (selectedProfile.toLowerCase() !== 'isolir') {
                logger.warn(`Isolir profile '${selectedProfile}' not found in Mikrotik. Please create it on Mikrotik or choose another profile.`);
                return null;
            }

            // Buat profile dengan nama sesuai setting (bisa 'isolir' atau 'ISOLIR')
            const newProfile = await mikrotik.write('/ppp/profile/add', [
                `=name=${selectedProfile}`,
                '=local-address=0.0.0.0',
                '=remote-address=0.0.0.0',
                '=rate-limit=0/0',
                '=comment=SUSPENDED_PROFILE',
                '=shared-users=1'
            ]);

            const profileId = newProfile[0]['ret'];
            logger.info('Created isolir profile in Mikrotik with ID:', profileId);
            return profileId;

        } catch (error) {
            logger.error('Error ensuring isolir profile:', error);
            throw error;
        }
    }

    /**
     * Suspend layanan pelanggan (blokir internet)
     * Mendukung PPPoE dan IP statik
     */
    async suspendCustomerService(customer, reason = 'Telat bayar') {
        try {
            logger.info(`Suspending service for customer: ${customer.username} (${reason})`);

            const results = {
                mikrotik: false,
                genieacs: false,
                billing: false,
                suspension_type: null
            };

            // Tentukan tipe koneksi pelanggan
            const hasPPPoE = customer.pppoe_username && customer.pppoe_username.trim();
            const hasStaticIP = customer.static_ip || customer.ip_address || customer.assigned_ip;
            const hasMacAddress = customer.mac_address;

            // 1. Prioritas suspend PPPoE jika tersedia
            if (hasPPPoE) {
                results.suspension_type = 'pppoe';
                try {
                    const mikrotik = await getMikrotikConnection();

                    // Tentukan profile isolir dari setting
                    const selectedProfile = getSetting('isolir_profile', 'isolir');
                    // Pastikan profile isolir ada (auto-create hanya jika 'isolir')
                    await this.ensureIsolirProfile();

                    // Cari .id secret berdasarkan name terlebih dahulu
                    let secretId = null;
                    try {
                        const secrets = await mikrotik.write('/ppp/secret/print', [
                            `?name=${customer.pppoe_username}`
                        ]);
                        if (secrets && secrets.length > 0) {
                            secretId = secrets[0]['.id'];
                        }
                    } catch (lookupErr) {
                        logger.warn(`Mikrotik: failed to lookup secret id for ${customer.pppoe_username}: ${lookupErr.message}`);
                    }

                    // Update PPPoE user dengan profile isolir, gunakan .id bila tersedia, fallback ke =name=
                    const setParams = secretId
                        ? [`=.id=${secretId}`, `=profile=${selectedProfile}`, `=comment=SUSPENDED - ${reason}`]
                        : [`=name=${customer.pppoe_username}`, `=profile=${selectedProfile}`, `=comment=SUSPENDED - ${reason}`];

                    await mikrotik.write('/ppp/secret/set', setParams);
                    logger.info(`Mikrotik: Set profile to '${selectedProfile}' for ${customer.pppoe_username} (${secretId ? 'by .id' : 'by name'})`);

                    // Disconnect active session jika ada
                    const activeSessions = await mikrotik.write('/ppp/active/print', [
                        `?name=${customer.pppoe_username}`
                    ]);

                    if (activeSessions && activeSessions.length > 0) {
                        for (const session of activeSessions) {
                            await mikrotik.write('/ppp/active/remove', [
                                `=.id=${session['.id']}`
                            ]);
                        }
                    }

                    results.mikrotik = true;
                    logger.info(`Mikrotik: Successfully suspended PPPoE user ${customer.pppoe_username} with isolir profile`);
                } catch (mikrotikError) {
                    logger.error(`Mikrotik PPPoE suspension failed for ${customer.username}:`, mikrotikError.message);
                }
            }
            // 2. Jika tidak ada PPPoE, coba suspend IP statik
            else if (hasStaticIP || hasMacAddress) {
                results.suspension_type = 'static_ip';
                try {
                    // Tentukan metode suspend dari setting (default: address_list)
                    const suspensionMethod = getSetting('static_ip_suspension_method', 'address_list');

                    const staticResult = await staticIPSuspension.suspendStaticIPCustomer(
                        customer,
                        reason,
                        suspensionMethod
                    );

                    if (staticResult.success) {
                        results.mikrotik = true;
                        results.static_ip_method = staticResult.results?.method_used;
                        logger.info(`Static IP suspension successful for ${customer.username} using ${staticResult.results?.method_used}`);
                    } else {
                        logger.error(`Static IP suspension failed for ${customer.username}: ${staticResult.error}`);
                    }
                } catch (staticIPError) {
                    logger.error(`Static IP suspension failed for ${customer.username}:`, staticIPError.message);
                }
            }
            // 3. Jika tidak ada PPPoE atau IP statik, coba cari device untuk suspend WAN
            else {
                results.suspension_type = 'wan_disable';
                logger.warn(`Customer ${customer.username} has no PPPoE username or static IP, trying WAN disable method`);
            }

            // 2. Suspend via GenieACS (disable WAN connection)
            if (customer.phone || customer.pppoe_username) {
                try {
                    let device = null;

                    // Coba cari device by phone number dulu
                    if (customer.phone) {
                        try {
                            device = await findDeviceByPhoneNumber(customer.phone);
                        } catch (phoneError) {
                            logger.warn(`Device not found by phone ${customer.phone}, trying PPPoE...`);
                        }
                    }

                    // Jika tidak ketemu, coba by PPPoE username
                    if (!device && customer.pppoe_username) {
                        try {
                            device = await findDeviceByPPPoE(customer.pppoe_username);
                        } catch (pppoeError) {
                            logger.warn(`Device not found by PPPoE ${customer.pppoe_username}`);
                        }
                    }

                    if (device) {
                        // Disable WAN connection di modem
                        const parameters = [
                            ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable", false, "xsd:boolean"],
                            ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Enable", false, "xsd:boolean"]
                        ];

                        await setParameterValues(device._id, parameters);
                        results.genieacs = true;
                        logger.info(`GenieACS: Successfully suspended device ${device._id} for customer ${customer.username}`);
                    } else {
                        logger.warn(`GenieACS: No device found for customer ${customer.username}`);
                    }
                } catch (genieacsError) {
                    logger.error(`GenieACS suspension failed for ${customer.username}:`, genieacsError.message);
                }
            }

            // 3. Update status di billing database
            try {
                if (customer.id) {
                    logger.info(`[SUSPEND] Updating billing status by id=${customer.id} to 'suspended' (username=${customer.username || customer.pppoe_username || '-'})`);
                    await billingManager.setCustomerStatusById(customer.id, 'suspended');
                    results.billing = true;
                } else {
                    // Resolve by username first, then phone, to obtain reliable id
                    let resolved = null;
                    if (customer.pppoe_username) {
                        try { resolved = await billingManager.getCustomerByUsername(customer.pppoe_username); } catch (_) { }
                    }
                    if (!resolved && customer.username) {
                        try { resolved = await billingManager.getCustomerByUsername(customer.username); } catch (_) { }
                    }
                    if (!resolved && customer.phone) {
                        try { resolved = await billingManager.getCustomerByPhone(customer.phone); } catch (_) { }
                    }
                    if (resolved && resolved.id) {
                        logger.info(`[SUSPEND] Resolved customer id=${resolved.id} (username=${resolved.pppoe_username || resolved.username || '-'}) → set 'suspended'`);
                        await billingManager.setCustomerStatusById(resolved.id, 'suspended');
                        results.billing = true;
                    } else if (customer.phone) {
                        logger.warn(`[SUSPEND] Falling back to update by phone=${customer.phone} (no id resolved)`);
                        await billingManager.updateCustomer(customer.phone, { ...customer, status: 'suspended' });
                        results.billing = true;
                    } else {
                        logger.error(`[SUSPEND] Unable to resolve customer identifier for status update`);
                    }
                }
            } catch (billingError) {
                logger.error(`Billing update failed for ${customer.username}:`, billingError.message);
            }

            // 4. Send WhatsApp notification
            try {
                const whatsappNotifications = require('./whatsapp-notifications');
                await whatsappNotifications.sendServiceSuspensionNotification(customer, reason);
            } catch (notificationError) {
                logger.error(`WhatsApp notification failed for ${customer.username}:`, notificationError.message);
            }

            return {
                success: results.mikrotik || results.genieacs || results.billing,
                results,
                customer: customer.username,
                reason
            };

        } catch (error) {
            logger.error(`Error suspending service for ${customer.username}:`, error);
            throw error;
        }
    }

    /**
     * Restore layanan pelanggan (aktifkan kembali internet)
     * Mendukung PPPoE dan IP statik
     */
    async restoreCustomerService(customer, reason = 'Manual restore') {
        try {
            logger.info(`Restoring service for customer: ${customer.username} (${reason})`);

            const results = {
                mikrotik: false,
                genieacs: false,
                billing: false,
                restoration_type: null
            };

            // Tentukan tipe koneksi pelanggan
            const hasPPPoE = customer.pppoe_username && customer.pppoe_username.trim();
            const hasStaticIP = customer.static_ip || customer.ip_address || customer.assigned_ip;
            const hasMacAddress = customer.mac_address;

            // 1. Prioritas restore PPPoE jika tersedia
            if (hasPPPoE) {
                results.restoration_type = 'pppoe';
                try {
                    const mikrotik = await getMikrotikConnection();

                    // Ambil profile dari customer atau package, fallback ke default
                    let profileToUse = customer.pppoe_profile;
                    if (!profileToUse) {
                        // Coba ambil dari package
                        const packageData = await billingManager.getPackageById(customer.package_id);
                        profileToUse = packageData?.pppoe_profile || getSetting('default_pppoe_profile', 'default');
                    }

                    // Cari .id secret berdasarkan name terlebih dahulu
                    let secretId = null;
                    try {
                        const secrets = await mikrotik.write('/ppp/secret/print', [
                            `?name=${customer.pppoe_username}`
                        ]);
                        if (secrets && secrets.length > 0) {
                            secretId = secrets[0]['.id'];
                        }
                    } catch (lookupErr) {
                        logger.warn(`Mikrotik: failed to lookup secret id for ${customer.pppoe_username}: ${lookupErr.message}`);
                    }

                    // Update PPPoE user dengan profile normal, gunakan .id bila tersedia, fallback ke =name=
                    const setParams = secretId
                        ? [`=.id=${secretId}`, `=profile=${profileToUse}`, `=comment=ACTIVE - ${reason}`]
                        : [`=name=${customer.pppoe_username}`, `=profile=${profileToUse}`, `=comment=ACTIVE - ${reason}`];

                    await mikrotik.write('/ppp/secret/set', setParams);
                    logger.info(`Mikrotik: Restored profile to '${profileToUse}' for ${customer.pppoe_username} (${secretId ? 'by .id' : 'by name'})`);

                    // Disconnect active session agar client reconnect dengan profile baru
                    const activeSessions = await mikrotik.write('/ppp/active/print', [
                        `?name=${customer.pppoe_username}`
                    ]);

                    if (activeSessions && activeSessions.length > 0) {
                        for (const session of activeSessions) {
                            await mikrotik.write('/ppp/active/remove', [
                                `=.id=${session['.id']}`
                            ]);
                        }
                        logger.info(`Mikrotik: Disconnected ${activeSessions.length} active session(s) for ${customer.pppoe_username} to apply new profile`);
                    }

                    results.mikrotik = true;
                    logger.info(`Mikrotik: Successfully restored PPPoE user ${customer.pppoe_username} with ${profileToUse} profile`);
                } catch (mikrotikError) {
                    logger.error(`Mikrotik PPPoE restoration failed for ${customer.username}:`, mikrotikError.message);
                }
            }
            // 2. Jika tidak ada PPPoE, coba restore IP statik
            else if (hasStaticIP || hasMacAddress) {
                results.restoration_type = 'static_ip';
                try {
                    const staticResult = await staticIPSuspension.restoreStaticIPCustomer(customer, reason);

                    if (staticResult.success) {
                        results.mikrotik = true;
                        results.static_ip_methods = staticResult.results?.methods_tried;
                        logger.info(`Static IP restoration successful for ${customer.username}. Methods: ${staticResult.results?.methods_tried?.join(', ')}`);
                    } else {
                        logger.error(`Static IP restoration failed for ${customer.username}: ${staticResult.error}`);
                    }
                } catch (staticIPError) {
                    logger.error(`Static IP restoration failed for ${customer.username}:`, staticIPError.message);
                }
            }
            // 3. Jika tidak ada PPPoE atau IP statik, coba enable WAN
            else {
                results.restoration_type = 'wan_enable';
                logger.warn(`Customer ${customer.username} has no PPPoE username or static IP, trying WAN enable method`);
            }

            // 2. Restore via GenieACS (enable WAN connection)
            if (customer.phone || customer.pppoe_username) {
                try {
                    let device = null;

                    // Coba cari device by phone number dulu
                    if (customer.phone) {
                        try {
                            device = await findDeviceByPhoneNumber(customer.phone);
                        } catch (phoneError) {
                            logger.warn(`Device not found by phone ${customer.phone}, trying PPPoE...`);
                        }
                    }

                    // Jika tidak ketemu, coba by PPPoE username
                    if (!device && customer.pppoe_username) {
                        try {
                            device = await findDeviceByPPPoE(customer.pppoe_username);
                        } catch (pppoeError) {
                            logger.warn(`Device not found by PPPoE ${customer.pppoe_username}`);
                        }
                    }

                    if (device) {
                        // Enable WAN connection di modem
                        const parameters = [
                            ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable", true, "xsd:boolean"],
                            ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Enable", true, "xsd:boolean"]
                        ];

                        await setParameterValues(device._id, parameters);
                        results.genieacs = true;
                        logger.info(`GenieACS: Successfully restored device ${device._id} for customer ${customer.username}`);
                    } else {
                        logger.warn(`GenieACS: No device found for customer ${customer.username}`);
                    }
                } catch (genieacsError) {
                    logger.error(`GenieACS restoration failed for ${customer.username}:`, genieacsError.message);
                }
            }

            // 3. Update status di billing database
            try {
                if (customer.id) {
                    logger.info(`[RESTORE] Updating billing status by id=${customer.id} to 'active' (username=${customer.username || customer.pppoe_username || '-'})`);
                    await billingManager.setCustomerStatusById(customer.id, 'active');
                    results.billing = true;
                } else {
                    // Resolve by username first, then phone
                    let resolved = null;
                    if (customer.pppoe_username) {
                        try { resolved = await billingManager.getCustomerByUsername(customer.pppoe_username); } catch (_) { }
                    }
                    if (!resolved && customer.username) {
                        try { resolved = await billingManager.getCustomerByUsername(customer.username); } catch (_) { }
                    }
                    if (!resolved && customer.phone) {
                        try { resolved = await billingManager.getCustomerByPhone(customer.phone); } catch (_) { }
                    }
                    if (resolved && resolved.id) {
                        logger.info(`[RESTORE] Resolved customer id=${resolved.id} (username=${resolved.pppoe_username || resolved.username || '-'}) → set 'active'`);
                        await billingManager.setCustomerStatusById(resolved.id, 'active');
                        results.billing = true;
                    } else if (customer.phone) {
                        logger.warn(`[RESTORE] Falling back to update by phone=${customer.phone} (no id resolved)`);
                        await billingManager.updateCustomer(customer.phone, { ...customer, status: 'active' });
                        results.billing = true;
                    } else {
                        logger.error(`[RESTORE] Unable to resolve customer identifier for status update`);
                    }
                }
            } catch (billingError) {
                logger.error(`Billing restore update failed for ${customer.username}:`, billingError.message);
            }

            // 4. Send WhatsApp notification
            try {
                const whatsappNotifications = require('./whatsapp-notifications');
                await whatsappNotifications.sendServiceRestorationNotification(customer, reason);
            } catch (notificationError) {
                logger.error(`WhatsApp notification failed for ${customer.username}:`, notificationError.message);
            }

            return {
                success: results.mikrotik || results.genieacs || results.billing,
                results,
                customer: customer.username,
                reason
            };

        } catch (error) {
            logger.error(`Error restoring service for ${customer.username}:`, error);
            throw error;
        }
    }

    /**
     * Check dan suspend pelanggan yang telat bayar otomatis
     */
    async checkAndSuspendOverdueCustomers() {
        if (this.isRunning) {
            logger.info('Service suspension check already running, skipping...');
            return;
        }

        try {
            this.isRunning = true;
            logger.info('Starting automatic service suspension check...');

            // Ambil pengaturan grace period
            const gracePeriodDays = parseInt(getSetting('suspension_grace_period_days', '7'));
            const autoSuspensionEnabled = getSetting('auto_suspension_enabled', 'true') === 'true';

            if (!autoSuspensionEnabled) {
                logger.info('Auto suspension is disabled in settings');
                return;
            }

            // Ambil tagihan yang overdue
            const overdueInvoices = await billingManager.getOverdueInvoices();

            const results = {
                checked: 0,
                suspended: 0,
                errors: 0,
                details: []
            };

            for (const invoice of overdueInvoices) {
                results.checked++;

                try {
                    // Hitung berapa hari telat
                    const dueDate = new Date(invoice.due_date);
                    const today = new Date();
                    const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

                    // Skip jika belum melewati grace period
                    if (daysOverdue < gracePeriodDays) {
                        logger.info(`Customer ${invoice.customer_name} overdue ${daysOverdue} days, grace period ${gracePeriodDays} days - skipping`);
                        continue;
                    }

                    // Ambil data customer
                    const customer = await billingManager.getCustomerById(invoice.customer_id);
                    if (!customer) {
                        logger.warn(`Customer not found for invoice ${invoice.invoice_number}`);
                        continue;
                    }

                    // Skip jika sudah suspended
                    if (customer.status === 'suspended') {
                        logger.info(`Customer ${customer.username} already suspended - skipping`);
                        continue;
                    }

                    // Skip jika auto_suspension = 0 (tidak diisolir otomatis)
                    if (customer.auto_suspension === 0) {
                        logger.info(`Customer ${customer.username} has auto_suspension disabled - skipping`);
                        continue;
                    }

                    // Suspend layanan
                    const suspensionResult = await this.suspendCustomerService(customer, `Telat bayar ${daysOverdue} hari`);

                    if (suspensionResult.success) {
                        results.suspended++;
                        results.details.push({
                            customer: customer.username,
                            invoice: invoice.invoice_number,
                            daysOverdue,
                            status: 'suspended'
                        });
                        logger.info(`Successfully suspended service for ${customer.username} (${daysOverdue} days overdue)`);
                    } else {
                        results.errors++;
                        results.details.push({
                            customer: customer.username,
                            invoice: invoice.invoice_number,
                            daysOverdue,
                            status: 'failed'
                        });
                        logger.error(`Failed to suspend service for ${customer.username}`);
                    }

                } catch (customerError) {
                    results.errors++;
                    logger.error(`Error processing customer for invoice ${invoice.invoice_number}:`, customerError);
                }
            }

            logger.info(`Service suspension check completed. Checked: ${results.checked}, Suspended: ${results.suspended}, Errors: ${results.errors}`);
            return results;

        } catch (error) {
            logger.error('Error in automatic service suspension check:', error);
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Check dan restore pelanggan yang sudah bayar
     */
    async checkAndRestorePaidCustomers() {
        try {
            logger.info('Starting automatic service restoration check...');

            // Ambil semua customer yang suspended
            const customers = await billingManager.getCustomers();
            const suspendedCustomers = customers.filter(c => c.status === 'suspended');

            const results = {
                checked: suspendedCustomers.length,
                restored: 0,
                errors: 0,
                details: []
            };

            for (const customer of suspendedCustomers) {
                try {
                    // Cek apakah customer punya tagihan yang belum dibayar
                    const invoices = await billingManager.getInvoicesByCustomer(customer.id);
                    const unpaidInvoices = invoices.filter(i => i.status === 'unpaid');

                    // Jika tidak ada tagihan yang belum dibayar, restore layanan
                    if (unpaidInvoices.length === 0) {
                        const restorationResult = await this.restoreCustomerService(customer);

                        if (restorationResult.success) {
                            results.restored++;
                            results.details.push({
                                customer: customer.username,
                                status: 'restored'
                            });
                            logger.info(`Successfully restored service for ${customer.username}`);
                        } else {
                            results.errors++;
                            results.details.push({
                                customer: customer.username,
                                status: 'failed'
                            });
                            logger.error(`Failed to restore service for ${customer.username}`);
                        }
                    } else {
                        logger.info(`Customer ${customer.username} still has ${unpaidInvoices.length} unpaid invoices - keeping suspended`);
                    }

                } catch (customerError) {
                    results.errors++;
                    logger.error(`Error processing suspended customer ${customer.username}:`, customerError);
                }
            }

            logger.info(`Service restoration check completed. Checked: ${results.checked}, Restored: ${results.restored}, Errors: ${results.errors}`);
            return results;

        } catch (error) {
            logger.error('Error in automatic service restoration check:', error);
            throw error;
        }
    }
}

// Create singleton instance
const serviceSuspensionManager = new ServiceSuspensionManager();

module.exports = serviceSuspensionManager;
