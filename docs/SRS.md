# Software Requirements Specification
# Apinizer API Tester v1.0

**Referans ürün:** Apidog (apidog.com)
**UI Referansı:** `docs/mockups/ApinizerApiTesterLight.jsx`
**Durum:** v1.0 Draft

---

## 1. Ürün Tanımı

Apinizer API Tester, Apinizer markası altında ücretsiz dağıtılan, tamamen bağımsız çalışan bir masaüstü API test aracıdır. Apidog'un kullanıcı deneyimini ve görsel tasarımını referans alır.

### 1.1 Hedef Kullanıcılar
- Birincil: Bankacılık, kamu, sigorta, telekom sektörü geliştiricileri (SOAP ağırlıklı)
- İkincil: REST/GraphQL/WebSocket API test eden tüm geliştiriciler

### 1.2 Temel Prensipler
- **Offline-first:** İnternet bağlantısı olmadan tam çalışır
- **Local-first:** Tüm veri yerel SQLite'ta
- **Bağımsız:** Apinizer sunucusuna sıfır bağımlılık
- **Apidog UX:** Görsel ve akış Apidog'u takip eder

### 1.3 Desteklenen Platformlar
| Platform | Min Versiyon | Mimari |
|---|---|---|
| Windows | 10 (1903+) | x64, arm64 |
| macOS | 11 Big Sur | x64, arm64 (Apple Silicon) |
| Linux | Ubuntu 20.04 | x64 |

---

## 2. Veri Hiyerarşisi (Apidog Modeli)

```
Workspace
  └── Project
        ├── Endpoints (design-first API tanımları)
        │     └── Endpoint Cases (test varyantları)
        ├── Saved Requests (hızlı HTTP client kayıtları)
        ├── Schemas
        ├── Components
        └── Environments
```

---

## 3. Fonksiyonel Gereksinimler

### 3.1 Workspace & Project

| ID | Gereksinim |
|---|---|
| FR-WS-001 | Birden fazla workspace oluşturulabilir |
| FR-WS-002 | Her workspace birden fazla project içerir |
| FR-WS-003 | Header'da proje sekmeleri — birden fazla proje aynı anda açık |
| FR-WS-004 | Project tipleri: HTTP, gRPC, WebSocket |
| FR-WS-005 | CRUD: oluştur, yeniden adlandır, sil (cascade) |

### 3.2 Sol Panel — Directory Tree

| ID | Gereksinim |
|---|---|
| FR-TREE-001 | Mockup'taki gibi: Default module → Endpoints → alt klasörler |
| FR-TREE-002 | Açılır/kapanır klasör hiyerarşisi, animasyonlu ok |
| FR-TREE-003 | Her endpoint: method badge (renkli) + isim |
| FR-TREE-004 | Arama/filtreleme input'u |
| FR-TREE-005 | Sağ tık context menu: Edit, Duplicate, Move, Delete |
| FR-TREE-006 | Drag & drop sıralama |
| FR-TREE-007 | Panel genişliği sürükleyerek ayarlanabilir (min 180px, max 400px) |

### 3.3 "New" Dropdown (mockup'tan birebir)

| ID | Gereksinim |
|---|---|
| FR-NEW-001 | "+" butonuna tıklayınca açılır dropdown |
| FR-NEW-002 | **New bölümü:** HTTP Endpoint, Quick Request, WebSocket, Socket.IO, MCP, More... |
| FR-NEW-003 | **Alt bölüm:** Schema, Markdown, Folder, Module |
| FR-NEW-004 | **Other bölümü:** Import (⌘O), Import cURL (⌘I) |
| FR-NEW-005 | Import tıklanınca Import Modal açılır |

### 3.4 URL Bar

