const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const { 
    listMikrotikRouters,
    getPPPoEUsers, 
    addPPPoEUser, 
    editPPPoEUser, 
    deletePPPoEUser, 
    getPPPoEProfiles, 
    addPPPoEProfile, 
    editPPPoEProfile, 
    deletePPPoEProfile, 
    getPPPoEProfileDetail,
    getHotspotProfiles,
    addHotspotProfile,
    editHotspotProfile,
    deleteHotspotProfile,
    getHotspotProfileDetail
} = require('../config/mikrotik');
const { kickPPPoEUser } = require('../config/mikrotik2');
const fs = require('fs');
const path = require('path');
const { getSettingsWithCache } = require('../config/settingsManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');

function getRouterIdFromReq(req) {
  return (req.query && (req.query.routerId || req.query.router_id)) || (req.body && (req.body.routerId || req.body.router_id)) || null;
}

// GET: List User PPPoE
router.get('/mikrotik', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const { routers, defaultRouterId } = listMikrotikRouters();
    const selectedRouterId = routerId || defaultRouterId || null;

    const users = await getPPPoEUsers({ routerId: selectedRouterId });
    const settings = getSettingsWithCache();
    res.render('adminMikrotik', {
      users,
      settings,
      routers,
      selectedRouterId,
      page: 'mikrotik',
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  } catch (err) {
    const routerId = getRouterIdFromReq(req);
    const { routers, defaultRouterId } = listMikrotikRouters();
    const selectedRouterId = routerId || defaultRouterId || null;
    const settings = getSettingsWithCache();
    res.render('adminMikrotik', {
      users: [],
      error: 'Gagal mengambil data user PPPoE.',
      settings,
      routers,
      selectedRouterId,
      page: 'mikrotik',
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// GET: API daftar router Mikrotik (untuk dropdown UI)
router.get('/mikrotik/routers', adminAuth, (req, res) => {
  try {
    const { routers, defaultRouterId } = listMikrotikRouters();
    res.json({ success: true, routers, defaultRouterId });
  } catch (err) {
    res.json({ success: false, routers: [], defaultRouterId: null, message: err.message });
  }
});

// POST: Tambah User PPPoE
router.post('/mikrotik/add-user', adminAuth, async (req, res) => {
  try {
    const { username, password, profile } = req.body;
    const routerId = getRouterIdFromReq(req);
    await addPPPoEUser({ username, password, profile }, { routerId });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit User PPPoE
router.post('/mikrotik/edit-user', adminAuth, async (req, res) => {
  try {
    const { id, username, password, profile } = req.body;
    const routerId = getRouterIdFromReq(req);
    await editPPPoEUser({ id, username, password, profile }, { routerId });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Hapus User PPPoE
router.post('/mikrotik/delete-user', adminAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const routerId = getRouterIdFromReq(req);
    await deletePPPoEUser(id, { routerId });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET: List Profile PPPoE
router.get('/mikrotik/profiles', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const { routers, defaultRouterId } = listMikrotikRouters();
    const selectedRouterId = routerId || defaultRouterId || null;

    const result = await getPPPoEProfiles({ routerId: selectedRouterId });
    const settings = getSettingsWithCache();
    if (result.success) {
      res.render('adminMikrotikProfiles', {
        profiles: result.data,
        settings,
        routers,
        selectedRouterId,
        page: 'mikrotik-profiles',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
      });
    } else {
      res.render('adminMikrotikProfiles', {
        profiles: [],
        error: result.message,
        settings,
        routers,
        selectedRouterId,
        page: 'mikrotik-profiles',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
      });
    }
  } catch (err) {
    const routerId = getRouterIdFromReq(req);
    const { routers, defaultRouterId } = listMikrotikRouters();
    const selectedRouterId = routerId || defaultRouterId || null;
    const settings = getSettingsWithCache();
    res.render('adminMikrotikProfiles', {
      profiles: [],
      error: 'Gagal mengambil data profile PPPoE.',
      settings,
      routers,
      selectedRouterId,
      page: 'mikrotik-profiles',
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// GET: API Daftar Profile PPPoE (untuk dropdown)
router.get('/mikrotik/profiles/api', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const result = await getPPPoEProfiles({ routerId });
    if (result.success) {
      res.json({ success: true, profiles: result.data });
    } else {
      res.json({ success: false, profiles: [], message: result.message });
    }
  } catch (err) {
    res.json({ success: false, profiles: [], message: err.message });
  }
});

// GET: API Detail Profile PPPoE
router.get('/mikrotik/profile/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const routerId = getRouterIdFromReq(req);
    const result = await getPPPoEProfileDetail(id, { routerId });
    if (result.success) {
      res.json({ success: true, profile: result.data });
    } else {
      res.json({ success: false, profile: null, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, profile: null, message: err.message });
  }
});

// POST: Tambah Profile PPPoE
router.post('/mikrotik/add-profile', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const result = await addPPPoEProfile(req.body, { routerId });
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit Profile PPPoE
router.post('/mikrotik/edit-profile', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const result = await editPPPoEProfile(req.body, { routerId });
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Hapus Profile PPPoE
router.post('/mikrotik/delete-profile', adminAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const routerId = getRouterIdFromReq(req);
    const result = await deletePPPoEProfile(id, { routerId });
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET: List Profile Hotspot
router.get('/mikrotik/hotspot-profiles', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const { routers, defaultRouterId } = listMikrotikRouters();
    const selectedRouterId = routerId || defaultRouterId || null;

    const result = await getHotspotProfiles({ routerId: selectedRouterId });
    const settings = getSettingsWithCache();
    if (result.success) {
      res.render('adminMikrotikHotspotProfiles', {
        profiles: result.data,
        settings,
        routers,
        selectedRouterId,
        page: 'hotspot-profiles',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
      });
    } else {
      res.render('adminMikrotikHotspotProfiles', {
        profiles: [],
        error: result.message,
        settings,
        routers,
        selectedRouterId,
        page: 'hotspot-profiles',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
      });
    }
  } catch (err) {
    const routerId = getRouterIdFromReq(req);
    const { routers, defaultRouterId } = listMikrotikRouters();
    const selectedRouterId = routerId || defaultRouterId || null;
    const settings = getSettingsWithCache();
    res.render('adminMikrotikHotspotProfiles', {
      profiles: [],
      error: 'Gagal mengambil data profile Hotspot.',
      settings,
      routers,
      selectedRouterId,
      page: 'hotspot-profiles',
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// GET: API Daftar Profile Hotspot
router.get('/mikrotik/hotspot-profiles/api', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const result = await getHotspotProfiles({ routerId });
    if (result.success) {
      res.json({ success: true, profiles: result.data });
    } else {
      res.json({ success: false, profiles: [], message: result.message });
    }
  } catch (err) {
    res.json({ success: false, profiles: [], message: err.message });
  }
});

// GET: API Detail Profile Hotspot
router.get('/mikrotik/hotspot-profiles/detail/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const routerId = getRouterIdFromReq(req);
    const result = await getHotspotProfileDetail(id, { routerId });
    if (result.success) {
      res.json({ success: true, profile: result.data });
    } else {
      res.json({ success: false, profile: null, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, profile: null, message: err.message });
  }
});

// POST: Tambah Profile Hotspot
router.post('/mikrotik/hotspot-profiles/add', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const result = await addHotspotProfile(req.body, { routerId });
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit Profile Hotspot
router.post('/mikrotik/hotspot-profiles/edit', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const result = await editHotspotProfile(req.body, { routerId });
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Hapus Profile Hotspot
router.post('/mikrotik/hotspot-profiles/delete', adminAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const routerId = getRouterIdFromReq(req);
    const result = await deleteHotspotProfile(id, { routerId });
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Putuskan sesi PPPoE user
router.post('/mikrotik/disconnect-session', adminAuth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ success: false, message: 'Username tidak boleh kosong' });
    const result = await kickPPPoEUser(username);
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET: Get PPPoE user statistics
router.get('/mikrotik/user-stats', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const users = await getPPPoEUsers({ routerId });
    const totalUsers = Array.isArray(users) ? users.length : (users ? 1 : 0);
    const activeUsers = Array.isArray(users) ? users.filter(u => u.active).length : (users && users.active ? 1 : 0);
    const offlineUsers = totalUsers - activeUsers;
    
    res.json({ 
      success: true, 
      totalUsers, 
      activeUsers, 
      offlineUsers 
    });
  } catch (err) {
    console.error('Error getting PPPoE user stats:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message,
      totalUsers: 0,
      activeUsers: 0,
      offlineUsers: 0
    });
  }
});

// POST: Restart Mikrotik
router.post('/mikrotik/restart', adminAuth, async (req, res) => {
  try {
    const { restartRouter } = require('../config/mikrotik');
    const routerId = getRouterIdFromReq(req);
    const result = await restartRouter({ routerId });
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
