---
title: MCP (Model Context Protocol)
description: Testnizer bir MCP istemcisidir. MCP sunucularına Streamable HTTP, SSE veya stdio üzerinden bağlanın; araçları çağırın, kaynakları okuyun, istemleri getirin, bildirimleri izleyin ve sunucuyu tarayın.
order: 9
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
  olmazsa MCP 2025'e (`initialize`) düşer.
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
3. **Çalıştır**'a tıklayın. Argümanlar şemaya uymuyorsa Testnizer sorunları
   listeler ve **Yine de çalıştır** sunar.
4. Sonuç altta **JSON** veya **Önizleme** (metin, görsel, ses, gömülü kaynak,
   yapılandırılmış içerik) olarak görünür. `isError` bildiren bir araç **Araç
   hatası** olarak gösterilir. Süren bir çağrı iptal edilebilir; bağlantı açık
   kalır.

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
  sorgu) ya da **OAuth 2.1**. OAuth 2.1 seçeneği tüm akışı adım adım yürütür —
  keşif, istemci kaydı, PKCE, tarayıcıda oturum açma ve belirteç değişimi —
  nerede koptuğunu gösterir, ardından **Belirteçle bağlan** denir. Belirteç
  yalnızca Testnizer ana süreç belleğinde kalır: hiçbir zaman gösterilmez ya da
  kaydedilmez. stdio'da kullanılmaz.
- **Başlıklar** — Streamable HTTP ve SSE için özel başlıklar.
- **Ortam** — stdio sunucu süreci için ortam değişkenleri.
- **Betikler / Testler** — bir HTTP isteğindekiyle aynı istek öncesi ve yanıt
  sonrası betikler ile doğrulamalar. Sonuç `pm.response` (sonuç için 200, araç
  hatası için 500) ve `pm.mcp` olarak kullanılabilir.
- **Ayarlar** — ms cinsinden istek zaman aşımı (boş = varsayılan 120 sn, `0` =
  sınırsız).

Çağrılar istekle birlikte kaydedilir (Ctrl+S) ve kimlik bilgileri maskelenerek
Geçmiş'e yazılır.

## Güvenlik taraması

Gezgin'in yanındaki **Güvenlik** sekmesi sunucuyu çevrimdışı bir A–F taramasından
geçirir (yalnızca Streamable HTTP ve SSE): transport güvenliği, yetkilendirme,
protokol uyumu, prompt injection ve araç zehirleme sezgileri, bilgi ifşası, CORS,
güvenlik başlıkları ve hız sınırlama. Bu sekmenin başlıklarını ve OAuth
belirtecini kullanır, bulguları kategoriye göre öneriyle birlikte gösterir ve
bir **HTML raporu** kaydedebilir. **Yalnızca test etme yetkiniz olan sunucuları
tarayın.**

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
- **OAuth istemci sırrınız beklemediğiniz bir sunucuya gönderilmez.** OAuth
  hata ayıklayıcısında **istemci sırrı** olan elle girilmiş bir istemci, MCP
  sunucusunun kendisinin bildirdiği yetkilendirme sunucusuyla konuşur. Bu sunucu ya
  da belirteç uç noktası MCP sunucusundan **farklı bir sunucuda (host)** ise
  hata ayıklayıcı tarayıcıyı açmadan önce durur ve sorar: **İstemci sırrınız bu
  yetkilendirme sunucusuna gönderilsin mi?** **MCP sunucusu**, **Yetkilendirme
  sunucusu** ve **Belirteç uç noktası** kaynaklarını gösterir; sırrınız oraya yalnızca
  **Onayla ve devam et**'ten sonra gider, **İptal** akışı net bir adım hatasıyla
  bitirir. Yanıtınız o sunucu kombinasyonu için Testnizer kapanana kadar hatırlanır —
  başka bir sunucu yeniden sorar — ve belirteç yenileme asla sormaz. Aynı sunucudaki
  yetkilendirme sunucuları, genel (public) istemciler ve dinamik istemci kaydı
  sormaz. Sırrın kendisi arayüz katmanına hiçbir zaman ulaşmaz.
