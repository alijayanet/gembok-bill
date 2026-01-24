const express = require('express');
const router = express.Router();
const cacheManager = require('../config/cacheManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');
const logger = require('../config/logger');

// Middleware untuk admin authentication - menggunakan format yang sama dengan adminAuth.js
const adminAuth = (req, res, next) => {
    // Debug session info
    console.log('🔍 Cache Management Auth Check:', {
        hasSession: !!req.session,
        isAdmin: req.session?.isAdmin,
        adminUser: req.session?.adminUser
    });
    
    if (req.session && req.session.isAdmin) {
        next();
    } else {
        // Redirect to login page instead of JSON response for web requests
        if (req.accepts('html')) {
            res.redirect('/admin/login');
        } else {
            res.status(401).json({ 
                success: false, 
                message: 'Unauthorized',
                debug: {
                    hasSession: !!req.session,
                    isAdmin: req.session?.isAdmin
                }
            });
        }
    }
};

// Cache management page
router.get('/', adminAuth, (req, res) => {
    res.render('admin/cache-management', {
        page: 'cache',
        title: 'Cache Management',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
    });
});

// Get cache statistics
router.get('/stats', adminAuth, (req, res) => {
    try {
        const stats = cacheManager.getStats();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        logger.error('Error getting cache stats:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting cache statistics'
        });
    }
});

// Get cache entries by pattern
router.get('/entries', adminAuth, (req, res) => {
    try {
        const pattern = req.query.pattern || '*';
        const entries = cacheManager.getEntriesByPattern(pattern);
        
        res.json({
            success: true,
            data: {
                pattern,
                count: entries.length,
                entries: entries.map(entry => ({
                    key: entry.key,
                    age: Date.now() - entry.createdAt,
                    expiresIn: entry.expiresAt - Date.now(),
                    size: JSON.stringify(entry.value).length
                }))
            }
        });
    } catch (error) {
        logger.error('Error getting cache entries:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting cache entries'
        });
    }
});

// Clear specific cache entry
router.delete('/entry/:key', adminAuth, (req, res) => {
    try {
        const key = decodeURIComponent(req.params.key);
        const deleted = cacheManager.delete(key);
        
        res.json({
            success: true,
            message: deleted ? 'Cache entry deleted' : 'Cache entry not found',
            deleted
        });
    } catch (error) {
        logger.error('Error deleting cache entry:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting cache entry'
        });
    }
});

// Clear cache entries by pattern
router.delete('/pattern/:pattern', adminAuth, (req, res) => {
    try {
        const pattern = decodeURIComponent(req.params.pattern);
        const entries = cacheManager.getEntriesByPattern(pattern);
        
        cacheManager.invalidatePattern(pattern);
        
        res.json({
            success: true,
            message: `Cleared ${entries.length} cache entries matching pattern: ${pattern}`,
            cleared: entries.length
        });
    } catch (error) {
        logger.error('Error clearing cache pattern:', error);
        res.status(500).json({
            success: false,
            message: 'Error clearing cache pattern'
        });
    }
});

// Clear all cache
router.delete('/all', adminAuth, (req, res) => {
    try {
        const stats = cacheManager.getStats();
        cacheManager.clear();
        
        res.json({
            success: true,
            message: `Cleared all cache (${stats.totalEntries} entries)`,
            cleared: stats.totalEntries
        });
    } catch (error) {
        logger.error('Error clearing all cache:', error);
        res.status(500).json({
            success: false,
            message: 'Error clearing all cache'
        });
    }
});

// Clear specific service cache
router.delete('/service/:service', adminAuth, (req, res) => {
    try {
        const service = req.params.service;
        const pattern = `${service}:*`;
        const entries = cacheManager.getEntriesByPattern(pattern);
        
        cacheManager.invalidatePattern(pattern);
        
        res.json({
            success: true,
            message: `Cleared ${entries.length} cache entries for service: ${service}`,
            cleared: entries.length
        });
    } catch (error) {
        logger.error('Error clearing service cache:', error);
        res.status(500).json({
            success: false,
            message: 'Error clearing service cache'
        });
    }
});

// Get cache health status
router.get('/health', adminAuth, (req, res) => {
    try {
        const stats = cacheManager.getStats();
        const memoryUsage = process.memoryUsage();
        
        const health = {
            status: 'healthy',
            cache: {
                totalEntries: stats.totalEntries,
                validEntries: stats.validEntries,
                expiredEntries: stats.expiredEntries,
                averageAge: stats.averageAge,
                memoryUsage: stats.memoryUsage
            },
            system: {
                heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                external: Math.round(memoryUsage.external / 1024 / 1024),
                rss: Math.round(memoryUsage.rss / 1024 / 1024)
            },
            uptime: process.uptime()
        };
        
        // Check if cache is healthy
        if (stats.expiredEntries > stats.validEntries) {
            health.status = 'warning';
            health.message = 'High number of expired entries';
        }
        
        if (memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
            health.status = 'warning';
            health.message = 'High memory usage';
        }
        
        res.json({
            success: true,
            data: health
        });
    } catch (error) {
        logger.error('Error getting cache health:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting cache health'
        });
    }
});

module.exports = router;
