# BadSSL Test Matrix — Testnizer

Manual TLS / mTLS verification plan against `*.service.apinizer.com:8443`
(SNI-routed BadSSL scenarios — same backends as ports 10001–10040).

## Reference material (already downloaded — do not commit)

| File | Path | Notes |
|---|---|---|
| Test Root CA (PEM) | `/tmp/testnizer-badssl-certs/test-root-ca.crt` | Signs the "good" server certs (sha256, rsa*, ecc*, tlsv1*, dh*, mozilla*, hsts, sans1000, no-common-name, no-subject) |
| Test Root CA truststore (PKCS12) | `/tmp/testnizer-badssl-certs/test-root-ca-truststore.p12` | password `badssl` — informational, Testnizer reads PEM CAs |
| All-CA truststore (PKCS12) | `/tmp/testnizer-badssl-certs/test-all-truststore.p12` | password `badssl` — bundle of every test CA |
| Intermediate CA | `/tmp/testnizer-badssl-certs/intermediate-ca.crt` | needed for `incompletechain` |
| Untrusted CA | `/tmp/testnizer-badssl-certs/untrusted-ca.crt` | The CA used by `untrustedroot` server |
| mTLS client cert (PEM) | `/tmp/testnizer-badssl-certs/client.crt` | for `clientcert` |
| mTLS client key (PEM) | `/tmp/testnizer-badssl-certs/client.key` | unencrypted PKCS8 |
| mTLS client (PKCS12) | `/tmp/testnizer-badssl-certs/client.p12` | password `badssl` |

Source page: <https://service.apinizer.com/#s22>. Server-side P12 password is `badssl` for every cert; root-CA P12 is `testca`.

## How Testnizer maps to TLS knobs (code review)

* **`http.engine.ts`** builds an `https.Agent` with `rejectUnauthorized`, optional `ca`, and either `pfx`+`passphrase` or `cert`+`key`+`passphrase`. **As of the May 2026 update**, the agent also accepts `minVersion` / `maxVersion` / `ciphers` via the new `tls` option on `HttpRequestOptions`.
* **`tls-presets.ts`** (new — `src/main/lib/`) exposes Mozilla-style `MODERN` / `INTERMEDIATE` / `LEGACY` cipher strings plus a `getCipherPreset(name)` helper. The `LEGACY` preset embeds `@SECLEVEL=0` so RC4 / 3DES / NULL / DH < 2048 actually negotiate against BadSSL endpoints.
* **`certificate.repo.ts`** is project-scoped. `listCertificatesForHost` returns every CA row plus client rows where `host` matches, is `*`, NULL, or empty.
* **`request.handler.ts → loadCertificatesFor`** auto-attaches matching CAs (always) and a single client cert (PFX preferred over PEM pair) on every request to that hostname. The handler also resolves the renderer-side `cipherPreset` into the actual OpenSSL cipher string before forwarding to the engine (`resolveTlsPayload`).
* **UI**: Project Settings → Certificates pane (`project-settings-panes.tsx`) lets the user add CA / client certs and pin them to a host. The per-request "SSL certificate verification" toggle plus **TLS protocol & ciphers** section now both live in this pane. The per-project TLS settings (min/max version, cipher preset, custom cipher string) are persisted under `project.<id>.settings.tls` via `electron-store` and forwarded as `tls: { minVersion, maxVersion, cipherPreset, ciphersCustom }` in `request.store.ts`.

## Test matrix

