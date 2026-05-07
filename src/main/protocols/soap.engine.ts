import * as soap from 'soap'
import { XMLParser, XMLBuilder } from 'fast-xml-parser'
import axios from 'axios'
import { randomUUID } from 'crypto'
import { performance } from 'perf_hooks'
import https from 'https'
import http from 'http'
import {
  applyWsSecurity,
  migrateLegacyConfig,
  type WsSecurityConfig as WsseConfig,
} from './wsse.engine'
import { applyDefaultUserAgent } from '../lib/user-agent'
import { classifyTransportError } from '../lib/error-classifier'
import { normaliseTlsVersion, type TlsOptions } from '../lib/tls-presets'

// ─── Types ───────────────────────────────────────────────────

export type SoapVersion = 'soap11' | 'soap12'

export interface WsdlParseResult {
  services: WsdlService[]
  endpointUrl: string
  soapVersion: SoapVersion
  rawWsdl: string
}

export interface WsdlService {
  name: string
  ports: WsdlPort[]
}

export interface WsdlPort {
  name: string
  endpointUrl: string
  operations: WsdlOperation[]
}

export interface WsdlOperation {
  name: string
  soapAction: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  exampleRequest: string
  exampleResponse: string
}

export interface SoapSchema {
  url: string
  body: string
}

/**
 * SOAP request WS-Security configuration. Accepts both the legacy single-mode
 * shape (kept for persisted projects) and the new multi-mode shape from
 * `wsse.engine`. The engine auto-migrates the legacy form via
 * `migrateLegacyConfig`.
 */
export type WsSecurityConfig =
  | {
      enabled: boolean
      type: 'username-token' | 'timestamp'
      username?: string
      password?: string
      passwordType?: 'PasswordText' | 'PasswordDigest'
      addTimestamp?: boolean
    }
  | WsseConfig

export interface SoapExecuteOptions {
  wsdlUrl: string
  endpointUrl: string
  operationName: string
  serviceName?: string
  portName?: string
  soapVersion: SoapVersion
  params: Record<string, unknown>
  headers?: Record<string, string>
  wsSecurity?: WsSecurityConfig
  timeout?: number
  sslVerification?: boolean
  /**
   * TLS protocol / cipher override (same shape as `HttpRequestOptions.tls`).
   * Lets SOAP requests reach legacy WS-* endpoints that still mandate TLS 1.0
   * / 1.1 or non-default cipher suites.
   */
  tls?: TlsOptions
}

export interface SoapApiResponse {
  requestId: string
  protocol: 'soap'
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  bodySize?: number
  timing: {
    total: number
    dns?: number
    tcp?: number
    tls?: number
    ttfb?: number
    download?: number
  }
  error?: string
  actualRequest?: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
  }
}

// ─── XML Parser config ──────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  parseAttributeValue: false,
  trimValues: true,
})

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
})

// ─── Schema resolution (ported from Java reference) ─────────

function normalizeLocation(location: string): string {
  return location.toLowerCase().replace(/\\/g, '/')
}

function resolveSchemaUrl(schemaLocation: string, parentUrl: string): string {
  if (/^https?:\/\//i.test(schemaLocation) || /^file:\/\//i.test(schemaLocation)) {
    return schemaLocation
  }
  try {
    return new URL(schemaLocation, parentUrl).toString()
  } catch {
    return schemaLocation
  }
}

