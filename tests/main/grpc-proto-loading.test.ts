/**
 * Loading a .proto: what an error may say, and where a downloaded one lives.
 *
 * `protoPath` comes from the renderer and a proto's `import` lines name more files.
 * protobufjs quotes the token it choked on, so pointing it at a file that is not a
 * proto printed that file's first token ("illegal token 'ghp_abc123' (~/token, line
 * 1)": all of a one-line secret), and a file starting with `{` goes through
 * JSON.parse, whose error can quote it too. Downloads went to a predictable name in
 * the shared temp directory, with no size limit, and the OS clears that directory.
 *
 * Also here: a proto with an unknown type made `protoLoader.load` throw inside a
 * file-read callback. That is an uncaught exception in main, and the promise never
 * settled, so Load spun forever.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [], fromId: () => null },
  app: { getPath: () => paths.userData },
}))

const { loadProto, loadProtoFromUrl, executeUnary, MAX_PROTO_BYTES } =
  await import('../../src/main/protocols/grpc.engine')

const CANARY = 'CANARY-a7f3-root'
const GOOD_PROTO = `syntax = "proto3";
package demo;
message Req { string a = 1; }
message Res { string b = 1; }
service Greeter { rpc Hello (Req) returns (Res); }
`

let dir = ''
const file = (name: string, content: string | Buffer): string => {
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'testnizer-proto-test-'))
  paths.userData = mkdtempSync(join(tmpdir(), 'testnizer-userdata-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(paths.userData, { recursive: true, force: true })
})

async function failure(load: Promise<unknown>): Promise<string> {
  try {
    await load
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('expected the load to fail')
}

describe('a load error does not quote the file', () => {
  it('a file that is not a proto: names the file and line, not the content', async () => {
    const secret = file('passwd', `${CANARY}:x:0:0:root:/root:/bin/bash\n`)
    const message = await failure(loadProto(secret))
    expect(message).not.toContain(CANARY)
    expect(message).toContain(secret)
    expect(message).toMatch(/line 1/)
  })

  it('a file starting with `{`, which goes through JSON.parse', async () => {
    const message = await failure(loadProto(file('config', `{ "token": ${CANARY} }`)))
    expect(message).not.toContain(CANARY)
  })

  it('a .json file', async () => {
    const message = await failure(loadProto(file('c.json', `${CANARY} nope`)))
    expect(message).not.toContain(CANARY)
  })

  it('a relative import pointing at another file', async () => {
    file('secret.txt', `${CANARY}\n`)
    const main = file('main.proto', 'syntax = "proto3";\nimport "secret.txt";\n')
    const message = await failure(loadProto(main))
    expect(message).not.toContain(CANARY)
    expect(message).toContain('secret.txt')
  })

  it('an absolute import', async () => {
    const secret = file('abs.txt', `${CANARY}\n`)
    const main = file('main2.proto', `syntax = "proto3";\nimport "${secret}";\n`)
    expect(await failure(loadProto(main))).not.toContain(CANARY)
  })

  it('a gRPC call given such a path returns the same safe error', async () => {
    const res = await executeUnary({
      serverAddress: '127.0.0.1:1',
      protoPath: file('call', `${CANARY}\n`),
      serviceName: 'x',
      methodName: 'y',
      requestBody: '{}',
    } as never)
    expect(res.error).toBeTruthy()
    expect(res.error).not.toContain(CANARY)
  })

  it('binary garbage', async () => {
    const message = await failure(loadProto(file('bin', Buffer.from([0, 255, 254, 0, 1, 2]))))
    expect(message).toContain('bin')
  })

  it('a missing file says so and how to recover (the OS cleared an old temp copy)', async () => {
    const message = await failure(loadProto(join(dir, 'gone.proto')))
    expect(message).toContain('gone.proto')
    expect(message).toMatch(/not found|cannot read/i)
    expect(message).toMatch(/load it again/i)
  })

  it('a directory or a device is refused before any read', async () => {
    expect(await failure(loadProto(dir))).toMatch(/not a regular file/i)
    if (process.platform !== 'win32') {
      expect(await failure(loadProto('/dev/zero'))).toMatch(/not a regular file/i)
    }
  })

  it('an oversized local file is refused before any read', async () => {
    const big = file('big.proto', `// ${'x'.repeat(MAX_PROTO_BYTES)}\n`)
    expect(await failure(loadProto(big))).toMatch(/larger than 5 MB/)
  })

  it('an empty file loads with no services (it is a valid proto)', async () => {
    expect((await loadProto(file('empty.proto', ''))).services).toEqual([])
  })

  it('a real proto mistake still says which type, and the load settles', async () => {
    const bad = file('bad.proto', 'syntax = "proto3";\nmessage A { Missing m = 1; }\n')
    expect(await failure(loadProto(bad))).toMatch(/Missing/)
  })

  it('a good proto loads', async () => {
    const parsed = await loadProto(file('good.proto', GOOD_PROTO))
    expect(parsed.services.map((s) => s.name)).toEqual(['Greeter'])
  })
})

describe('loadProtoFromUrl', () => {
  let server: Server
  let base = ''
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/huge-chunked') {
        // No Content-Length: only counting the bytes can stop this one.
        res.writeHead(200, { 'Transfer-Encoding': 'chunked' })
        res.write('syntax = "proto3";\n')
        const chunk = `// ${'x'.repeat(64 * 1024)}\n`
        let sent = 0
        const pump = (): void => {
          while (sent < MAX_PROTO_BYTES + 1024 * 1024) {
            sent += chunk.length
            if (!res.write(chunk)) {
              res.once('drain', pump)
              return
            }
          }
          res.end()
        }
        res.on('error', () => {})
        pump()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(req.url === '/not-a-proto' ? `<html>${CANARY}</html>` : GOOD_PROTO)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('keeps the copy under userData, private to this user, not in the shared temp dir', async () => {
    const { protoPath, services } = await loadProtoFromUrl(`${base}/a.proto`)
    expect(services.map((s) => s.name)).toEqual(['Greeter'])
    expect(protoPath.startsWith(join(paths.userData, 'grpc-protos'))).toBe(true)
    if (process.platform !== 'win32') {
      expect(statSync(protoPath).mode & 0o777).toBe(0o600)
      expect(statSync(join(paths.userData, 'grpc-protos')).mode & 0o777).toBe(0o700)
    }
  })

  it('the same URL reuses the same path, so a saved request keeps working', async () => {
    const a = await loadProtoFromUrl(`${base}/same.proto`)
    const b = await loadProtoFromUrl(`${base}/same.proto`)
    expect(b.protoPath).toBe(a.protoPath)
  })

  it('a symlink planted at the cache name is replaced, and its target is not written', async () => {
    const victim = file('victim', 'untouched')
    const { protoPath } = await loadProtoFromUrl(`${base}/plant.proto`)
    unlinkSync(protoPath)
    symlinkSync(victim, protoPath)

    await loadProtoFromUrl(`${base}/plant.proto`)

    expect(readFileSync(victim, 'utf8')).toBe('untouched')
    expect(lstatSync(protoPath).isSymbolicLink()).toBe(false)
    expect(readFileSync(protoPath, 'utf8')).toBe(GOOD_PROTO)
  })

  it('refuses a cache directory that is a symlink', async () => {
    const elsewhere = join(dir, 'elsewhere')
    mkdirSync(elsewhere)
    symlinkSync(elsewhere, join(paths.userData, 'grpc-protos'))
    await expect(loadProtoFromUrl(`${base}/d.proto`)).rejects.toThrow(/grpc-protos/)
  })

  it('stops a download past the limit, with or without a Content-Length', async () => {
    await expect(loadProtoFromUrl(`${base}/huge-chunked`)).rejects.toThrow(/larger than 5 MB/)
  })

  it('a page that is not a proto: an error without its content', async () => {
    const message = await failure(loadProtoFromUrl(`${base}/not-a-proto`))
    expect(message).not.toContain(CANARY)
  })
})
