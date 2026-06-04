---
title: Mock Sunucu
description: Testnizer arayüzünden yapılandırdığınız gerçek bir HTTP sunucusu — endpoint'ler, koşullu yanıtlar, scripting, auth, hata enjeksiyonu, OpenAPI/Postman içe aktarma ve recording proxy. Hepsi 127.0.0.1 üzerinde.
order: 6
section: Mock Sunucu
---

Testnizer'in **Mock Sunucu**'su, uygulama içinde çalışan ve sizin
tanımladığınız yanıtları sunan gerçek bir HTTP sunucusudur. Şu durumlar için
uygundur:

- Henüz mevcut olmayan bir backend yerine geçirme (frontend-first geliştirme)
- Kararsız upstream davranışını (latency, 5xx, auth hataları) testlerde
  yeniden üretme
- Yakalanmış production trafiğini offline tekrar oynatma
- İnternetsiz uygulama demosu yapma
- Keyfi HTTP statüleriyle istemci hata yönetimini doğrulama

Sunucu **varsayılan olarak 127.0.0.1**'e bağlanır; LAN'dan erişilebilir
olması için `0.0.0.0`'a açık opt-in yapmanız gerekir.

Mock sunucularını sol kenar çubuğundaki **Mocks** ikonu altında bulursunuz.

![Mock Server editörü — endpoint paneli, tam URL barı, koşul / script editörleri ve canlı yanıt önizleme](/testnizer-mock.png)

## Sunucu oluşturma

Mocks panelinde **+** tıklayın, sunucuya bir ad ve port (1–65535) verin.
Sunucu durdurulmuş halde oluşturulur. Header'daki yeşil **▶ Start**
butonuna basarak portu dinlemeye başlatın.

Her sunucu bağımsızdır: endpoint'leri, in-memory state'i, log buffer'ı ve
rate-limit sayaçları o tek sunucuya özeldir. Makinenizin boş portu kadar
çok sayıda sunucu çalıştırabilirsiniz.

## Endpoint'ler

Endpoints sekmesi solda liste, sağda editör olarak ikiye bölünmüştür.

### Method ve path

Path eşleştirmenin dört modu var:

| Mod | Desen | Örnek | Eşleşir |
|------|---------|---------|---------|
| `exact` | birebir | `/users` | sadece `/users` |
| `param` | `:isim` yer tutucuları | `/users/:id` | `/users/42` (id = "42") |
| `wildcard` | `*` (tek segment), `**` (her şey) | `/api/*`, `/api/**` | bir segment / her derinlik |
| `regex` | named-group destekli RegExp | `^/v(?<v>\d+)/users$` | `/v3/users` (v = "3") |

