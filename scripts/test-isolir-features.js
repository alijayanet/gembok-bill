const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function testIsolirFeatures() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Testing Isolir Features...\n');
        
        // Test 1: Check database structure for suspension
        console.log('📊 1. Checking database structure...');
        const tables = await new Promise((resolve, reject) => {
            db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(row => row.name));
            });
        });
        
        const requiredTables = ['customers', 'invoices', 'payments'];
        const missingTables = requiredTables.filter(table => !tables.includes(table));
        
        if (missingTables.length === 0) {
            console.log('   ✅ All required tables exist');
        } else {
            console.log(`   ❌ Missing tables: ${missingTables.join(', ')}`);
        }
        
        // Test 2: Check customers table structure
        console.log('\n📋 2. Checking customers table structure...');
        const customerColumns = await new Promise((resolve, reject) => {
            db.all("PRAGMA table_info(customers)", (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(row => row.name));
            });
        });
        
        const requiredCustomerColumns = ['id', 'username', 'name', 'status', 'pppoe_username', 'static_ip', 'mac_address'];
        const missingCustomerColumns = requiredCustomerColumns.filter(col => !customerColumns.includes(col));
        
        if (missingCustomerColumns.length === 0) {
            console.log('   ✅ All required customer columns exist');
        } else {
            console.log(`   ❌ Missing customer columns: ${missingCustomerColumns.join(', ')}`);
        }
        
        // Test 3: Check for suspended customers
        console.log('\n👥 3. Checking suspended customers...');
        const suspendedCustomers = await new Promise((resolve, reject) => {
            db.all("SELECT COUNT(*) as count FROM customers WHERE status = 'suspended'", (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0].count);
            });
        });
        
        console.log(`   📊 Suspended customers: ${suspendedCustomers}`);
        
        // Test 4: Check for overdue invoices
        console.log('\n📄 4. Checking overdue invoices...');
        const overdueInvoices = await new Promise((resolve, reject) => {
            db.all(`
                SELECT COUNT(*) as count 
                FROM invoices 
                WHERE status = 'unpaid' AND due_date < date('now')
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0].count);
            });
        });
        
        console.log(`   📊 Overdue invoices: ${overdueInvoices}`);
        
        // Test 5: Check for customers with PPPoE
        console.log('\n🌐 5. Checking PPPoE customers...');
        const pppoeCustomers = await new Promise((resolve, reject) => {
            db.all("SELECT COUNT(*) as count FROM customers WHERE pppoe_username IS NOT NULL AND pppoe_username != ''", (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0].count);
            });
        });
        
        console.log(`   📊 Customers with PPPoE: ${pppoeCustomers}`);
        
        // Test 6: Check for customers with static IP
        console.log('\n🏠 6. Checking static IP customers...');
        const staticIpCustomers = await new Promise((resolve, reject) => {
            db.all("SELECT COUNT(*) as count FROM customers WHERE static_ip IS NOT NULL AND static_ip != ''", (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0].count);
            });
        });
        
        console.log(`   📊 Customers with static IP: ${staticIpCustomers}`);
        
        // Test 7: Check for customers with MAC address
        console.log('\n📱 7. Checking MAC address customers...');
        const macCustomers = await new Promise((resolve, reject) => {
            db.all("SELECT COUNT(*) as count FROM customers WHERE mac_address IS NOT NULL AND mac_address != ''", (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0].count);
            });
        });
        
        console.log(`   📊 Customers with MAC address: ${macCustomers}`);
        
        // Test 8: Check recent suspension activities
        console.log('\n📈 8. Checking recent suspension activities...');
        const recentSuspensions = await new Promise((resolve, reject) => {
            db.all(`
                SELECT c.username, c.name, c.status, c.join_date
                FROM customers c
                WHERE c.status = 'suspended'
                ORDER BY c.join_date DESC
                LIMIT 5
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        if (recentSuspensions.length > 0) {
            console.log('   📋 Recent suspended customers:');
            recentSuspensions.forEach(customer => {
                console.log(`      - ${customer.username} (${customer.name}) - ${customer.join_date}`);
            });
        } else {
            console.log('   ℹ️  No suspended customers found');
        }
        
        // Test 9: Check settings for isolir profile
        console.log('\n⚙️  9. Checking isolir profile settings...');
        try {
            const settings = require('../config/settings.json');
            const isolirProfile = settings.isolir_profile || 'isolir';
            console.log(`   📊 Current isolir profile: ${isolirProfile}`);
        } catch (error) {
            console.log('   ⚠️  Could not read settings.json');
        }
        
        console.log('\n🎉 Isolir features test completed!');
        
    } catch (error) {
        console.error('❌ Error testing isolir features:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    testIsolirFeatures()
        .then(() => {
            console.log('✅ Test completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Test failed:', error);
            process.exit(1);
        });
}

module.exports = testIsolirFeatures;
