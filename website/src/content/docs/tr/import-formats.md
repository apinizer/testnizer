---
title: İçe ve dışa aktarma
description: Postman, Insomnia, OpenAPI, Swagger, cURL, WSDL, .proto, RAML, SoapUI ve HAR'dan mevcut koleksiyonlarınızı getirin.
order: 1
section: Kılavuzlar
---

Testnizer on giriş formatını kabul eder ve altı formata dışa aktarır. İçe aktarmalar,
belgelenmiş yüzey için **kayıpsız dönüşüm** amacıyla tasarlanmıştır — yalnızca
URL ve metod değil, ön/sonrası betikler ve koleksiyon değişkenleri de dahil.

## Format matrisi

| Format | İçe Aktar | Dışa Aktar | Notlar |
|---|---|---|---|
| **OpenAPI 3.x** | ✓ | ✓ | Güvenlik şemaları auth'a eşlenir, şemalar yerine örnekler tercih edilir |
| **Swagger 2.0** | ✓ | — | Salt okunur; dışa aktarma OpenAPI 3.0.3 yayar |
| **Postman** (v1, v2.0, v2.1, v3) | ✓ | ✓ | Otomatik algılanır. Dışa aktarma v2.1 veya v3 (klasör / JSON). Ortamlar, globals, Postman veri dışa aktarımı ve `.zip` arşivleri de |
| **Insomnia v4 / v5** | ✓ | ✓ | Form-data dosya alanları, temel ortam → Globaller, betik shim |
| **cURL** | ✓ | ✓ | bash, Windows CMD ve PowerShell komutları; URL çubuğuna yapıştırma; çok parçalı; ANSI-C alıntılama |
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

### Postman

İçe Aktar iletişim kutusunda **Postman** kartını seçin ve bir dosya seçin (v3
klasörü için **Klasör içe aktar…**). Testnizer biçimi dosyanın kendisinden
ayırt eder; sürüm seçmeniz gerekmez:

