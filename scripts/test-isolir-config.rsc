# Script untuk test konfigurasi isolir Mikrotik
# Jalankan script ini untuk memverifikasi konfigurasi isolir

:put "=== TEST KONFIGURASI ISOLIR ==="
:put ""

# ===========================================
# 1. TEST DNS STATIC RULES
# ===========================================

:put "1. DNS STATIC RULES:"
:put "==================="

# Cek DNS static untuk domain aplikasi
:local dnsApp [/ip dns static find where name="alijaya.gantiwifi.online"]
if ($dnsApp != "") {
    :put "✅ DNS static untuk alijaya.gantiwifi.online: ADA"
    :put "   Address: [/ip dns static get $dnsApp address]"
    :put "   TTL: [/ip dns static get $dnsApp ttl]"
} else {
    :put "❌ DNS static untuk alijaya.gantiwifi.online: TIDAK ADA"
}

:put ""

# ===========================================
# 2. TEST NAT RULES
# ===========================================

:put "2. NAT RULES:"
:put "============="

# Cek NAT rule untuk HTTP
:local natHttp [/ip firewall nat find where comment="isolir-redirect-http"]
if ($natHttp != "") {
    :put "✅ NAT rule HTTP: ADA"
    :put "   Source: [/ip firewall nat get $natHttp src-address]"
    :put "   Destination Port: [/ip firewall nat get $natHttp dst-port]"
    :put "   Action: [/ip firewall nat get $natHttp action]"
    :put "   To Address: [/ip firewall nat get $natHttp to-addresses]"
    :put "   To Port: [/ip firewall nat get $natHttp to-ports]"
} else {
    :put "❌ NAT rule HTTP: TIDAK ADA"
}

# Cek NAT rule untuk HTTPS
:local natHttps [/ip firewall nat find where comment="isolir-redirect-https"]
if ($natHttps != "") {
    :put "✅ NAT rule HTTPS: ADA"
    :put "   Source: [/ip firewall nat get $natHttps src-address]"
    :put "   Destination Port: [/ip firewall nat get $natHttps dst-port]"
    :put "   Action: [/ip firewall nat get $natHttps action]"
    :put "   To Address: [/ip firewall nat get $natHttps to-addresses]"
    :put "   To Port: [/ip firewall nat get $natHttps to-ports]"
} else {
    :put "❌ NAT rule HTTPS: TIDAK ADA"
}

:put ""

# ===========================================
# 3. TEST FIREWALL RULES
# ===========================================

:put "3. FIREWALL RULES:"
:put "=================="

# Cek firewall rule untuk DNS
:local fwDns [/ip firewall filter find where comment="isolir-allow-dns"]
if ($fwDns != "") {
    :put "✅ Firewall rule DNS: ADA"
    :put "   Source: [/ip firewall filter get $fwDns src-address]"
    :put "   Destination: [/ip firewall filter get $fwDns dst-address]"
    :put "   Port: [/ip firewall filter get $fwDns dst-port]"
    :put "   Action: [/ip firewall filter get $fwDns action]"
} else {
    :put "❌ Firewall rule DNS: TIDAK ADA"
}

# Cek firewall rule untuk aplikasi
:local fwApp [/ip firewall filter find where comment="isolir-allow-app"]
if ($fwApp != "") {
    :put "✅ Firewall rule App: ADA"
    :put "   Source: [/ip firewall filter get $fwApp src-address]"
    :put "   Destination: [/ip firewall filter get $fwApp dst-address]"
    :put "   Port: [/ip firewall filter get $fwApp dst-port]"
    :put "   Action: [/ip firewall filter get $fwApp action]"
} else {
    :put "❌ Firewall rule App: TIDAK ADA"
}

# Cek firewall rule untuk block
:local fwBlock [/ip firewall filter find where comment="isolir-block-all"]
if ($fwBlock != "") {
    :put "✅ Firewall rule Block: ADA"
    :put "   Source: [/ip firewall filter get $fwBlock src-address]"
    :put "   Action: [/ip firewall filter get $fwBlock action]"
} else {
    :put "❌ Firewall rule Block: TIDAK ADA"
}

