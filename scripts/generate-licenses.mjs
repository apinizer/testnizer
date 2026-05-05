#!/usr/bin/env node
/**
 * Build-time helper: enumerates production npm dependencies and writes a
 * compact JSON manifest (name, version, license, repo) to
 * `resources/third-party-licenses.json`.
 *
 * The manifest is bundled into the packaged app via `extraResources` and
 * surfaced in the About modal so the app meets attribution obligations of
 * MIT / Apache / BSD / ISC dependencies.
 *
 * Usage:
 *   node scripts/generate-licenses.mjs
 *
 * Run automatically before `electron-builder` packaging.
 */

import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const target = path.join(repoRoot, 'resources', 'third-party-licenses.json')

console.log('[licenses] enumerating production dependencies...')

const raw = execSync(
  'npx --no-install license-checker --production --json --excludePackages testnizer@1.0.0',
  { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
)

/** @type {Record<string, { licenses?: string|string[]; repository?: string; publisher?: string; url?: string }>} */
const data = JSON.parse(raw)

const entries = Object.entries(data)
  .map(([key, info]) => {
    const m = key.match(/^(.+)@([^@]+)$/)
    return {
      name: m?.[1] ?? key,
      version: m?.[2] ?? '0.0.0',
      license: Array.isArray(info.licenses) ? info.licenses.join(', ') : (info.licenses ?? 'UNKNOWN'),
      repository: info.repository ?? null,
      publisher: info.publisher ?? null,
      url: info.url ?? null,
    }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

mkdirSync(path.dirname(target), { recursive: true })
writeFileSync(
  target,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      count: entries.length,
      entries,
    },
    null,
    2,
  ),
)

console.log(`[licenses] wrote ${entries.length} entries → ${path.relative(repoRoot, target)}`)