| Seçtiğiniz | Ne olduğu |
|---|---|
| Koleksiyon JSON | v1, v2.0, v2.1 veya tek bir v3 JSON dosyası |
| Ortam JSON | Proje ortamı olur |
| Globals JSON | Değişkenleri projenin [Globaller](/tr/docs/environments#globaller)'ine eklenir — klasör oluşturulmaz |
| Postman veri dışa aktarımı (`postman_dump.json`) | İçindeki her koleksiyon, ortam ve globals dosyası |
| **Klasör içe aktar…** | Bir Postman 12 *Native Git* koleksiyon klasörü (`.resources` ve `*.request.yaml` dosyaları içerir) ya da tüm çalışma alanı klasörü (`postman/collections`, `postman/environments` ve globals içerir) |
| Bir `.zip` | Zip'lenmiş veri dışa aktarımı, zip'lenmiş koleksiyon veya ortam dosyaları ya da zip'lenmiş bir v3 klasörü |

Elde ettikleriniz:

- Klasörler, istekler, başlıklar, gövdeler (raw, form-data, urlencoded, binary,
  GraphQL), `event` betikleri (`prerequest` ve `test`) olduğu gibi ve yol
  değişkenleri (URL yolundaki `:id`)
- **Koleksiyon, klasör ve istek değişkenleri projenin Globaller'ine gider**;
  Postman globals dosyaları da öyle. Testnizer projesi Postman koleksiyonuna denk
  geldiğinden ayrı bir "koleksiyon" katmanı yoktur: aynı liste, betikte
  `pm.collectionVariables` ve `pm.globals`'tır. Projede zaten olan bir anahtar
  yerel değerini korur (içe aktarma raporu bunu adıyla belirtir); iki kez
  tanımlanan bir anahtarda ilk tanım kalır. `secret` değişkenler sır Global olarak
  gelir; bir Postman vault'una bağlı v3 değişkeni, değeri yeniden girmeniz için
  bir notla boş bir sır değişken olarak gelir
- **Koleksiyon düzeyindeki kimlik doğrulama ve betikler her isteğe kopyalanmaz.**
  İçe aktarmanın oluşturduğu klasöre gider; ya da projede henüz kimlik doğrulama
  yoksa ve yalnızca `{{değişken}}` içeren basit bir Basic / Bearer / API anahtarı
  ise projenin kimlik doğrulamasına. İstekler **Üstten miras al** olur
- Kayıtlı yanıtlar **kayıtlı örnek** olur; istek başına ayarlar (yönlendirme izleme,
  zaman aşımı vb.) korunur; devre dışı betikler ve değişkenler devre dışı kalır;
  OAuth 2.0 grant ayrıntıları eşlenir
- Testnizer'da olmayan kimlik doğrulama türleri **Kimlik Doğrulama Yok** olarak
  içe aktarılır ve Auth sekmesinde yeniden kurmanız için raporda listelenir
- Betikler `pm` API'sinde değişmeden çalışır — bkz. [Betikler](/tr/docs/scripts).
  `pm.vault` veya `pm.require` çağıran betik raporda adıyla geçer; `pm.vault` sır
  Globaller üzerinde çalışır, `pm.require` desteklenmez
- Ortamlar proje ortamı olur. Eski sürümlerin oluşturduğu "(imported)" ortamlar
  otomatik taşınmaz — değişkenlerini Globaller'de istiyorsanız **Ortamlar**'da
  **Globallere taşı**'yı kullanın

Bir koleksiyonu içe aktarmak **tek bir işlemdir (transaction)**: ya tamamlanır ya
da projeyi olduğu gibi bırakır; desteklenmeyen bir ayrıntı işlemi yarıda kesmek
yerine raporlanır. İçe aktarma bittiğinde **İçe aktarma tamamlandı** paneli kaç
istek, klasör ve örnek aktarıldığını gösterir; **Ayrıntıları göster** olduğu gibi
aktarılamayan her öğeyi listeler.

**Postman v3 istek türleri.** Bir v3 koleksiyonu (klasör veya JSON) HTTP'den
fazlasını içerebilir. Testnizer GraphQL, gRPC, WebSocket, Socket.IO, MCP, MQTT ve
LLM isteklerini editörün kaydettiği biçimde kendi istek türleri olarak içe
aktarır. Yerel bir program başlatan (stdio) MCP isteği içe aktarılır ama asla
güvenilir sayılmaz: yalnızca o komuta bu bilgisayarda bir kez bağlandıktan sonra
çalışır. LLM isteği, kayıtlı API anahtarı kapalı ve dosyadan hiçbir kimlik bilgisi
alınmadan bir AI Chat isteği olur. Kafka, Data (veritabanı / dosya) ve bilinmeyen
türler atlanır ve raporda adı geçer.

**Başka yerden gelen klasörler ve arşivler güvenilmeyen girdidir.** Bir `.zip`
bellekte okunur, hiçbir zaman diske çıkarılmaz. Testnizer; mutlak veya `..`
yollu, sembolik bağlantılı, şifreli girdili, aşırı büyük veya aşırı sıkıştırılmış
girdili ya da çok sayıda girdili arşiv ve klasörleri, ayrıca seçilen klasörün
dışına çıkan bir betik dosyasını reddeder. Reddedilen arşivin nedeni iletişim
kutusunda gösterilir.

**Kapsam notu.** Postman'de değişkenler koleksiyon kapsamlıdır; Testnizer aynı
değişkenleri **proje** kapsamına alır. Birden fazla Postman koleksiyonunu tek
projeye aktarmak bu yüzden Globaller'i aralarında paylaştırır (bir anahtarın ilk
tanımı kazanır, sonrakiler raporlanır).

### Insomnia (v4 ve v5)