async function fetchContent(url: string, sslVerification = true): Promise<string> {
  if (/^file:\/\//i.test(url)) {
    const { readFileSync } = await import('fs')
    const filePath = url.replace(/^file:\/\//, '')
    return readFileSync(filePath, 'utf-8')
  }
  const response = await axios.get<string>(url, {
    responseType: 'text',
    timeout: 15000,
    // Keep HTTPS certificate validation enabled by default; callers may
    // opt out explicitly when importing WSDL from trusted-but-self-signed
    // internal endpoints.
    httpsAgent: new https.Agent({ rejectUnauthorized: sslVerification }),
  })
  return response.data
}

/**
 * Recursively find all XSD schemas imported within a WSDL/XSD document.
 */
export async function findAllSchemasRecursively(
  schemaBody: string,
  parentUrl: string,
  resolvedLocations: Set<string> = new Set(),
  schemas: SoapSchema[] = [],
): Promise<SoapSchema[]> {
  // Parse the XML to find xsd:import elements with schemaLocation
  const parsed = xmlParser.parse(schemaBody) as Record<string, unknown>
  const importLocations = extractImportSchemaLocations(parsed)

  for (const oldXsdUrl of importLocations) {
    const resolvedUrl = resolveSchemaUrl(oldXsdUrl, parentUrl)
    const normalized = normalizeLocation(resolvedUrl)

    // Duplicate prevention
    if (resolvedLocations.has(normalized)) {
      continue
    }
    resolvedLocations.add(normalized)

    try {
      const xsdContent = await fetchContent(resolvedUrl)
      schemas.push({ url: resolvedUrl, body: xsdContent })

      // Recurse into imported schema
      await findAllSchemasRecursively(xsdContent, resolvedUrl, resolvedLocations, schemas)
    } catch {
      // Schema fetch failed — skip this import
    }
  }

  return schemas
}

/**
 * Extract schemaLocation attributes from xsd:import and xsd:include elements
 */
function extractImportSchemaLocations(obj: unknown, locations: string[] = []): string[] {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return locations
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractImportSchemaLocations(item, locations)
    }
    return locations
  }

  const record = obj as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const lowerKey = key.toLowerCase()
    // Match xsd:import, xs:import, import, xsd:include, xs:include, include
    if (
      lowerKey.endsWith(':import') ||
      lowerKey === 'import' ||
      lowerKey.endsWith(':include') ||
      lowerKey === 'include'
    ) {
      const val = record[key]
      if (val && typeof val === 'object') {
        const items = Array.isArray(val) ? val : [val]
        for (const item of items) {
          const itemRecord = item as Record<string, unknown>
          const schemaLoc =
            itemRecord['@_schemaLocation'] ?? itemRecord['@_schemalocation'] ?? undefined
          if (typeof schemaLoc === 'string' && schemaLoc.length > 0) {
            locations.push(schemaLoc)
          }
        }
      }
    } else {
      extractImportSchemaLocations(record[key], locations)
    }
  }

  return locations
}

// ─── SOAP version detection ─────────────────────────────────

function detectSoapVersion(wsdlXml: string): SoapVersion {
  if (wsdlXml.includes('http://schemas.xmlsoap.org/wsdl/soap12/')) {
    return 'soap12'
  }
  // Default to SOAP 1.1
  return 'soap11'
}

// ─── WSDL XML structure parser ──────────────────────────────
// `soap` library's `client.describe()` collapses operations across bindings
// that share a portType (e.g. SOAP 1.1 + SOAP 1.2 binding for the same
// portType — dneonline Calculator). We re-derive the per-port operation
// list directly from the WSDL XML so we never lose operations.

interface WsdlXmlStructure {
  /** binding name (no NS prefix) → portType name (no NS prefix) */
  bindingToPortType: Map<string, string>
  /** portType name (no NS prefix) → operation names */
  portTypeToOps: Map<string, string[]>
  /** service name (no NS prefix) → ports */
  services: Map<string, Array<{ name: string; bindingName: string; address?: string }>>
  /** binding name + opName → soapAction */
  bindingOpSoapAction: Map<string, string>
}

