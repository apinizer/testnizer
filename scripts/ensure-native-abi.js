#!/usr/bin/env node
/**
 * ensure-native-abi.js
 *
 * Pin `better-sqlite3` (and any other native module that needs to load) to
 * the right Node.js ABI for whatever's about to run:
 *
 *   • `electron` → rebuild against the Electron version pinned in
 *     package.json. Used before `dev`, `build:*`, packaging, and after
 *     `npm install` (postinstall).
 *
 *   • `node` → rebuild against the system Node.js running this script.
 *     Used before `vitest` (renderer + main unit tests) which spawn under
 *     plain Node, not Electron.
 *
 * Why this exists: better-sqlite3 ships exactly one .node binary, and any
 * `npm rebuild` / `electron-builder install-app-deps` call overwrites it.
 * Without this script, switching between `npm test` and `npm run build`
 * (or `npm run dev`) breaks the binary every other invocation.
 *
 * Robustness:
 *   • Caches the last-applied state in a marker file so consecutive runs
 *     of the same target are near-instant (<10 ms).
 *   • Detects the stale-`.forge-meta` bug where electron-rebuild thinks
 *     the module is already built at the right ABI even after an
 *     out-of-band `npm rebuild` flipped it. Runs with `--force` so the
 *     check is bypassed when our marker disagrees with reality.
 *   • Works with `--mark-only` so the postinstall step can record state
 *     after electron-builder did the rebuild itself, instead of doing it
 *     twice.
 *
 * Usage:
 *   node scripts/ensure-native-abi.js electron          # rebuild for Electron
 *   node scripts/ensure-native-abi.js node              # rebuild for system Node
 *   node scripts/ensure-native-abi.js electron --mark-only
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const target = process.argv[2]
const markOnly = process.argv.includes('--mark-only')

if (target !== 'electron' && target !== 'node') {
  console.error('usage: ensure-native-abi.js <electron|node> [--mark-only]')
  process.exit(2)
}

const root = path.resolve(__dirname, '..')
const moduleDir = path.join(root, 'node_modules', 'better-sqlite3')
const buildDir = path.join(moduleDir, 'build', 'Release')
const binary = path.join(buildDir, 'better_sqlite3.node')
const marker = path.join(buildDir, '.testnizer-abi')

if (!fs.existsSync(moduleDir)) {
  // First-ever install hasn't finished yet — postinstall will call us again.
  console.log('[ensure-native-abi] better-sqlite3 not installed yet — skipping')
  process.exit(0)
}

function readPkgJson() {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
}

function electronVersion() {
  const pkg = readPkgJson()
  const raw = pkg.devDependencies?.electron ?? pkg.dependencies?.electron
  if (!raw) return 'unknown'
  return String(raw).replace(/^[\^~]/, '')
}

function desiredMarker() {
  if (target === 'node') return `node:${process.versions.modules}`
  return `electron:${electronVersion()}`
}

function readMarker() {
  try {
    return fs.readFileSync(marker, 'utf-8').trim()
  } catch {
    return ''
  }
}

function writeMarker(value) {
  try {
    fs.writeFileSync(marker, value)
  } catch (e) {
    console.warn('[ensure-native-abi] could not write marker:', e.message)
  }
}

const want = desiredMarker()
const have = readMarker()
const binaryExists = fs.existsSync(binary)

if (markOnly) {
  // postinstall path: electron-builder already rebuilt — just record state.
  writeMarker(want)
  console.log(`[ensure-native-abi] marked as ${want} (--mark-only)`)
  process.exit(0)
}

if (have === want && binaryExists) {
  // Fast-path: nothing to do. Repeated runs of the same target are essentially free.
  process.exit(0)
}

console.log(
  `[ensure-native-abi] target=${target}  current="${have || '(none)'}" → want="${want}"`,
)

if (target === 'node') {
  // System-Node ABI — `npm rebuild better-sqlite3` always rebuilds against
  // the running Node, regardless of any cached forge state.
  const r = spawnSync('npm', ['rebuild', 'better-sqlite3'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (r.status !== 0) {
    console.error('[ensure-native-abi] npm rebuild failed')
    process.exit(r.status || 1)
  }
} else {
  // Electron ABI — `@electron/rebuild --force` bypasses the stale `.forge-meta`
  // check that otherwise causes electron-builder install-app-deps to silently
  // skip after `npm rebuild` has flipped the binary.
  const r = spawnSync(
    'npx',
    ['@electron/rebuild', '--force', '--only', 'better-sqlite3'],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
  )
  if (r.status !== 0) {
    console.error('[ensure-native-abi] electron-rebuild failed')
    process.exit(r.status || 1)
  }
}

writeMarker(want)
console.log(`[ensure-native-abi] now at ${want}`)
