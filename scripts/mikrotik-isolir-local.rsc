# Script Mikrotik untuk User PPPoE Terisolir - Aplikasi Lokal
# IP PPPoE Isolir: 192.168.200.1/24
# Aplikasi Lokal: 192.168.8.89:3003/isolir

# ===========================================
# 1. DNS STATIC - Arahkan semua domain ke aplikasi lokal
# ===========================================

# Hapus DNS static lama (jika ada)
/ip dns static remove [find where name="alijaya.gantiwifi.online" and address="192.168.8.89"]

# Tambahkan DNS static untuk domain aplikasi
/ip dns static add name="alijaya.gantiwifi.online" address="192.168.8.89" ttl=300

# Arahkan domain populer ke aplikasi lokal
/ip dns static add name="google.com" address="192.168.8.89" ttl=300
/ip dns static add name="facebook.com" address="192.168.8.89" ttl=300
/ip dns static add name="youtube.com" address="192.168.8.89" ttl=300
/ip dns static add name="instagram.com" address="192.168.8.89" ttl=300
/ip dns static add name="twitter.com" address="192.168.8.89" ttl=300
/ip dns static add name="tiktok.com" address="192.168.8.89" ttl=300
/ip dns static add name="whatsapp.com" address="192.168.8.89" ttl=300
/ip dns static add name="telegram.org" address="192.168.8.89" ttl=300

# ===========================================
# 2. NAT RULES - Redirect HTTP/HTTPS ke aplikasi lokal
# ===========================================

# Hapus NAT rules lama (jika ada)
/ip firewall nat remove [find where comment~"isolir-redirect"]

# Redirect HTTP traffic ke aplikasi lokal
/ip firewall nat add chain=dstnat src-address=192.168.200.0/24 dst-port=80 protocol=tcp action=dst-nat to-addresses=192.168.8.89 to-ports=3003 comment="isolir-redirect-http"

# Redirect HTTPS traffic ke aplikasi lokal
/ip firewall nat add chain=dstnat src-address=192.168.200.0/24 dst-port=443 protocol=tcp action=dst-nat to-addresses=192.168.8.89 to-ports=3003 comment="isolir-redirect-https"

# ===========================================
# 3. FIREWALL RULES - Block semua kecuali aplikasi lokal
# ===========================================

# Hapus firewall rules lama (jika ada)
/ip firewall filter remove [find where comment~"isolir"]

# Allow DNS queries ke aplikasi lokal
/ip firewall filter add chain=forward src-address=192.168.200.0/24 dst-address=192.168.8.89 dst-port=53 protocol=udp action=accept comment="isolir-allow-dns"

# Allow HTTP/HTTPS ke aplikasi lokal
/ip firewall filter add chain=forward src-address=192.168.200.0/24 dst-address=192.168.8.89 dst-port=3003 protocol=tcp action=accept comment="isolir-allow-app"

# Block semua traffic lainnya
/ip firewall filter add chain=forward src-address=192.168.200.0/24 action=drop comment="isolir-block-all"

# ===========================================
# 4. ADDRESS LIST - Untuk kemudahan management
# ===========================================

# Hapus address list lama (jika ada)
/ip firewall address-list remove [find where list="isolir-users"]

# Tambahkan IP range isolir ke address list
/ip firewall address-list add address=192.168.200.0/24 list="isolir-users" comment="PPPoE Isolir Users"

# ===========================================
# 5. VERIFIKASI KONFIGURASI
# ===========================================

:put "=== KONFIGURASI ISOLIR LOKAL SELESAI ==="
:put "User PPPoE di 192.168.200.0/24 akan diarahkan ke aplikasi lokal"
:put "Aplikasi lokal: http://192.168.8.89:3003/isolir"
:put ""
:put "=== VERIFIKASI ==="

# Cek DNS static
:put "DNS Static Rules:"
/ip dns static print where name~"alijaya.gantiwifi.online"

# Cek NAT rules
:put "NAT Rules:"
/ip firewall nat print where comment~"isolir"

# Cek Firewall rules
:put "Firewall Rules:"
/ip firewall filter print where comment~"isolir"

# Cek Address List
:put "Address List:"
/ip firewall address-list print where list="isolir-users"

:put ""
:put "=== CARA KERJA ==="
:put "1. User PPPoE terisolir mendapat IP dari 192.168.200.0/24"
:put "2. DNS query untuk domain apapun diarahkan ke 192.168.8.89"
:put "3. HTTP/HTTPS request di-redirect ke 192.168.8.89:3003"
:put "4. Aplikasi menampilkan halaman isolir"
:put "5. Traffic lainnya di-block"
:put ""
:put "=== SELESAI ==="
