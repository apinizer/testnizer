# Test Certificates & Keystores

These are test-only certificates, keys, and keystores used by the HTTP E2E test
suite and by the Keystore Studio engine / interop known-answer tests
(`tests/main/keystore*.test.ts`).

**They are NOT secrets.** Do not use them outside the test environment.
All keystore/PKCS12 passwords are `testpassword` unless noted.

## TLS / mTLS fixtures (HTTP E2E)

| File | Purpose |
|---|---|
| `ca.crt`, `ca.key` | Local self-signed CA |
| `server.crt`, `server.key` | Server cert signed by our CA (CN=localhost, SAN: localhost, 127.0.0.1) |
| `client.crt`, `client.key`, `client.p12` | Client cert for mTLS tests. `client.key` is traditional PKCS#1 (`BEGIN RSA PRIVATE KEY`). P12 = single PrivateKeyEntry alias `test-client`, chain length 2 (leaf + CA root) |
| `selfsigned.crt`, `selfsigned.key` | Self-signed (no CA) — for self-signed acceptance test |
| `bad.p12` | Intentionally corrupted PKCS12 — for negative tests |

## Keystore Studio fixtures

These keytool / openssl outputs **are the known-answer vectors** for the
Keystore Studio interop gate (`tests/main/keystore-interop.test.ts`).

| File | What it is | Exercises |
|---|---|---|
| `client.jks` | JKS, one `PrivateKeyEntry` alias `test-client` (imported from `client.p12`) | JKS load / inspect / convert |
| `truststore.jks` | JKS, one `TrustedCertificateEntry` alias `testca` (the CA cert) | trusted-cert entry cases |
| `keytool-diffpass.jks` | JKS, alias `diffpass` whose **key password (`differentpass`) ≠ store password (`testpassword`)** | entry-pw ≠ store-pw path + negatives |
| `secret.p12` | PKCS12, one `SecretKeyEntry` (AES-256, alias `aes-secret`) | secret-key copy / JKS secret-skip |
| `multi.p12` | **Multi-alias** PKCS12: `PrivateKeyEntry test-client` + `TrustedCertificateEntry ca-root` + `SecretKeyEntry aes-secret` (all `friendlyName`'d) | all-aliases import, multi-alias assembly, JKS secret-skip |
| `client-ec.p12` | PKCS12, P-256 key + self-signed cert, alias `ec-client` (openssl-3 default AES/PBES2) | EC keySize = field-size read path |
| `client-aes.p12` | `openssl pkcs12 -export` with the **openssl-3 default** algorithms (PBES2, PBKDF2, AES-256-CBC, MAC sha256), alias `test-client` | modern PKCS12 read parity |
| `client-legacy.p12` | `openssl pkcs12 -export -legacy` (pbeWithSHA1And40BitRC2-CBC, MAC sha1), alias `test-client` | legacy PKCS12 read (needs OpenSSL legacy provider) |
| `client.pkcs8.key` | Unencrypted PKCS#8 form of `client.key` | importKeyMaterial PKCS#8 path |
| `client.der`, `client.der.b64` | `client.crt` as raw DER and its base64 | base64-DER trusted-cert import |
| `ec-p256.key`, `ec-p256.pkcs8.key`, `ec-p256.crt` | P-256 key (SEC1), PKCS#8 form, and self-signed cert | EC import / field size (256) |
| `ec-p384.key`, `ec-p384.pkcs8.key`, `ec-p384.crt` | P-384 key (SEC1), PKCS#8 form, and self-signed cert | EC 384 coverage |

## Regenerate

```bash
./generate.sh
```

Requires `openssl` (>=3) and `keytool` (any recent JDK, e.g. Temurin).
Validity: 10 years (3650 days). Re-run if expired.

> **Goldens caveat:** a full `./generate.sh` re-run mints **new random keys**,
> so any committed fingerprint/serial goldens (design §8.0) change. The interop
> test derives its expected values from `openssl x509` / `keytool -list -v` on
> the same fixture at runtime, so it stays green across regenerations; hard-coded
> engine goldens must be refreshed by hand after a full re-run.
