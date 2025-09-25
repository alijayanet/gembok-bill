const fs = require('fs');
const path = require('path');

console.log('🔍 Checking Billing Sidebar Consistency...\n');

// List of billing view files
const billingViews = [
    'views/admin/billing/dashboard.ejs',
    'views/admin/billing/customers.ejs',
    'views/admin/billing/packages.ejs',
    'views/admin/billing/invoices.ejs',
    'views/admin/billing/auto-invoice.ejs',
    'views/admin/billing/invoices-by-type.ejs',
    'views/admin/billing/invoice-list.ejs',
    'views/admin/billing/payments.ejs',
    'views/admin/billing/all-payments.ejs',
    'views/admin/billing/collector-reports.ejs',
    'views/admin/billing/collector-remittance.ejs',
    'views/admin/billing/financial-report.ejs',
    'views/admin/billing/reports.ejs',
    'views/admin/billing/expenses.ejs',
    'views/admin/billing/payment-settings.ejs',
    'views/admin/billing/whatsapp-settings.ejs',
    'views/admin/billing/service-suspension.ejs',
    'views/admin/billing/mapping-new.ejs',
    'views/admin/billing/devices.ejs',
    'views/admin/billing/monthly-summary.ejs'
];

// Required elements for consistency
const requiredElements = {
    boxicons: '<link href="https://cdn.jsdelivr.net/npm/boxicons@',
    mainContent: 'class="col-md-9 ms-sm-auto col-lg-10 px-md-4 main-content',
    sidebarInclude: '<%- include(\'../../partials/billing-sidebar\') %>',
    containerFluid: '<div class="container-fluid">',
    row: '<div class="row">'
};

const issues = [];
const fixed = [];

console.log('📋 Checking each billing view file...\n');

billingViews.forEach(filePath => {
    if (fs.existsSync(filePath)) {
        console.log(`✅ Checking: ${filePath}`);
        
        const content = fs.readFileSync(filePath, 'utf8');
        const issuesForFile = [];
        
        // Check for required elements
        Object.entries(requiredElements).forEach(([element, pattern]) => {
            if (!content.includes(pattern)) {
                issuesForFile.push(`Missing ${element}: ${pattern}`);
            }
        });
        
        // Check for inconsistent styling
        if (content.includes('background-color: #f8f9fa') && !content.includes('main-content')) {
            issuesForFile.push('Has background-color but missing main-content class');
        }
        
        // Check for old sidebar includes (but exclude mobile navbar and bottom navbar)
        if (content.includes('admin-sidebar') || (content.includes('navbar') && !content.includes('mobile-navbar') && !content.includes('fixed-bottom'))) {
            issuesForFile.push('Using old sidebar instead of billing-sidebar');
        }
        
        if (issuesForFile.length > 0) {
            issues.push({
                file: filePath,
                issues: issuesForFile
            });
        } else {
            console.log(`   ✅ All checks passed`);
        }
        
    } else {
        console.log(`⚠️  File not found: ${filePath}`);
    }
});

console.log('\n📊 SUMMARY:\n');

if (issues.length === 0) {
    console.log('🎉 All billing views are consistent!');
} else {
    console.log(`❌ Found ${issues.length} files with issues:\n`);
    
    issues.forEach(({ file, issues: fileIssues }) => {
        console.log(`📁 ${file}:`);
        fileIssues.forEach(issue => {
            console.log(`   - ${issue}`);
        });
        console.log('');
    });
    
    console.log('🔧 RECOMMENDATIONS:\n');
    console.log('1. Ensure all billing views include:');
    console.log('   - boxicons CSS: <link href="https://cdn.jsdelivr.net/npm/boxicons@2.1.4/css/boxicons.min.css">');
    console.log('   - billing-sidebar: <%- include(\'../../partials/billing-sidebar\') %>');
    console.log('   - main-content class: class="col-md-9 ms-sm-auto col-lg-10 px-md-4 main-content"');
    console.log('   - container-fluid structure: <div class="container-fluid"><div class="row">');
    console.log('');
    console.log('2. Remove any custom CSS that conflicts with sidebar styles');
    console.log('3. Use consistent Bootstrap classes and structure');
    console.log('');
    console.log('4. All billing views should have this basic structure:');
    console.log('   <!DOCTYPE html>');
    console.log('   <html lang="id">');
    console.log('   <head>');
    console.log('       <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">');
    console.log('       <link href="https://cdn.jsdelivr.net/npm/boxicons@2.1.4/css/boxicons.min.css">');
    console.log('   </head>');
    console.log('   <body>');
    console.log('       <div class="container-fluid">');
    console.log('           <div class="row">');
    console.log('               <%- include(\'../../partials/billing-sidebar\') %>');
    console.log('               <main class="col-md-9 ms-sm-auto col-lg-10 px-md-4 main-content">');
    console.log('                   <!-- Content here -->');
    console.log('               </main>');
    console.log('           </div>');
    console.log('       </div>');
    console.log('   </body>');
    console.log('   </html>');
}

console.log('\n✨ Sidebar consistency check completed!');
