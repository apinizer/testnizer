#!/usr/bin/env node
/**
 * verify-natives.js
 *
 * After electron-builder runs, walk the unpacked app bundles in dist/ and
 * verify that every *.node native module matches the expected
 * (platform, arch) combination.  This catches the classic cross-build bug
 * where a stale better_sqlite3.node from the previous target ends up
 * baked into the next target's installer.
 *
 * Usage:
 *   node scripts/verify-natives.js --platform=darwin --arch=arm64
 *   node scripts/verify-natives.js --platform=linux  --arch=x64
 *   node scripts/verify-natives.js --platform=win32  --arch=arm64
 *
 * Exits 0 if every .node binary matches, non-zero otherwise.
 *
 * On Windows this uses the Node `Buffer` approach to read the PE header
 * (Machine field) since `file(1)` isn't guaranteed to be available.
 * On macOS/Linux it shells out to `file(1)`.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const DIST = path.resolve(__dirname, '..', 'dist')

// ---------- arg parsing --------------------------------------------------
function parseArgs(argv) {
  const out = {}
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  if (!out.platform || !out.arch) {
    console.error('usage: verify-natives.js --platform=<darwin|linux|win32> --arch=<x64|arm64>')
    process.exit(2)
  }
  return out
}

// ---------- directory layout --------------------------------------------
// electron-builder unpacks each target to a well-known folder inside dist/.
// We only scan the folder that matches the (platform, arch) we were told
// we're verifying, to avoid false positives from stale siblings.
function unpackedDirs({ platform, arch }) {
  const candidates = []
  if (platform === 'darwin') {
    // mac (x64 default) or mac-arm64
    candidates.push(arch === 'arm64' ? 'mac-arm64' : 'mac')
  } else if (platform === 'linux') {
    candidates.push(arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked')
  } else if (platform === 'win32') {
    candidates.push(arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked')
  }
  return candidates
    .map((d) => path.join(DIST, d))
    .filter((p) => fs.existsSync(p))
}

// ---------- recursive .node walk ----------------------------------------
function findNodeBinaries(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        stack.push(full)
      } else if (e.isFile() && e.name.endsWith('.node')) {
        out.push(full)
      }
    }
  }
  return out
}

// ---------- arch detection ----------------------------------------------
// Mach-O (darwin) + ELF (linux): use `file(1)` — universally available on
// macOS and on every ubuntu-* GitHub runner.
function archFromFileCommand(binPath) {
  const raw = execFileSync('file', ['-b', binPath], { encoding: 'utf8' }).trim()
  return { raw, classify: classifyFileOutput(raw) }
}

function classifyFileOutput(out) {
  const lower = out.toLowerCase()
  // macOS
  if (lower.includes('mach-o')) {
    if (lower.includes('arm64')) return { platform: 'darwin', arch: 'arm64' }
    if (lower.includes('x86_64')) return { platform: 'darwin', arch: 'x64' }
    if (lower.includes('universal')) return { platform: 'darwin', arch: 'universal' }
    return { platform: 'darwin', arch: 'unknown' }
  }
  // Linux ELF
  if (lower.includes('elf')) {
    if (lower.includes('aarch64')) return { platform: 'linux', arch: 'arm64' }
    if (lower.includes('x86-64') || lower.includes('x86_64')) return { platform: 'linux', arch: 'x64' }
    return { platform: 'linux', arch: 'unknown' }
  }
  // Windows PE (file(1) on linux/mac can identify these too — catches the
  // exact bug the user reported: a Windows DLL sneaking into a .dmg.)
  if (lower.includes('pe32') || lower.includes('ms-dos executable') || lower.includes('for ms windows')) {
    if (lower.includes('aarch64') || lower.includes('arm64')) return { platform: 'win32', arch: 'arm64' }
    if (lower.includes('x86-64') || lower.includes('x86_64')) return { platform: 'win32', arch: 'x64' }
    return { platform: 'win32', arch: 'unknown' }
  }
  return { platform: 'unknown', arch: 'unknown' }
}

// On Windows runners `file(1)` is not present. Read the PE header directly:
// DOS stub (offset 0x3C) -> PE signature -> COFF header's Machine field.
//   0x8664 = AMD64 (x64), 0xAA64 = ARM64, 0x014C = i386.
function archFromPEHeader(binPath) {
  const fd = fs.openSync(binPath, 'r')
  try {
    const head = Buffer.alloc(0x40)
    fs.readSync(fd, head, 0, 0x40, 0)
    if (head.readUInt16LE(0) !== 0x5a4d /* 'MZ' */) {
      return { raw: 'not a PE file', classify: { platform: 'unknown', arch: 'unknown' } }
    }
    const peOffset = head.readUInt32LE(0x3c)
    const coff = Buffer.alloc(6)
    fs.readSync(fd, coff, 0, 6, peOffset)
    if (coff.readUInt32LE(0) !== 0x00004550 /* 'PE\0\0' */) {
      return { raw: 'bad PE signature', classify: { platform: 'unknown', arch: 'unknown' } }
    }
    const machine = coff.readUInt16LE(4)
    let arch = 'unknown'
    if (machine === 0x8664) arch = 'x64'
    else if (machine === 0xaa64) arch = 'arm64'
    else if (machine === 0x014c) arch = 'ia32'
    return {
      raw: `PE32+ Machine=0x${machine.toString(16)}`,
      classify: { platform: 'win32', arch },
    }
  } finally {
    fs.closeSync(fd)
  }
}

function detect(binPath) {
  if (process.platform === 'win32') return archFromPEHeader(binPath)
  try {
    return archFromFileCommand(binPath)
  } catch (e) {
    // Fallback if `file` isn't available — try reading headers ourselves.
    return archFromPEHeader(binPath)
  }
}

// ---------- main ---------------------------------------------------------
function main() {
  const args = parseArgs(process.argv)
  const expected = { platform: args.platform, arch: args.arch }

  const dirs = unpackedDirs(expected)
  if (dirs.length === 0) {
    console.error(
      `[verify-natives] no unpacked dir found under dist/ for ${expected.platform}/${expected.arch}`
    )
    process.exit(1)
  }

  const failures = []
  let checked = 0

  for (const dir of dirs) {
    const bins = findNodeBinaries(dir)
    if (bins.length === 0) {
      failures.push(`no .node binaries under ${dir}`)
      continue
    }
    for (const bin of bins) {
      const { raw, classify } = detect(bin)
      checked++
      const ok = classify.platform === expected.platform && classify.arch === expected.arch
      const rel = path.relative(DIST, bin)
      if (ok) {
        console.log(`  ok   ${rel}  [${classify.platform}/${classify.arch}]`)
      } else {
        console.log(`  FAIL ${rel}  expected=${expected.platform}/${expected.arch}  got=${classify.platform}/${classify.arch}`)
        console.log(`       file: ${raw}`)
        failures.push(rel)
      }
    }
  }

  console.log(`[verify-natives] checked ${checked} binary(ies), ${failures.length} mismatch(es)`)
  if (failures.length > 0) {
    console.error('[verify-natives] FAILED — the installer would ship the wrong native binary.')
    process.exit(1)
  }
  console.log('[verify-natives] all native binaries match expected target.')
}

main()
