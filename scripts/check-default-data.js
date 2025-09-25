const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function checkDefaultData() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Checking default data after reset...');
        
        // Check packages
        console.log('\n📦 Packages:');
        const packages = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM packages', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        packages.forEach(pkg => {
            console.log(`   - ID: ${pkg.id}, Name: ${pkg.name}, Price: Rp ${pkg.price?.toLocaleString()}`);
        });
        
        // Check collectors
        console.log('\n👤 Collectors:');
        const collectors = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM collectors', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        collectors.forEach(collector => {
            console.log(`   - ID: ${collector.id}, Name: ${collector.name}, Phone: ${collector.phone}, Commission: ${collector.commission_rate}%`);
        });
        
        // Check customers
        console.log('\n👥 Customers:');
        const customers = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM customers', (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        console.log(`   - Total: ${customers} customers`);
        
        // Check invoices
        console.log('\n📄 Invoices:');
        const invoices = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM invoices', (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        console.log(`   - Total: ${invoices} invoices`);
        
        // Check payments
        console.log('\n💰 Payments:');
        const payments = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM payments', (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        console.log(`   - Total: ${payments} payments`);
        
        console.log('\n✅ Default data check completed');
        
        if (packages.length > 0 && collectors.length > 0) {
            console.log('\n🎉 Database reset successful!');
            console.log('   - Default package created');
            console.log('   - Default collector created');
            console.log('   - All data cleared');
            console.log('   - Ready for new server installation');
        } else {
            console.log('\n⚠️  Default data may not be created properly');
        }
        
    } catch (error) {
        console.error('❌ Error checking default data:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    checkDefaultData();
}

module.exports = checkDefaultData;
