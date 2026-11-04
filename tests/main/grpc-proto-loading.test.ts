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
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const paths = vi.hoisted(() => ({ userData: '' }))
const streamEvents = vi.hoisted(() => [] as Array<{ type: string; error?: string }>)
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
    fromId: () => ({
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (_channel: string, event: { type: string; error?: string }) => {
          streamEvents.push(event)
        },
      },
    }),
  },
  app: { getPath: () => paths.userData },
}))

const {
  loadProto,
  loadProtoFromUrl,
  executeUnary,
  executeServerStream,
  executeClientStream,
  startBidiStream,
  MAX_PROTO_BYTES,
} = await import('../../src/main/protocols/grpc.engine')
const { assertProtoImportsSafe } = await import('../../src/main/import/proto-refs')

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
  const serverReply = { status: 200, body: GOOD_PROTO }
  beforeEach(() => {
    serverReply.status = 200
    serverReply.body = GOOD_PROTO
  })
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
      res.writeHead(serverReply.status, { 'Content-Type': 'text/plain' })
      res.end(req.url === '/not-a-proto' ? `<html>${CANARY}</html>` : serverReply.body)
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

  describe('when the download fails', () => {
    /** A URL that answers once, then is gone: the connection is refused from here on. */
    const urlThatGoesAway = async (path = '/gone.proto'): Promise<string> => {
      const once = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end(GOOD_PROTO)
      })
      await new Promise<void>((r) => once.listen(0, '127.0.0.1', () => r()))
      const url = `http://127.0.0.1:${(once.address() as AddressInfo).port}${path}`
      expect((await loadProtoFromUrl(url)).fromCache).toBeUndefined()
      once.closeAllConnections()
      await new Promise<void>((r) => once.close(() => r()))
      return url
    }

    it('with no network, the saved copy of that URL loads and says it is a saved copy', async () => {
      const url = await urlThatGoesAway()
      const again = await loadProtoFromUrl(url)
      expect(again.fromCache).toBe(true)
      expect(again.services.map((s) => s.name)).toEqual(['Greeter'])
    })

    it('with a server error or a page that is not a proto, the saved copy still loads', async () => {
      const { protoPath } = await loadProtoFromUrl(`${base}/flaky.proto`)
      serverReply.status = 503
      const onError = await loadProtoFromUrl(`${base}/flaky.proto`)
      expect(onError).toMatchObject({ protoPath, fromCache: true })

      serverReply.status = 200
      serverReply.body = `<html>${CANARY}</html>`
      const onPage = await loadProtoFromUrl(`${base}/flaky.proto`)
      expect(onPage).toMatchObject({ protoPath, fromCache: true })
      expect(readFileSync(protoPath, 'utf8')).toBe(GOOD_PROTO)
    })

    it('a download that works is not reported as a saved copy', async () => {
      await loadProtoFromUrl(`${base}/fresh.proto`)
      expect((await loadProtoFromUrl(`${base}/fresh.proto`)).fromCache).toBeUndefined()
    })

    it('another URL’s copy is not used', async () => {
      const url = await urlThatGoesAway('/one.proto')
      await expect(loadProtoFromUrl(url.replace('one', 'two'))).rejects.toThrow(/no saved copy/)
    })

    it('no copy and no network: a clear error, without what the URL carries', async () => {
      const url = await urlThatGoesAway()
      const { host } = new URL(url)
      const message = await failure(
        loadProtoFromUrl(`http://user:s3cret-pw@${host}/none.proto?token=s3cret-query`),
      )
      expect(message).toMatch(/Could not download .*no saved copy/)
      expect(message).toContain(host)
      expect(message).not.toMatch(/s3cret/)
    })

    it('a link planted at the cache name is not a saved copy', async () => {
      const url = await urlThatGoesAway()
      const cached = join(
        paths.userData,
        'grpc-protos',
        `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.proto`,
      )
      unlinkSync(cached)
      symlinkSync(file('planted.proto', GOOD_PROTO), cached)
      await expect(loadProtoFromUrl(url)).rejects.toThrow(/no saved copy/)
    })

    it('a cache directory that is a symlink is refused before any saved copy', async () => {
      const url = await urlThatGoesAway()
      const cacheDir = join(paths.userData, 'grpc-protos')
      const moved = join(dir, 'moved-cache')
      renameSync(cacheDir, moved)
      symlinkSync(moved, cacheDir)
      await expect(loadProtoFromUrl(url)).rejects.toThrow(/Refusing to use/)
    })
  })
})

