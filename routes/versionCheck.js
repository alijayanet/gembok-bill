const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getVersionInfo } = require('../config/version-utils');

/**
 * Check for updates from GitHub
 */
router.get('/check-update', async (req, res) => {
    try {
        const versionInfo = getVersionInfo();
        
        // Get GitHub release info
        const githubRepo = versionInfo.github?.repo || 'https://api.github.com/repos/gembok-billing/gembok-bill/releases/latest';
        
        const response = await axios.get(githubRepo, {
            headers: {
                'User-Agent': 'GEMBOK-BILLING-UpdateChecker'
            },
            timeout: 10000
        });
        
        const latestRelease = response.data;
        const latestVersion = latestRelease.tag_name.replace(/^v/, '');
        const currentVersion = versionInfo.version;
        
        // Compare versions
        const hasUpdate = compareVersions(currentVersion, latestVersion);
        
        res.json({
            success: true,
            hasUpdate,
            currentVersion,
            latestVersion,
            latestRelease: {
                name: latestRelease.name,
                tagName: latestRelease.tag_name,
                publishedAt: latestRelease.published_at,
                body: latestRelease.body || 'No release notes available',
                htmlUrl: latestRelease.html_url,
                downloadUrl: latestRelease.html_url
            },
            changelog: versionInfo.changelog || []
        });
        
    } catch (error) {
        console.error('Error checking for updates:', error.message);
        res.json({
            success: false,
            error: 'Failed to check for updates',
            message: error.message
        });
    }
});

/**
 * Get current version info
 */
router.get('/current-version', (req, res) => {
    const versionInfo = getVersionInfo();
    res.json({
        success: true,
        version: versionInfo.version,
        versionName: versionInfo.versionName,
        versionDate: versionInfo.versionDate,
        buildNumber: versionInfo.buildNumber,
        changelog: versionInfo.changelog || []
    });
});

/**
 * Compare two version strings
 * Returns true if latestVersion > currentVersion
 */
function compareVersions(current, latest) {
    const parseVersion = (v) => {
        const parts = v.split('.').map(Number);
        while (parts.length < 3) parts.push(0);
        return parts;
    };
    
    const currentParts = parseVersion(current);
    const latestParts = parseVersion(latest);
    
    for (let i = 0; i < 3; i++) {
        if (latestParts[i] > currentParts[i]) {
            return true;
        } else if (latestParts[i] < currentParts[i]) {
            return false;
        }
    }
    
    return false; // Versions are equal
}

module.exports = router;
