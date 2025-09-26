# Script untuk menghapus konfigurasi isolir lokal Mikrotik
# Jalankan script ini jika ingin menghapus semua konfigurasi isolir lokal

# ===========================================
# 1. HAPUS DNS STATIC RULES
# ===========================================

:put "Menghapus DNS static rules untuk isolir lokal..."
/ip dns static remove [find where name="alijaya.gantiwifi.online" and address="192.168.8.89"]
/ip dns static remove [find where name="google.com" and address="192.168.8.89"]
/ip dns static remove [find where name="facebook.com" and address="192.168.8.89"]
/ip dns static remove [find where name="youtube.com" and address="192.168.8.89"]
/ip dns static remove [find where name="instagram.com" and address="192.168.8.89"]
/ip dns static remove [find where name="twitter.com" and address="192.168.8.89"]
/ip dns static remove [find where name="tiktok.com" and address="192.168.8.89"]
/ip dns static remove [find where name="whatsapp.com" and address="192.168.8.89"]
/ip dns static remove [find where name="telegram.org" and address="192.168.8.89"]

# ===========================================
# 2. HAPUS NAT RULES
# ===========================================

:put "Menghapus NAT rules untuk isolir lokal..."
/ip firewall nat remove [find where comment~"isolir-redirect"]

# ===========================================
# 3. HAPUS FIREWALL RULES
# ===========================================

:put "Menghapus firewall rules untuk isolir lokal..."
/ip firewall filter remove [find where comment~"isolir"]

# ===========================================
# 4. HAPUS ADDRESS LIST
# ===========================================

:put "Menghapus address list isolir..."
/ip firewall address-list remove [find where list="isolir-users"]

# ===========================================
# 5. VERIFIKASI PENGHAPUSAN
# ===========================================

:put "=== VERIFIKASI PENGHAPUSAN ==="

# Cek DNS static
:put "DNS Static rules tersisa:"
/ip dns static print where name~"alijaya.gantiwifi.online"

# Cek NAT rules
:put "NAT rules tersisa:"
/ip firewall nat print where comment~"isolir"

# Cek Firewall rules
:put "Firewall rules tersisa:"
/ip firewall filter print where comment~"isolir"

# Cek Address List
:put "Address list tersisa:"
/ip firewall address-list print where list="isolir-users"

:put "=== KONFIGURASI ISOLIR LOKAL BERHASIL DIHAPUS ==="
