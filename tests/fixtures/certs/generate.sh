#!/usr/bin/env bash
# Regenerate test certificates. Run from this directory.
# These are NOT production secrets — only for E2E TLS/mTLS tests.
set -euo pipefail
cd "$(dirname "$0")"

# Cleanup previous artifacts
rm -f *.crt *.key *.csr *.p12 *.pem *.srl

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

# 3. Client cert signed by our CA — for mTLS tests
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

# 4. PKCS12 bundle (commonly used by clients)
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

echo
echo "Generated:"
ls -1 *.crt *.key *.p12 2>/dev/null
