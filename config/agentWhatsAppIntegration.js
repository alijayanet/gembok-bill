const AgentWhatsAppCommands = require('./agentWhatsAppCommands');

class AgentWhatsAppIntegration {
    constructor(whatsappGateway) {
        this.commands = new AgentWhatsAppCommands();
        this.whatsappGateway = whatsappGateway;
    }

    // Initialize WhatsApp integration
    initialize() {
        console.log('🤖 Initializing Agent WhatsApp Commands...');
        
        try {
            // Check if whatsappGateway has the required methods
            if (!this.whatsappGateway || typeof this.whatsappGateway.connectToWhatsApp !== 'function') {
                console.log('⚠️ WhatsApp gateway not properly initialized, using mock mode');
                return;
            }
            
            // Get the socket instance from whatsapp gateway
            const sock = this.whatsappGateway.getSock ? this.whatsappGateway.getSock() : null;
            
            if (!sock || !sock.ev) {
                console.log('⚠️ WhatsApp socket not available, using mock mode');
                return;
            }
            
            // Don't register our own event listener - let main handler call us
            console.log('🤖 Agent WhatsApp Integration ready (no direct event listener)');

            console.log('✅ Agent WhatsApp Commands initialized successfully');
        } catch (error) {
            console.error('❌ Error initializing Agent WhatsApp Commands:', error);
        }
    }

    // Method to be called from main handler
    async handleIncomingMessage(message, from, text) {
        try {
            console.log(`📱 [AGENT] Received message from ${from}: ${text}`);
            
            // Check if this is an admin command first
            const { getSetting } = require('./settingsManager');
            const adminNumbers = [];
            let i = 0;
            while (true) {
                const adminNum = getSetting(`admins.${i}`);
                if (!adminNum) break;
                adminNumbers.push(adminNum);
                i++;
            }
            
            const senderNumber = from.replace('@s.whatsapp.net', '');
            const isAdmin = adminNumbers.includes(senderNumber);
            
            console.log(`📱 [AGENT] DEBUG: senderNumber=${senderNumber}, isAdmin=${isAdmin}, adminNumbers=${JSON.stringify(adminNumbers)}, text=${text}`);
            
            // If admin, skip agent handler completely
            if (isAdmin) {
                console.log(`📱 [AGENT] Admin detected, skipping agent handler for ALL commands: ${text}`);
                return false; // Let main handler process it
            }
            
            // Handle agent commands
            // Extract phone number from from parameter
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
            
            const response = await this.commands.handleMessage(phoneNumber, text);
            
            // Only mark as processed if a response was actually sent
            if (response !== null) {
                // Mark message as processed to prevent main handler from processing it
                message._agentProcessed = true;
                console.log(`📤 [AGENT] DEBUG: Response from commands: ${response}, type: ${typeof response}`);
                // Commands already handle sending messages, so we don't need to send again
                // Just mark as processed to prevent main handler from processing
                return true; // Message processed by agent handler
            } else {
                // If no response was sent, let the main handler process the message
                console.log(`📤 [AGENT] No response sent, allowing main handler to process`);
                return false; // Let main handler process it
            }
        } catch (error) {
            console.error('Error processing agent WhatsApp message:', error);
            return false;
        }
    }

    // Send message via WhatsApp gateway
    async sendMessage(to, message) {
        try {
            // Ensure message is a string
            const messageText = typeof message === 'string' ? message : String(message);
            
            // Try to get socket from whatsapp gateway
            let sock = null;
            console.log(`📤 [AGENT] DEBUG: whatsappGateway exists: ${!!this.whatsappGateway}`);
            console.log(`📤 [AGENT] DEBUG: whatsappGateway.getSock exists: ${!!(this.whatsappGateway && this.whatsappGateway.getSock)}`);
            
            if (this.whatsappGateway && this.whatsappGateway.getSock) {
                sock = this.whatsappGateway.getSock();
                console.log(`📤 [AGENT] DEBUG: Got socket from gateway: ${!!sock}`);
            }
            
            // If no socket from gateway, try to get from whatsapp gateway passed in constructor
            if (!sock && this.whatsappGateway) {
                try {
                    sock = this.whatsappGateway.getSock ? this.whatsappGateway.getSock() : null;
                    console.log(`📤 [AGENT] DEBUG: Got socket from gateway (retry): ${!!sock}`);
                } catch (e) {
                    console.log('Could not get socket from whatsapp gateway');
                }
            }
            
            if (sock && sock.sendMessage) {
                await sock.sendMessage(to, { text: messageText });
                console.log(`📤 [AGENT] Sent message to ${to}: ${messageText}`);
                return true;
            } else {
                console.log(`📤 [AGENT] [MOCK] Would send to ${to}: ${messageText}`);
                return true;
            }
        } catch (error) {
            console.error('Error sending WhatsApp message:', error);
            return false;
        }
    }

    // Test agent commands
    async testCommands() {
        console.log('🧪 Testing Agent WhatsApp Commands...');
        
        const testPhone = '081234567890@s.whatsapp.net';
        
        // Test help command
        console.log('Testing HELP command...');
        await this.commands.handleMessage(testPhone, 'HELP');
        
        // Test saldo command
        console.log('Testing SALDO command...');
        await this.commands.handleMessage(testPhone, 'SALDO');
        
        // Test jual command
        console.log('Testing JUAL command...');
        await this.commands.handleMessage(testPhone, 'JUAL 10K John 081234567890 YA');
        
        // Test bayar command
        console.log('Testing BAYAR command...');
        await this.commands.handleMessage(testPhone, 'BAYAR Jane 081234567891 50000 YA');
        
        // Test request command
        console.log('Testing REQUEST command...');
        await this.commands.handleMessage(testPhone, 'REQUEST 100000 Top up saldo');
        
        // Test riwayat command
        console.log('Testing RIWAYAT command...');
        await this.commands.handleMessage(testPhone, 'RIWAYAT');
        
        console.log('✅ Agent WhatsApp Commands test completed');
    }
}

module.exports = AgentWhatsAppIntegration;
