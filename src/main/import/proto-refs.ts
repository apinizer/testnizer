/**
 * A `.proto` file's `import` lines are paths, and the loader reads them as it
 * parses. The file is untrusted input, so before it loads: every import, followed
 * through the files it reaches, must stay in the picked file's own folder, and each
 * file must be a regular one (`import "/dev/zero"` would never end).
 */
import { existsSync, realpathSync } from 'fs'
import { dirname, isAbsolute, resolve, sep } from 'path'
import { InputDocumentError } from '../../shared/bounded-document'
import { readImportFile } from './safe-input'

const IMPORT_LINE = /\bimport\s+(?:public\s+|weak\s+)?(?:"([^"]+)"|'([^']+)')/g
/** Bundled with the loader, never read from the user's disk. */
const WELL_KNOWN = 'google/protobuf/'

const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

function outside(name: string): InputDocumentError {
  return new InputDocumentError(
    `This .proto file imports "${name}", which is outside its folder. Keep imported files next to it.`,
  )
}

export function assertProtoStaysLocal(protoPath: string): void {
  const entry = realpathSync(protoPath)
  const root = dirname(entry)
  const pending = [entry]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    const text = withoutComments(readImportFile(file))
    for (const match of text.matchAll(IMPORT_LINE)) {
      const name = match[1] ?? match[2]
      if (name.startsWith(WELL_KNOWN)) continue
      if (isAbsolute(name) || /^[a-z][a-z0-9+.-]*:/i.test(name) || name.includes('\\')) {
        throw outside(name)
      }
      const target = resolve(dirname(file), name)
      // A missing file is the loader's own error to give.
      if (!existsSync(target)) {
        if (!target.startsWith(root + sep)) throw outside(name)
        continue
      }
      const real = realpathSync(target)
      if (!real.startsWith(root + sep)) throw outside(name)
      pending.push(real)
    }
  }
}
