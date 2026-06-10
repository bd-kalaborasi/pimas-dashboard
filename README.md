# PIMAS Dashboard

PIMAS monitoring dashboard — situs statis di GitHub Pages.

**Data terenkripsi AES-256-GCM; akses butuh kredensial.** File `data.enc.json` hanya
berisi ciphertext — kunci diturunkan dari kredensial login (PBKDF2-HMAC-SHA256,
600.000 iterasi) saat halaman dibuka, dan tidak pernah disimpan di repo ini. Tanpa
kredensial yang benar, dekripsi gagal dan tidak ada data yang dapat dibaca.

- Shell aplikasi (HTML/CSS/JS) bersifat publik dan tidak memuat rahasia apa pun.
- Konten repo ini di-push otomatis oleh pipeline — jangan edit manual; perubahan
  akan ditimpa pada publish berikutnya.
- Tidak menerima issue/PR; repo ini murni artefak hosting.
