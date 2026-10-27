#!/usr/bin/env node
/**
 * ensure-electron-binary.js — make sure node_modules/electron/dist holds the
 * Electron binary that matches the installed `electron` package.
 *
 * Electron 42+ no longer downloads itself from a `postinstall` script (see the
 * 42.0 entry of Electron's breaking-changes doc). It downloads lazily the first
 * time `require('electron')` resolves the executable, or when `install-electron`
 * runs. Our own postinstall then renames the macOS bundle to Testnizer.app
 * (scripts/patch-electron-name.sh), which needs the bundle to exist first — so
 * the download is forced here, at install time, the way it used to happen.
 *
 * Electron's own `install.js` cannot be called unconditionally: its "already
 * installed?" check compares path.txt with `Electron.app/...`, and after our
 * rename path.txt says `Testnizer.app/...`, so it would re-extract a second
 * Electron.app next to the renamed one on every `npm install`. This script
 * therefore decides on its own:
 *   • dist/version matches the package AND path.txt points at an executable
 *     that exists → nothing to do;
 *   • anything else (fresh install, version bump, half-extracted dist) → remove
 *     dist + path.txt and run Electron's install.js once.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const electronDir = path.resolve(__dirname, '..', 'node_modules', 'electron')
const pkgFile = path.join(electronDir, 'package.json')

if (!fs.existsSync(pkgFile)) {
  console.log('[ensure-electron-binary] electron is not installed yet — skipping')
  process.exit(0)
}

const { version } = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'))
const distDir = path.join(electronDir, 'dist')
const pathTxt = path.join(electronDir, 'path.txt')

function installedVersion() {
  try {
    return fs.readFileSync(path.join(distDir, 'version'), 'utf-8').trim().replace(/^v/, '')
  } catch {
    return ''
  }
}

function executableExists() {
  try {
    const rel = fs.readFileSync(pathTxt, 'utf-8').trim()
    return rel.length > 0 && fs.existsSync(path.join(distDir, rel))
  } catch {
    return false
  }
}

if (installedVersion() === version && executableExists()) {
  process.exit(0)
}

console.log(`[ensure-electron-binary] downloading Electron ${version}`)
fs.rmSync(distDir, { recursive: true, force: true })
fs.rmSync(pathTxt, { force: true })

const r = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], {
  cwd: electronDir,
  stdio: 'inherit',
})
if (r.status !== 0) {
  console.error('[ensure-electron-binary] Electron download failed')
  process.exit(r.status || 1)
}
if (installedVersion() !== version || !executableExists()) {
  console.error('[ensure-electron-binary] Electron download did not produce a usable binary')
  process.exit(1)
}
console.log(`[ensure-electron-binary] Electron ${version} ready`)
