---
title: MCP mock sunucu
description: Veri olarak tanımladığınız yerel bir Model Context Protocol sunucusu; araçlar, kaynaklar ve istemler, bearer kimlik doğrulama, gecikme, hata senaryoları, 2025 ve 2026-07-28 istemcileri ve çağrı ortasında girdi isteme.
order: 5
section: Mock sunucular
---

Mock MCP sunucusu; araçları, kaynakları ve istemleri uygulamada düzenlediğiniz veri
olan yerel bir MCP sunucusudur. Bir MCP istemcisi geliştirip test etmek, araçlarınızın
hatalara ve yavaş sunuculara nasıl tepki verdiğini görmek ve [AI Chat](/tr/docs/protocols/ai-chat)'e
kurulum gerektirmeyen bir araç sunucusu vermek için kullanın.

Seçtiğiniz bir yolda (varsayılan `/mcp`) **Streamable HTTP** sunar; açarsanız
`<yol>/sse` adresinde eski **HTTP+SSE** taşımasını da sunar. Tek bir uç nokta hem MCP
2025 istemcilerine (`initialize` el sıkışması) hem de 2026-07-28 istemcilerine cevap
verir. Mock sunucuların genel olarak oluşturulması, başlatılması ve açılması için
[genel bakışa](/tr/docs/mock-server) bakın.

## Hazır şablonlar

Yeni mock sunucu penceresinde bir şablon seçin (tür **MCP**):

| Şablon | Ne oluşturur |
|---|---|
| **Echo** | `text` argümanını geri döndüren tek bir `echo` aracı |
| **Kimlik doğrulama gerekli** | Bearer token zorunlu; aksi her istek HTTP 401 alır |
| **Hata sunucusu** | Her hata türüyle başarısız olan araçlar |
| **Karmaşık şemalar** | İç içe nesneler, diziler, enum'lar ve `oneOf` |
| **Yavaş** | Her istek 1500 ms sonra yanıtlanır |

Yeni sunucu Echo aracıyla başlar; yani hemen işe yarar. Editörün altı sekmesi vardır:
**Genel**, **Senaryolar**, **Araçlar**, **Kaynaklar**, **İstemler** ve **Kayıtlar**.

## Kaydetme

Siz kaydedene kadar düzenlemeler bir taslaktır. Kaydedilmemiş değişikliği olan sekme
bir nokta gösterir; **Kaydet** (ya da istek Kaydet penceresini açmak yerine mock'u
kaydeden **Ctrl/Cmd+S**) tüm sekmeleri yazar. **Kaydedilmemiş değişiklikleri at**
taslağı bırakır. Eklediğiniz ama doldurmadığınız öğeleri kaydederseniz editör önce sorar.

Host, port, yol ya da eski SSE seçeneğini değiştirmek çalışan sunucuyu yeniden
başlatır. Araçlar, kaynaklar, istemler ve senaryolar dahil geri kalan her şey anında uygulanır.

## Genel

- **Host**, **Port** ve **Yol.** Port `0`, her başlatmada boş bir port seçer; başlıktaki
  URL kullanılan portu gösterir. Kimlik doğrulaması olmayan bir sunucuyu yerel olmayan
  bir host'a bağlamak uyarı gösterir, çünkü ağdaki herkes araçları çağırabilir.
- **Eski HTTP+SSE taşımasını da sun (`<yol>/sse`).**
- **Protokol sürümü sabitleme.** Varsayılan *Herhangi biri (müzakere)*. 2025-11-25,
  2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07 ya da 2026-07-28'den birini seçin;
  sunucu yalnızca o sürümü sunar ve başka sürüm isteyen istemcileri geri çevirir. URL'ye
  `?rev=<sürüm>` eklemek, o istek için sabitlemeyi ezer.
- **2025 istemcileri.** *İzin ver (durumsuz)* MCP 2025 istemcilerine oturumsuz hizmet
  verir (`Mcp-Session-Id` yok, `GET` ve `DELETE` 405 döner); bu yüzden "liste değişti"
  bildirimlerini almazlar. *Reddet* sunucuyu yalnızca modern yapar: `initialize`,
  `-32022` JSON-RPC hatasını (desteklenmeyen protokol sürümü) alır. *Reddet* ile eski
  SSE taşıması sunulmaz.
- **Önbellek ömrü (ms).** MCP 2026-07-28 istemcilerinin araç, kaynak ve istem listelerini
  yeniden sormadan ne kadar süre kullanabileceği. `0`, her seferinde yeniden sor demektir.

Başlıktaki bir satır sunucunun şu anda hangi protokol dönemlerine cevap verdiğini
gösterir. **Liste değişti bildir**, listelerini yenilemesi gereken bir istemciyi sınamak
için 2026-07-28 dinleyicilerine ve eski SSE oturumlarına `tools/list_changed` gönderir.

## Senaryolar

- **Kimlik doğrulama.** *Yok* ya da rastgele bir token için **Üret** düğmeli *Bearer
  token*. Bearer modunda geçerli bir `Authorization: Bearer <token>` taşımayan istek,
  `/.well-known/oauth-protected-resource` adresini (RFC 9728) gösteren bir
  `WWW-Authenticate` meydan okumasıyla HTTP 401 alır; böylece
  [MCP OAuth hata ayıklayıcısı](/tr/docs/protocols/mcp) bir 401'den başlayabilir. Token
  bir secret'tır: yerel veritabanında şifrelenir ve proje dosyalarına, Git'e ya da
  dışa aktarmalara asla yazılmaz ([genel bakışa](/tr/docs/mock-server) bakın). Bearer
  modunda token'ı boş olan sunucu başlamaz.
