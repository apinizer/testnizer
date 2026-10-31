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

Testnizer değişkenleri dört kapsam kullanarak çözümler. Aynı anahtar birden fazla
kapsamda bulunduğunda, daha spesifik kapsam kazanır. En düşükten en yükseğe öncelik:

1. **Global değişkenler** — tüm çalışma alanına ve içindeki her projeye uygulanır.
   Çalışma zamanında `pm.globals.set()` / `pm.globals.get()` ile ayarlanır ve
   okunur. Ortamlar arasında hiç farklılık göstermeyen değerler için kullanışlıdır,
   örneğin paylaşılan bir API sürüm dizesi.

2. **Koleksiyon değişkenleri** — tek bir projeye kapsamlıdır (Testnizer, betik
   API terimi olarak "koleksiyon"u proje kapsamı için kullanır). `pm.collectionVariables.set()`
   ile ayarlanır. Projeye ait ancak ortama göre farklılık göstermemesi gereken
   temel yollar ve paylaşılan test verileri için uygundur.

3. **Ortam değişkenleri** — şu anda aktif ortamdan çekilir. Ortam oluşturma ve
   yönetme hakkında bilgi için [Ortamlar ve değişkenler](/tr/docs/environments)
   sayfasına bakın. Bunlar, hazırlık ve üretim arasında farklılık gösteren
   değerleri koymak için en yaygın yerdir.

4. **Yerel değişkenler** — yalnızca tek bir istek yürütmesi süresince yaşar.
   Ön istek veya test betiğinde `pm.variables.set()` ile ayarlanır. Yanıt
   alındıktan sonra otomatik olarak temizlenir.

**Çözümleme örneği.** `baseUrl`'nin üç yerde tanımlandığını varsayalım:

| Kapsam | Değer |
|---|---|
| Global | `https://prod.api.example.com` |
| Koleksiyon | `https://staging.api.example.com` |
| Ortam (aktif: Staging) | `https://staging-v2.api.example.com` |

Bir istek `{{baseUrl}}` kullandığında, Testnizer bunu `https://staging-v2.api.example.com`
olarak çözümler, çünkü üç arasında ortam kapsamı en yüksek önceliğe sahiptir.

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

`baseUrl` ve `version`'ı bağımsız olarak çözümler. Değişkenler birbirine referans
veremez (döngüsel veya zincirli çözümleme desteklenmez).

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

// Koleksiyon düzeyinde (proje düzeyinde) okuma/yazma
pm.collectionVariables.set('sharedCounter', 1)
```

---

## Dinamik değerler

Dinamik değer fonksiyonları, istek her gönderildiğinde yeni bir değer üretir.
Bunları URL'lerde, başlıklarda veya gövde alanlarında doğrudan `{{$fonksiyonAdı}}`
sözdizimi ile kullanın.

| Fonksiyon | Döndürür | Örnek çıktı |
|---|---|---|
| `{{$randomInt}}` | 0–1000 arasında rastgele tamsayı | `742` |
| `{{$randomInt(1,100)}}` | Verilen aralıkta rastgele tamsayı | `37` |
| `{{$randomFloat}}` | 0.0–1.0 arasında rastgele ondalık | `0.4821` |
| `{{$randomBoolean}}` | `true` veya `false` | `true` |
| `{{$randomUUID}}` | Sürüm 4 UUID | `f47ac10b-58cc-4372-a567-0e02b2c3d479` |
| `{{$timestamp}}` | Saniye cinsinden Unix epoch | `1715000000` |
| `{{$isoTimestamp}}` | ISO 8601 tarih-saat | `2024-05-06T14:30:00.000Z` |
| `{{$randomEmail}}` | Sentetik e-posta adresi | `alice.smith@example.com` |
| `{{$randomFirstName}}` | Ad | `Marcus` |
| `{{$randomLastName}}` | Soyad | `Chen` |
| `{{$randomFullName}}` | Tam ad | `Sarah Okafor` |
| `{{$randomPhoneNumber}}` | Telefon numarası | `+1-555-0147` |
| `{{$randomAlphaNumeric}}` | 8 karakterlik alfanümerik dize | `x4Kp9mQr` |
| `{{$randomHexColor}}` | Onaltılık renk kodu | `#a3c4e8` |
| `{{$randomIP}}` | IPv4 adresi | `192.168.14.23` |
| `{{$randomLoremWord}}` | Tek lorem ipsum sözcüğü | `pariatur` |
| `{{$randomLoremParagraph}}` | Lorem ipsum paragrafı | `Lorem ipsum dolor sit amet…` |

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

Herhangi bir ortam değişkeni oluşturulurken veya düzenlenirken **sır** olarak
işaretlenebilir. Sır değişkenler, macOS'ta işletim sistemi anahtarlığı ve Windows
Kimlik Bilgisi Yöneticisi tarafından desteklenen `electron-store` üzerinden saklanır.

Sır değişkenlerin davranışı:

- Değer, Ortamlar panelinde, konsolda ve istek geçmişi görüntüleyicisinde
  yıldız işaretleriyle maskelenir.
- `pm.environment.get('secretKey')`, betikler içinde gerçek değeri döndürür,
  böylece Authorization başlıklarında kullanabilirsiniz.
- `pm.environment.toObject()`, sır anahtarların `"***"` ile değiştirildiği bir
  nesne döndürür. Sır değerleri okumak için bu yönteme güvenmeyin.
- Sır değerler hiçbir zaman dışa aktarılan koleksiyon dosyalarına yazılmaz. Sır
  değişkene referans veren bir koleksiyonu dışa aktarırsanız, dışa aktarma yalnızca
  değişken adını içerir.

Ortam oluşturma ve düzenleme kılavuzu için
[Ortamlar ve değişkenler](/tr/docs/environments) sayfasına bakın.
