const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function checkAdminPaymentsPage() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Checking what admin payments page shows...');
        console.log('📋 This simulates billingManager.getPayments() method');
        
        // Simulate billingManager.getPayments() query
        const payments = await new Promise((resolve, reject) => {
            let sql = `
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
            `;
            
            db.all(sql, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
        
        console.log(`\n📄 Admin payments page would show ${payments.length} records:`);
        
        if (payments.length > 0) {
            payments.forEach((payment, index) => {
                const isAdminPayment = !payment.collector_id || payment.collector_name === null;
                console.log(`   ${index + 1}. Customer: ${payment.customer_name}`);
                console.log(`      Invoice: ${payment.invoice_number}`);
                console.log(`      Amount: Rp ${payment.amount?.toLocaleString()}`);
                console.log(`      Method: ${payment.payment_method}`);
                console.log(`      Type: ${payment.payment_type}`);
                console.log(`      Collector: ${payment.collector_name || 'N/A'}`);
                console.log(`      Admin Payment: ${isAdminPayment ? 'YES ❌' : 'NO ✅'}`);
                console.log(`      Date: ${payment.payment_date}`);
                console.log('');
            });
        } else {
            console.log('   No payments found');
        }
        
        // Count admin vs collector payments
        const adminPayments = payments.filter(p => !p.collector_id || p.collector_name === null);
        const collectorPayments = payments.filter(p => p.collector_id && p.collector_name !== null);
        
        console.log('📊 Summary:');
        console.log(`   - Total payments: ${payments.length}`);
        console.log(`   - Admin payments: ${adminPayments.length} ❌`);
        console.log(`   - Collector payments: ${collectorPayments.length} ✅`);
        
        if (adminPayments.length > 0) {
            console.log('\n❌ Problem: Admin payments are showing in admin payments page');
            console.log('   This is actually correct behavior - admin payments page should show all payments');
            console.log('   But if you want to separate them, we need to modify the query or create separate pages');
        }
        
        console.log('\n💡 Solution Options:');
        console.log('   1. Keep current behavior (admin payments page shows all payments)');
        console.log('   2. Create separate page for collector-only transactions');
        console.log('   3. Add filter to admin payments page (Admin vs Collector)');
        console.log('   4. Modify query to exclude admin payments from admin payments page');
        
    } catch (error) {
        console.error('❌ Error checking admin payments page:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    checkAdminPaymentsPage();
}

module.exports = checkAdminPaymentsPage;
