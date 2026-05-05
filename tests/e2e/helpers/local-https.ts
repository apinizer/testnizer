import * as https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { type AddressInfo } from 'node:net'

const CERTS_DIR = path.resolve(__dirname, '../../fixtures/certs')

/**
 * Spin up a small HTTPS server backed by our test CA-issued cert.
 * Used by:
 *   - mTLS spec (requestCert + rejectUnauthorized)
 *   - custom truststore spec (server uses self-signed cert)
 * Listens on a random port; call .close() when done.
 */
export interface LocalHttpsServer {
  url: string
  port: number
  close: () => Promise<void>
}

export interface LocalHttpsOptions {
  /** Require client cert and verify against our test CA. */
  mtls?: boolean
  /** Use self-signed (no CA chain) instead of CA-issued cert. */
  selfSigned?: boolean
  /** Custom request handler. Default: echo path + method as JSON. */
  handler?: (req: IncomingMessage, res: ServerResponse) => void
}

export async function startLocalHttps(opts: LocalHttpsOptions = {}): Promise<LocalHttpsServer> {
  const certFile = opts.selfSigned ? 'selfsigned.crt' : 'server.crt'
  const keyFile = opts.selfSigned ? 'selfsigned.key' : 'server.key'

  const httpsOpts: https.ServerOptions = {
    cert: fs.readFileSync(path.join(CERTS_DIR, certFile)),
    key: fs.readFileSync(path.join(CERTS_DIR, keyFile)),
  }

  if (opts.mtls) {
    httpsOpts.ca = fs.readFileSync(path.join(CERTS_DIR, 'ca.crt'))
    httpsOpts.requestCert = true
    httpsOpts.rejectUnauthorized = true
  }

  const handler =
    opts.handler ??
    ((req, res) => {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString('utf8')))
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: body || undefined,
          }),
        )
      })
    })

  const server = https.createServer(httpsOpts, handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as AddressInfo
  const port = addr.port
  return {
    url: `https://localhost:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

/** Read a certificate fixture as a UTF-8 PEM string. */
export function readPem(filename: string): string {
  return fs.readFileSync(path.join(CERTS_DIR, filename), 'utf8')
}

/** Read a binary fixture (e.g. .p12) as base64. */
export function readBase64(filename: string): string {
  return fs.readFileSync(path.join(CERTS_DIR, filename)).toString('base64')
}
