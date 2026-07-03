# Tentang PIMAS

PIMAS (Product Intelligence Multi-Agent System) adalah sistem riset otomatis yang menemukan produk makanan-minuman "sehat" yang sudah terbukti laku di luar negeri, masih kosong atau kurang terlayani di Indonesia, dan layak dikaji untuk dibawa masuk. Hasil akhirnya bukan daftar ide, melainkan riset lengkap yang bisa diaudit: setiap klaim membawa sumber, setiap angka membawa formula atau label asumsi.

## Bagaimana riset bekerja

Setiap minggu, pipeline multi-tahap berjalan otomatis: pemindaian peluang dari sumber bertingkat → seleksi awal → riset produk mendalam, pemeriksaan regulasi Indonesia (izin edar BPOM, kewajiban halal, jalur impor), dan riset pasar lokal secara paralel → pemeriksaan kualitas independen → laporan akhir.

Tiga disiplin yang tidak bisa ditawar:

- **Setiap klaim ber-sumber.** Sumber digolongkan tier T1–T5: T1 otoritatif (lembaga resmi, jurnal ilmiah), T2 database terbuka dan rilis publik industri, T3 media dagang dan halaman publik marketplace, T4 forum/media sosial (hanya untuk sentimen, tidak pernah untuk angka), T5 tidak terverifikasi (tidak dipakai). Bila dua sumber saling bertentangan, keduanya ditampilkan — tidak ada yang dipilih diam-diam.
- **Setiap angka jujur asal-usulnya.** Angka berasal dari sumber langsung, dari formula yang ditulis eksplisit, atau diberi label ASUMSI lengkap dengan skenario terbaik/dasar/terburuk. Tidak ada kategori keempat.
- **QA independen.** Pemeriksa kualitas yang terpisah dari penulis riset menelusuri sampel klaim kembali ke sumber aslinya dan memberi verdict lolos/gagal. Laporan yang gagal dikembalikan untuk diperbaiki — bukan diloloskan.

## Skor lima dimensi

Setiap kandidat dinilai pada skala 0–100 dari lima dimensi: **Traksi global** (terbukti laku di pasar asalnya), **Ruang pasar ID** (seberapa kosong atau sudah terlayani kebutuhan itu di Indonesia), **Kelayakan regulasi** (jalur BPOM, halal, dan impor), **Ekonomi unit** (apakah harga jual dan biaya masuk akal sampai ke rak), dan **Momentum tren** (arah kategori dalam horizon multi-tahun, bukan tren sesaat). Skor tinggi bukan otomatis rekomendasi — pembacaan lintas-dimensi yang menentukan, dan setiap sub-skor menyertakan alasan tertulis.

## Arti verdict

- **Kaji** — lolos QA dan layak dikaji serius sebagai langkah bisnis berikutnya.
- **Pantau** — menarik tetapi belum waktunya: riset belum selesai, kapasitas siklus penuh, atau menunggu kondisi pasar/regulasi berubah. Alasannya selalu dicatat agar bisa ditinjau ulang.
- **Tolak** — tidak dilanjutkan, dengan alasan eksplisit (misalnya hambatan regulasi struktural) sehingga keputusan itu sendiri tetap bisa diaudit.

## Kejujuran metodologi

Setiap laporan memuat bagian Limitations: data apa yang tidak tersedia, asumsi mana yang paling rapuh, dan apa yang berubah jika satu-dua asumsi kunci ternyata salah. Ketidakpastian ditampilkan, bukan disembunyikan — laporan yang terdengar terlalu yakin justru yang patut dicurigai. Prinsip yang sama berlaku di dashboard ini: setiap angka yang Anda lihat dapat ditelusuri kembali ke dokumen dan sumber asalnya.
