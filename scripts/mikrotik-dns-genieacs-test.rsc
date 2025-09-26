# ===========================================
# MIKROTIK DNS GENIEACS TEST SCRIPT
# ===========================================
# Script untuk test dan verifikasi konfigurasi GenieACS DNS
# ===========================================

:put ""
:put "=== TEST KONFIGURASI GENIEACS DNS ==="
:put ""

# ===========================================
# 1. TEST DNS STATIC
# ===========================================

:put "=== 1. TEST DNS STATIC ==="
:put "Mencari DNS static untuk GenieACS..."

:local genieacsDns [/ip dns static find where name="genieacs.local"]
:local tr069Dns [/ip dns static find where name="tr069.local"]

if ([:len $genieacsDns] > 0) do={
    :put "✅ genieacs.local ditemukan"
    /ip dns static print where name="genieacs.local"
} else={
    :put "❌ genieacs.local tidak ditemukan"
}

if ([:len $tr069Dns] > 0) do={
    :put "✅ tr069.local ditemukan"
    /ip dns static print where name="tr069.local"
} else={
    :put "❌ tr069.local tidak ditemukan"
}

# ===========================================
# 2. TEST DHCP SERVER DNS
# ===========================================

:put ""
:put "=== 2. TEST DHCP SERVER DNS ==="
:put "Mencari DHCP server network dengan DNS GenieACS..."

:local dhcpNetworks [/ip dhcp-server network find where dns-server~"192.168.8.89"]
if ([:len $dhcpNetworks] > 0) do={
    :put "✅ DHCP server network dengan DNS GenieACS ditemukan"
    /ip dhcp-server network print where dns-server~"192.168.8.89"
} else={
    :put "❌ DHCP server network dengan DNS GenieACS tidak ditemukan"
}

# ===========================================
# 3. TEST NAT RULES
# ===========================================

:put ""
:put "=== 3. TEST NAT RULES ==="
:put "Mencari NAT rules untuk GenieACS..."

:local natRules [/ip firewall nat find where comment~"genieacs"]
if ([:len $natRules] > 0) do={
    :put "✅ NAT rules GenieACS ditemukan"
    /ip firewall nat print where comment~"genieacs"
} else={
    :put "❌ NAT rules GenieACS tidak ditemukan"
}

# ===========================================
# 4. TEST FIREWALL RULES
# ===========================================

:put ""
:put "=== 4. TEST FIREWALL RULES ==="
:put "Mencari firewall rules untuk GenieACS..."

:local firewallRules [/ip firewall filter find where comment~"genieacs"]
if ([:len $firewallRules] > 0) do={
    :put "✅ Firewall rules GenieACS ditemukan"
    /ip firewall filter print where comment~"genieacs"
} else={
    :put "❌ Firewall rules GenieACS tidak ditemukan"
}

# ===========================================
# 5. TEST PPP PROFILE
# ===========================================

:put ""
:put "=== 5. TEST PPP PROFILE ==="
:put "Mencari PPP profile dengan DNS GenieACS..."

:local pppProfiles [/ppp profile find where dns-server~"192.168.8.89"]
if ([:len $pppProfiles] > 0) do={
    :put "✅ PPP profile dengan DNS GenieACS ditemukan"
    /ppp profile print where dns-server~"192.168.8.89"
} else={
    :put "❌ PPP profile dengan DNS GenieACS tidak ditemukan"
}

# ===========================================
# 6. TEST ADDRESS LIST
# ===========================================

:put ""
:put "=== 6. TEST ADDRESS LIST ==="
:put "Mencari address list GenieACS..."

:local addressList [/ip firewall address-list find where list="genieacs-clients"]
if ([:len $addressList] > 0) do={
    :put "✅ Address list GenieACS ditemukan"
    /ip firewall address-list print where list="genieacs-clients"
} else={
    :put "❌ Address list GenieACS tidak ditemukan"
}

# ===========================================
# 7. TEST LOGGING
# ===========================================

:put ""
:put "=== 7. TEST LOGGING ==="
:put "Mencari logging GenieACS..."

:local logging [/system logging find where topics="genieacs"]
if ([:len $logging] > 0) do={
    :put "✅ Logging GenieACS ditemukan"
    /system logging print where topics="genieacs"
} else={
    :put "❌ Logging GenieACS tidak ditemukan"
}

# ===========================================
# 8. TEST KONEKSI KE GENIEACS
# ===========================================

:put ""
:put "=== 8. TEST KONEKSI KE GENIEACS ==="
:put "Testing koneksi ke GenieACS server..."

:local testResult [/tool fetch url="http://192.168.8.89:7547" http-method=get]
if ($testResult = "ok") do={
    :put "✅ Koneksi ke GenieACS berhasil"
} else={
    :put "❌ Koneksi ke GenieACS gagal"
}

# ===========================================
# 9. RINGKASAN HASIL TEST
# ===========================================

:put ""
:put "=== RINGKASAN HASIL TEST ==="
:put ""

:local totalTests = 8
:local passedTests = 0

if ([:len $genieacsDns] > 0) do={ :set passedTests ($passedTests + 1) }
if ([:len $tr069Dns] > 0) do={ :set passedTests ($passedTests + 1) }
if ([:len $dhcpNetworks] > 0) do={ :set passedTests ($passedTests + 1) }
if ([:len $natRules] > 0) do={ :set passedTests ($passedTests + 1) }
if ([:len $firewallRules] > 0) do={ :set passedTests ($passedTests + 1) }
if ([:len $pppProfiles] > 0) do={ :set passedTests ($passedTests + 1) }
if ([:len $addressList] > 0) do={ :set passedTests ($passedTests + 1) }
if ([:len $logging] > 0) do={ :set passedTests ($passedTests + 1) }

:put "Total Tests: $totalTests"
:put "Passed: $passedTests"
:put "Failed: " . ($totalTests - $passedTests)

if ($passedTests = $totalTests) do={
    :put "🎉 SEMUA TEST BERHASIL! Konfigurasi GenieACS DNS sudah benar."
} else={
    :put "⚠️  BEBERAPA TEST GAGAL! Periksa konfigurasi GenieACS DNS."
}

:put ""
:put "=== TEST SELESAI ==="
