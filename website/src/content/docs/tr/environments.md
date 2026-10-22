---
title: Ortamlar ve değişkenler
description: Proje kapsamlı ortamlar, değişken ikamesi, dinamik değerler ve koleksiyonları sır sızdırmadan paylaşmak için en iyi uygulamalar.
order: 2
section: Kılavuzlar
---

Ortamlar, çalışmalar arasında değişen değerleri barındırır — temel URL'ler, auth
token'ları, test kullanıcı kimlikleri. Testnizer, ortamları **projeye** kapsamlar;
bu sayede Postman'in üç katmanlı (global / koleksiyon / ortam) modelinden daha
anlaşılır bir yapı sunar.

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
2. Global değişkenler (**Ayarlar → Globals**'ta yapılandırılır)
3. Dinamik değişkenler (yerleşik, aşağıya bakın)
4. Olduğu gibi — eşleşme yoksa `{{...}}` yerinde bırakılır

## Dinamik değişkenler

`$` önekiyle yerleşik yardımcılar:

- `{{$randomInt}}` — rastgele 32-bit tamsayı
- `{{$randomUuid}}` — RFC 4122 v4 UUID
- `{{$timestamp}}` — Unix epoch saniyesi
- `{{$isoTimestamp}}` — ISO 8601 UTC
- `{{$randomEmail}}`, `{{$randomFirstName}}`, `{{$randomLastName}}` — sahte veriler
- `{{$base64:hello}}` — bir değişmezi Base64 olarak kodlar
- `{{$jwt.decode:<token>:claim}}` — JWT'den bir talep çıkarır (auth sunucusunun
  döndürdüğü bir değere karşı onaylama için kullanışlıdır)

Dinamik değişkenler her istekte yeniden çözümlenir — önbellek bozmak için sorgu
parametrelerinde veya benzersiz idempotency anahtarlarında kullanışlıdır.

## Betiklerden değişken ayarlama

Ön istek veya yanıt sonrası bir betikte:

```js
pm.environment.set('userId', 12345)
pm.environment.get('baseUrl')
pm.variables.set('correlationId', pm.variables.get('$randomUuid'))
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
