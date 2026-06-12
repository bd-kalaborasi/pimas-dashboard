# PIMAS Dashboard

PIMAS product-intelligence dashboard — situs statis di GitHub Pages.

**Data terenkripsi AES-256-GCM; akses butuh kredensial per-pengguna.** File
`data.viewer.enc.json` & `data.ops.enc.json` hanya berisi ciphertext. Login bersifat
multi-pengguna: setiap pengguna punya username + passphrase sendiri. Passphrase
menurunkan kunci (PBKDF2-HMAC-SHA256, 600.000 iterasi) yang membuka kunci data
(envelope encryption) saat halaman dibuka — kunci dan passphrase tidak pernah
disimpan di repo ini. Tanpa kredensial yang benar, dekripsi gagal dan tidak ada data
yang dapat dibaca. `users.json` hanya berisi kunci ter-wrap (aman dipublikasikan);
tidak ada nama asli atau password di dalamnya.

- Shell aplikasi (HTML/CSS/JS) bersifat publik dan tidak memuat rahasia apa pun.
- Konten repo ini di-push otomatis oleh pipeline — jangan edit manual; perubahan
  akan ditimpa pada publish berikutnya.
- Tidak menerima issue/PR; repo ini murni artefak hosting.
