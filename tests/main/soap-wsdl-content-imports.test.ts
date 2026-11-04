/**
 * A WSDL given as text (pasted, or a file the user picked) must not make the app
 * read local files or call out.
 *
 * `parseWsdlFromContent` writes the text to a temp file and hands it to node-soap,
 * which follows `wsdl:import` / `xsd:import` / `xsd:include`: local paths through
 * `fs.readFile`, http(s) through its client. So a shared file could point at
 * `/Users/x/.aws/config` or `http://169.254.169.254/...`. These tests use a canary
 * file and a local server that must not be touched.
 *
 * A WSDL the user loaded from a URL keeps its relative imports: that is how such
 * services publish their schemas.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import fs, { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => tmpdir() },
}))

const { parseWsdl, parseWsdlFromContent, wsdlContentImportLocation } =
  await import('../../src/main/protocols/soap.engine')

const XSD = `<?xml version="1.0"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:t" elementFormDefault="qualified">
  <xsd:element name="Ping" type="xsd:string"/>
  <xsd:element name="Pong" type="xsd:string"/>
</xsd:schema>`

/** A complete one-operation WSDL with `imports` placed in its schema block. */
const wsdl = (imports: string): string => `<?xml version="1.0"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:tns="urn:t" targetNamespace="urn:t">
  <wsdl:types>
    <xsd:schema targetNamespace="urn:t" elementFormDefault="qualified">
      ${imports || '<xsd:element name="Ping" type="xsd:string"/><xsd:element name="Pong" type="xsd:string"/>'}
    </xsd:schema>
  </wsdl:types>
  <wsdl:message name="In"><wsdl:part name="p" element="tns:Ping"/></wsdl:message>
  <wsdl:message name="Out"><wsdl:part name="p" element="tns:Pong"/></wsdl:message>
  <wsdl:portType name="PT">
    <wsdl:operation name="Echo"><wsdl:input message="tns:In"/><wsdl:output message="tns:Out"/></wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="B" type="tns:PT">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="Echo">
      <soap:operation soapAction="urn:t:Echo"/>
      <wsdl:input><soap:body use="literal"/></wsdl:input>
      <wsdl:output><soap:body use="literal"/></wsdl:output>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="S">
    <wsdl:port name="P" binding="tns:B"><soap:address location="http://svc.test/echo"/></wsdl:port>
  </wsdl:service>
</wsdl:definitions>`

let server: Server
let base = ''
let hits: string[] = []
let dir = ''
let canary = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '/')
    res.writeHead(200, { 'Content-Type': 'text/xml' })
    res.end(
      req.url?.endsWith('.wsdl')
        ? wsdl('<xsd:import namespace="urn:t" schemaLocation="types.xsd"/>')
        : XSD,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  dir = mkdtempSync(join(tmpdir(), 'testnizer-wsdl-canary-'))
  canary = join(dir, 'canary.xsd')
  // Valid XSD on purpose: reading it would succeed, so a pass cannot be a parse failure.
  writeFileSync(canary, XSD)
})
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true })
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

let readFile: ReturnType<typeof vi.spyOn>
const canaryRead = (): boolean =>
  readFile.mock.calls.some((call: unknown[]) => String(call[0]).includes('canary.xsd'))

beforeEach(() => {
  hits = []
  readFile = vi.spyOn(fs, 'readFile')
})
afterEach(() => {
  readFile.mockRestore()
})

