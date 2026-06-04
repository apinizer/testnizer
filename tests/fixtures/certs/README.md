# Test Certificates

These are test-only certificates and keys used by the HTTP E2E test suite.

**They are NOT secrets.** Do not use them outside the test environment.

## Files

| File | Purpose |
|---|---|
| `ca.crt`, `ca.key` | Local self-signed CA |
| `server.crt`, `server.key` | Server cert signed by our CA (CN=localhost, SAN: localhost, 127.0.0.1) |
| `client.crt`, `client.key`, `client.p12` | Client cert for mTLS tests (P12 password: `testpassword`) |
| `selfsigned.crt`, `selfsigned.key` | Self-signed (no CA) — for self-signed acceptance test |
| `bad.p12` | Intentionally corrupted PKCS12 — for negative tests |

## Regenerate

```bash
./generate.sh
```

Validity: 10 years (3650 days). Re-run if expired.
