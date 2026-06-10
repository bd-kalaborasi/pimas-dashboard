/*
 * PIMAS dashboard — crypt.js
 * Kontrak kripto SPEC §2 (WAJIB identik dengan scripts/encrypt-dashboard-data.mjs):
 *   - Key derivation : PBKDF2-HMAC-SHA256, iterasi WAJIB tepat 600000 (nilai lain
 *     DITOLAK — payload pihak ketiga tidak bisa memaksa KDF beriterasi rendah), salt b64.
 *   - Password material: UTF-8 `${id}:${password}` — id di-lowercase + trim; password trim saja.
 *   - Cipher         : AES-256-GCM, IV 12 byte (b64), tanpa AAD; ct = ciphertext+tag (b64).
 *   - Format encObj  : {"v":1,"kdf":"PBKDF2-SHA256","iter":600000,"salt":"…","iv":"…","ct":"…"}
 * File ini standalone (tanpa dependency) dan bisa jalan di browser maupun Node >= 20
 * (keduanya menyediakan globalThis.crypto.subtle, atob, TextEncoder/TextDecoder).
 */
(function (global) {
  'use strict';

  function b64ToBytes(b64) {
    if (typeof b64 !== 'string') throw new Error('Field base64 tidak valid');
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function getSubtle() {
    var c = global.crypto;
    if (!c || !c.subtle) {
      throw new Error('WebCrypto tidak tersedia — buka dashboard lewat HTTPS atau localhost');
    }
    return c.subtle;
  }

  /**
   * Dekripsi payload dashboard PIMAS.
   * @param {object} encObj   isi data.enc.json (sudah di-parse)
   * @param {string} id       ID login (akan di-lowercase + trim)
   * @param {string} password password login (akan di-trim)
   * @returns {Promise<object>} objek data.json hasil dekripsi
   * @throws  bila format salah atau kredensial salah (GCM auth tag gagal)
   */
  async function pimasDecrypt(encObj, id, password) {
    if (!encObj || encObj.v !== 1 || encObj.kdf !== 'PBKDF2-SHA256' ||
        encObj.iter !== 600000 || !encObj.salt || !encObj.iv || !encObj.ct) {
      throw new Error('Format data terenkripsi tidak dikenal');
    }
    var subtle = getSubtle();
    var enc = new TextEncoder();
    var material = enc.encode(
      String(id == null ? '' : id).toLowerCase().trim() + ':' +
      String(password == null ? '' : password).trim()
    );
    // SPEC §2: iterasi sudah divalidasi === 600000 di atas — sama ketatnya dengan
    // decrypt() di scripts/encrypt-dashboard-data.mjs.
    var iterations = encObj.iter;

    var baseKey = await subtle.importKey('raw', material, { name: 'PBKDF2' }, false, ['deriveKey']);
    var key = await subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: b64ToBytes(encObj.salt), iterations: iterations },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    var plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(encObj.iv) },
      key,
      b64ToBytes(encObj.ct)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  global.pimasDecrypt = pimasDecrypt;
})(typeof window !== 'undefined' ? window : globalThis);
