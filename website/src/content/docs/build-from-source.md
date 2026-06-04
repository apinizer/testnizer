---
title: Verifying releases
description: How to verify the integrity of downloaded Testnizer installers using SHA-256 checksums.
order: 1
section: Reference
---

Every release published to
[github.com/apinizer/testnizer-releases](https://github.com/apinizer/testnizer-releases/releases)
includes SHA-256 checksums for each artifact. Verifying them confirms the file
you downloaded arrived intact and was not tampered with in transit.

## Where to find checksums

Each release page lists a `checksums.txt` file alongside the installers. It
contains one line per artifact:

```
sha256:a3f8…  Testnizer-1.1.1-arm64.dmg
sha256:c91b…  Testnizer-1.1.1-x64.dmg
sha256:e54a…  Testnizer-Setup-1.1.1-x64.exe
sha256:2d77…  Testnizer-1.1.1-amd64.deb
…
```

## Verifying on macOS / Linux

```sh
shasum -a 256 Testnizer-1.1.1-arm64.dmg
```

Compare the output hash with the matching line in `checksums.txt`. They must
match exactly.

## Verifying on Windows (PowerShell)

```powershell
Get-FileHash .\Testnizer-Setup-1.1.1-x64.exe -Algorithm SHA256
```

Compare the `Hash` field against `checksums.txt`.

## Air-gapped install

For fully isolated networks:

1. On a connected machine, open the
   [latest release](https://github.com/apinizer/testnizer-releases/releases/latest)
   and download the installer for your platform plus `checksums.txt`
2. Verify the SHA-256 as above
3. Transfer the installer to the isolated machine via USB / SFTP / your
   air-gap gateway
4. Install normally

After installation, disable the auto-update check on the isolated machine:
**Settings → Updates → Automatic update check → off**.

## Release integrity

Releases are built by GitHub Actions on isolated per-OS runners. The workflow
logs and artifact upload steps are publicly visible at
[github.com/apinizer/testnizer-releases](https://github.com/apinizer/testnizer-releases/actions)
so you can trace each artifact back to the exact build run that produced it.

## Reporting issues

Open an issue at
[github.com/apinizer/testnizer-releases/issues](https://github.com/apinizer/testnizer-releases/issues).

Security issues — use GitHub's private security advisory channel
([Report a vulnerability privately](https://github.com/apinizer/testnizer-releases/security/advisories/new))
rather than opening a public issue.
