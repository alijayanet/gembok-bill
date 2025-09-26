# ===========================================
# MIKROTIK DNS GENIEACS REMOVAL SCRIPT
# ===========================================
# Script untuk menghapus konfigurasi GenieACS DNS
# ===========================================

:put ""
:put "=== MENGHAPUS KONFIGURASI GENIEACS DNS ==="
:put ""

# ===========================================
# 1. HAPUS DNS STATIC
# ===========================================

:put "Menghapus DNS static GenieACS..."
/ip dns static remove [find where name="genieacs.local"]
/ip dns static remove [find where name="tr069.local"]

# ===========================================
# 2. RESET DHCP SERVER DNS
# ===========================================

:put "Reset DHCP server DNS ke default..."
/ip dhcp-server network set [find address="192.168.10.0/24"] dns-server="8.8.8.8,8.8.4.4" comment="Default DNS Configuration"

# ===========================================
# 3. HAPUS NAT RULES
# ===========================================

:put "Menghapus NAT rules GenieACS..."
/ip firewall nat remove [find comment="genieacs-tr069-redirect"]
/ip firewall nat remove [find comment="genieacs-tr069-redirect-https"]

# ===========================================
# 4. HAPUS FIREWALL RULES
# ===========================================

:put "Menghapus firewall rules GenieACS..."
/ip firewall filter remove [find comment="genieacs-allow-tr069"]
/ip firewall filter remove [find comment="genieacs-allow-dns"]
/ip firewall filter remove [find comment="genieacs-allow-tr069-https"]

# ===========================================
# 5. RESET PPP PROFILE
# ===========================================

:put "Reset PPP profile DNS ke default..."
/ppp profile set [find name="default"] dns-server="8.8.8.8,8.8.4.4" comment="Default DNS Configuration"

# ===========================================
# 6. HAPUS ADDRESS LIST
# ===========================================

:put "Menghapus address list GenieACS..."
/ip firewall address-list remove [find list="genieacs-clients"]

# ===========================================
# 7. HAPUS LOGGING
# ===========================================

:put "Menghapus logging GenieACS..."
/system logging remove [find topics="genieacs"]

# ===========================================
# 8. VERIFIKASI PENGHAPUSAN
# ===========================================

:put ""
:put "=== VERIFIKASI PENGHAPUSAN ==="
:put ""

:put "=== DNS STATIC (harus kosong) ==="
/ip dns static print where name~"genieacs|tr069"

:put ""
:put "=== DHCP SERVER DNS (default) ==="
/ip dhcp-server network print where address="192.168.10.0/24"

:put ""
:put "=== NAT RULES (harus kosong) ==="
/ip firewall nat print where comment~"genieacs"

:put ""
:put "=== FIREWALL RULES (harus kosong) ==="
/ip firewall filter print where comment~"genieacs"

:put ""
:put "=== PPP PROFILE (default) ==="
/ppp profile print where name="default"

:put ""
:put "=== ADDRESS LIST (harus kosong) ==="
/ip firewall address-list print where list="genieacs-clients"

:put ""
:put "=== KONFIGURASI GENIEACS BERHASIL DIHAPUS ==="
:put "Mikrotik telah dikembalikan ke konfigurasi default"
:put "==========================================="
