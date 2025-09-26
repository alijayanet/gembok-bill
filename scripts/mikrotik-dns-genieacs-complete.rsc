# ===========================================
# MIKROTIK DNS GENIEACS CONFIGURATION SCRIPT
# ===========================================
# Complete configuration for GenieACS DNS setup
# This script configures Mikrotik to work with GenieACS
# ===========================================

# ===========================================
# 1. SETUP DNS STATIC - Arahkan domain ke GenieACS
# ===========================================

# Hapus DNS static lama (jika ada)
/ip dns static remove [find where name="genieacs.local" and address="192.168.8.89"]
/ip dns static remove [find where name="tr069.local" and address="192.168.8.89"]

# Tambahkan DNS static untuk GenieACS
/ip dns static add name="genieacs.local" address="192.168.8.89" ttl=300 comment="GenieACS Server"
/ip dns static add name="tr069.local" address="192.168.8.89" ttl=300 comment="TR069 Server"

# ===========================================
# 2. SETUP DHCP SERVER DNS
# ===========================================

# Update DHCP server untuk memberikan DNS GenieACS
/ip dhcp-server network set [find address="192.168.10.0/24"] dns-server="192.168.8.89,8.8.8.8" comment="GenieACS DNS Configuration"

# ===========================================
# 3. SETUP NAT RULES - Redirect TR069 ke GenieACS
# ===========================================

# Hapus NAT rules lama (jika ada)
/ip firewall nat remove [find comment="genieacs-tr069-redirect"]
/ip firewall nat remove [find comment="genieacs-tr069-redirect-https"]

# Redirect TR069 HTTP ke GenieACS
/ip firewall nat add chain=dstnat dst-port=7547 protocol=tcp action=dst-nat to-addresses=192.168.8.89 to-ports=7547 comment="genieacs-tr069-redirect"

# Redirect TR069 HTTPS ke GenieACS (jika menggunakan HTTPS)
/ip firewall nat add chain=dstnat dst-port=7548 protocol=tcp action=dst-nat to-addresses=192.168.8.89 to-ports=7548 comment="genieacs-tr069-redirect-https"

# ===========================================
# 4. SETUP FIREWALL RULES - Allow TR069 Communication
# ===========================================

# Hapus firewall rules lama (jika ada)
/ip firewall filter remove [find comment="genieacs-allow-tr069"]
/ip firewall filter remove [find comment="genieacs-allow-dns"]

# Allow TR069 communication dari PPPoE range ke GenieACS
/ip firewall filter add chain=forward src-address=192.168.10.0/24 dst-address=192.168.8.89 dst-port=7547 protocol=tcp action=accept comment="genieacs-allow-tr069"

# Allow DNS queries ke GenieACS
/ip firewall filter add chain=forward src-address=192.168.10.0/24 dst-address=192.168.8.89 dst-port=53 protocol=udp action=accept comment="genieacs-allow-dns"

# Allow HTTPS TR069 (jika menggunakan HTTPS)
/ip firewall filter add chain=forward src-address=192.168.10.0/24 dst-address=192.168.8.89 dst-port=7548 protocol=tcp action=accept comment="genieacs-allow-tr069-https"

# ===========================================
# 5. SETUP PPP PROFILE - Update DNS untuk PPPoE
# ===========================================

# Update PPP profile untuk memberikan DNS GenieACS
/ppp profile set [find name="default"] dns-server="192.168.8.89,8.8.8.8" comment="GenieACS DNS Configuration"

# ===========================================
# 6. SETUP ADDRESS LIST - Untuk monitoring
# ===========================================

# Hapus address list lama (jika ada)
/ip firewall address-list remove [find list="genieacs-clients"]

# Tambahkan address list untuk monitoring
/ip firewall address-list add list="genieacs-clients" address=192.168.10.0/24 comment="PPPoE Clients for GenieACS"

# ===========================================
# 7. SETUP LOGGING - Monitor TR069 Activity
# ===========================================

# Hapus logging rules lama (jika ada)
/system logging remove [find topics="genieacs"]

# Tambahkan logging untuk TR069 activity
/system logging add topics=genieacs action=memory comment="GenieACS TR069 Activity"

# ===========================================
# 8. VERIFIKASI KONFIGURASI
# ===========================================

:put ""
:put "=== VERIFIKASI KONFIGURASI ==="
:put "GenieACS Server: 192.168.8.89:7547"
:put "PPPoE Range: 192.168.10.0/24"
:put "DNS Backup: 8.8.8.8"
:put ""
:put "=== DNS STATIC ==="
/ip dns static print where name~"genieacs|tr069"
:put ""
:put "=== DHCP SERVER DNS ==="
/ip dhcp-server network print where address="192.168.10.0/24"
:put ""
:put "=== NAT RULES ==="
/ip firewall nat print where comment~"genieacs"
:put ""
:put "=== FIREWALL RULES ==="
/ip firewall filter print where comment~"genieacs"
:put ""
:put "=== PPP PROFILE ==="
/ppp profile print where name="default"
:put ""
:put "=== ADDRESS LIST ==="
/ip firewall address-list print where list="genieacs-clients"
:put ""
:put "=== KONFIGURASI SELESAI ==="
:put "Script berhasil dijalankan!"
:put "ONUs sekarang akan menggunakan GenieACS sebagai DNS server"
:put "Port TR069: 7547 (HTTP), 7548 (HTTPS)"
:put "==========================================="
