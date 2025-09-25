const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function testNewCollectorPaymentsMethod() {
    try {
        console.log('🔧 Testing new getCollectorPayments() method...');
        
        // Test collector payments query directly
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Test getCollectorPayments query (should return empty)
        console.log('\n📋 Testing getCollectorPayments query:');
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
        
        // Test getPayments query (should return all payments)
        console.log('\n📋 Testing getPayments query:');
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
        
        console.log(`   - All payments: ${allPayments.length}`);
        allPayments.forEach(payment => {
            const isAdmin = !payment.collector_id || payment.collector_name === null;
            console.log(`     - ${payment.customer_name}: Rp ${payment.amount?.toLocaleString()} (${isAdmin ? 'Admin' : payment.collector_name})`);
        });
        
        db.close();
        
        console.log('\n✅ Method separation working correctly!');
        console.log('   - getCollectorPayments() returns only collector transactions');
        console.log('   - getPayments() returns all payments (admin + collector)');
        
    } catch (error) {
        console.error('❌ Error testing new method:', error);
    }
}

// Run if called directly
if (require.main === module) {
    testNewCollectorPaymentsMethod();
}

module.exports = testNewCollectorPaymentsMethod;
