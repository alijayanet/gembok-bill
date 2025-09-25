const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function verifyPPNFix() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Verifying PPN checkbox fix...');
        
        // Check packages
        const packages = await new Promise((resolve, reject) => {
            db.all(`
                SELECT id, name, price, tax_rate, 
                       ROUND(price * (1 + tax_rate / 100)) as price_with_tax
                FROM packages 
                ORDER BY id DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        console.log('\n📦 Packages in database:');
        if (packages.length === 0) {
            console.log('   ✅ No packages found (database clean)');
        } else {
            packages.forEach(pkg => {
                const ppnStatus = pkg.tax_rate === 0 ? 'No PPN ✅' : `PPN ${pkg.tax_rate}% ❌`;
                console.log(`   - ${pkg.name}: Rp ${pkg.price?.toLocaleString()} (${ppnStatus})`);
            });
        }
        
        // Check if any packages still have PPN
        const packagesWithPPN = packages.filter(pkg => pkg.tax_rate > 0);
        
        if (packagesWithPPN.length === 0) {
            console.log('\n✅ PPN Fix Status: SUCCESS');
            console.log('   - No packages have PPN');
            console.log('   - All packages have tax_rate = 0');
            console.log('   - Frontend checkbox issue fixed');
        } else {
            console.log('\n❌ PPN Fix Status: NEEDS ATTENTION');
            console.log(`   - ${packagesWithPPN.length} packages still have PPN`);
            console.log('   - Run fix script again if needed');
        }
        
        console.log('\n🎯 Next Steps:');
        console.log('   1. Test creating new package without PPN checkbox');
        console.log('   2. Verify checkbox is unchecked by default');
        console.log('   3. Verify PPN input is hidden when unchecked');
        console.log('   4. Test creating package with PPN checkbox checked');
        
    } catch (error) {
        console.error('❌ Error verifying PPN fix:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    verifyPPNFix();
}

module.exports = verifyPPNFix;
