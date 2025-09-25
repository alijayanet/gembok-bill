const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function fixAdminPaymentsPageFilter() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔧 Fixing admin payments page to separate admin vs collector payments...');
        console.log('📋 Solution: Modify billingManager.getPayments() to filter out admin payments');
        
        // Current query (shows all payments)
        console.log('\n🔍 Current query shows all payments:');
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
        
        console.log(`   - Total payments: ${allPayments.length}`);
        allPayments.forEach(payment => {
            const isAdmin = !payment.collector_id || payment.collector_name === null;
            console.log(`     - ${payment.customer_name}: Rp ${payment.amount?.toLocaleString()} (${isAdmin ? 'Admin' : 'Collector'})`);
        });
        
        // Modified query (only collector payments)
        console.log('\n🔍 Modified query (only collector payments):');
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
        
        console.log(`   - Collector payments: ${collectorPayments.length}`);
        collectorPayments.forEach(payment => {
            console.log(`     - ${payment.customer_name}: Rp ${payment.amount?.toLocaleString()} (${payment.collector_name})`);
        });
        
        // Admin payments only
        console.log('\n🔍 Admin payments only:');
        const adminPayments = await new Promise((resolve, reject) => {
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
                WHERE p.collector_id IS NULL OR col.id IS NULL
                ORDER BY p.payment_date DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        console.log(`   - Admin payments: ${adminPayments.length}`);
        adminPayments.forEach(payment => {
            console.log(`     - ${payment.customer_name}: Rp ${payment.amount?.toLocaleString()} (Admin)`);
        });
        
        console.log('\n💡 Solution Options:');
        console.log('   1. Modify billingManager.getPayments() to filter out admin payments');
        console.log('   2. Create separate method getCollectorPayments()');
        console.log('   3. Add filter parameter to getPayments() method');
        console.log('   4. Create separate admin payments page');
        
        // Recommendation
        console.log('\n🎯 Recommendation:');
        console.log('   - Keep current getPayments() for admin payments page');
        console.log('   - Create getCollectorPayments() for collector transactions page');
        console.log('   - This way each page has its own purpose');
        
    } catch (error) {
        console.error('❌ Error checking admin payments page filter:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    fixAdminPaymentsPageFilter();
}

module.exports = fixAdminPaymentsPageFilter;
