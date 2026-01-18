#!/usr/bin/env node

/**
 * Check Database Structure - Script untuk memeriksa struktur tabel dalam database
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function checkDatabaseStructure() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🔍 Checking database structure...\n');
        
        // Check if technicians table exists and its structure
        console.log('🔧 Checking technicians table...');
        const techniciansInfo = await new Promise((resolve, reject) => {
            db.all("PRAGMA table_info(technicians)", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        if (techniciansInfo.length > 0) {
            console.log('✅ Technicians table exists with columns:');
            techniciansInfo.forEach(col => {
                console.log(`   - ${col.name} (${col.type}) ${col.notnull ? 'NOT NULL' : ''} ${col.pk ? 'PRIMARY KEY' : ''}`);
            });
        } else {
            console.log('❌ Technicians table does not exist');
        }
        
        console.log('');
        
        // Check if installation_jobs table exists and its structure
        console.log('🔧 Checking installation_jobs table...');
        const installationJobsInfo = await new Promise((resolve, reject) => {
            db.all("PRAGMA table_info(installation_jobs)", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        if (installationJobsInfo.length > 0) {
            console.log('✅ Installation_jobs table exists with columns:');
            installationJobsInfo.forEach(col => {
                console.log(`   - ${col.name} (${col.type}) ${col.notnull ? 'NOT NULL' : ''} ${col.pk ? 'PRIMARY KEY' : ''}`);
            });
        } else {
            console.log('❌ Installation_jobs table does not exist');
        }
        
        console.log('');
        
        // Check if packages table exists
        console.log('🔧 Checking packages table...');
        const packagesInfo = await new Promise((resolve, reject) => {
            db.all("PRAGMA table_info(packages)", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        if (packagesInfo.length > 0) {
            console.log('✅ Packages table exists');
        } else {
            console.log('❌ Packages table does not exist');
        }
        
        console.log('');
        
        // Check if collectors table exists
        console.log('🔧 Checking collectors table...');
        const collectorsInfo = await new Promise((resolve, reject) => {
            db.all("PRAGMA table_info(collectors)", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        if (collectorsInfo.length > 0) {
            console.log('✅ Collectors table exists');
        } else {
            console.log('❌ Collectors table does not exist');
        }
        
        console.log('');
        
        // Check if customers table exists
        console.log('🔧 Checking customers table...');
        const customersInfo = await new Promise((resolve, reject) => {
            db.all("PRAGMA table_info(customers)", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        if (customersInfo.length > 0) {
            console.log('✅ Customers table exists');
        } else {
            console.log('❌ Customers table does not exist');
        }
        
        console.log('\n🎉 Database structure check completed!');
        
    } catch (error) {
        console.error('❌ Error checking database structure:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    checkDatabaseStructure()
        .then(() => {
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Database structure check failed:', error);
            process.exit(1);
        });
}

module.exports = checkDatabaseStructure;