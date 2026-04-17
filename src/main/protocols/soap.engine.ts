import * as soap from 'soap'
import { XMLParser, XMLBuilder } from 'fast-xml-parser'
import axios from 'axios'
import { randomUUID } from 'crypto'
import { performance } from 'perf_hooks'
import https from 'https'
import http from 'http'

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

export interface WsSecurityConfig {
  enabled: boolean
  type: 'username-token' | 'timestamp'
  username?: string
  password?: string
  passwordType?: 'PasswordText' | 'PasswordDigest'
  addTimestamp?: boolean
}

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
  trimValues: true
})

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true
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
    httpsAgent: new https.Agent({ rejectUnauthorized: sslVerification })
  })
  return response.data
}

/**
 * Recursively find all XSD schemas imported within a WSDL/XSD document.
 * Ported from Java ConverterWSDL.findAllSchemasResursively()
 */
export async function findAllSchemasRecursively(
  schemaBody: string,
  parentUrl: string,
  resolvedLocations: Set<string> = new Set(),
  schemas: SoapSchema[] = []
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
  const client = await soap.createClientAsync(wsdlUrl, {
    disableCache: true,
    escapeXML: false,
    forceSoap12Headers: false
  })

  const description = client.describe() as DescribeResult
  // Access wsdl.xml via index signature to avoid private access error
  const wsdlObj = client.wsdl as unknown as Record<string, unknown>
  const wsdlXml = (wsdlObj['xml'] as string) ?? ''
  const soapVersion = detectSoapVersion(wsdlXml)

  const services: WsdlService[] = []
  let firstEndpointUrl = ''

  for (const [serviceName, serviceDesc] of Object.entries(description)) {
    const ports: WsdlPort[] = []

    for (const [portName, portDesc] of Object.entries(serviceDesc)) {
      const operations: WsdlOperation[] = []
      // Try to get the endpoint URL from the WSDL definition
      const portEndpoint = extractPortEndpoint(client, serviceName, portName) || wsdlUrl

      if (!firstEndpointUrl) {
        firstEndpointUrl = portEndpoint
      }

      for (const [opName, opDesc] of Object.entries(portDesc)) {
        const inputSchema = (opDesc.input ?? {}) as Record<string, unknown>
        const outputSchema = (opDesc.output ?? {}) as Record<string, unknown>

        const soapAction = extractSoapAction(client, portName, opName)
        const exampleRequest = generateEnvelope(
          opName,
          buildExampleParams(inputSchema),
          soapVersion,
          soapAction
        )
        const exampleResponse = generateResponseEnvelope(opName, outputSchema, soapVersion)

        operations.push({
          name: opName,
          soapAction,
          inputSchema,
          outputSchema,
          exampleRequest,
          exampleResponse
        })
      }

      ports.push({
        name: portName,
        endpointUrl: portEndpoint,
        operations
      })
    }

    services.push({ name: serviceName, ports })
  }

  return {
    services,
    endpointUrl: firstEndpointUrl || wsdlUrl,
    soapVersion,
    rawWsdl: wsdlXml
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

function extractPortEndpoint(
  client: soap.Client,
  _serviceName: string,
  _portName: string
): string {
  // Access endpoint via index signature to avoid private access error
  const clientRecord = client as unknown as Record<string, unknown>
  const endpoint = clientRecord['endpoint']
  if (typeof endpoint === 'string' && endpoint.length > 0) {
    return endpoint
  }
  return ''
}

function extractSoapAction(
  client: soap.Client,
  _portName: string,
  operationName: string
): string {
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
  soapAction?: string,
  namespace?: string
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
  soapVersion: SoapVersion
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
  prefix: string
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

// ─── WS-Security header generation ─────────────────────────

function buildWsSecurityHeader(config: WsSecurityConfig): string {
  if (!config.enabled) return ''

  if (config.type === 'username-token' && config.username && config.password) {
    const passwordType =
      config.passwordType === 'PasswordDigest'
        ? 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest'
        : 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText'

    const timestamp = config.addTimestamp
      ? `
      <wsu:Timestamp xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
        <wsu:Created>${new Date().toISOString()}</wsu:Created>
        <wsu:Expires>${new Date(Date.now() + 300000).toISOString()}</wsu:Expires>
      </wsu:Timestamp>`
      : ''

    return `
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" soap:mustUnderstand="1">
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(config.username)}</wsse:Username>
        <wsse:Password Type="${passwordType}">${escapeXml(config.password)}</wsse:Password>
      </wsse:UsernameToken>${timestamp}
    </wsse:Security>`
  }

  if (config.type === 'timestamp') {
    return `
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" soap:mustUnderstand="1">
      <wsu:Timestamp xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
        <wsu:Created>${new Date().toISOString()}</wsu:Created>
        <wsu:Expires>${new Date(Date.now() + 300000).toISOString()}</wsu:Expires>
      </wsu:Timestamp>
    </wsse:Security>`
  }

  return ''
}

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
      undefined
    )

    // Insert WS-Security header if configured
    if (options.wsSecurity?.enabled) {
      const securityHeader = buildWsSecurityHeader(options.wsSecurity)
      envelope = envelope.replace('<soap:Header/>', `<soap:Header>${securityHeader}\n  </soap:Header>`)
    }

    // Build request headers
    const requestHeaders: Record<string, string> = {
      ...(options.headers ?? {})
    }

    if (options.soapVersion === 'soap12') {
      requestHeaders['Content-Type'] = `application/soap+xml; charset=utf-8; action="${options.operationName}"`
    } else {
      requestHeaders['Content-Type'] = 'text/xml; charset=utf-8'
      requestHeaders['SOAPAction'] = `"${options.operationName}"`
    }

    // Execute via axios for full control
    const response = await axios.post<string>(options.endpointUrl, envelope, {
      headers: requestHeaders,
      timeout: options.timeout ?? 30000,
      responseType: 'text',
      transformResponse: [(d: string) => d],
      validateStatus: () => true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: options.sslVerification !== false
      }),
      httpAgent: new http.Agent()
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
        body: envelope
      }
    }
  } catch (err) {
    const endTime = performance.now()
    const totalTime = Math.round(endTime - startTime)

    return {
      requestId,
      protocol: 'soap',
      timing: { total: totalTime },
      error: (err instanceof Error) ? err.message : String(err)
    }
  }
}
