/**
 * Local Git "smart HTTP" server with HTTP Basic auth — the e2e stand-in for
 * GitHub (issue #127). Wraps `git http-backend` (CGI) behind a node http
 * server so a test can:
 *   - point a project's Storage settings at `http://127.0.0.1:<port>/<repo>.git`
 *   - Push / Pull through the real `git:push` / `git:pull` handlers
 *   - assert WHICH credentials the app actually sent (`/__auth-log`)
 *
 * Requires the `git` CLI on PATH (CI runners and dev machines have it).
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

export interface GitServer {
  port: number
  /** Base URL, e.g. http://127.0.0.1:41234 — repos live at `${url}/<name>.git`. */
  url: string
  /** Credentials the server accepts. */
  username: string
  token: string
  /** Directory holding the bare repos. */
  root: string
  close: () => Promise<void>
}

export interface GitAuthAttempt {
  username: string | null
  password: string | null
  path: string
  ok: boolean
  at: number
}

const GIT_EXEC_PATH = (() => {
  try {
    return execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
})()

export async function startGitServer(port: number): Promise<GitServer> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-e2e-git-'))
  const username = 'e2e-user'
  const token = 'e2e-secret-pat-' + Math.random().toString(36).slice(2, 10)
  const attempts: GitAuthAttempt[] = []

  const debug = (...a: unknown[]): void => {
    if (process.env.GIT_SERVER_DEBUG) console.error('[git-server]', ...a)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    debug(req.method, req.url, 'auth?', Boolean(req.headers.authorization))

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', protocol: 'git-http', port }))
      return
    }
    if (url.pathname === '/__auth-log') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(attempts))
      return
    }
    if (url.pathname === '/__auth-log/clear') {
      attempts.length = 0
      res.writeHead(204)
      res.end()
      return
    }
    // Create a bare repo on demand: POST /__create/<name>
    if (url.pathname.startsWith('/__create/') && req.method === 'POST') {
      const name = url.pathname.slice('/__create/'.length).replace(/[^a-zA-Z0-9._-]/g, '')
      const dir = path.join(root, `${name}.git`)
      if (!fs.existsSync(dir)) {
        execFileSync('git', ['init', '--bare', '-q', dir])
        execFileSync('git', ['-C', dir, 'config', 'http.receivepack', 'true'])
      }
      res.writeHead(201, { 'Content-Type': 'application/json' })
      // `dir` lets a spec seed/advance the bare repo out-of-band (a "teammate").
      res.end(JSON.stringify({ repo: `http://127.0.0.1:${port}/${name}.git`, dir }))
      return
    }

    // ── Basic auth gate — mirrors GitHub's behaviour: first request without
    // credentials gets 401 + WWW-Authenticate; wrong credentials get 401 too.
    const auth = req.headers.authorization
    let user: string | null = null
    let pass: string | null = null
    if (auth?.startsWith('Basic ')) {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
      const idx = decoded.indexOf(':')
      user = idx >= 0 ? decoded.slice(0, idx) : decoded
      pass = idx >= 0 ? decoded.slice(idx + 1) : null
    }
    const ok = pass === token
    if (auth)
      attempts.push({ username: user, password: pass, path: url.pathname, ok, at: Date.now() })
    if (!ok) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="testnizer-e2e-git"',
        'Content-Type': 'text/plain',
      })
      res.end(auth ? 'Invalid username or token.' : 'Authentication required')
      return
    }

    if (!GIT_EXEC_PATH) {
      res.writeHead(500)
      res.end('git not available')
      return
    }

    // ── Delegate to git http-backend (CGI).
    const cgi = spawn(path.join(GIT_EXEC_PATH, 'git-http-backend'), [], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname,
        REQUEST_METHOD: req.method ?? 'GET',
        QUERY_STRING: url.search.replace(/^\?/, ''),
        // Only set when present: http-backend aborts on an EMPTY
        // CONTENT_LENGTH ("Invalid CONTENT_LENGTH"), and chunked pushes
        // (> http.postBuffer) carry no Content-Length at all.
        ...(req.headers['content-type'] ? { CONTENT_TYPE: req.headers['content-type'] } : {}),
        ...(req.headers['content-length'] ? { CONTENT_LENGTH: req.headers['content-length'] } : {}),
        ...(req.headers['content-encoding']
          ? { HTTP_CONTENT_ENCODING: req.headers['content-encoding'] as string }
          : {}),
        REMOTE_USER: user ?? '',
        REMOTE_ADDR: '127.0.0.1',
        GATEWAY_INTERFACE: 'CGI/1.1',
        SERVER_PROTOCOL: 'HTTP/1.1',
      },
    })
    // http-backend reads stdin to EOF for POSTs; for GET/HEAD it never reads
    // it, but node keeps the pipe open until the request stream is consumed —
    // so close it explicitly or the CGI blocks and the request hangs.
    if (req.method === 'POST' || req.method === 'PUT') {
      req.pipe(cgi.stdin)
    } else {
      cgi.stdin.end()
      req.resume()
    }

    // Parse the CGI header block, then stream the body.
    let headerBuf = Buffer.alloc(0)
    let headersDone = false
    debug('spawned cgi pid', cgi.pid, 'PATH_INFO', url.pathname)
    cgi.stdout.on('data', (chunk: Buffer) => {
      debug('cgi stdout', chunk.length)
      if (headersDone) {
        res.write(chunk)
        return
      }
      headerBuf = Buffer.concat([headerBuf, chunk])
      const sep = headerBuf.indexOf('\r\n\r\n')
      if (sep === -1) return
      const headerText = headerBuf.subarray(0, sep).toString('utf8')
      const rest = headerBuf.subarray(sep + 4)
      let status = 200
      const outHeaders: Record<string, string> = {}
      for (const line of headerText.split('\r\n')) {
        const i = line.indexOf(':')
        if (i === -1) continue
        const k = line.slice(0, i).trim()
        const v = line.slice(i + 1).trim()
        if (k.toLowerCase() === 'status') status = parseInt(v, 10) || 200
        else outHeaders[k] = v
      }
      res.writeHead(status, outHeaders)
      headersDone = true
      if (rest.length) res.write(rest)
    })
    cgi.stdout.on('end', () => {
      if (!headersDone) res.writeHead(502)
      res.end()
    })
    cgi.stderr.on('data', (d: Buffer) => {
      debug('cgi stderr', d.toString('utf8').trim())
    })
    cgi.on('exit', (code) => debug('cgi exit', code))
    cgi.on('error', (e) => {
      debug('cgi error', e)
      if (!headersDone) res.writeHead(500)
      res.end()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    username,
    token,
    root,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          try {
            fs.rmSync(root, { recursive: true, force: true })
          } catch {
            /* ignore */
          }
          resolve()
        })
      }),
  }
}
