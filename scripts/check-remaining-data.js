const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function checkRemainingData() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Checking remaining data in database...');
        
        // Check collector_payments
        console.log('\n💰 Collector Payments:');
        const collectorPayments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    cp.*,
                    c.name as customer_name,
                    col.name as collector_name
                FROM collector_payments cp
                LEFT JOIN customers c ON cp.customer_id = c.id
                LEFT JOIN collectors col ON cp.collector_id = col.id
                ORDER BY cp.collected_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        collectorPayments.forEach(payment => {
            console.log(`   - ID: ${payment.id}, Date: ${payment.collected_at}`);
            console.log(`     Customer: ${payment.customer_name || 'N/A'}`);
            console.log(`     Collector: ${payment.collector_name || 'N/A'}`);
            console.log(`     Amount: Rp ${payment.payment_amount?.toLocaleString() || payment.amount?.toLocaleString()}`);
            console.log(`     Method: ${payment.payment_method}`);
            console.log(`     Status: ${payment.status}`);
            console.log('');
        });
        
        // Check payments
        console.log('💳 Payments:');
        const payments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    p.*,
                    i.invoice_number,
                    c.name as customer_name,
                    col.name as collector_name
                FROM payments p
                LEFT JOIN invoices i ON p.invoice_id = i.id
                LEFT JOIN customers c ON i.customer_id = c.id
                LEFT JOIN collectors col ON p.collector_id = col.id
                ORDER BY p.payment_date DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        payments.forEach(payment => {
            console.log(`   - ID: ${payment.id}, Date: ${payment.payment_date}`);
            console.log(`     Invoice: ${payment.invoice_number || 'N/A'}`);
            console.log(`     Customer: ${payment.customer_name || 'N/A'}`);
            console.log(`     Collector: ${payment.collector_name || 'N/A'}`);
            console.log(`     Amount: Rp ${payment.amount?.toLocaleString()}`);
            console.log(`     Method: ${payment.payment_method}`);
            console.log(`     Type: ${payment.payment_type}`);
            console.log('');
        });
        
        // Check customers
        console.log('👥 Customers:');
        const customers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM customers ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        customers.forEach(customer => {
            console.log(`   - ID: ${customer.id}, Name: ${customer.name}, Phone: ${customer.phone}`);
        });
        
        // Check invoices
        console.log('\n📄 Invoices:');
        const invoices = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM invoices ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        invoices.forEach(invoice => {
            console.log(`   - ID: ${invoice.id}, Number: ${invoice.invoice_number}, Amount: Rp ${invoice.amount?.toLocaleString()}`);
        });
        
        console.log(`\n📊 Summary:`);
        console.log(`   - Collector Payments: ${collectorPayments.length}`);
        console.log(`   - Payments: ${payments.length}`);
        console.log(`   - Customers: ${customers.length}`);
        console.log(`   - Invoices: ${invoices.length}`);
        
        if (collectorPayments.length > 0 || payments.length > 0) {
            console.log('\n⚠️  Masih ada data pembayaran yang tersisa!');
            console.log('   Jalankan reset lagi untuk membersihkan semua data.');
        } else {
            console.log('\n✅ Database sudah bersih!');
        }
        
    } catch (error) {
        console.error('❌ Error checking remaining data:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    checkRemainingData();
}

module.exports = checkRemainingData;
