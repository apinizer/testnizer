---
title: JWK & JWKS
description: Convert PEM to JWK and back, generate keys, compute RFC 7638 thumbprints, and serve a JWKS from the local mock server — offline.
order: 3
section: Tools
---

**Tools → JWK** is the JSON Web Key workbench: conversion, generation,
thumbprints, and assembling a key set you can actually serve.

## PEM ⇄ JWK

Paste a PEM and get the JWK, or paste a JWK and get the PEM back. RSA and EC
keys, public or private.

Two things worth knowing:

- The **private** JWK card's copy button says it copies a private key. The
  neighbouring button copies only the public half. They are labelled
  differently on purpose — a generic "Copy" next to key material is how a
  private key ends up in a chat message.
- Converting is not a verdict. If you change the input, the previous PEM is
  cleared rather than left sitting next to the new key, so you never read a
  result that belongs to something you already replaced.

## Generating

Pick an algorithm and a size and get a fresh key directly as a JWK — no PEM
round trip. `kid` is generated for you and can be overwritten.

## Thumbprints

RFC 7638 thumbprints are computed from the canonical member set, so the value
matches what an identity provider computes for the same key. Useful when you
are trying to work out which of three keys a token was actually signed with.

## Building a key set

The **Set** tab collects keys into a JWKS. Adding the same key twice is
reported rather than silently deduplicated, because two entries with one `kid`
is a real configuration bug you want to see now.

## Serving a JWKS

A key set can be served from the built-in **[mock server](/docs/mock-server)**
as a JWKS endpoint. That closes the loop for an offline identity test:

1. Generate a key pair in the JWK tool.
2. Add the public key to a set and serve it as `/.well-known/jwks.json`.
3. Sign a token with the private half in the
   **[JWT / JOSE](/docs/jwt-debugger)** tool — or from a pre-request script
   with `pm.jose.sign`.
4. Verify against the served JWKS URL.

The whole flow runs on `127.0.0.1`, so it works on a machine with no route to
the internet.

## Verifying a token against a JWKS

The JWT tool's **JWKS** panel fetches a key set from a URL and verifies with
it. Two behaviours are deliberate:

- **Load reports next to Load.** A fetch failure appears beside the button that
  fetched, not in the verification result. Reporting "invalid" for a token that
  was never checked would send you looking at the wrong thing.
- **No caching between load and verify.** An identity provider can rotate keys
  between the two, and a cached key set would then report a good token as
  having a bad signature.

## Where the keys go

Nowhere. Conversion, generation and thumbprinting run in the app's process
using Node's own crypto. The only request the JWK screens make is the JWKS
fetch you explicitly ask for, to the URL you typed.