HTTP method standart bir verb veya `ANY` (her method'la eşleşir) olabilir.

Birden fazla endpoint match edebiliyorsa Testnizer önce **priority**'ye
(yüksek olan kazanır), sonra **specificity**'ye bakar:
`exact` > `param` > `regex` > `wildcard`.

Path alanının altında URL satırı vardır:

- **Copy** — `http://host:port/basePath/path` adresini panoya kopyalar
- **Copy as cURL** — çalışan bir `curl` komutu üretir (POST/PUT/PATCH için
  yer tutucu `Content-Type` ve gövde dahil)
- **Open** — URL'i tarayıcıda açar. Sadece sunucu çalışırken, method GET
  (veya ANY) ve path mode `exact` olduğunda aktif (tarayıcı `:id` yer
  tutucularını sizin için doldurmaz)

## Yanıtlar ve koşullar

Her endpoint birden çok yanıt taşıyabilir. Bir istek geldiğinde Testnizer
yanıt listesinde yürür ve **koşulu eşleşen ilkini** seçer. Hiçbiri
eşleşmezse fallback olarak ilk açık (enabled) yanıt kullanılır.

Koşullar `type` discriminator'ına sahip JSON nesneleridir. Hazır şablon
eklemek için Condition alanının yanındaki **Insert example…** dropdown'ını
kullanın.

| Tip | Ne zaman | Örnek |
|------|-------------|---------|
| `always` | bu, catch-all/varsayılan yanıt | `{"type":"always"}` |
| `header` | bir istek header'ı belirli değerde | `{"type":"header","name":"X-Tenant","op":"eq","value":"acme"}` |
| `query` | query string param eşleşir | `{"type":"query","name":"locale","op":"eq","value":"tr"}` |
| `pathParam` | bir `:isim` segmenti eşleşir | `{"type":"pathParam","name":"id","op":"eq","value":"42"}` |
| `jsonPath` | JSON gövdesindeki bir değer eşleşir | `{"type":"jsonPath","path":"$.user.role","op":"eq","value":"admin"}` |
| `xpath` | XML gövdesinde bir XPath eşleşir | `{"type":"xpath","expression":"//Order/Status/text()","op":"eq","value":"PAID"}` |
| `method` | HTTP verb'e göre filtrele (`ANY` ile faydalı) | `{"type":"method","method":"POST"}` |
| `and` / `or` | predicate'leri birleştir | `{"type":"and","conditions":[...]}` |

Operatörler: `eq` (string eşitliği), `neq`, `contains` (alt-string), `regex`
(JavaScript RegExp), `exists` (path çözülür / değer var).

### Örnekler

**Adminlere 200, diğerlerine 403** — aynı endpoint'te iki yanıt:

```json
// 1. Yanıt — koşul
{
  "type": "jsonPath",
  "path": "$.role",
  "op": "eq",
  "value": "admin"
}
// 1. Yanıt — body
{ "allowed": true }
// status: 200

// 2. Yanıt — koşul
{ "type": "always" }
// 2. Yanıt — body
{ "error": "forbidden" }
// status: 403
```

**`?locale=tr` geldiğinde Türkçe içerik dön**:

```json
// İlk yanıt — koşul
{ "type": "query", "name": "locale", "op": "eq", "value": "tr" }
// body: { "greeting": "Merhaba!" }

// Varsayılan
{ "type": "always" }
// body: { "greeting": "Hello!" }
```

**Çok kiracılı yönlendirme — header VE body match**:

```json
{
  "type": "and",
  "conditions": [
    { "type": "header", "name": "X-Tenant", "op": "eq", "value": "acme" },
    { "type": "jsonPath", "path": "$.user.role", "op": "eq", "value": "admin" }
  ]
}
```

## Template'leme

Yanıt gövdeleri ve header değerleri Handlebars + küçük bir dinamik-değer
katmanından geçer. Mevcut bağlamlar:

- `request.method`, `request.path`, `request.headers.<isim>`,
  `request.query.<isim>`, `request.params.<isim>`,
  `request.body.<alan…>`, `request.bodyText`
- Handlebars helper'ları: `{{#if}}`, `{{#each}}`, `{{lookup}}`, ek olarak
  yerleşik `eq`, `neq`, `upper`, `lower`, `default`, `json`
- Dinamik değerler: `{{$timestamp}}`, `{{$isoTimestamp}}`,
  `{{$randomUUID}}`, `{{$randomInt}}`, `{{$randomInt(1,100)}}`,
  `{{$randomEmail}}`, `{{$randomString}}`, `{{$randomString(16)}}`

Örnek body:

```json
{
  "id": "{{$randomUUID}}",
  "echoOf": "{{request.body.name}}",
  "createdAt": "{{$isoTimestamp}}",
  {{#if request.body.role}}"role": "{{request.body.role}}"{{else}}"role": "guest"{{/if}}
}
```

## Pre-response script

Her yanıt, template'lemeden **sonra** ama HTTP yanıtı gönderilmeden
**önce** Node `vm` sandbox'ında çalışan bir JavaScript snippet'i taşıyabilir.
State'i değiştirin, status / header / body'yi override edin veya özel bir
auth gate'i devreye sokun.

Sandbox **5 saniye timeout** uygular ve şunları açar:

| Bağlam | Ne |
|---------|-------|
| `request` | Donmuş istek anlık görüntüsü — `method`, `path`, `headers`, `query`, `params`, `body`, `bodyText` |
| `state` | Bu sunucuya özel mutable obje — istekler arasında yaşar, sunucu durdurulunca silinir |
| `response` | Seçilen yanıtla doldurulmuş mutable obje — `status`, `headers`, `body` |
| `console.log` / `info` / `warn` / `error` | İstek log entry'sine `x-mock-script-log` olarak yansır |
| `setStatus(n)` | Yanıt status'unu override et |
| `setHeader(name, value)` | Bir yanıt header'ı set et (lower-case) |
| `setJson(value)` | Body'yi `JSON.stringify(value)`'a set eder ve `Content-Type: application/json` zorlar |

Sandbox `require` yapamaz, `process`, dosya sistemi veya ağa erişemez. Her
script taze bir context'te çalışır.

Hazır şablon eklemek için Script alanının yanındaki **Insert example…**
dropdown'ını kullanın.

### Örnek: stateful CRUD

POST gövdelerini saklayan ve GET'te dönen tek endpoint:

```js
state.users ??= {}

if (request.method === 'POST') {
  const u = request.body
  if (!u || !u.id) {
    setStatus(400)
    setJson({ error: 'id required' })
  } else {
    state.users[u.id] = u
    setStatus(201)
    setJson(u)
  }
} else if (request.method === 'GET') {
  const id = request.params.id
  if (id) setJson(state.users[id] ?? { error: 'not found' })
  else setJson(Object.values(state.users))
} else if (request.method === 'DELETE') {
  delete state.users[request.params.id]
  setStatus(204)
}
```

Bu script'i `ANY` method ve `/users/:id?` path'iyle (veya iki ayrı endpoint:
GET `/users/:id` + POST `/users`) eşleştirin — çalışan bir CRUD stub
elde edersiniz.

### Örnek: her çağrıda artan sayaç

```js
state.calls = (state.calls ?? 0) + 1
setJson({ count: state.calls, ts: new Date().toISOString() })
```

### Örnek: rastgele başarısızlık (chaos testing)

```js
if (Math.random() < 0.2) {
  setStatus(500)
  setJson({ error: 'random_failure' })
} else {
  setJson({ ok: true })
}
```

Aynı etkiyi declarative olarak Settings'teki **Failure Injection**
panelinden de elde edebilirsiniz.

### Örnek: query string'den status

Bir istemci farklı HTTP kodlarına nasıl tepki veriyor diye stress test
yaparken faydalı:

```js
const code = Number(request.query.code)
if (Number.isFinite(code) && code >= 100 && code < 600) {
  setStatus(code)
  setJson({ requestedStatus: code })
} else {
  setJson({ ok: true, hint: 'Status\'ü değiştirmek için ?code=NNN ekleyin' })
}
```

### Örnek: round-robin sıralı yanıtlar

```js
const replies = [
  { status: 200, body: { ok: true, n: 1 } },
  { status: 200, body: { ok: true, n: 2 } },
  { status: 503, body: { error: 'try again' } },
]
state.idx = ((state.idx ?? -1) + 1) % replies.length
const r = replies[state.idx]
setStatus(r.status)
setJson(r.body)
```

## Auth, validation, hata enjeksiyonu, rate limit

Settings sekmesinde dört declarative panel vardır — bunlar script'ten
**önce** çalışır ve başarısız olduklarında yanıtı kısa devre keserler.

### Kimlik doğrulama

JSON config alanı. Dört tip destekler:

```json
// auth yok
{ "type": "none" }

// Bearer
{ "type": "bearer", "tokens": ["secret-1", "secret-2"] }

// Basic
{ "type": "basic", "users": [{ "username": "alice", "password": "wonderland" }] }

// API key (header veya query)
{ "type": "apiKey", "in": "header", "name": "X-API-Key", "keys": ["k1", "k2"] }
```

Her endpoint sunucu seviyesindeki auth'u, endpoint editörünün
**Auth Override** alanından override edebilir (boş bırakılırsa miras alır).

### JSON Schema body doğrulama

Endpoint başına JSON config. Aktifken request body draft-07 schema'sıyla
eşleşmeli; aksi halde sunucu Ajv hata detaylarıyla 400 döner:

```json
{
  "enabled": true,
  "schema": {
    "type": "object",
    "required": ["email"],
    "properties": {
      "email": { "type": "string", "format": "email" }
    }
  }
}
```

### Hata enjeksiyonu

Olasılıklı 5xx veya timeout simülasyonu:

```json
{
  "enabled": true,
  "probability": 30,
  "mode": "status",
  "status": 503,
  "timeoutMs": 30000
}
```

Modlar: `status` (`status` ile injection error body), `timeout`
(`timeoutMs` bekle, sonra 504), `random` (ikisinin arasında 50/50).

### Rate limit

IP başına veya global sliding-window:

```json
{
  "enabled": true,
  "requestsPerWindow": 100,
  "windowMs": 60000,
  "scope": "ip"
}
```

Limit aşıldığında sunucu `Retry-After` ile 429 döner.

## CORS

Açıkken `OPTIONS` preflight'ı otomatik yanıtlar. İzin verilen origin'ler,
method'lar, header'lar, credentials ve `Access-Control-Max-Age` Settings
sekmesinden ayarlanır.

## Özel modlar

### Echo

**Echo enabled** açıkken `/__echo` (her method) isteklerine isteğin JSON
dump'ıyla cevap verir — istemci davranışını debug etmek için faydalı:

```sh
curl -X POST 'http://127.0.0.1:3001/__echo' \
  -H 'Content-Type: application/json' -d '{"hello":"world"}'
# {
#   "method": "POST",
#   "path": "/__echo",
#   "headers": { "content-type": "application/json", ... },
#   "query": {},
#   "body": { "hello": "world" }
# }
```

### Proxy passthrough

**Proxy enabled** açıkken eşleşmeyen istekler **proxyTarget**'a yönlendirilir.
Upstream cevabı olduğu gibi döner. "Yeni endpoint'leri mock'la, geri kalanı
geç" senaryosu için uygundur.

### Recording

**Proxy record**'u açtığınızda her geçirilen upstream cevabı yeni bir mock
endpoint olarak persist edilir. Gerçek API'yi bir kez çağırın, kaydedin;
sonra proxy'yi kapatıp sonsuz tekrar oynatın — internete ihtiyaç yok.

## Mevcut spec'leri içe aktarma

Endpoints sekmesinde iki içe aktarma butonu vardır:

- **Import OpenAPI** — JSON veya YAML dosya seçin. Testnizer `$ref`'leri
  dereference eder ve `paths.<path>.<method>` başına bir endpoint oluşturur.
  Yanıt gövdeleri önce `examples`'tan, sonra `example`'dan, son olarak
  schema'dan üretilen örnekten gelir.
- **Import Postman** — Postman v2.x koleksiyon dosyası seçin. Folder'lar
  recursive yürünür. Her saved example response bir mock response olur.

Postman URL'lerindeki `{{var}}` placeholder'ları otomatik olarak `:var`
path param'lerine dönüştürülür.

## Canlı istek log'u

Logs sekmesi sunucunun işlediği her isteği gösterir (bellekteki son 500
kayıt). Bir satıra tıklayınca request header, request body, response header
ve response body görürsünüz. Üstteki butonlarla filtreleyin / yenileyin /
temizleyin.

Bir script throw ederse hata mesajı satırın `error` alanında çıkar.
`console.log` çıktıları yanıtın `x-mock-script-log` header'ına eklenir, bu
sayede inline görebilirsiniz.
