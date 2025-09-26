const express = require('express');
const router = express.Router();
const { getSettingsWithCache } = require('../config/settingsManager');

// GET: Render halaman Public Tools
router.get('/', async (req, res) => {
    try {
        const settings = await getSettingsWithCache();
        const year = new Date().getFullYear();

        res.render('public-tools', { 
            title: 'Public Tools - Generator Script Mikrotik',
            description: 'Generator script Mikrotik untuk konfigurasi jaringan - Gratis dan Open Source',
            settings,
            year
        });
    } catch (error) {
        res.render('public-tools', { 
            title: 'Public Tools - Generator Script Mikrotik',
            description: 'Generator script Mikrotik untuk konfigurasi jaringan - Gratis dan Open Source',
            settings: {},
            year: new Date().getFullYear()
        });
    }
});

// GET: API untuk generate script (optional - bisa digunakan untuk future enhancement)
router.get('/api/generate/:type', (req, res) => {
    const { type } = req.params;
    const { query } = req;
    
    try {
        let script = '';
        
        switch (type) {
            case 'isolir':
                script = generateIsolirScript(query);
                break;
            case 'dns-genieacs':
                script = generateDNSGenieACSScript(query);
                break;
            case 'option43':
                script = generateOption43Script(query);
                break;
            case 'isolation':
                script = generateIsolationScript(query);
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Tipe script tidak valid'
                });
        }
        
        res.json({
            success: true,
            script: script,
            type: type,
            generated_at: new Date().toISOString()
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error generating script: ' + error.message
        });
    }
});

// Helper functions untuk generate script
function generateIsolirScript(params) {
    const { activeIp, isolirIp, isolirDomain, isolirPath, isolirPort, accessType } = params;
    
    return `# ===========================================
# MIKROTIK ISOLIR SCRIPT
# ===========================================
# Generated: ${new Date().toLocaleString('id-ID')}
# Active IP: ${activeIp}
# Isolir IP: ${isolirIp}
# Domain: ${isolirDomain}
# Path: ${isolirPath}
# Port: ${isolirPort}
# Access Type: ${accessType}
# ===========================================

# ===========================================
# 1. SETUP DNS STATIC
# ===========================================

# Hapus DNS static lama
/ip dns static remove [find where name="${isolirDomain}" and address="${isolirIp}"]

# Tambahkan DNS static
/ip dns static add name="${isolirDomain}" address="${isolirIp}" ttl=300

# ===========================================
# 2. SETUP NAT RULES
# ===========================================

# Hapus NAT rules lama
/ip firewall nat remove [find comment="isolir-redirect"]

# Redirect HTTP
/ip firewall nat add chain=dstnat dst-address=${isolirIp}/32 dst-port=80 protocol=tcp action=dst-nat to-addresses=${isolirDomain} to-ports=${isolirPort} comment="isolir-redirect"

# Redirect HTTPS
/ip firewall nat add chain=dstnat dst-address=${isolirIp}/32 dst-port=443 protocol=tcp action=dst-nat to-addresses=${isolirDomain} to-ports=${isolirPort} comment="isolir-redirect-https"

# ===========================================
# 3. SETUP FIREWALL RULES
# ===========================================

# Hapus firewall rules lama
/ip firewall filter remove [find comment="isolir-allow"]

# Allow DNS queries
/ip firewall filter add chain=forward src-address=${isolirIp}/32 dst-address=${isolirDomain} dst-port=53 protocol=udp action=accept comment="isolir-allow-dns"

# Allow HTTP/HTTPS to application
/ip firewall filter add chain=forward src-address=${isolirIp}/32 dst-address=${isolirDomain} dst-port=${isolirPort} protocol=tcp action=accept comment="isolir-allow-http"

# ===========================================
# 4. VERIFIKASI
# ===========================================

:put "=== VERIFIKASI KONFIGURASI ==="
:put "Active IP: ${activeIp}"
:put "Isolir IP: ${isolirIp}"
:put "Domain: ${isolirDomain}"
:put "Port: ${isolirPort}"
:put "Script berhasil dijalankan!"`;
}

