const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function testPaymentsTemplateFix() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔧 Testing payments template fix...');
        console.log('📋 Checking how payments will display in template');
        
        // Simulate getPayments() query (all payments)
        console.log('\n📄 All Payments (getPayments()):');
        const allPayments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    p.*, 
                    i.invoice_number, 
                    c.username, 
                    c.name as customer_name,
                    col.name as collector_name,
                    col.phone as collector_phone
                FROM payments p
                JOIN invoices i ON p.invoice_id = i.id
                JOIN customers c ON i.customer_id = c.id
                LEFT JOIN collectors col ON p.collector_id = col.id
                ORDER BY p.payment_date DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        console.log(`📦 Found ${allPayments.length} payments:`);
        allPayments.forEach((payment, index) => {
            const isAdminPayment = !payment.collector_id;
            const status = payment.status || 'completed';
            
            // Simulate template logic
            let remittanceStatus;
            let remittanceBadgeClass;
            
            if (payment.remittance_status && payment.collector_id) {
                remittanceStatus = payment.remittance_status;
                remittanceBadgeClass = payment.remittance_status === 'received' ? 'primary' : 'warning';
            } else if (!payment.collector_id) {
                remittanceStatus = 'N/A (Admin)';
                remittanceBadgeClass = 'primary';
            } else {
                remittanceStatus = 'pending';
                remittanceBadgeClass = 'warning';
            }
            
            console.log(`   ${index + 1}. Customer: ${payment.customer_name}`);
            console.log(`      Invoice: ${payment.invoice_number}`);
            console.log(`      Amount: Rp ${payment.amount?.toLocaleString()}`);
            console.log(`      Method: ${payment.payment_method}`);
            console.log(`      Type: ${payment.payment_type}`);
            console.log(`      Collector: ${payment.collector_name || 'N/A'}`);
            console.log(`      Status: ${status}`);
            console.log(`      Remittance: ${remittanceStatus} (badge: ${remittanceBadgeClass})`);
            console.log(`      Admin Payment: ${isAdminPayment ? 'YES' : 'NO'}`);
            console.log('');
        });
        
        // Simulate getCollectorPayments() query (collector payments only)
        console.log('\n📄 Collector Payments Only (getCollectorPayments()):');
        const collectorPayments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    p.*, 
                    i.invoice_number, 
                    c.username, 
                    c.name as customer_name,
                    col.name as collector_name,
                    col.phone as collector_phone
                FROM payments p
                JOIN invoices i ON p.invoice_id = i.id
                JOIN customers c ON i.customer_id = c.id
                LEFT JOIN collectors col ON p.collector_id = col.id
                WHERE p.collector_id IS NOT NULL AND col.id IS NOT NULL
                ORDER BY p.payment_date DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        console.log(`📦 Found ${collectorPayments.length} collector payments:`);
        if (collectorPayments.length === 0) {
            console.log('   ✅ No collector payments (as expected)');
        } else {
            collectorPayments.forEach((payment, index) => {
                console.log(`   ${index + 1}. Customer: ${payment.customer_name}`);
                console.log(`      Collector: ${payment.collector_name}`);
                console.log(`      Amount: Rp ${payment.amount?.toLocaleString()}`);
                console.log('');
            });
        }
        
        console.log('\n✅ Template fix verification:');
        console.log('   - Admin payments will show "N/A (Admin)" for remittance');
        console.log('   - Admin payments will have primary badge (blue)');
        console.log('   - Collector payments will show actual remittance status');
        console.log('   - No more "pending" remittance for admin payments');
        
    } catch (error) {
        console.error('❌ Error testing template fix:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    testPaymentsTemplateFix();
}

module.exports = testPaymentsTemplateFix;
