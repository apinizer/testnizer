---
title: Betikler ve test onayları
description: Ön istek betikleri, test betikleri, tam pm API'si, yerleşik require() kütüphaneleri, eski Postman arayüzü, Insomnia/Bruno takma adları ve Testnizer için yerleşik OAuth 2.0.
order: 4
section: Kılavuzlar
---

Testnizer, bir isteğin öncesinde ve sonrasında JavaScript çalıştırır ve paylaşılan
bir çalışma zamanına dayanan **eksiksiz, Postman uyumlu bir `pm` API'si** sunar.
Aynı çalışma zamanı **Insomnia** (`insomnia.*`), **Bruno** (`bru`/`req`/`res`) ve
**eski Postman** (`postman`, `responseBody`, `tests[...]`) arayüzlerini de besler —
böylece içe aktarılan betikler **değişiklik gerektirmeden** çalışır.

Her isteğin iki betik yuvası vardır:

- **Ön istek betiği** — istek gönderilmeden *önce* çalışır. Değer hesaplamak,
  değişken ayarlamak veya başlık eklemek için kullanın.
- **Testler** (yanıt sonrası) — yanıt geldikten *sonra* çalışır. Yanıt üzerinde
  onay yapmak ve bir sonraki istek için değer yakalamak için kullanın.

