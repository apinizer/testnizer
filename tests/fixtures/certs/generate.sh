#!/usr/bin/env bash
# Regenerate test certificates + keystores. Run from this directory.
# These are NOT production secrets — only for E2E TLS/mTLS tests and the
# Keystore Studio engine / interop known-answer tests.
#
# Requires: openssl (>=3) and keytool (any recent JDK, e.g. Temurin).
# Password is `testpassword` throughout, EXCEPT keytool-diffpass.jks whose
# per-entry key password is `differentpass` (store password stays
# `testpassword`) to exercise the entry-pw != store-pw path.
#
# NOTE ON GOLDENS: the keytool/openssl outputs here ARE the known-answer
# vectors for the Keystore Studio interop gate. A full re-run mints NEW random
# keys, so committed fingerprint/serial goldens (design §8.0) must be
# re-derived after a full re-run — the interop test derives expected values
# from `openssl x509` / `keytool -list -v` on the same fixture, so it stays
# green across regenerations.
set -euo pipefail
cd "$(dirname "$0")"

# Cleanup previous artifacts
rm -f *.crt *.key *.csr *.p12 *.pem *.srl *.jks *.der *.der.b64 *.ext

# ---------------------------------------------------------------------------
# TLS / mTLS fixtures (used by the HTTP E2E suite)
# ---------------------------------------------------------------------------

# 1. Local CA (self-signed root)
openssl genrsa -out ca.key 2048
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/CN=Testnizer Test CA/O=Testnizer Tests" \
  -out ca.crt

# 2. Server cert signed by our CA — for local HTTPS test server
openssl genrsa -out server.key 2048
openssl req -new -key server.key \
  -subj "/CN=localhost/O=Testnizer Tests" \
  -out server.csr
cat > server.ext <<EOF
subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 3650 -sha256 -extfile server.ext
rm -f server.csr server.ext

# 3. Client cert signed by our CA — for mTLS tests (traditional PKCS#1 key)
openssl genrsa -out client.key 2048
openssl req -new -key client.key \
  -subj "/CN=test-client/O=Testnizer Tests" \
  -out client.csr
cat > client.ext <<EOF
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
EOF
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out client.crt -days 3650 -sha256 -extfile client.ext
rm -f client.csr client.ext

# 4. PKCS12 bundle (single PrivateKeyEntry alias `test-client`, chain len 2)
openssl pkcs12 -export -out client.p12 \
  -inkey client.key -in client.crt -certfile ca.crt \
  -password pass:testpassword -name "test-client"

# 5. Bad / corrupted PKCS12 — for negative test
echo "this is not a valid p12 file" > bad.p12

# 6. Self-signed cert (no CA) — for self-signed scenario
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout selfsigned.key \
  -out selfsigned.crt \
  -days 3650 -sha256 \
  -subj "/CN=localhost-selfsigned/O=Testnizer Tests"

# ---------------------------------------------------------------------------
# Keystore Studio fixtures (used by tests/main/keystore*.test.ts).
# All keystore passwords are `testpassword` unless noted.
# ---------------------------------------------------------------------------

# 7. PKCS#8 (unencrypted) form of the client key — importKeyMaterial PKCS#8 path
openssl pkcs8 -topk8 -nocrypt -in client.key -out client.pkcs8.key

# 8. DER-encoded client cert + its base64 — base64-DER trusted-cert import
openssl x509 -in client.crt -outform DER -out client.der
base64 < client.der > client.der.b64

# 9. EC P-256 key (SEC1) + PKCS#8 + self-signed cert — EC import / field size
openssl ecparam -name prime256v1 -genkey -noout -out ec-p256.key
openssl pkcs8 -topk8 -nocrypt -in ec-p256.key -out ec-p256.pkcs8.key
openssl req -x509 -new -key ec-p256.key -sha256 -days 3650 \
  -subj "/CN=ec-client-p256/O=Testnizer Tests" -out ec-p256.crt

