# /implement-soap

SOAP/WSDL desteğini uçtan uca implement eder.

## Önce Oku
e1. `.claude/agents/protocol-engine.md` → SOAP Engine bölümü
2. Mevcut `src/main/protocols/soap.engine.ts` (varsa)

## Paketler

```bash
npm install node-soap wsse fast-xml-parser
```

## Adım 1 — SOAP Engine

**Dosya:** `src/main/protocols/soap.engine.ts`

```typescript
import * as soap from 'soap'
import wsse from 'wsse'
import { XMLParser } from 'fast-xml-parser'

// parseWsdl(urlOrPath: string): Promise<WsdlParseResult>
//   - soap.createClientAsync()
//   - client.describe() → service/port/operation ağacı
//   - Her operasyon için: name, inputSchema, outputSchema, exampleRequest
//   - SOAP versiyon tespiti (namespace'den)
//   - findAllSchemasRecursively() — XSD'leri rekürsif çekip tek dokümanda birleştir

// generateEnvelope(opName, params, namespace, soapVersion): string
//   - SOAP 1.1 vs 1.2 envelope namespace
//   - buildXmlBody(params) — her field için placeholder değer

// executeSoap(url, envelope, soapVersion, wsSecurity?, customHeaders?): Promise<SoapResponse>
//   - axios.post
//   - Content-Type: text/xml (1.1) | application/soap+xml (1.2)
//   - WS-Security inject (wsse)
//   - Response: rawXml + parsedJson + statusCode + headers

// buildWsseHeader(config: WsSecurityConfig): string
//   - wsse.UsernameToken(user, pass, { passwordType, hasTimeStamp })
```

## Adım 2 — IPC Handler

**Dosya:** `src/main/ipc/wsdl.handler.ts`

```typescript
ipcMain.handle('wsdl:parse',    async (_, urlOrPath) => { ... })
ipcMain.handle('wsdl:generate', async (_, op, params, ns, v) => { ... })
ipcMain.handle('soap:execute',  async (_, opts) => { ... })
```

`src/main/ipc/index.ts`'e ekle:
```typescript
import { registerWsdlHandlers } from './wsdl.handler'
registerWsdlHandlers(db)
```

## Adım 3 — Preload

`src/preload/index.ts`'e `wsdl` bölümü zaten var (electron-shell agent'ına bak).

## Adım 4 — SoapEditor UI

**Dosya:** `src/renderer/components/protocols/SoapEditor.tsx`

Mockup'taki UI akışı:
```
1. WSDL URL input + "Import" butonu
   → Loading: "Parsing WSDL..." spinner
   → Hata: kırmızı alert, URL göster

2. Başarıda:
   Service dropdown → Port dropdown → Operation dropdown
   (Bağımlı dropdown'lar: service seçince port listesi, port seçince op listesi)

3. Operation seçilince:
   [Form Mode] [Raw XML] toggle

   Form Mode:
     Her input field → operation inputSchema'dan otomatik
     String: text input
     Integer/Number: number input
     Boolean: checkbox
     Complex type: nested section

   Raw XML:
     Monaco editörü (XML mode)
     Auto-generated envelope gösterilir
     Kullanıcı düzenleyebilir

4. WS-Security accordion (Radix Accordion):
   Toggle: enabled/disabled
   Type: UsernameToken | Timestamp only
   UsernameToken:
     Username input
     Password input (masked + 🔒 toggle)
     Password type: PasswordText | PasswordDigest radio
   Timestamp: otomatik, checkbox ile

5. Send butonuna basınca:
   - Raw XML modda: Monaco içeriğini envelope olarak kullan
   - Form modda: generateEnvelope() çağır
   - executeSoap() ile gönder
   - Response: XML → Monaco (XML mode, readonly)
   - SOAP Fault: kırmızı badge + faultcode + faultstring göster
```

## Adım 5 — WSDL Import (Collection'a)

```typescript
// Import Modal'da WSDL formatı seçilince:
// window.api.importExport.importUrl('wsdl', wsdlUrl, projectId)
// → import-export.handler.ts → importWsdl()
// → Tüm operasyonlar endpoint olarak eklenir
// → Collection tree'de görünür
```

## Test WSDL'leri

```
http://www.dneonline.com/calculator.asmx?WSDL         — basit hesap makinesi
http://webservices.oorsprong.org/websamples.countryinfo/CountryInfoService.wso?WSDL
https://www.w3schools.com/xml/tempconvert.asmx?WSDL   — sıcaklık dönüştürücü
```

## Hata Durumları

| Durum | Kullanıcıya gösterilen mesaj |
|---|---|
| WSDL erişilemiyor | "Could not fetch WSDL. Check URL and network connection." |
| WSDL parse hatası | "Invalid WSDL format: [hata detayı]" |
| SSL hatası | "SSL certificate error. Disable SSL verification in request settings." |
| SOAP Fault | Kırmızı badge + `<faultcode>` + `<faultstring>` |
| Timeout | "Request timed out after Xs. Increase timeout in settings." |
| WS-Security hatası | "WS-Security authentication failed." |
