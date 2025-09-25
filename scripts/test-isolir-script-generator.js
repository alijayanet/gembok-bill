const fs = require('fs');
const path = require('path');

function testIsolirScriptGenerator() {
    console.log('🧪 Testing Isolir Script Generator in Admin Settings...\n');
    
    try {
        const adminSettingPath = path.join(__dirname, '../views/adminSetting.ejs');
        const content = fs.readFileSync(adminSettingPath, 'utf8');
        
        console.log('📋 Checking Isolir Script Generator Features:');
        
        const features = [
            {
                name: 'HTML Form Fields',
                patterns: [
                    /id="activeIp"/,
                    /id="isolirIp"/,
                    /id="isolirDomain"/,
                    /id="isolirPort"/
                ],
                description: 'Input fields for IP addresses, domain, and port'
            },
            {
                name: 'Generate Button',
                patterns: [
                    /onclick="generateIsolirScript\(\)"/,
                    /Generate Script/
                ],
                description: 'Button to generate Mikrotik script'
            },
            {
                name: 'Copy Button',
                patterns: [
                    /onclick="copyIsolirScript\(\)"/,
                    /Copy Script/
                ],
                description: 'Button to copy script to clipboard'
            },
            {
                name: 'JavaScript Functions',
                patterns: [
                    /function generateIsolirScript\(\)/,
                    /function copyIsolirScript\(\)/
                ],
                description: 'JavaScript functions for script generation and copying'
            },
            {
                name: 'Input Validation',
                patterns: [
                    /ipRegex/,
                    /Format IP tidak valid/,
                    /Mohon lengkapi semua field/
                ],
                description: 'Input validation for IP addresses and required fields'
            },
            {
                name: 'Script Content Generation',
                patterns: [
                    /Script Menu Isolir Mikrotik/,
                    /ppp profile add name="isolir"/,
                    /ip firewall nat add/
                ],
                description: 'Generation of Mikrotik script content'
            },
            {
                name: 'Auto-Generate Feature',
                patterns: [
                    /Auto-generate script saat input berubah/,
                    /addEventListener\('input'/
                ],
                description: 'Auto-generation when all fields are filled'
            },
            {
                name: 'UI Components',
                patterns: [
                    /command-card/,
                    /isolirScriptCard/,
                    /isolirScript/
                ],
                description: 'UI components for displaying generated script'
            }
        ];
        
        let totalChecks = 0;
        let passedChecks = 0;
        
        features.forEach(feature => {
            console.log(`\n🔍 ${feature.name}:`);
            console.log(`   Description: ${feature.description}`);
            
            let featurePassed = 0;
            feature.patterns.forEach(pattern => {
                totalChecks++;
                if (pattern.test(content)) {
                    console.log(`   ✅ Found: ${pattern.source}`);
                    featurePassed++;
                    passedChecks++;
                } else {
                    console.log(`   ❌ Missing: ${pattern.source}`);
                }
            });
            
            if (featurePassed === feature.patterns.length) {
                console.log(`   🎯 Status: PASSED (${featurePassed}/${feature.patterns.length})`);
            } else {
                console.log(`   ⚠️  Status: PARTIAL (${featurePassed}/${feature.patterns.length})`);
            }
        });
        
        // Check for specific Mikrotik commands
        console.log('\n📡 Checking Mikrotik Commands:');
        
        const mikrotikCommands = [
            'ppp profile add',
            'ip hotspot profile add',
            'ip firewall nat add',
            'ppp secret set',
            'rate-limit="0/0"',
            'dst-nat',
            'comment="Redirect isolir'
        ];
        
        mikrotikCommands.forEach(command => {
            totalChecks++;
            if (content.includes(command)) {
                console.log(`   ✅ Found: ${command}`);
                passedChecks++;
            } else {
                console.log(`   ❌ Missing: ${command}`);
            }
        });
        
        // Check for error handling
        console.log('\n🛡️ Checking Error Handling:');
        
        const errorHandling = [
            'showNotification',
            'Format IP tidak valid',
            'Mohon lengkapi semua field',
            'Tidak ada script untuk di-copy'
        ];
        
        errorHandling.forEach(handler => {
            totalChecks++;
            if (content.includes(handler)) {
                console.log(`   ✅ Found: ${handler}`);
                passedChecks++;
            } else {
                console.log(`   ❌ Missing: ${handler}`);
            }
        });
        
        // Overall assessment
        const successRate = (passedChecks / totalChecks) * 100;
        
        console.log('\n📊 Test Results:');
        console.log(`   Total Checks: ${totalChecks}`);
        console.log(`   Passed: ${passedChecks}`);
        console.log(`   Failed: ${totalChecks - passedChecks}`);
        console.log(`   Success Rate: ${successRate.toFixed(1)}%`);
        
        if (successRate >= 90) {
            console.log('\n🎉 EXCELLENT: Isolir Script Generator is fully implemented!');
        } else if (successRate >= 80) {
            console.log('\n✅ GOOD: Isolir Script Generator is mostly implemented!');
        } else if (successRate >= 70) {
            console.log('\n⚠️  FAIR: Isolir Script Generator needs some improvements!');
        } else {
            console.log('\n❌ POOR: Isolir Script Generator needs significant work!');
        }
        
        return successRate >= 80;
        
    } catch (error) {
        console.error('❌ Error testing isolir script generator:', error.message);
        return false;
    }
}

// Run if called directly
if (require.main === module) {
    const success = testIsolirScriptGenerator();
    process.exit(success ? 0 : 1);
}

module.exports = testIsolirScriptGenerator;
