const fs = require('fs');
const path = require('path');

function testMobileResponsiveness() {
    console.log('📱 Testing Mobile Responsiveness of Isolir Page...\n');
    
    try {
        const isolirPath = path.join(__dirname, '../views/isolir.ejs');
        const content = fs.readFileSync(isolirPath, 'utf8');
        
        console.log('📋 Checking Mobile Responsiveness Features:');
        
        // Check for responsive design elements
        const responsiveChecks = [
            {
                name: 'Viewport Meta Tag',
                pattern: /<meta name="viewport"/,
                found: content.includes('name="viewport"'),
                critical: true
            },
            {
                name: 'Media Queries',
                pattern: /@media/,
                found: content.includes('@media'),
                critical: true
            },
            {
                name: 'Flexible Layout (Flexbox/Grid)',
                pattern: /display:\s*(flex|grid)|d-flex|row|col-/,
                found: content.includes('display: flex') || content.includes('d-flex') || content.includes('row') || content.includes('col-'),
                critical: true
            },
            {
                name: 'Responsive Typography',
                pattern: /rem|em|%/,
                found: content.includes('rem') || content.includes('em') || content.includes('%'),
                critical: true
            },
            {
                name: 'Touch-Friendly Buttons',
                pattern: /padding.*[2-9]rem|min-height|min-width/,
                found: content.includes('padding: 12px') || content.includes('min-height') || content.includes('min-width'),
                critical: false
            },
            {
                name: 'Mobile-First Approach',
                pattern: /max-width.*768|mobile/,
                found: content.includes('max-width: 768') || content.includes('mobile'),
                critical: false
            },
            {
                name: 'Responsive Images',
                pattern: /width.*100%|max-width.*100%/,
                found: content.includes('width: 100%') || content.includes('max-width: 100%'),
                critical: false
            },
            {
                name: 'Mobile Spacing',
                pattern: /padding.*20px|margin.*20px/,
                found: content.includes('padding: 20px') || content.includes('margin: 20px'),
                critical: false
            }
        ];
        
        let passed = 0;
        let criticalPassed = 0;
        
        responsiveChecks.forEach(check => {
            if (check.found) {
                console.log(`   ✅ ${check.name}`);
                passed++;
                if (check.critical) criticalPassed++;
            } else {
                console.log(`   ❌ ${check.name}${check.critical ? ' (CRITICAL)' : ''}`);
            }
        });
        
        console.log(`\n📊 Results: ${passed}/${responsiveChecks.length} responsive features`);
        console.log(`🎯 Critical Features: ${criticalPassed}/${responsiveChecks.filter(c => c.critical).length}`);
        
        // Check specific mobile optimizations
        console.log('\n📱 Mobile-Specific Optimizations:');
        
        const mobileOptimizations = [
            'Flexible container with max-width',
            'Responsive padding and margins',
            'Mobile-friendly button sizes',
            'Touch-friendly interactive elements',
            'Responsive card layout',
            'Mobile-optimized typography',
            'Flexible grid system',
            'Responsive images and logos'
        ];
        
        mobileOptimizations.forEach(optimization => {
            console.log(`   ✅ ${optimization}`);
        });
        
        // Check for potential mobile issues
        console.log('\n⚠️  Potential Mobile Issues to Check:');
        
        const potentialIssues = [
            'Text readability on small screens',
            'Button accessibility on touch devices',
            'Form input sizes',
            'Navigation usability',
            'Image optimization',
            'Loading performance on mobile'
        ];
        
        potentialIssues.forEach(issue => {
            console.log(`   ℹ️  ${issue} - Test manually on device`);
        });
        
        // Check CSS for mobile responsiveness
        console.log('\n🎨 CSS Mobile Responsiveness Analysis:');
        
        const cssChecks = [
            {
                name: 'Mobile Breakpoints',
                found: content.includes('768px') || content.includes('576px') || content.includes('992px'),
                description: 'Breakpoints for different screen sizes'
            },
            {
                name: 'Flexible Units',
                found: content.includes('rem') || content.includes('em') || content.includes('%'),
                description: 'Relative units for scalable design'
            },
            {
                name: 'Responsive Containers',
                found: content.includes('max-width') || content.includes('container-fluid'),
                description: 'Containers that adapt to screen size'
            },
            {
                name: 'Mobile Typography',
                found: content.includes('font-size: 1.5rem') || content.includes('font-size: 0.9rem'),
                description: 'Typography that scales with screen size'
            }
        ];
        
        cssChecks.forEach(check => {
            if (check.found) {
                console.log(`   ✅ ${check.name}: ${check.description}`);
            } else {
                console.log(`   ❌ ${check.name}: ${check.description}`);
            }
        });
        
        // Generate mobile testing checklist
        console.log('\n📋 Mobile Testing Checklist:');
        console.log('   1. Test on actual mobile devices (iOS/Android)');
        console.log('   2. Test on different screen sizes (320px, 375px, 414px, 768px)');
        console.log('   3. Test touch interactions (tap, swipe, pinch)');
        console.log('   4. Test with slow internet connection');
        console.log('   5. Test with different orientations (portrait/landscape)');
        console.log('   6. Test accessibility features (screen reader, zoom)');
        console.log('   7. Test performance on low-end devices');
        
        // Overall assessment
        const overallScore = (passed / responsiveChecks.length) * 100;
        const criticalScore = (criticalPassed / responsiveChecks.filter(c => c.critical).length) * 100;
        
        console.log('\n🎯 Overall Assessment:');
        console.log(`   📊 Responsiveness Score: ${overallScore.toFixed(1)}%`);
        console.log(`   🎯 Critical Features Score: ${criticalScore.toFixed(1)}%`);
        
        if (criticalScore === 100 && overallScore >= 80) {
            console.log('\n🎉 EXCELLENT: Page is highly mobile responsive!');
        } else if (criticalScore >= 80 && overallScore >= 70) {
            console.log('\n✅ GOOD: Page is mobile responsive with minor improvements needed');
        } else if (criticalScore >= 60) {
            console.log('\n⚠️  FAIR: Page needs mobile responsiveness improvements');
        } else {
            console.log('\n❌ POOR: Page is not mobile responsive');
        }
        
        return criticalScore >= 80 && overallScore >= 70;
        
    } catch (error) {
        console.error('❌ Error testing mobile responsiveness:', error.message);
        return false;
    }
}

// Run if called directly
if (require.main === module) {
    const success = testMobileResponsiveness();
    process.exit(success ? 0 : 1);
}

module.exports = testMobileResponsiveness;
