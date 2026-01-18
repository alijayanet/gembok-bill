#!/usr/bin/env node

/**
 * Test Admin Pages - Script untuk menguji apakah halaman admin dapat diakses
 */

const http = require('http');

async function testAdminPage(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3005,
            path: path,
            method: 'GET',
            headers: {
                'Cookie': 'admin_auth=mock_admin_session' // Mock session cookie
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    data: data
                });
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.end();
    });
}

async function testAdminPages() {
    console.log('🔍 Testing admin pages accessibility...\n');
    
    try {
        // Test technicians page
        console.log('🔧 Testing /admin/technicians page...');
        const techniciansResponse = await testAdminPage('/admin/technicians');
        console.log(`   Status Code: ${techniciansResponse.statusCode}`);
        if (techniciansResponse.statusCode === 200) {
            console.log('   ✅ Technicians page is accessible');
        } else if (techniciansResponse.statusCode === 500) {
            console.log('   ❌ Technicians page returns Internal Server Error');
            // Check if it's the join_date error
            if (techniciansResponse.data.includes('join_date')) {
                console.log('   ℹ️  Error is related to join_date column');
            }
        } else {
            console.log(`   ⚠️  Technicians page returns status ${techniciansResponse.statusCode}`);
        }
        
        console.log('');
        
        // Test installations page
        console.log('🔧 Testing /admin/installations page...');
        const installationsResponse = await testAdminPage('/admin/installations');
        console.log(`   Status Code: ${installationsResponse.statusCode}`);
        if (installationsResponse.statusCode === 200) {
            console.log('   ✅ Installations page is accessible');
        } else if (installationsResponse.statusCode === 500) {
            console.log('   ❌ Installations page returns Internal Server Error');
        } else {
            console.log(`   ⚠️  Installations page returns status ${installationsResponse.statusCode}`);
        }
        
        console.log('\n🎉 Admin pages test completed!');
        
    } catch (error) {
        console.error('❌ Error testing admin pages:', error.message);
    }
}

// Run if called directly
if (require.main === module) {
    testAdminPages()
        .then(() => {
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Admin pages test failed:', error);
            process.exit(1);
        });
}

module.exports = testAdminPages;