function generateDNSGenieACSScript(params) {
    const { genieacsServerIp, genieacsPort, pppoeRange, dnsBackup } = params;
    
    return `# ===========================================
# MIKROTIK DNS GENIEACS CONFIGURATION SCRIPT
# ===========================================
# Generated: ${new Date().toLocaleString('id-ID')}
# GenieACS Server: ${genieacsServerIp}:${genieacsPort}
# PPPoE Range: ${pppoeRange}
# DNS Backup: ${dnsBackup}
# ===========================================

# ===========================================
# 1. SETUP DNS STATIC
# ===========================================

# Hapus DNS static lama
/ip dns static remove [find where name="genieacs.local" and address="${genieacsServerIp}"]
/ip dns static remove [find where name="tr069.local" and address="${genieacsServerIp}"]

# Tambahkan DNS static
/ip dns static add name="genieacs.local" address="${genieacsServerIp}" ttl=300 comment="GenieACS Server"
/ip dns static add name="tr069.local" address="${genieacsServerIp}" ttl=300 comment="TR069 Server"

# ===========================================
# 2. SETUP DHCP SERVER DNS
# ===========================================

# Update DHCP server
/ip dhcp-server network set [find address="${pppoeRange}"] dns-server="${genieacsServerIp},${dnsBackup}" comment="GenieACS DNS Configuration"

# ===========================================
# 3. SETUP NAT RULES
# ===========================================

# Hapus NAT rules lama
/ip firewall nat remove [find comment="genieacs-tr069-redirect"]

# Redirect TR069 HTTP
/ip firewall nat add chain=dstnat dst-port=7547 protocol=tcp action=dst-nat to-addresses=${genieacsServerIp} to-ports=${genieacsPort} comment="genieacs-tr069-redirect"

# ===========================================
# 4. SETUP FIREWALL RULES
# ===========================================

# Hapus firewall rules lama
/ip firewall filter remove [find comment="genieacs-allow-tr069"]

# Allow TR069 communication
/ip firewall filter add chain=forward src-address=${pppoeRange} dst-address=${genieacsServerIp} dst-port=${genieacsPort} protocol=tcp action=accept comment="genieacs-allow-tr069"

# Allow DNS queries
/ip firewall filter add chain=forward src-address=${pppoeRange} dst-address=${genieacsServerIp} dst-port=53 protocol=udp action=accept comment="genieacs-allow-dns"

# ===========================================
# 5. SETUP PPP PROFILE
# ===========================================

# Update PPP profile
/ppp profile set [find name="default"] dns-server="${genieacsServerIp},${dnsBackup}" comment="GenieACS DNS Configuration"

# ===========================================
# 6. VERIFIKASI
# ===========================================

:put "=== VERIFIKASI KONFIGURASI ==="
:put "GenieACS Server: ${genieacsServerIp}:${genieacsPort}"
:put "PPPoE Range: ${pppoeRange}"
:put "DNS Backup: ${dnsBackup}"
:put "Script berhasil dijalankan!"`;
}

function generateOption43Script(params) {
    const { genieacsUrl } = params;
    
    // Convert URL to hex
    const hex = Array.from(genieacsUrl).map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    
    return `# DHCP Option 43 untuk GenieACS
# URL: ${genieacsUrl}
# Hex: ${hex}

# Mikrotik Script:
/ip dhcp-server option add name="genieacs" code=43 value="0x${hex}"

# Atau gunakan di DHCP Server Network:
/ip dhcp-server network set [find address="192.168.1.0/24"] dhcp-option="genieacs"`;
}

function generateIsolationScript(params) {
    const { method, bandwidthLimit, networkRange, dnsServers } = params;
    
    let script = `# ===========================================
# MIKROTIK ISOLATION SCRIPT
# ===========================================
# Generated: ${new Date().toLocaleString('id-ID')}
# Method: ${method}
# Network: ${networkRange}
# DNS: ${dnsServers}
# ===========================================

`;

    if (method === 'bandwidth') {
        script += `# Bandwidth Limitation Method
/ip firewall mangle add chain=forward src-address=${networkRange} action=mark-connection new-connection-mark=isolated
/ip firewall mangle add chain=forward connection-mark=isolated action=mark-packet new-packet-mark=isolated
/queue simple add name="Isolation" target=${networkRange} max-limit=${bandwidthLimit}k/${bandwidthLimit}k packet-marks=isolated`;
    } else {
        script += `# Firewall Block Method
/ip firewall filter add chain=forward src-address=${networkRange} action=drop comment="Isolation Block"`;
    }

    script += `

# DNS Configuration
/ip dhcp-server network set [find address="${networkRange}"] dns-server="${dnsServers}"

:put "=== ISOLATION SCRIPT SELESAI ==="
:put "Method: ${method}"
:put "Network: ${networkRange}"
:put "Script berhasil dijalankan!"`;

    return script;
}

module.exports = router;
