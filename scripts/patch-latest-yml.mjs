// Recompute electron-updater manifest hashes after re-signing the installers.
//
// electron-builder writes latest.yml with the sha512 (base64) + byte size of
// each .exe. Re-signing an .exe (Authenticode) changes its bytes, so the
// manifest no longer matches and electron-updater rejects the update with a
// "sha512 mismatch". This patches latest.yml in place: for every file it
// references, it recomputes sha512 + size from the SIGNED file in <dir>, and
// fixes the top-level sha512 (which mirrors the `path` installer).
//
// Usage: node scripts/patch-latest-yml.mjs <path-to-latest.yml> <dir-with-signed-files>
// No secrets involved — operates on public installer bytes only.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import yaml from 'js-yaml'

const [, , ymlPath, dir] = process.argv
if (!ymlPath || !dir) {
  console.error('Usage: node scripts/patch-latest-yml.mjs <latest.yml> <signed-files-dir>')
  process.exit(1)
}

const sha512b64 = (file) =>
  crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')
const sizeOf = (file) => fs.statSync(file).size

const doc = yaml.load(fs.readFileSync(ymlPath, 'utf8'))
let patched = 0

for (const entry of doc.files ?? []) {
  const f = path.join(dir, entry.url)
  if (!fs.existsSync(f)) {
    console.warn(`  • skip (not found): ${entry.url}`)
    continue
  }
  entry.sha512 = sha512b64(f)
  entry.size = sizeOf(f)
  patched++
  console.log(`  • ${entry.url} → size ${entry.size}`)
}

// Top-level sha512 mirrors the primary `path` installer.
if (doc.path) {
  const f = path.join(dir, doc.path)
  if (fs.existsSync(f)) doc.sha512 = sha512b64(f)
}

fs.writeFileSync(ymlPath, yaml.dump(doc, { lineWidth: -1 }))
console.log(`✅ ${path.basename(ymlPath)} updated (${patched} file entries rehashed)`)