Klasörler ve proje de betik taşıyabilir — aşağıdaki
[Betik kademelenmesi](#betik-kademelenmesi) bölümüne bakın.

## Betik çalışma zamanı

Betikler bir JavaScript korumalı alanında (sandbox) çalışır. Bu globaller **hem
Send hem de Collection Runner'da** kullanılabilir (aynı şekilde davranırlar):

| Global | Nedir |
|---|---|
| `pm` | Ana API (aşağıdaki her şey). |
| `t` | `pm`'nin Testnizer markalı takma adı — `t.environment.set(...)` de çalışır. |
| `insomnia` | İki Insomnia'ya özgü farkla `pm`'nin takma adı — bkz. [Insomnia & Bruno](#insomnia--bruno). |
| `bru`, `req`, `res` | Bruno'nun getter tabanlı API'si — bkz. [Insomnia & Bruno](#insomnia--bruno). |
| `postman` | [Eski Postman arayüzü](#eski-postman-arayüzü) (`setEnvironmentVariable`, `setNextRequest`, …). |
| `pm.expect` / `expect` | Gerçek **Chai BDD** onay kütüphanesi — çıplak `expect(...)` globali de çalışır (Insomnia/Bruno tarzı). |
| `console` | `console.log/warn/error` — çıktı **Konsol** sekmesinde görünür. |
| `CryptoJS`, `_` | [crypto-js](https://github.com/brix/crypto-js) ve [Lodash](https://lodash.com) global olarak. |
| `atob`, `btoa` | Base64 çözme / kodlama. |

Betikler **async** olabilir — içlerinde `await` kullanabilirsiniz (örn.
`await pm.sendRequest(...)`). Testnizer, istek gönderilmeden (ön istek) veya
çalıştırma bitmeden (testler) önce tüm bekleyen işleri tamamlanmasını bekler.

### Yerleşik require() kütüphaneleri

`require()`, derlemeye dahil edilmiş seçilmiş bir kütüphane kümesiyle kullanılabilir
(rastgele npm veya Node yerleşik modül erişimi yoktur — bunlar Postman'in birlikte
sunduğu modüllerdir):

```js
const _          = require('lodash')             // yardımcı fonksiyonlar (ayrıca _ globali)
const moment     = require('moment')             // tarih ayrıştırma / biçimlendirme
const uuid       = require('uuid')               // uuid.v4(), …
const CryptoJS   = require('crypto-js')           // HMAC / SHA / AES / Base64 (ayrıca CryptoJS globali)
const cheerio    = require('cheerio')            // jQuery tarzı HTML/XML ayrıştırma
const Ajv        = require('ajv')                // JSON Şema doğrulama (draft-07+)
const tv4        = require('tv4')                // eski JSON Şema doğrulama
const xml2js     = require('xml2js')             // XML → JS nesnesi
const parse      = require('csv-parse/lib/sync') // senkron CSV ayrıştırma
const parseSync  = require('csv-parse/sync')      // aynısı, yeni giriş noktası
const sdk        = require('postman-collection') // Postman Collection SDK tipleri
const chai       = require('chai')               // Chai onay kütüphanesi
```

## pm API referansı

### pm kapsamları — environment / globals / collectionVariables / variables

Her kapsam aynı setter/getter yüzeyini sunar. `environment` aktif ortamdır,
`globals` proje genelindedir, `collectionVariables` proje ortamını paylaşır ve
`pm.variables` birleşik bir okuma görünümü artı **kalıcı olmayan**,
**isteğe-özel** bir geçici kapsamdır.

```js
pm.environment.get('baseUrl')          // → string | undefined
pm.environment.set('token', 'abc123')  // ayarlar (yeni ise değişkeni oluşturur)
pm.environment.has('token')            // → boolean
pm.environment.unset('token')          // birini siler
pm.environment.clear()                 // bu kapsamdaki tümünü siler
pm.environment.toObject()              // → { key: value, ... } anlık görüntü
pm.environment.replaceIn('{{baseUrl}}/v1')  // {{...}}'ı bu kapsama göre çözer
```

Aynı yöntemler `pm.globals`, `pm.collectionVariables` ve `pm.variables`'da da
bulunur:

```js
pm.globals.set('apiVersion', 'v2')
pm.collectionVariables.set('nextPageToken', body.nextPage)

const baseUrl = pm.variables.get('baseUrl')   // local → environment → global çözümlenir
pm.variables.set('tempSig', sig)              // yalnızca isteğe-özel, kalıcı değil
pm.variables.toObject()                       // birleşik anlık görüntü
```

**Ön istek** betiğinde yapılan yazmalar; istek URL'si, başlıkları ve gövdesinde
görünür. **Test** betiğinde yapılan yazmalar ilgili kapsama **kalıcı** olur
(Postman'in "Keep variable values" davranışı), böylece bir istekte yakalanan bir
token bir sonraki istekte kullanılabilir ve ortam düzenleyicisinde görünür.

### pm.iterationData (veriye dayalı çalıştırmalar)

Collection Runner bir CSV/JSON veri dosyası üzerinde yineleme yaptığında, her satır
burada sunulur:

```js
pm.iterationData.get('userId')   // geçerli satırın sütunu
pm.iterationData.has('userId')   // → boolean
pm.iterationData.toObject()      // → tam geçerli satır
```

### pm.info

```js
pm.info.eventName        // 'prerequest' | 'test'
pm.info.iteration        // geçerli yineleme indeksi (0 tabanlı)
pm.info.iterationCount   // toplam yineleme sayısı
pm.info.requestName      // isteğin adı
pm.info.requestId        // isteğin id'si
```

### pm.cookies

İstekle paylaşılan çerez kavanozu:

```js
pm.cookies.get('session')   // → değer | undefined
pm.cookies.has('session')   // → boolean
pm.cookies.toObject()       // → { name: value, ... }
```

### pm.request (yalnızca ön istek betiği)

```js
pm.request.method                  // 'GET', 'POST', …
pm.request.url.toString()          // tam URL dizesi
pm.request.body.raw                // ham gövde dizesi

// Giden isteğe başlık ekleyin / değiştirin
pm.request.headers.add({ key: 'X-Nonce', value: nonce })
pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer ' + token })
```

### pm.response (yalnızca test betiği)

Tam Postman/Newman yanıt yüzeyi:

```js
pm.response.code                   // 200, 404, … (SAYI)
pm.response.status                 // 'OK', 'Not Found', … (durum METNİ, sayı değil)
pm.response.reason()               // sebep ifadesi, örn. 'Not Found'
pm.response.responseTime           // ms (sayı)
pm.response.responseSize           // bayt (sayı)
pm.response.size()                 // → { body, header, total } bayt cinsinden

pm.response.text()                 // gövde dize olarak
pm.response.body                   // ham gövde dizesi
pm.response.json()                 // JSON olarak ayrıştırılmış gövde — geçersiz JSON'da HATA FIRLATIR (Postman uyumlu)
pm.response.json(reviver)          // opsiyonel JSON.parse reviver
pm.response.jsonp()                // JSONP sarmalayıcısını çıkarır, sonra ayrıştırır
pm.response.dataURI()              // gövde data: URI olarak

// Başlıklar — büyük/küçük harf duyarsız
pm.response.headers.get('Content-Type')
pm.response.headers.has('Content-Type')
pm.response.headers.all()          // → [{ key, value }, ...]
pm.response.headers.toObject()     // → { name: value, ... }

// Sunucunun ayarladığı çerezler (Set-Cookie), büyük/küçük harf duyarsız
pm.response.cookies.get('session')     // → değer | undefined
pm.response.cookies.has('session')     // → boolean
pm.response.cookies.toObject()         // → { name: value, ... }
```

:::caution[code vs status ve json() hata fırlatır]
Postman/Newman ile uyumludur: **`pm.response.code` sayısal durumdur (200)**,
**`pm.response.status` ise durum _metnidir_ (`'OK'`)**. Sayısal karşılaştırmayı her
zaman `code` ile yap (`pm.response.code === 200`), `status` ile değil.
`pm.response.body` ve `pm.response.text()` ham gövdeyi **dize** olarak döndürür.
`pm.response.json()`, JSON olmayan bir gövdede **hata fırlatır** (Postman uyumlu) —
gövde JSON olmayabilirse bir try/catch veya `pm.test` ile sar.
:::

### pm.test / pm.expect

`pm.expect` (ve çıplak `expect`) **gerçek [Chai BDD](https://www.chaijs.com/api/bdd/)
kütüphanesidir** — tam onay API'si Testnizer'a özgü hiçbir kısıtlama olmadan
kullanılabilir.

```js
pm.test('durum 200', function () {
  pm.response.to.have.status(200)
})

pm.test('kullanıcının id ve e-postası var', function () {
  const body = pm.response.json()
  pm.expect(body).to.have.property('id').that.is.a('number')
  pm.expect(body.email).to.match(/@/)
})
```

**Eksiksiz Chai BDD API'si** ([chaijs.com/api/bdd](https://www.chaijs.com/api/bdd/))
kullanılabilir; buna şunlar dahildir:

- **Dil zincirleri** (İngilizce gibi okunur, no-op): `to`, `be`, `been`, `is`,
  `that`, `which`, `and`, `has`, `have`, `with`, `at`, `of`, `same`, `but`.
- **Bayraklar**: `not`, `deep`, `nested`, `own`, `ordered`, `any`, `all`.
- **Matcher'lar**: `a` / `an`, `include` / `contain`, `ok`, `true`, `false`,
  `null`, `undefined`, `NaN`, `exist`, `empty`, `equal` / `eql`, `above` / `gt` /
  `least` / `gte`, `below` / `lt` / `most` / `lte`, `within`, `closeTo` /
  `approximately`, `instanceof`, `property` (+ `nested` / `own`),
  `ownPropertyDescriptor`, `lengthOf` / `length`, `match`, `string`, `keys`,
  `throw`, `respondTo`, `satisfy`, `members`, `oneOf`, `change` / `increase` /
  `decrease` / `by`, `extensible`, `sealed`, `frozen`, `finite`.
- Açıkça başarısız olmak için `expect.fail(...)`.

```js
pm.expect(value).to.equal(expected)
pm.expect(value).to.deep.equal({ key: 'val' })
pm.expect(value).to.include('substring')
pm.expect(value).to.be.closeTo(100, 5)
pm.expect(obj).to.have.nested.property('user.profile.id')
pm.expect(fn).to.throw(TypeError)
pm.expect([1, 2, 3]).to.have.members([3, 2, 1])
pm.expect(x).to.not.be.empty            // her matcher .not ile olumsuzlanır
```

### Yanıt onayları — pm.response.to.\*

Tam Postman yanıt onay kümesi; tümü `to.not.*` ile olumsuzlanabilir:

```js
// durum / başlıklar / gövde
pm.response.to.have.status(200)                  // koda göre
pm.response.to.have.status('OK')                 // sebep metnine göre
pm.response.to.have.statusCode(200)
pm.response.to.have.statusReason('OK')
pm.response.to.have.statusCodeClass(2)           // 2 → 2xx, 4 → 4xx, …
pm.response.to.have.header('Content-Type')
pm.response.to.have.header('Content-Type', 'application/json; charset=utf-8')
pm.response.to.have.body()                       // boş olmayan gövde
pm.response.to.have.body('exact text')
pm.response.to.have.body(/regex/)

// JSON gövde
pm.response.to.have.jsonBody()                   // gövde geçerli JSON
pm.response.to.have.jsonBody('id')               // yol mevcut
pm.response.to.have.jsonBody('id', 42)           // yol değere eşit
pm.response.to.have.jsonBody({ id: 42 })         // nesneye derin-eşittir

// şema, zaman, boyut
pm.response.to.have.jsonSchema(schema)
pm.response.to.have.responseTime.below(300)
pm.response.to.have.responseSize.below(50000)

// durum sınıfı yardımcıları
pm.response.to.be.info                           // 1xx
pm.response.to.be.success                        // 2xx
pm.response.to.be.redirection                    // 3xx
pm.response.to.be.clientError                    // 4xx
pm.response.to.be.serverError                    // 5xx
pm.response.to.be.error                          // 4xx veya 5xx

// adlandırılmış durum yardımcıları
pm.response.to.be.ok                             // 200
pm.response.to.be.accepted                       // 202
pm.response.to.be.withoutContent                 // 204
pm.response.to.be.badRequest                     // 400
pm.response.to.be.unauthorized                   // 401 (unauthorised da çalışır)
pm.response.to.be.forbidden                      // 403
pm.response.to.be.notFound                       // 404
pm.response.to.be.notAcceptable                  // 406
pm.response.to.be.rateLimited                    // 429
pm.response.to.be.withBody                       // gövdesi var
pm.response.to.be.json                           // gövde JSON

// herhangi birini olumsuzla
pm.response.to.not.be.error
pm.response.to.not.have.jsonBody('error')
```

### pm.sendRequest

Betik ortasında yardımcı bir HTTP isteği gönderin — token getirme, yoklama (polling)
veya kurulum için. Bir Promise döndürür (yani `await` edebilirsiniz) ve Node tarzı
geri çağrıyı da destekler. Host, devam etmeden önce tamamlanmasını bekler.

```js
// await biçimi
const res = await pm.sendRequest('https://api.example.com/health')
pm.expect(res.code).to.equal(200)

// tam istek nesnesi
const tokenRes = await pm.sendRequest({
  url: 'https://idp.example.com/oauth/token',
  method: 'POST',
  header: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: { mode: 'raw', raw: 'grant_type=client_credentials' },
})
pm.environment.set('accessToken', tokenRes.json().access_token)

// geri çağrı biçimi
pm.sendRequest('https://api.example.com/ping', function (err, res) {
  if (!err) console.log('pong', res.code)
})
```

Yanıt, `pm.response` ile aynı yüzeyi sunar — `.code`, `.status`, `.json()`,
`.text()`, `.headers.get(name)`, `.cookies.get(name)` vb.

### pm.execution

```js
pm.execution.skipRequest()                   // bu isteği atla (yalnızca ön istek betiği)
pm.execution.setNextRequest('İstek adı')     // adlandırılmış bir isteğe atla (runner)
pm.execution.setNextRequest(null)            // bu istekten sonra çalıştırmayı durdur
```

## Eski Postman arayüzü

Birçok eski Postman dışa aktarımı, `pm` öncesi **kullanımdan kaldırılmış** arayüzü
kullanır. Testnizer, uyumluluk için bunların tamamını destekler (yeni betikler için
`pm` API'sini tercih edin):

```js
// yanıt globalleri (yalnızca testler)
responseBody                 // ham gövde dizesi
responseCode                 // → { code, name, details }
responseHeaders              // → { name: value, ... }
responseTime                 // ms

// eski test sonuçları — ad → boolean nesnesi
tests['durum 200'] = responseCode.code === 200

// postman.* yardımcıları
postman.setEnvironmentVariable('token', 'abc')
postman.getEnvironmentVariable('token')
postman.clearEnvironmentVariable('token')
postman.setGlobalVariable('apiVersion', 'v2')
postman.getGlobalVariable('apiVersion')
postman.clearGlobalVariable('apiVersion')
postman.setNextRequest('Sonraki istek')

// yardımcılar + kapsam nesneleri
const obj = xml2Json('<a><b>1</b></a>')   // XML'i JS nesnesine ayrıştır
environment['token']                       // environment nesnesini oku/yaz
globals['apiVersion']                      // globals'ı oku/yaz
data['userId']                             // geçerli yineleme veri satırı
```

## Insomnia & Bruno

**Insomnia** ve **Bruno**'dan dışa aktarılan betikler değişiklik gerektirmeden
çalışır. Globalleri aynı çalışma zamanına bağlanmıştır.

### insomnia.\*

`insomnia`, **iki farkla** `pm`'nin takma adıdır:

- **`insomnia.response.status` SAYISAL durum kodudur** (örn. `200`), sebep metni
  değil — `pm.response.status`'un tersi.
- **`insomnia.baseEnvironment` ve `insomnia.collectionVariables`**, Postman
  **koleksiyon** değişkenlerine eşlenir.

```js
insomnia.environment.set('token', 'abc')
insomnia.baseEnvironment.get('apiKey')        // → koleksiyon değişkeni
if (insomnia.response.status === 200) { … }   // sayısal kod
```

### bru / req / res

Bruno'nun API'si `pm` takma adı değil, **getter tabanlıdır**:

```js
// bru — değişkenler + akış
bru.getEnvVar('baseUrl')
bru.setEnvVar('token', 'abc')
bru.getVar('temp')                  // isteğe-kapsamlı değişken
bru.setVar('temp', 1)
bru.getCollectionVar('apiVersion')
bru.setNextRequest('Sonraki istek')
await bru.sendRequest({ url, method })
bru.interpolate('{{baseUrl}}/v1')   // {{...}}'ı çöz

// req — giden istek (ön istek)
req.getUrl()
req.getMethod()
req.getHeaders()
req.getHeader('Authorization')

// res — yanıt (testler)
res.getStatus()        // sayısal kod
res.getStatusText()    // sebep metni
res.getBody()          // ayrıştırılmış gövde
res.getHeader('Content-Type')
res.getResponseTime()
res.getSize()
res.status             // getStatus() özellik biçimi
res.body               // getBody() özellik biçimi
```

## Betik kademelenmesi

Betikler yalnızca bir istek üzerinde yaşamaz. Hiyerarşi boyunca yukarıdan aşağıya
çalışırlar:

```
proje → dış klasör → iç klasör → istek
```

- **Ön istek** betikleri her istekten önce bu sırayla çalışır.
- **Test** betikleri her yanıttan sonra bu sırayla çalışır.

Bunları şuralarda yapılandırın:

- **Proje Ayarları → Betikler** (proje düzeyi) ve
- **bir klasöre sağ tıklayın → Ayarlar → Betikler** (klasör düzeyi).

Bu, kesişen kurulumlar için idealdir — örn. bir kez token yenileyen ve altındaki her
istek tarafından miras alınan bir proje ön istek betiği. Kademelenme hem **Send**
hem de **Run** için geçerlidir.

## Auth (kimlik) mirası

Bir isteğin **Auth** sekmesinde **Inherit from parent** (üstten miras al) seçeneği
vardır (yeni istekler için varsayılan). Etkin kimlik, en yakın kazanır mantığıyla
çözülür:

```
istek → en yakın klasör → proje
```

Bir klasöre (sağ tıklayın → **Ayarlar → Authorization**) veya **Proje Ayarları →
Authorization**'a bir kez `Bearer {{accessToken}}` (veya herhangi bir kimlik)
ayarlayın, istekleri **Inherit** üzerinde bırakın ve hepsi bunu alır. Bir istek veya
klasördeki açık bir **No Auth** mirası durdurur.

## Betiksiz OAuth 2.0

Yaygın "token getir, sonra API'yi çağır" akışı için genellikle **hiç betiğe ihtiyaç
duymazsınız**. **Auth** sekmesinde **OAuth 2.0**'ı seçin, **Client Credentials**
(veya **Password**) grant'ını seçin ve token URL'si, client id/secret ve scope'u
doldurun. Testnizer, istekten önce token'ı otomatik olarak getirir ve süresi
dolmaya yaklaşana kadar **önbelleğe alır** — gerektiğinde yeniden getirir.

Bunu [auth mirası](#auth-kimlik-mirası) ile birleştirin: OAuth 2.0'ı klasöre/projeye
bir kez ayarlayın, istekleri **Inherit** üzerinde bırakın ve her istek sıfır
betikle taze bir token alır. Bir token'ı önceden getirip incelemek için Auth
sekmesindeki **Get New Access Token**'ı kullanın.

> Tarayıcı yönlendirmeli grant'lar (Authorization Code, Implicit) henüz otomatik
> değildir — bir token yapıştırın veya tam otomatik token'lar için Client
> Credentials / Password kullanın.

## Tarifler

### HMAC imzası (ön istek) — CryptoJS ile

```js
const secret = pm.environment.get('signingSecret')
const ts     = String(Date.now())
const body   = pm.request.body.raw || ''
const sig    = CryptoJS.HmacSHA256(ts + '\n' + body, secret).toString()

pm.request.headers.upsert({ key: 'X-Timestamp', value: ts })
pm.request.headers.upsert({ key: 'X-Signature', value: 'sha256=' + sig })
```

### Yanıttan token yakalama (testler)

```js
const json = pm.response.json()
pm.environment.set('accessToken', json.access_token)
pm.test('token yakalandı', function () {
  pm.expect(json.access_token).to.be.a('string').and.not.empty
})
// Sonraki istekler {{accessToken}} kullanır — ya da yalnızca OAuth 2.0 kimliğini (yukarıda) kullanın.
```

### Gövdeyi bir JSON Şemasına göre doğrulama

```js
const Ajv = require('ajv')
const schema = {
  type: 'object',
  required: ['id', 'email'],
  properties: { id: { type: 'number' }, email: { type: 'string' } },
}
pm.test('şemaya uyuyor', function () {
  pm.response.to.have.jsonSchema(schema)        // veya: new Ajv().validate(schema, body)
})
```

### Sunucunun ayarladığı bir çerezi okuma

```js
const session = pm.response.cookies.get('session')
pm.environment.set('sessionId', session)
```

### Bir XML yanıtını ayrıştırma

```js
const xml2js = require('xml2js')
xml2js.parseString(pm.response.text(), (err, data) => {
  pm.test('sipariş id mevcut', function () {
    pm.expect(data.Order.Id[0]).to.be.a('string')
  })
})
```

### 429'da yeniden deneme / tekrar (runner)

```js
if (pm.response.code === 429) {
  pm.execution.setNextRequest(pm.info.requestName) // bu isteği tekrarla
}
```

### CryptoJS ile Base64 / SHA

```js
const b64  = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse('user:pass'))
const hash = CryptoJS.SHA256('payload').toString()
// ya da atob / btoa globalleri: btoa('user:pass'), atob(b64)
```

## Betik hataları

Bir betik hata fırlatırsa, o betik iptal edilir ve hata **Konsol** sekmesinde
gösterilir. Hatadan önce çalışan test senaryoları yine de kaydedilir. `pm.response.json()`
JSON olmayan bir gövdede hata fırlattığından, yanıt JSON olmayabilirse onu try/catch
veya bir `pm.test` ile koru.
