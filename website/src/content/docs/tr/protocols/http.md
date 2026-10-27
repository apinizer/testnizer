---
title: HTTP / REST
description: Testnizer'da HTTP istekleri için eksiksiz referans — metodlar, auth, gövde modları, scriptler ve assertion'lar.
order: 2
section: Protokoller
---

HTTP editörü, yaygın kullanımdaki her HTTP metodunu, her gövde türünü, her auth şemasını
ve tarayıcı sandbox'ınızda değil, Node ana sürecinde çalışan bir script katmanını kapsar.

## Metodlar

GET · POST · PUT · PATCH · DELETE · HEAD · OPTIONS · QUERY · CONNECT · TRACE
ve metod seçicide yazdığınız herhangi bir özel metod dizesi.

**QUERY**, istek gövdesi taşıyan güvenli ve idempotent metoddur — parametreleri
bir URL'ye sığmayan okumalar için "GET'e gövde mi, yoksa POST mu?" sorusunun
standart yanıtı. Kendi rozetine sahiptir ve
[mock sunucularda](/tr/docs/mock-server) da seçilebilir.

## URL çubuğu

Değişkenler gerçek zamanlı olarak çözülür. `{{baseUrl}}/users` yazın ve Testnizer
çözülmüş URL'yi çubuğun altında bir ipucu olarak gösterir. Bir değişken tanımsızsa
alan turuncu renkle vurgulanır.

Sorgu parametreleri şu şekillerde girilebilir:

- Doğrudan URL dizesinde (`?limit=10&offset=0`)
- **Params** sekmesinde anahtar-değer tablosu olarak (bir satırı devre dışı bırakmak
  parametreyi silmeden kapatır)

URL'deki kodlanmış karakterler Params tablosunda otomatik olarak çözülür.

**Yol değişkenleri.** URL yolundaki bir `:ad` bölümü (`/users/:id`), Parametreler
sekmesinin altındaki **Yol Değişkenleri** tablosuna bir satır ekler. Değeri girin;
Gönder, Çalıştır, Kod Oluştur ve cURL dışa aktarma bunu, ön istek scriptinden sonra
ve `{{değişkenler}}` çözülmeden önce yerine koyar. Değeri olmayan bir `:ad`
eskisi gibi olduğu gibi gönderilir. Postman dışa aktarması bunları `url.variable[]`
olarak geri yazar.

