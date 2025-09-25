#!/usr/bin/env node

/**
 * Script untuk menjalankan perbaikan duplikasi pembayaran
 * Jalankan dengan: node scripts/run-payment-fix.js
 */

const fixPaymentDuplication = require('./fix-payment-duplication');
const logger = require('../config/logger');

async function runPaymentFix() {
    try {
        console.log('🚀 Starting Payment Duplication Fix...');
        console.log('=' .repeat(50));
        
        // Run the fix
        await fixPaymentDuplication();
        
        console.log('=' .repeat(50));
        console.log('✅ Payment duplication fix completed successfully!');
        console.log('');
        console.log('📋 Summary of changes:');
        console.log('   - Added collector_id, commission_amount, payment_type columns to payments table');
        console.log('   - Removed duplicate payments between collector_payments and payments tables');
        console.log('   - Migrated collector_payments data to unified payments table');
        console.log('   - Updated payment types (direct, collector, online, manual)');
        console.log('');
        console.log('🎯 Next steps:');
        console.log('   1. Test collector payment functionality');
        console.log('   2. Verify reports show correct data');
        console.log('   3. Monitor for any issues');
        console.log('');
        console.log('⚠️  Important:');
        console.log('   - Backup your database before running this script');
        console.log('   - Test in development environment first');
        console.log('   - Monitor application logs after deployment');
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Payment duplication fix failed:', error);
        logger.error('Payment duplication fix failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    runPaymentFix();
}

module.exports = runPaymentFix;
