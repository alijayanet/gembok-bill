const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function fixPPNCheckboxIssue() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔧 Fixing PPN checkbox issue...');
        console.log('📋 Problem: Checkbox PPN checked by default, causing packages to have PPN even when unchecked');
        
        // Check current packages with PPN
        console.log('\n🔍 Current packages with PPN:');
        
        const packagesWithPPN = await new Promise((resolve, reject) => {
            db.all(`
                SELECT id, name, price, tax_rate, 
                       ROUND(price * (1 + tax_rate / 100)) as price_with_tax
                FROM packages 
                WHERE tax_rate > 0
                ORDER BY id DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (packagesWithPPN.length > 0) {
            console.log(`❌ Found ${packagesWithPPN.length} packages with PPN:`);
            packagesWithPPN.forEach(pkg => {
                console.log(`   - ${pkg.name}: Rp ${pkg.price?.toLocaleString()} + ${pkg.tax_rate}% = Rp ${pkg.price_with_tax?.toLocaleString()}`);
            });
        } else {
            console.log('✅ No packages with PPN found');
        }
        
        // Check packages without PPN
        const packagesWithoutPPN = await new Promise((resolve, reject) => {
            db.all(`
                SELECT id, name, price, tax_rate
                FROM packages 
                WHERE tax_rate = 0 OR tax_rate IS NULL
                ORDER BY id DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (packagesWithoutPPN.length > 0) {
            console.log(`\n✅ Found ${packagesWithoutPPN.length} packages without PPN:`);
            packagesWithoutPPN.forEach(pkg => {
                console.log(`   - ${pkg.name}: Rp ${pkg.price?.toLocaleString()} (No PPN)`);
            });
        }
        
        // Show the issue
        console.log('\n🔍 Issue Analysis:');
        console.log('   - Frontend checkbox has "checked" attribute by default');
        console.log('   - This causes PPN to be applied even when user unchecks');
        console.log('   - Need to remove default "checked" attribute');
        
        console.log('\n💡 Solution:');
        console.log('   1. Remove "checked" attribute from checkbox');
        console.log('   2. Set default tax_rate to 0');
        console.log('   3. Only apply PPN when checkbox is explicitly checked');
        
    } catch (error) {
        console.error('❌ Error analyzing PPN checkbox issue:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    fixPPNCheckboxIssue();
}

module.exports = fixPPNCheckboxIssue;