describe('what a proto may import, on every engine load', () => {
  const SERVICE = 'service S { rpc Do (M) returns (M); }\nmessage M { string a = 1; }\n'
  const OUTSIDE = 'syntax = "proto3";\nmessage LeakedFromOutside { string a = 1; }\n'
  const NOT_A_PROTO = /not a \.proto file/

  /** `main.proto` in a folder of its own, under `dir`, with `outside.proto` above it. */
  function protoFolder(importLine: string): { folder: string; main: string; outside: string } {
    const folder = join(dir, `f-${Math.random().toString(36).slice(2)}`)
    mkdirSync(folder)
    const outside = join(dir, 'outside.txt')
    writeFileSync(outside, OUTSIDE)
    const main = join(folder, 'main.proto')
    writeFileSync(main, `syntax = "proto3";\n${importLine}\n${SERVICE}`)
    return { folder, main, outside }
  }

  const CALL = {
    serverAddress: '127.0.0.1:1',
    serviceName: 'S',
    methodName: 'Do',
  }

  it('Load Proto refuses a file that is not a proto', async () => {
    const { main } = protoFolder('import "../outside.txt";')
    await expect(loadProto(main)).rejects.toThrow(NOT_A_PROTO)
  })

  it('Send refuses it (unary)', async () => {
    const { main } = protoFolder('import "../outside.txt";')
    const res = await executeUnary({ ...CALL, protoPath: main, requestBody: '{}' })
    expect(res.error).toMatch(NOT_A_PROTO)
  })

  it('server streaming refuses it', async () => {
    const { main } = protoFolder('import "../outside.txt";')
    streamEvents.length = 0
    await executeServerStream({ ...CALL, protoPath: main, requestBody: '{}' }, 1)
    expect(streamEvents.at(-1)?.error).toMatch(NOT_A_PROTO)
  })

  it('client streaming refuses it', async () => {
    const { main } = protoFolder('import "../outside.txt";')
    const res = await executeClientStream({ ...CALL, protoPath: main, messages: [] })
    expect(res.error).toMatch(NOT_A_PROTO)
  })

  it('bidi streaming refuses it', async () => {
    const { main } = protoFolder('import "../outside.txt";')
    streamEvents.length = 0
    await startBidiStream({ ...CALL, protoPath: main }, 1)
    expect(streamEvents.at(-1)?.error).toMatch(NOT_A_PROTO)
  })

  // The loader's own parser decides what an import is; each of these reaches the
  // canary through the loader if the check reads the text any other way.
  it.each([
    ['no space after the keyword', () => 'import"../outside.txt";'],
    ['a // path', (o: string) => `import "/${o}";`],
    ['a google/protobuf/ prefix', () => 'import "google/protobuf/../../../outside.txt";'],
    ['adjacent strings', () => 'import "ok.proto" "/../../outside.txt";'],
    ['a weak import', () => 'import weak "../outside.txt";'],
    ['a public import', () => 'import public "../outside.txt";'],
    ['single quotes', () => "import '../outside.txt';"],
    ['a backslash', () => 'import "..\\\\outside.txt";'],
    ['an absolute path', (o: string) => `import "${o}";`],
    ['a system file', () => 'import "/etc/passwd";'],
    ['a device', () => 'import "/dev/zero";'],
    ['a scheme', () => 'import "file:../outside.txt";'],
  ])('%s to something that is not a proto is refused', (_name, line) => {
    const { main, outside } = protoFolder('')
    writeFileSync(main, `syntax = "proto3";\n${line(outside)}\n${SERVICE}`)
    expect(() => assertProtoImportsSafe(main)).toThrow(NOT_A_PROTO)
  })

  it('a link named .proto pointing at something else is refused', () => {
    const { folder, main, outside } = protoFolder('import "sub/leak.proto";')
    mkdirSync(join(folder, 'sub'))
    symlinkSync(outside, join(folder, 'sub', 'leak.proto'))
    expect(() => assertProtoImportsSafe(main)).toThrow(NOT_A_PROTO)
  })

  it('a picked link: imports resolve next to the link, where the loader looks', () => {
    const { folder, outside } = protoFolder('')
    const real = join(folder, 'real.proto')
    writeFileSync(real, `syntax = "proto3";\nimport "x.proto";\n${SERVICE}`)
    const pickedFolder = join(dir, `picked-${Math.random().toString(36).slice(2)}`)
    mkdirSync(pickedFolder)
    const picked = join(pickedFolder, 'picked.proto')
    symlinkSync(real, picked)
    symlinkSync(outside, join(pickedFolder, 'x.proto'))
    expect(() => assertProtoImportsSafe(picked)).toThrow(NOT_A_PROTO)
  })

  it('a folder named .proto is refused', () => {
    const { folder, main } = protoFolder('import "dir.proto";')
    mkdirSync(join(folder, 'dir.proto'))
    expect(() => assertProtoImportsSafe(main)).toThrow(/not a regular file/)
  })

  it.skipIf(process.platform === 'win32')('a link named .proto to a device is refused', () => {
    const { folder, main } = protoFolder('import "zero.proto";')
    symlinkSync('/dev/zero', join(folder, 'zero.proto'))
    expect(() => assertProtoImportsSafe(main)).toThrow(/not a regular file/)
  })

  it('an imported proto past the size cap is refused', () => {
    const { folder, main } = protoFolder('import "big.proto";')
    const big = join(folder, 'big.proto')
    writeFileSync(big, '')
    truncateSync(big, 51 * 1024 * 1024)
    expect(() => assertProtoImportsSafe(main)).toThrow(/big\.proto.*(too large|larger)/)
  })

  describe('real project layouts', () => {
    const TYPES = 'syntax = "proto3";\nmessage Shared { string a = 1; }\n'
    const USES_SHARED = 'service S { rpc Do (Shared) returns (Shared); }\n'
    const layout = (): string => {
      const root = join(dir, `root-${Math.random().toString(36).slice(2)}`)
      mkdirSync(join(root, 'common'), { recursive: true })
      mkdirSync(join(root, 'svc'))
      writeFileSync(join(root, 'common.proto'), TYPES)
      writeFileSync(join(root, 'common', 'types.proto'), TYPES)
      return root
    }
    const load = async (path: string, importLine: string): Promise<string[]> => {
      writeFileSync(path, `syntax = "proto3";\n${importLine}\n${USES_SHARED}`)
      return (await loadProto(path)).services.flatMap((s) => s.methods.map((m) => m.requestType))
    }

    it('a file above the picked one: ../common.proto', async () => {
      const root = layout()
      const main = join(root, 'svc', 'main.proto')
      expect(await load(main, 'import "../common.proto";')).toEqual(['Shared'])
    })

    it('Send reaches the server with ../common.proto', async () => {
      const root = layout()
      const main = join(root, 'svc', 'main.proto')
      await load(main, 'import "../common.proto";')
      const res = await executeUnary({ ...CALL, protoPath: main, requestBody: '{}' })
      expect(res.error).toMatch(/UNAVAILABLE|ECONNREFUSED|No connection/)
    })

    it('a sibling tree, as protoc -I lays one out', async () => {
      const root = layout()
      expect(
        await load(join(root, 'svc', 'sibling.proto'), 'import "../common/types.proto";'),
      ).toEqual(['Shared'])
      expect(await load(join(root, 'top.proto'), 'import "common/types.proto";')).toEqual([
        'Shared',
      ])
    })

    it('an absolute path to a proto', async () => {
      const root = layout()
      const main = join(root, 'svc', 'main.proto')
      expect(await load(main, `import "${join(root, 'common.proto')}";`)).toEqual(['Shared'])
    })

    it('a link to a proto elsewhere', async () => {
      const root = layout()
      symlinkSync(join(root, 'common.proto'), join(root, 'svc', 'linked.proto'))
      const main = join(root, 'svc', 'main.proto')
      expect(await load(main, 'import "linked.proto";')).toEqual(['Shared'])
    })

    it('an import of an import is checked too', async () => {
      const root = layout()
      writeFileSync(join(root, 'bridge.proto'), 'syntax = "proto3";\nimport "/etc/passwd";\n')
      const main = join(root, 'svc', 'main.proto')
      await expect(load(main, 'import "../bridge.proto";')).rejects.toThrow(NOT_A_PROTO)
    })

    it('keeps working: a sibling, a subfolder, the bundled types, a broken file', async () => {
      const { folder, main } = protoFolder('')
      mkdirSync(join(folder, 'sub'))
      writeFileSync(join(folder, 'sib.proto'), 'syntax = "proto3";\nmessage Sib {}\n')
      writeFileSync(
        join(folder, 'sub', 'deep.proto'),
        'syntax = "proto3";\nimport "../sib.proto";\nmessage Deep {}\n',
      )
      writeFileSync(
        main,
        `syntax = "proto3";\nimport "sib.proto";\nimport "sub/deep.proto";\n` +
          `import "google/protobuf/empty.proto";\n${SERVICE}`,
      )
      expect((await loadProto(main)).services[0].methods[0].name).toBe('Do')

      const broken = join(folder, 'broken.proto')
      writeFileSync(broken, `${CANARY} is not a proto`)
      const message = await failure(loadProto(broken))
      expect(message).toMatch(/Not a valid \.proto file/)
      expect(message).not.toContain(CANARY)
    })
  })

  describe('a FIFO', () => {
    let writer: ChildProcess | null = null
    afterEach(() => {
      writer?.kill('SIGKILL')
      writer = null
    })

    // The writer feeds the FIFO a real proto, so a load that opens it returns (and
    // fails this test) instead of blocking main's thread. The fixed code never opens
    // it; the writer stays blocked in open(2) and is killed above.
    it.skipIf(process.platform === 'win32')('is refused before the loader opens it', async () => {
      const { folder, main } = protoFolder('import "pipe.proto";')
      const pipe = join(folder, 'pipe.proto')
      execFileSync('mkfifo', [pipe])
      const payload = join(dir, 'payload.proto')
      writeFileSync(payload, OUTSIDE)
      writer = spawn('sh', ['-c', 'cat "$0" > "$1"', payload, pipe], { stdio: 'ignore' })

      let outcome: string
      try {
        await loadProto(main)
        outcome = 'loaded: the FIFO was read'
      } catch (e) {
        outcome = (e as Error).message
      }
      expect(outcome).toMatch(/not a regular file/)
    })
  })

  // The server chooses a downloaded file's import lines, and what they load shows in
  // this app's service list: so it reaches no local file.
  describe('a proto downloaded from a URL', () => {
    let server: Server
    let base = ''
    const IMPORTS: Record<string, string> = {
      '/up.proto': 'import "../../outside.proto";',
      '/absolute.proto': '',
      '/bundled.proto': 'import "google/protobuf/empty.proto";',
    }
    beforeAll(async () => {
      server = createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        const line =
          req.url === '/absolute.proto'
            ? `import "${join(paths.userData, 'outside.proto')}";`
            : IMPORTS[req.url ?? '']
        res.end(`syntax = "proto3";\n${line}\n${SERVICE}`)
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })
    afterAll(() => new Promise((r) => server.close(r)))

    it.each(['up', 'absolute'])('cannot read a local proto through its imports: %s', async (n) => {
      writeFileSync(join(paths.userData, 'outside.proto'), OUTSIDE)
      await expect(loadProtoFromUrl(`${base}/${n}.proto`)).rejects.toThrow(/outside its folder/)
    })

    it('a saved copy is held to the same rule', async () => {
      writeFileSync(join(paths.userData, 'outside.proto'), OUTSIDE)
      const cache = join(paths.userData, 'grpc-protos')
      mkdirSync(cache, { recursive: true })
      const saved = join(cache, 'evil.proto')
      writeFileSync(saved, `syntax = "proto3";\nimport "../outside.proto";\n${SERVICE}`)
      await expect(loadProto(saved)).rejects.toThrow(/outside its folder/)
    })

    it('can still import the bundled types', async () => {
      const { services } = await loadProtoFromUrl(`${base}/bundled.proto`)
      expect(services[0].methods[0].name).toBe('Do')
    })
  })
})
