const express = require('express');
const router = express.Router();
const billingManager = require('../config/billing');
const serviceSuspension = require('../config/serviceSuspension');
const fs = require('fs');

// Load settings
function loadSettings() {
    try {
        const { getSettingsWithCache } = require('../config/settingsManager');
        return getSettingsWithCache();
    } catch (error) {
        console.error('Error loading settings:', error);
        return {};
    }
}

// Create online payment
router.post('/create', async (req, res) => {
    try {
        const { invoice_id, gateway } = req.body;
        
        if (!invoice_id) {
            return res.status(400).json({
                success: false,
                message: 'Invoice ID is required'
            });
        }
        
        // Fetch invoice to perform gateway-specific validations
        let invoice;
        try {
            invoice = await billingManager.getInvoiceById(invoice_id);
        } catch (e) {
            return res.status(500).json({ success: false, message: 'Failed to load invoice' });
        }
        if (!invoice) {
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }

        // Check if invoice is already paid
        if (invoice.status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Invoice sudah dibayar'
            });
        }

        // Note: Tripay minimum amount validation removed for production
        // In production mode, Tripay doesn't have minimum amount restriction

        const result = await billingManager.createOnlinePayment(invoice_id, gateway);
        
        res.json({
            success: true,
            message: 'Payment created successfully',
            data: result
        });
    } catch (error) {
        console.error('Error creating payment:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create payment'
        });
    }
});

