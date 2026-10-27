---
title: Ortamlar ve değişkenler
description: Proje kapsamlı ortamlar, değişken ikamesi, dinamik değerler ve koleksiyonları sır sızdırmadan paylaşmak için en iyi uygulamalar.
order: 2
section: Kılavuzlar
---

Ortamlar, çalışmalar arasında değişen değerleri barındırır — temel URL'ler, auth
token'ları, test kullanıcı kimlikleri. Testnizer, ortamları **projeye** kapsamlar;
bu sayede Postman'in üç katmanlı (global / koleksiyon / ortam) modelinden daha
anlaşılır bir yapı sunar: bir projenin **ortamları** ve her ortamın paylaştığı tek
bir **Globaller** listesi vardır.

## Proje kapsamlı ortamlar

Bir projenin istediği kadar ortamı olabilir. Herhangi bir anda tam olarak bir
ortam **aktif** durumdadır. Aktif ortamın değişkenleri, istekler tetiklenirken
içine yerleştirilir.

Sağ kenar çubuğundaki **Ortamlar** → **+ Yeni** seçeneğinden bir ortam oluşturun.

Her değişkenin şunları vardır:

- Bir **ad** (`{{ad}}` referanslarında kullanılır)
- Bir **başlangıç değeri** (projeyle birlikte taahhüt edilir, sürümlemeye güvenlidir)
- Bir **geçerli değer** (yerel geçersiz kılmanız, Git'e hiçbir zaman yazılmaz)

Bu ayrım Postman'inkiyle aynıdır. **Başlangıç değeri** için takımın beklediği
varsayılanı kullanın (`baseUrl: https://api.example.com`). **Geçerli değer** için
kişisel geçersiz kılmanızı kullanın (`baseUrl: http://localhost:3000`).

## İkame sözdizimi

`{{değişkenAdı}}` şu alanlarda çalışır:

- URL yolları ve sorgu dizeleri
- Başlık anahtarları ve değerleri
- Ham / JSON / XML gövde içeriği
- Form-data ve urlencoded alanları *(planlanmakta — şu an yalnızca ham gövdeler)*
- Auth alanları (temel, bearer, API anahtarı, OAuth 2.0, AWS İmzası, WS-Security)

Çözümleme sırası:

1. Ortam değişkenleri (aktif ortam)
2. Globaller (projenin kendi listesi, bkz. [Globaller](#globaller))
3. Dinamik değişkenler (yerleşik, aşağıya bakın)
4. Olduğu gibi — eşleşme yoksa `{{...}}` yerinde bırakılır

## Globaller

**Ortamlar**'ı açın (ortam seçicideki **Ortamları Yönet**) ve hangi ortam aktif
olursa olsun geçerli olan proje değişkenlerini düzenlemek için **Globaller**'i
seçin. Aynı adlı bir ortam değişkeni önceliklidir. Globaller proje ile birlikte
kaydedilir; yani Git ve dışa aktarma ile taşınır ve diğer değişkenler gibi
**sır** olarak işaretlenebilir.

Bir Postman koleksiyonunu içe aktardığınızda Postman *collection variables* ve
*globals* değişkenleri Globaller'e iner; betikte `pm.collectionVariables` ve
`pm.globals` bunları okur ve yazar. Bir projeye aittirler: aynı çalışma
alanındaki başka bir projenin kendi listesi vardır. **Global Değişkenleri Dışa
Aktar**, listeyi bir Postman globals dosyası olarak kaydeder (sır değerler boş
bırakılır).

Mevcut bir ortamı Globaller'e dönüştürmek için ortamı seçip **Globallere taşı**'yı
kullanın: değişkenler kopyalanır, Globaller'de zaten olan bir ad kendi değerini
korur ve ardından ortamın silinip silinmeyeceği sorulur.

## Dinamik değişkenler

`$` önekiyle yerleşik yardımcılar. Testnizer, Postman'in 118 dinamik değişkeninin
tamamını aynı çıktıyla destekler; örneğin:

- `{{$guid}}` / `{{$randomUUID}}` — v4 UUID
- `{{$randomInt}}` — 0–1000 arasında rastgele tamsayı
- `{{$timestamp}}` — Unix epoch saniyesi
- `{{$isoTimestamp}}` — ISO 8601 UTC
- `{{$randomEmail}}`, `{{$randomFirstName}}`, `{{$randomLastName}}` — sahte veriler

ayrıca Testnizer'a özgü `{{$randomInt(1,100)}}`, `{{$randomString(12)}}` ve
`{{$datetime(YYYY-MM-DD)}}`. Testnizer'ın tanımadığı bir `{{$ad}}` yazıldığı gibi
bırakılır. Örnek çıktılarla tam liste
[Değişkenler referansı](/tr/docs/variables#dinamik-değerler) sayfasındadır.

Dinamik değişkenler her istekte yeniden çözümlenir — önbellek bozmak için sorgu
parametrelerinde veya benzersiz idempotency anahtarlarında kullanışlıdır.

## Betiklerden değişken ayarlama

Ön istek veya yanıt sonrası bir betikte:

```js
pm.environment.set('userId', 12345)
pm.environment.get('baseUrl')
pm.variables.set('correlationId', require('uuid').v4())
```

Setter'lar, aktif ortamın **geçerli değerine** yazar. Aynı Testnizer oturumu
içindeki isteklerde kalıcı olurlar.

## Sır sızdırmadan koleksiyon paylaşma

Önerilen kalıp:

1. **Başlangıç değerine** yer tutucu değerler koyun (`{{authToken}}` varsayılan
   olarak `"<buraya-yapıştır>"` veya boş)
2. Her geliştirici **geçerli değerini** yerel olarak doldurur
3. Projeyi Git'e taahhüt edin — yalnızca başlangıç değerleri taşınır; geçerli
   değerler ayrı, gitignore'da olan bir dosyada saklanır

Üretim kalitesinde ekiplerin gerçek bir bearer token'ını yanlışlıkla depoya
göndermeden Testnizer projelerini yayımlamasının yolu budur.

## İşletim sistemi anahtarlığındaki sırlar

Uzun ömürlü kimlik bilgileri için (OAuth yenileme token'ları, sertifika parola
ifadeleri), ortam değişkenleri yerine **Sertifika yöneticisini** veya istek başına
auth alanlarını tercih edin. Bu değerler işletim sistemi anahtarlığından geçer ve
hiçbir zaman düz metin olarak diske yazılmaz.

Ortam "geçerli değerleri" proje dizininizdeki düz metin olarak saklanır — geliştirme
için elverişlidir, ancak üretim kimlik bilgileri için uygun değildir. Üretim
erişimi sağlayan token'lar için her zaman anahtarlık destekli yolları kullanın.
