---
title: Betikler ve test onayları
description: Ön istek betikleri, test betikleri ve Testnizer için tam pm API referansı.
order: 4
section: Kılavuzlar
---

Testnizer betikleri sandboxlanmış bir iframe'de değil, Node ana sürecinde çalıştırır.
Bu, `require()`'ın çalıştığı anlamına gelir — geçici çözümler olmadan kripto, path
veya uygulamaya yüklü herhangi bir paketi içe aktarabilirsiniz.

Betikler HTTP isteklerine (ve koleksiyon klasörlerine) eklenir. Her isteğin iki
betik yuvası vardır:

- **Ön istek betiği** — istek gönderilmeden önce çalışır
- **Testler** — yanıt geldikten sonra çalışır

## pm API referansı

### pm.environment

Aktif ortamdaki değişkenleri okuyun ve yazın.

```js
pm.environment.get('baseUrl')            // → string | undefined
pm.environment.set('token', 'abc123')   // değişkeni ayarlar (veya oluşturur)
pm.environment.unset('token')           // değişkeni siler
pm.environment.has('token')             // → boolean
pm.environment.toObject()               // → { key: value, ... } anlık görüntü
```

Ön istek betiğinde yapılan değişiklikler, istek URL'si, başlıkları ve gövdesinde
görünür olur. Test betiğinde yapılan değişiklikler, bir koleksiyon çalıştırıcısı
dizisindeki bir sonraki isteğe kadar kalıcı olur.

### pm.collectionVariables

`pm.environment` ile aynı API, ancak ortam yerine koleksiyona (projeye) kapsamlıdır.
Paylaşılan ortamı kirletmeden istekler arasında veri aktarmak için kullanışlıdır.

```js
pm.collectionVariables.set('nextPageToken', body.nextPage)
```

### pm.variables

Tüm değişken kapsamlarının salt okunur birleşik görünümü (koleksiyon → ortam →
global). Hangi kapsamdan geldiğinden bağımsız olarak çözümlenmiş değeri
istediğinizde bunu kullanın:

```js
const baseUrl = pm.variables.get('baseUrl')
```

Yalnızca geçerli istek yürütmesi için görünür olan geçici bir "yerel" kapsama da
yazabilirsiniz (kalıcı değil):

```js
pm.variables.set('tempSig', computeSignature())
```

### pm.request (yalnızca ön istek betiği)

Giden isteği gönderilmeden önce inceleyin ve değiştirin.

```js
pm.request.url.toString()          // tam URL dizesi
pm.request.method                  // 'GET', 'POST', …
pm.request.body.raw                // ham gövde dizesi

// Başlık ekleyin veya güncelleyin
pm.request.headers.add({ key: 'X-Nonce', value: nonce })
pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer ' + token })

// URL'yi güncelleyin
pm.request.url = 'https://example.com/v2/users'
```

### pm.response (yalnızca test betiği)

```js
pm.response.status          // 'OK', 'Not Found', …
pm.response.code            // 200, 404, …
pm.response.responseTime    // ms (sayı)
pm.response.text()          // yanıt gövdesi dize olarak
pm.response.json()          // JSON olarak ayrıştırılmış yanıt gövdesi
pm.response.headers.get('Content-Type')
pm.response.cookies.get('session')
```

### pm.test

Adlandırılmış bir test senaryosu tanımlayın. Geri çağrı hemen çalışır; geçti veya
başarısız Testler panelinde kaydedilir.

```js
pm.test('durum 200', function () {
  pm.response.to.have.status(200)
})
```

Betik başına birden fazla `pm.test` çağrısı uygundur — her biri bağımsız bir
geçti/başarısız satırı üretir.

### pm.expect

Chai tarzı onay. Daha temiz başarısızlık mesajları için `pm.test` geri çağrılarının
içinde kullanın:

```js
pm.test('kullanıcının id ve e-postası var', function () {
  const body = pm.response.json()
  pm.expect(body).to.be.an('object')
  pm.expect(body).to.have.property('id').that.is.a('number')
  pm.expect(body.email).to.match(/@/)
})
```

Yaygın onaylar:

```js
pm.expect(value).to.equal(expected)
pm.expect(value).to.deep.equal({ key: 'val' })
pm.expect(value).to.include('substring')
pm.expect(value).to.be.above(0)
pm.expect(value).to.be.a('string')
pm.expect(arr).to.have.lengthOf(3)
pm.expect(obj).to.have.property('name')
pm.expect(str).to.match(/regex/)
```

### pm.response.to.have (kısayol onaylar)

```js
pm.response.to.have.status(200)
pm.response.to.have.status('OK')
pm.response.to.have.header('Content-Type')
pm.response.to.have.header('Content-Type', 'application/json; charset=utf-8')
pm.response.to.have.jsonBody()
pm.response.to.have.jsonBody('id')               // özellik var
pm.response.to.have.jsonBody('id', 42)            // özellik değeriyle birlikte var
pm.response.to.be.ok                             // 2xx
pm.response.to.not.be.ok                         // 2xx değil
```

### pm.execution

Koleksiyon çalıştırıcısı yürütme akışını kontrol edin.

```js
pm.execution.skipRequest()   // geçerli isteği atla (yalnızca ön istek betiği)
pm.execution.setNextRequest('İstek adı')  // adlandırılmış bir isteğe atla
pm.execution.setNextRequest(null)            // bu istekten sonra çalıştırmayı durdur
```

## require()

Electron'un Node ortamında mevcut olan her modül require edilebilir:

```js
const crypto  = require('crypto')
const path    = require('path')
const fs      = require('fs')
const assert  = require('assert')
```

Betikler tarayıcı bağlamında değil ana süreçte çalıştığından `window` veya
`document` yoktur. DOM API'leri kullanılamaz.

## Yaygın tarifler

### Ön istekte HMAC imzası

```js
const crypto  = require('crypto')
const secret  = pm.environment.get('signingSecret')
const ts      = String(Date.now())
const body    = pm.request.body.raw || ''
const payload = ts + '\n' + body
const sig     = crypto.createHmac('sha256', secret).update(payload).digest('hex')

pm.request.headers.upsert({ key: 'X-Timestamp', value: ts })
pm.request.headers.upsert({ key: 'X-Signature', value: 'sha256=' + sig })
```

### İstekleri zincirleme — ID'yi bir sonraki isteğe aktarma

```js
// "Kullanıcı oluştur" test betiğinde:
const userId = pm.response.json().id
pm.environment.set('createdUserId', String(userId))

// "Kullanıcıyı getir" URL'sinde:
// GET {{baseUrl}}/users/{{createdUserId}}
```

### 429'da yeniden deneme

```js
// Test betiğinde:
if (pm.response.code === 429) {
  pm.execution.setNextRequest(pm.info.requestName) // bu isteği tekrarla
}
```

### Yanıt süresini onaylama

```js
pm.test('yanıt 300 ms altında', function () {
  pm.expect(pm.response.responseTime).to.be.below(300)
})
```

### XML yanıtını ayrıştırma

```js
const { XMLParser } = require('fast-xml-parser')
const parser = new XMLParser()
const data   = parser.parse(pm.response.text())

pm.test('sipariş id mevcut', function () {
  pm.expect(data.Order.Id).to.be.a('string')
})
```

## Betik hataları

Bir betik yakalanmamış bir istisna fırlatırsa, betiğin tamamı iptal edilir ve
hata **Konsol** sekmesinde gösterilir. Hatadan önce çalışan diğer test senaryoları
yine de kaydedilir.
