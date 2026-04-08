# Protocol Engine Agent

## Rol
Tüm ağ protokol motorlarını Electron main process'te implement edersin.

## Kapsam
`src/main/protocols/` + `src/main/ipc/`

---

## IPC Handler Şablonu (Tüm Handler'lar Bu Formatı Kullanır)

```typescript
ipcMain.handle('channel:action', async (event, ...args) => {
  try {
    const result = await engine.method(...args)
    return { success: true, data: result }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})
```

---

## HTTP Engine (`http.engine.ts`)

```typescript
import axios from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { HttpCookieAgent } from 'http-cookie-agent/http'
import { CookieJar } from 'tough-cookie'

interface HttpExecuteOptions {
  method: string
  url: string
  headers: Record<string, string>
  body?: string | FormData
  auth?: AuthConfig
  settings?: { timeout: number; sslVerification: boolean; followRedirects: boolean; proxy?: ProxyConfig }
}

export async function executeHttp(opts: HttpExecuteOptions): Promise<ApiResponse> {
  const start = process.hrtime.bigint()
  
  // SSL: rejectUnauthorized toggle
  // Proxy: system / custom / NTLM
  // Auth: basic, bearer, api-key, digest, ntlm
  // Cookie jar: tough-cookie
  // Timing: process.hrtime.bigint() fark
  // Large response: >10MB → stream to temp, return path
}
```

---

## SOAP Engine (`soap.engine.ts`)

### Java Referans Implementasyonu
`docs/java-reference/ConverterWSDL.java` — WSDL parse, operasyon listesi, XSD recursive çekme.

**Java → Node.js Mapping:**

| Java Metodu | Node.js Karşılığı |
|---|---|
| `WsdlImporter.importWsdl()` | `soap.createClientAsync(url)` |
| `iface.getOperationList()` | `client.describe()` |
| `exampleRequestForOperation()` | Schema'dan envelope build |
| `findAllSchemasResursively()` | Aşağıda port |
| `resolveSchemaUrl()` | `new URL(schemaLocation, parentUrl).toString()` |
| `normalizeLocation()` | `.toLowerCase().replace(/\\/g, '/')` |
| `servers()` — SOAP 1.1/1.2 | WSDL namespace'den tespit |

### `findAllSchemasRecursively()` Port

```typescript
async function findAllSchemasRecursively(
  schemaList: SoapSchema[],
  schemaBody: string,
  parentUrl: string,
  resolvedLocations: Set<string>,
  counter: { value: number }
): Promise<void> {
  // 1. fast-xml-parser ile xsd:import/@schemaLocation bul
  // 2. resolveSchemaUrl(location, parentUrl) ile absolute URL
  // 3. normalizeLocation ile Set'e bak, varsa atla
  // 4. HTTP → axios.get, file → fs.readFile
  // 5. schemaList'e ekle, recurse
}

function resolveSchemaUrl(schemaLocation: string, parentUrl: string): string {
  if (/^https?:\/\//.test(schemaLocation) || schemaLocation.startsWith('file:///')) {
    return schemaLocation
  }
  try { return new URL(schemaLocation, parentUrl).toString() }
  catch { return schemaLocation }
}

function normalizeLocation(location: string): string {
  return location.toLowerCase().replace(/\\/g, '/')
}
```

### SOAP Versiyon Tespiti
```typescript
// client.wsdl içindeki binding namespace'e bak:
// 'http://schemas.xmlsoap.org/wsdl/soap/'   → SOAP 1.1 → text/xml
// 'http://schemas.xmlsoap.org/wsdl/soap12/' → SOAP 1.2 → application/soap+xml
```

### Envelope Üretimi
```typescript
function generateEnvelope(
  operationName: string,
  params: Record<string, any>,
  namespace: string,
  soapVersion: 'soap11' | 'soap12'
): string {
  const envNs = soapVersion === 'soap11'
    ? 'http://schemas.xmlsoap.org/soap/envelope/'
    : 'http://www.w3.org/2003/05/soap-envelope'
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${envNs}" xmlns:tns="${namespace}">
  <soapenv:Header/>
  <soapenv:Body>
    <tns:${operationName}>
${buildXmlBody(params, '      ')}
    </tns:${operationName}>
  </soapenv:Body>
</soapenv:Envelope>`
}
```

### WS-Security
```typescript
import wsse from 'wsse'
// UsernameToken: wsse.UsernameToken(user, pass, { passwordType, hasTimeStamp })
// Timestamp: wsse.Timestamp()
// Header'a inject: envelope XML string manipülasyonu veya node-soap header API
```

### IPC Channels
```
wsdl:parse          → parseWsdl(urlOrPath)
wsdl:generate       → generateEnvelope(op, params, ns, version)
soap:execute        → executeSoap(url, envelope, version, wsSec, headers)
```

---

## WebSocket Engine (`websocket.engine.ts`)

```typescript
import WebSocket from 'ws'

const connections = new Map<string, WebSocket>()

export function wsConnect(id: string, url: string, headers: Record<string, string>): void {
  const ws = new WebSocket(url, { headers })
  connections.set(id, ws)
  ws.on('open',    () => mainWindow?.webContents.send('ws:open', id))
  ws.on('message', (data) => mainWindow?.webContents.send('ws:message', id, { data: data.toString(), timestamp: Date.now() }))
  ws.on('close',   () => mainWindow?.webContents.send('ws:close', id))
  ws.on('error',   (err) => mainWindow?.webContents.send('ws:error', id, err.message))
}

export function wsSend(id: string, message: string): void {
  connections.get(id)?.send(message)
}

export function wsDisconnect(id: string): void {
  connections.get(id)?.close()
  connections.delete(id)
}
```

IPC: `ws:connect`, `ws:send`, `ws:disconnect`
Events (main→renderer): `ws:open`, `ws:message`, `ws:close`, `ws:error`

---

## GraphQL Engine (`graphql.engine.ts`)

```typescript
// introspect(url, headers) → schema SDL + types
// query(url, query, variables, headers) → data
// subscribe(url, query, variables, headers) → graphql-ws, events via IPC
```

IPC: `gql:introspect`, `gql:query`, `gql:subscribe`, `gql:unsubscribe`

---

## gRPC Engine (`grpc.engine.ts`)

```typescript
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

// loadProto(filePath) → services + methods
// unaryCall(service, method, request, options) → response
// serverStream(service, method, request, options) → events via IPC
```

IPC: `grpc:load-proto`, `grpc:call`, `grpc:stream`

---

## SSE Engine (`sse.engine.ts`)

```typescript
import EventSource from 'eventsource'

const sseConnections = new Map<string, EventSource>()

export function sseConnect(id: string, url: string, headers: Record<string, string>): void {
  const es = new EventSource(url, { headers })
  sseConnections.set(id, es)
  es.onmessage = (event) => mainWindow?.webContents.send('sse:event', id, {
    type: event.type, data: event.data, id: event.lastEventId, timestamp: Date.now()
  })
  es.onerror = () => mainWindow?.webContents.send('sse:error', id)
}
```

IPC: `sse:connect`, `sse:disconnect`
Events: `sse:event`, `sse:error`

---

## Kritik Kurallar

- TÜM network işlemleri main process'te
- Her IPC handler try/catch, `{success, data?, error?}` döner
- Timeout'lar explicit — hiçbir request askıda kalamaz
- SSL hataları net mesajlarla döner
- Sensitive data (şifre, token) sadece debug modunda loglanır
- Her engine önce bağımsız Node.js scriptiyle test edilir