function stripNsPrefix(qname: string | undefined): string {
  if (!qname) return ''
  const idx = qname.indexOf(':')
  return idx === -1 ? qname : qname.slice(idx + 1)
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

/**
 * Walk parsed WSDL XML (fast-xml-parser output, namespace prefixes preserved)
 * and collect portType/binding/service structures.
 */
function parseWsdlXmlStructure(wsdlXml: string): WsdlXmlStructure {
  const result: WsdlXmlStructure = {
    bindingToPortType: new Map(),
    portTypeToOps: new Map(),
    services: new Map(),
    bindingOpSoapAction: new Map(),
  }

  let parsed: Record<string, unknown>
  try {
    parsed = xmlParser.parse(wsdlXml) as Record<string, unknown>
  } catch {
    return result
  }

  // Find <wsdl:definitions> or <definitions> root
  const definitions = findElementByLocalName(parsed, 'definitions') as
    | Record<string, unknown>
    | undefined
  if (!definitions) return result

  // portTypes — operation names live here
  for (const portType of getChildrenByLocalName(definitions, 'portType')) {
    const ptName = (portType['@_name'] as string | undefined) ?? ''
    if (!ptName) continue
    const ops: string[] = []
    for (const op of getChildrenByLocalName(portType, 'operation')) {
      const opName = (op['@_name'] as string | undefined) ?? ''
      if (opName) ops.push(opName)
    }
    if (ops.length > 0) result.portTypeToOps.set(ptName, ops)
  }

  // bindings — link binding name → portType, and capture soapAction per op
  for (const binding of getChildrenByLocalName(definitions, 'binding')) {
    const bName = (binding['@_name'] as string | undefined) ?? ''
    const bType = stripNsPrefix(binding['@_type'] as string | undefined)
    if (!bName || !bType) continue
    result.bindingToPortType.set(bName, bType)

    for (const op of getChildrenByLocalName(binding, 'operation')) {
      const opName = (op['@_name'] as string | undefined) ?? ''
      if (!opName) continue
      // soap:operation soapAction lives as a sibling element
      const soapOp = findChildByLocalName(op, 'operation', /\bsoap\b/i)
      if (soapOp) {
        const action = soapOp['@_soapAction'] as string | undefined
        if (typeof action === 'string') {
          result.bindingOpSoapAction.set(`${bName}::${opName}`, action)
        }
      }
    }
  }

  // services — port → binding + endpoint address
  for (const service of getChildrenByLocalName(definitions, 'service')) {
    const sName = (service['@_name'] as string | undefined) ?? ''
    if (!sName) continue
    const ports: Array<{ name: string; bindingName: string; address?: string }> = []
    for (const port of getChildrenByLocalName(service, 'port')) {
      const pName = (port['@_name'] as string | undefined) ?? ''
      const bRef = stripNsPrefix(port['@_binding'] as string | undefined)
      if (!pName || !bRef) continue
      // <soap:address location="..."> sibling
      const addrEl = findChildByLocalName(port, 'address', /\bsoap\b/i)
      const address = addrEl ? (addrEl['@_location'] as string | undefined) : undefined
      ports.push({ name: pName, bindingName: bRef, address })
    }
    if (ports.length > 0) result.services.set(sName, ports)
  }

  return result
}

/** Find first descendant whose local name (after NS prefix) matches `localName`. */
function findElementByLocalName(
  obj: unknown,
  localName: string,
): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined
  const record = obj as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (stripNsPrefix(key) === localName) {
      const val = record[key]
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        return val as Record<string, unknown>
      }
    }
  }
  for (const key of Object.keys(record)) {
    const found = findElementByLocalName(record[key], localName)
    if (found) return found
  }
  return undefined
}

/**
 * Return all direct children of `parent` whose local name matches `localName`.
 * Handles fast-xml-parser's array-or-object shape and any namespace prefix.
 */
function getChildrenByLocalName(
  parent: Record<string, unknown>,
  localName: string,
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = []
  for (const key of Object.keys(parent)) {
    if (stripNsPrefix(key) === localName) {
      for (const item of asArray(parent[key])) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          result.push(item as Record<string, unknown>)
        }
      }
    }
  }
  return result
}

/** Find first child by local name; if `prefixHint` provided, key must include it. */
function findChildByLocalName(
  parent: Record<string, unknown>,
  localName: string,
  prefixHint?: RegExp,
): Record<string, unknown> | undefined {
  for (const key of Object.keys(parent)) {
    if (stripNsPrefix(key) !== localName) continue
    if (prefixHint && !prefixHint.test(key)) continue
    const val = parent[key]
    const items = asArray(val)
    if (items.length > 0) {
      const first = items[0]
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        return first as Record<string, unknown>
      }
    }
  }
  return undefined
}

// ─── Parse WSDL ─────────────────────────────────────────────

interface DescribeOperation {
  input?: Record<string, unknown>
  output?: Record<string, unknown>
}

interface DescribePort {
  [operationName: string]: DescribeOperation
}

interface DescribeService {
  [portName: string]: DescribePort
}

interface DescribeResult {
  [serviceName: string]: DescribeService
}

