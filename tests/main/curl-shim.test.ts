import { describe, it, expect } from 'vitest'
import {
  buildCurlArgs,
  parseCurlHeaders,
  shouldUseCurlSidecar,
} from '../../src/main/protocols/curl-shim'

describe('curl-shim — shouldUseCurlSidecar', () => {
  it('returns false when no tls config supplied', () => {
    expect(shouldUseCurlSidecar(undefined)).toBe(false)
    expect(shouldUseCurlSidecar({})).toBe(false)
  })

  it('returns true when minVersion is TLSv1 or TLSv1.1', () => {
    expect(shouldUseCurlSidecar({ minVersion: 'TLSv1' })).toBe(true)
    expect(shouldUseCurlSidecar({ minVersion: 'TLSv1.1' })).toBe(true)
  })

  it('returns true when maxVersion is TLSv1 or TLSv1.1', () => {
    expect(shouldUseCurlSidecar({ maxVersion: 'TLSv1' })).toBe(true)
    expect(shouldUseCurlSidecar({ maxVersion: 'TLSv1.1' })).toBe(true)
  })

  it('returns false for modern TLS versions', () => {
    expect(shouldUseCurlSidecar({ minVersion: 'TLSv1.2' })).toBe(false)
    expect(shouldUseCurlSidecar({ minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' })).toBe(false)
  })
})

describe('curl-shim — buildCurlArgs', () => {
  const base = {
    url: 'https://legacy.example.com/api',
    method: 'GET',
    headers: {},
    bodyMode: 'none' as const,
    tls: {},
    sslVerification: true,
    followRedirects: true,
    timeoutMs: 30000,
    proxyDisabled: false,
    headersDumpPath: '/tmp/h.txt',
    bodyOutputPath: '/tmp/b.bin',
  }

  it('places URL last and emits -X METHOD up front', () => {
    const args = buildCurlArgs({ ...base, method: 'POST' })
    expect(args[args.length - 1]).toBe('https://legacy.example.com/api')
    expect(args.slice(0, 4)).toEqual(['-sS', '-X', 'POST', '-D'])
  })

  it('uppercases the method', () => {
    const args = buildCurlArgs({ ...base, method: 'patch' })
    expect(args).toContain('PATCH')
  })

  it('dumps response headers via -D and body via -o', () => {
    const args = buildCurlArgs(base)
    const dIdx = args.indexOf('-D')
    const oIdx = args.indexOf('-o')
    expect(args[dIdx + 1]).toBe('/tmp/h.txt')
    expect(args[oIdx + 1]).toBe('/tmp/b.bin')
  })

  it('converts TLSv1 minVersion to --tlsv1.0 and TLSv1.1 to --tlsv1.1', () => {
    const a1 = buildCurlArgs({ ...base, tls: { minVersion: 'TLSv1' } })
    expect(a1).toContain('--tlsv1.0')
    const a2 = buildCurlArgs({ ...base, tls: { minVersion: 'TLSv1.1' } })
    expect(a2).toContain('--tlsv1.1')
  })

  it('emits --tls-max with the bare protocol number for maxVersion', () => {
    const args = buildCurlArgs({ ...base, tls: { maxVersion: 'TLSv1.1' } })
    const idx = args.indexOf('--tls-max')
    expect(args[idx + 1]).toBe('1.1')
  })

  it('passes through OpenSSL cipher string via --ciphers', () => {
    const args = buildCurlArgs({
      ...base,
      tls: { ciphers: 'AES128-SHA:DES-CBC3-SHA' },
    })
    const idx = args.indexOf('--ciphers')
    expect(args[idx + 1]).toBe('AES128-SHA:DES-CBC3-SHA')
  })

  it('adds -k when SSL verification is disabled', () => {
    expect(buildCurlArgs({ ...base, sslVerification: false })).toContain('-k')
    expect(buildCurlArgs({ ...base, sslVerification: true })).not.toContain('-k')
  })

  it('adds -L with redirect cap when followRedirects is true', () => {
    expect(buildCurlArgs({ ...base, followRedirects: true })).toContain('-L')
    expect(buildCurlArgs({ ...base, followRedirects: false })).not.toContain('-L')
  })

  it('rounds the timeout to whole seconds with a 1-second floor', () => {
    const a1 = buildCurlArgs({ ...base, timeoutMs: 30000 })
    expect(a1[a1.indexOf('--max-time') + 1]).toBe('30')
    const a2 = buildCurlArgs({ ...base, timeoutMs: 500 })
    expect(a2[a2.indexOf('--max-time') + 1]).toBe('1')
  })

  it('emits -x and --proxy-user when a custom proxy is configured', () => {
    const args = buildCurlArgs({
      ...base,
      proxy: { host: '10.0.0.1', port: 8888, auth: { username: 'u', password: 'p' } },
    })
    expect(args[args.indexOf('-x') + 1]).toBe('10.0.0.1:8888')
    expect(args[args.indexOf('--proxy-user') + 1]).toBe('u:p')
  })

  it('emits --noproxy when proxy is explicitly disabled', () => {
    const args = buildCurlArgs({ ...base, proxyDisabled: true })
    expect(args).toContain('--noproxy')
    expect(args).toContain('*')
  })

  it('passes -H for each header except Content-Length when piping a body', () => {
    const args = buildCurlArgs({
      ...base,
      headers: { 'X-Trace': 'abc', 'Content-Length': '999' },
      bodyMode: 'stdin',
    })
    expect(args).toContain('-H')
    expect(args).toContain('X-Trace: abc')
    expect(args).not.toContain('Content-Length: 999')
  })

  it('passes cookies via -b', () => {
    const args = buildCurlArgs({ ...base, cookieHeader: 'sid=xyz; token=abc' })
    expect(args[args.indexOf('-b') + 1]).toBe('sid=xyz; token=abc')
  })

  it('uses --data-binary @- for raw body mode', () => {
    const args = buildCurlArgs({ ...base, bodyMode: 'stdin' })
    expect(args[args.indexOf('--data-binary') + 1]).toBe('@-')
  })

  it('emits --data-urlencode for each urlencoded field', () => {
    const args = buildCurlArgs({
      ...base,
      bodyMode: 'urlencoded',
      urlencodedFields: [
        { name: 'a', value: '1' },
        { name: 'b', value: 'two words' },
      ],
    })
    expect(args.filter((a) => a === '--data-urlencode').length).toBe(2)
    expect(args).toContain('a=1')
    expect(args).toContain('b=two words')
  })

  it('emits -F text= for form-data text fields and -F name=@path for file fields', () => {
    const args = buildCurlArgs({
      ...base,
      bodyMode: 'formdata',
      formdataFields: [
        { type: 'text', name: 'note', value: 'hello' },
        { type: 'file', name: 'upload', filePath: '/tmp/data.bin' },
      ],
    })
    expect(args.filter((a) => a === '-F').length).toBe(2)
    expect(args).toContain('note=hello')
    expect(args).toContain('upload=@/tmp/data.bin')
  })

  it('translates basicAuth to -u + --basic', () => {
    const args = buildCurlArgs({ ...base, basicAuth: { username: 'u', password: 'p' } })
    expect(args).toContain('--basic')
    expect(args[args.indexOf('-u') + 1]).toBe('u:p')
  })

  it('translates digestAuth to -u + --digest', () => {
    const args = buildCurlArgs({ ...base, digestAuth: { username: 'u', password: 'p' } })
    expect(args).toContain('--digest')
  })

  it('translates ntlmAuth with optional domain prefix', () => {
    const args = buildCurlArgs({
      ...base,
      ntlmAuth: { username: 'svc', password: 'pw', domain: 'CORP' },
    })
    expect(args).toContain('--ntlm')
    expect(args[args.indexOf('-u') + 1]).toBe('CORP\\svc:pw')
  })

  it('passes CA bundle path via --cacert', () => {
    const args = buildCurlArgs({ ...base, caCertPath: '/tmp/ca.pem' })
    expect(args[args.indexOf('--cacert') + 1]).toBe('/tmp/ca.pem')
  })

  it('emits --cert-type P12 and joins passphrase with colon for PFX client certs', () => {
    const args = buildCurlArgs({
      ...base,
      clientCertPath: '/tmp/client.p12',
      clientCertType: 'P12',
      clientCertPassphrase: 'sekret',
    })
    expect(args).toContain('--cert-type')
    expect(args[args.indexOf('--cert-type') + 1]).toBe('P12')
    expect(args[args.indexOf('--cert') + 1]).toBe('/tmp/client.p12:sekret')
  })

  it('emits --cert / --key separately for PEM client certs', () => {
    const args = buildCurlArgs({
      ...base,
      clientCertPath: '/tmp/client.pem',
      clientCertType: 'PEM',
      clientKeyPath: '/tmp/client.key',
    })
    expect(args[args.indexOf('--cert') + 1]).toBe('/tmp/client.pem')
    expect(args[args.indexOf('--key') + 1]).toBe('/tmp/client.key')
  })
})

describe('curl-shim — parseCurlHeaders', () => {
  it('parses a single-leg HTTP response', () => {
    const raw =
      'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Trace: abc\r\nSet-Cookie: sid=xyz; Path=/\r\n'
    const p = parseCurlHeaders(raw)
    expect(p.status).toBe(200)
    expect(p.statusText).toBe('OK')
    expect(p.headers['Content-Type']).toBe('application/json')
    expect(p.headers['X-Trace']).toBe('abc')
    expect(p.setCookieHeaders).toEqual(['sid=xyz; Path=/'])
  })

  it('returns the FINAL leg when curl followed redirects', () => {
    const raw =
      'HTTP/1.1 301 Moved Permanently\r\nLocation: https://final.example.com/\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: text/html\r\n'
    const p = parseCurlHeaders(raw)
    expect(p.status).toBe(200)
    expect(p.statusText).toBe('OK')
    expect(p.headers['Content-Type']).toBe('text/html')
    // Location from the redirect leg must NOT leak into the final headers.
    expect(p.headers['Location']).toBeUndefined()
  })

  it('handles a 204 No Content with no body and only basic headers', () => {
    const raw = 'HTTP/1.1 204 No Content\r\nDate: Mon, 18 May 2026 21:00:00 GMT\r\n'
    const p = parseCurlHeaders(raw)
    expect(p.status).toBe(204)
    expect(p.statusText).toBe('No Content')
    expect(p.headers['Date']).toContain('2026')
  })

  it('returns status 0 and empty status text when no status line is present', () => {
    const p = parseCurlHeaders('')
    expect(p.status).toBe(0)
    expect(p.statusText).toBe('')
    expect(p.headers).toEqual({})
  })

  it('keeps the last value for duplicate header names (axios-parity)', () => {
    const raw = 'HTTP/1.1 200 OK\r\nX-Multi: first\r\nX-Multi: second\r\n'
    const p = parseCurlHeaders(raw)
    expect(p.headers['X-Multi']).toBe('second')
  })

  it('accumulates EVERY Set-Cookie header (cookie jar semantics)', () => {
    const raw =
      'HTTP/1.1 200 OK\r\nSet-Cookie: a=1; Path=/\r\nSet-Cookie: b=2; HttpOnly\r\nSet-Cookie: c=3; Secure\r\n'
    const p = parseCurlHeaders(raw)
    expect(p.setCookieHeaders).toEqual(['a=1; Path=/', 'b=2; HttpOnly', 'c=3; Secure'])
  })
})