# 10. EC P-384 key (SEC1) + PKCS#8 + self-signed cert — EC 384 coverage
openssl ecparam -name secp384r1 -genkey -noout -out ec-p384.key
openssl pkcs8 -topk8 -nocrypt -in ec-p384.key -out ec-p384.pkcs8.key
openssl req -x509 -new -key ec-p384.key -sha256 -days 3650 \
  -subj "/CN=ec-client-p384/O=Testnizer Tests" -out ec-p384.crt

# 11. client.jks — JKS with one PrivateKeyEntry (alias `test-client`), imported
#     from client.p12 so its leaf+chain match the committed client.p12 goldens.
keytool -importkeystore \
  -srckeystore client.p12 -srcstoretype PKCS12 -srcstorepass testpassword \
  -destkeystore client.jks -deststoretype JKS -deststorepass testpassword \
  -srcalias test-client -destalias test-client -noprompt

# 12. truststore.jks — a single TrustedCertificateEntry (alias `testca`)
keytool -importcert -noprompt -alias testca -file ca.crt \
  -keystore truststore.jks -storetype JKS -storepass testpassword

# 13. keytool-diffpass.jks — key password (`differentpass`) != store password
#     (`testpassword`); exercises the entry-pw != store-pw path + negatives.
keytool -genkeypair -alias diffpass -keyalg RSA -keysize 2048 -sigalg SHA256withRSA \
  -dname "CN=diffpass-client, O=Testnizer Tests" -validity 3650 \
  -keystore keytool-diffpass.jks -storetype JKS \
  -storepass testpassword -keypass differentpass

# 14. secret.p12 — a single SecretKeyEntry (AES-256, alias `aes-secret`).
#     Secret keys are PKCS12-only (JKS cannot hold them).
keytool -genseckey -alias aes-secret -keyalg AES -keysize 256 \
  -storetype PKCS12 -keystore secret.p12 \
  -storepass testpassword -keypass testpassword

# 15. client-ec.p12 — P-256 key + self-signed cert (alias `ec-client`);
#     EC keySize=field-size read path. openssl-3 default = AES/PBES2.
openssl pkcs12 -export -out client-ec.p12 \
  -inkey ec-p256.key -in ec-p256.crt \
  -password pass:testpassword -name "ec-client"

# 16. multi.p12 — a MULTI-ALIAS PKCS12 keystore with three friendlyName'd
#     entries: PrivateKeyEntry `test-client`, TrustedCertificateEntry
#     `ca-root`, SecretKeyEntry `aes-secret`. Drives all-aliases import and the
#     JKS secret-skip case.
keytool -importkeystore \
  -srckeystore client.p12 -srcstoretype PKCS12 -srcstorepass testpassword \
  -destkeystore multi.p12 -deststoretype PKCS12 -deststorepass testpassword \
  -srcalias test-client -destalias test-client -noprompt
keytool -importcert -noprompt -alias ca-root -file ca.crt \
  -keystore multi.p12 -storetype PKCS12 -storepass testpassword
keytool -genseckey -alias aes-secret -keyalg AES -keysize 256 \
  -storetype PKCS12 -keystore multi.p12 \
  -storepass testpassword -keypass testpassword

# 17. client-aes.p12 — `openssl pkcs12 -export` with the openssl-3 DEFAULT
#     algorithms (AES-256-CBC, PBES2). alias `test-client`.
openssl pkcs12 -export -out client-aes.p12 \
  -inkey client.key -in client.crt -certfile ca.crt \
  -password pass:testpassword -name "test-client"

# 18. client-legacy.p12 — `openssl pkcs12 -export -legacy` (RC2/3DES + old-style
#     PBE), the pre-openssl-3 container many enterprise JDKs still emit.
openssl pkcs12 -export -legacy -out client-legacy.p12 \
  -inkey client.key -in client.crt -certfile ca.crt \
  -password pass:testpassword -name "test-client"

echo
echo "Generated:"
ls -1 *.crt *.key *.p12 *.jks *.der *.der.b64 2>/dev/null