export async function parseWsdl(wsdlUrl: string): Promise<WsdlParseResult> {
  let client: soap.Client
  try {
    client = await soap.createClientAsync(wsdlUrl, {
      disableCache: true,
      escapeXML: false,
      forceSoap12Headers: false,
    })
  } catch (err) {
    // `soap.createClientAsync` lumps fetch failures and XML parse errors
    // together as plain Errors — split them so the user knows which side broke.
    const raw = err instanceof Error ? err.message : String(err)
    if (
      /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ESOCKETTIMEDOUT|ENETUNREACH|EAI_AGAIN|status code|Invalid URL|fetch failed/i.test(
        raw,
      )
    ) {
      const classified = classifyTransportError(err)
      throw new Error(`WSDL fetch failed: ${classified.message}`)
    }
    throw new Error(`WSDL parse error: ${raw}`)
  }

  const description = client.describe() as DescribeResult
  // Access wsdl.xml via index signature to avoid private access error
  const wsdlObj = client.wsdl as unknown as Record<string, unknown>
  const wsdlXml = (wsdlObj['xml'] as string) ?? ''
  const soapVersion = detectSoapVersion(wsdlXml)

  // Re-derive structure directly from WSDL XML — `client.describe()` can
  // collapse operations when two bindings share a portType (e.g. SOAP 1.1
  // + SOAP 1.2 over the same Calculator portType, dropping ops to ~2).
  const xmlStructure = parseWsdlXmlStructure(wsdlXml)

  const services: WsdlService[] = []
  let firstEndpointUrl = ''

  // Prefer the canonical service list from the XML when available — covers
  // the multi-binding case where describe() returns fewer entries.
  const serviceNames =
    xmlStructure.services.size > 0
      ? Array.from(xmlStructure.services.keys())
      : Object.keys(description)

  for (const serviceName of serviceNames) {
    const ports: WsdlPort[] = []
    const xmlPorts = xmlStructure.services.get(serviceName) ?? []
    const describePorts = description[serviceName] ?? {}

    // Union of port names from XML and describe()
    const portNames = Array.from(
      new Set([...xmlPorts.map((p) => p.name), ...Object.keys(describePorts)]),
    )

    for (const portName of portNames) {
      const xmlPort = xmlPorts.find((p) => p.name === portName)
      const describePort = describePorts[portName] ?? {}
      const portEndpoint =
        xmlPort?.address || extractPortEndpoint(client, serviceName, portName) || wsdlUrl

      if (!firstEndpointUrl) {
        firstEndpointUrl = portEndpoint
      }

      // Build canonical op list: prefer portType ops (XML), fallback to describe
      const ptName = xmlPort ? xmlStructure.bindingToPortType.get(xmlPort.bindingName) : undefined
      const xmlOps = ptName ? (xmlStructure.portTypeToOps.get(ptName) ?? []) : []
      const opNames = Array.from(new Set([...xmlOps, ...Object.keys(describePort)]))

      const operations: WsdlOperation[] = []
      for (const opName of opNames) {
        const opDesc = describePort[opName] ?? {}
        const inputSchema = (opDesc.input ?? {}) as Record<string, unknown>
        const outputSchema = (opDesc.output ?? {}) as Record<string, unknown>

        // soapAction: prefer binding-specific value from XML; fallback to soap lib helper
        const xmlAction =
          xmlPort && xmlStructure.bindingOpSoapAction.get(`${xmlPort.bindingName}::${opName}`)
        const soapAction = xmlAction || extractSoapAction(client, portName, opName)
        const exampleRequest = generateEnvelope(
          opName,
          buildExampleParams(inputSchema),
          soapVersion,
          soapAction,
        )
        const exampleResponse = generateResponseEnvelope(opName, outputSchema, soapVersion)

        operations.push({
          name: opName,
          soapAction,
          inputSchema,
          outputSchema,
          exampleRequest,
          exampleResponse,
        })
      }

      ports.push({
        name: portName,
        endpointUrl: portEndpoint,
        operations,
      })
    }

    services.push({ name: serviceName, ports })
  }

  return {
    services,
    endpointUrl: firstEndpointUrl || wsdlUrl,
    soapVersion,
    rawWsdl: wsdlXml,
  }
}

/**
 * Parse WSDL from raw file content by writing a temp file and parsing it.
 */
