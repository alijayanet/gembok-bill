# Script untuk menghapus konfigurasi isolir Mikrotik
# Jalankan script ini jika ingin menghapus semua konfigurasi isolir

# ===========================================
# 1. HAPUS DNS STATIC RULES
# ===========================================

:put "Menghapus DNS static rules untuk isolir..."
/ip dns static remove [find where name="alijaya.gantiwifi.online" and address="192.168.200.1"]
/ip dns static remove [find where name="localhost" and address="192.168.200.1"]

# ===========================================
# 2. HAPUS NAT RULES
# ===========================================

:put "Menghapus NAT rules untuk isolir..."
/ip firewall nat remove [find where comment~"isolir-redirect"]

# ===========================================
# 3. HAPUS FIREWALL RULES
# ===========================================

:put "Menghapus firewall rules untuk isolir..."
/ip firewall filter remove [find where comment~"isolir"]

# ===========================================
# 4. HAPUS ADDRESS LIST
# ===========================================

:put "Menghapus address list isolir..."
/ip firewall address-list remove [find where list="isolir-users"]

# ===========================================
# 5. HAPUS MANGLE RULES
# ===========================================

:put "Menghapus mangle rules untuk isolir..."
/ip firewall mangle remove [find where comment~"isolir-mark"]

# ===========================================
# 6. HAPUS QUEUE TREE
# ===========================================

:put "Menghapus queue tree untuk isolir..."
/queue tree remove [find where name~"isolir"]

# ===========================================
# 7. RESET WEB PROXY (OPSIONAL)
# ===========================================

:put "Reset web proxy access list..."
/ip proxy access remove [find where comment~"isolir"]

# ===========================================
# 8. VERIFIKASI PENGHAPUSAN
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

# Cek Mangle rules
:put "Mangle rules tersisa:"
/ip firewall mangle print where comment~"isolir"

# Cek Queue Tree
:put "Queue tree tersisa:"
/queue tree print where name~"isolir"

:put "=== KONFIGURASI ISOLIR BERHASIL DIHAPUS ==="
