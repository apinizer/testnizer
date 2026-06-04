---
title: Getting started
description: Install Testnizer, send your first request, and find where your data actually lives.
order: 1
section: Getting started
---

This is the five-minute walkthrough. By the end you'll have sent your first
HTTP request, seen the response captured locally, and know exactly where the
app stores everything on your machine.

## Install

Pick your platform from the [Download page](/download). The installers are signed
(ad-hoc on macOS during beta — you may need to right-click → Open for the first
launch).

If you want to verify the integrity of the installer before running it, see [Verifying releases](/docs/build-from-source).

## First launch

Testnizer opens to a Welcome screen. There is no account creation, no login, no
"sign in to sync" prompt. You can:

- **Create a new workspace** — workspaces hold projects; projects hold collections
- **Open an existing workspace** — point at a folder on disk
- **Skip and start with a default workspace**

Workspaces are folders. The whole project is a directory tree on your disk —
move it, version it, back it up, share it. There is no opaque cloud database.

## Send your first request

1. Click **+ New** in the left sidebar → **HTTP**
2. In the URL bar, paste `https://httpbin.org/get` and pick **GET**
3. Hit **Send**

You'll see the response in the right pane: status, headers, JSON body. The
**Console** tab at the bottom shows the raw request and response (useful when
you're debugging an envelope or a multipart upload).

## Where your data lives

By default, Testnizer keeps everything in a single SQLite database under your
OS's user-data directory:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Testnizer/` |
| Windows | `%APPDATA%\Testnizer\` |
| Linux | `~/.config/Testnizer/` |

Inside that folder you'll find:

- `data.db` — workspaces, projects, environments, history, certificates
- `secrets/` — OS-keychain-encrypted blobs for tokens and passphrases
- `settings.json` — UI preferences, keyboard shortcuts, theme

The database is portable. Copy `data.db` to another machine running Testnizer
and your collections come with it. (Encrypted secrets are tied to the OS
keychain, so those need re-entering on a new machine.)

## What's next

- [Import collections from Postman / Insomnia / OpenAPI / cURL](/docs/import-formats)
- [Add an environment with `{{variable}}` substitution](/docs/environments)
- [Test SOAP with WSDL import](/docs/protocols#soap)
- [Sign an XML envelope with WS-Security](/docs/ws-security)
