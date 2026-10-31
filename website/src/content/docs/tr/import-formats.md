---
title: İçe ve dışa aktarma
description: Postman, Insomnia, OpenAPI, Swagger, cURL, WSDL, .proto, RAML, SoapUI ve HAR'dan mevcut koleksiyonlarınızı getirin.
order: 1
section: Kılavuzlar
---

Testnizer on giriş formatını kabul eder ve dört format yayar. İçe aktarmalar,
belgelenmiş yüzey için **kayıpsız dönüşüm** amacıyla tasarlanmıştır — yalnızca
URL ve metod değil, ön/sonrası betikler ve koleksiyon değişkenleri de dahil.

## Format matrisi

| Format | İçe Aktar | Dışa Aktar | Notlar |
|---|---|---|---|
| **OpenAPI 3.x** | ✓ | ✓ | Güvenlik şemaları auth'a eşlenir, şemalar yerine örnekler tercih edilir |
| **Swagger 2.0** | ✓ | — | Salt okunur; dışa aktarma OpenAPI 3.0.3 yayar |
| **Postman v2.1** | ✓ | ✓ | `event[]` (ön/test betikleri) ve `variable[]` dönüşümü |
| **Insomnia v4** | ✓ | ✓ | Form-data dosya alanları, ortam şekilleri, betik shim |
| **cURL** | ✓ | ✓ | Chrome "Copy as cURL", Windows cmd, çok parçalı, ANSI-C alıntılama |
| **WSDL** | ✓ | — | Çoklu servis, çoklu port, SOAP 1.1 + 1.2 çift bağlama |
| **`.proto`** | ✓ | — | JSON iskelet gövdeli gRPC servisleri |
| **RAML 1.0** | ✓ | — | İç içe kaynaklar, URI parametreleri, gövde içerik türleri |
| **SoapUI / ReadyAPI** | ✓ | — | Proje XML |
| **HAR** | ✓ | — | Tarayıcı ağ günlükleri |

## Nasıl içe aktarılır

**Dosya → İçe Aktar** (ya da bir dosyayı kenar çubuğuna sürükleyin) seçeneğiyle
Testnizer formatı otomatik algılar. Algılama belirsizse (`.json` ile nadiren,
ham XML ile daha sık), bir açılır liste seçim yapmanızı sağlar.

İçe aktarma, aktif projenin içinde yeni bir koleksiyon oluşturur. Kenar çubuğu
bağlam menüsünden sonradan yeniden adlandırabilirsiniz.

### OpenAPI / Swagger

- `info.title` koleksiyon adı olur
- `paths.*` uç noktalara dönüşür, `tags[0]`'a göre düzenlenir (yoksa "Default")
- `components.securitySchemes` istek başına auth bloklarına eşlenir:
  - `http.basic` → Temel doğrulama
  - `http.bearer` → Bearer token
  - `apiKey` (header / query / cookie) → API anahtarı doğrulaması
  - `oauth2` → OAuth 2.0 (yapılandırma korunur, ilk seferinde akışı manuel çalıştırın)
- Gövde örnekleri önce `example`'dan, ikinci olarak şema türevli iskeletlerden gelir

Dönüşüm meta verileri (etiketler, `operationId`, `required` parametreler, güvenlik
referansları) bir yardımcı alanda saklanır, böylece yeniden dışa aktarma orijinal
spesifikasyonu olduğu gibi yeniden üretir.

### Postman v2.1

- Koleksiyon değişkenleri bir **proje kapsamlı ortam** haline gelir (koleksiyondan sonra adlandırılır)
- `event` dizisi (`prerequest` ve `test` betikleri) olduğu gibi korunur
- Auth, başlıklar ve gövde modları bire bir eşlenir
- `pm` API'si Postman uyumlu olacak şekilde shim'lenir — mevcut betiklerin çoğu değişmeden çalışır

Postman'de değişkenler koleksiyon kapsamlıdır, ancak Testnizer bunları **proje** kapsamına
alır. Bu, birden fazla Postman koleksiyonu tek bir Testnizer projesine aktarılırken
koleksiyonlar arası sızıntıyı önler.

### Insomnia v4

- Çalışma alanı bir projeye dönüşür
- İstek grupları uç nokta klasörlerine dönüşür
- Form-data dosya alanları, dosya yolu referansını korur
- Ön istek betikleri aynı `pm` shim üzerinden çalışır
- Ortam nesneleri Testnizer ortamlarına dönüşür

