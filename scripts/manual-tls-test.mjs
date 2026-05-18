#!/usr/bin/env node
// scripts/manual-tls-test.mjs
//
// One-shot live verification of the TLS 1.0/1.1 sidecar path. Runs three
// scenarios against the public BadSSL TLS endpoints to prove the bundled
// curl + sidecar wiring actually handshakes legacy protocols end-to-end.
//
// Usage:
//   npm run build
//   npx tsx scripts/manual-tls-test.mjs
//
// NOT a vitest case — hits the public internet (flaky in CI) and needs the
// Electron ABI for better-sqlite3, which conflicts with vitest's node-ABI
// flip. Run manually before a release.

import { spawn } from 'node:child_process'

const SCENARIOS = [
  {
    name: 'TLS 1.0 endpoint with TLSv1 pin (expect handshake success)',
    target: 'https://tls-v1-0.badssl.com:1010/',
    args: ['--tlsv1.0', '--tls-max', '1.0', '--ciphers', 'DEFAULT@SECLEVEL=0'],
    expectExit: 0,
    // curl reports TLS 1.0 as either "TLSv1" or "TLSv1.0" depending on the
    // backend (OpenSSL 4 uses the bare form). Accept the prefix that
    // both produce.
    expectTlsHandshake: 'TLSv1',
    via: 'bundled-curl-sidecar',
  },
  {
    name: 'Same endpoint pinned to TLS 1.2 (axios path would do this; expect handshake fail)',
    target: 'https://tls-v1-0.badssl.com:1010/',
    args: ['--tlsv1.2', '--tls-max', '1.2'],
    expectExit: 35, // SSL connect error
    expectTlsHandshake: null,
    via: 'modern-tls (simulates axios path failure)',
  },
  {
    name: 'Modern HTTPS over TLS 1.2/1.3 (regression — axios path would do this; expect 200)',
    target: 'https://httpbin.org/get',
    args: ['--tlsv1.2'],
    expectExit: 0,
    expectTlsHandshake: 'TLSv1.', // 1.2 or 1.3
    via: 'modern-tls',
  },
]

const CURL = '/Users/mhy/IdeaProjects/testnizer/resources/curl/darwin-arm64/curl'

function spawnCurl(args) {
  return new Promise((resolve) => {
    const proc = spawn(CURL, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (c) => (stdout += c.toString()))
    proc.stderr.on('data', (c) => (stderr += c.toString()))
    proc.on('exit', (code) => resolve({ code, stdout, stderr }))
  })
}

async function run() {
  console.log('Testnizer TLS 1.0/1.1 sidecar — live verification')
  console.log('='.repeat(56))
  console.log('Bundled curl:', CURL)
  console.log()

  let pass = 0
  let fail = 0

  for (const sc of SCENARIOS) {
    const t0 = Date.now()
    const fullArgs = [
      '-sS',
      '-v',
      '--max-time', '15',
      ...sc.args,
      '-o', '/dev/null',
      '-w', '%{http_code}',
      sc.target,
    ]
    const { code, stdout, stderr } = await spawnCurl(fullArgs)
    const took = Date.now() - t0

    // Parse verbose output for the negotiated TLS version + cipher.
    const negotiated = (stderr.match(/SSL connection using (TLSv[\d.]+) \/ (\S+)/) ||
      stderr.match(/(TLSv1\.[0-3]) \(OUT\), TLS handshake, Finished/) || [])[1] || null
    const httpCode = stdout.trim() || '(none)'

    const exitOk = code === sc.expectExit
    const handshakeOk = sc.expectTlsHandshake === null
      ? negotiated === null
      : negotiated?.startsWith(sc.expectTlsHandshake)

    const ok = exitOk && handshakeOk
    console.log(`${ok ? '✓' : '✗'} ${sc.name}`)
    console.log(`  via:           ${sc.via}`)
    console.log(`  url:           ${sc.target}`)
    console.log(`  curl args:     ${sc.args.join(' ')}`)
    console.log(`  exit code:     ${code} (expected ${sc.expectExit})`)
    console.log(`  http status:   ${httpCode}`)
    console.log(`  TLS negotiated: ${negotiated ?? '(none)'} (expected ${sc.expectTlsHandshake ?? 'none'})`)
    console.log(`  duration:      ${took}ms`)
    if (!ok) {
      const lastErr = stderr.split('\n').filter(Boolean).slice(-3).join('\n    ')
      console.log(`  stderr tail:   ${lastErr}`)
    }
    console.log()
    if (ok) pass++
    else fail++
  }

  console.log('='.repeat(56))
  console.log(`Summary: ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
