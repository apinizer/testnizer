---
title: Certificates
description: Add client certificates for mTLS and custom CA certificates for self-signed servers.
order: 5
section: Guides
---

Testnizer manages certificates per-project. Each project has its own
certificate store — certificates you add to one project are not visible to
others.

## Certificate store

Open **Settings → Certificates** (or click the certificate icon in the
bottom-left footer). The store has two sections:

- **Client certificates** — presented to the server during TLS handshake
  (mutual TLS / mTLS)
- **CA certificates** — added to the trust anchor for verifying server
  certificates

## Client certificates (mTLS)

Client certificates let a server verify your identity at the TLS layer,
before any HTTP authentication. This is common in:

- Banking and financial services APIs
- Internal enterprise services
- API gateways configured with `require_client_cert`
- Government / public-sector endpoints

### Supported formats

| Format | Extension | Notes |
|---|---|---|
| PEM certificate + PEM private key | `.pem` / `.crt` + `.key` | Most common on Linux/macOS |
| PFX / PKCS#12 bundle | `.pfx` / `.p12` | Common on Windows; may require a passphrase |

### Adding a PEM certificate

1. Click **Add certificate**
2. Select format **PEM**
3. Pick the certificate file (`.crt` or `.pem`)
4. Pick the private key file (`.key`)
5. Enter the passphrase if the key is encrypted (optional)
6. Set the **Hostname** pattern — see below
7. Click **Save**

### Adding a PFX certificate

1. Click **Add certificate**
2. Select format **PFX**
3. Pick the `.pfx` or `.p12` file
4. Enter the passphrase
5. Set the **Hostname** pattern
6. Click **Save**

### Hostname matching

Each certificate entry has a hostname field. Testnizer selects the
certificate based on the SNI (Server Name Indication) sent during the TLS
handshake. The hostname field supports:

| Pattern | Matches |
|---|---|
| `api.example.com` | Exact match only |
| `*.example.com` | Any subdomain of `example.com` |
| `*` | All hosts (use as a catch-all for dev environments) |

If multiple certificates match a hostname, the most specific pattern wins
(exact > subdomain wildcard > `*`).

## CA certificates (custom trust anchors)

Use this when your server presents a certificate signed by a private CA —
common in corporate networks and air-gapped environments where you manage your
own PKI.

Adding a CA certificate here avoids the need to install it in the OS trust
store and keeps it scoped to Testnizer.

### Adding a CA certificate

1. In **Settings → Certificates**, click the **CA Certificates** tab
2. Click **Add CA certificate**
3. Pick the CA `.pem` or `.crt` file
4. Give it a label (e.g. `Internal PKI Root CA`)
5. Click **Save**

The CA applies to all HTTPS, WebSocket (wss://), and gRPC TLS connections
made from that project.

### Disabling system trust store (advanced)

By default, Testnizer trusts the OS certificate store plus any CAs you've
added. To trust **only** your added CAs (ignoring the OS trust store), turn
on **Use custom CAs only** in the CA Certificates tab. This is useful in
zero-trust environments where you want explicit control over every trusted
root.

## Per-request certificate override

For HTTP requests, you can override the project certificate settings in the
request's **Settings** panel (gear icon). Useful when you need a different
certificate for one endpoint in a collection.

## Security notes

Private keys are stored encrypted at rest using the OS keychain
(`safeStorage.encryptString` on Electron). The passphrase you enter when
adding a PFX is stored the same way — it is never written to disk in plain
text.

Certificates are stored in the project's local SQLite database. Moving or
copying the database does not expose the private keys; the keys are in the
OS keychain and only decrypted in the main process at connection time.

## gRPC certificates

gRPC TLS uses the same project certificate store. In the gRPC editor's
**Connection** panel, pick **Mutual TLS** and select the hostname pattern that
matches your server. See the [gRPC guide](/docs/protocols/grpc) for details.