- **Gecikme.** Her JSON-RPC isteğine eklenen, milisaniye cinsinden bir bekleme. Araç
  başına gecikme bunun üstüne biner.
- **Hata enjeksiyonu (`tools/call`).** Bir araç çağrısının ne yapacağını seçin:

  | Mod | Sonuç |
  |---|---|
  | *Yok* | Çağrı normal yanıtlanır |
  | *Protokol hatası (JSON-RPC)* | Belirlediğiniz kod (varsayılan `-32603`) ve mesajla bir JSON-RPC hata nesnesi |
  | *Araç hata sonucu döndürür* | `isError: true` ve mesajınızla normal bir sonuç |
  | *Hiç yanıt verme (zaman aşımı)* | İstemci iptal edene ya da oturum kapanana kadar çağrı yanıt almaz |
  | *HTTP hatası* | Çağrıyı taşıyan HTTP isteği bir durum koduyla (varsayılan 500) yanıtlanır |

  **Her N. çağrıda** hatayı yalnızca her N. çağrıya uygular (sunucu için sunucu başına,
  geçersiz kılma için araç başına sayılır); boş her çağrı demektir. Bir araç kendi **Hata
  geçersiz kılma** ayarına sahip olabilir ya da sunucu ayarını kendisi için kapatabilir.

## Araçlar

Her aracın bir adı, isteğe bağlı bir başlığı ve açıklaması, bir **Girdi şeması**
(JSON Schema, `"type": "object"`) ve bir yanıtı vardır. Şema istemcilere yazdığınız gibi
duyurulur ve çağrı argümanları ona karşı doğrulanır (varsayılan draft-07; `$schema`
2019-09 ya da 2020-12 bildiren şema o lehçeyi kullanır; `format` zorlanmaz).

Yanıt **Türü** şunlardan biridir:

- **Metin**: tek bir metin içerik bloğu olarak olduğu gibi döner.
- **JSON**: metin artı `structuredContent` olarak döner. Geçerli JSON olmalıdır; nesne
  olmayan bir değer `{ "result": ... }` içine sarılır.
- **Şablon**: her çağrıda işlenir. Değişkenler: `{{args.x}}` (bir çağrı argümanı),
  `{{now}}` (ISO zamanı), `{{timestamp}}` (epoch ms), `{{uuid}}`, `{{$randomUUID}}` ve
  diğer dinamik değişkenler, `{{tool}}` (çağrılan araç adı), `{{headers.x}}` (bir istek
  header'ı, küçük harfli ad) ve etkin ortamın değişkenleri.

**Sonucu isError olarak işaretle**, aracın başarısızlık işaretli bir sonuç döndürmesini
sağlar. **Ek gecikme (ms)** o araca gecikme ekler.

### İstemciden girdi isteme

Bir araç yanıt vermeden önce girdi isteyebilir (**Girdi iste (MCP 2026-07-28)**). Bir
anahtar ve bir mesaj verin, sonra alan ekleyin (string, number, integer, boolean ya da
enum). 2026-07-28 istemcisi önce bir `input_required` sonucu alır, bir form gösterir ve
çağrıyı cevapla yeniden dener; kabul edilen değerler yanıtta `{{input.<alan>}}` olarak
kullanılabilir ve cevaptan sonra için ayrı bir yanıt şablonu belirleyebilirsiniz. MCP
2025 istemcisi bunun yerine kısa bir metin notu alır, çünkü mock sunucudan başlatılan
bir istek göndermez. **İsim sor (girdi isteme)** hazır aracı, bir isim isteyen ve sonra
onunla selamlayan bir araç ekler. [MCP istemcisi](/tr/docs/protocols/mcp) formu gösterir ve cevabınızı geri gönderir.

## Kaynaklar ve istemler

- **Kaynaklar**, ya sabit bir **URI** ya da `{var}` yer tutuculu bir **URI şablonu**dur;
  bir adı, bir MIME türü ve metin içeriği vardır. Şablonda metin, eşleşen değerleri
  `{{params.var}}` olarak okuyabilir.
- **İstemler**in bir adı, bir açıklaması, argümanları (her biri isteğe bağlı olarak zorunlu)
  ve `user` ya da `assistant` rollü bir ya da daha fazla mesajı vardır. Mesaj metni
  argümanları `{{args.ad}}` olarak okuyabilir.

## Kayıtlar ve deneme

**Kayıtlar** sekmesi her JSON-RPC isteğini zamanı, yöntemi, aracı, süresi ve sonucuyla,
ayrıca istek ve yanıt metniyle listeler. Son 500 kayıt bellekte tutulur. Girdi için
duraklayan bir çağrı `input_required` ile işaretlenir; bir satırın üzerine gelmek
hizmet verilen protokol dönemini gösterir.

Başlık **Streamable HTTP** URL'sini ve eski SSE açıkken **SSE (eski)** URL'sini
gösterir; her birinin kopyalama düğmesi vardır. **MCP sekmesinde aç**, Testnizer'ın
[MCP istemcisini](/tr/docs/protocols/mcp) URL doldurulmuş olarak açar; **Başlat ve MCP
sekmesinde aç** önce sunucuyu başlatır.

## İlgili sayfalar

- [MCP istemcisi](/tr/docs/protocols/mcp): bağlanma, araç çağırma, OAuth hata ayıklayıcısı ve güvenlik taraması
- [AI mock sunucu](/tr/docs/mock-server/ai): araç çağrısı şablonları buradaki Echo şablonuyla eşleşir
