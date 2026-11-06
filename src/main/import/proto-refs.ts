/**
 * A `.proto` file's `import` lines are paths, and the loader reads them
 * synchronously on main's thread as it parses. So before a file loads, every import,
 * followed through the files it reaches, must be a regular `.proto` file: a FIFO or
 * `/dev/zero` would never finish reading, and any other file could surface in a
 * parser error. Where a project keeps its imports is its own business (`../common.proto`).
 *
 * `confined` is for a file whose import lines someone else wrote: a downloaded proto's
 * server chooses them and the loaded definitions show in the app, so it reaches nothing
 * outside its folder.
 *
 * The loader's own parser and path resolver decide what is imported and from where.
 * The grammar has more spellings than a text search sees: `import"x"`, adjacent
 * strings joined into one path, a `//` path inside a string.
 */
import { existsSync, realpathSync, statSync } from 'fs'
import { dirname, resolve, sep } from 'path'
import * as protobuf from 'protobufjs'
import { InputDocumentError } from '../../shared/bounded-document'
import { readImportFile } from './safe-input'

const { path: loaderPath } = protobuf.util

const isProtoName = (path: string): boolean => /\.proto$/i.test(path)

function refused(name: string, reason: string): InputDocumentError {
  return new InputDocumentError(`This .proto file imports "${name}", which ${reason}.`)
}
const notAProto = (name: string): InputDocumentError =>
  refused(name, 'is not a .proto file. Only .proto files can be imported')
const notRegular = (name: string): InputDocumentError => refused(name, 'is not a regular file')
const outsideFolder = (name: string): InputDocumentError =>
  refused(name, 'is outside its folder. A downloaded proto can only import files next to it')

function importsOf(text: string): string[] {
  try {
    const parsed = protobuf.parse(text, new protobuf.Root(), { keepCase: true })
    return [...(parsed.imports ?? []), ...(parsed.weakImports ?? [])]
  } catch {
    return [] // the loader reports this file's parse error, in its own words
  }
}

export function assertProtoImportsSafe(protoPath: string, { confined = false } = {}): void {
  const entry = resolve(protoPath)
  const folder = dirname(entry)
  const realFolder = confined ? realpathSync(folder) : ''
  const resolver = new protobuf.Root()
  const pending = [entry]
  const seen = new Set<string>()

  while (pending.length > 0) {
    const file = pending.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const name of importsOf(readImportFile(file))) {
      // Exactly the path the loader opens, so the checks below see the same file.
      const target = resolver.resolvePath(file, name) ?? name
      if (
        confined &&
        (loaderPath.isAbsolute(loaderPath.normalize(name)) ||
          !resolve(target).startsWith(folder + sep))
      ) {
        throw outsideFolder(name)
      }
      if (!isProtoName(target)) throw notAProto(name)
      if (!existsSync(target)) continue // the loader's own error; bundled types are never read
      if (!statSync(target).isFile()) throw notRegular(name)
      const real = realpathSync(target)
      if (confined && !real.startsWith(realFolder + sep)) throw outsideFolder(name)
      if (!isProtoName(real)) throw notAProto(name)
      pending.push(target)
    }
  }
}