export async function parseWsdlFromContent(content: string): Promise<WsdlParseResult> {
  const { writeFileSync, unlinkSync } = await import('fs')
  const { join } = await import('path')
  const { tmpdir } = await import('os')

  const tmpFile = join(tmpdir(), `apinizer-wsdl-${randomUUID()}.wsdl`)
  writeFileSync(tmpFile, content, 'utf-8')

  try {
    return await parseWsdl(tmpFile)
  } finally {
    try {
      unlinkSync(tmpFile)
    } catch {
      // cleanup failure is non-critical
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────

function extractPortEndpoint(client: soap.Client, _serviceName: string, _portName: string): string {
  // Access endpoint via index signature to avoid private access error
  const clientRecord = client as unknown as Record<string, unknown>
  const endpoint = clientRecord['endpoint']
  if (typeof endpoint === 'string' && endpoint.length > 0) {
    return endpoint
  }
  return ''
}

function extractSoapAction(client: soap.Client, _portName: string, operationName: string): string {
  // Walk WSDL definitions to find SOAPAction
  try {
    const wsdlRecord = client.wsdl as unknown as Record<string, unknown>
    const defs = wsdlRecord['definitions']
    if (defs && typeof defs === 'object') {
      const defsRecord = defs as unknown as Record<string, unknown>
      const bindings = defsRecord['bindings'] as Record<string, Record<string, unknown>> | undefined
      if (bindings) {
        for (const binding of Object.values(bindings)) {
          const methods = binding['methods'] as Record<string, Record<string, unknown>> | undefined
          if (methods && methods[operationName]) {
            const soapAction = methods[operationName]['soapAction']
            if (typeof soapAction === 'string') {
              return soapAction
            }
          }
        }
      }
    }
  } catch {
    // Fallback: use operation name
  }
  return operationName
}

function buildExampleParams(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>
      if (nested['targetNSAlias'] !== undefined || nested['targetNamespace'] !== undefined) {
        // This is a complex type descriptor — skip metadata keys, build nested example
        const innerResult: Record<string, unknown> = {}
        for (const [innerKey, innerVal] of Object.entries(nested)) {
          if (innerKey === 'targetNSAlias' || innerKey === 'targetNamespace') continue
          innerResult[innerKey] = buildExampleValue(innerVal)
        }
        result[key] = innerResult
      } else {
        result[key] = buildExampleParams(nested)
      }
    } else {
      result[key] = buildExampleValue(value)
    }
  }
  return result
}

function buildExampleValue(schema: unknown): unknown {
  if (schema === null || schema === undefined) return '?'
  if (typeof schema === 'string') return '?'
  if (typeof schema === 'object' && !Array.isArray(schema)) {
    return buildExampleParams(schema as Record<string, unknown>)
  }
  return '?'
}

// ─── Envelope generation ────────────────────────────────────

export function generateEnvelope(
  operationName: string,
  params: Record<string, unknown>,
  soapVersion: SoapVersion,
  _soapAction?: string,
  namespace?: string,
): string {
  const ns = namespace || 'http://tempuri.org/'
  const envelopeNs =
    soapVersion === 'soap12'
      ? 'http://www.w3.org/2003/05/soap-envelope'
      : 'http://schemas.xmlsoap.org/soap/envelope/'

  const bodyContent = buildXmlElement(operationName, params, 'ns1')

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="${envelopeNs}" xmlns:ns1="${ns}">
  <soap:Header/>
  <soap:Body>
    ${bodyContent}
  </soap:Body>
</soap:Envelope>`

  return xml
}

function generateResponseEnvelope(
  operationName: string,
  outputSchema: Record<string, unknown>,
  soapVersion: SoapVersion,
): string {
  const envelopeNs =
    soapVersion === 'soap12'
      ? 'http://www.w3.org/2003/05/soap-envelope'
      : 'http://schemas.xmlsoap.org/soap/envelope/'

  const responseContent = buildExampleParams(outputSchema)
  const bodyContent = buildXmlElement(`${operationName}Response`, responseContent, 'ns1')

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="${envelopeNs}" xmlns:ns1="http://tempuri.org/">
  <soap:Body>
    ${bodyContent}
  </soap:Body>
</soap:Envelope>`
}

function buildXmlElement(
  elementName: string,
  params: Record<string, unknown>,
  prefix: string,
): string {
  const lines: string[] = []
  lines.push(`<${prefix}:${elementName}>`)

  for (const [key, value] of Object.entries(params)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`  ${buildXmlElement(key, value as Record<string, unknown>, prefix)}`)
    } else {
      const strVal = value === undefined || value === null ? '' : String(value)
      lines.push(`  <${prefix}:${key}>${escapeXml(strVal)}</${prefix}:${key}>`)
    }
  }

  lines.push(`</${prefix}:${elementName}>`)
  return lines.join('\n')
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// WS-Security header generation moved to wsse.engine.ts (shared with standalone tool)

