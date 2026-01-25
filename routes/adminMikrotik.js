const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const { 
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

// GET: List User PPPoE
router.get('/mikrotik', adminAuth, async (req, res) => {
  try {
    const users = await getPPPoEUsers();
    const settings = getSettingsWithCache();
    res.render('adminMikrotik', {
      users,
      settings,
      page: 'mikrotik',
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  } catch (err) {
    const settings = getSettingsWithCache();
    res.render('adminMikrotik', {
      users: [],
      error: 'Gagal mengambil data user PPPoE.',
      settings,
      page: 'mikrotik',
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// POST: Tambah User PPPoE
router.post('/mikrotik/add-user', adminAuth, async (req, res) => {
  try {
    const { username, password, profile } = req.body;
    await addPPPoEUser({ username, password, profile });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit User PPPoE
router.post('/mikrotik/edit-user', adminAuth, async (req, res) => {
  try {
    const { id, username, password, profile } = req.body;
    await editPPPoEUser({ id, username, password, profile });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Hapus User PPPoE
router.post('/mikrotik/delete-user', adminAuth, async (req, res) => {
  try {
    const { id } = req.body;
    await deletePPPoEUser(id);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET: List Profile PPPoE
router.get('/mikrotik/profiles', adminAuth, async (req, res) => {
  try {
    const result = await getPPPoEProfiles();
    const settings = getSettingsWithCache();
    if (result.success) {
      res.render('adminMikrotikProfiles', {
        profiles: result.data,
        settings,
        page: 'mikrotik-profiles',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
      });
    } else {
      res.render('adminMikrotikProfiles', {
        profiles: [],
        error: result.message,
        settings,
        page: 'mikrotik-profiles',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
      });
    }
  } catch (err) {
    const settings = getSettingsWithCache();
    res.render('adminMikrotikProfiles', {
      profiles: [],
      error: 'Gagal mengambil data profile PPPoE.',
      settings,
      page: 'mikrotik-profiles',
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// GET: API Daftar Profile PPPoE (untuk dropdown)
router.get('/mikrotik/profiles/api', adminAuth, async (req, res) => {
  try {
    const result = await getPPPoEProfiles();
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
    const result = await getPPPoEProfileDetail(id);
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
    const result = await addPPPoEProfile(req.body);
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
    const result = await editPPPoEProfile(req.body);
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
    const result = await deletePPPoEProfile(id);
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
    const result = await getHotspotProfiles();
    const settings = getSettingsWithCache();
    if (result.success) {
      res.render('adminMikrotikHotspotProfiles', {
        profiles: result.data,
        settings,
        page: 'hotspot-profiles',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
      });
    } else {
      res.render('adminMikrotikHotspotProfiles', {
        profiles: [],
        error: result.message,
        settings,
        page: 'hotspot-profiles',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
      });
    }
  } catch (err) {
    const settings = getSettingsWithCache();
    res.render('adminMikrotikHotspotProfiles', {
      profiles: [],
      error: 'Gagal mengambil data profile Hotspot.',
      settings,
      page: 'hotspot-profiles',
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// GET: API Daftar Profile Hotspot
router.get('/mikrotik/hotspot-profiles/api', adminAuth, async (req, res) => {
  try {
    const result = await getHotspotProfiles();
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
    const result = await getHotspotProfileDetail(id);
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
    const result = await addHotspotProfile(req.body);
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
    const result = await editHotspotProfile(req.body);
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
    const result = await deleteHotspotProfile(id);
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
    const users = await getPPPoEUsers();
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
    const result = await restartRouter();
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