:put ""

# ===========================================
# 4. TEST ADDRESS LIST
# ===========================================

:put "4. ADDRESS LIST:"
:put "================"

# Cek address list isolir
:local addrList [/ip firewall address-list find where list="isolir-users"]
if ($addrList != "") {
    :put "✅ Address list isolir-users: ADA"
    :put "   Address: [/ip firewall address-list get $addrList address]"
    :put "   List: [/ip firewall address-list get $addrList list]"
} else {
    :put "❌ Address list isolir-users: TIDAK ADA"
}

:put ""

# ===========================================
# 5. TEST MANGLE RULES
# ===========================================

:put "5. MANGLE RULES:"
:put "================"

# Cek mangle rule untuk connection
:local mangleConn [/ip firewall mangle find where comment="isolir-mark-connection"]
if ($mangleConn != "") {
    :put "✅ Mangle rule Connection: ADA"
    :put "   Source: [/ip firewall mangle get $mangleConn src-address]"
    :put "   Action: [/ip firewall mangle get $mangleConn action]"
    :put "   New Connection Mark: [/ip firewall mangle get $mangleConn new-connection-mark]"
} else {
    :put "❌ Mangle rule Connection: TIDAK ADA"
}

# Cek mangle rule untuk packet
:local manglePacket [/ip firewall mangle find where comment="isolir-mark-packet"]
if ($manglePacket != "") {
    :put "✅ Mangle rule Packet: ADA"
    :put "   Source: [/ip firewall mangle get $manglePacket src-address]"
    :put "   Action: [/ip firewall mangle get $manglePacket action]"
    :put "   New Packet Mark: [/ip firewall mangle get $manglePacket new-packet-mark]"
} else {
    :put "❌ Mangle rule Packet: TIDAK ADA"
}

:put ""

# ===========================================
# 6. TEST QUEUE TREE
# ===========================================

:put "6. QUEUE TREE:"
:put "=============="

# Cek queue tree isolir
:local queueTree [/queue tree find where name~"isolir"]
if ($queueTree != "") {
    :put "✅ Queue tree isolir: ADA"
    :foreach id in=$queueTree do={
        :put "   Name: [/queue tree get $id name]"
        :put "   Parent: [/queue tree get $id parent]"
        :put "   Packet Mark: [/queue tree get $id packet-mark]"
        :put "   Limit At: [/queue tree get $id limit-at]"
        :put "   Max Limit: [/queue tree get $id max-limit]"
    }
} else {
    :put "❌ Queue tree isolir: TIDAK ADA"
}

:put ""

# ===========================================
# 7. SUMMARY
# ===========================================

:put "=== SUMMARY ==="
:put "==============="

:local totalConfig 0
:local totalMissing 0

# Hitung konfigurasi yang ada
if ($dnsApp != "") { :set totalConfig ($totalConfig + 1) } else { :set totalMissing ($totalMissing + 1) }
if ($natHttp != "") { :set totalConfig ($totalConfig + 1) } else { :set totalMissing ($totalMissing + 1) }
if ($natHttps != "") { :set totalConfig ($totalConfig + 1) } else { :set totalMissing ($totalMissing + 1) }
if ($fwDns != "") { :set totalConfig ($totalConfig + 1) } else { :set totalMissing ($totalMissing + 1) }
if ($fwApp != "") { :set totalConfig ($totalConfig + 1) } else { :set totalMissing ($totalMissing + 1) }
if ($fwBlock != "") { :set totalConfig ($totalConfig + 1) } else { :set totalMissing ($totalMissing + 1) }

:put "Konfigurasi yang ada: $totalConfig"
:put "Konfigurasi yang hilang: $totalMissing"

if ($totalMissing = 0) {
    :put "🎉 SEMUA KONFIGURASI ISOLIR SUDAH BENAR!"
} else {
    :put "⚠️  ADA KONFIGURASI YANG HILANG, JALANKAN SCRIPT SETUP LAGI"
}

:put ""
:put "=== TEST SELESAI ==="
