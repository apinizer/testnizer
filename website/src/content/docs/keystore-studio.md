---
title: Keystore Studio
description: Open, create, edit, convert and export JKS and PKCS#12 keystores and X.509 certificates — offline, without keytool or openssl.
order: 2
section: Tools
---

Keystore Studio is the part of Testnizer that replaces `keytool`, `openssl` and
a separate certificate viewer. Open **Tools → Keystore Studio**.

Everything happens in the app's main process, on your machine. A private key is
never sent anywhere, and never reaches the window you are looking at — the UI
receives descriptions of entries, not key material.

## Formats

| Format | Open | Create | Save | Notes |
|---|---|---|---|---|
| **PKCS#12** (`.p12`, `.pfx`) | ✅ | ✅ | ✅ | The portable one. Java, .NET, browsers, curl. |
| **JKS** (`.jks`) | ✅ | ✅ | ✅ | Java's own. Still what most app servers expect. |
| **X.509** (`.cer`, `.crt`, `.pem`, `.der`) | ✅ | — | — | Read-only inspection. |

## Opening a keystore

**Open keystore** asks for the file and its store password. If the password is
wrong you are told so in the dialog, not behind it.

The alias table lists every entry with its type (`KEY`, `CERT`, or a secret
key), the algorithm and size, the certificate's validity, and whether the entry
carries its own password. Selecting an entry shows the full certificate detail —
subject, issuer, serial, SANs, key usage and extended key usage, signature
algorithm, and SHA-1 / SHA-256 fingerprints.

## Creating one

**New keystore** takes a type and a store password.

> A JKS refuses an empty store password, and the dialog says why: in JKS the
> key stream is derived from a salt stored in the file itself, so an empty
> password is not encryption — the private key can be recovered without
> guessing anything. PKCS#12 accepts an empty password, but then the store can
> only hold certificates: any path that would add a key or a secret refuses,
> because the effective entry password would be empty too.

## Generating keys

**Generate key pair** produces an RSA or EC key and a self-signed certificate.
You choose the algorithm and size, the subject DN, the validity in days, and
the extensions:

- **Basic constraints** — mark it a CA or not. If you mark it a CA, Testnizer
  points out that a CA which cannot sign certificates is not useful, so
  `keyCertSign` should be on.
- **Key usage / extended key usage** — set explicitly rather than guessed.
- **SANs** — DNS names and IP addresses. A certificate without the name you
  will actually connect to is the most common cause of a "hostname mismatch"
  you then spend an hour on.

**Generate secret key** produces an AES or HMAC secret for keystores that hold
symmetric material.

## Importing

Import accepts five shapes, and picks the right one from the file:

- a **PKCS#12** bundle (key + chain)
- a **PEM** private key with a certificate
- a **DER** certificate
- a **certificate chain**
- a **certificate only**, as a trust entry

After an import that carries both, Testnizer checks that the private key and
the certificate actually match, and tells you if they do not — before the entry
is written rather than at the first failed handshake.

## Converting

**Convert** rewrites the whole store as the other format.

Secret keys cannot travel to a JKS in the same shape, so they are skipped. That
is not silent: you are told which aliases will be dropped, by name, and asked to
confirm before anything is written. The result is a session in memory — use
**Save as** to write it to disk, at which point the suggested filename picks up
the new extension.

## Passwords

- **Change store password** re-encrypts the store.
- **Set entry password** gives one alias a password of its own, so an entry can
  be protected separately from the store.

Neither will accept an empty value. Loosening a protection that already exists
would be a silent downgrade, so it is refused rather than warned about.

## Save to Library

**Save to library** keeps a keystore in Testnizer so other screens can use it
without you locating the file again. You can ask it to remember the password,
which stores it through the OS keychain (Keychain, DPAPI, libsecret) — never in
plain text, and never in the project database.

A store whose password is empty cannot be remembered: there is nothing to
encrypt, so the app tells you rather than quietly recording it as remembered.

## Using a keystore elsewhere

Once a keystore is in the library, it becomes a **key source** everywhere a
certificate and private key are needed:

- **[Client certificates / mTLS](/docs/certificates)**
- **[WS-Security](/docs/ws-security)** signing and encryption
- **[JWT / JOSE](/docs/jwt-debugger)** signing and verification
- **[SAML](/docs/saml)** XML-DSig signing

This is additive. Pasting a PEM and picking CRT/KEY/PFX files still work and
remain the default on every one of those screens — nothing forces you to load a
keystore.

## What leaves the app

Nothing. Keystore Studio makes no network call of any kind. Reading, writing,
converting, generating and signing all run in the app's own process. The only
security screen that opens a connection is the
**[TLS Inspector](/docs/tls-inspector)**, which exists to talk to a remote
endpoint.
