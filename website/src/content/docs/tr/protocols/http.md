---
title: HTTP / REST
description: Testnizer'da HTTP istekleri için eksiksiz referans — metodlar, auth, gövde modları, scriptler ve assertion'lar.
order: 2
section: Protokoller
---

HTTP editörü, yaygın kullanımdaki her HTTP metodunu, her gövde türünü, her auth şemasını
ve tarayıcı sandbox'ınızda değil, Node ana sürecinde çalışan bir script katmanını kapsar.

## Metodlar

GET · POST · PUT · PATCH · DELETE · HEAD · OPTIONS · CONNECT · TRACE ve metod
seçicide yazdığınız herhangi bir özel metod dizesi.

## URL çubuğu

Değişkenler gerçek zamanlı olarak çözülür. `{{baseUrl}}/users` yazın ve Testnizer
çözülmüş URL'yi çubuğun altında bir ipucu olarak gösterir. Bir değişken tanımsızsa
alan turuncu renkle vurgulanır.

Sorgu parametreleri şu şekillerde girilebilir:

- Doğrudan URL dizesinde (`?limit=10&offset=0`)
- **Params** sekmesinde anahtar-değer tablosu olarak (bir satırı devre dışı bırakmak
  parametreyi silmeden kapatır)

URL'deki kodlanmış karakterler Params tablosunda otomatik olarak çözülür.

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

### x-www-form-urlencoded

URL-encoded anahtar-değer tablosu. Değerler gönderilmeden önce yüzde olarak kodlanır.

### binary

Tüm istek gövdesi diskten tek bir dosyadır. Testnizer, dosya uzantısına göre
`Content-Type` ayarlar (gerekirse Headers sekmesinde geçersiz kılın).

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
| **Body** | Monaco editörü — JSON otomatik biçimlendirilir, XML güzel basılır, görüntüler satır içinde önizlenir |
| **Headers** | Arama özellikli yanıt header tablosu |
| **Cookies** | Yanıt tarafından ayarlanan cookie'ler, domain/path/bayraklarıyla birlikte |
| **Console** | Ham istek + ham yanıt (yönlendirmeleri veya beklenmeyen header'ları hata ayıklarken kullanışlı) |
| **Actual Request** | Değişken ikamesi ve ön istek scripti çalıştırıldıktan sonra son çözülmüş URL, header'lar ve gövde |

Sekmelerin üzerindeki durum satırı HTTP durum kodunu (sınıfa göre renklendirilmiş),
yanıt süresini (ms) ve yanıt boyutunu gösterir.

## Kod snippet oluşturma

Yapıştırmaya hazır snippet oluşturmak için istek araç çubuğundaki `</>` simgesine tıklayın:

- **cURL**
- **JavaScript (fetch)**
- **JavaScript (axios)**
- **Python (requests)**
- **Go (net/http)**
- **Java (OkHttp)**

Snippet'ler mevcut header'ları, auth'u ve gövdeyi içerir — değişkenler oluşturma
anındaki mevcut değerlerine çözülür.

## Yönlendirmeleri takip et

Varsayılan olarak etkin. Bir yönlendirme yanıtını incelemek için URL çubuğundaki istek
ayarları panelinde (dişli simgesi) **Yönlendirmeleri takip et** seçeneğini kapatın.

## TLS / mTLS

İstemci sertifikaları **Ayarlar → Sertifikalar** bölümünde proje başına yapılandırılır.
Testnizer, belirttiğiniz hostname desenine göre doğru sertifikayı seçer. [Sertifikalar
kılavuzuna](/tr/docs/certificates) bakın.

İşletim sistemi güven deposunu değiştirmeden öz imzalı bir CA'yı kabul etmek için
aynı panelde CA sertifikasını ekleyin.
