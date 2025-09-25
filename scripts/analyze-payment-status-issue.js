const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function analyzePaymentStatusIssue() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Analyzing payment status synchronization issue...');
        console.log('📋 Problem: Admin marked invoice as paid, but collector report shows pending');
        
        // Check current data
        console.log('\n📊 Current Database Status:');
        
        const customers = await new Promise((resolve, reject) => {
            db.all('SELECT COUNT(*) as count FROM customers', (err, row) => {
                if (err) reject(err);
                else resolve(row[0]?.count || 0);
            });
        });
        
        const invoices = await new Promise((resolve, reject) => {
            db.all('SELECT COUNT(*) as count FROM invoices', (err, row) => {
                if (err) reject(err);
                else resolve(row[0]?.count || 0);
            });
        });
        
        const payments = await new Promise((resolve, reject) => {
            db.all('SELECT COUNT(*) as count FROM payments', (err, row) => {
                if (err) reject(err);
                else resolve(row[0]?.count || 0);
            });
        });
        
        console.log(`   - Customers: ${customers}`);
        console.log(`   - Invoices: ${invoices}`);
        console.log(`   - Payments: ${payments}`);
        
        if (customers === 0 && invoices === 0 && payments === 0) {
            console.log('\n⚠️  Database is empty. Need to recreate the issue first.');
            console.log('\n🔧 To reproduce the issue:');
            console.log('   1. Create a customer');
            console.log('   2. Create an invoice');
            console.log('   3. Admin marks invoice as paid');
            console.log('   4. Check collector report - should show pending');
            return;
        }
        
        // Analyze the issue
        console.log('\n🔍 Analyzing payment status synchronization...');
        
        // Check invoices vs payments
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
                    p.collector_id
                FROM invoices i
                LEFT JOIN payments p ON i.id = p.invoice_id
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
                console.log(`   - Invoice ${mismatch.invoice_number}:`);
                console.log(`     Invoice Status: ${mismatch.invoice_status}`);
                console.log(`     Invoice Payment Date: ${mismatch.invoice_payment_date}`);
                console.log(`     Payment Record: ${mismatch.payment_id ? 'EXISTS' : 'MISSING'}`);
                console.log(`     Payment Date: ${mismatch.payment_date || 'N/A'}`);
                console.log(`     Collector ID: ${mismatch.collector_id || 'N/A'}`);
                console.log('');
            });
        }
        
        // Check collector payments vs regular payments
        const collectorPaymentIssues = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    cp.id as collector_payment_id,
                    cp.status as collector_payment_status,
                    cp.payment_amount,
                    cp.commission_amount,
                    p.id as regular_payment_id,
                    p.payment_type,
                    i.invoice_number,
                    i.status as invoice_status
                FROM collector_payments cp
                LEFT JOIN payments p ON cp.invoice_id = p.invoice_id
                LEFT JOIN invoices i ON cp.invoice_id = i.id
                WHERE cp.status != 'completed' OR (p.id IS NULL AND i.status = 'paid')
                ORDER BY cp.collected_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (collectorPaymentIssues.length > 0) {
            console.log('\n❌ Found collector payment issues:');
            collectorPaymentIssues.forEach(issue => {
                console.log(`   - Collector Payment ID: ${issue.collector_payment_id}`);
                console.log(`     Status: ${issue.collector_payment_status}`);
                console.log(`     Amount: Rp ${issue.payment_amount?.toLocaleString()}`);
                console.log(`     Invoice: ${issue.invoice_number || 'N/A'}`);
                console.log(`     Invoice Status: ${issue.invoice_status || 'N/A'}`);
                console.log(`     Regular Payment: ${issue.regular_payment_id ? 'EXISTS' : 'MISSING'}`);
                console.log('');
            });
        }
        
        // Root cause analysis
        console.log('\n🔍 Root Cause Analysis:');
        console.log('   Possible causes of payment status mismatch:');
        console.log('   1. Invoice marked as paid but no payment record created');
        console.log('   2. Payment created but collector_payments not updated');
        console.log('   3. Status update not synchronized between tables');
        console.log('   4. Missing transaction handling in admin payment');
        
        // Solution recommendations
        console.log('\n💡 Solution Recommendations:');
        console.log('   1. Ensure admin payment creates both payments and collector_payments records');
        console.log('   2. Use transactions to maintain data consistency');
        console.log('   3. Update collector_payments status when invoice is marked paid');
        console.log('   4. Add validation to prevent status mismatches');
        
    } catch (error) {
        console.error('❌ Error analyzing payment status issue:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    analyzePaymentStatusIssue();
}

module.exports = analyzePaymentStatusIssue;
