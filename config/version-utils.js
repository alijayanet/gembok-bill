// version-utils.js - Utility functions untuk versioning di web admin

const fs = require('fs');
const path = require('path');

const versionPath = path.join(process.cwd(), 'version.json');

// In-memory cache untuk performa
let versionCache = null;
let lastModified = null;

function loadVersionFromFile() {
    try {
        const stats = fs.statSync(versionPath);
        const fileModified = stats.mtime.getTime();
        
        // Jika file tidak berubah dan cache masih valid, gunakan cache
        if (versionCache && lastModified === fileModified) {
            return versionCache;
        }
        
        // Baca file dan update cache
        const raw = fs.readFileSync(versionPath, 'utf-8');
        versionCache = JSON.parse(raw);
        lastModified = fileModified;
        
        return versionCache;
    } catch (e) {
        console.error('Error loading version.json:', e);
        return {
            version: '2.1.2',
            version_name: 'GEMBOK-BILLING',
            version_date: '2025-10-13',
            version_notes: 'No release notes',
            build_number: '20251013',
            changelog: []
        };
    }
}

/**
 * Dapatkan info versi aplikasi untuk web admin
 */
function getVersionInfo() {
    const versionData = loadVersionFromFile();
    const settings = require('./settingsManager').getSettingsWithCache();
    
    return {
        version: versionData.version || '2.1.2',
        versionName: versionData.version_name || 'Unknown Version',
        versionDate: versionData.version_date || 'Unknown Date',
        versionNotes: versionData.version_notes || 'No release notes',
        buildNumber: versionData.build_number || 'Unknown Build',
        companyHeader: settings.company_header || 'GEMBOK',
        footerInfo: settings.footer_info || 'Info Hubungi : 081947215703',
        changelog: versionData.changelog || []
    };
}

/**
 * Format versi untuk display di web
 */
function getVersionDisplay() {
    const versionInfo = getVersionInfo();
    
    return {
        shortVersion: `v${versionInfo.version}`,
        fullVersion: `${versionInfo.versionName} (v${versionInfo.version})`,
        buildInfo: `Build ${versionInfo.buildNumber}`,
        releaseDate: versionInfo.versionDate,
        releaseNotes: versionInfo.versionNotes
    };
}

/**
 * Format untuk badge versi
 */
function getVersionBadge() {
    const versionInfo = getVersionInfo();
    
    // Tentukan warna badge berdasarkan versi
    let badgeClass = 'badge-secondary';
    if (versionInfo.version.startsWith('3.')) {
        badgeClass = 'badge-danger'; // Major version
    } else if (versionInfo.version.startsWith('2.')) {
        badgeClass = 'badge-warning'; // Minor version
    } else if (versionInfo.version.startsWith('1.')) {
        badgeClass = 'badge-info'; // Patch version
    }
    
    return {
        text: `v${versionInfo.version}`,
        class: badgeClass,
        title: `${versionInfo.versionName} - ${versionInfo.versionDate}`
    };
}

/**
 * Format untuk footer versi
 */
function getVersionFooter() {
    const versionInfo = getVersionInfo();
    
    return {
        copyright: `© ${new Date().getFullYear()} ${versionInfo.companyHeader}`,
        version: `v${versionInfo.version}`,
        build: versionInfo.buildNumber,
        contact: versionInfo.footerInfo
    };
}

/**
 * Format untuk sidebar info
 */
function getSidebarVersionInfo() {
    const versionInfo = getVersionInfo();
    
    return {
        company: versionInfo.companyHeader,
        version: `v${versionInfo.version}`,
        build: versionInfo.buildNumber,
        date: versionInfo.versionDate
    };
}

/**
 * Format untuk dashboard header
 */
function getDashboardHeader() {
    const versionInfo = getVersionInfo();
    
    return {
        title: `${versionInfo.companyHeader}`,
        subtitle: `${versionInfo.versionName}`,
        version: `v${versionInfo.version}`,
        build: versionInfo.buildNumber
    };
}

module.exports = {
    getVersionInfo,
    getVersionDisplay,
    getVersionBadge,
    getVersionFooter,
    getSidebarVersionInfo,
    getDashboardHeader
};
