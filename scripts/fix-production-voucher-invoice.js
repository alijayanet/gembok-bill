#!/usr/bin/env node

/**
 * Script khusus untuk memperbaiki invoice voucher di server produksi
 * yang sudah terbayar tapi statusnya masih unpaid
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const billingManager = require('../config/billing');

async function fixProductionVoucherInvoice() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔧 FIXING PRODUCTION VOUCHER INVOICE STATUS');
        console.log('=' .repeat(60));
        
        // Step 1: Cari invoice voucher yang statusnya unpaid
        console.log('📊 Mencari invoice voucher unpaid...');
        
        const unpaidVoucherInvoices = await new Promise((resolve, reject) => {
            db.all(`
                SELECT i.id, i.invoice_number, i.status, i.amount, i.created_at, i.notes,
                       vp.id as purchase_id, vp.status as purchase_status, vp.voucher_data,
                       vp.customer_name, vp.customer_phone, vp.created_at as purchase_created_at
                FROM invoices i
                LEFT JOIN voucher_purchases vp ON i.id = vp.invoice_id
                WHERE i.status = 'unpaid' 
                AND i.invoice_type = 'voucher'
                ORDER BY i.created_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        console.log(`📋 Ditemukan ${unpaidVoucherInvoices.length} invoice voucher unpaid:`);
        
        if (unpaidVoucherInvoices.length === 0) {
            console.log('✅ Tidak ada invoice voucher unpaid!');
            return;
        }
        
        // Step 2: Tampilkan detail invoice
        unpaidVoucherInvoices.forEach((invoice, index) => {
            console.log(`\n${index + 1}. Invoice: ${invoice.invoice_number}`);
            console.log(`   Status Invoice: ${invoice.status}`);
            console.log(`   Amount: Rp ${parseFloat(invoice.amount).toLocaleString('id-ID')}`);
            console.log(`   Notes: ${invoice.notes}`);
            console.log(`   Created: ${invoice.created_at}`);
            
            if (invoice.purchase_id) {
                console.log(`   Purchase Status: ${invoice.purchase_status}`);
                console.log(`   Customer: ${invoice.customer_name} (${invoice.customer_phone})`);
                console.log(`   Voucher Data: ${invoice.voucher_data ? 'Ada' : 'Tidak ada'}`);
            } else {
                console.log(`   ⚠️  Tidak ada voucher purchase record`);
            }
        });
        
        // Step 3: Konfirmasi perbaikan
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const answer = await new Promise((resolve) => {
            rl.question('\nApakah Anda yakin ingin memperbaiki invoice ini? (y/N): ', (input) => {
                rl.close();
                resolve(input.toLowerCase());
            });
        });
        
        if (answer !== 'y' && answer !== 'yes') {
            console.log('❌ Perbaikan dibatalkan.');
            return;
        }
        
        // Step 4: Perbaiki invoice satu per satu
        console.log('\n🔧 Memperbaiki invoice...');
        
        let fixedCount = 0;
        let errorCount = 0;
        
        for (const invoice of unpaidVoucherInvoices) {
            try {
                console.log(`\n📝 Memperbaiki invoice: ${invoice.invoice_number}`);
                
                // Update status invoice menjadi paid
                await billingManager.updateInvoiceStatus(invoice.id, 'paid', 'tripay');
                console.log(`   ✅ Status invoice diupdate menjadi 'paid'`);
                
                // Record payment untuk audit trail
                const paymentData = {
                    invoice_id: invoice.id,
                    amount: parseFloat(invoice.amount),
                    payment_method: 'tripay',
                    reference_number: `VOUCHER-FIX-${Date.now()}`,
                    notes: `Pembayaran voucher online - ${invoice.notes || 'Voucher Hotspot'}`
                };
                
                await billingManager.recordPayment(paymentData);
                console.log(`   ✅ Payment record ditambahkan`);
                
                // Update voucher purchase status jika ada
                if (invoice.purchase_id && invoice.purchase_status !== 'completed') {
                    await new Promise((resolve, reject) => {
                        db.run(`
                            UPDATE voucher_purchases 
                            SET status = 'completed', updated_at = datetime('now')
                            WHERE id = ?
                        `, [invoice.purchase_id], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                    console.log(`   ✅ Voucher purchase status diupdate menjadi 'completed'`);
                }
                
                fixedCount++;
                
            } catch (error) {
                console.error(`   ❌ Error memperbaiki invoice ${invoice.invoice_number}:`, error.message);
                errorCount++;
            }
        }
        
        // Step 5: Verifikasi hasil
        console.log('\n📊 HASIL PERBAIKAN:');
        console.log('=' .repeat(40));
        console.log(`✅ Invoice berhasil diperbaiki: ${fixedCount}`);
        console.log(`❌ Invoice gagal diperbaiki: ${errorCount}`);
        console.log(`📋 Total invoice diproses: ${unpaidVoucherInvoices.length}`);
        
        // Step 6: Verifikasi final
        console.log('\n🔍 Verifikasi final...');
        const remainingUnpaid = await new Promise((resolve, reject) => {
            db.get(`
                SELECT COUNT(*) as count
                FROM invoices 
                WHERE status = 'unpaid' 
                AND invoice_type = 'voucher'
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        
        console.log(`📋 Invoice voucher unpaid yang tersisa: ${remainingUnpaid}`);
        
        if (remainingUnpaid === 0) {
            console.log('🎉 Semua invoice voucher sudah diperbaiki!');
        } else {
            console.log('⚠️  Masih ada invoice yang perlu diperbaiki secara manual.');
        }
        
    } catch (error) {
        console.error('❌ Error during production voucher invoice fix:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    fixProductionVoucherInvoice()
        .then(() => {
            console.log('\n✅ Script selesai dijalankan!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Script gagal:', error);
            process.exit(1);
        });
}

module.exports = { fixProductionVoucherInvoice };
