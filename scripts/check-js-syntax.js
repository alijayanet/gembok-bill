const fs = require('fs');
const path = require('path');

function checkJSSyntax() {
    console.log('🔍 Checking JavaScript syntax in adminSetting.ejs...\n');
    
    try {
        const filePath = path.join(__dirname, '../views/adminSetting.ejs');
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Extract JavaScript code from <script> tags
        const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
        let match;
        let scriptCount = 0;
        
        while ((match = scriptRegex.exec(content)) !== null) {
            scriptCount++;
            const scriptContent = match[1];
            
            console.log(`📄 Script Block ${scriptCount}:`);
            console.log(`   Length: ${scriptContent.length} characters`);
            
            // Check for common syntax issues
            const issues = [];
            
            // Check for unclosed template literals
            const templateLiteralRegex = /`[^`]*\$\{[^}]*$/m;
            if (templateLiteralRegex.test(scriptContent)) {
                issues.push('❌ Unclosed template literal detected');
            }
            
            // Check for unclosed strings
            const stringRegex = /(['"`])([^'"]*?)(\1)/g;
            const allStrings = [];
            let stringMatch;
            while ((stringMatch = stringRegex.exec(scriptContent)) !== null) {
                allStrings.push(stringMatch[0]);
            }
            
            // Check for unmatched brackets
            const openBrackets = (scriptContent.match(/[{(]/g) || []).length;
            const closeBrackets = (scriptContent.match(/[})]/g) || []).length;
            
            if (openBrackets !== closeBrackets) {
                issues.push(`❌ Unmatched brackets: ${openBrackets} open, ${closeBrackets} close`);
            }
            
            // Check for unclosed comments
            const openComments = (scriptContent.match(/\/\*/g) || []).length;
            const closeComments = (scriptContent.match(/\*\//g) || []).length;
            
            if (openComments !== closeComments) {
                issues.push(`❌ Unclosed comments: ${openComments} open, ${closeComments} close`);
            }
            
            if (issues.length > 0) {
                console.log(`   Issues found:`);
                issues.forEach(issue => console.log(`   ${issue}`));
            } else {
                console.log(`   ✅ No obvious syntax issues detected`);
            }
            
            console.log('');
        }
        
        console.log(`📊 Summary: Found ${scriptCount} script blocks`);
        
        // Check for specific patterns that might cause issues
        console.log('\n🔍 Checking for specific patterns:');
        
        const patterns = [
            {
                name: 'Template literals with variables',
                pattern: /`[^`]*\$\{[^}]+\}[^`]*`/g,
                found: content.match(/`[^`]*\$\{[^}]+\}[^`]*`/g) || []
            },
            {
                name: 'Escaped backslashes',
                pattern: /\\\\/g,
                found: content.match(/\\\\/g) || []
            },
            {
                name: 'Unclosed template literals',
                pattern: /`[^`]*$/m,
                found: content.match(/`[^`]*$/m) || []
            }
        ];
        
        patterns.forEach(pattern => {
            console.log(`   ${pattern.name}: ${pattern.found.length} occurrences`);
            if (pattern.found.length > 0 && pattern.name === 'Unclosed template literals') {
                console.log(`   ⚠️  Potential issue: Unclosed template literal detected`);
                pattern.found.forEach((match, index) => {
                    console.log(`      ${index + 1}: ${match.substring(0, 50)}...`);
                });
            }
        });
        
        return true;
        
    } catch (error) {
        console.error('❌ Error checking JavaScript syntax:', error.message);
        return false;
    }
}

// Run if called directly
if (require.main === module) {
    const success = checkJSSyntax();
    process.exit(success ? 0 : 1);
}

module.exports = checkJSSyntax;
