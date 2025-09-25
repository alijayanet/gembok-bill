const express = require('express');
const path = require('path');

async function testAllPaymentsRoute() {
    console.log('🔧 Testing /admin/billing/all-payments route...');
    
    try {
        // Test if the route file can be loaded
        console.log('\n📋 Loading adminBilling.js routes...');
        
        const adminBillingPath = path.join(__dirname, '../routes/adminBilling.js');
        console.log(`   - Route file path: ${adminBillingPath}`);
        
        // Check if file exists
        const fs = require('fs');
        if (fs.existsSync(adminBillingPath)) {
            console.log('   ✅ Route file exists');
        } else {
            console.log('   ❌ Route file does not exist');
            return;
        }
        
        // Check route content
        const routeContent = fs.readFileSync(adminBillingPath, 'utf8');
        
        if (routeContent.includes("router.get('/all-payments'")) {
            console.log('   ✅ Route /all-payments found in file');
        } else {
            console.log('   ❌ Route /all-payments not found in file');
        }
        
        if (routeContent.includes('billingManager.getPayments()')) {
            console.log('   ✅ getPayments() method call found');
        } else {
            console.log('   ❌ getPayments() method call not found');
        }
        
        // Check if there are any syntax errors
        try {
            // Try to require the route file
            delete require.cache[require.resolve('../routes/adminBilling.js')];
            const adminBillingRoutes = require('../routes/adminBilling.js');
            console.log('   ✅ Route file can be loaded without syntax errors');
        } catch (error) {
            console.log('   ❌ Error loading route file:', error.message);
        }
        
        // Check middleware
        if (routeContent.includes('getAppSettings')) {
            console.log('   ✅ getAppSettings middleware found');
        } else {
            console.log('   ❌ getAppSettings middleware not found');
        }
        
        console.log('\n💡 Possible solutions:');
        console.log('   1. Restart the application server');
        console.log('   2. Clear node_modules cache');
        console.log('   3. Check if there are route conflicts');
        console.log('   4. Verify the route is properly exported');
        
        // Check route order
        const routeLines = routeContent.split('\n');
        let paymentsRouteLine = -1;
        let allPaymentsRouteLine = -1;
        
        routeLines.forEach((line, index) => {
            if (line.includes("router.get('/payments'")) {
                paymentsRouteLine = index;
            }
            if (line.includes("router.get('/all-payments'")) {
                allPaymentsRouteLine = index;
            }
        });
        
        console.log('\n📊 Route order check:');
        console.log(`   - /payments route at line: ${paymentsRouteLine + 1}`);
        console.log(`   - /all-payments route at line: ${allPaymentsRouteLine + 1}`);
        
        if (allPaymentsRouteLine > paymentsRouteLine) {
            console.log('   ✅ Route order is correct (/all-payments after /payments)');
        } else {
            console.log('   ⚠️  Route order might be incorrect');
        }
        
    } catch (error) {
        console.error('❌ Error testing route:', error);
    }
}

// Run if called directly
if (require.main === module) {
    testAllPaymentsRoute();
}

module.exports = testAllPaymentsRoute;
