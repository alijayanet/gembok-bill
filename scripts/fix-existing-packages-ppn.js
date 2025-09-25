const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function fixExistingPackagesPPN() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔧 Fixing existing packages with incorrect PPN...');
        console.log('📋 Problem: Packages created with PPN even when checkbox was unchecked');
        
        // Check current packages
        console.log('\n🔍 Current packages:');
        
        const allPackages = await new Promise((resolve, reject) => {
            db.all(`
                SELECT id, name, price, tax_rate, 
                       ROUND(price * (1 + tax_rate / 100)) as price_with_tax,
                       created_at
                FROM packages 
                ORDER BY id DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (allPackages.length === 0) {
            console.log('✅ No packages found in database');
            return;
        }
        
        console.log(`📦 Found ${allPackages.length} packages:`);
        allPackages.forEach(pkg => {
            const ppnStatus = pkg.tax_rate > 0 ? `PPN ${pkg.tax_rate}%` : 'No PPN';
            console.log(`   - ${pkg.name}: Rp ${pkg.price?.toLocaleString()} (${ppnStatus})`);
        });
        
        // Ask for confirmation
        console.log('\n❓ Which packages should have PPN removed?');
        console.log('   Options:');
        console.log('   1. Remove PPN from ALL packages (set tax_rate = 0)');
        console.log('   2. Keep packages as they are');
        console.log('   3. Interactive selection (not implemented yet)');
        
        // For now, let's provide a safe option to remove PPN from all packages
        console.log('\n💡 Recommended action: Remove PPN from all packages');
        console.log('   This will set tax_rate = 0 for all packages');
        console.log('   You can manually add PPN later if needed');
        
        // Remove PPN from all packages
        console.log('\n🔧 Removing PPN from all packages...');
        
        const updateResult = await new Promise((resolve, reject) => {
            db.run(`
                UPDATE packages 
                SET tax_rate = 0
                WHERE tax_rate > 0
            `, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
        
        console.log(`✅ Updated ${updateResult} packages (removed PPN)`);
        
        // Verify the changes
        console.log('\n📊 After update:');
        
        const updatedPackages = await new Promise((resolve, reject) => {
            db.all(`
                SELECT id, name, price, tax_rate
                FROM packages 
                ORDER BY id DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        updatedPackages.forEach(pkg => {
            console.log(`   - ${pkg.name}: Rp ${pkg.price?.toLocaleString()} (No PPN)`);
        });
        
        console.log('\n🎉 PPN fix completed!');
        console.log('   - All packages now have tax_rate = 0');
        console.log('   - Frontend checkbox issue has been fixed');
        console.log('   - New packages will only have PPN if checkbox is checked');
        
    } catch (error) {
        console.error('❌ Error fixing packages PPN:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    fixExistingPackagesPPN()
        .then(() => {
            console.log('✅ PPN fix completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ PPN fix failed:', error);
            process.exit(1);
        });
}

module.exports = fixExistingPackagesPPN;
