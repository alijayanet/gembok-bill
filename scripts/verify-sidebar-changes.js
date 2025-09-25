const fs = require('fs');
const path = require('path');

function verifySidebarChanges() {
    console.log('🔍 Verifying sidebar changes...');
    
    try {
        const sidebarPath = path.join(__dirname, '../views/partials/billing-sidebar.ejs');
        const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');
        
        console.log('\n📋 Checking for new menu items:');
        
        // Check for "Transaksi Kolektor" menu
        if (sidebarContent.includes('href="/admin/billing/payments"') && 
            sidebarContent.includes('Transaksi Kolektor')) {
            console.log('✅ "Transaksi Kolektor" menu found');
        } else {
            console.log('❌ "Transaksi Kolektor" menu not found');
        }
        
        // Check for "Riwayat Pembayaran" menu
        if (sidebarContent.includes('href="/admin/billing/all-payments"') && 
            sidebarContent.includes('Riwayat Pembayaran')) {
            console.log('✅ "Riwayat Pembayaran" menu found');
        } else {
            console.log('❌ "Riwayat Pembayaran" menu not found');
        }
        
        // Check for descriptions
        if (sidebarContent.includes('Hanya transaksi tukang tagih')) {
            console.log('✅ Description for "Transaksi Kolektor" found');
        } else {
            console.log('❌ Description for "Transaksi Kolektor" not found');
        }
        
        if (sidebarContent.includes('Semua pembayaran (admin + kolektor)')) {
            console.log('✅ Description for "Riwayat Pembayaran" found');
        } else {
            console.log('❌ Description for "Riwayat Pembayaran" not found');
        }
        
        // Check for icons
        if (sidebarContent.includes('bx-user-check') && sidebarContent.includes('Transaksi Kolektor')) {
            console.log('✅ Icon for "Transaksi Kolektor" found (bx-user-check)');
        } else {
            console.log('❌ Icon for "Transaksi Kolektor" not found');
        }
        
        if (sidebarContent.includes('bx-credit-card') && sidebarContent.includes('Riwayat Pembayaran')) {
            console.log('✅ Icon for "Riwayat Pembayaran" found (bx-credit-card)');
        } else {
            console.log('❌ Icon for "Riwayat Pembayaran" not found');
        }
        
        // Check for Tukang Tagih icon change
        if (sidebarContent.includes('bx-group') && sidebarContent.includes('Tukang Tagih')) {
            console.log('✅ Icon for "Tukang Tagih" changed to bx-group');
        } else {
            console.log('❌ Icon for "Tukang Tagih" not changed');
        }
        
        console.log('\n🎉 Sidebar changes verification completed!');
        console.log('\n📊 Summary:');
        console.log('   - "Transaksi Kolektor" → /admin/billing/payments (collector transactions only)');
        console.log('   - "Riwayat Pembayaran" → /admin/billing/all-payments (all payments)');
        console.log('   - Clear descriptions added for each menu');
        console.log('   - Icons updated to avoid conflicts');
        
    } catch (error) {
        console.error('❌ Error verifying sidebar changes:', error);
    }
}

// Run if called directly
if (require.main === module) {
    verifySidebarChanges();
}

module.exports = verifySidebarChanges;
