---
title: WS-Security
description: Sign, encrypt, verify, and decrypt SOAP envelopes locally — no online tools.
order: 2
section: Protocols
---

WS-Security is the SOAP message-level security spec — it covers signing,
encrypting, and authenticating XML envelopes. Most modern API testing tools
either don't support it at all or push you toward an online "SOAP debugger"
that uploads your envelope to a vendor.

Testnizer does it on-device, in the same main process that fires the request.
Private keys load from disk in memory, get used for the operation, and are
zeroed when the request completes.

## What's supported

| Feature | Status |
|---|---|
| **UsernameToken** — Password Text + Password Digest with nonce / created | ✓ |
| **Timestamp** with custom TTL | ✓ |
| **XML Signature** RSA-SHA1 / RSA-SHA256, envelope or specific elements | ✓ |
| **XML Encryption** AES-128/256-CBC, AES-128/256-GCM, RSA-OAEP key wrapping | ✓ |
| **Verify** signature against attached certificate | ✓ |
| **Decrypt** with project-stored private key | ✓ |
| Standalone workbench tool (apply / verify / sign / decrypt arbitrary XML) | ✓ |

## Adding security to a SOAP request

Open a SOAP request → **Auth** tab → **WS-Security**.

The configuration is per-request, not per-collection. This matches how most
WS-Security headers work in practice — different operations on the same
endpoint often need different security elements.

### UsernameToken (Password Text)

```xml
<wsse:Security xmlns:wsse="...">
  <wsse:UsernameToken>
    <wsse:Username>alice</wsse:Username>
    <wsse:Password Type="...PasswordText">secret</wsse:Password>
  </wsse:UsernameToken>
</wsse:Security>
```

In the WS-Security pane:

- **Username**: `alice`
- **Password type**: `PasswordText`
- **Password**: `secret` (passes through OS keychain — never plaintext on disk)

### UsernameToken (Password Digest)

Adds nonce + created timestamp + a SHA-1 digest of `nonce + created + password`.
The receiving service compares against its stored hash.

- **Username**: `alice`
- **Password type**: `PasswordDigest`
- **Password**: `secret`
- **Nonce length**: 16 bytes (default)
- **Created TTL**: 5 minutes (default)

### Timestamp

Adds a `<wsu:Timestamp>` element with `Created` and `Expires`. Reject-on-stale
behaviour is enforced server-side; configure the TTL to match your endpoint's
tolerance window.

### XML Signature

Picks a certificate from the project's certificate store. Sign:

- **Whole envelope** — signs `<soap:Body>` (most common)
- **Specific elements** — XPath expression list, sign each match

Algorithm: RSA-SHA256 by default; RSA-SHA1 for legacy endpoints. The
certificate's public key is embedded as a `BinarySecurityToken` so the
receiver can verify without a separate key exchange.

### XML Encryption

Encrypts the body element using a hybrid scheme:

- A random 128- or 256-bit AES key encrypts the body
- The AES key is wrapped with RSA-OAEP using the receiver's certificate
- Both go into the security header

The receiver's cert lives in the project's certificate store. Add it from
**Certificates → + New** and pick it from the dropdown.

## Standalone workbench

The **Tools → WS-Security workbench** lets you apply / verify / sign / decrypt
arbitrary XML without firing a request. Useful when you've captured an
envelope and want to inspect it before sending a real one.

Same engine, same private keys — no online tool needed.

## Why this matters

Online "SOAP debuggers" are how production XML envelopes end up in someone
else's S3 bucket. WS-Security envelopes typically contain:

- Customer PII inside `<soap:Body>`
- Authentication tokens in the security header
- Signed claims that — once intercepted — can be replayed

If your team's signed envelopes contain regulated data (banking, healthcare,
government), the only correct answer is local crypto. Testnizer gives you
exactly that.

## Reference

- W3C [XML Signature Syntax and Processing](https://www.w3.org/TR/xmldsig-core1/)
- W3C [XML Encryption Syntax and Processing](https://www.w3.org/TR/xmlenc-core1/)
- OASIS [WS-Security 1.1](https://docs.oasis-open.org/wss-m/wss/v1.1.1/os/wss-SOAPMessageSecurity-v1.1.1-os.html)