**cURL komutu yapıştırma.** Bir `curl` komutunu (bash, Windows CMD veya
PowerShell) doğrudan URL çubuğuna yapıştırın; Testnizer isteğin tamamını doldurur
— metod, URL, parametreler, header'lar, gövde, auth ve ayarlar. Bir toast algılanan
kabuğu gösterir, aktarılamayanları listeler ve **Geri al** sunar. Düz bir URL metin
olarak yapıştırılır. Ayrıştırıcının neleri anladığı için bkz.
[cURL](/tr/docs/import-formats#curl).

## Auth sekmesi

| Şema | Testnizer'ın yaptığı |
|---|---|
| **Auth yok** | Authorization header göndermez |
| **Üstten devral** | En yakın auth yapılandırılmış üst öğeye ulaşana kadar koleksiyon ağacını yukarı doğru tarar |
| **Basic** | `user:pass`'ı Base64 ile kodlar, `Authorization: Basic ...` ayarlar |
| **Bearer** | `Authorization: Bearer <token>` ayarlar |
| **API Key** | Anahtar/değeri header'a, sorgu dizesine veya cookie'ye ekler — yapılandırılabilir |
| **Digest** | Tam MD5/SHA-256 digest challenge-response, 401 yeniden deneme dahil |
| **NTLM** | Windows domain / IIS uç noktaları için NTLM handshake |
| **Hawk** | İstek başına HMAC imzası (Hapi tarzı) |
| **AWS Signature v4** | Herhangi bir AWS servisi için istekleri imzalar — erişim anahtarı, gizli anahtar, bölge, servis adı |
| **OAuth 1.0** | HMAC-SHA1 / RSA-SHA1 imzaları, nonce + zaman damgası |
| **OAuth 2.0** | Yerleşik redirect handler ile tam yetkilendirme kodu akışı, ayrıca client-credentials ve password grant |

Değişkenler her auth alanında çalışır. Token'ları bir ortamda saklayın ve
`{{accessToken}}` olarak başvurun.

## Headers sekmesi

Yaygın header adlarında otomatik tamamlamalı anahtar-değer tablosu. Satırlar tek tek
devre dışı bırakılabilir. Testnizer, eklediğiniz header'ları `Host`, `Content-Length`
veya `User-Agent` dahil hiçbirini kaldırmaz.

## Body sekmesi

### none

Gövde yok. Content-Type header otomatik olarak eklenmez.

### raw

Araç çubuğunda content-type seçici bulunan Monaco editörü:

- `application/json` — söz dizimi vurgulama, parantez eşleştirme, otomatik biçimlendirme
- `application/xml` — XML ağaç renklendirme
- `text/plain` — düz metin
- `application/javascript` — JS söz dizimi
- `text/html` — HTML söz dizimi
- `custom` — herhangi bir content-type dizesi yazın, editör metin modunda kalır

### form-data

`multipart/form-data` kodlaması. Her satır `Text` veya `File` olabilir.
Dosya satırları yerel işletim sistemi dosya seçiciyi açar; dosya adı ve MIME türü
parça header'larında gönderilir.

**Göreli** bir dosya yolu (örneğin içe aktarılmış bir Postman koleksiyonundaki
`data/upload.json`) projenin **Çalışma dizini**nden okunur: bunu **Proje Ayarları →
Genel → Çalışma dizini** altında bu bilgisayardaki mutlak bir klasöre ayarlayın.
Mutlak yol olduğu gibi kullanılır. İstekte göreli bir yol varsa ve çalışma dizini
ayarlı değilse Gönder, ayarın adını veren bir mesajla başarısız olur. Çalışma
dizini bilgisayara özgü bir ayardır: projeyle birlikte kaydedilmez ve Git'e
gönderilmez, çünkü bir makinedeki klasör başka bir makinede anlam taşımaz. Gönder,
Collection Runner, Test Suite'ler ve zamanlanmış çalıştırmaların hepsi için geçerlidir.

### x-www-form-urlencoded

URL-encoded anahtar-değer tablosu. Değerler gönderilmeden önce yüzde olarak kodlanır.

### binary

Tüm istek gövdesi diskten tek bir dosyadır. Testnizer, dosya uzantısına göre
`Content-Type` ayarlar (gerekirse Headers sekmesinde geçersiz kılın). Göreli yol,
yukarıda anlatıldığı gibi projenin [Çalışma dizini](#form-data)ne göre çözülür.

## Ön istek scripti

İstek gönderilmeden önce çalışır. Şunlar için kullanın:

- Ortam değişkenlerini ayarlama veya güncelleme (`pm.environment.set(...)`)
- Dinamik değerler oluşturma (`pm.variables.set('ts', Date.now())`)
- Diğer değişkenlerden imza veya HMAC oluşturma
- İsteği koşullu olarak atlama (`pm.execution.skipRequest()`)

```js
// Örnek: her göndermeden önce HMAC hesapla
const crypto = require('crypto')
const secret = pm.environment.get('signingSecret')
const body    = pm.request.body.raw
const sig     = crypto.createHmac('sha256', secret).update(body).digest('hex')
pm.request.headers.add({ key: 'X-Signature', value: sig })
```

Ön istek scriptleri, `require()` erişimiyle ana süreçte çalışır.
Tam `pm` API'si için [Scriptler kılavuzuna](/tr/docs/scripts) bakın.

## Tests sekmesi

Yanıt geldikten sonra çalışır. `pm.test` / `pm.expect` API'si Postman'inkini yansıtır,
böylece mevcut Postman test takımları minimum değişiklikle yapıştırılabilir.

```js
pm.test('status 200', () => {
  pm.response.to.have.status(200)
})

pm.test('yanıt JSON', () => {
  const body = pm.response.json()
  pm.expect(body).to.have.property('id')
  pm.expect(body.id).to.be.a('number')
})

// Bir sonraki istekte kullanmak için ortama değer yaz
pm.environment.set('userId', pm.response.json().id)
```

Geçti/başarısız sonuçlar yanıt panosundaki **Tests** sütununda görünür ve
geçmişe kaydedilir.

## Yanıt paneli

| Sekme | İçerik |
|---|---|
| **Body** | Monaco editörü — JSON otomatik biçimlendirilir, XML güzel basılır, görüntüler satır içinde önizlenir; PDF, ses ve video satır içi bir çerçevede oynatılır |
| **Headers** | Arama özellikli yanıt header tablosu |
| **Cookies** | Yanıt tarafından ayarlanan cookie'ler, domain/path/bayraklarıyla birlikte |
| **Console** | Ham istek + ham yanıt (yönlendirmeleri veya beklenmeyen header'ları hata ayıklarken kullanışlı) |
| **Actual Request** | Değişken ikamesi ve ön istek scripti çalıştırıldıktan sonra son çözülmüş URL, header'lar ve gövde |

Sekmelerin üzerindeki durum satırı HTTP durum kodunu (sınıfa göre renklendirilmiş),
yanıt süresini (ms) ve yanıt boyutunu gösterir.

## Cookie'ler

Testnizer otomatik, **proje kapsamlı bir cookie kavanozu (cookie jar)** tutar.
Bir yanıt `Set-Cookie` taşıdığında cookie saklanır ve aynı projede cookie'nin
domain'i ile path'ine uyan sonraki isteklerde otomatik olarak — `Cookie`
header'ı şeklinde — gönderilir. Bir login isteğinin ardından gelen kimlik
doğrulamalı istek, tarayıcıda olduğu gibi sıfır yapılandırmayla çalışır.

Proje başına tek kavanoz, her yolda:

- **Send**, **Collection Runner**, **test suite'leri**, **zamanlanmış
  çalıştırmalar** ve script kaynaklı `pm.sendRequest(...)` çağrıları aynı
  kavanozu paylaşır — Send ile yapılan bir login Run'da görünür ve
  `pm.sendRequest` ile yapılan bir login sonraki isteklere yarar.
- Farklı projeler birbirinden **izoledir**: bir projede saklanan oturum
  cookie'si, aynı host için bile başka bir projeden asla gönderilmez.
- **Quick Test** tasarım gereği ayrı, kapsamsız bir kavanoz kullanır.

Kavanoz bellekte yaşar — Testnizer'ı yeniden başlatmak onu temizler. Geçerli
yanıtın ayarladığı cookie'ler, yanıt panelinin **Cookies** sekmesinde
domain'i, path'i ve bayraklarıyla listelenir; uzun değerler (JWT boyutundaki
token'lar) kendi sütunlarında sarılır ve kopyalamak için seçilebilir kalır.

## Kod snippet oluşturma

Etkin sekmedeki istek için yapıştırmaya hazır bir snippet oluşturmak üzere yanıt
çubuğundaki **Kod**'a tıklayın (ya da sağ panelin **Kod** bölmesini açın).

Bir **Dil** seçin, ardından onun **Varyant**larından birini seçin ve o varyantın
dikkate aldığı ayarlar için **Seçenekler**'i açın. 20 dil ve 36 varyant vardır:

| Dil | Varyantlar |
|---|---|
| cURL | bash, CMD, PowerShell |
| C | libcurl |
| C# | HttpClient, RestSharp |
| Dart | http, dio |
| Go | net/http |
| HTTP | HTTP/1.1 |
| Java | OkHttp, Unirest |
| JavaScript | Fetch, XHR, jQuery |
| Kotlin | OkHttp |
| NodeJS | Axios, Native, Request, Unirest |
| Objective-C | NSURLSession |
| OCaml | Cohttp |
| PHP | cURL, Guzzle, HTTP_Request2, pecl_http |
| PowerShell | Invoke-RestMethod |
| Python | Requests, http.client |
| R | httr, RCurl |
| Ruby | Net::HTTP |
| Rust | reqwest |
| Shell | wget, HTTPie |
| Swift | URLSession |

**Seçenekler** varyanta göre değişir; girinti boyutu ve karakteri, **İstek
gövdesini kırp**, **Yönlendirmeleri izle**, **İstek zaman aşımı**, **async/await
kullan** ve **İskelet kodu ekle** bunlar arasındadır. cURL varyantlarında
**Çok satırlı**, **Uzun seçenek adları** (`--header`) ve **Sessiz mod** (`-s`)
vardır. Yönlendirmeyi kapatmış ya da kendi zaman aşımı olan bir istek bunu
snippet'e taşır. **Varsayılanlara dön** seçenekleri sıfırlar. Seçim oturum boyunca
kalır.

Snippet'in içeriği:

- Mevcut header'lar, sorgu parametreleri (varsa `#fragment`'ten önce URL'ye
  eklenir), yol değişkenleri ve gövde; form-data metin ve dosya parçaları, binary
  gövdeler ve GraphQL `{query, variables}` JSON gövdesi dahil
- Gerçekte gönderilecek auth; bir klasörden ya da projeden **miras alınan auth**
  dahil, header olarak ya da dilin kendi API'si ile
- Gövdenin ima ettiği `Content-Type`, siz bir tane ayarlamadıysanız
- `{{değişkenler}}` mevcut değerlerine çözülür. **Sır** bir değişken `{{ad}}`
  yer tutucusu olarak kalır; kopyalanan metin o zaman gerçek değerleri
  içereceğinden **Gizli değerleri dahil et**'i yalnızca doğrudan çalışan bir komut
  için işaretleyin. Panel, çözülemeyen değişkenleri listeler

Kod Oluştur **HTTP, GraphQL ve SOAP** sekmelerini kapsar: bir GraphQL sekmesi JSON
gövdeli POST'u, bir SOAP sekmesi ise zarf ve `SOAPAction` ya da SOAP 1.2
`Content-Type` ile POST'u üretir. WebSocket, Socket.IO, MQTT, MCP, gRPC, SSE veya
AI Chat sekmesinde bölme, eski bir HTTP isteği göstermek yerine kod oluşturmanın
kullanılamadığını söyler.

## Yönlendirmeleri takip et

Varsayılan olarak etkin. Bir yönlendirme yanıtını incelemek için URL çubuğundaki istek
ayarları panelinde (dişli simgesi) **Yönlendirmeleri takip et** seçeneğini kapatın.

## TLS / mTLS

İstemci sertifikaları **Ayarlar → Sertifikalar** bölümünde proje başına yapılandırılır.
Testnizer, belirttiğiniz hostname desenine göre doğru sertifikayı seçer. [Sertifikalar
kılavuzuna](/tr/docs/certificates) bakın.

İşletim sistemi güven deposunu değiştirmeden öz imzalı bir CA'yı kabul etmek için
aynı panelde CA sertifikasını ekleyin.
