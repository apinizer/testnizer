---
title: Değişkenler referansı
description: Testnizer'da değişken türleri, kapsam hiyerarşisi ve dinamik değer fonksiyonları için tam referans.
order: 6
section: Kılavuzlar
---

Değişkenler, aynı koleksiyonun manuel düzenlemeler olmadan ortamlar, kullanıcılar
ve test çalıştırmaları arasında çalışması için istekleri parametrelendirmenize
olanak tanır.

---

## Değişken kapsam hiyerarşisi

Testnizer `{{değişken}}` yer tutucularını üç kapsamdan çözümler. Aynı anahtar
birden fazla kapsamda bulunduğunda, daha spesifik kapsam kazanır. En düşükten en
yükseğe öncelik:

1. **Globaller** — projenin kendi değişken listesi; **Ortamlar** → **Globaller**
   altından açılır. Hangi ortam aktif olursa olsun projedeki her istek bunları
   görür ve proje ile birlikte kaydedilir (Git, dışa aktarma). Globaller
   **projeye özeldir**: aynı çalışma alanındaki başka bir proje bunları görmez;
   ne Gönder'de ne de Çalıştır'da. Bu liste hem Postman'in *globals* hem de
   *collection variables* karşılığıdır — Testnizer projesi, Postman koleksiyonuna
   denk gelir — bu yüzden `pm.globals` ve `pm.collectionVariables` aynı
   değişkenleri okur ve yazar. Bir değişken **sır** olarak işaretlenebilir; bkz.
   [Sırlar ve hassas değişkenler](#sırlar-ve-hassas-değişkenler).

2. **Ortam değişkenleri** — şu anda aktif ortamdan çekilir. Ortam oluşturma ve
   yönetme hakkında bilgi için [Ortamlar ve değişkenler](/tr/docs/environments)
   sayfasına bakın. Hazırlık ve üretim arasında farklılık gösteren değerleri
   koymak için en yaygın yerdir. Aynı adlı bir Global'e göre ortam değişkeni
   önceliklidir.

3. **Yerel değişkenler** — yalnızca tek bir istek yürütmesi süresince yaşar.
   Ön istek veya test betiğinde `pm.variables.set()` ile ayarlanır. Yanıt
   alındıktan sonra otomatik olarak temizlenir.

**Çözümleme örneği.** `baseUrl`'nin iki yerde tanımlandığını varsayalım:

| Kapsam | Değer |
|---|---|
| Globaller | `https://prod.api.example.com` |
| Ortam (aktif: Staging) | `https://staging-v2.api.example.com` |

Bir istek `{{baseUrl}}` kullandığında, Testnizer bunu
`https://staging-v2.api.example.com` olarak çözümler, çünkü ortam kapsamı daha
yüksek önceliğe sahiptir. `baseUrl` tanımlamayan bir ortama geçerseniz aynı yer
tutucu Global değere döner.

Gönder, Collection Runner, Test Suite'ler, Zamanlayıcı ve mock sunucular aynı
Globalleri ve aynı ortamları okur; yani Gönder'de çözülen bir istek Çalıştır'da
da çözülür.

### Bir ortamı Globaller'e taşıma

Koleksiyon değişkeni kullanan Postman koleksiyonları Testnizer'a Global olarak
gelir. Değerleri gerçekten tüm projeye ait olan bir ortamınız varsa
**Ortamlar**'ı açın, ortamı seçin ve **Globallere taşı**'yı seçin: değişkenleri
Globaller'e kopyalanır, Globaller'de zaten olan bir değişken kendi değerini korur
ve ardından ortamın silinip silinmeyeceği sorulur (soru, kaybolacak değerleri
adıyla belirtir). Önceki bir içe aktarmayla oluşan ortamlar otomatik olarak
taşınmaz.

---

## `{{değişken}}` sözdizimi

Çift küme parantezi her istek alanında çalışır:

- **URL** — `https://{{baseUrl}}/{{version}}/users`
- **Sorgu parametreleri** — herhangi bir sorgu parametre satırının değer sütunu
- **Başlıklar** — hem ad hem değer sütunları
- **İstek gövdesi** — ham JSON, form alanları, GraphQL değişkenleri ve XML gövdesi
- **Ön istek ve test betikleri** — bunun yerine `pm.*` API'sini kullanın (aşağıya bakın)

Testnizer istek gönderilmeden önce tüm yer tutucuları çözümler. Bir değişken
herhangi bir kapsamda tanımlı değilse, yer tutucu olduğu gibi bırakılır — gerçek
`{{değişkenAdı}}` metni gönderilir. Tanımsız değişkenler URL çubuğunda turuncu
renkle vurgulanır, böylece Gönder'e tıklamadan önce bunları fark edebilirsiniz.

İç içe geçmiş ikame çalışır. Şöyle bir URL:

```
https://{{baseUrl}}/{{version}}/users
```

`baseUrl` ve `version`'ı bağımsız olarak çözümler. Bir değişkenin değeri de
`{{başkaDeğişken}}` içerebilir: çözümleme hiçbir şey değişmeyene kadar (en fazla
10 geçiş) tekrarlanır; bu yüzden `fullUrl = {{baseUrl}}/{{version}}` gibi
zincirli başvurular çalışır. Döngüsel bir başvuru 10 geçiş sınırında durur ve
çözülmemiş son yer tutucu metinde kalır.

### Betiklerde değişken yönetimi

Ön istek ve test betikleri, çalışma zamanında değişkenleri okumak ve yazmak için
`pm` API'sini kullanır:

```js
// Aktif ortamdan bir değer oku
const token = pm.environment.get('accessToken')

// Yanıttan çıkarılan bir değer yaz
const body = pm.response.json()
pm.environment.set('userId', body.data.id)

// Yalnızca bu yürütme için geçerli olan yerel bir değişken yaz
pm.variables.set('requestId', '12345')

// Globaller: pm.collectionVariables ve pm.globals aynı proje genelindeki listedir
pm.collectionVariables.set('sharedCounter', 1)
pm.globals.get('sharedCounter')   // 1
```

---

## Dinamik değerler

Dinamik değer fonksiyonları, istek her gönderildiğinde yeni bir değer üretir.
Bunları URL'lerde, başlıklarda veya gövde alanlarında doğrudan `{{$fonksiyonAdı}}`
sözdizimi ile kullanın.

Testnizer, **Postman'in 118 dinamik değişkeninin tamamını** destekler
(`{{$guid}}`, `{{$randomUUID}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`,
`{{$randomInt}}`, `{{$randomEmail}}`, `{{$randomFullName}}`, `{{$randomIP}}` ve
diğerleri). Değerler Postman ve Newman'in kullandığı üreteç tablosundan geldiği
için çıktı biçimleri Postman ile aynıdır. Bir alana `{{$` yazdığınızda otomatik
tamamlama bunları listeler. Yaygın birkaçı:

| Fonksiyon | Döndürür | Örnek çıktı |
|---|---|---|
| `{{$randomInt}}` | 0–1000 arasında rastgele tamsayı | `742` |
| `{{$randomBoolean}}` | `true` veya `false` | `true` |
| `{{$guid}}` / `{{$randomUUID}}` | Sürüm 4 UUID | `f47ac10b-58cc-4372-a567-0e02b2c3d479` |
| `{{$timestamp}}` | Saniye cinsinden Unix epoch | `1715000000` |
| `{{$isoTimestamp}}` | ISO 8601 tarih-saat | `2024-05-06T14:30:00.000Z` |
| `{{$randomEmail}}` | Sentetik e-posta adresi | `alice.smith@example.com` |
| `{{$randomFirstName}}` | Ad | `Marcus` |
| `{{$randomLastName}}` | Soyad | `Chen` |
| `{{$randomFullName}}` | Tam ad | `Sarah Okafor` |
| `{{$randomPhoneNumber}}` | Telefon numarası | `+1-555-0147` |
| `{{$randomAlphaNumeric}}` | Tek bir alfanümerik karakter | `x` |
| `{{$randomHexColor}}` | Onaltılık renk kodu | `#a3c4e8` |
| `{{$randomIP}}` | IPv4 adresi | `192.168.14.23` |
| `{{$randomLoremWord}}` | Tek lorem ipsum sözcüğü | `pariatur` |
| `{{$randomLoremParagraph}}` | Lorem ipsum paragrafı | `Lorem ipsum dolor sit amet…` |

Testnizer, Postman'de bulunmayan birkaç biçim de ekler:

| Fonksiyon | Döndürür |
|---|---|
| `{{$randomInt(1,100)}}` | Verilen aralıkta rastgele tamsayı |
| `{{$randomString}}` / `{{$randomString(12)}}` | Rastgele alfanümerik dize (8 karakter veya verdiğiniz uzunluk) |
| `{{$randomName}}` | Rastgele tam ad |
| `{{$datetime(YYYY-MM-DD)}}` | Geçerli yerel tarih/saat; `YYYY MM DD HH mm ss` yerine konur |

Testnizer'ın tanımadığı bir ad, Postman'de olduğu gibi yazdığınız hâliyle bırakılır
(`{{$notAFunction}}` olduğu gibi gönderilir).

### Betiklerde dinamik değerler

`{{$fonksiyonAdı}}` sözdizimi betik kodu içinde **değerlendirilmez**. Şunu
yazarsanız UUID değil `{{$randomUUID}}` dizesini elde edersiniz:

```js
// YANLIŞ — $randomUUID betik dizesi içinde genişletilmez
pm.variables.set('traceId', '{{$randomUUID}}')
```

Bunun yerine standart JavaScript ile değer üretin:

```js
// DOĞRU — sandbox'ta mevcut kripto modülünü kullanın
const { randomUUID } = require('crypto')
pm.variables.set('traceId', randomUUID())

// Veya rastgele tamsayı için:
const requestId = Math.floor(Math.random() * 1000)
pm.variables.set('requestId', requestId)
```

Dinamik değerler, Testnizer'ın göndermeden önce ikame ettiği alanlar için
tasarlanmıştır — URL, başlıklar, sorgu parametreleri ve gövde metni.

---

## Sırlar ve hassas değişkenler

Herhangi bir ortam değişkeni veya Global, oluşturulurken veya düzenlenirken
**sır** olarak işaretlenebilir. Değer (geçerli ve başlangıç), yerel veritabanında
Electron `safeStorage` ile şifrelenir — macOS'ta Keychain, Windows'ta DPAPI,
Linux'ta libsecret. Yalnızca sır değerler şifrelenir; adlar okunabilir kalır.
Anahtarlık kullanılamıyorsa (bazı Linux kurulumları) değerler şifrelenmeden saklanır,
ortam yöneticisi bunu söyler ve anahtarlık oluşunca sonraki açılışta şifrelenirler.
Başka bir bilgisayarda ya da işletim sistemi anahtarlığı sıfırlanmadan önce
şifrelenmiş bir değer çözülemez: alan, değeri yeniden girmenizi ister.

Sır değişkenlerin davranışı:

- Değer; Ortamlar panelinde, Konsol'da, Geçmiş'te ve Runner sonuçlarında maskelenir.
- `pm.environment.get('secretKey')`, betikler içinde gerçek değeri döndürür,
  böylece Authorization başlıklarında kullanabilirsiniz.
- Sır değerler bu bilgisayarda kalır. Her proje dosyasına, Git commit'ine veya
  push'una ve dışa aktarıma **boş değer** olarak yazılır — ad taşınır, değer
  taşınmaz — ve bir pull ya da içe aktarma yerel değerinizin üzerine yazmaz
  (Postman dışa aktarması değişkeni boş değerli `type: secret` olarak işaretler).
- Bir sır değişkene yazan betik (`pm.environment.set`, `pm.globals.set`,
  `pm.collectionVariables.set` veya `pm.vault.set`) yeni değeri sızdırmaz:
  Çalıştır sırasında sonuçlarda, Geçmiş'te ve Konsol'da maskelenir; Gönder'de ise
  istek çıkmadan önce kaydedilir, böylece Geçmiş ve Konsol da maskeler.
- `pm.vault`, Postman'in sır deposunun adıdır. Testnizer'da bu, **sır
  Globaller**'dir: `await pm.vault.set('apiKey', değer)` bir sır Global oluşturur
  veya günceller, `await pm.vault.get('apiKey')` yalnızca sır olanları okur ve
  `await pm.vault.unset('apiKey')` bir sır Global'i siler. Bkz.
  [Betikler](/tr/docs/scripts#pmvault-ve-pmrequire).
- Bir isteğin **Auth** sekmesine doğrudan yazdığınız kimlik bilgileri sır değişken
  *değildir*: yerel veritabanında düz metin olarak saklanır ve istekle birlikte
  taşınır. Gerçek değeri bir sır değişkene koyun ve `{{secretVar}}` olarak
  başvurun.

Ortam oluşturma ve düzenleme kılavuzu için
[Ortamlar ve değişkenler](/tr/docs/environments) sayfasına bakın.
