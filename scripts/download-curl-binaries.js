#!/usr/bin/env node
// scripts/download-curl-binaries.js
//
// Bundle-curl downloader. Fetches a statically-linked curl binary from
// stunnel/static-curl GitHub releases (curl 8.20.0+) and drops it under
// resources/curl/{platform}-{arch}/. Each binary is fully self-contained
// (musl-static on Linux, no DLLs on Windows, codesign-eligible on macOS)
// and supports TLS 1.0/1.1, which the bundled Electron 33 (BoringSSL)
// refuses to negotiate.
//
// Why: TLS 1.0/1.1 fallback path in src/main/protocols/curl-shim.ts
// spawns `curl` to talk to legacy enterprise endpoints (banks, gov API
// gateways). Bundling means end users never have to install curl.
//
// Usage:
//   node scripts/download-curl-binaries.js               # current platform
//   node scripts/download-curl-binaries.js --target=win32-x64
//   node scripts/download-curl-binaries.js --all         # every target
//   node scripts/download-curl-binaries.js --force       # re-download
//
// Output: resources/curl/{platform}-{arch}/curl    (curl.exe on Windows)
// Skipped: if the target file already exists and `--force` was not passed,
// the download is short-circuited (CI cache friendliness).

import { mkdir, rm, stat, writeFile, chmod, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, '..')
const OUT_ROOT = join(REPO_ROOT, 'resources', 'curl')

// Pin to a known-good release. Bump deliberately — every new curl picks up
// CVE fixes but we want a curated, tested baseline rather than "latest".
const CURL_VERSION = '8.20.0'
const RELEASE_BASE = `https://github.com/stunnel/static-curl/releases/download/${CURL_VERSION}`

// Map our internal platform-arch keys (which mirror Electron's
// `process.platform` + `process.arch`) onto the asset filename pattern
// stunnel/static-curl publishes. We choose the most self-contained variant
// per OS: musl on Linux (zero glibc dep), the standalone macOS build, and
// the windows mingw build.
const TARGETS = {
  'darwin-arm64': `curl-macos-arm64-${CURL_VERSION}.tar.xz`,
  'darwin-x64': `curl-macos-x86_64-${CURL_VERSION}.tar.xz`,
  'linux-arm64': `curl-linux-aarch64-musl-${CURL_VERSION}.tar.xz`,
  'linux-x64': `curl-linux-x86_64-musl-${CURL_VERSION}.tar.xz`,
  'win32-arm64': `curl-windows-aarch64-${CURL_VERSION}.tar.xz`,
  'win32-x64': `curl-windows-x86_64-${CURL_VERSION}.tar.xz`,
}

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--') && !a.includes('=')))
const opts = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => a.replace(/^--/, '').split('=')),
)

const FORCE = flags.has('--force')
const ALL = flags.has('--all')

function currentTarget() {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  if (!arch) {
    console.error(`[download-curl] unsupported host arch: ${process.arch}`)
    process.exit(2)
  }
  const key = `${process.platform}-${arch}`
  if (!(key in TARGETS)) {
    console.error(`[download-curl] no curl asset mapped for ${key}`)
    process.exit(2)
  }
  return key
}

function chosenTargets() {
  if (ALL) return Object.keys(TARGETS)
  if (opts.target) {
    if (!(opts.target in TARGETS)) {
      console.error(`[download-curl] unknown --target=${opts.target}`)
      console.error(`  known: ${Object.keys(TARGETS).join(', ')}`)
      process.exit(2)
    }
    return [opts.target]
  }
  return [currentTarget()]
}

function spawnCapture(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let out = ''
    let err = ''
    p.stdout.on('data', (c) => (out += c.toString()))
    p.stderr.on('data', (c) => (err += c.toString()))
    p.on('error', reject)
    p.on('exit', (code) => {
      if (code === 0) resolve({ stdout: out, stderr: err })
      else reject(new Error(`${cmd} exited ${code}: ${err.trim() || out.trim()}`))
    })
  })
}

