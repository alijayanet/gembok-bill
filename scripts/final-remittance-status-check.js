const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function finalRemittanceStatusCheck() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Final remittance status check...');
        console.log('📋 Checking if all remittance issues are resolved');
        
        // Check collector_payments table
        console.log('\n📊 Collector Payments Table:');
        const collectorPayments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    cp.id,
                    cp.collector_id,
                    cp.payment_amount,
                    cp.status,
                    cp.remittance_status,
                    cp.notes,
                    cp.collected_at,
                    c.name as collector_name
                FROM collector_payments cp
                LEFT JOIN collectors c ON cp.collector_id = c.id
                ORDER BY cp.collected_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (collectorPayments.length === 0) {
            console.log('   ✅ Collector payments table is empty (as expected)');
        } else {
            console.log(`   📦 Found ${collectorPayments.length} collector payments:`);
            collectorPayments.forEach(payment => {
                const remittanceStatus = payment.remittance_status || 'pending';
                console.log(`     - ID ${payment.id}: ${payment.collector_name}`);
                console.log(`       Amount: Rp ${payment.payment_amount?.toLocaleString()}`);
                console.log(`       Status: ${payment.status}`);
                console.log(`       Remittance: ${remittanceStatus}`);
                console.log(`       Notes: ${payment.notes || 'N/A'}`);
                console.log('');
            });
        }
        
        // Check payments table
        console.log('\n💳 Payments Table:');
        const payments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    p.id,
                    p.amount,
                    p.payment_method,
                    p.payment_type,
                    p.payment_date,
                    p.collector_id,
                    i.invoice_number,
                    c.name as customer_name
                FROM payments p
                LEFT JOIN invoices i ON p.invoice_id = i.id
                LEFT JOIN customers c ON i.customer_id = c.id
                ORDER BY p.payment_date DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        console.log(`   📦 Found ${payments.length} payments:`);
        payments.forEach(payment => {
            const isAdminPayment = !payment.collector_id;
            console.log(`     - ID ${payment.id}: ${payment.customer_name}`);
            console.log(`       Amount: Rp ${payment.amount?.toLocaleString()}`);
            console.log(`       Method: ${payment.payment_method}`);
            console.log(`       Type: ${payment.payment_type}`);
            console.log(`       Admin Payment: ${isAdminPayment ? 'YES' : 'NO'}`);
            console.log(`       Date: ${payment.payment_date}`);
            console.log('');
        });
        
        // Check collectors table
        console.log('\n👥 Collectors Table:');
        const collectors = await new Promise((resolve, reject) => {
            db.all(`
                SELECT id, name, phone, email, status
                FROM collectors
                ORDER BY id DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (collectors.length === 0) {
            console.log('   ✅ Collectors table is empty (as expected after cleanup)');
        } else {
            console.log(`   📦 Found ${collectors.length} collectors:`);
            collectors.forEach(collector => {
                console.log(`     - ID ${collector.id}: ${collector.name}`);
                console.log(`       Phone: ${collector.phone}`);
                console.log(`       Status: ${collector.status}`);
                console.log('');
            });
        }
        
        // Check collector_remittances table
        console.log('\n💰 Collector Remittances Table:');
        const remittances = await new Promise((resolve, reject) => {
            db.all(`
                SELECT id, collector_id, amount, payment_method, notes, received_at, received_by
                FROM collector_remittances
                ORDER BY received_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (remittances.length === 0) {
            console.log('   ✅ Collector remittances table is empty');
        } else {
            console.log(`   📦 Found ${remittances.length} remittances:`);
            remittances.forEach(remittance => {
                console.log(`     - ID ${remittance.id}: Collector ${remittance.collector_id}`);
                console.log(`       Amount: Rp ${remittance.amount?.toLocaleString()}`);
                console.log(`       Method: ${remittance.payment_method}`);
                console.log(`       Received by: ${remittance.received_by}`);
                console.log(`       Date: ${remittance.received_at}`);
                console.log('');
            });
        }
        
        // Summary
        console.log('\n📊 Final Status Summary:');
        console.log(`   - Collector Payments: ${collectorPayments.length} records`);
        console.log(`   - Payments: ${payments.length} records`);
        console.log(`   - Collectors: ${collectors.length} records`);
        console.log(`   - Remittances: ${remittances.length} records`);
        
        if (collectorPayments.length === 0) {
            console.log('\n✅ REMITTANCE STATUS ISSUE RESOLVED!');
            console.log('   - No collector payments = No pending remittance');
            console.log('   - Admin payments are properly separated');
            console.log('   - "Transaksi Kolektor" page should be clean');
        } else {
            console.log('\n⚠️  Still have collector payments with potential remittance issues');
            const pendingRemittances = collectorPayments.filter(p => !p.remittance_status || p.remittance_status === 'pending');
            if (pendingRemittances.length > 0) {
                console.log(`   - ${pendingRemittances.length} payments with pending remittance status`);
            }
        }
        
        console.log('\n💡 If you still see pending remittance in browser:');
        console.log('   1. Clear browser cache (Ctrl+F5)');
        console.log('   2. Restart the application');
        console.log('   3. Check if you are looking at the correct page');
        console.log('   4. Verify the page is using the updated route');
        
    } catch (error) {
        console.error('❌ Error checking remittance status:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    finalRemittanceStatusCheck();
}

module.exports = finalRemittanceStatusCheck;
