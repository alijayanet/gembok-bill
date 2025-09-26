# Script Mikrotik untuk Mengatur DNS Server GenieACS (Auto-Generated)
# IP Server GenieACS: 192.168.8.189:7547
# IP PPPoE: 192.168.10.0/24
# DNS Server: 192.168.8.189 (GenieACS server)
# Generated on: 26/9/2025, 11.13.59

# ===========================================
# 1. SETUP DNS SERVER UNTUK PPPoE USERS
# ===========================================

# Hapus DNS server lama (jika ada)
/ip dns static remove [find where name="genieacs.local" and address="192.168.8.189"]

# Tambahkan DNS static untuk GenieACS server
/ip dns static add name="genieacs.local" address="192.168.8.189" ttl=300
/ip dns static add name="acs.local" address="192.168.8.189" ttl=300
/ip dns static add name="tr069.local" address="192.168.8.189" ttl=300

# ===========================================
# 2. SETUP DHCP SERVER UNTUK PPPoE USERS
# ===========================================

# Hapus DHCP server lama untuk PPPoE (jika ada)
/ip dhcp-server remove [find where interface="pppoe-out1" and address-pool="pppoe-pool"]

# Buat address pool untuk PPPoE users
/ip pool remove [find where name="pppoe-pool"]
/ip pool add name="pppoe-pool" ranges=192.168.10.2-192.168.10.254

# Buat DHCP server untuk PPPoE users
/ip dhcp-server add interface=pppoe-out1 address-pool=pppoe-pool name="pppoe-dhcp" \
    lease-time=1h authoritative=after-2sec-delay use-radius=no

# ===========================================
# 3. SETUP DNS SERVER UNTUK DHCP CLIENTS
# ===========================================

# Hapus DHCP network lama (jika ada)
/ip dhcp-server network remove [find where address="192.168.10.0/24"]

# Tambahkan DHCP network dengan DNS server GenieACS
/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 \
    dns-server=192.168.8.189,8.8.8.8,8.8.4.4 domain=local

# ===========================================
# 4. SETUP NAT RULES UNTUK TR069 TRAFFIC
# ===========================================

# Hapus NAT rules lama untuk TR069 (jika ada)
/ip firewall nat remove [find where comment~"tr069"]

# Allow TR069 traffic dari PPPoE users ke GenieACS server
/ip firewall nat add chain=srcnat src-address=192.168.10.0/24 \
    dst-address=192.168.8.189 dst-port=7547 protocol=tcp \
    action=masquerade comment="tr069-genieacs"

# Allow TR069 traffic dari PPPoE users ke GenieACS server (HTTPS)
/ip firewall nat add chain=srcnat src-address=192.168.10.0/24 \
    dst-address=192.168.8.189 dst-port=7548 protocol=tcp \
    action=masquerade comment="tr069-genieacs-https"

# ===========================================
# 5. SETUP FIREWALL RULES UNTUK TR069
# ===========================================

# Hapus firewall rules lama untuk TR069 (jika ada)
/ip firewall filter remove [find where comment~"tr069"]

# Allow TR069 traffic dari PPPoE users ke GenieACS server
/ip firewall filter add chain=forward src-address=192.168.10.0/24 \
    dst-address=192.168.8.189 dst-port=7547 protocol=tcp \
    action=accept comment="tr069-allow-http"

# Allow TR069 traffic dari PPPoE users ke GenieACS server (HTTPS)
/ip firewall filter add chain=forward src-address=192.168.10.0/24 \
    dst-address=192.168.8.189 dst-port=7548 protocol=tcp \
    action=accept comment="tr069-allow-https"

# Allow DNS queries dari PPPoE users ke GenieACS server
/ip firewall filter add chain=forward src-address=192.168.10.0/24 \
    dst-address=192.168.8.189 dst-port=53 protocol=udp \
    action=accept comment="tr069-allow-dns"

# Allow DNS queries dari PPPoE users ke GenieACS server (TCP)
/ip firewall filter add chain=forward src-address=192.168.10.0/24 \
    dst-address=192.168.8.189 dst-port=53 protocol=tcp \
    action=accept comment="tr069-allow-dns-tcp"

# ===========================================
# 6. SETUP PPPoE PROFILE UNTUK DNS
# ===========================================

# Hapus PPPoE profile lama (jika ada)
/ppp profile remove [find where name="genieacs-dns"]

# Buat PPPoE profile dengan DNS server GenieACS
/ppp profile add name="genieacs-dns" local-address=192.168.10.1 \
    remote-address=pppoe-pool dns-server=192.168.8.189,8.8.8.8,8.8.4.4 \
    use-encryption=no use-compression=no use-vj-compression=no \
    only-one=yes change-tcp-mss=yes use-ipv6=no \
    comment="Profile dengan DNS server GenieACS (Auto-Generated)"

# ===========================================
# 7. SETUP ADDRESS LIST UNTUK TR069 USERS
# ===========================================

# Hapus address list lama (jika ada)
/ip firewall address-list remove [find where list="tr069-users"]

# Tambahkan IP range PPPoE ke address list
/ip firewall address-list add address=192.168.10.0/24 list="tr069-users" \
    comment="PPPoE Users untuk TR069 (Auto-Generated)"

# ===========================================
# 8. VERIFIKASI KONFIGURASI
# ===========================================

:put "=== KONFIGURASI DNS GENIEACS SELESAI (AUTO-GENERATED) ==="
:put "DNS Server: 192.168.8.189 (GenieACS)"
:put "PPPoE Range: 192.168.10.0/24"
:put "TR069 Port: 7547 (HTTP), 7548 (HTTPS)"
:put "Generated on: 26/9/2025, 11.13.59"
:put ""
:put "=== VERIFIKASI ==="

# Cek DNS static
:put "DNS Static Rules:"
/ip dns static print where name~"genieacs"

# Cek DHCP server
:put "DHCP Server:"
/ip dhcp-server print where name="pppoe-dhcp"

# Cek DHCP network
:put "DHCP Network:"
/ip dhcp-server network print where address="192.168.10.0/24"

# Cek NAT rules
:put "NAT Rules:"
/ip firewall nat print where comment~"tr069"

# Cek Firewall rules
:put "Firewall Rules:"
/ip firewall filter print where comment~"tr069"

# Cek PPPoE profile
:put "PPPoE Profile:"
/ppp profile print where name="genieacs-dns"

# Cek Address List
:put "Address List:"
/ip firewall address-list print where list="tr069-users"

:put ""
:put "=== CARA KERJA ==="
:put "1. PPPoE users mendapat IP dari range 192.168.10.0/24"
:put "2. DNS server diarahkan ke 192.168.8.189 (GenieACS)"
:put "3. TR069 traffic diizinkan ke port 7547/7548"
:put "4. ONU dapat berkomunikasi dengan GenieACS server"
:put ""
:put "=== SELESAI ==="

echo "Script DNS GenieACS telah dibuat dengan IP: 192.168.8.189!"
echo "Pastikan GenieACS server dapat diakses dari IP: 192.168.8.189"
echo "Port TR069: 7547 (HTTP), 7548 (HTTPS)"