---
title: TLS Inspector
description: Inspect what a live endpoint actually serves — certificate chain, protocol version, cipher, ALPN — and save a presented certificate as trusted.
order: 5
section: Tools
---

**Tools → TLS Inspector** connects to a host and reports what it presents.

> This is the one security tool that uses the network, and it has to: its whole
> job is to talk to a remote endpoint. It uploads nothing — it reads what the
> server sends. Every other tool in this section works with the cable pulled.

## What it reports

**The handshake** — negotiated TLS version, cipher suite, and the ALPN protocol
the server selected.

**The chain** — every certificate the server sent, in order, each with subject,
issuer, serial, SANs, validity, key algorithm and size, signature algorithm and
fingerprints.

**The verdict** — hostname match, expiry, and whether the chain is trusted,
each stated separately so you can tell which one failed.

## When the handshake fails

If the connection never completes — DNS failure, refused connection, timeout —
you get the transport error and nothing else. There are no certificate badges,
because there is no certificate: showing "hostname mismatch" for a host that
could not be resolved is a wrong answer dressed as a real one.

A handshake can also succeed with an empty chain. That is treated the same way
for the certificate verdicts — the protocol and cipher are real and are shown,
the certificate badges are not.

## Host vs SNI

You can set the SNI name independently of the host you connect to, which is how
you test a virtual host that DNS does not point at yet.

When the two differ it is said plainly: the footer shows the host and port that
were actually dialled, and the result notes that the certificate was validated
against the SNI name instead. Two names in play with no indication of which one
was checked is how a wrong "it works" gets recorded.

## Protocol range

`min` and `max` TLS version can be pinned to reproduce a negotiation problem —
for example forcing TLS 1.2 to see whether an endpoint really rejects 1.3. A
range with `min` above `max` is refused before the connection is attempted,
with a message that says what is wrong.

## Client certificates

The inspector can present a client certificate, from a PFX or a certificate and
key pair. PFX and cert/key are mutually exclusive: sending both is a
configuration you cannot reason about, so it is not allowed.

## Adding a certificate as trusted

A certificate the server presented can be saved into a
**[keystore](/docs/keystore-studio)** as a trust entry, either an existing one
from your library or a new one created on the spot. Useful with an internal CA
that no public trust store knows about.

Creating one asks for the store type and password like any other keystore.
