---
title: JWT Çözücü
description: JSON Web Token'larını tamamen çevrimdışı çözün, encode edin, doğrulayın ve inceleyin — web sitesi yok, ağ çağrısı yok.
order: 1
section: Araçlar
---

JWT Çözücü, "şu an bu token'a bakmam — ya da yenisini üretmem — gerek"
aracıdır. **Tools → JWT Debugger**'ı açın ve iki sekme arasından seçin:

- **JWT Decoder** — token yapıştırıp inceleyin
- **JWT Encoder** — sıfırdan token oluşturup imzalayın

Sağ üstte **Generate example** dropdown'ı, herhangi bir algoritma için
çalışan örnek üretir (HS256/384/512, RS256/384/512, PS256/384/512,
ES256/384/512, EdDSA). Asimetrik algoritmalarda taze bir keypair üretir,
örnek token'ı imzalar ve Verify / Sign alanlarını doldurur — anahtar
aramak zorunda kalmadan deneme yapmak için faydalı.

## Decoder

Testnizer token'ı iki `.` sınırlayıcısı üzerinde böler ve her parçayı hemen çözer:

### Header

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "2024-01-key"
}
```

`alg` ve `kid` vurgulanır — bunlar doğrulamanın nasıl çalışacağını kontrol eden
alanlardır.

### Payload

İki görüntü modu — bölüm başlığındaki JSON / Table butonlarıyla geçiş yapın.

JSON modu syntax-highlight'lı pretty-print yapar. Table modu her claim için
üç sütunlu bir satır:

- **Claim** — anahtar adı
- **Value** — ham değer; sayısal tarih claim'leri (`iat`, `exp`, `nbf`,
  `auth_time`) ardından ISO 8601 görünür
- **Description** — standart kayıtlı claim'ler (RFC 7519 §4.1) ve sık
  kullanılan public claim'ler (`name`, `email`, `scope`, `roles`, vb.)
  için yerleşik açıklama — `azp` ya da `cty` ne demek hatırlamadığınızda
  faydalı

| İddia | Görüntü |
|---|---|
| `exp` | Unix zaman damgası + ISO 8601 + geçmişteyse **expired** rozet |
| `iat` | Unix zaman damgası + ISO 8601 |
| `nbf` | Unix zaman damgası + ISO 8601 + gelecekteyse **not yet valid** rozet |
| `sub` | Dize, değer olduğu gibi gösterilir |
| `iss` | Dize, değer olduğu gibi gösterilir |
| `aud` | Dize veya dizi, tüm değerler gösterilir |

**Valid JWT** rozeti yapının başarıyla parse edildiğini onaylar. Süresi
dolmuş veya henüz geçerli olmayan token'lar yanına ek renkli rozetler
alır.

### İmza

Ham imza baytları Base64URL kodlamasıyla gösterilir. Doğrulama etkinleştirilmişse
(aşağıya bakın) burada bir ✓ veya ✗ rozeti ve uyumsuzluk durumunda başarısızlık
nedeni görünür (algoritma uyumsuzluğu, yanlış anahtar, hatalı biçimlendirilmiş
header vb.).

## İmza doğrulama

Sağdaki **Doğrula** paneline bir anahtar yapıştırın veya seçin:

### HMAC (HS256 / HS384 / HS512)

Base64 kodlu veya düz metin paylaşılan gizli anahtarı yapıştırın. Testnizer HMAC'ı
hesaplar ve token'daki imzayla karşılaştırır.

### RSA (RS256 / RS384 / RS512 / PS256 / PS384 / PS512)

RSA açık anahtarını şu biçimlerden birinde yapıştırın:

- `-----BEGIN PUBLIC KEY-----` (PKCS#8 / SubjectPublicKeyInfo)
- `-----BEGIN RSA PUBLIC KEY-----` (PKCS#1)
- JSON Web Key (`{"kty":"RSA","n":"...","e":"..."}`)

### ECDSA (ES256 / ES384 / ES512)

EC açık anahtarını yapıştırın:

- `-----BEGIN PUBLIC KEY-----`
- JSON Web Key (`{"kty":"EC","crv":"P-256","x":"...","y":"..."}`)

### EdDSA (Ed25519)

Ed25519 açık anahtarını PEM veya JWK biçiminde yapıştırın.

### JWKS uç noktası

Token'ın `kid` header'ı mevcutsa ve anahtarı yayıncının JWKS uç noktasından
almak istiyorsanız, **Ayarlar → JWT** bölümünde **JWKS getirmeye izin ver**
seçeneğini etkinleştirin (varsayılan olarak kapalı). Açıkken bir JWKS URL'si
yapıştırabilirsiniz; Testnizer şunları yapar:

1. HTTPS üzerinden JWKS'yi getirir
2. Token header'ındaki `kid` ile eşleştirir
3. Eşleşen anahtarla imzayı doğrular

Bu, JWT hata ayıklayıcısının yapabileceği tek ağ çağrısıdır ve yalnızca
açıkça açtığınızda gerçekleşir. Ayar küresel değil, proje başınadır.

## Neden jwt.io değil?

[jwt.io](https://jwt.io) kullanışlıdır, ancak token'ınızı ayrıştırıp görüntülemek
için uzak bir servise gönderir. Üretim auth token'ı için bu şu anlama gelir:

- Kullanıcı ID'niz, rolleriniz ve yetkileriniz Postman'in (veya jwt.io'nun)
  günlüklerinde yer alır
- `sub` iddiası genellikle bir hesaba ters eşlenebilir
- Token'ın özel bir iddiasında oturum düzeyinde gizli bilgi varsa, artık gitti

Testnizer'ın hata ayıklayıcısı tamamen ana süreçte çalışır. Token dizesi
panonuzdan süreç içi bir ayrıştırıcıya ve görüntülenmek üzere renderer'a gider.
Hiçbir HTTP isteği yapılmaz.

## Değişkenlerden token okuma

Bir istekte token oluşturuyor veya alıyorsanız, kopyala yapıştır yapmadan onu
JWT hata ayıklayıcıya okuyabilirsiniz. Token giriş alanında **Değişkenden**'e
tıklayın ve token'ı tutan ortam değişkenini seçin (örn. `{{accessToken}}`).
Testnizer değişkeni çözer ve ayrıştırır.

Bu, bir oturum açma isteğinin `pm.environment.set('accessToken', ...)` ile
sakladığınız bir token döndürdüğü durumlarda kullanışlıdır — uygulamadan
çıkmadan JWT aracına geçin ve mevcut token'ı inceleyin.

## Encoder

**JWT Encoder** sekmesi sıfırdan token oluşturup imzalar. Decoder'in tersi
gibi çalışır:

- **Header** — `{ "alg": "HS256", "typ": "JWT" }` ile dolu JSON editör.
  Algoritma dropdown'unu değiştirince `alg` alanı otomatik senkron olur.
- **Payload** — gömmek istediğiniz claim'lerin JSON editörü
- **Sign JWT** — algoritmayı seçin ve paylaşılan secret (HS\*) veya
  PEM özel anahtar (RS / PS / ES / EdDSA) sağlayın
- **Encoded JWT** — üç renkli (header / payload / signature) çıktı paneli
  + kopyala butonu

**Sign & Encode**'a basarak token üretin. Encoder, seçtiğiniz algoritmayla
imzalanmış RFC 7519 uyumlu JWT'ler üretir.

Asimetrik algoritmalar için **Generate example** dropdown'ı kestirme
sağlar: taze bir PKCS#8 özel anahtar + eşleşen SPKI açık anahtar üretir,
örnek bir payload imzalar ve her ikisini doldurur. İmzalanmış token'ı
Decoder sekmesine kopyalayıp Verify panelinde açık anahtarı yapıştırarak
imza çiftini round-trip doğrulayabilirsiniz — istemci/sunucu eşleşmesini
hızlıca kontrol etmek için faydalı.

## Keystore anahtarıyla imzalama

Aracın özel anahtar istediği her yerde, PEM yapıştırmak yerine kayıtlı bir
**[keystore](/tr/docs/keystore-studio)** girişini gösterebilirsiniz. Depoyu
seçin, alias'ı seçin, imzalayın.

Anahtarın kendisi pencereye hiç ulaşmaz: imzalama uygulamanın main process'inde
olur ve geriye yalnızca token döner. Keystore girişi seçildiğinde PEM alanı
devre dışı kalır, böylece hangi anahtarın kullanıldığı hiç soru olmaz.

PEM yapıştırmak çalışmaya devam eder ve hâlâ varsayılandır. Hiçbir şey keystore
kullanmanızı zorunlu kılmaz.

## JWE — şifreli token'lar

**JWE** sekmesi imzalamaz, şifreler ve çözer. İki şey seçersiniz ve bunlar
ayrıdır:

- **`alg`** — içerik anahtarının nasıl yönetileceği (`RSA-OAEP`, `A256KW`, `dir`, …)
- **`enc`** — içeriğin nasıl şifreleneceği (`A128GCM`, `A256GCM`, `A256CBC-HS512`, …)

Anahtar alanı, gerçekten seçtiğiniz çift için ne istediğini söyler — `dir` +
`A128GCM` bileşimi 16 bayt ister, `A256GCM`'in isteyeceği 32'yi değil. Simetrik
ile asimetrik `alg` arasında geçiş yapmak anahtar alanlarını temizler; simetrik
bir ayarın üstünde kilitli bir public-key kutusu bırakmaz.

## Tazelik

Token'ı, anahtarı ya da algoritmayı değiştirin — önceki doğrulama sonucu
kaybolur. O zamandan beri düzenlediğiniz bir token'ın yanında duran yeşil bir
"Signature verified" yanlış bir güvenlik cevabıdır; yanlış okunmaya
bırakılmak yerine temizlenir.

## Betikten imzalama

Bir istek akışı sırasında token üretmenin desteklenen yolu `pm.jose`'dur —
**Send** ile **[Collection Runner](/tr/docs/cli-and-automation)** üzerinde
birebir aynı çalışır:

```js
// Ön istek scripti — HS256 ile imzala
const token = await pm.jose.sign(
  { sub: pm.environment.get('userId'), exp: Math.floor(Date.now() / 1000) + 3600 },
  { alg: 'HS256', secret: pm.environment.get('signingSecret') },
)
pm.environment.set('testToken', token)
```

`pm.jose.verify` diğer yarısıdır. İkisi de asenkrondur, `await` edin — ve
async callback'li bir `pm.test`'in iki yolda da beklendiğini unutmayın; yani
içindeki bir assertion varsayılan olarak geçemez.

Doğrudan kütüphaneye ihtiyacınız varsa `require('jose')` da mevcuttur;
`require('crypto')` ve [betik sanal alanının](/tr/docs/scripts) geri kalanı da
öyle.

Elde edilen `{{testToken}}` değişkeni istek header'larında kullanılabilir ve
**Değişkenden** seçeneğiyle JWT hata ayıklayıcıda incelenebilir.