// Payment webhook handlers
router.post('/webhook/midtrans', async (req, res) => {
    try {
        console.log('🔍 Midtrans webhook received:', JSON.stringify(req.body, null, 2));
        const result = await billingManager.handlePaymentWebhook({ body: req.body, headers: req.headers }, 'midtrans');
        console.log('✅ Midtrans webhook processed successfully:', result);
        res.status(200).json(result);
    } catch (error) {
        console.error('❌ Midtrans webhook error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/webhook/xendit', async (req, res) => {
    try {
        console.log('🔍 Xendit webhook received:', JSON.stringify(req.body, null, 2));
        const result = await billingManager.handlePaymentWebhook({ body: req.body, headers: req.headers }, 'xendit');
        console.log('✅ Xendit webhook processed successfully:', result);
        res.status(200).json(result);
    } catch (error) {
        console.error('❌ Xendit webhook error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/webhook/tripay', async (req, res) => {
    try {
        console.log('🔍 Universal webhook received:', JSON.stringify(req.body, null, 2));
        
        // Check if this is a voucher payment based on order_id pattern
        const orderId = req.body.order_id || req.body.merchant_ref || '';
        const isVoucherPayment = orderId.includes('VCR-') || orderId.includes('VOUCHER-');
        
        if (isVoucherPayment) {
            console.log('🎫 Detected voucher payment, processing voucher webhook');
            
            // Import voucher webhook handler function directly
            const { handleVoucherWebhook } = require('./publicVoucher');
            
            // Call voucher webhook handler directly
            try {
                const result = await handleVoucherWebhook(req.body, req.headers);
                console.log('🎫 Voucher webhook response:', result);
                res.status(200).json(result);
            } catch (voucherError) {
                console.error('🎫 Voucher webhook error:', voucherError);
                res.status(500).json({
                    success: false,
                    message: 'Voucher webhook processing failed: ' + voucherError.message
                });
            }
        } else {
            console.log('💰 Processing invoice payment');
            const result = await billingManager.handlePaymentWebhook({ body: req.body, headers: req.headers }, 'tripay');
            res.status(200).json(result);
        }
    } catch (error) {
        console.error('Universal webhook error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Manual payment processing (fallback for failed webhooks)
router.post('/manual-process', async (req, res) => {
    try {
        const { invoice_id, payment_method, reference_number, notes } = req.body;
        
        if (!invoice_id) {
            return res.status(400).json({
                success: false,
                message: 'Invoice ID is required'
            });
        }

        // Get invoice details
        const invoice = await billingManager.getInvoiceById(invoice_id);
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found'
            });
        }

        // Check if invoice is already paid
        if (invoice.status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Invoice is already paid'
            });
        }

        // Process payment like WhatsApp admin
        const paymentData = {
            invoice_id: parseInt(invoice_id),
            amount: invoice.amount,
            payment_method: payment_method || 'manual',
            reference_number: reference_number || `MANUAL_${Date.now()}`,
            notes: notes || 'Manual payment processing via web'
        };

        // Record payment
        const paymentResult = await billingManager.recordPayment(paymentData);
        
        if (paymentResult && paymentResult.success) {
            // Update invoice status
            await billingManager.updateInvoiceStatus(invoice_id, 'paid', payment_method || 'manual');
            
            // Get customer info for notification
            const customer = await billingManager.getCustomerById(invoice.customer_id);
            
            // Send WhatsApp notification
            try {
                await billingManager.sendPaymentSuccessNotification(customer, invoice);
            } catch (notificationError) {
                console.error('Error sending notification:', notificationError);
            }
            
            res.json({
                success: true,
                message: 'Payment processed successfully',
                data: {
                    payment_id: paymentResult.id,
                    invoice_id: invoice_id,
                    status: 'paid',
                    payment_method: payment_method || 'manual'
                }
            });

            // Attempt immediate restore if eligible
            try {
                const refreshedCustomer = await billingManager.getCustomerById(invoice.customer_id);
                const customerInvoices = await billingManager.getInvoicesByCustomer(invoice.customer_id);
                const unpaid = customerInvoices.filter(i => i.status === 'unpaid');
                if (refreshedCustomer && refreshedCustomer.status === 'suspended' && unpaid.length === 0) {
                    await serviceSuspension.restoreCustomerService(refreshedCustomer);
                }
            } catch (restoreErr) {
                console.error('Immediate restore check failed:', restoreErr);
            }
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to process payment'
            });
        }
    } catch (error) {
        console.error('Error in manual payment processing:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to process payment'
        });
    }
});

// Check payment status
router.get('/status/:invoice_id', async (req, res) => {
    try {
        const { invoice_id } = req.params;
        
        const invoice = await billingManager.getInvoiceById(invoice_id);
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found'
            });
        }

        // Get payment transactions
        const transactions = await billingManager.getPaymentTransactions(invoice_id);
        
        res.json({
            success: true,
            data: {
                invoice: {
                    id: invoice.id,
                    invoice_number: invoice.invoice_number,
                    amount: invoice.amount,
                    status: invoice.status,
                    due_date: invoice.due_date,
                    payment_method: invoice.payment_method,
                    payment_gateway: invoice.payment_gateway,
                    payment_status: invoice.payment_status
                },
                transactions: transactions,
                is_paid: invoice.status === 'paid'
            }
        });
    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to check payment status'
        });
    }
});

// Payment callback pages
router.get('/finish', (req, res) => {
    const settings = loadSettings();
    res.render('payment/finish', {
        title: 'Payment Finish',
        appSettings: settings,
        status: req.query.status || 'success',
        order_id: req.query.order_id,
        transaction_status: req.query.transaction_status
    });
});

router.get('/error', (req, res) => {
    const settings = loadSettings();
    res.render('payment/error', {
        title: 'Payment Error',
        appSettings: settings,
        error_message: req.query.error_message || 'Payment failed'
    });
});

router.get('/pending', (req, res) => {
    const settings = loadSettings();
    res.render('payment/pending', {
        title: 'Payment Pending',
        appSettings: settings,
        order_id: req.query.order_id
    });
});

// Get payment transactions
router.get('/transactions', async (req, res) => {
    try {
        const { invoice_id } = req.query;
        const transactions = await billingManager.getPaymentTransactions(invoice_id);
        
        res.json({
            success: true,
            data: transactions
        });
    } catch (error) {
        console.error('Error getting transactions:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get gateway status
router.get('/gateway-status', async (req, res) => {
    try {
        const status = await billingManager.getGatewayStatus();
        
        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Error getting gateway status:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router; 