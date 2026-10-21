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

Dışa aktardığınız ya da Git'e commit ettiğiniz proje dosyası her değişkeni —
adını, türünü, başlangıç değerini **ve** geçerli değerini — taşır; **secret**
olarak işaretlenmiş değişkenlerin değerleri hariç: bunlar boş yazılır ve bu
bilgisayarda kalır.

Önerilen kalıp:

1. Token, parola ve API anahtarlarını **secret** olarak işaretleyin (Type
   sütunu).
2. Push edin. Ekip arkadaşınızın Pull'u değişkeni boş değerle getirir ve
   Testnizer doldurması gereken kaç gizli değer kaldığını söyler. Her
   geliştirici kendi değerini girer; sonraki Pull'lar ve branch geçişleri bu
   değeri korur.
3. Değeri yapıştırmak yerine isteklerden ve Auth sekmelerinden değişkene
   başvurun (`{{authToken}}`) — bir isteğe veya klasöre doğrudan yazılan
   kimlik doğrulama projeyle birlikte taşınır.

HTTP mock sunucu token'ları, parolaları ve API anahtarları ile Mock MCP bearer
token'ları da aynı kurala uyar.

## İşletim sistemi anahtarlığındaki sırlar

Token ve parolalar için değişkeni **secret** olarak işaretleyin (Type sütunu).
Geçerli ve başlangıç değeri diskte işletim sistemi anahtarlığıyla (macOS
Keychain, Windows DPAPI, Linux'ta libsecret) şifrelenir; proje dosyasına, git'e
ve dışa aktarımlara hiçbir zaman yazılmaz; History ve Console'da maskelenir.
HTTP mock sunucu token'ları, parolaları ve API anahtarları ile Mock MCP bearer
token'ları da aynı şekilde saklanır; sertifika parolaları da şifrelenir.

Anahtarlık kullanılamıyorsa (örneğin libsecret olmayan Linux) gizli değerler
şifrelenmeden saklanır ve anahtarlık kullanılabilir hâle geldiğinde sonraki bir
açılışta şifrelenir. Bir bilgisayarda şifrelenen değer başka bir bilgisayarda ya
da anahtarlık sıfırlandıktan sonra çözülemez — orada değeri yeniden girin.

Secret olarak işaretlenmemiş değişkenler ve bir isteğin Auth sekmesine doğrudan
yazılan kimlik bilgileri yerel veritabanında düz metin olarak saklanır. Üretim
erişimi sağlayan token'lar için değeri gizli bir değişkene koyun ve Auth
sekmesinden ona başvurun (`{{token}}`).
