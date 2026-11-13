---
title: HTTP mock sunucu
description: Testnizer'da yapılandırdığınız gerçek bir HTTP sunucusu; uç noktalar, koşullu yanıtlar, şablonlama, betikler, kimlik doğrulama, hata enjeksiyonu, hız limiti, CORS, kayıt yapan proxy ve OpenAPI / Postman içe aktarma.
order: 2
section: Mock sunucular
---

HTTP mock sunucu, REST tarzı isteklere sizin tanımladığınız yanıtlarla cevap verir.
Mock sunucunun ne olduğu ve nasıl oluşturulup başlatıldığı ve açıldığı için
[genel bakışa](/tr/docs/mock-server) bakın. Bu sayfa HTTP türünü anlatır: uç
noktalar, yanıtlar, şablonlama, betikler ve her yanıtı etkileyen ayarlar.

Yeni sunucu penceresi bir HTTP mock için şu başlangıç noktalarını sunar:

| Şablon | Ne oluşturur |
|---|---|
| **Boş** | Uç nokta yok |
| **REST örneği** | `GET/POST /users`, `GET/DELETE /users/:id`; 1-3 numaralı id'ler vardır, başka id 404 alır |
| **Echo** | `ANY /echo`, aldığı yöntemi, yolu, sorguyu, header'ları ve gövdeyi geri döndürür |
| **Kimlik doğrulama gerekli** | Üretilmiş bir bearer token ister (sunucu ayarlarında görünür), yoksa HTTP 401; `GET /public` açık kalır |
| **Hatalar** | `GET /slow` 1500 ms sonra yanıt verir; hata enjeksiyonu isteklerin yaklaşık üçte birini HTTP 500 ile düşürür |
| **Dosyadan içe aktar** | Uç noktaları bir OpenAPI ya da Postman dosyasından kurar ([Mevcut belirtimleri içe aktarma](#mevcut-belirtimleri-içe-aktarma) bölümüne bakın) |

Editörün üç sekmesi vardır: **Uç noktalar**, **Ayarlar** ve **Loglar**.

## Uç noktalar

Uç noktalar sekmesi solda bir liste, sağda bir editör olarak ikiye ayrılır.

### Yöntem ve yol

Yol eşleştirmenin dört modu vardır:

| Mod | Desen | Örnek | Eşleşir |
|------|---------|---------|---------|
| `exact` | birebir | `/users` | yalnızca `/users` |
| `param` | `:isim` yer tutucuları | `/users/:id` | `/users/42` (id = "42") |
| `wildcard` | `*` (tek segment), `**` (her şey) | `/api/*`, `/api/**` | bir segment / her derinlik |
| `regex` | adlandırılmış gruplu RegExp | `^/v(?<v>\d+)/users$` | `/v3/users` (v = "3") |

HTTP yöntemi herhangi bir standart fiil (`HEAD`, `OPTIONS` ve `QUERY` dahil) ya da
her yöntemle eşleşen `ANY` olabilir.

Birden fazla uç nokta eşleşebiliyorsa Testnizer **önceliği** yüksek olanı seçer,
eşitlikte özgüllüğe bakar: `exact` > `param` > `regex` > `wildcard`. Hiçbir uç noktayla
eşleşmeyen istek `404` alır (aşağıdaki echo ya da proxy modu devralmazsa). Etkin
yanıtı olmayan bir uç nokta `501` döndürür.

Yol alanının altındaki çubuk tam URL'yi gösterir. Buradan şunları yapabilirsiniz:

- `http://host:port/basePath/path` URL'sini **Kopyala**
- Çalışan bir `curl` komutu için **cURL olarak kopyala** (POST/PUT/PATCH için yer
  tutucu `Content-Type` ve gövde ile)
- Uç noktayı gönderip kaydedebileceğiniz, her yöntemi seçilebilen sıradan bir HTTP
  isteği olarak açmak için **İstek sekmesinde aç**. `exact` ve `param` yolları
  açılır; `:param` yolunda sekme, doldurmanız için yol değişkeni satırlarıyla açılır
  ve göndermez. Wildcard ve regex yollarının tek bir URL'si yoktur; düğme nedeniyle
  birlikte devre dışı kalır. Sunucu durmuşsa düğme önce onu başlatır (**Başlat ve
  istek sekmesinde aç**).

Ayarlar'daki **Temel yol**, sunucunun tüm uç noktalarına eklenen bir önektir.

## Yanıtlar ve koşullar

Her uç noktanın birçok yanıtı olabilir. Bir istek geldiğinde Testnizer yanıt
listesinde sırayla ilerler ve **koşulu eşleşen ilk yanıtı** seçer. Hiçbiri
eşleşmezse yedek olarak ilk etkin yanıt kullanılır.

Yanıtın bir adı, bir durum kodu, isteğe bağlı bir **Gecikme (ms)** değeri, header'ları,
bir gövdesi ve bir gövde türü vardır (HTTP sunucusunda JSON, XML, Text ya da HTML;
iki akış türü için [SSE](/tr/docs/mock-server/sse) ve [AI](/tr/docs/mock-server/ai) sayfalarına bakın).

Koşullar, `type` ayırıcısı olan JSON nesneleridir. Hazır bir şablon eklemek için
Koşul alanının yanındaki **Örnek ekle...** açılır listesini kullanın.

| Tür | Ne zaman kullanılır | Örnek |
|------|-------------|---------|
| `always` | bu, her şeyi yakalayan/varsayılan yanıt | `{"type":"always"}` |
| `header` | bir istek header'ı belirli değere sahip | `{"type":"header","name":"X-Tenant","op":"eq","value":"acme"}` |
| `query` | bir sorgu parametresi eşleşir | `{"type":"query","name":"locale","op":"eq","value":"tr"}` |
| `pathParam` | bir `:isim` segmenti eşleşir | `{"type":"pathParam","name":"id","op":"eq","value":"42"}` |
| `jsonPath` | JSON istek gövdesindeki bir değer eşleşir | `{"type":"jsonPath","path":"$.user.role","op":"eq","value":"admin"}` |
| `xpath` | XML gövdede bir XPath ifadesi eşleşir | `{"type":"xpath","expression":"//Order/Status/text()","op":"eq","value":"PAID"}` |
| `method` | HTTP fiiline göre süz (`ANY` ile işe yarar) | `{"type":"method","method":"POST"}` |
| `and` / `or` | koşulları birleştir | `{"type":"and","conditions":[...]}` |

Operatörler: `eq` (metin eşitliği), `neq`, `contains` (alt metin), `regex`
(JavaScript RegExp), `exists` (yol çözülür / değer var).

### Örnekler

**Admin'lere 200, diğerlerine 403** - aynı uç noktada iki yanıt:

```json
// 1. Yanıt - koşul
{
  "type": "jsonPath",
  "path": "$.role",
  "op": "eq",
  "value": "admin"
}
// 1. Yanıt - gövde
{ "allowed": true }
// status: 200

// 2. Yanıt - koşul
{ "type": "always" }
// 2. Yanıt - gövde
{ "error": "forbidden" }
// status: 403
```

**`?locale=tr` geldiğinde Türkçe içerik dön**:

```json
// İlk yanıt - koşul
{ "type": "query", "name": "locale", "op": "eq", "value": "tr" }
// gövde: { "greeting": "Merhaba!" }

// Varsayılan
{ "type": "always" }
// gövde: { "greeting": "Hello!" }
```

**Çok kiracılı yönlendirme - header VE gövde eşleşmesi**:

```json
{
  "type": "and",
  "conditions": [
    { "type": "header", "name": "X-Tenant", "op": "eq", "value": "acme" },
    { "type": "jsonPath", "path": "$.user.role", "op": "eq", "value": "admin" }
  ]
}
```

## Şablonlama

Yanıt gövdeleri ve header değerleri, Handlebars ve isteklerde kullanılan aynı dinamik
değişkenlerden geçirilir. Kullanılabilir bağlamlar:

- `request.method`, `request.path`, `request.headers.<ad>` (büyük/küçük harf
  duyarsız), `request.query.<ad>`, `request.params.<ad>`, `request.body.<alan...>`,
  `request.bodyText`
- Handlebars yardımcıları: `{{#if}}`, `{{#each}}`, `{{lookup}}` ve hazır `eq`,
  `neq`, `upper`, `lower`, `default`, `json`
- Dinamik değerler: `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomUUID}}`,
  `{{$randomInt}}`, `{{$randomInt(1,100)}}`, `{{$randomEmail}}`,
  `{{$randomString}}`, `{{$randomString(16)}}` ve diğer Postman dinamik
  değişkenleri. Bilinmeyen bir `{{$ad}}` yazıldığı gibi kalır.
- Proje değişkenleri: `{{ad}}`; projenin Globals'ından ve etkin ortamdan, her istek
  için okunur. **Secret** bir değişken `{{ad}}` metni olarak kalır; bu yüzden mock'a
  istek yapan biri onu okuyamaz.
- AI yanıtları için `{{lastUserMessage}}`, `{{lastToolResult}}` ve `{{model}}`
  ([AI mock sunucu](/tr/docs/mock-server/ai) sayfasına bakın).

`{{` karakterlerini metin olarak yazdırmak için önüne ters eğik çizgi koyun.

Örnek gövde:

```json
{
  "id": "{{$randomUUID}}",
  "echoOf": "{{request.body.name}}",
  "createdAt": "{{$isoTimestamp}}",
  {{#if request.body.role}}"role": "{{request.body.role}}"{{else}}"role": "guest"{{/if}}
}
```

## Yanıt öncesi betik

Her yanıt, şablonlamadan **sonra** ama HTTP yanıtı gönderilmeden **önce** çalışan bir
JavaScript parçası taşıyabilir. Durumu değiştirmek, durum kodunu / header'ları /
gövdeyi ezmek ya da erişimi özel mantıkla kapatmak için kullanın.

Betik, **5 saniyelik zaman aşımı** olan yeni bir Node `vm` bağlamında şu
bağlamalarla çalışır:

| Bağlama | Nedir |
|---------|------------|
| `request` | İsteğin dondurulmuş görüntüsü: `method`, `path`, `headers`, `query`, `params`, `body`, `bodyText` |
| `state` | Bu sunucuya ait değiştirilebilir nesne; istekler arasında yaşar |
| `response` | Seçilen yanıtla önceden doldurulmuş değiştirilebilir nesne: `status`, `headers`, `body` |
| `console.log` / `info` / `warn` / `error` | İsteğin günlük kaydına yakalanır ve `x-mock-script-log` yanıt header'ı olarak gönderilir |
| `setStatus(n)` | Yanıt durum kodunu ez |
| `setHeader(name, value)` | Bir yanıt header'ı ayarla (küçük harfe çevrilir) |
| `setJson(value)` | Gövdeyi `JSON.stringify(value)` yap ve `Content-Type: application/json` zorla |

`require`, `process`, dosya sistemi ve ağ betiğe sunulmaz. Bu bir kolaylıktır, güvenlik
sınırı değildir: Node `vm` bağlamı kasıtlı olarak kötü niyetli kodu durdurmaz; yalnızca
güvendiğiniz betikleri çalıştırın.

Bir betik hata fırlatır ve kendi durum kodunu ayarlamamışsa yanıt, hata mesajıyla
birlikte `500` olur ve günlük satırı hatayı gösterir.

Dışarıdan gelen bir projenin betikleri (Git'ten klonlanan, proje dosyasından açılan ya
da koleksiyon içe aktarmasıyla betik eklenen) bu bilgisayarda o proje için betiklere
izin verene kadar çalışmaz. O zamana kadar yanıt bunu söyleyen bir `500` olur.
[Betikler](/tr/docs/scripts) sayfasına bakın.

Çalışan bir şablon eklemek için Betik alanının yanındaki **Örnek ekle...** açılır
listesini kullanın.

### Örnek: durum tutan CRUD

Gelen POST gövdelerini saklayan ve GET'te geri döndüren tek uç nokta:

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

Çalışan bir CRUD taslağı için bunu `ANY` yöntemi ve `/users/:id?` yoluyla (ya da iki
uç noktayla, GET `/users/:id` ve POST `/users`) eşleştirin.

### Örnek: her çağrıda artan sayaç

```js
state.calls = (state.calls ?? 0) + 1
setJson({ count: state.calls, ts: new Date().toISOString() })
```

### Örnek: rastgele hata (kaos testi)

```js
if (Math.random() < 0.2) {
  setStatus(500)
  setJson({ error: 'random_failure' })
} else {
  setJson({ ok: true })
}
```

Aynı etki için kod yazmadan Ayarlar'daki **Hata Enjeksiyonu** panelini de
kullanabilirsiniz.

### Örnek: sorgu dizesinden durum kodu

Bir istemcinin keyfi HTTP kodlarına nasıl tepki verdiğini zorlamak için işe yarar:

```js
const code = Number(request.query.code)
if (Number.isFinite(code) && code >= 100 && code < 600) {
  setStatus(code)
  setJson({ requestedStatus: code })
} else {
  setJson({ ok: true, hint: 'Add ?code=NNN to override status' })
}
```

### Örnek: sırayla dönen yanıtlar

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

## Kimlik doğrulama, doğrulama, hata, hız limiti

Ayarlar sekmesi sunucu çapındaki denetimleri taşır. Her istek için şu sırayla
çalışırlar ve başarısız olan bir denetim, herhangi bir betikten önce, uç noktanın
yanıtı yerine cevap verir: CORS preflight, hız limiti, uç nokta eşleşmesi, kimlik
doğrulama, JSON Schema doğrulaması, hata enjeksiyonu.

### Kimlik doğrulama

JSON yapılandırma alanı. Dört türü destekler:

```json
// kimlik doğrulama yok
{ "type": "none" }

// Bearer
{ "type": "bearer", "tokens": ["secret-1", "secret-2"] }

// Basic
{ "type": "basic", "users": [{ "username": "alice", "password": "wonderland" }] }

// API anahtarı (header ya da sorgu)
{ "type": "apiKey", "in": "header", "name": "X-API-Key", "keys": ["k1", "k2"] }
```

Başarısız denetim, bir `WWW-Authenticate` başlığıyla `401` döndürür. Token'ı, parolası
ya da anahtarı boş olan kayıt asla eşleşmez; bu yüzden secret'ları boş olan bir mock
(örneğin pull'dan sonra, çünkü secret'lar dosyalara yazılmaz) siz onları yeniden
girene kadar istekleri reddeder.

Her uç nokta, uç nokta editöründeki **Yetkilendirmeyi geçersiz kıl** alanıyla
sunucu düzeyindeki kimlik doğrulamayı ezebilir (miras almak için boş bırakın). Geçersiz
kılma ve aşağıdaki JSON Schema doğrulaması, varsayılan olarak kapalı olan **İstek
denetimleri** altında yer alır.

### JSON Schema gövde doğrulaması

Uç nokta başına JSON yapılandırması. Etkinleştirildiğinde istek gövdesi draft-07
şemasına uymalıdır; uymazsa sunucu doğrulama hatası ayrıntılarıyla 400 döndürür:

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

Olasılıksal 5xx ya da zaman aşımı simülasyonu:

```json
{
  "enabled": true,
  "probability": 30,
  "mode": "status",
  "status": 503,
  "timeoutMs": 30000
}
```

Modlar: `status` (`status` değerini, varsayılan 500, enjekte edilmiş bir hata
gövdesiyle döndürür), `timeout` (`timeoutMs` kadar bekler, varsayılan 30000, sonra
504 döndürür), `random` (ikisi arasında yarı yarıya). `probability` 0 ile 100
arasındadır.

### Hız limiti

İstemci adresi başına ya da tüm sunucu için sabit pencere:

```json
{
  "enabled": true,
  "requestsPerWindow": 100,
  "windowMs": 60000,
  "scope": "ip"
}
```

`scope` değeri `ip` ya da `global` olur. Limit aşıldığında sunucu `Retry-After`
header'ıyla 429 döndürür.

## CORS

Etkinleştirildiğinde sunucu `OPTIONS` preflight isteklerini kendisi yanıtlar ve
yanıtlarına CORS header'larını ekler. İzin verilen origin'leri, yöntemleri,
header'ları, kimlik bilgilerini ve `Access-Control-Max-Age` değerini Ayarlar
sekmesinden yapılandırın.

## Özel modlar

### Echo

**/__echo uç noktasını aç** etkinken `/__echo` adresine gelen istekler (her yöntem),
isteğin JSON dökümüyle cevaplanır; istemci davranışını ayıklarken işe yarar:

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

### Proxy ile geçirme

**Eşleşmeyen istekleri hedef sunucuya proxy'le** açıkken ve bir istek hiçbir uç
noktayla eşleşmiyorsa, istek **Proxy hedef URL'sine** iletilir ve upstream yanıtı
değiştirilmeden döndürülür. "Yeni uç noktaları mock'la, gerisini geçir" için
kullanın. Ulaşılamayan bir upstream `502` döndürür.

### Kayıt

**Proxy'lenen yanıtları yeni uç nokta olarak kaydet** (proxy açıkken), geçirilen her
yanıtı yeni bir mock uç noktası olarak kaydeder. Gerçek API'nizi bir kez çağırıp
kaydedin, sonra proxy'yi kapatın ve ağ olmadan tekrar oynatın.

## Mevcut belirtimleri içe aktarma

Var olan bir tanımdan uç nokta oluşturmanın üç yolu vardır.

**Sunucuyu oluştururken:** Yeni mock sunucu penceresinde **Dosyadan içe aktar**'ı
seçin. OpenAPI 3.x ya da Swagger 2.0 belirtimini, veya JSON ya da YAML biçiminde bir
Postman v1, v2.x ya da v3 koleksiyonunu kabul eder (en fazla 50 MB). Dosya önce
denetlenir: biçim tanınır, içeriğini görürsünüz ve belirtim olmayan ya da mock'lanacak
bir şey içermeyen dosya sunucu oluşmadan reddedilir.

**Var olan bir HTTP sunucusunun Uç noktalar sekmesinde:**

- **OpenAPI içe aktar** bir JSON ya da YAML dosyası alır. Testnizer dahili
  `$ref`'leri çözer ve her `paths.<yol>.<yöntem>` için bir uç nokta oluşturur. Yanıt
  gövdeleri önce `examples`'tan, sonra `example`'dan, sonra `allOf`, `oneOf` ve
  `anyOf` dahil şemadan üretilen bir örnekten gelir. Swagger 2.0 yanıtları gövdelerini
  korur ve kendine başvuran bir şema artık içe aktarmayı durdurmaz. Belirtimdeki bir
  `$ref` yerel bir dosyayı okuyamaz ya da bir URL'yi çağıramaz.
- **Postman içe aktar** JSON ya da YAML biçiminde bir Postman v1, v2.x veya v3
  koleksiyonu alır. Klasörler özyinelemeli gezilir. Kayıtlı her örnek yanıt bir mock
  yanıtı olur.

Uç nokta belirtimin sunucu yolunu da bağlar: sunucu `https://api.example.com/v1`
iken `/pets`, `http://127.0.0.1:<port>/v1/pets` adresinde yanıt verir; istemci yalnızca
host'u değiştirir. Mock'un kendi temel yolu varsa o kısım tekrarlanmaz. Eski bir
sürümle içe aktarılan uç noktalar yollarını korur.

Postman URL'lerindeki `{{var}}` yer tutucuları `:var` yol parametrelerine dönüşür.
URL'nin başındaki `{{baseUrl}}` dışarıda bırakılır, çünkü değeri bir ortama aittir.

İçe aktarmanın dışarıda bırakmak zorunda kaldığı her şey, onu bitiren mesajda
listelenir.

**Kayıtlı isteklerden:** APIs panelindeki **Bu klasörden / projeden / istekten Mock
Sunucu oluştur**, aynı şekilde kayıtlı isteklerden bir mock kurar; [genel bakışa](/tr/docs/mock-server) bakın.

## JWKS yayınlama

Bir mock uç noktası, yerel bir yayıncıya karşı token doğrulamasını denemeniz için
bir JSON Web Key Set sunabilir. Uç noktalar listesindeki **JWKS yayınla** bir anahtarı
iyi bilinen yolda yayınlar: tek yanıtlı sıradan bir `GET` uç noktası oluşturur. JSON
bir yanıt gövdesinde **Security / keystore'dan doldur**, Security araçlarındaki ya da
keystore'unuzdaki bir anahtardan JWKS üretir ve gövdeye yazar. Yalnızca genel
anahtarlar yayınlanır; özel üyeler asla dahil edilmez. Gövdeyi bir
`GET /.well-known/jwks.json` uç noktasından sunun ve bir rotasyon anahtarı eklemek
için yeniden seçin. Düğme yalnızca HTTP sunucularında sunulur. [JWK ve JWKS](/tr/docs/jwk-jwks) sayfasına bakın.

## Canlı istek günlüğü

**Loglar** sekmesi sunucunun işlediği son 500 isteği gösterir. İstek header'larını ve
gövdesini, yanıt header'larını ve gövdesini görmek için bir satıra tıklayın. Üstteki
**Yenile** ve **Temizle** düğmelerini kullanın.

Bir betik hata fırlattığında hata mesajı satırın `error` alanında görünür.
`console.log` ve benzerlerinin çıktısı yanıtın `x-mock-script-log` header'ına eklenir;
böylece gövdenin yanında görebilirsiniz.
