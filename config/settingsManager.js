const fs = require('fs');
const path = require('path');
const performanceMonitor = require('./performanceMonitor');

const settingsPath = path.join(process.cwd(), 'settings.json');

// In-memory cache untuk performa
let settingsCache = null;
let lastModified = null;
let cacheExpiry = null;
const CACHE_TTL = 5000; // 5 detik cache

function loadSettingsFromFile() {
  const startTime = Date.now();
  let wasCacheHit = false;

  try {
    const stats = fs.statSync(settingsPath);
    const fileModified = stats.mtime.getTime();

    // Jika file tidak berubah dan cache masih valid, gunakan cache
    if (settingsCache &&
      lastModified === fileModified &&
      cacheExpiry &&
      Date.now() < cacheExpiry) {
      wasCacheHit = true;
      performanceMonitor.recordCall(startTime, wasCacheHit);
      return settingsCache;
    }

    // Baca file dan update cache
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    settingsCache = JSON.parse(raw);
    lastModified = fileModified;
    cacheExpiry = Date.now() + CACHE_TTL;

    performanceMonitor.recordCall(startTime, wasCacheHit);
    return settingsCache;
  } catch (e) {
    performanceMonitor.recordCall(startTime, wasCacheHit);
    // Jika ada error, return cache lama atau empty object
    return settingsCache || {};
  }
}

function getSettingsWithCache() {
  return loadSettingsFromFile();
}

function getSetting(key, defaultValue) {
  const settings = getSettingsWithCache();

  // 1. Try direct lookup first (for flat keys that contain dots, like "admins.0")
  if (settings[key] !== undefined) {
    return settings[key];
  }

  // 2. Try nested lookup (for nested objects like "telegram_bot": { "enabled": ... })
  if (key.includes('.')) {
    const parts = key.split('.');
    let current = settings;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return defaultValue;
      }
    }
    return current;
  }

  return defaultValue;
}

function setSetting(key, value) {
  try {
    const settings = getSettingsWithCache();
    settings[key] = value;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    // Invalidate cache setelah write
    settingsCache = settings;
    lastModified = fs.statSync(settingsPath).mtime.getTime();
    cacheExpiry = Date.now() + CACHE_TTL;

    return true;
  } catch (e) {
    return false;
  }
}

// Clear cache function untuk debugging/maintenance
function clearSettingsCache() {
  settingsCache = null;
  lastModified = null;
  cacheExpiry = null;
}

module.exports = {
  getSettingsWithCache,
  getSetting,
  setSetting,
  clearSettingsCache,
  getPerformanceStats: () => performanceMonitor.getStats(),
  getPerformanceReport: () => performanceMonitor.getPerformanceReport(),
  getQuickStats: () => performanceMonitor.getQuickStats()
};