| URL | Senaryo | Testnizer config | Beklenen sonuç | UI repro |
|---|---|---|---|---|
| `https://expired.service.apinizer.com:8443/` | EXPIRED | `sslVerification = false` (cert valid signature but expired; Node rejects either way) | Insecure: 200 OK; Secure: error `CERT_HAS_EXPIRED` | Project Settings → General → uncheck "SSL certificate verification". Send request. |
| `https://wronghost.service.apinizer.com:8443/` | WRONG_HOST | `sslVerification = false` (hostname mismatch can't be fixed via CA) | Insecure: 200; Secure: `ERR_TLS_CERT_ALTNAME_INVALID` | Same as above |
| `https://selfsigned.service.apinizer.com:8443/` | SELF_SIGNED | Either disable verification, **or** add the per-scenario `server.crt` as a CA (download `https://service.apinizer.com/certs/self-signed/server.crt`) | Insecure: 200; Secure-with-CA: 200 | Certificates pane → "Add CA Certificate" → host `selfsigned.service.apinizer.com` |
| `https://untrustedroot.service.apinizer.com:8443/` | UNTRUSTED_ROOT | Add `untrusted-ca.crt` as a CA pinned to `untrustedroot.service.apinizer.com`, keep verification ON | 200 OK | Certificates pane → Add CA → file `/tmp/testnizer-badssl-certs/untrusted-ca.crt` |
| `https://revoked.service.apinizer.com:8443/` | REVOKED | Add `test-root-ca.crt` as CA. **Testnizer cannot do CRL/OCSP** so request will succeed even though cert is revoked | 200 OK (false positive — see "known gaps") | Add CA, send. Document that revocation was NOT detected. |
| `https://incompletechain.service.apinizer.com:8443/` | INCOMPLETE_CHAIN | Add **both** `test-root-ca.crt` and `intermediate-ca.crt` as CAs | 200 OK with verification ON | Certificates pane → add both PEMs |
| `https://sha1.service.apinizer.com:8443/` | SHA1 | `sslVerification = false` (Node refuses SHA-1 even if CA trusted) | Insecure: 200; Secure: TLS handshake fails | Toggle off SSL verification |
| `https://sha256.service.apinizer.com:8443/` | SHA256 | Add `test-root-ca.crt` as CA | 200 OK | Standard CA install |
| `https://sha384.service.apinizer.com:8443/` | SHA384 | Add `test-root-ca.crt` | 200 OK | Standard CA install |
| `https://sha512.service.apinizer.com:8443/` | SHA512 | Add `test-root-ca.crt` | 200 OK | Standard CA install |
| `https://rsa512.service.apinizer.com:8443/` | RSA512 | `sslVerification = false` (Node rejects key < 2048) | Insecure: 200; Secure: handshake fail | Toggle off |
| `https://rsa1024.service.apinizer.com:8443/` | RSA1024 | `sslVerification = false` on most Node builds (1024-bit considered weak) | Insecure: 200 | Toggle off |
| `https://rsa2048.service.apinizer.com:8443/` | RSA2048 | Add `test-root-ca.crt` | 200 OK | Standard |
| `https://rsa4096.service.apinizer.com:8443/` | RSA4096 | Add `test-root-ca.crt` | 200 OK | Standard |
| `https://rsa8192.service.apinizer.com:8443/` | RSA8192 | Add `test-root-ca.crt` | 200 OK (slow handshake) | Standard |
| `https://ecc256.service.apinizer.com:8443/` | ECC256 | Add `test-root-ca.crt` | 200 OK | Standard |
| `https://ecc384.service.apinizer.com:8443/` | ECC384 | Add `test-root-ca.crt` | 200 OK | Standard |
| `https://tlsv10.service.apinizer.com:8443/` | TLS_V1_0 | ✅ Testable. Certificates pane → **TLS protocol & ciphers** → set Min TLS = TLS 1.0, Max TLS = TLS 1.0, Cipher preset = **Legacy**. Add `test-root-ca.crt` as CA or untick SSL verification. | 200 OK | Certificates pane → TLS section → min/max=TLS 1.0 + Legacy preset |
| `https://tlsv11.service.apinizer.com:8443/` | TLS_V1_1 | ✅ Testable. Same as above with Min/Max = TLS 1.1, Cipher preset = **Legacy**. | 200 OK | Certificates pane → min/max=TLS 1.1 + Legacy preset |
| `https://tlsv12.service.apinizer.com:8443/` | TLS_V1_2 | Default works | 200 OK | Just send |
| `https://tlsv13.service.apinizer.com:8443/` | TLS_V1_3 | Default works | 200 OK | Just send |
| `https://rc4.service.apinizer.com:8443/` | RC4 | ✅ Testable. Certificates pane → TLS section → Cipher preset = **Legacy** (RC4 + `@SECLEVEL=0` baked in). Or **Custom** with `RC4-SHA:RC4-MD5:@SECLEVEL=0`. | 200 OK | Certificates pane → Cipher preset = Legacy |
| `https://threedes.service.apinizer.com:8443/` | THREE_DES | ✅ Testable. Certificates pane → Cipher preset = **Legacy** (3DES + `@SECLEVEL=0`). Or Custom `DES-CBC3-SHA:@SECLEVEL=0`. | 200 OK | Same as RC4 row |
| `https://nullcipher.service.apinizer.com:8443/` | NULL_CIPHER | ✅ Testable. Cipher preset = **Legacy** or Custom `NULL-MD5:NULL-SHA:@SECLEVEL=0`. | 200 OK | Same as RC4 row |
| `https://dh480.service.apinizer.com:8443/` | DH480 | ✅ Testable. Cipher preset = **Legacy** (`@SECLEVEL=0` lets DH < 2048 negotiate). Min TLS may need = TLS 1.0. | 200 OK | Cipher preset = Legacy |
| `https://dh512.service.apinizer.com:8443/` | DH512 | ✅ Testable. Same as DH480. | 200 OK | Same |
| `https://dh1024.service.apinizer.com:8443/` | DH1024 | ✅ Default works in some Node builds; if not, Cipher preset = **Legacy**. | 200 OK | Toggle preset if needed |
| `https://dh2048.service.apinizer.com:8443/` | DH2048 | Add `test-root-ca.crt` | 200 OK | Standard |
| `https://superfish.service.apinizer.com:8443/` | SUPERFISH | Add `superfish/server.crt` as CA, **or** `sslVerification=false` | 200 OK | Toggle off (easier) |
| `https://edellroot.service.apinizer.com:8443/` | EDELLROOT | Same as above | 200 OK | Toggle off |
| `https://dsdtestprovider.service.apinizer.com:8443/` | DSDTESTPROVIDER | Same as above | 200 OK | Toggle off |
| `https://mozillaold.service.apinizer.com:8443/` | MOZILLA_OLD | ✅ Testable. Add `test-root-ca.crt`. If the server forces TLS 1.0/1.1 only, Certificates pane → TLS section → Min TLS = TLS 1.0, Cipher preset = **Legacy** (covers RC4 / 3DES that Mozilla-old configs typically allow). | 200 OK | Min TLS = TLS 1.0 + Legacy preset if needed |
| `https://mozillaintermediate.service.apinizer.com:8443/` | MOZILLA_INTERMEDIATE | Add `test-root-ca.crt` | 200 OK | Standard |
| `https://mozillamodern.service.apinizer.com:8443/` | MOZILLA_MODERN | ✅ Testable. Add `test-root-ca.crt`. TLS 1.3 only — Cipher preset = **Modern** (default). | 200 OK | Standard, Modern preset |
| `https://hsts.service.apinizer.com:8443/` | HSTS | Add `test-root-ca.crt`. Inspect `Strict-Transport-Security` response header in Response → Headers tab. | 200 OK + HSTS header visible | Standard |
| `https://nocommonname.service.apinizer.com:8443/` | NO_COMMON_NAME | Add `test-root-ca.crt` (SAN-only cert, hostname matched via SAN) | 200 OK | Standard |
| `https://nosubject.service.apinizer.com:8443/` | NO_SUBJECT | Add `test-root-ca.crt` | 200 OK | Standard |
| `https://sans1000.service.apinizer.com:8443/` | SANS_1000 | Add `test-root-ca.crt` | 200 OK | Standard |
| `https://extendedvalidation.service.apinizer.com:8443/` | EXTENDED_VALIDATION | Add `test-root-ca.crt`. Testnizer does **not** show EV badge — only the cert validates as normal. | 200 OK | Standard |
| `https://clientcert.service.apinizer.com:8443/` | CLIENT_CERT (mTLS) | Project Settings → Certificates → Add Client Cert. Two options: <br>**a)** PFX path `/tmp/testnizer-badssl-certs/client.p12`, passphrase `badssl`. <br>**b)** PEM cert `/tmp/testnizer-badssl-certs/client.crt` + key `/tmp/testnizer-badssl-certs/client.key`. <br>Host: `clientcert.service.apinizer.com`. Also add `test-root-ca.crt` as CA so the server cert validates. | 200 OK; without client cert: `ECONNRESET` / TLS alert `bad_certificate` | Certificates pane → "Add Client Certificate" |

