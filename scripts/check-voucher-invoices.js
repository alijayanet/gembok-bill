#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function checkVoucherInvoices() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Checking all voucher invoices...');
        
        const invoices = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM invoices WHERE invoice_type = "voucher" ORDER BY created_at DESC', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        console.log(`📋 Found ${invoices.length} voucher invoices:`);
        
        if (invoices.length === 0) {
            console.log('✅ Tidak ada invoice voucher di database');
            return;
        }
        
        invoices.forEach((invoice, index) => {
            console.log(`\n${index + 1}. ${invoice.invoice_number}`);
            console.log(`   Status: ${invoice.status}`);
            console.log(`   Amount: Rp ${parseFloat(invoice.amount).toLocaleString('id-ID')}`);
            console.log(`   Created: ${invoice.created_at}`);
            console.log(`   Customer ID: ${invoice.customer_id}`);
        });
        
        // Cek juga voucher purchases
        console.log('\n🔍 Checking voucher purchases...');
        
        const purchases = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM voucher_purchases ORDER BY created_at DESC', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        console.log(`📋 Found ${purchases.length} voucher purchases:`);
        
        purchases.forEach((purchase, index) => {
            console.log(`\n${index + 1}. Purchase ID: ${purchase.id}`);
            console.log(`   Invoice ID: ${purchase.invoice_id}`);
            console.log(`   Status: ${purchase.status}`);
            console.log(`   Customer: ${purchase.customer_name} (${purchase.customer_phone})`);
            console.log(`   Package: ${purchase.voucher_package}`);
            console.log(`   Quantity: ${purchase.voucher_quantity}`);
            console.log(`   Voucher Data: ${purchase.voucher_data ? 'Ada' : 'Tidak ada'}`);
            console.log(`   Created: ${purchase.created_at}`);
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        db.close();
    }
}

if (require.main === module) {
    checkVoucherInvoices();
}

module.exports = { checkVoucherInvoices };
