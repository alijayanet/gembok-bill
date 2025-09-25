const fs = require('fs');
const path = require('path');

console.log('🔍 Checking Admin Sidebar Consistency...\n');

// List of admin view files
const adminViews = [
    'views/adminDashboard.ejs',
    'views/adminGenieacs.ejs',
    'views/adminMikrotik.ejs',
    'views/adminMikrotikProfiles.ejs',
    'views/adminMikrotikHotspotProfiles.ejs',
    'views/adminHotspot.ejs',
    'views/adminVoucher.ejs',
    'views/adminSetting.ejs',
    'views/admin/trouble-reports.ejs',
    'views/admin/cache-management.ejs',
    'views/admin/installation-jobs.ejs',
    'views/admin/installation-job-form.ejs',
    'views/admin/installation-job-detail.ejs',
    'views/admin/technicians.ejs',
    'views/admin/trouble-report-detail.ejs'
];

// Required elements for consistency
const requiredElements = {
    bootstrap: '<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css"',
    bootstrapIcons: '<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@',
    adminResponsiveSidebar: '<%- include(\'partials/admin-responsive-sidebar\'',
    containerFluid: '<div class="container-fluid">',
    row: '<div class="row">',
    mainContent: 'col-md-10.*main-content'
};

const issues = [];
const fixed = [];

console.log('📋 Checking each admin view file...\n');

adminViews.forEach(filePath => {
    if (fs.existsSync(filePath)) {
        console.log(`✅ Checking: ${filePath}`);
        
        const content = fs.readFileSync(filePath, 'utf8');
        const issuesForFile = [];
        
        // Check for required elements
        Object.entries(requiredElements).forEach(([element, pattern]) => {
            if (element === 'mainContent') {
                // Special check for main content - look for both col-md-10 and main-content
                if (!content.includes('col-md-10') || !content.includes('main-content')) {
                    issuesForFile.push(`Missing ${element}: col-md-10 and main-content classes`);
                }
            } else {
                if (!content.includes(pattern)) {
                    issuesForFile.push(`Missing ${element}: ${pattern}`);
                }
            }
        });
        
        // Check for inconsistent styling
        if (content.includes('background: #f5f6fa') && !content.includes('main-content')) {
            issuesForFile.push('Has background-color but missing main-content class');
        }
        
        // Check for old sidebar includes
        if (content.includes('admin-sidebar') && !content.includes('admin-responsive-sidebar')) {
            issuesForFile.push('Using old admin-sidebar instead of admin-responsive-sidebar');
        }
        
        // Check for missing mobile responsive features (only if not using admin-responsive-sidebar)
        if (!content.includes('admin-responsive-sidebar') && !content.includes('mobile-navbar') && !content.includes('sidebar-overlay')) {
            issuesForFile.push('Missing mobile responsive features');
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
    console.log('🎉 All admin views are consistent!');
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
    console.log('1. Ensure all admin views include:');
    console.log('   - Bootstrap CSS: <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">');
    console.log('   - Bootstrap Icons: <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css">');
    console.log('   - Admin Responsive Sidebar: <%- include(\'partials/admin-responsive-sidebar\', { page: \'pageName\', settings: settings }) %>');
    console.log('   - Container-fluid structure: <div class="container-fluid"><div class="row">');
    console.log('   - Main content class: class="col-md-10 ms-sm-auto col-lg-10 px-md-4 main-content"');
    console.log('');
    console.log('2. Remove any custom CSS that conflicts with sidebar styles');
    console.log('3. Use consistent Bootstrap classes and structure');
    console.log('');
    console.log('4. All admin views should have this basic structure:');
    console.log('   <!DOCTYPE html>');
    console.log('   <html lang="id">');
    console.log('   <head>');
    console.log('       <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">');
    console.log('       <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css">');
    console.log('   </head>');
    console.log('   <body>');
    console.log('       <div class="container-fluid">');
    console.log('           <div class="row">');
    console.log('               <%- include(\'partials/admin-responsive-sidebar\', { page: \'pageName\', settings: settings }) %>');
    console.log('               <main class="col-md-10 ms-sm-auto col-lg-10 px-md-4 main-content">');
    console.log('                   <!-- Content here -->');
    console.log('               </main>');
    console.log('           </div>');
    console.log('       </div>');
    console.log('   </body>');
    console.log('   </html>');
}

console.log('\n✨ Admin sidebar consistency check completed!');