// ─── Execute SOAP request ───────────────────────────────────

export async function executeSoap(options: SoapExecuteOptions): Promise<SoapApiResponse> {
  const requestId = randomUUID()
  const startTime = performance.now()

  try {
    // Generate SOAP envelope
    let envelope = generateEnvelope(
      options.operationName,
      options.params,
      options.soapVersion,
      undefined,
      undefined,
    )

    // Apply WS-Security via shared engine (UsernameToken / Timestamp / Sign / Encrypt)
    if (options.wsSecurity?.enabled) {
      const wsseConfig = migrateLegacyConfig(options.wsSecurity)
      envelope = await applyWsSecurity(envelope, wsseConfig)
    }

    // Build request headers
    const requestHeaders: Record<string, string> = {
      ...(options.headers ?? {}),
    }

    if (options.soapVersion === 'soap12') {
      requestHeaders['Content-Type'] =
        `application/soap+xml; charset=utf-8; action="${options.operationName}"`
    } else {
      requestHeaders['Content-Type'] = 'text/xml; charset=utf-8'
      requestHeaders['SOAPAction'] = `"${options.operationName}"`
    }

    // Inject default User-Agent unless the caller supplied one (any case).
    applyDefaultUserAgent(requestHeaders)

    // Build https.Agent with optional TLS protocol/cipher overrides so SOAP
    // requests can reach legacy WS-* endpoints (TLS 1.0/1.1, custom ciphers)
    // the same way HTTP requests can.
    const httpsAgentOpts: https.AgentOptions = {
      rejectUnauthorized: options.sslVerification !== false,
    }
    if (options.tls) {
      const min = normaliseTlsVersion(options.tls.minVersion)
      const max = normaliseTlsVersion(options.tls.maxVersion)
      if (min) httpsAgentOpts.minVersion = min
      if (max) httpsAgentOpts.maxVersion = max
      if (options.tls.ciphers && options.tls.ciphers.trim()) {
        httpsAgentOpts.ciphers = options.tls.ciphers.trim()
      }
    }

    // Execute via axios for full control
    const response = await axios.post<string>(options.endpointUrl, envelope, {
      headers: requestHeaders,
      timeout: options.timeout ?? 30000,
      responseType: 'text',
      transformResponse: [(d: string) => d],
      validateStatus: () => true,
      httpsAgent: new https.Agent(httpsAgentOpts),
      httpAgent: new http.Agent(),
    })

    const endTime = performance.now()
    const totalTime = Math.round(endTime - startTime)

    // Extract response headers
    const responseHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(response.headers)) {
      if (value !== undefined) {
        responseHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value)
      }
    }

    const bodyStr = response.data ?? ''
    const bodySize = Buffer.byteLength(bodyStr, 'utf-8')

    // Try to pretty-format the response XML
    let formattedBody = bodyStr
    try {
      const parsed = xmlParser.parse(bodyStr) as Record<string, unknown>
      formattedBody = xmlBuilder.build(parsed) as string
    } catch {
      // If parsing fails, use raw response
    }

    return {
      requestId,
      protocol: 'soap',
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: formattedBody,
      bodySize,
      timing: { total: totalTime },
      actualRequest: {
        method: 'POST',
        url: options.endpointUrl,
        headers: requestHeaders,
        body: envelope,
      },
    }
  } catch (err) {
    const endTime = performance.now()
    const totalTime = Math.round(endTime - startTime)

    // Reuse the shared transport classifier so SOAP shows the same TLS / DNS /
    // refused-connection messaging as HTTP. Falls back to the raw error text
    // for non-axios shapes (e.g. WSDL parse exceptions thrown above).
    const classified = classifyTransportError(err)
    return {
      requestId,
      protocol: 'soap',
      timing: { total: totalTime },
      error: classified.message,
    }
  }
}
