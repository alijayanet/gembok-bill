/**
 * Monthly Reset System - Simple Version
 * Sistem reset statistik bulanan dengan preservasi data historis
 */

const db = require('../config/database');

class MonthlyResetSystem {
    constructor() {
        this.db = db;
    }

    /**
     * Jalankan proses reset bulanan
     */
    async runMonthlyReset() {
        try {
            console.log('🔄 Starting monthly reset process...');

            // 1. Buat snapshot data bulanan
            await this.createMonthlySnapshot();

            // 2. Update system settings untuk reset
            await this.updateMonthlyResetSettings();

            console.log('✅ Monthly reset completed successfully');
            return { success: true, message: 'Monthly reset completed' };

        } catch (error) {
            console.error('❌ Error in monthly reset:', error);
            throw error;
        }
    }

    /**
     * Buat snapshot data bulanan sebelum reset
     */
    async createMonthlySnapshot() {
        console.log('📸 Creating monthly snapshot...');

        const currentDate = new Date();
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;

        // Ambil data statistik saat ini
        const stats = await this.getCurrentStatistics();

        // Simpan ke tabel monthly_summary
        await this.saveMonthlySummary(year, month, stats);

        console.log(`✅ Monthly snapshot saved for ${year}-${month.toString().padStart(2, '0')}`);
    }

    /**
     * Ambil statistik saat ini
     */
    async getCurrentStatistics() {
        const queries = [
            // Total customers
            'SELECT COUNT(*) as total FROM customers',
            // Active customers
            'SELECT COUNT(*) as active FROM customers WHERE status = "active"',
            // Monthly invoices
            'SELECT COUNT(*) as monthly FROM invoices WHERE invoice_type = "monthly"',
            // Voucher invoices
            'SELECT COUNT(*) as voucher FROM invoices WHERE invoice_type = "voucher"',
            // Paid monthly invoices
            'SELECT COUNT(*) as paid_monthly FROM invoices WHERE invoice_type = "monthly" AND status = "paid"',
            // Paid voucher invoices
            'SELECT COUNT(*) as paid_voucher FROM invoices WHERE invoice_type = "voucher" AND status = "paid"',
            // Unpaid monthly invoices
            'SELECT COUNT(*) as unpaid_monthly FROM invoices WHERE invoice_type = "monthly" AND status = "unpaid"',
            // Unpaid voucher invoices
            'SELECT COUNT(*) as unpaid_voucher FROM invoices WHERE invoice_type = "voucher" AND status = "unpaid"',
            // Monthly revenue
            'SELECT COALESCE(SUM(amount), 0) as monthly_revenue FROM invoices WHERE invoice_type = "monthly" AND status = "paid"',
            // Voucher revenue
            'SELECT COALESCE(SUM(amount), 0) as voucher_revenue FROM invoices WHERE invoice_type = "voucher" AND status = "paid"',
            // Monthly unpaid
            'SELECT COALESCE(SUM(amount), 0) as monthly_unpaid FROM invoices WHERE invoice_type = "monthly" AND status = "unpaid"',
            // Voucher unpaid
            'SELECT COALESCE(SUM(amount), 0) as voucher_unpaid FROM invoices WHERE invoice_type = "voucher" AND status = "unpaid"'
        ];

        const results = {};
        let completed = 0;

        for (let index = 0; index < queries.length; index++) {
            const row = await db.get(queries[index]);
            const keys = [
                'total_customers', 'active_customers', 'monthly_invoices', 'voucher_invoices',
                'paid_monthly_invoices', 'paid_voucher_invoices', 'unpaid_monthly_invoices', 'unpaid_voucher_invoices',
                'monthly_revenue', 'voucher_revenue', 'monthly_unpaid', 'voucher_unpaid'
            ];

            results[keys[index]] = row[Object.keys(row)[0]];

            completed++;
            if (completed === queries.length) {
                // Calculate totals
                results.total_revenue = results.monthly_revenue + results.voucher_revenue;
                results.total_unpaid = results.monthly_unpaid + results.voucher_unpaid;
            }
        }

        return results;
    }

    /**
     * Simpan summary bulanan
     */
    async saveMonthlySummary(year, month, stats) {
        const sql = `
            INSERT INTO monthly_summary (
                year, month, total_customers, active_customers,
                monthly_invoices, voucher_invoices,
                paid_monthly_invoices, paid_voucher_invoices,
                unpaid_monthly_invoices, unpaid_voucher_invoices,
                monthly_revenue, voucher_revenue,
                monthly_unpaid, voucher_unpaid,
                total_revenue, total_unpaid,
                notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `;

        const params = [
            year, month, stats.total_customers, stats.active_customers,
            stats.monthly_invoices, stats.voucher_invoices,
            stats.paid_monthly_invoices, stats.paid_voucher_invoices,
            stats.unpaid_monthly_invoices, stats.unpaid_voucher_invoices,
            stats.monthly_revenue, stats.voucher_revenue,
            stats.monthly_unpaid, stats.voucher_unpaid,
            stats.total_revenue, stats.total_unpaid,
            `Auto-generated snapshot for ${year}-${month.toString().padStart(2, '0')}`
        ];

        await db.run(sql, params);
        console.log(`📊 Monthly summary saved`);
    }

    /**
     * Update settings untuk reset bulanan
     */
    async updateMonthlyResetSettings() {
        const currentDate = new Date();
        const resetDate = currentDate.toISOString();

        // Update atau insert monthly reset tracking
        const sql = `
            INSERT INTO system_settings (
                key, value, description, updated_at
            ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)
        `;

        await db.run(sql, ['monthly_reset_date', resetDate, 'Last monthly reset date']);
        console.log('📅 Monthly reset date updated');
    }
}

// Export untuk digunakan di API
module.exports = MonthlyResetSystem;

// Jika dijalankan langsung
if (require.main === module) {
    const resetSystem = new MonthlyResetSystem();

    resetSystem.runMonthlyReset()
        .then((result) => {
            console.log('🎉 Monthly reset system completed successfully!');
            console.log('Result:', result);
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Monthly reset system failed:', error);
            process.exit(1);
        });
}
