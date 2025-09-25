# 🔄 **INSTRUKSI RESTART APLIKASI**

## 📋 **MASALAH**
- Route `/admin/billing/all-payments` mengembalikan error "Cannot GET"
- Route sudah ditambahkan di `routes/adminBilling.js` tapi belum terdaftar

## 🔧 **SOLUSI**

### **1. Restart Aplikasi Server**
```bash
# Jika menggunakan PM2
pm2 restart all

# Jika menggunakan nodemon
# Aplikasi akan restart otomatis

# Jika menggunakan node langsung
# Tekan Ctrl+C untuk stop, lalu jalankan lagi:
node app.js
# atau
npm start
```

### **2. Clear Cache (Jika Perlu)**
```bash
# Clear node_modules cache
rm -rf node_modules/.cache

# Clear npm cache
npm cache clean --force

# Reinstall dependencies (jika diperlukan)
npm install
```

### **3. Verifikasi Route**
Setelah restart, test route:
```bash
# Test route langsung
curl http://localhost:3000/admin/billing/all-payments

# Atau buka browser:
http://localhost:3000/admin/billing/all-payments
```

## ✅ **VERIFIKASI**

### **1. Cek Route Terdaftar**
Setelah restart, route `/admin/billing/all-payments` harus:
- ✅ Tidak mengembalikan error 404
- ✅ Menampilkan halaman "Riwayat Pembayaran"
- ✅ Menampilkan semua pembayaran (admin + kolektor)

### **2. Cek Menu Sidebar**
- ✅ Klik "Riwayat Pembayaran" di sidebar
- ✅ Harus mengarah ke `/admin/billing/all-payments`
- ✅ Harus menampilkan data pembayaran

### **3. Cek Perbedaan Data**
- ✅ `/admin/billing/payments` → Hanya transaksi kolektor (kosong)
- ✅ `/admin/billing/all-payments` → Semua pembayaran (admin + kolektor)

## 🚨 **TROUBLESHOOTING**

### **Masalah: Route masih 404 setelah restart**
```bash
# Cek apakah route file ter-load
grep -r "all-payments" routes/

# Cek syntax error di route file
node -c routes/adminBilling.js

# Cek apakah ada route conflict
grep -r "router.get.*payments" routes/
```

### **Masalah: Aplikasi tidak bisa restart**
```bash
# Cek proses yang berjalan
ps aux | grep node

# Kill proses jika perlu
kill -9 <PID>

# Restart aplikasi
npm start
```

### **Masalah: Route terdaftar tapi error**
```bash
# Cek log aplikasi
tail -f logs/app.log

# Cek database connection
node scripts/check-transaksi-kolektor.js
```

## 📞 **SUPPORT**

Jika masih ada masalah setelah restart:
1. Cek log aplikasi untuk error
2. Verifikasi database connection
3. Test route secara manual
4. Laporkan hasil ke developer

---

**Route baru memerlukan restart aplikasi untuk terdaftar. Setelah restart, menu "Riwayat Pembayaran" akan berfungsi dengan baik.** ✅
