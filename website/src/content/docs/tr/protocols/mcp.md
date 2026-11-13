---
title: MCP (Model Context Protocol)
description: Testnizer bir MCP istemcisidir. Streamable HTTP, SSE veya stdio üzerinden bağlanın, araçları çağırın, kaynakları okuyun, istemleri getirin, OAuth 2.1 ile oturum açın, kayıtlı çağrıları Runner'da çalıştırın ve notlandırılmış bir güvenlik taraması yapın.
order: 10
section: Protokoller
---

**Model Context Protocol** (MCP) — Anthropic tarafından yayınlanan ve Claude
Desktop, IDE eklentileri ve diğer AI host'ları tarafından benimsenen açık
spec — bir dil modeli host'unun harici sunucularla standart bir şekilde
konuşmasını sağlar. Bir MCP sunucusu **araçlar** (girdileri için JSON
şemalarıyla birlikte), **kaynaklar** (URI ile adreslenen veri) ve **istemler**
(yeniden kullanılabilir mesaj şablonları) sunar; bir MCP istemcisi (bu
durumda Testnizer) bunları keşfeder ve kullanır.

Testnizer bir MCP **istemcisidir**. Şunlar için kullanın:

- Geliştirmekte olduğunuz yeni bir MCP sunucusunun protokol el sıkışmasına ve
  liste çağrılarına doğru yanıt verdiğini doğrulamak.
- Üçüncü taraf bir MCP sunucusunu Claude Desktop'a bağlamadan önce denemek.
- Geliştirme sırasında host çalıştırmadan araç çağrılarını hızlıca test etmek
  ve kayıtlı çağrıları Runner'da, Test Suite'lerde ve Zamanlayıcı'da yeniden
  çalıştırmak.
- Karşısında test edeceğiniz kendi sunucunuzu kurmak: Mocks paneli yerel bir
  [MCP mock sunucusu](/tr/docs/mock-server/mcp) çalıştırabilir.

Resmî MCP TypeScript SDK'sı (v2) üzerine kuruludur; bu yüzden tel protokolü
diğer host'ların konuştuğuyla aynıdır.

## MCP sekmesi açma

**+ New** → **MCP**'ye tıklayın. Düzenleyicide bir bağlantı çubuğu (durum,
transport, protokol, URL veya komut, **Bağlan**), bir istek yapılandırma şeridi
(**Yetkilendirme**, **Başlıklar**, **Ortam**, **Betikler**, **Testler**,
**Ayarlar**), solda yetenek listesi, sağda **Gezgin** ve altta **Messages**
paneli bulunur. Liste ile Gezgin arasındaki ayırıcı sürüklenebilir ve
hatırlanır.

## Transport seçimi

- **Streamable HTTP** — güncel MCP HTTP transport'u; `https://mcp.example.com/mcp`
  gibi bir URL'deki uzak sunucular için.
- **SSE (eski)** — önceki HTTP+SSE transport'u; dokümantasyonu SSE'den söz eden
  eski sunucular için.
- **stdio (yerel)** — Testnizer **sunucuyu bir alt süreç olarak başlatır** ve
  stdin/stdout üzerinden JSON-RPC konuşur; ağ yoktur. URL alanına komut satırının
  tamamını yazın, örn. `npx -y @modelcontextprotocol/server-everything`. İlk
  belirteç çalıştırılabilir dosya, kalanı argümandır. Sunucu Testnizer'ın
  ortamını (PATH, HOME, …) devralır; fazlasını **Ortam** sekmesinden ekleyin.

URL, başlık ve ortam değerleri `{{değişken}}` kabul eder; Bağlan'a bastığınızda
çözülür.

## Protokol sürümü seçimi

**Protokol** seçici bir sonraki Bağlan için geçerlidir:

- **Otomatik (önerilen)** — önce MCP 2026-07-28'i (`server/discover`) dener,
  olmazsa MCP 2025'e (`initialize`) düşer. Discover yoklamasına 403 ya da 5xx gibi
  bir hatayla yanıt veren bir ağ geçidi de bu geri düşüşe yol açar.
- **MCP 2025 (klasik)** — yalnızca `initialize` el sıkışması.
- **MCP 2026-07-28** — yalnızca yeni durumsuz protokol.
- **Belirli bir MCP 2025 sürümü** — tarihli tek bir sürümü sabitler.

