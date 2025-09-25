const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function checkTransaksiKolektor() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Checking transaksi kolektor...');
        
        // Check collector_payments table
        console.log('\n💰 Collector Payments:');
        const collectorPayments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    cp.*,
                    c.name as customer_name,
                    c.phone as customer_phone,
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
            console.log(`   - ID: ${payment.id}`);
            console.log(`     Date: ${payment.collected_at}`);
            console.log(`     Collector: ${payment.collector_name || 'N/A'}`);
            console.log(`     Customer: ${payment.customer_name || payment.customer_phone || 'N/A'}`);
            console.log(`     Amount: Rp ${payment.payment_amount?.toLocaleString() || payment.amount?.toLocaleString()}`);
            console.log(`     Commission: Rp ${payment.commission_amount?.toLocaleString() || '0'}`);
            console.log(`     Method: ${payment.payment_method}`);
            console.log(`     Status: ${payment.status}`);
            console.log(`     Remittance: ${payment.remittance_status || 'N/A'}`);
            console.log(`     Notes: ${payment.notes || 'N/A'}`);
            console.log('');
        });
        
        // Check payments table
        console.log('\n💳 Payments Table:');
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
            console.log(`   - ID: ${payment.id}`);
            console.log(`     Date: ${payment.payment_date}`);
            console.log(`     Invoice: ${payment.invoice_number || 'N/A'}`);
            console.log(`     Customer: ${payment.customer_name || 'N/A'}`);
            console.log(`     Collector: ${payment.collector_name || 'N/A'}`);
            console.log(`     Amount: Rp ${payment.amount?.toLocaleString()}`);
            console.log(`     Commission: Rp ${payment.commission_amount?.toLocaleString() || '0'}`);
            console.log(`     Method: ${payment.payment_method}`);
            console.log(`     Type: ${payment.payment_type}`);
            console.log('');
        });
        
        // Check invoices
        console.log('\n📄 Invoices:');
        const invoices = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    i.*,
                    c.name as customer_name,
                    c.phone as customer_phone
                FROM invoices i
                LEFT JOIN customers c ON i.customer_id = c.id
                ORDER BY i.created_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        invoices.forEach(invoice => {
            console.log(`   - ID: ${invoice.id}`);
            console.log(`     Number: ${invoice.invoice_number}`);
            console.log(`     Customer: ${invoice.customer_name || invoice.customer_phone || 'N/A'}`);
            console.log(`     Amount: Rp ${invoice.amount?.toLocaleString()}`);
            console.log(`     Status: ${invoice.status}`);
            console.log(`     Due Date: ${invoice.due_date}`);
            console.log(`     Payment Date: ${invoice.payment_date || 'Not paid'}`);
            console.log('');
        });
        
        // Check customers
        console.log('\n👥 Customers:');
        const customers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM customers ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        customers.forEach(customer => {
            console.log(`   - ID: ${customer.id}, Name: ${customer.name}, Phone: ${customer.phone}`);
        });
        
        console.log(`\n📊 Summary:`);
        console.log(`   - Collector Payments: ${collectorPayments.length}`);
        console.log(`   - Payments: ${payments.length}`);
        console.log(`   - Invoices: ${invoices.length}`);
        console.log(`   - Customers: ${customers.length}`);
        
        if (collectorPayments.length > 0) {
            console.log('\n⚠️  Masih ada data di collector_payments!');
            console.log('   Ini bisa menyebabkan masalah status pembayaran.');
        }
        
    } catch (error) {
        console.error('❌ Error checking transaksi kolektor:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    checkTransaksiKolektor();
}

module.exports = checkTransaksiKolektor;