### cURL

Herhangi bir cURL komutunu **İçe Aktar → cURL** seçeneğine yapıştırın veya
doğrudan URL çubuğuna girin (Testnizer otomatik olarak algılar). Desteklenen
bayraklar şunları içerir:

- Standart: `-X`, `-H`, `-d`, `--data`, `--data-raw`, `--data-binary`,
  `--data-urlencode`
- Çok parçalı: `-F`, `--form`
- Auth: `-u`, `--user`, `--basic`, `--bearer`
- TLS: `--cert`, `--key`, `-k`, `--insecure`, `--cacert`
- Çerezler: `-b`, `--cookie`, `-c`, `--cookie-jar`
- Proxy: `-x`, `--proxy`, `--proxy-user`
- Çıktı: `-o`, `--output`, `-O`, `--remote-name` (sessizce atlanır)
- Zamanlama: `--max-time`, `--connect-timeout`
- Toplam 40'tan fazla bayrak

Alıntılama hem POSIX (`'…'`) hem de Windows cmd (`^"…^"` şapka işaretleri) için
çalışır. ANSI-C alıntılama (`$'…'`) ayrıştırılır ancak içindeki kaçış dizileri
henüz çözümlenmez — açık sorunlara bakın.

### WSDL

Bir WSDL URL'si yapıştırın veya bir `.wsdl` dosyası seçin. Testnizer:

- WSDL'yi çözümler (proje içinde çevrimdışı kullanım için bir kopyasını önbelleğe alır)
- Servisleri → portları → operasyonları listeler
- XSD şemalarından her operasyon için örnek bir zarf oluşturur
- SOAPAction başlıklarını otomatik olarak algılar
- Çift SOAP 1.1 + 1.2 bağlamalarını işler (her port ayrı bir uç nokta olur)

### `.proto` (gRPC)

Bir `.proto` dosyasını bırakın. Testnizer mesaj türlerini, servisleri ve metodları
ayrıştırır ve her mesaj için sıfır değerli alanlara sahip bir JSON iskeleti oluşturur.
İskelet `repeated`, `optional`, iç içe mesaj türleri, oneof'lar ve enum'ları işler.

Sunucu adresini istek başına geçersiz kılabilirsiniz — `.proto`'nun
belirsiz bir uç noktaya referans verdiği durumlarda kullanışlıdır.

### RAML 1.0

Kaynaklar, metodlar, URI parametreleri, sorgu parametreleri ve gövde içerik türleri
ayrıştırılır. Kütüphane / tür uzantıları kısmen desteklenmektedir (temel çözümleme).

### SoapUI / ReadyAPI

Proje XML'si ayrıştırılır. Test senaryoları uç noktalara dönüşür, REST ve SOAP
istekleri istek türü öğeleriyle tanınır, onaylar Testnizer'ın test onay modeline
en iyi çaba eşlemesiyle aktarılır.

### HAR

Her giriş bir uç nokta olur. Yakalanan tarayıcı oturumlarını farklı bir ortama
karşı yeniden oynatmak için kullanışlıdır.

## Nasıl dışa aktarılır

**Dosya → Dışa Aktar** dört çıktı formatı sunar:

- **Postman v2.1 koleksiyonu** — betikler ve değişkenler için kayıpsız
- **Insomnia v4 dışa aktarma** — istekler ve ortamlar için kayıpsız
- **OpenAPI 3.0.3** — orijinal spesifikasyonu yeniden üretmek için dönüşüm meta verilerini kullanır
- **cURL komutları** — istek başına tek satır, tüm auth ve gövdeler satır içinde

Diğer her şey için (WSDL, `.proto`, RAML, SoapUI), orijinal kaynak dosyalar
projeyle birlikte taşınır — bu formatlar genellikle yukarı akışta yazıldığından
Testnizer bunları dönüşümlü olarak yayımlamaya çalışmaz.

## Test paketi içe aktarma

Test paketleri otomatik algılama yoluyla üç formatı kabul eder:

- Testnizer native (`.tns` JSON)
- Postman koleksiyonu (tek bir regresyon seti olarak ele alınır)
- Insomnia dışa aktarması (aynı şekilde ele alınır)

Test paketleri için çok formatlı dışa aktarma yol haritasındadır (şu an yalnızca
Testnizer native yayımlanmaktadır).