- Çalışma alanı bir projeye dönüşür
- İstek grupları uç nokta klasörlerine dönüşür
- Form-data dosya alanları, dosya yolu referansını korur
- Ön istek betikleri aynı `pm` shim (`insomnia.*`) üzerinden çalışır
- Koleksiyonun **temel ortamı** (base environment), Insomnia'da her zaman aktif
  katman olduğu için projenin [Globaller](/tr/docs/environments#globaller)'ine
  gider. **Alt ortamları** proje ortamı olur. Projede zaten olan bir anahtar
  yerel değerini korur ve içe aktarma raporu bunu adıyla belirtir. Aynı dosyayı
  yeniden içe aktarmak hiçbir şeyi çoğaltmaz
- Betiklerde, hiçbir ortam seçili değilken `insomnia.environment` Globaller'i
  okur ve yazar; Insomnia'nın temel ortamda yaptığı gibi. Bkz.
  [Betikler](/tr/docs/scripts#insomnia--bruno)
- 1.6.0 öncesinde içe aktarılan bir projede temel ortam sıradan bir ortam olarak
  kalır; **Globallere taşı** onu Globaller'e kopyalar

### cURL

Herhangi bir cURL komutunu **İçe Aktar → cURL** seçeneğine yapıştırın ya da
doğrudan bir HTTP isteğinin **URL çubuğuna** yapıştırın: Testnizer komutu tanır ve
isteğin tamamını doldurur (metod, URL, sorgu parametreleri, başlıklar, gövde,
kimlik doğrulama, yönlendirme, zaman aşımı ve TLS doğrulama ayarları). Bir
**toast**, algıladığı kabuğu söyler ve önceki isteği olduğu gibi geri getiren
**Geri al** düğmesi sunar; düz bir URL yapıştırmak eskisi gibi davranır.
Yapıştırılan komut isteğin tamamı olduğundan, komutun söylemediği her şey yeni
istek varsayılanına döner. Kimlik bilgisi içermeyen bir komut, kimlik doğrulamayı
**Üstten miras al**'da bırakır.

Tek bir ayrıştırıcı; **bash / zsh** (`'…'`, kaçış dizileri çözümlenen `$'…'`, `\`
satır devamı), **Windows CMD** (`^` şapka işaretleri ve `"…"`) ve **PowerShell**
(ters tırnak, `curl.exe`) için kopyalanmış komutları okur ve baştaki istemi
(prompt) atar. Yaklaşık 300 curl seçeneğini ve her birinin ne tükettiğini bilir;
bu yüzden `-o out.txt` değeri hiçbir zaman URL sanılmaz. Desteklenenler arasında:

- Metod ve gövde: `-X` (bitişik de olur, `-XPOST`), `-I`, `-G`, `-d` / `--data` /
  `--data-raw` / `--data-binary` / `--data-urlencode` (tekrarlananlar birleştirilir),
  `--json`, `-F` / `--form`
- Kimlik doğrulama: `-u` / `--user`, `--basic`, `--digest`, `--ntlm`,
  `--oauth2-bearer`
- Başlıklar ve çerezler: `-H`, `-b`, `-A`, `-e`
- Davranış: `-L` / `--max-redirs`, `-k` / `--insecure`, `-m` / `--max-time`,
  `--connect-timeout`, `--compressed`, `--url` ve `--seçenek=değer` biçimi

curl'ün ne gönderdiğini değiştiren ama Testnizer isteğinde karşılığı olmayan
seçenekler — proxy (`-x`), istemci sertifikası (`-E`), `--config` ve benzerleri —
**uyarıyla birlikte yok sayılır**; toast'taki **Aktarılamayanlar** altında ve içe
aktarma raporunda listelenir. Çıktı seçenekleri (`-o`, `-O`, ilerleme ve yeniden
deneme bayrakları) sessizce atlanır. Bir `--next` zincirinin yalnızca ilk isteği
kullanılır; ayrıştırıcının tanımadığı bir seçenek, ardından gelen URL'yi yutmak
yerine raporlanır.

Diğer yönde, **Kod Oluştur → cURL** bash, Windows CMD veya PowerShell komutu
üretir; bkz. [Kod snippet oluşturma](/tr/docs/protocols/http#kod-snippet-oluşturma).

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

Bir proje üzerindeki **Dışa Aktar…** (ana ekran ya da APIs ağacındaki proje kökü)
altı biçimli **Projeyi dışa aktar** penceresini açar:

- **Testnizer JSON** — tam proje kopyası: tüm protokoller, ortamlar, test süitleri
  ve mock sunucular
- **Postman v2.1** — klasörler, istekler, kimlik doğrulama ve scriptlerle
  koleksiyon. Yalnız HTTP, SOAP, GraphQL ve SSE. Ayrıca projenin Globaller'ini
  koleksiyon `variable[]`'ı olarak, kayıtlı örnekleri özgün isteğiyle birlikte
  `response[]` olarak, istek başına ayarları `protocolProfileBehavior` olarak,
  yol değişkenlerini `url.variable[]` olarak, AWS Signature ve Hawk kimlik
  doğrulamasını ve proje kimliğini `info._postman_id` olarak taşır
- **Postman v3 (klasör)** — tüm istek türleri ve ortamlarla bir Postman 12
  *Native Git* klasörü (YAML dosyaları); Postman Local View veya bir Git deposu için
- **Postman v3 (JSON)** — tüm istek türleriyle tek bir Postman v3 koleksiyon
  dosyası: WebSocket, Socket.IO, MQTT, gRPC, GraphQL, MCP ve AI Chat dahil
- **OpenAPI 3** — HTTP isteklerinin klasöre göre etiketlenmiş API tanımı
- **Insomnia** — istek grupları. Yalnız HTTP, SOAP, GraphQL ve SSE

Bir test paketi bağlam menüsünden dışa aktarılır (**Postman v2.1 olarak dışa
aktar**, **Postman v3 (klasör) olarak dışa aktar**, **Postman v3 (JSON) olarak
dışa aktar**); Ortamlar penceresinde ise **Ortamı Dışa Aktar** ve **Global
Değişkenleri Dışa Aktar** (bir Postman globals dosyası) bulunur.

Miras alınan kimlik doğrulama dışa aktarmada çözülür: kimlik doğrulamasını bir
klasörden veya projeden miras alan bir istek, OpenAPI, Insomnia ve cURL çıktısında
yine etkin kimlik doğrulamayı taşır.

**Sırlar hiçbir dosyayla çıkmaz.** Sır değişkenlerin değerleri, proje
kimlik doğrulamasındaki kimlik bilgileri ve bu makineye özgü diğer sırlar her
dışa aktarmada boş yazılır (Postman dışa aktarması sır değişkeni değersiz bir
`type: secret` olarak işaretler).

**Postman v3'ün taşıyamadıkları.** v3'te Testnizer'ın bazı ayrıntıları için alan
yoktur. Bunlar dışarıda bırakılır ve dışa aktarmadan sonra tek bir uyarıda
sayılır ("N ayrıntı Postman v3'e aktarılamadı"):

- HTTP istek zaman aşımı
- Socket.IO el sıkışma token'ı ve sabitlenmiş taşıma (transport)
- İstek türü için Postman'de karşılığı olmayan bir kimlik doğrulama türü
- Durum kodu olmayan kayıtlı bir örnek
- AI Chat özel başlıkları ve MCP araç sunucuları
- MQTT XML / HTML yük biçimleri, devre dışı mesaj kullanıcı özellikleri ve
  composer'daki kaydedilmemiş mesaj taslağı (dışa aktarmak için kayıtlı mesaj
  olarak kaydedin)
- Auto, Legacy veya 2026-07-28 dışındaki bir MCP protokol sabitlemesi (Legacy
  olarak dışa aktarılır)

Diğer her şey için (WSDL, `.proto`, RAML, SoapUI), orijinal kaynak dosyalar
projeyle birlikte taşınır — bu formatlar genellikle yukarı akışta yazıldığından
Testnizer bunları dönüşümlü olarak yayımlamaya çalışmaz. Tek bir isteğin cURL
komutu [Kod Oluştur](/tr/docs/protocols/http#kod-snippet-oluşturma)
penceresinden alınır.

## Test paketi içe aktarma

Test paketleri otomatik algılama yoluyla üç formatı kabul eder:

- Testnizer native (`.tns` JSON)
- Postman koleksiyonu (tek bir regresyon seti olarak ele alınır)
- Insomnia dışa aktarması (aynı şekilde ele alınır)

Test paketleri için çok formatlı dışa aktarma yol haritasındadır (şu an yalnızca
Testnizer native yayımlanmaktadır).
