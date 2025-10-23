<!-- Improved modern README with better structure and visuals -->
<div align="center">
  <img src="public/img/logo.png" alt="Gembok Bill Logo" width="120" height="120">
  
  # Gembok Bill
  **Integrated ISP Management System**
  
  [![Node.js](https://img.shields.io/badge/Node.js-18.x-green?style=for-the-badge&logo=node.js)](https://nodejs.org/)
  [![License](https://img.shields.io/badge/license-ISC-blue?style=for-the-badge)](LICENSE)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge)](https://github.com/alijayanet/gembok-bill/pulls)
  [![GitHub Stars](https://img.shields.io/github/stars/alijayanet/gembok-bill?style=for-the-badge)](https://github.com/alijayanet/gembok-bill/stargazers)
</div>

## 🌐 Tentang Gembok Bill

**Gembok Bill** adalah sistem manajemen ISP terintegrasi yang dirancang untuk mengelola billing, layanan pelanggan, dan operasi jaringan melalui integrasi WhatsApp. Sistem ini menyediakan solusi end-to-end untuk manajemen penyedia layanan internet dengan fitur-fitur canggih.

### 🚀 Fitur Utama

- **📱 WhatsApp Gateway**: Interaksi pelanggan, pengiriman voucher, pelaporan gangguan, dan notifikasi otomatis
- **📡 Integrasi GenieACS**: Manajemen CPE (Customer Premises Equipment) yang terpusat
- **🔗 Manajemen Mikrotik PPPoE & Hotspot**: Autentikasi pengguna dan kontrol bandwidth real-time
- **💳 Sistem Billing**: Pembuatan invoice otomatis, pelacakan pembayaran, dan remittance
- **👥 Manajemen Agen & Teknisi**: Peran, kontrol akses, dan penugasan pekerjaan yang fleksibel
- **📂 Migrasi Database**: Pembaruan skema berbasis SQL untuk pengembangan yang berkelanjutan
- **🗺️ Pemetaan Jaringan Kabel**: Manajemen ODP, tiang, dan tata letak kabel secara visual

## 🛠️ Teknologi yang Digunakan

| Kategori | Teknologi |
|----------|-----------|
| **Backend** | Node.js, Express |
| **Database** | SQLite (development), MySQL (production) |
| **Frontend** | EJS, HTML5, CSS3, JavaScript |
| **WhatsApp** | [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) |
| **Network** | Node-routeros untuk Mikrotik |
| **Payment** | Midtrans, Xendit |
| **Logging** | Winston, Pino |

## 📋 Prasyarat Sistem

- **Node.js** >= 20.0.0
- **npm** >= 6.0.0
- **Database** SQLite (untuk development) atau MySQL (untuk production)
- **Akses WhatsApp Business** (untuk fitur WhatsApp Gateway)

## 🚀 Instalasi Cepat

### 1. Clone Repository
```bash
git clone https://github.com/alijayanet/gembok-bill.git
```
```bash
cd gembok-bill
```

### 2. Instal Dependensi
```bash
npm install
```

### 3. Inisialisasi Database
```bash
npm run setup
```

### 5. Jalankan Aplikasi
```bash
# Untuk production
npm start
```
# Untuk development
```bash
npm run dev
```

## 📁 Struktur Project

```
gembok-bill/
├── app.js                  # Entry point aplikasi
├── package.json            # Dependensi dan script
├── config/                 # File konfigurasi
├── data/                   # File database dan backup
├── migrations/             # File migrasi database
├── public/                 # File statis (CSS, JS, images)
├── routes/                 # Endpoint API
├── scripts/                # Script utilitas
├── utils/                  # Fungsi utilitas
└── views/                  # Template EJS
```

## 📖 Dokumentasi Lengkap

| Dokumen | Deskripsi |
|---------|-----------|
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Panduan lengkap deployment di server baru |
| [DATA_README.md](DATA_README.md) | Informasi tentang manajemen data |
| [WHATSAPP_SETUP.md](WHATSAPP_SETUP.md) | Konfigurasi WhatsApp Gateway |
| [WHATSAPP_FIX_SUMMARY.md](WHATSAPP_FIX_SUMMARY.md) | Ringkasan perbaikan WhatsApp |

## 🎯 Cara Kontribusi

Kami menyambut kontribusi dari komunitas! Berikut cara berkontribusi:

1. **Fork** repository ini
2. Buat **branch fitur** (`git checkout -b feature/AmazingFeature`)
3. **Commit** perubahan (`git commit -m 'Add some AmazingFeature'`)
4. **Push** ke branch (`git push origin feature/AmazingFeature`)
5. Buka **Pull Request**

### Panduan Kontribusi
- Ikuti gaya kode yang sudah ada
- Tambahkan dokumentasi untuk fitur baru
- Pastikan semua test berjalan dengan baik
- Perbarui README jika diperlukan

## 📞 Dukungan

Jika Anda memerlukan bantuan:

- Buat **issue** di [GitHub Issues](https://github.com/alijayanet/gembok-bill/issues)
- Hubungi tim pengembang melalui email
- Bergabung dengan komunitas Discord (jika tersedia)

## 📄 Lisensi

Project ini dilisensikan di bawah lisensi ISC - lihat file [LICENSE](LICENSE) untuk detail lebih lanjut.

## 👥 Tim Pengembang

- **ALIJAYA Team** - [@alijayanet](https://github.com/alijayanet)

## 🙏 Ucapan Terima Kasih

- Terima kasih kepada semua kontributor yang telah membantu pengembangan project ini
- Komunitas open source yang memberikan inspirasi dan dukungan

---
<div align="center">
  
  💻 Dikembangkan dengan ❤️ untuk komunitas ISP Indonesia
  
  [Laporkan Bug](https://github.com/alijayanet/gembok-bill/issues) · [Minta Fitur](https://github.com/alijayanet/gembok-bill/issues) · [Dokumentasi](DEPLOYMENT_GUIDE.md)
  

</div>