Bağlandıktan sonra sunucunun adı, sürümü ve anlaşılan `MCP <sürüm>` çubuğun
altında görünür; desteklenen sürümler, yetenekler ve sunucu talimatları için
rozetin üzerine gelin.

## Bağlanma

**Bağlan**'a tıklayın (bağlanırken **İptal**, bağlıyken **Bağlantıyı Kes**
olur). Başarılı olursa **Araçlar**, **Kaynaklar** ve **İstemler** listeleri
otomatik dolar. Sunucu `list_changed` bildirimi gönderirse ilgili liste yeniden
çekilir. El sıkışma başarısız olursa hata bağlantı çubuğunun altında gösterilir;
`401` yanıtında OAuth akışını çalıştırmanız önerilir.

Sunucu uç noktayı başka bir kaynağa (origin) yönlendirirse Testnizer yönlendirmeyi
izler ama kimlik bilgisi başlıklarınızı (Authorization, API anahtarları, cookie'ler)
yeni kaynağa yeniden göndermez.

**Yapılandırma yapıştır…** (Bağlan'ın yanındaki menü) bir sunucuyu Claude
Desktop, VS Code (`.vscode/mcp.json`) veya Cursor (`.cursor/mcp.json`)
yapılandırmasından ya da tek bir sunucu nesnesinden içe aktarır.
**Yapılandırmayı dışa aktar** mevcut sunucuyu aynı biçimlerde yazar; çıktı gizli
bilgi içerebilir ve Testnizer bunu belirtir.

## Yetenek listesi

Sol panelde sayaçlı **Araçlar**, **Kaynaklar** ve **İstemler** sekmeleri ve bir
arama kutusu (ad, açıklama, URI) vardır. Kaynak **şablonları** Kaynaklar
altında listelenir. Bir girdiyi seçmek onu **Gezgin**'de açar.

## Araç çağırma

![Streamable HTTP üzerinden bağlı MCP sekmesi: search_orders aracı, JSON argümanları ve sonucu](/docs/screenshots/mcp-tool-call.png)

1. Bir araç seçin. Açıklaması, sunucunun ipuçları (**salt okunur**, **yıkıcı**,
   **idempotent**, **açık dünya**) ile **Girdi şeması** ve **Çıktı şeması**
   gösterilir.
2. **Argümanlar**'ı doldurun. **Form** görünümü girdi şemasından üretilir
   (string, sayı, boolean, enum, dizi, iç içe nesne, varsayılan değerler); ham
   nesneyi düzenlemek için **JSON**'a geçin. Formun ifade edemediği şemalar
   (`oneOf` / `anyOf` / `allOf`, `$ref`, `patternProperties`, nesne listeleri,
   tipsiz alanlar) JSON'a düşer. Değerler `{{değişken}}` kullanabilir
   (`{"path": "{{workspaceRoot}}/file.txt"}`); `"{{n}}"` gibi bir string, şema
   sayı istiyorsa sayıya çevrilir.
3. **Çalıştır**'a tıklayın (ya da Ctrl/Cmd+Enter). Argümanlar şemaya uymuyorsa Testnizer sorunları
   listeler ve **Yine de çalıştır** sunar.
4. Sonuç altta **JSON** veya **Önizleme** (metin, görsel, ses, gömülü kaynak,
   yapılandırılmış içerik) olarak görünür. `isError` bildiren bir araç **Araç
   hatası** olarak gösterilir. Süren bir çağrı iptal edilebilir; bağlantı açık
   kalır. Bir sunucu bitiş işaretinden önce biten bir görsel gönderirse sonuçta
   boyut ve türle birlikte **Sunucu eksik görsel verisi gönderdi** yazar ve
   **Geldiği gibi indir** baytları geldikleri haliyle kaydeder.

**Farklı kopyala…** çağrıyı panoya JSON-RPC isteği olarak, Streamable HTTP için
ayrıca cURL olarak koyar.

## Kaynak okuma ve istem getirme

- **Kaynaklar** — bir kaynak seçip **Oku**'ya basın. **Şablon** ise önce
  URI içindeki `{yer tutucuları}` değiştirin. İçerik (metin, JSON, indirme
  düğmeli ikili veri) **İçerik** altında görünür.
- **İstemler** — bir istem seçin, **Argümanlar**'ı doldurun (zorunlu olanlar
  denetlenir) ve **İstemi getir**'e basın. Dönen **Mesajlar** `kullanıcı` /
  `asistan` rolüyle gösterilir.

## Sunucu sizden bilgi istediğinde

Bir sunucu çağrıyı durdurup size bir şey sorabilir (elicitation veya MCP
2026-07-28'de çok adımlı `input_required` turu). Sunucunun isteğinden kurulan
bir formla bir girdi kartı çıkar: **Kabul et** / **Gönder**, **Reddet** veya
**İptal**; gönderilecek olanın önizlemesi ve ham istek de gösterilir. Yanıtınız
geri gönderilir ve çağrı devam eder.

## Messages: bildirimler ve çerçeveler

**Messages** paneli (yeniden boyutlandırmak için üst kenarını sürükleyin) iki
sekmeden oluşur:

- **Bildirimler** — sunucunun gönderdiği `list_changed` gibi bildirimler. MCP
  2026-07-28'de bir rozet `subscriptions/listen` akışını ve sunucunun hangi
  bildirimleri göndermeyi kabul ettiğini gösterir.
- **Çerçeveler** — bu bağlantının ham JSON-RPC mesajları, iki yönde.

İkisinde de filtre, seçili girdi için **Kopyala**, **Dışa aktar** (görünen
girdiler, JSON olarak), **Temizle** ve **Otomatik kaydır** vardır. Yalnızca
bellekte tutulurlar ve uygulamadan çıkınca silinirler.

## Yetkilendirme, başlıklar, betikler ve ayarlar

- **Yetkilendirme** — Kimlik Doğrulama Yok, Basic, Bearer, API Key (header veya
  sorgu) ya da **OAuth 2.1**; sonuncusu [aşağıda](#oauth-21-hata-ayıklayıcısı)
  anlatılan adım adım hata ayıklayıcıyı açar. stdio'da kullanılmaz.
- **Başlıklar** — Streamable HTTP ve SSE için özel başlıklar; bağlanırken ve her
  çağrıyla gönderilir. `{{değişken}}` kabul ederler. Buradaki açık bir satır,
  Yetkilendirme sekmesinin ekleyeceği başlığa üstün gelir.
- **Ortam** — stdio sunucu süreci için ortam değişkenleri.
- **Betikler / Testler** — bir HTTP isteğindekiyle aynı istek öncesi ve yanıt
  sonrası betikler ile doğrulamalar. Sonuç `pm.response` (sonuç için 200, araç
  hatası için 500) ve `pm.mcp` olarak kullanılabilir.
- **Ayarlar** — ms cinsinden istek zaman aşımı (boş = varsayılan 120 sn, `0` =
  sınırsız). Her araç çağrısını, kaynak okumayı ve istem almayı sınırlar;
  sunucudan gelen ilerleme bildirimleri süreyi yeniden başlatır. İstekle birlikte
  kaydedilir ve hem Gönder hem Çalıştır tarafından kullanılır.

Çağrılar istekle birlikte kaydedilir (Ctrl+S) ve kimlik bilgileri maskelenerek
Geçmiş'e yazılır.

## OAuth 2.1 hata ayıklayıcısı

Yetkilendirme sekmesinde **OAuth 2.1**'i seçin (ya da Bağlan `401` aldığında
çıkan öneriyi izleyin); yetkilendirme el sıkışmasını her adımın isteği ve yanıtı
görünür halde, adım adım yürütün:

1. **Kimlik doğrulamasız yoklama** — sunucunun `401` yanıtı ve `WWW-Authenticate`
   meydan okuması. Sunucu kimlik doğrulamasız bir isteği kabul ederse hata
   ayıklayıcı, yetkilendirme gerektirmediğini söyler.
2. **Korunan Kaynak Meta Verisi** (RFC 9728)
3. **Yetkilendirme Sunucusu Meta Verisi** (RFC 8414)
4. **İstemci kaydı** (RFC 7591) — dinamik kayıt için **İstemci kimliği**ni boş
   bırakın, ya da bir istemci kimliği ve isteğe bağlı bir **istemci sırrı** girin.
5. **PKCE + yetkilendirme URL'si**
6. **Tarayıcıda oturum açma + loopback yönlendirme**
7. **Belirteç değişimi**

**Kapsam**ı girin ya da sunucunun bildirdiklerini istemek için boş bırakın. Akış
bitince bir özet; veren (issuer), istemci kimliği, belirteç türü, son kullanma,
kapsam ve bir yenileme belirtecinin dönüp dönmediğini gösterir; **Belirteçle
bağlan** onunla bağlanır. **Belirteci unut** onu atar.

Belirteçler, PKCE doğrulayıcısı ve istemci sırrı Testnizer ana süreç belleğinde
kalır. Arayüz katmanına hiçbir zaman ulaşmazlar ve istekle birlikte OAuth'a ait
hiçbir şey kaydedilmez.

- **İstemci sırrının gideceği yer.** Yetkilendirme sunucusu ya da belirteç uç
  noktası MCP sunucusundan farklı bir host'taysa hata ayıklayıcı tarayıcıyı
  açmadan önce durur ve **İstemci sırrınız bu yetkilendirme sunucusuna
  gönderilsin mi?** diye sorar. MCP sunucusu, yetkilendirme sunucusu ve belirteç
  uç noktası kaynaklarını listeler. Sırrınız yalnızca **Onayla ve devam et**'ten
  sonra gider; yanıt o host kombinasyonu için Testnizer kapanana kadar hatırlanır
  ve belirteç yenileme asla sormaz.
- **Düz HTTP yetkilendirme sunucuları.** `http://` üzerindeki bir yetkilendirme
  sunucusu reddedilir. Güvendiğiniz bir intranet sunucusu için o istekte **Düz
  HTTP yetkilendirme sunucusuna izin ver (intranet)** kutusunu işaretleyin. İzin,
  MCP sunucusunun kendisinin bildirdiği yetkilendirme sunucusu host'uyla sınırlıdır;
  başka her host veya port yine HTTPS ister. Anahtardaki uyarı şifrelenmeden nelerin
  gittiğini söyler: yetkilendirme kodu, PKCE doğrulayıcısı, istemci sırrı ve
  belirteçler.

## MCP isteklerini Runner'da, Test Paketlerinde ve Zamanlayıcı'da çalıştırma

Kayıtlı bir MCP çağrısı bir koleksiyonda, bir test paketinde ya da bir zamanlamada
diğer istekler gibi çalışır. Gönder ile aynı geçti/kaldı kurallarını ve aynı
`pm.*` betiklerini ile **Testler** sekmesini (`pm.response` ve `pm.mcp` ile)
kullanır. İsteğin kendi zaman aşımı geçerlidir.

Bir çalıştırma soruyu yanıtlayamaz. Bir çağrı oturum açma gerektiriyorsa ya da
sunucu çağrı sırasında girdi isterse (`input_required`, elicitation), o satır
beklemek yerine açık bir mesajla başarısız olur.

**stdio** isteği bir komut satırıdır; bu yüzden çalıştırma onu yalnızca bu
bilgisayarda MCP sekmesinden o komuta, aynı ortam değişkenleriyle bağlanmışsanız
başlatır. Git'ten çekilen bir proje bir sonraki çalıştırmanızın bilinmeyen bir
programı başlatmasını sağlayamaz; satır nedenini açıklayan bir mesajla başarısız
olur.

## Güvenlik taraması

Gezgin'in yanındaki **Güvenlik** sekmesi bir MCP sunucusunu A'dan F'ye notlandırır.
Sol paneldeki **Güvenlik** sayfasından da ulaşabilirsiniz: orada **MCP Güvenlik
Taraması** bir MCP isteğinin Güvenlik sekmesini açar (açık biri yoksa yenisini).
**Yalnızca test etmeye yetkili olduğunuz sunucuları tarayın.**

Tarama bilgisayarınızdan çalışır ve yalnızca işaret ettiğiniz sunucuya istek
gönderir; Testnizer'a ya da üçüncü bir tarafa hiçbir şey gitmez ve hiçbir yapay
zekâ modeli devreye girmez. **Streamable HTTP ve SSE** sunucularında çalışır. stdio
sunucusunda sekme, taramanın uygulanmadığını söyler.

### Tarama çalıştırma

Tarama bağlantı çubuğundaki URL'yi hedefler. Bağlan'ın yaptığı gibi, bu sekmenin
Yetkilendirme ayarları, başlıkları ve OAuth belirteciyle kimlik doğrular (bir
belirteç kullanılıyorsa "Bu sekmenin OAuth belirtecini kullanır" görünür); ayrıca
isimsiz bir çağıranın ne elde ettiğini görmek için bazı istekleri kimlik bilgisi
**olmadan** gönderir. Önce bağlanmanız gerekmez.

![Tarama sonrası MCP Security sekmesi: A notu, 97/100 puan ve taşıma güvenliği kontrolleri](/docs/screenshots/mcp-security-scan.png)

**Tara**'ya basın. Bir ilerleme çubuğu `yapılan / toplam kontrol` ve çalışan
kontrolü gösterir; **İptal** durdurur ve çalışmayan kontroller atlandı olarak
işaretlenir.

**Etkin yoklamaları dahil et** varsayılan olarak kapalıdır. Daha fazla trafik
gönderen ve sunucuda çağrı yapan iki şey ekler: yaklaşık 30 hızlı istekten oluşan
bir hız sınırı yüklemesi ve 2026-07-28 sunucusunda `requestState` bütünlüğünü
sınamak için argüman almayan, salt okunur işaretli (ya da işaretsiz olup adı yazma
işlemine benzemeyen, yıkıcı işaretli olanlar asla) araçların çağrılması. Bunu
yalnızca test etmeye yetkili olduğunuz sunucularda açın.

### Ne kontrol edilir

Tarama sekiz kategoride 30 kontrol içerir (her zaman çalışan 28 kontrol, artı
etkin yoklamalar açıkken iki hız sınırı girdisi) ve protokol 2026-07-28 konuşan
sunucular için altı kontrol daha içerir. 2025 dönemi bir sunucuda bu altısı atlandı
olarak listelenir.

| Kategori | Neye bakar |
|---|---|
| **Taşıma güvenliği** | HTTPS (loopback adresinde düz HTTP yalnızca not edilir); TLS sürümü ve sertifika (eski protokol, süresi dolmuş ya da henüz geçerli olmayan sertifika, host adı uyuşmazlığı, güvenilmeyen zincir); aynı host'un 80 portunda düz HTTP'nin reddedilip reddedilmediği (varsayılan HTTPS portundaki sunucular için denenir); uç noktanın başka bir kaynağa yönlendirip yönlendirmediği |
| **Kimlik doğrulama ve yetkilendirme** | Kimlik doğrulamasız bir el sıkışmanın reddedilip reddedilmediği; `WWW-Authenticate` meydan okuması; Korunan Kaynak Meta Verisi (RFC 9728); yetkilendirme sunucusu meta verisi (RFC 8414) ve uç noktalarının HTTPS kullanıp kullanmadığı; sorgu dizesindeki erişim belirteçleri |
| **Protokol uyumu** | El sıkışma sonucu; `tools/list`'in iki çağrıda aynı listeyi döndürmesi; iyi biçimlendirilmiş araç şemaları; bilinmeyen bir metodun JSON-RPC `-32601` ile yanıtlanması; JSON-RPC toplu (batch) isteklerinin reddedilmesi |
| **İstem enjeksiyonu ve araç zehirleme** | Modelin okuduğu metne (araç, istem ve kaynak açıklamaları) sezgisel bakış: talimatı geçersiz kılan ifadeler, gizli Unicode (sıfır genişlikli, çift yönlü ve tag karakterleri), URL ve IP adresleri, aşırı uzun açıklamalar, birbirine benzeyen araç adları ve gizli bilgi benzeri parametreler |
| **Bilgi ifşası** | Hata yanıtlarında yığın izi ya da dosya yolu; `Server` ve `X-Powered-By` başlıkları; `serverInfo` ve talimatların ne kadar şey açığa çıkardığı |
| **CORS** | Uydurma bir kaynaktan gelen çapraz kaynak ön denetimi (preflight) ve isteği: `*`, yansıtılan bir `Origin` ve böyle bir kaynağa izin verilen kimlik bilgileri |
| **Güvenlik başlıkları** | `Strict-Transport-Security`, `X-Content-Type-Options`, yanıtın `Content-Type`'ı ve `Cache-Control: no-store` |
| **Hız sınırlama** | Sunucunun bir istek yığılması karşısında karşılık verip vermediği (HTTP `429`, `Retry-After` ya da `RateLimit` başlıkları). Yalnızca etkin yoklamalarla; aksi halde tek bir girdi yoklamanın çalıştırılmadığını söyler |

2026-07-28 sunucuları için ek kontroller `server/discover`'ı, `Mcp-Method`
başlığının istek gövdesiyle doğrulanmasını, liste sonuçlarındaki önbellek
ipuçlarını (`ttlMs`, `cacheScope`), kimlik doğrulamalı sonuçların paylaşımlı
önbelleklerce önbelleğe alınabilir işaretlenmesini, yeni protokolün yanında 2025
`initialize`'ın hâlâ çalışıp çalışmadığını ve `requestState` kurcalamasını (etkin
bir yoklama) kapsar.

### Sonucu okuma

Rapor **notu**, 100 üzerinden **puanı**, kaç kontrolün **başarılı** olduğunu,
**uyarı** verdiğini, **başarısız** olduğunu, **bilgi** niteliğinde olduğunu ya da
**atlandığını** ve oturumun protokol dönemini (**MCP 2025** ya da **2026-07-28
(modern)**) gösterir. Bulgular kategoriye göre gruplanır, her birinin kendi puanı
vardır. Bir bulguyu açınca ayrıntısını, onu üreten isteği ve yanıtı, içerik
sezgisinin eşleştirdiği metinleri, bir **Öneri**yi ve ilgili spesifikasyonlara
**Kaynaklar**ı görürsünüz.

Not nasıl hesaplanır: puan 100'den başlar. Başarısız her kontrol önem derecesine
göre bir ağırlık düşer (kritik 25, yüksek 15, orta 8, düşük 3, bilgi 0); bir uyarı
bunun yarısını düşer. Başarılı, bilgi ve atlanan kontroller bir şey düşmez. Puan
bir nota çevrilir: **A** 90'dan, **B** 80'den, **C** 65'ten, **D** 50'den başlar,
altı **F**'dir. Sunucu hiç yanıt vermezse hiçbir şey doğrulanamaz; bu yüzden not 0
puanla F olur ve rapor sunucuya ulaşılamadığını söyler. İptal edilen ya da
listeleri tarama sınırında kesilen bir tarama kısmi sonuç olarak işaretlenir.

Kimlik bilgileri hiçbir bulguda görünmez. Kimlik bilgisi başlıkları adlarına göre
değiştirilir ve tel üzerinde görülen her kimlik bilgisi değeri (Authorization
başlığınız, API anahtarları, OAuth belirteci) kanıttan, canlı bulgulardan ve
rapordan silinir.

**HTML raporu kaydet…** raporu tek ve kendi içinde tam bir HTML dosyası olarak
yazar. Dosya "yalnızca yetkili sunucular" uyarısını yineler ve sonucun tek bir
sunucunun belirli bir andaki otomatik, sezgisel kontrollerinden geldiğini, bir
sızma testi ya da sertifikasyon olmadığını belirtir. Tarama sonucu sekmede durur;
istekle birlikte kaydedilmez.

## Bağlantıyı kesme

Transport'u kapatmak için **Bağlantıyı Kes**'e tıklayın. stdio'da bu, alt süreci
de sonlandırır. Listeler temizlenir.

## Çoklu sekme yalıtımı

Her MCP sekmesi kendi bağlantısını, transport'unu, listelerini, seçimini,
sonucunu ve mesajlarını korur. İki sunucu uygulamasını yan yana karşılaştırmak
veya uzun süreli bir stdio sunucusunu bağlı tutarken bir HTTP sunucusu üzerinde
iterasyon yapmak için birden çok sekme açın. Sekmeyi kapatmak bağlantıyı da
keser.

## Güvenlik notları

- **stdio transport süreçleri başlatır.** Yalnızca güvendiğiniz komutları
  çağırın — Testnizer alt süreci host işletim sisteminin sağladığının
  ötesinde sandbox'layamaz. Runner, Test Suite'ler ve Zamanlayıcı bir stdio
  sunucusunu yalnızca bu bilgisayarda MCP sekmesinden o komuta (ortamı dahil)
  bağlanmışsanız başlatır; git'ten çekilen bir proje kendi başına komut
  çalıştıramaz.
- **Uzak MCP sunucuları** Testnizer'ın IP adresini ve bir araca ilettiğiniz
  argümanları görür. Harici bir hizmete yapılan herhangi bir HTTP API
  çağrısıyla aynı şekilde değerlendirin.
- **Otomatik olarak hiçbir gizli bilgi gönderilmez.** Kimlik bilgileri yalnızca
  **Yetkilendirme** sekmesinde ayarladığınız kimlik doğrulama (Kimlik Doğrulama Yok,
  Basic, Bearer, API Key veya OAuth 2.1) ya da eklediğiniz header'lar için gider.
- **OAuth istemci sırrınız beklemediğiniz bir sunucuya gönderilmez.**
  Yetkilendirme sunucusu başka bir host'taysa hata ayıklayıcı önce sorar; bkz.
  [OAuth 2.1 hata ayıklayıcısı](#oauth-21-hata-ayıklayıcısı).
