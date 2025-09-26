# Mikrotik Script untuk User PPPoE Terisolir
# IP PPPoE Aktif: 192.168.10.1/24
# IP PPPoE Isolir: 192.168.200.1/24
# Halaman Isolir: https://alijaya.gantiwifi.online/isolir

# ===========================================
# 1. SETUP DNS SERVER UNTUK USER ISOLIR
# ===========================================

# Hapus DNS server lama untuk isolir (jika ada)
/ip dns static remove [find where name="alijaya.gantiwifi.online" and address="192.168.200.1"]

# Tambahkan DNS static untuk domain aplikasi
/ip dns static add name="alijaya.gantiwifi.online" address="192.168.200.1" ttl=300
/ip dns static add name="localhost" address="192.168.200.1" ttl=300

# ===========================================
# 2. SETUP NAT RULES UNTUK REDIRECT
# ===========================================

# Hapus NAT rules lama untuk isolir (jika ada)
/ip firewall nat remove [find where comment~"isolir-redirect"]

# Redirect semua HTTP traffic ke halaman isolir
/ip firewall nat add chain=dstnat src-address=192.168.200.0/24 dst-port=80 protocol=tcp action=dst-nat to-addresses=192.168.200.1 to-ports=3003 comment="isolir-redirect-http"

# Redirect semua HTTPS traffic ke halaman isolir
/ip firewall nat add chain=dstnat src-address=192.168.200.0/24 dst-port=443 protocol=tcp action=dst-nat to-addresses=192.168.200.1 to-ports=3003 comment="isolir-redirect-https"

# ===========================================
# 3. SETUP FIREWALL RULES UNTUK ISOLIR
# ===========================================

# Hapus firewall rules lama untuk isolir (jika ada)
/ip firewall filter remove [find where comment~"isolir"]

# Allow DNS queries untuk user isolir
/ip firewall filter add chain=forward src-address=192.168.200.0/24 dst-address=192.168.200.1 dst-port=53 protocol=udp action=accept comment="isolir-allow-dns"

# Allow HTTP/HTTPS ke server aplikasi
/ip firewall filter add chain=forward src-address=192.168.200.0/24 dst-address=192.168.200.1 dst-port=3003 protocol=tcp action=accept comment="isolir-allow-app"

# Block semua traffic lainnya untuk user isolir
/ip firewall filter add chain=forward src-address=192.168.200.0/24 action=drop comment="isolir-block-all"

# ===========================================
# 4. SETUP ADDRESS LIST UNTUK ISOLIR
# ===========================================

# Hapus address list lama (jika ada)
/ip firewall address-list remove [find where list="isolir-users"]

# Tambahkan IP range isolir ke address list
/ip firewall address-list add address=192.168.200.0/24 list="isolir-users" comment="PPPoE Isolir Users"

# ===========================================
# 5. SETUP MANGLE RULES UNTUK MARKING
# ===========================================

# Hapus mangle rules lama (jika ada)
/ip firewall mangle remove [find where comment~"isolir-mark"]

# Mark traffic dari user isolir
/ip firewall mangle add chain=prerouting src-address=192.168.200.0/24 action=mark-connection new-connection-mark="isolir-conn" comment="isolir-mark-connection"

/ip firewall mangle add chain=prerouting src-address=192.168.200.0/24 action=mark-packet new-packet-mark="isolir-packet" comment="isolir-mark-packet"

# ===========================================
# 6. SETUP QUEUE TREE UNTUK BANDWIDTH LIMIT
# ===========================================

# Hapus queue tree lama (jika ada)
/queue tree remove [find where name~"isolir"]

# Buat queue tree untuk user isolir (1k/1k)
/queue tree add name="isolir-download" parent=global packet-mark="isolir-packet" limit-at=1k max-limit=1k priority=1/1 queue=default comment="Isolir Download Limit"

# ===========================================
# 7. SETUP WEB PROXY (OPSIONAL)
# ===========================================

# Enable web proxy untuk redirect
/ip proxy set enabled=yes port=8080

# Setup web proxy access list
/ip proxy access add dst-host=!alijaya.gantiwifi.online action=deny comment="Block all except isolir page"

/ip proxy access add dst-host=alijaya.gantiwifi.online action=allow comment="Allow isolir page"

# ===========================================
# 8. SETUP HOTSPOT (OPSIONAL ALTERNATIVE)
# ===========================================

# Jika ingin menggunakan hotspot sebagai alternatif
# /ip hotspot setup
# Interface: bridge-isolir
# Address Pool: 192.168.200.0/24
# DNS: 192.168.200.1
# Profile: isolir-profile

# ===========================================
# 9. VERIFIKASI KONFIGURASI
# ===========================================

# Cek DNS static
:put "=== DNS STATIC RULES ==="
/ip dns static print where name~"alijaya.gantiwifi.online"

# Cek NAT rules
:put "=== NAT RULES ==="
/ip firewall nat print where comment~"isolir"

# Cek Firewall rules
:put "=== FIREWALL RULES ==="
/ip firewall filter print where comment~"isolir"

# Cek Address List
:put "=== ADDRESS LIST ==="
/ip firewall address-list print where list="isolir-users"

# Cek Mangle rules
:put "=== MANGLE RULES ==="
/ip firewall mangle print where comment~"isolir"

# Cek Queue Tree
:put "=== QUEUE TREE ==="
/queue tree print where name~"isolir"

:put "=== KONFIGURASI ISOLIR SELESAI ==="
:put "User PPPoE di 192.168.200.0/24 akan diarahkan ke halaman isolir"
:put "Halaman isolir: https://alijaya.gantiwifi.online/isolir"