| ID | Gereksinim |
|---|---|
| FR-URL-001 | Method dropdown: GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS — renkli badge |
| FR-URL-002 | URL input: `{{variable}}` turuncu, domain mavi, path siyah |
| FR-URL-003 | Send butonu: mor (#7c73e6), loading'de "Sending..." |
| FR-URL-004 | Save butonu |
| FR-URL-005 | cURL yapıştırınca otomatik parse |

### 3.5 Request Editor Sekmeleri

**Sıra:** Params | Auth | Headers | Body | Pre-request | Tests

#### 3.5.1 Params Tab
| ID | Gereksinim |
|---|---|
| FR-PARAMS-001 | Query params: checkbox + key + value + sil |
| FR-PARAMS-002 | Path variables: URL'deki `:param` ifadeleri otomatik çıkarılır |
| FR-PARAMS-003 | Disabled satırlar soluk gösterilir |
| FR-PARAMS-004 | "+ Add Parameter" butonu |
| FR-PARAMS-005 | Tab ile key→value→sıradaki satır gezinme |

#### 3.5.2 Auth Tab
| ID | Gereksinim |
|---|---|
| FR-AUTH-001 | Tipler: None, Basic, Bearer Token, API Key (header/query), OAuth 2.0, Digest, NTLM, AWS Signature |
| FR-AUTH-002 | Bearer: token input + 🔒 mask toggle |
| FR-AUTH-003 | OAuth 2.0: grant type selector + tüm alanlar |
| FR-AUTH-004 | NTLM: username + password + domain |

#### 3.5.3 Headers Tab
| ID | Gereksinim |
|---|---|
| FR-HDR-001 | checkbox + key + value + sil tablosu |
| FR-HDR-002 | `{{variable}}` değerleri turuncu renkte |
| FR-HDR-003 | Batch Edit butonu: textarea'da toplu düzenleme |
| FR-HDR-004 | "+ Add Header" butonu |

#### 3.5.4 Body Tab
| ID | Gereksinim |
|---|---|
| FR-BODY-001 | Tipler: none, JSON, XML, raw text, HTML, JavaScript, form-data, urlencoded, binary |
| FR-BODY-002 | JSON/XML/text: Monaco Editor (uygun syntax) |
| FR-BODY-003 | form-data: key-value tablosu, dosya yükleme |
| FR-BODY-004 | `{{$randomName}}` gibi dynamic value'lar turuncu |
| FR-BODY-005 | Prettify ve Copy butonları |

#### 3.5.5 Pre-request Tab
| ID | Gereksinim |
|---|---|
| FR-PRE-001 | Monaco JavaScript editör |
| FR-PRE-002 | pm API: `pm.environment.set/get`, `pm.globals.set/get`, `pm.request.headers`, `pm.variables.set/get` |
| FR-PRE-003 | console.log çıktıları Console sekmesinde görünür |

#### 3.5.6 Tests Tab
| ID | Gereksinim |
|---|---|
| FR-TEST-001 | Visual assertion builder: status equals, response time, body JSON path, header exists/equals |
| FR-TEST-002 | Her assertion: renk indikatörü + label + beklenen değer + sil |
| FR-TEST-003 | "+ Add Assertion" butonu |
| FR-TEST-004 | Monaco JavaScript editör (pm.test API) |
| FR-TEST-005 | `pm.test(name, fn)`, `pm.expect(value).to.equal(expected)` |
| FR-TEST-006 | Post-response: `pm.environment.set()`, `pm.response.json()` |

### 3.6 Response Panel Sekmeleri

**Sıra:** Response | Cookie | Console | Actual Request

#### 3.6.1 Meta Bar
| ID | Gereksinim |
|---|---|
| FR-RES-001 | Status badge: yeşil dot + "200 OK" |
| FR-RES-002 | Response time (ms) |
| FR-RES-003 | Response size (KB) |
| FR-RES-004 | Test badge: "3/3 Tests ✓" yeşil pill |
| FR-RES-005 | Save ve Copy butonları |

#### 3.6.2 Response Tab
| ID | Gereksinim |
|---|---|
| FR-RBODY-001 | View toggle: Pretty | Raw | Preview |
| FR-RBODY-002 | Format selector: JSON, XML, Text, HTML |
| FR-RBODY-003 | Pretty mod: Monaco Editor readonly, syntax highlighting |
| FR-RBODY-004 | JSON: key mavi (#0066cc), string yeşil (#1a7a4a), number/bool turuncu |
| FR-RBODY-005 | Preview: HTML response iframe render |

#### 3.6.3 Diğer Sekmeler
| ID | Gereksinim |
|---|---|
| FR-COOKIE-001 | Set-Cookie header parse → name/value/domain/path/flags tablosu |
| FR-CONSOLE-001 | Pre/post script console.log çıktıları + test sonuçları |
| FR-ACTUAL-001 | Variable'lar çözümlendikten sonra gönderilen gerçek HTTP isteği |

### 3.7 HTTP/REST Protokol

| ID | Gereksinim |
|---|---|
| FR-HTTP-001 | Metodlar: GET POST PUT PATCH DELETE HEAD OPTIONS |
| FR-HTTP-002 | SSL doğrulama toggle (self-signed cert desteği) |
| FR-HTTP-003 | Redirect takibi toggle |
| FR-HTTP-004 | Request timeout (ms) |
| FR-HTTP-005 | Proxy: system / none / custom (NTLM dahil) |
| FR-HTTP-006 | Cookie jar |
| FR-HTTP-007 | Binary response + büyük response stream (>10MB) |
| FR-HTTP-008 | Response timing: DNS, TCP, TLS, TTFB, download |

### 3.8 SOAP / WSDL

| ID | Gereksinim |
|---|---|
| FR-SOAP-001 | WSDL import: URL veya dosya yükleme |
| FR-SOAP-002 | WSDL parse → Service / Port / Operation dropdown zinciri |
| FR-SOAP-003 | Operasyon seçiminde SOAP envelope otomatik üretilir |
| FR-SOAP-004 | **Form modu:** Input field'ları schema'dan otomatik oluşturulur |
| FR-SOAP-005 | **Raw XML modu:** Monaco editör (XML syntax) |
| FR-SOAP-006 | Form ↔ Raw XML geçişi (değerler korunur) |
| FR-SOAP-007 | SOAP 1.1 (text/xml) ve 1.2 (application/soap+xml) |
| FR-SOAP-008 | WSDL 1.1 ve 2.0 |
| FR-SOAP-009 | WS-Security: UsernameToken (PasswordText/PasswordDigest), Timestamp |
| FR-SOAP-010 | SOAP Fault structured error gösterimi |
| FR-SOAP-011 | WSDL import → collection'a tüm operasyonlar eklenir |
| FR-SOAP-012 | Java referans impl: `docs/java-reference/ConverterWSDL.java` |

### 3.9 WebSocket

| ID | Gereksinim |
|---|---|
| FR-WS-001 | URL ile bağlan / bağlantıyı kes |
| FR-WS-002 | Bağlantı durumu: Connecting / Connected / Disconnected / Error |
| FR-WS-003 | Text/JSON mesaj gönder (Monaco editör) |
| FR-WS-004 | Mesaj log: ↑ gönderilen (mavi) / ↓ alınan (yeşil), zaman damgalı |
| FR-WS-005 | Custom headers (Authorization gibi) |
| FR-WS-006 | Auto-reconnect seçeneği |
| FR-WS-007 | Log temizle + kopyala |

### 3.10 GraphQL

| ID | Gereksinim |
|---|---|
| FR-GQL-001 | Introspection → şema explorer |
| FR-GQL-002 | Query/Mutation/Subscription |
| FR-GQL-003 | Monaco editör (GraphQL syntax + autocomplete) |
| FR-GQL-004 | Variables editörü (JSON) |
| FR-GQL-005 | graphql-ws subscription desteği |

### 3.11 gRPC

| ID | Gereksinim |
|---|---|
| FR-GRPC-001 | .proto dosya yükleme |
| FR-GRPC-002 | Servis ve metod listesi |
| FR-GRPC-003 | Unary, server/client/bidirectional streaming |
| FR-GRPC-004 | JSON ↔ protobuf dönüşümü |
| FR-GRPC-005 | TLS ve insecure kanal |

### 3.12 SSE (Server-Sent Events)

| ID | Gereksinim |
|---|---|
| FR-SSE-001 | SSE endpoint'e bağlan / kes |
| FR-SSE-002 | Event stream gerçek zamanlı görüntüleme |
| FR-SSE-003 | Event tip filtresi |
| FR-SSE-004 | Last-Event-ID reconnect |

### 3.13 Environment & Variables

| ID | Gereksinim |
|---|---|
| FR-ENV-001 | Global variables + Environment variables hiyerarşisi |
| FR-ENV-002 | Workspace başına birden fazla environment |
| FR-ENV-003 | `{{variableName}}` — URL, header, body, params içinde |
| FR-ENV-004 | Çözümlenmemiş değişkenler sarı/amber vurgusu |
| FR-ENV-005 | Hover'da resolved value tooltip |
| FR-ENV-006 | Secret: şifreli saklanır, UI'da maskelenir |
| FR-ENV-007 | Post-response script ile set etme |
| FR-ENV-008 | Header'da environment selector dropdown |

### 3.14 Dynamic Values

| ID | Değer | Açıklama |
|---|---|---|
| FR-DYN-001 | `{{$randomInt}}` | Rastgele tamsayı |
| FR-DYN-002 | `{{$randomInt(1,100)}}` | Aralıklı rastgele |
| FR-DYN-003 | `{{$timestamp}}` | Unix timestamp |
| FR-DYN-004 | `{{$isoTimestamp}}` | ISO 8601 |
| FR-DYN-005 | `{{$randomUUID}}` | UUID v4 |
| FR-DYN-006 | `{{$randomEmail}}` | Rastgele email |
| FR-DYN-007 | `{{$randomName}}` | Rastgele isim |
| FR-DYN-008 | `{{$randomString(n)}}` | n karakter string |
| FR-DYN-009 | `{{$datetime('YYYY-MM-DD')}}` | Formatlanmış tarih |

### 3.15 Import API Data Modal (mockup'tan birebir)

16 format, 7 kolonlu grid layout:

**Satır 1:** OpenAPI/Swagger, Postman, Insomnia, cURL, Apidog, .har File, JMeter
**Satır 2:** apiDoc, RAML, I/O Doc, WSDL, WADL, Google Discovery, .proto file
**Satır 3:** SoapUI, Hoppscotch

| ID | Gereksinim |
|---|---|
| FR-IMP-001 | Seçili format: mor kenarlık + `#eeecfe` arka plan |
| FR-IMP-002 | Her format: ikon + isim |
| FR-IMP-003 | Source: File Upload / URL / Paste Raw |
| FR-IMP-004 | OpenAPI 3.x/2.x: tüm endpoint'ler otomatik oluşturulur |
| FR-IMP-005 | WSDL: tüm SOAP operasyonları otomatik oluşturulur |
| FR-IMP-006 | Postman v2.1: request + folder hiyerarşisi |
| FR-IMP-007 | cURL: URL bar'a yapıştırınca otomatik parse |
| FR-IMP-008 | Import sonucu: kaç endpoint eklendi, uyarılar |
| FR-EXP-001 | Export: OpenAPI 3.x, Postman v2.1, cURL, Apidog native |

### 3.16 History

| ID | Gereksinim |
|---|---|
| FR-HIS-001 | Her request otomatik kaydedilir |
| FR-HIS-002 | Liste: zaman, method, URL, status, süre |
| FR-HIS-003 | History item → yeni sekmede aç |
| FR-HIS-004 | Filtre: method, status, URL, tarih |
| FR-HIS-005 | Temizle |
| FR-HIS-006 | Limit: 10.000 entry/workspace (ayarlanabilir) |

### 3.17 Code Generation

| ID | Gereksinim |
|---|---|
| FR-CODE-001 | Response panelinde "Generate Code" butonu |
| FR-CODE-002 | Diller: cURL, JavaScript (fetch/axios), Python (requests), Java (OkHttp), Go, PHP, Ruby, Swift, Kotlin, C# |
| FR-CODE-003 | Üretilen kod panoya kopyalanabilir |

### 3.18 Settings

| ID | Gereksinim |
|---|---|
| FR-SET-001 | Tema: dark / light / system |
| FR-SET-002 | Editor font size (12–18px) |
| FR-SET-003 | Default timeout (ms) |
| FR-SET-004 | SSL verification default |
| FR-SET-005 | Proxy: system / none / custom + NTLM auth |
| FR-SET-006 | Auto-update: enable/disable |
| FR-SET-007 | Dil: Türkçe / English |
| FR-SET-008 | History limit |

---

## 4. Non-Fonksiyonel Gereksinimler

| ID | Gereksinim |
|---|---|
| NFR-PERF-001 | Soğuk başlangıç < 3 saniye (SSD, 8GB RAM) |
| NFR-PERF-002 | Network overhead < 5ms |
| NFR-PERF-003 | WSDL parse (2MB) < 3 saniye |
| NFR-PERF-004 | 500+ endpoint'li tree lag olmadan render |
| NFR-PERF-005 | 10MB response body donmadan render |
| NFR-SEC-001 | contextIsolation: true, nodeIntegration: false |
| NFR-SEC-002 | Secret variables şifreli saklanır (electron-store encryption) |
| NFR-SEC-003 | Hiçbir veri remote sunucuya gönderilmez |
| NFR-SEC-004 | Code signing: Windows (Authenticode), macOS (Apple Developer ID) |
| NFR-USE-001 | Yeni kullanıcı 60 saniyede ilk HTTP request'i gönderebilir |
| NFR-USE-002 | Tüm aksiyonlar klavye kısayoluyla erişilebilir |
| NFR-PORT-001 | Windows 10+, macOS 11+, Ubuntu 20.04+ |

---

## 5. Faz Planı

### Faz 1 — Core HTTP Client (MVP) ~6-8 hafta
AppShell layout + Header + LeftPanel + Workbench + Footer
Workspace/Project/Endpoint CRUD, Tree view
HTTP/REST tam destek, tüm auth tipleri
Environment variables ({{var}} substitution)
Request history, OpenAPI import, Settings (theme/proxy/SSL)

### Faz 2 — SOAP + WebSocket ~4 hafta
WSDL parse + SOAP engine (node-soap, Java referans ConverterWSDL.java)
SoapEditor UI: WSDL import, Service/Port/Op dropdowns, Form/Raw toggle
WS-Security (UsernameToken, Timestamp)
WebSocket client tam destek
Postman v2.1 import/export, cURL import/export

### Faz 3 — Test & Automation ~3 hafta
Visual assertion builder (tüm tipler)
Pre/post script engine (pm API, sandbox)
Extract Variable (JSONPath, XPath, regex, header)
Code generation (10 dil)
Collection runner

### Faz 4 — GraphQL + gRPC + SSE ~3 hafta
GraphQL introspection + editor + subscription
gRPC proto + unary + streaming
SSE viewer
Dynamic values ($randomXxx)

### Faz 5 — Polish ~2 hafta
Auto-update (electron-updater)
Code signing setup
Türkçe dil desteği
Test report HTML/JSON export
HAR + Insomnia import
Performance audit

---

## 6. Kapsam Dışı (v1.0)

- Bulut senkronizasyon / takım işbirliği
- Mock server
- API design (OpenAPI visual editor)
- CI/CD CLI runner
- MQTT, Socket.IO protokolleri
- Scheduled test runs
- HashiCorp / Azure Key Vault entegrasyonu