describe('a WSDL given as text', () => {
  it('xsd:import of an absolute local path: refused and not read', async () => {
    const text = wsdl(`<xsd:import namespace="urn:t" schemaLocation="${canary}"/>`)
    await expect(parseWsdlFromContent(text)).rejects.toThrow(/imports? .*canary\.xsd/i)
    expect(canaryRead()).toBe(false)
  })

  it('xsd:include of a path relative to where the temp file lands: refused and not read', async () => {
    const text = wsdl(`<xsd:include schemaLocation="${basename(dir)}/canary.xsd"/>`)
    await expect(parseWsdlFromContent(text)).rejects.toThrow(/imports? /i)
    expect(canaryRead()).toBe(false)
  })

  it('xsd:import over http: refused and the server is never called', async () => {
    const text = wsdl(`<xsd:import namespace="urn:t" schemaLocation="${base}/meta/latest.xsd"/>`)
    await expect(parseWsdlFromContent(text)).rejects.toThrow(/imports? /i)
    expect(hits).toEqual([])
  })

  it('wsdl:import: refused and the server is never called', async () => {
    const text = wsdl('').replace(
      '<wsdl:types>',
      `<wsdl:import namespace="urn:x" location="${base}/other.wsdl"/><wsdl:types>`,
    )
    await expect(parseWsdlFromContent(text)).rejects.toThrow(/imports? /i)
    expect(hits).toEqual([])
  })

  it('the refusal says what to do', async () => {
    const text = wsdl(`<xsd:import namespace="urn:t" schemaLocation="${base}/x.xsd"/>`)
    await expect(parseWsdlFromContent(text)).rejects.toThrow(/from its URL/i)
  })

  it('an import with no location points nowhere, and still parses', async () => {
    const text = wsdl(
      '<xsd:import namespace="urn:other"/><xsd:element name="Ping" type="xsd:string"/><xsd:element name="Pong" type="xsd:string"/>',
    )
    const parsed = await parseWsdlFromContent(text)
    expect(parsed.services[0].ports[0].operations.map((o) => o.name)).toEqual(['Echo'])
  })

  it('self-contained text still parses', async () => {
    const parsed = await parseWsdlFromContent(wsdl(''))
    expect(parsed.services[0].ports[0].operations.map((o) => o.name)).toEqual(['Echo'])
    expect(hits).toEqual([])
  })

  for (const [name, text] of [
    ['empty', ''],
    ['wrong format', '{"not":"xml"}'],
    ['broken XML', '<?xml version="1.0"?><wsdl:definitions'],
  ] as const) {
    it(`${name}: an error, not a crash`, async () => {
      await expect(parseWsdlFromContent(text)).rejects.toThrow()
    })
  }
})

describe('the canary can see a read', () => {
  it('positive control: node-soap reads an imported file through the spied `fs.readFile`', async () => {
    const local = join(dir, 'local.wsdl')
    writeFileSync(local, wsdl(`<xsd:import namespace="urn:t" schemaLocation="${canary}"/>`))
    await parseWsdl(local)
    expect(canaryRead()).toBe(true)
  })
})

describe('a WSDL the user loaded from a URL', () => {
  it('keeps its relative imports', async () => {
    const parsed = await parseWsdl(`${base}/svc.wsdl`)
    expect(hits).toEqual(['/svc.wsdl', '/types.xsd'])
    expect(parsed.services[0].ports[0].operations.map((o) => o.name)).toEqual(['Echo'])
  })
})

describe('standard schemas a real WSDL needs', () => {
  const allow = (url: string): string => wsdlContentImportLocation(url, '/tmp/x.wsdl', url)

  it.each([
    'http://schemas.xmlsoap.org/soap/encoding/',
    'https://schemas.xmlsoap.org/wsdl/',
    'http://www.w3.org/2001/xml.xsd',
  ])('may load %s', (url) => {
    expect(allow(url)).toBe(url)
  })

  it.each([
    'http://schemas.xmlsoap.org.evil.test/x.xsd',
    'http://schemas.xmlsoap.org@evil.test/x.xsd',
    'http://evil.test/schemas.xmlsoap.org/',
    'file://schemas.xmlsoap.org/etc/passwd',
    '/Users/x/.aws/config',
    'types.xsd',
    'http://169.254.169.254/latest/',
  ])('refuses %s', (url) => {
    expect(() => allow(url)).toThrow(/cannot load imports/)
  })

  it('an xsd:import that only names a namespace still parses', async () => {
    const result = await parseWsdlFromContent(
      wsdl(
        '<xsd:import namespace="http://schemas.xmlsoap.org/soap/encoding/"/><xsd:element name="Ping" type="xsd:string"/><xsd:element name="Pong" type="xsd:string"/>',
      ),
    )
    expect(JSON.stringify(result)).toContain('Echo')
  })
})
