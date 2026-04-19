# Import / Export Agent

## Rol
Tüm collection import ve export işlemlerini implement edersin.

## Kapsam
`src/main/ipc/import-export.handler.ts` + parser modülleri

---

## Import Modal Formatları (SRS §3.15'ten)

```typescript
// 16 format — sıra önemli (mockup grid layout)
const IMPORT_FORMATS = [
  'openapi3',         // OpenAPI/Swagger (Satır 1)
  'postman',
  'insomnia',
  'curl',
  'apidog',
  'har',
  'jmeter',
  'apidoc',           // (Satır 2)
  'raml',
  'io-doc',
  'wsdl',             // ← ÖNEMLİ — SOAP operasyonları için
  'wadl',
  'google-discovery',
  'proto',
  'soapui',           // (Satır 3)
  'hoppscotch',
]
```

---

## OpenAPI 3.x / 2.x Import

```typescript
import SwaggerParser from '@readme/openapi-parser'

export async function importOpenApi(filePath: string, projectId: string): Promise<ImportResult> {
  const api = await SwaggerParser.dereference(filePath)

  // Proje oluştur
  const project = { name: api.info?.title ?? 'Imported API', ... }

  // Tag'leri → folder'a dönüştür
  const folders = (api.tags ?? []).map(tag => ({
    id: crypto.randomUUID(), name: tag.name, ...
  }))

  // Her path/method → endpoint
  const endpoints: Endpoint[] = []
  for (const [path, pathItem] of Object.entries(api.paths ?? {})) {
    for (const method of ['get','post','put','patch','delete','head','options']) {
      const op = (pathItem as any)?.[method]
      if (!op) continue
      endpoints.push({
        name: op.summary ?? `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path: `{{baseUrl}}${path}`,
        folder_id: findFolderByTag(folders, op.tags?.[0]),
        request_schema: JSON.stringify(buildRequestSchema(op, pathItem)),
        response_schemas: JSON.stringify(buildResponseSchemas(op)),
      })
    }
  }

  // servers[0].url → baseUrl env var önerisi
  const suggestedEnvVars = api.servers?.[0]?.url
    ? { baseUrl: api.servers[0].url }
    : {}

  // DB'ye yaz
  await db.transaction(() => { /* project + folders + endpoints */ })()
  return { success: true, endpointCount: endpoints.length, suggestedEnvVars }
}
```

---

## WSDL Import

```typescript
import * as soap from 'soap'

export async function importWsdl(urlOrPath: string, projectId: string): Promise<ImportResult> {
  const client = await soap.createClientAsync(urlOrPath)
  const description = client.describe()

  const endpoints: Endpoint[] = []
  for (const [svcName, service] of Object.entries(description)) {
    for (const [portName, port] of Object.entries(service as any)) {
      for (const [opName, op] of Object.entries(port as any)) {
        const envelope = generateSoapEnvelope(opName, op as any, client)
        endpoints.push({
          name: opName,
          protocol: 'soap',
          method: opName,
          path: extractEndpointUrl(client, portName),
          metadata: JSON.stringify({
            wsdlUrl: urlOrPath,
            serviceName: svcName,
            portName,
            operationName: opName,
            inputSchema: (op as any).input,
            outputSchema: (op as any).output,
          }),
          request_schema: JSON.stringify({
            body: { type: 'xml', content: envelope }
          }),
        })
      }
    }
  }

  return { success: true, endpointCount: endpoints.length }
}
```

---

## Postman v2.1 Import

```typescript
export function importPostman(data: PostmanCollectionV21, projectId: string): ImportResult {
  function processItems(items: any[], parentFolderId: string | null) {
    for (const item of items) {
      if (item.item) {
        // Klasör
        const folder = { id: crypto.randomUUID(), name: item.name, parent_id: parentFolderId }
        processItems(item.item, folder.id)
      } else {
        // Request → Endpoint
        const req = item.request
        endpoints.push({
          name: item.name,
          method: req.method,
          path: typeof req.url === 'string' ? req.url : req.url?.raw ?? '',
          folder_id: parentFolderId,
          request_schema: JSON.stringify({
            headers: mapPostmanHeaders(req.header),
            params:  mapPostmanQuery(req.url?.query),
            body:    mapPostmanBody(req.body),
            auth:    mapPostmanAuth(req.auth),
          }),
        })
      }
    }
  }
  processItems(data.item, null)
  return { success: true, endpointCount: endpoints.length }
}
```

---

## cURL Import

```typescript
export function importCurl(curlStr: string): Partial<SavedRequest> {
  // curl -X POST 'https://api.example.com/users' \
  //   -H 'Authorization: Bearer TOKEN' \
  //   -H 'Content-Type: application/json' \
  //   -d '{"name":"John"}'
  
  // Parse: method (-X), url, headers (-H), body (-d/--data), auth (-u)
  const method  = curlStr.match(/-X\s+(\w+)/)?.[1] ?? 'GET'
  const url     = curlStr.match(/curl\s+['"]?([^'"|\s]+)/)?.[1] ?? ''
  const headers = [...curlStr.matchAll(/-H\s+['"]([^'"]+)['"]/g)]
    .map(m => { const [k,v] = m[1].split(/:\s?/,2); return { key:k, value:v, enabled:true, id: crypto.randomUUID() } })
  const body    = curlStr.match(/-d\s+['"]([^'"]+)['"]/)?.[1]
  
  return { method, url, headers, body: body ? { type: 'json', content: body } : undefined }
}
```

---

## Export: Postman v2.1

```typescript
export function exportAsPostman(project: Project, endpoints: Endpoint[]): object {
  return {
    info: {
      name: project.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: endpoints.map(ep => {
      const schema = parseSchema(ep.request_schema)
      return {
        name: ep.name,
        request: {
          method: ep.method,
          url: { raw: ep.path },
          header: schema.headers?.map(h => ({ key: h.key, value: h.value })) ?? [],
          body: mapToPostmanBody(schema.body),
          auth: mapToPostmanAuth(schema.auth),
        },
      }
    }),
  }
}
```

---

## Export: cURL

```typescript
export function exportAsCurl(endpoint: Endpoint, resolvedVars: Record<string,string>): string {
  const schema  = parseSchema(endpoint.request_schema)
  const url     = resolveVariables(endpoint.path, resolvedVars)
  const headers = schema.headers
    ?.filter(h => h.enabled)
    .map(h => `-H '${h.key}: ${resolveVariables(h.value, resolvedVars)}'`)
    .join(' \\\n  ') ?? ''
  const body    = schema.body?.content
    ? `-d '${schema.body.content}'`
    : ''
  return `curl -X ${endpoint.method} '${url}'\\\n  ${headers}${body ? ' \\\n  ' + body : ''}`.trim()
}
```

---

## Import Flow (Renderer tarafı)

1. Import Modal'da format seç
2. Source seç: File / URL / Paste
3. `window.api.importExport.importFile(format, filePath, projectId)` çağır
4. Loading state göster
5. Sonuç: `{ success, endpointCount, suggestedEnvVars, warnings }`
6. Başarıda: tree'yi yenile, yeni collection'a navigate et
7. suggestedEnvVars varsa: "baseUrl eklemek ister misiniz?" sor

---

## Kurallar

- Tüm işlemler main process'te IPC üzerinden
- Hatalı veri → partial import + warning (hard fail değil)
- OpenAPI `servers[0].url` → `baseUrl` env var önerisi
- WSDL → tüm operasyonlar collection'a eklenir
- Import sonucu: `{ success, collectionId?, endpointCount, warnings[] }`
