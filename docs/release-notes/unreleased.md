## Unreleased

> Working notes for the next tag. Fold into `docs/release-notes/vX.Y.Z.md`
> (and mirror into the website changelog) before pushing the tag.

### ⚠️ Behaviour change — the Collection Runner now sends your client certificate

**What changed.** Until now, project **client certificates (mTLS) were attached
only on Send.** The Collection Runner, Test Suites and Scheduled runs never
attached one — so a request that worked with the Send button could fail (or go
out unauthenticated) the moment you ran it from a collection. Run now uses the
exact same certificate logic as Send.

**What this means for you.**

- Collections that failed on Run against mutual-TLS APIs should now work
  without any change.
- **A run that previously went out with no certificate may now present one.**
  Certificates are still matched to the request host, so a certificate scoped to
  `api.example.com` is never presented to another host. However, a certificate
  whose host is `*` matches **every** host a collection touches — including
  third-party/public APIs that previously received nothing.

> **Please check before your next run:** open **Project Settings → Certificates**
> and make sure every *Client Certificate* entry has a specific host (not `*`).
> A wildcard is fine for CA/trust entries; for client certificates it means your
> client identity is presented to every host in the run.

**Failures are now loud.** If a matching client certificate can't be loaded
(missing file, unreadable folder, wrong keystore alias or password), that single
request fails with a clear message instead of quietly going out unauthenticated.
The rest of the run continues as usual — unless "stop on error" is enabled.

**Scripted requests are unaffected.** `pm.sendRequest(...)` still attaches no
project certificate, on Send and on Run alike.

### New — pick key material from a saved keystore (optional)

Certificates and private keys can now come from a **saved keystore** instead of
being pasted or picked file-by-file. The new picker shows your keystore library
(Tools → Keystore), lets you choose an alias, and stores only a reference —
the key itself never leaves the app core.

Available in three places:

- **Project Settings → Certificates → Client Certificate** — a new
  *Keystore / Security* choice next to the existing CRT/KEY/PFX files.
- **SOAP request → WS-Security → Sign**
- **Tools → WS-Security → Sign**

**Nothing changes unless you use it.** Pasting a PEM and picking CRT/KEY/PFX
files keep working exactly as before and remain the default in every one of
those screens; "Use pasted PEM" switches a surface back at any time.

**Passwords you type in the picker are never saved.** A keystore password (for
stores that don't remember theirs) and a per-entry key password are sent to the
app core when the request runs and are kept for the current session only — they
are not written to disk and never shown again. After a restart, a source that
needs one asks again rather than failing silently.

**Your PFX passphrase is safe.** The per-entry keystore password is stored
separately, so trying the keystore option on a certificate that already uses a
PFX file can no longer overwrite that file's passphrase. Switching back to
*Files* restores exactly what you had.

**The passphrase field is now write-only.** It shows *"Saved — type to
replace"* instead of the stored value; use *Clear passphrase* to remove one.
The stored secret no longer leaves the app core at all.

### Smaller certificate/WS-Security fixes

- Choosing *Keystore / Security* no longer changes the certificate until you
  actually pick an alias — a half-configured row can't break your next run.
- Keystores that don't remember their password can't be attached to a saved
  certificate (a saved certificate has nowhere to keep a password); they are
  shown greyed out with an explanation instead of failing later on every run.
- A CA/trust entry pointed at a keystore now reports a clear error instead of
  silently attaching no trust anchor.
- WS-Security **Sign** now requires both a certificate and a private key. A
  config with an empty certificate and the *IssuerSerial* key-info option used
  to produce a signature with an empty issuer/serial reference — it now fails
  with a clear message.

**Known limitation.** A keystore saved with an *empty* password can't be used as
a key source yet; give it a password (or re-save it with "remember password") to
use it here.