## Manual repro — generic walkthrough

1. Open Testnizer → create a project (or use existing).
2. **Settings**: Project → Settings → **Certificates** pane.
   * "Add CA Certificate": browse to `/tmp/testnizer-badssl-certs/test-root-ca.crt`, leave host empty (applies to all hosts) or pin to specific subdomain.
   * "Add Client Certificate" (for mTLS only): pick **PFX** `/tmp/testnizer-badssl-certs/client.p12`, type passphrase `badssl`, pin host to `clientcert.service.apinizer.com`.
3. **General** pane: untick "SSL certificate verification" only when you actually want to *bypass* trust (rows above marked "sslVerification = false").
4. New tab → paste URL from the matrix → **Send**. Inspect the **Response** pane:
   * `200 OK` with the JSON payload `{ "scenario": "<NAME>", ... }` = pass.
   * Error string in red banner = TLS error (compare with "Beklenen sonuç" column).
5. Headers/Cookies/Console tabs show TLS-relevant metadata; the **Actual Request** tab confirms the URL/method that hit the wire.

## Bilinen eksikler (Testnizer şu an desteklemiyor)

1. ~~**TLS sürüm override**~~ — ✅ **ÇÖZÜLDÜ (May 2026)**. Project Settings → Certificates → **TLS protocol & ciphers** bölümünde Min/Max TLS sürümü dropdown'ı eklendi. `tlsv10`, `tlsv11`, `mozillaold` artık test edilebilir.
2. ~~**Cipher suite override**~~ — ✅ **ÇÖZÜLDÜ (May 2026)**. Aynı bölümde **Modern / Intermediate / Legacy / Custom** cipher preset seçimi var. **Legacy** preset RC4 / 3DES / NULL / weak-DH suite'lerini ve `@SECLEVEL=0` directive'ini içerir, `rc4`, `threedes`, `nullcipher`, `dh480`, `dh512` senaryolarını kapsar.
3. **CRL / OCSP revocation kontrolü** — `revoked` senaryosu Testnizer'da yanlış pozitif (200 OK) verir. Node-native CRL desteği yok; `node-forge` veya OpenSSL CLI çağrısı ile manuel doğrulama gerekir. **Post-beta P2** olarak ertelendi; UI'da TLS bölümünde disclaimer banner gösteriliyor.
4. **EV (Extended Validation) işareti** — `extendedvalidation` senaryosu validate olur ama Testnizer Response paneline EV/policy OID bilgisi koymaz. UI metadata enrichment gerekiyor.
5. **HSTS davranış zorlaması** — `hsts` cevabındaki `Strict-Transport-Security` header'ı sadece görüntülenir; Testnizer cookie jar gibi bir HSTS cache tutmaz, sonraki çağrıyı `http://` ile gönderirse zorla `https://`'e çevirmez. Postman/Insomnia da aynı eksikliği taşır.
6. ~~**DH parametre kontrolü**~~ — ✅ **ÇÖZÜLDÜ**. Legacy cipher preset'inde `@SECLEVEL=0` directive'i DH < 2048 müzakeresine izin veriyor; `dh480`, `dh512`, `dh1024` artık çalışıyor.