async function downloadAsset(target) {
  const assetName = TARGETS[target]
  const url = `${RELEASE_BASE}/${assetName}`
  const outDir = join(OUT_ROOT, target)
  const outBinary = join(outDir, process.platform === 'win32' && target.startsWith('win32') ? 'curl.exe' : target.startsWith('win32') ? 'curl.exe' : 'curl')

  if (!FORCE && existsSync(outBinary)) {
    try {
      const st = await stat(outBinary)
      if (st.size > 0) {
        console.log(`[download-curl] ${target}: cached (${(st.size / 1024 / 1024).toFixed(1)}MB) — skip; use --force to refresh`)
        return
      }
    } catch {
      // fall through to download
    }
  }

  await mkdir(outDir, { recursive: true })
  const tarPath = join(tmpdir(), `testnizer-curl-${target}-${Date.now()}.tar.xz`)

  console.log(`[download-curl] ${target}: GET ${url}`)
  // `curl` is available on every modern OS — use it for the download rather
  // than reimplementing redirect + retry logic. Falls back to fetch() on
  // hosts where curl is genuinely absent (rare; bootstrap problem).
  let downloadedViaCurl = false
  try {
    await spawnCapture('curl', ['-fsSL', '-o', tarPath, url])
    downloadedViaCurl = true
  } catch (e) {
    console.warn(`[download-curl] ${target}: curl GET failed (${(e).message}); falling back to fetch()`)
  }
  if (!downloadedViaCurl) {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(tarPath, buf)
  }

  // Extract. The archive layout from stunnel/static-curl is just `curl` (or
  // `curl.exe`) at the root; older releases sometimes nested under a
  // version directory. `tar -xJf --strip-components=0` handles the flat
  // case; if the binary lands inside a subdir we move it up below.
  console.log(`[download-curl] ${target}: extracting`)
  const isWin = target.startsWith('win32')
  // Use `tar` (BSD tar on macOS, GNU tar on Linux, bsdtar shipped with
  // Windows 10 1803+). All three understand `-xJf` (xz). On Windows tar
  // sometimes mangles symlinks; not an issue for curl which is a single
  // executable.
  await spawnCapture('tar', ['-xJf', tarPath, '-C', outDir])

  // Find the curl binary inside outDir — could be `curl`, `curl.exe`, or
  // nested one level deep depending on the upstream archive layout.
  const candidates = isWin ? ['curl.exe', 'curl'] : ['curl']
  let resolvedBinary = null
  for (const name of candidates) {
    const direct = join(outDir, name)
    if (existsSync(direct)) {
      resolvedBinary = direct
      break
    }
  }
  if (!resolvedBinary) {
    // Walk one level looking for it.
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(outDir, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory()) {
        for (const name of candidates) {
          const nested = join(outDir, e.name, name)
          if (existsSync(nested)) {
            resolvedBinary = nested
            break
          }
        }
      }
      if (resolvedBinary) break
    }
  }
  if (!resolvedBinary) {
    throw new Error(`could not locate curl binary inside ${outDir} after extracting ${assetName}`)
  }
  if (resolvedBinary !== outBinary) {
    // Move/rename to the canonical location.
    const { rename } = await import('node:fs/promises')
    await rename(resolvedBinary, outBinary)
  }
  if (!isWin) {
    await chmod(outBinary, 0o755)
  }

  // Cleanup temp archive.
  try {
    await rm(tarPath, { force: true })
  } catch {
    /* ignore */
  }

  // Verify — only when the binary is runnable on this host (matches our
  // process.platform + process.arch). Cross-arch downloads still pass
  // through fine; we just skip the smoke test.
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const hostTarget = `${process.platform}-${arch}`
  if (target === hostTarget) {
    try {
      const { stdout } = await spawnCapture(outBinary, ['--version'])
      const first = stdout.split('\n')[0].trim()
      const tlsLine = stdout
        .split('\n')
        .find((l) => l.toLowerCase().startsWith('protocols:') || l.toLowerCase().startsWith('features:'))
      console.log(`[download-curl] ${target}: ${first}`)
      if (tlsLine) console.log(`[download-curl] ${target}: ${tlsLine.trim()}`)
    } catch (e) {
      console.warn(`[download-curl] ${target}: binary placed but smoke-test failed (${(e).message})`)
    }
  } else {
    const st = await stat(outBinary)
    console.log(`[download-curl] ${target}: placed (${(st.size / 1024 / 1024).toFixed(1)}MB)`)
  }
}

async function main() {
  const targets = chosenTargets()
  console.log(`[download-curl] version ${CURL_VERSION}; targets: ${targets.join(', ')}`)
  await mkdir(OUT_ROOT, { recursive: true })
  for (const t of targets) {
    await downloadAsset(t)
  }
  console.log(`[download-curl] done. Output: ${OUT_ROOT}`)

  // Write a manifest so the about-modal / debug surface can show which
  // curl shipped with this build. Plain JSON for trivial parsing.
  const manifest = {
    version: CURL_VERSION,
    source: 'https://github.com/stunnel/static-curl',
    license: 'curl license (MIT-flavoured) — https://curl.se/docs/copyright.html',
    targets: targets.reduce((acc, t) => {
      const isWin = t.startsWith('win32')
      acc[t] = isWin ? 'curl.exe' : 'curl'
      return acc
    }, {}),
    downloadedAt: new Date().toISOString(),
  }
  await writeFile(join(OUT_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

main().catch((e) => {
  console.error('[download-curl] FAILED:', e)
  process.exit(1)
})

// Keep readFile alive in the import surface for future manifest verification.
void readFile
