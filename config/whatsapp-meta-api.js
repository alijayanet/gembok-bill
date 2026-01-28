const axios = require('axios');
const logger = require('./logger');

class WhatsAppMetaAPI {
    constructor() {
        this.apiKey = null;
        this.phoneNumberId = null;
        this.baseUrl = 'https://graph.facebook.com/v18.0';
        this.webhookUrl = null;
        this.verifyToken = null;
        this.isConnected = false;
        this.phoneNumber = null;
    }

    /**
     * Initialize WhatsApp Meta API with credentials
     */
    initialize(config) {
        this.apiKey = config.apiKey;
        this.phoneNumberId = config.phoneNumberId;
        this.webhookUrl = config.webhookUrl;
        this.verifyToken = config.verifyToken;
        this.baseUrl = config.baseUrl || 'https://graph.facebook.com/v18.0';

        if (!this.apiKey || !this.phoneNumberId) {
            logger.warn('WhatsApp Meta API: Missing required credentials (apiKey or phoneNumberId)');
            return false;
        }

        logger.info('WhatsApp Meta API initialized successfully');
        return true;
    }

    /**
     * Connect to WhatsApp Meta API
     */
    async connect() {
        try {
            // Verify credentials by testing API
            const response = await axios.get(
                `${this.baseUrl}/${this.phoneNumberId}`,
                {
                    params: {
                        fields: 'verified_name,display_phone_number',
                        access_token: this.apiKey
                    }
                }
            );

            if (response.data && response.data.verified_name) {
                this.isConnected = true;
                this.phoneNumber = response.data.display_phone_number;
                logger.info(`WhatsApp Meta API connected successfully: ${response.data.verified_name}`);
                return true;
            }

            return false;
        } catch (error) {
            logger.error('WhatsApp Meta API connection failed:', error.message);
            this.isConnected = false;
            return false;
        }
    }

    /**
     * Send text message
     */
    async sendMessage(phoneNumber, message) {
        try {
            const formattedPhone = this.formatPhoneNumber(phoneNumber);
            
            const response = await axios.post(
                `${this.baseUrl}/${this.phoneNumberId}/messages`,
                {
                    messaging_product: 'whatsapp',
                    to: formattedPhone,
                    type: 'text',
                    text: {
                        body: message
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data && response.data.messages && response.data.messages[0]) {
                logger.info(`WhatsApp Meta API: Message sent to ${formattedPhone}, ID: ${response.data.messages[0].id}`);
                return { success: true, messageId: response.data.messages[0].id };
            }

            return { success: false, error: 'No message ID returned' };
        } catch (error) {
            logger.error('WhatsApp Meta API: Failed to send message:', error.response?.data || error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Send media message (image, document, etc.)
     */
    async sendMedia(phoneNumber, mediaUrl, mediaType = 'image', caption = '') {
        try {
            const formattedPhone = this.formatPhoneNumber(phoneNumber);
            
            const response = await axios.post(
                `${this.baseUrl}/${this.phoneNumberId}/messages`,
                {
                    messaging_product: 'whatsapp',
                    to: formattedPhone,
                    type: mediaType,
                    [mediaType]: {
                        link: mediaUrl,
                        caption: caption
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data && response.data.messages && response.data.messages[0]) {
                logger.info(`WhatsApp Meta API: Media sent to ${formattedPhone}, ID: ${response.data.messages[0].id}`);
                return { success: true, messageId: response.data.messages[0].id };
            }

            return { success: false, error: 'No message ID returned' };
        } catch (error) {
            logger.error('WhatsApp Meta API: Failed to send media:', error.response?.data || error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Send template message
     */
    async sendTemplate(phoneNumber, templateName, components = []) {
        try {
            const formattedPhone = this.formatPhoneNumber(phoneNumber);
            
            const response = await axios.post(
                `${this.baseUrl}/${this.phoneNumberId}/messages`,
                {
                    messaging_product: 'whatsapp',
                    to: formattedPhone,
                    type: 'template',
                    template: {
                        name: templateName,
                        language: { code: 'id' },
                        components: components
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data && response.data.messages && response.data.messages[0]) {
                logger.info(`WhatsApp Meta API: Template sent to ${formattedPhone}, ID: ${response.data.messages[0].id}`);
                return { success: true, messageId: response.data.messages[0].id };
            }

            return { success: false, error: 'No message ID returned' };
        } catch (error) {
            logger.error('WhatsApp Meta API: Failed to send template:', error.response?.data || error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Format phone number for Meta API (must start with country code without +)
     */
    formatPhoneNumber(phoneNumber) {
        let phone = String(phoneNumber || '').replace(/\D/g, '');
        
        // Remove leading + or 00
        if (phone.startsWith('+')) phone = phone.substring(1);
        if (phone.startsWith('00')) phone = phone.substring(2);
        
        // If starts with 0, replace with country code (default Indonesia 62)
        if (phone.startsWith('0')) {
            phone = '62' + phone.substring(1);
        }
        
        return phone;
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            connected: this.isConnected,
            phoneNumber: this.phoneNumber,
            provider: 'meta_api',
            status: this.isConnected ? 'connected' : 'disconnected'
        };
    }

    /**
     * Disconnect
     */
    disconnect() {
        this.isConnected = false;
        this.phoneNumber = null;
        logger.info('WhatsApp Meta API disconnected');
    }
}

// Create singleton instance
const metaAPI = new WhatsAppMetaAPI();

module.exports = metaAPI;
