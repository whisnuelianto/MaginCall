# RiskDesk v2 — Manajemen Risiko Trading MT5

Kalkulator risiko, jurnal, dan analitik untuk trader MetaTrader 5. Berjalan di GitHub Pages tanpa server. Cloud dan koneksi MT5 bersifat opsional.

## Isi folder

| File | Fungsi |
|---|---|
| `index.html`, `style.css`, `app.js` | Aplikasi utama |
| `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` | Agar bisa di-install di HP dan tetap terbuka saat offline |
| `supabase-setup.sql` | Script database untuk fitur cloud (opsional) |
| `RiskDesk_Bridge.mq5` | Expert Advisor untuk mengirim posisi MT5 ke RiskDesk (opsional) |

## Upload ke GitHub

1. Di repository, klik **Add file → Upload files**.
2. Pilih **semua file** di folder ini sekaligus, lalu seret ke halaman upload. Jangan seret foldernya.
3. Klik **Commit changes**.
4. Kalau versi 1 sudah ada, file `index.html` lama otomatis tertimpa. Data lama (modal, posisi, jurnal) di browser akan dipindahkan otomatis ke versi 2.

## Fitur

**Dashboard**
- Meter risiko total semua SL terhadap modal, dengan batas (default 25%) dan peringatan dini.
- Batas rugi harian dan mingguan. Entry bisa dikunci otomatis saat batas tercapai.
- Kalkulator dengan spread, komisi, dan swap. Hasil ditampilkan bersih dan kotor.
- Penghitung lot dari % risiko atau nominal.
- Checklist sebelum entry: risiko per trade, total risiko, R:R, margin, korelasi, dan berita.
- Paparan mata uang untuk melihat posisi searah yang bertumpuk.

**Posisi**: posisi manual dan posisi live dari MT5 (lewat EA).

**Jurnal**: tag setup dan emosi, catatan, import laporan HTML dari MT5, ekspor CSV.

**Analitik**: win rate, profit factor, ekspektasi, rata-rata R, drawdown, kurva ekuitas, serta performa per pair, sesi, hari, setup, dan emosi, plus temuan otomatis.

**Alat**: kalkulator partial close & break-even, dan simulasi Monte Carlo pertumbuhan modal.

**Berita**: jadwal berita manual atau otomatis (feed ForexFactory), dengan peringatan saat entry terlalu dekat jadwal rilis.

**Pengaturan** (PIN bawaan `1234`): akun, batas risiko, biaya, kurs, spesifikasi simbol, cloud, backup/restore.

## Install di HP

- **Android (Chrome):** buka situs → menu ⋮ → *Install app* / *Tambahkan ke layar utama*.
- **iPhone (Safari):** buka situs → tombol Bagikan → *Add to Home Screen*.

## Cloud & multi-pengguna (opsional)

Tanpa cloud, data tersimpan di browser masing-masing. Dengan cloud, data tersinkron di semua perangkat Anda dan setiap orang punya akun sendiri.

1. Daftar gratis di [supabase.com](https://supabase.com) dan buat project baru.
2. Buka **SQL Editor → New query**, tempel isi `supabase-setup.sql`, klik **Run**.
3. Buka **Project Settings → API**. Salin **Project URL** dan **anon / publishable key**.
4. Di RiskDesk: **Pengaturan → Cloud & MT5**, tempel keduanya, klik **Simpan koneksi**, lalu **Daftar akun baru**.
5. Supabase secara bawaan meminta konfirmasi email. Buka email konfirmasi, lalu tekan **Masuk**. (Bisa dimatikan di Supabase: Authentication → Sign In / Providers → Email → *Confirm email*.)

Setiap pengguna (misalnya adik Anda) cukup daftar dengan email sendiri di situs yang sama. Data tiap akun terpisah dan dilindungi Row Level Security.

## Koneksi MT5 (opsional, butuh cloud)

1. Di MT5: **File → Open Data Folder → MQL5 → Experts**, salin `RiskDesk_Bridge.mq5` ke sana.
2. Buka MetaEditor (F4), buka file tersebut, klik **Compile**.
3. Di MT5: **Tools → Options → Expert Advisors**, centang **Allow WebRequest for listed URL**, tambahkan Project URL Supabase Anda.
4. Seret EA **RiskDesk_Bridge** ke satu chart mana saja. Di tab *Inputs*, isi `SupabaseUrl`, `AnonKey`, dan `SyncToken` (salin dari Pengaturan → Cloud & MT5).
5. Pastikan tombol **Algo Trading** aktif. Di pojok chart akan muncul status "Tersinkron".

EA ini hanya **membaca** akun dan posisi. EA tidak pernah membuka, mengubah, atau menutup order. Nilai rugi di SL dihitung langsung oleh MT5 (`OrderCalcProfit`), jadi akurat sesuai spesifikasi broker. MT5 harus tetap menyala agar data live terus terkirim (bisa memakai VPS).

## Catatan penting

- **Contract size dan spread berbeda tiap broker.** Cek di MT5: klik kanan simbol → *Specification*, lalu samakan di Pengaturan → Simbol.
- Simbol dengan akhiran broker (mis. `XAUUSDm`, `EURUSD.pro`) dikenali otomatis saat import dan dari EA.
- PIN hanya mengunci menu pengaturan di perangkat, bukan pengamanan server.
- Unduh backup secara berkala jika tidak memakai cloud.
- Aplikasi ini adalah alat bantu manajemen risiko, bukan saran investasi.
