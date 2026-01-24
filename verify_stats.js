const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'billing.db');
const db = new sqlite3.Database(dbPath);

const collectorId = 3;

console.log(`Checking stats for collector ID ${collectorId}...`);

db.serialize(() => {
    db.get(`
        SELECT COALESCE(SUM(payment_amount), 0) as total
        FROM collector_payments 
        WHERE collector_id = ? 
        AND DATE(collected_at) = DATE('now', 'localtime')
        AND status = 'completed'
    `, [collectorId], (err, row) => {
        console.log("Today Payments:", row.total);
    });

    db.get(`
        SELECT COALESCE(SUM(commission_amount), 0) as total
        FROM collector_payments 
        WHERE collector_id = ? 
        AND strftime('%Y-%m', collected_at) = strftime('%Y-%m', 'now', 'localtime')
        AND status = 'completed'
    `, [collectorId], (err, row) => {
        console.log("Total Commission:", row.total);
    });

    db.get(`
        SELECT COUNT(*) as count
        FROM collector_payments 
        WHERE collector_id = ? 
        AND strftime('%Y-%m', collected_at) = strftime('%Y-%m', 'now', 'localtime')
        AND status = 'completed'
    `, [collectorId], (err, row) => {
        console.log("Total Payments Count:", row.count);
        db.close();
    });
});
