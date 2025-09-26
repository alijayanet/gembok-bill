#!/usr/bin/env node

/**
 * Script test untuk auto setup GenieACS DNS
 */

const { runAutoSetup } = require('./auto-genieacs-dns-dev');
const { autoGenieACSSetup } = require('../config/autoGenieACSSetup');

async function testAutoSetup() {
    try {
        console.log('🧪 TESTING AUTO GENIEACS DNS SETUP');
        console.log('=' .repeat(50));

        // Test 1: Cek status setup
        console.log('📋 Test 1: Cek status setup...');
        const status = autoGenieACSSetup.getSetupStatus();
        console.log('Status:', status);

        // Test 2: Jalankan auto setup
        console.log('\n📋 Test 2: Jalankan auto setup...');
        const result = await runAutoSetup();

        if (result.success) {
            console.log('✅ Auto setup berhasil!');
            console.log(`📋 IP Server: ${result.serverIP}`);
            console.log(`📋 GenieACS URL: ${result.genieacsUrl}`);
            console.log(`📋 DNS Server: ${result.dnsServer}`);
            console.log(`📋 Script Mikrotik: ${result.mikrotikScript}`);
            
            if (result.dnsResult) {
                console.log(`📋 DNS ONU: ${result.dnsResult.successCount} device dikonfigurasi`);
            }
        } else {
            console.log('❌ Auto setup gagal:', result.error);
        }

        // Test 3: Cek status setelah setup
        console.log('\n📋 Test 3: Cek status setelah setup...');
        const statusAfter = autoGenieACSSetup.getSetupStatus();
        console.log('Status setelah setup:', statusAfter);

        return result;

    } catch (error) {
        console.error('❌ Error dalam test:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Run if called directly
if (require.main === module) {
    testAutoSetup()
        .then((result) => {
            if (result.success) {
                console.log('\n🎉 Test berhasil!');
            } else {
                console.log('\n❌ Test gagal:', result.error);
            }
            process.exit(result.success ? 0 : 1);
        })
        .catch((error) => {
            console.error('\n❌ Test error:', error);
            process.exit(1);
        });
}

module.exports = { testAutoSetup };
