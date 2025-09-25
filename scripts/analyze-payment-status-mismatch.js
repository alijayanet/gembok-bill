const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function analyzePaymentStatusMismatch() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Analyzing payment status mismatch...');
        console.log('📋 Problem: Dashboard shows "lunas" but /admin/billing/payments shows "pending"');
        
        // Check current data status
        console.log('\n📊 Current Database Status:');
        
        const stats = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    'invoices' as table_name, 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count
                FROM invoices
                UNION ALL
                SELECT 
                    'payments' as table_name, 
                    COUNT(*) as total, 0 as paid_count, 0 as pending_count
                FROM payments
                UNION ALL
                SELECT 
                    'collector_payments' as table_name, 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as paid_count,
                    SUM(CASE WHEN status != 'completed' THEN 1 ELSE 0 END) as pending_count
                FROM collector_payments
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        stats.forEach(stat => {
            console.log(`   - ${stat.table_name}: ${stat.total} total, ${stat.paid_count} paid, ${stat.pending_count} pending`);
        });
        
        if (stats.every(s => s.total === 0)) {
            console.log('\n⚠️  Database is empty. Need to create test data first.');
            console.log('\n🔧 To reproduce the issue:');
            console.log('   1. Create a customer');
            console.log('   2. Create an invoice');
            console.log('   3. Admin marks invoice as paid');
            console.log('   4. Check /admin/billing/payments - should show pending');
            return;
        }
        
        // Analyze invoice vs payment status mismatch
        console.log('\n🔍 Analyzing invoice vs payment status...');
        
        const invoicePaymentMismatch = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    i.id as invoice_id,
                    i.invoice_number,
                    i.status as invoice_status,
                    i.payment_date as invoice_payment_date,
                    p.id as payment_id,
                    p.payment_date as payment_date,
                    p.payment_method,
                    p.collector_id,
                    c.name as customer_name
                FROM invoices i
                LEFT JOIN payments p ON i.id = p.invoice_id
                LEFT JOIN customers c ON i.customer_id = c.id
                WHERE i.status = 'paid' AND (p.id IS NULL OR p.payment_date != i.payment_date)
                ORDER BY i.created_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (invoicePaymentMismatch.length > 0) {
            console.log('\n❌ Found invoice-payment mismatches:');
            invoicePaymentMismatch.forEach(mismatch => {
                console.log(`   - Invoice ${mismatch.invoice_number} (${mismatch.customer_name}):`);
                console.log(`     Invoice Status: ${mismatch.invoice_status}`);
                console.log(`     Invoice Payment Date: ${mismatch.invoice_payment_date}`);
                console.log(`     Payment Record: ${mismatch.payment_id ? 'EXISTS' : 'MISSING'}`);
                console.log(`     Payment Date: ${mismatch.payment_date || 'N/A'}`);
                console.log(`     Collector ID: ${mismatch.collector_id || 'N/A'}`);
                console.log('');
            });
        }
        
        // Check collector_payments vs payments mismatch
        console.log('\n🔍 Analyzing collector_payments vs payments...');
        
        const collectorPaymentMismatch = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    cp.id as collector_payment_id,
                    cp.status as collector_status,
                    cp.payment_amount,
                    cp.invoice_id,
                    cp.collected_at,
                    i.status as invoice_status,
                    i.payment_date as invoice_payment_date,
                    p.id as regular_payment_id,
                    p.payment_type,
                    c.name as customer_name
                FROM collector_payments cp
                LEFT JOIN invoices i ON cp.invoice_id = i.id
                LEFT JOIN payments p ON cp.invoice_id = p.invoice_id
                LEFT JOIN customers c ON cp.customer_id = c.id
                WHERE cp.status != 'completed' AND i.status = 'paid'
                ORDER BY cp.collected_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (collectorPaymentMismatch.length > 0) {
            console.log('\n❌ Found collector payment mismatches:');
            collectorPaymentMismatch.forEach(mismatch => {
                console.log(`   - Collector Payment ID: ${mismatch.collector_payment_id}`);
                console.log(`     Customer: ${mismatch.customer_name || 'N/A'}`);
                console.log(`     Amount: Rp ${mismatch.payment_amount?.toLocaleString()}`);
                console.log(`     Collector Status: ${mismatch.collector_status}`);
                console.log(`     Invoice Status: ${mismatch.invoice_status}`);
                console.log(`     Regular Payment: ${mismatch.regular_payment_id ? 'EXISTS' : 'MISSING'}`);
                console.log(`     Payment Type: ${mismatch.payment_type || 'N/A'}`);
                console.log('');
            });
        }
        
        // Check what the payments page would show
        console.log('\n🔍 What /admin/billing/payments page shows:');
        
        const paymentsPageData = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    p.*, 
                    i.invoice_number, 
                    c.username, 
                    c.name as customer_name,
                    col.name as collector_name,
                    col.phone as collector_phone,
                    i.status as invoice_status
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
        
        if (paymentsPageData.length > 0) {
            console.log(`📄 Payments page would show ${paymentsPageData.length} records:`);
            paymentsPageData.forEach(payment => {
                console.log(`   - ${payment.customer_name}: ${payment.payment_method} Rp ${payment.amount?.toLocaleString()}`);
                console.log(`     Invoice: ${payment.invoice_number} (${payment.invoice_status})`);
                console.log(`     Payment Type: ${payment.payment_type || 'unknown'}`);
                console.log(`     Collector: ${payment.collector_name || 'N/A'}`);
                console.log('');
            });
        } else {
            console.log('📄 Payments page would show: NO RECORDS');
            console.log('   This explains why status shows "pending" - no payment records exist!');
        }
        
        // Root cause analysis
        console.log('\n🔍 Root Cause Analysis:');
        console.log('   Possible causes:');
        console.log('   1. Invoice marked as paid but no payment record created');
        console.log('   2. Payment records exist but in wrong table (collector_payments vs payments)');
        console.log('   3. Status not synchronized between tables');
        console.log('   4. Admin payment not creating proper payment records');
        
        // Solution recommendations
        console.log('\n💡 Solution Recommendations:');
        console.log('   1. Run payment status sync fix script');
        console.log('   2. Create missing payment records for paid invoices');
        console.log('   3. Update collector_payments status');
        console.log('   4. Ensure admin payments create proper records');
        
    } catch (error) {
        console.error('❌ Error analyzing payment status mismatch:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    analyzePaymentStatusMismatch();
}

module.exports = analyzePaymentStatusMismatch;
