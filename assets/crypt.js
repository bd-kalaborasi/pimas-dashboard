/*
 * PIMAS dashboard — crypt.js (ES module, KONTRAK-DATA v3 §2)
 *
 * Envelope multi-user, WebCrypto API SAJA (tanpa lib pihak ketiga). Kontrak kripto
 * (WAJIB identik dengan scripts/dash-users.mjs + scripts/encrypt-dashboard-data.mjs):
 *
 *   uid      = hex(SHA-256(lowercase(trim(username)) + ":" + site_salt_b64)).slice(0,12)
 *   KEK_user = PBKDF2-HMAC-SHA256(password.trim(), salt_user 16B, iterasi WAJIB
 *              TEPAT 600000 — nilai lain DITOLAK, anti-downgrade) → AES-256-GCM
 *   unwrap   = AES-256-GCM(KEK_user, iv, AAD `pimas-wrap|{uid}|{role_key}|{kv}`)
 *              → DEK 32B per role_key (viewer|ops). GCM auth tag = satu-satunya
 *              verifier kredensial (tidak ada hash password terpisah).
 *   blob     = {"v":3,"role":"viewer|ops","kv":N,"iv":"<b64>","ct":"<b64>"},
 *              AES-256-GCM dengan AAD `pimas-data|{role}|{kv}` (proteksi swap/rollback).
 *
 * Pesan galat WRONG_CREDENTIALS sengaja generik — tidak membedakan "user tidak ada"
 * dari "password salah". DEK hasil unwrap = CryptoKey non-extractable.
 */

const te = new TextEncoder();
const td = new TextDecoder();

const KDF_ALGORITHM = 'PBKDF2-SHA256';
const KDF_ITERATIONS = 600000;
const ROLE_KEYS = ['viewer', 'ops'];

function getSubtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('WebCrypto tidak tersedia — buka dashboard lewat HTTPS atau localhost');
  }
  return c.subtle;
}

function b64ToBytes(b64) {
  if (typeof b64 !== 'string' || b64 === '') throw new Error('BAD_BASE64');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(str) {
  const digest = await getSubtle().digest('SHA-256', te.encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveKek(password, saltBytes) {
  const subtle = getSubtle();
  const baseKey = await subtle.importKey(
    'raw',
    te.encode(String(password == null ? '' : password).trim()),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: KDF_ITERATIONS },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

/**
 * Unwrap DEK milik satu user dari users.json.
 *
 * @param {object} usersJson isi users.json (sudah di-parse)
 * @param {string} username  nama login (di-lowercase + trim untuk uid lookup)
 * @param {string} password  passphrase terbitan owner (di-trim)
 * @returns {Promise<{viewer?: CryptoKey, ops?: CryptoKey, role: string, uid: string}>}
 * @throws Error('BAD_USERS_JSON')     format/KDF tidak sesuai kontrak v3 (anti-downgrade)
 * @throws Error('WRONG_CREDENTIALS')  user tidak ditemukan ATAU semua unwrap gagal
 */
export async function unwrapDeks(usersJson, username, password) {
  // Anti-downgrade: tolak users.json yang bukan persis PBKDF2-SHA256 600000 iterasi.
  if (
    !usersJson ||
    usersJson.v !== 3 ||
    !usersJson.kdf ||
    usersJson.kdf.algorithm !== KDF_ALGORITHM ||
    usersJson.kdf.iterations !== KDF_ITERATIONS ||
    typeof usersJson.site_salt !== 'string' ||
    !Array.isArray(usersJson.users)
  ) {
    throw new Error('BAD_USERS_JSON');
  }

  const uid = (
    await sha256Hex(String(username == null ? '' : username).trim().toLowerCase() + ':' + usersJson.site_salt)
  ).slice(0, 12);

  const user = usersJson.users.find((u) => u && u.uid === uid);
  if (!user || typeof user.salt !== 'string' || !user.wrapped_keys) {
    throw new Error('WRONG_CREDENTIALS');
  }

  const subtle = getSubtle();
  const kek = await deriveKek(password, b64ToBytes(user.salt));

  const out = { role: user.role, uid };
  let unwrapped = false;
  for (const roleKey of ROLE_KEYS) {
    const w = user.wrapped_keys[roleKey];
    if (!w) continue;
    try {
      const raw = await subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: b64ToBytes(w.iv),
          additionalData: te.encode(`pimas-wrap|${uid}|${roleKey}|${w.kv}`),
        },
        kek,
        b64ToBytes(w.ct),
      );
      out[roleKey] = await subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
      unwrapped = true;
    } catch {
      /* GCM auth gagal pada wrap ini — lanjut; bila SEMUA gagal → kredensial salah */
    }
  }
  if (!unwrapped) throw new Error('WRONG_CREDENTIALS');
  return out;
}

/**
 * Dekripsi blob data dashboard ({v,role,kv,iv,ct} — PERSIS field itu).
 *
 * @param {object} encObj isi data.{role}.enc.json (sudah di-parse)
 * @param {CryptoKey} dek DEK hasil unwrapDeks (viewer atau ops)
 * @returns {Promise<object>} payload data hasil dekripsi (JSON)
 * @throws Error('BAD_BLOB')           format blob tidak persis kontrak v3
 * @throws Error('DECRYPT_FAILED')     GCM auth/AAD gagal (DEK salah, blob di-swap, kv rollback)
 */
export async function decryptBlob(encObj, dek) {
  if (
    !encObj ||
    typeof encObj !== 'object' ||
    encObj.v !== 3 ||
    (encObj.role !== 'viewer' && encObj.role !== 'ops') ||
    !Number.isInteger(encObj.kv) ||
    encObj.kv < 1 ||
    typeof encObj.iv !== 'string' ||
    typeof encObj.ct !== 'string' ||
    encObj.iv === '' ||
    encObj.ct === ''
  ) {
    throw new Error('BAD_BLOB');
  }
  // PERSIS {v,role,kv,iv,ct}: field ekstra apa pun = blob tercemar → tolak.
  const extra = Object.keys(encObj).filter((k) => !['v', 'role', 'kv', 'iv', 'ct'].includes(k));
  if (extra.length) throw new Error('BAD_BLOB');

  let plain;
  try {
    plain = await getSubtle().decrypt(
      {
        name: 'AES-GCM',
        iv: b64ToBytes(encObj.iv),
        additionalData: te.encode(`pimas-data|${encObj.role}|${encObj.kv}`),
      },
      dek,
      b64ToBytes(encObj.ct),
    );
  } catch {
    throw new Error('DECRYPT_FAILED');
  }
  return JSON.parse(td.decode(plain));
}
