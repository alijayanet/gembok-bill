#!/usr/bin/env node

/**
 * Script test sederhana untuk webhook voucher tanpa signature validation
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const billingManager = require('../config/billing');

async function testVoucherWebhookSimple() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🧪 TESTING VOUCHER WEBHOOK (SIMPLE)');
        console.log('=' .repeat(50));
        
        // Step 1: Buat customer voucher publik jika belum ada
        console.log('📋 Step 1: Membuat customer voucher publik...');
        
        let voucherCustomerId;
        try {
            voucherCustomerId = await billingManager.getCustomerByUsername('voucher_public');
            if (!voucherCustomerId) {
                const customerData = {
                    username: 'voucher_public',
                    name: 'Voucher Publik',
                    phone: '0000000000',
                    email: 'voucher@public.com',
                    address: 'Sistem Voucher Publik',
                    package_id: 1,
                    status: 'active'
                };
                
                voucherCustomerId = await billingManager.createCustomer(customerData);
                console.log('✅ Customer voucher publik dibuat dengan ID:', voucherCustomerId.id);
            } else {
                console.log('✅ Customer voucher publik sudah ada dengan ID:', voucherCustomerId.id);
            }
        } catch (error) {
            console.error('❌ Error creating voucher customer:', error);
            return;
        }
        
        // Step 2: Buat invoice voucher test
        console.log('\n📋 Step 2: Membuat invoice voucher test...');
        
        const invoiceData = {
            customer_id: voucherCustomerId.id,
            package_id: 1,
            amount: 3000,
            due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            notes: 'Test Voucher Hotspot 3rb - 1 Hari x1',
            invoice_type: 'voucher'
        };
        
        const testInvoice = await billingManager.createInvoice(invoiceData);
        console.log('✅ Invoice voucher test dibuat:', testInvoice.invoice_number);
        
        // Step 3: Buat voucher purchase record
        console.log('\n📋 Step 3: Membuat voucher purchase record...');
        
        const purchaseData = {
            invoice_id: testInvoice.id,
            customer_name: 'Test Customer',
            customer_phone: '081234567890',
            voucher_package: '3k',
            voucher_profile: '3k',
            voucher_quantity: 1,
            amount: 3000,
            status: 'pending'
        };
        
        const purchase = await new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO voucher_purchases 
                (invoice_id, customer_name, customer_phone, voucher_package, voucher_profile, 
                 voucher_quantity, amount, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `;
            
            db.run(sql, [
                purchaseData.invoice_id,
                purchaseData.customer_name,
                purchaseData.customer_phone,
                purchaseData.voucher_package,
                purchaseData.voucher_profile,
                purchaseData.voucher_quantity,
                purchaseData.amount,
                purchaseData.status
            ], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, ...purchaseData });
            });
        });
        
        console.log('✅ Voucher purchase record dibuat dengan ID:', purchase.id);
        
        // Step 4: Test webhook langsung tanpa signature validation
        console.log('\n📋 Step 4: Test webhook langsung...');
        
        // Simulasi webhook data yang mirip dengan Tripay
        const webhookData = {
            order_id: testInvoice.invoice_number,
            status: 'PAID',
            amount: 3000,
            payment_type: 'qris',
            merchant_ref: testInvoice.invoice_number
        };
        
        try {
            // Panggil webhook handler langsung
            const { handleVoucherWebhook } = require('../routes/publicVoucher');
            const result = await handleVoucherWebhook(webhookData, {});
            
            console.log('✅ Webhook result:', result);
            
            if (result.success) {
                console.log('🎉 Webhook berhasil diproses!');
            } else {
                console.log('❌ Webhook gagal:', result.message);
            }
        } catch (webhookError) {
            console.error('❌ Webhook error:', webhookError);
        }
        
        // Step 5: Verifikasi hasil
        console.log('\n📋 Step 5: Verifikasi hasil...');
        
        // Cek status invoice
        const updatedInvoice = await billingManager.getInvoiceById(testInvoice.id);
        console.log('📊 Invoice Status:', updatedInvoice.status);
        
        // Cek status purchase
        const updatedPurchase = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM voucher_purchases WHERE id = ?', [purchase.id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        console.log('📊 Purchase Status:', updatedPurchase.status);
        console.log('📊 Voucher Data:', updatedPurchase.voucher_data ? 'Ada' : 'Tidak ada');
        
        // Step 6: Cleanup test data
        console.log('\n📋 Step 6: Cleanup test data...');
        
        const cleanupAnswer = await new Promise((resolve) => {
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            rl.question('Hapus data test? (y/N): ', (input) => {
                rl.close();
                resolve(input.toLowerCase());
            });
        });
        
        if (cleanupAnswer === 'y' || cleanupAnswer === 'yes') {
            // Hapus purchase
            await new Promise((resolve, reject) => {
                db.run('DELETE FROM voucher_purchases WHERE id = ?', [purchase.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
            // Hapus invoice
            await billingManager.deleteInvoice(testInvoice.id);
            
            console.log('✅ Data test berhasil dihapus');
        } else {
            console.log('ℹ️  Data test tetap disimpan');
        }
        
        console.log('\n🎉 Test selesai!');
        
    } catch (error) {
        console.error('❌ Test error:', error);
    } finally {
        db.close();
    }
}

if (require.main === module) {
    testVoucherWebhookSimple()
        .then(() => {
            console.log('\n✅ Test script selesai!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Test script gagal:', error);
            process.exit(1);
        });
}

module.exports = { testVoucherWebhookSimple };