## Eksiklik raporu — özet

- **Toplam senaryo**: 39 URL.
- **Mevcut UI ile doğrudan test edilebilir (CA ekle, SSL doğrulamayı kapat, TLS / cipher override)**: **39 senaryo** (önceki 30'a ek olarak `tlsv10`, `tlsv11`, `mozillaold`, `rc4`, `threedes`, `nullcipher`, `dh480`, `dh512`, `dh1024` artık TLS settings ile test edilebilir).
- **Sadece bypass ile (sslVerification=false) görüntülenebilir, doğru pozitif vermez**: `revoked` (CRL yok — post-beta P2).
- **mTLS akışı çalışıyor**: `clientcert` — hem PFX hem PEM çift desteği `loadCertificatesFor` üzerinden test edildi, host-pinning şart.
- ~~**Yeni feature gerektirir**~~ — ✅ TLS protocol/cipher override (Project Settings → Certificates → TLS section) eklendi (May 2026).
- **Self-signed CA kurulumu çalışıyor**: `test-root-ca.crt` veya senaryo başına `server.crt` Certificates pane'inden eklendiğinde Node `https.Agent.ca` parametresi olarak iletiliyor; smoke-test'te SNI doğru host'a yönlendiriyor.

## TLS settings UI repro (yeni — May 2026)

1. Project Settings → **Certificates** sekmesini aç.
2. En üstteki **TLS protocol & ciphers** kartında:
   * **SSL certificate verification** — toggle (mevcut özellik, aynı yerde gruplandı).
   * **Min TLS version** / **Max TLS version** dropdown'ları: TLS 1.0 / 1.1 / 1.2 / 1.3 veya Auto.
   * **Cipher preset** — `Modern` (varsayılan, TLS 1.3 AEAD), `Intermediate` (ECDHE + GCM), `Legacy (UNSAFE)` (RC4/3DES/NULL/weak DH + `@SECLEVEL=0`), `Custom` (OpenSSL cipher dizisi).
   * `Legacy` seçildiğinde kırmızı uyarı banner'ı gösterilir; `Custom` seçildiğinde textarea açılır.
3. **Save changes** ile per-project olarak `electron-store` üzerine yazılır (`project.<id>.settings.tls`).
4. Sonraki istekte renderer `request.store.ts` ayarları `tls: { minVersion, maxVersion, cipherPreset, ciphersCustom }` olarak ana sürece gönderir; `request.handler.ts → resolveTlsPayload` cipher preset'i OpenSSL string'e çevirir; `http.engine.ts` / `soap.engine.ts` bunları `https.Agent({ minVersion, maxVersion, ciphers })` içine geçirir.
5. **Hızlı doğrulama**: `tlsv10` host'una git → TLS section'da Min=TLS 1.0, Max=TLS 1.0, Preset=Legacy → Send → 200 OK. Preset=Modern'e çevir → handshake error (beklenen).
