---
title: Mock sunuculara genel bakış
description: Mock sunucular, Testnizer içinde 127.0.0.1 üzerinde çalışan gerçek sunuculardır. Dört tür var (HTTP, SSE, AI (LLM) ve MCP); hazır şablonlar, içe aktarma, canlı istek günlüğü ve bilgisayarınızda kalan gizli değerler.
order: 1
section: Mock sunucular
---

Testnizer'daki **mock sunucu**, uygulamanın içinde çalışan ve sizin tanımladığınız
yanıtları veren gerçek bir sunucudur. Bilgisayarınızda bir portu dinler; bu yüzden
her istemci onu çağırabilir: tarayıcınız, `curl`, geliştirmekte olduğunuz bir
frontend, bir SDK ya da Testnizer'daki başka bir istek sekmesi.

Şunlar için kullanın:

- Henüz var olmayan bir backend'in yerine geçmek
- Kararsız upstream davranışını (gecikme, 5xx, kimlik doğrulama hataları, yarıda
  kopan bir akış) istediğiniz an yeniden üretmek
- Yakalanmış trafiği çevrimdışı tekrar oynatmak
- Bir istemcinin hata yönetimini kesin HTTP durum kodlarıyla denemek
- Gerçek bir sunucuya dokunmadan ve token harcamadan bir AI ya da MCP istemcisini
  denemek

Sunucu **varsayılan olarak 127.0.0.1** üzerinde dinler; yani yalnızca bilgisayarınız
ona ulaşabilir. Ağınızdan erişilebilmesi için `0.0.0.0`'ı bilerek seçmeniz gerekir;
seçtiğinizde editör sizi uyarır.

Mock sunucuları sol kenar çubuğunda **Mock'lar** simgesinin altında bulursunuz.

![Mock Server editörü - uç nokta paneli, tam URL çubuğu, koşul / betik editörleri ve canlı yanıt önizlemesi](/testnizer-mock.png)

## Dört tür

| Tür | Ne sunar | Neyle açarsınız | Sayfa |
|---|---|---|---|
| **HTTP** | Kural tabanlı yanıtlar, betikler, kimlik doğrulama, hata enjeksiyonu ve kayıt yapan proxy ile REST tarzı uç noktalar | **İstek sekmesinde aç** | [HTTP mock sunucu](/tr/docs/mock-server/http) |
| **SSE** | Zamanlanmış olaylar, id'ler, heartbeat ve yeniden bağlanma davranışı olan bir Server-Sent Events akışı | **SSE sekmesinde aç** | [SSE mock sunucu](/tr/docs/mock-server/sse) |
| **AI** | Hazır yanıtları akışla gönderen, OpenAI ve Anthropic uyumlu bir sohbet API'si | **AI Chat sekmesinde aç** | [AI (LLM) mock sunucu](/tr/docs/mock-server/ai) |
| **MCP** | Araçlar, kaynaklar ve istemler sunan bir Model Context Protocol sunucusu | **MCP sekmesinde aç** | [MCP mock sunucu](/tr/docs/mock-server/mcp) |

HTTP, SSE ve AI sunucuları aynı HTTP motorunda çalışır. Tür; editörün hangi hazır
şablonları, gövde türlerini ve **...sekmesinde aç** düğmelerini sunacağını ve
sunucunun kenar çubuğunda hangi bölümde listeleneceğini belirler. Türü sonradan
sunucunun Ayarlar sekmesinden (**Sunucu tipi**) uç noktalarınızı ve yanıtlarınızı
kaybetmeden değiştirebilirsiniz; çalışan sunucu çalışmaya devam eder. MCP mock
sunucusu ayrı bir sunucu türüdür ve kendi editörü vardır.

Kenar çubuğu sunucuları türe göre gruplar: **HTTP sunucuları**, **MCP sunucuları**,
**SSE sunucuları** ve **AI sunucuları**.

## Sunucu oluşturma

![Yeni mock sunucu menüsüyle Mocks kenar çubuğu: HTTP, MCP, SSE ve AI](/docs/screenshots/mock-server-new-menu.png)

Mock'lar panelinin üstündeki **+** düğmesine ya da boş Mock'lar sayfasındaki
**Yeni mock sunucu** düğmesine tıklayın. Tek bir pencere her türü oluşturur:

1. **Sunucu türü**: HTTP, MCP, SSE veya AI. Anahtarın altındaki satır türün ne
   işe yaradığını söyler.
2. **Başlangıç noktası**: o tür için bir hazır şablon ya da **Boş**. Her şablon
   neyi oluşturduğunu listeler. Şablonlar için ilgili türün sayfasına bakın.
3. **Ad**: benzersiz bir adla önceden doldurulur.
4. **Port**: boş bir portla önceden doldurulur. Öneri HTTP için 3001'den, MCP için
   3100'den, SSE için 3200'den, AI için 3300'den başlar. Alan siz yazarken
   denetlenir: bu projedeki başka bir mock sunucunun kullandığı port uyarı verir,
   1024'ün altındaki portlar bilgisayarınızda yükseltilmiş izin gerektirebilir.

**Oluştur**'a (ya da Enter'a) basın. Sunucu durdurulmuş olarak oluşturulur;
dinlemesi için başlığındaki **Başlat**'a basın. Sunucular birbirinden bağımsızdır:
uç noktalar, bellekteki durum, günlükler ve hız limiti sayaçları tek bir sunucuya
aittir. Boş port sayınız kadar sunucu çalıştırabilirsiniz.

### Dosyadan içe aktarma

HTTP mock için **Başlangıç noktası** ayrıca **Dosyadan içe aktar** seçeneğini
sunar. OpenAPI 3.x ya da Swagger 2.0 belirtimi veya JSON ya da YAML biçiminde bir
Postman v1, v2.x veya v3 koleksiyonu seçin. Testnizer biçimi tanır, ne bulduğunu
gösterir ve sunucuya belirtimin adını verir. Belirtim olmayan ya da mock'lanacak
bir şey içermeyen dosya, sunucu daha oluşmadan reddedilir; başarısız bir içe
aktarma arkasında boş sunucu bırakmaz. Ayrıntılar [HTTP mock sunucu](/tr/docs/mock-server/http) sayfasında.

### Kayıtlı isteklerden oluşturma

APIs panelinde bir klasöre, projeye ya da isteğe sağ tıklayıp **Bu klasörden Mock
Sunucu oluştur** (ya da *proje*, *istek*) seçeneğini seçin. Her HTTP isteği, isteğin
yolunu bağlayan bir uç nokta olur; her kayıtlı örnek bir yanıt olur. Örneği olmayan
istek boş bir `200` döndürür. Diğer protokollerin istekleri atlanır; eylemi
bitiren mesaj eklenemeyen her şeyi listeler. Eski bir sürümün oluşturduğu mock eski
uç noktalarını korur; yol tabanlı uç noktaları almak için yeniden oluşturun.

## Başlatma, durdurma ve adres

Her editörün başlığı sunucunun adını, bir durumu (**çalışıyor**, **başlıyor**,
**hata** ya da **durdu**), kopyalama düğmeli temel URL'yi ve **Başlat** / **Durdur**
düğmesini gösterir. Host'u, portu ve temel yolu Ayarlar sekmesinde belirlersiniz.

- Başka bir projeye geçseniz de mock sunucular çalışmaya devam eder. Başka bir
  sunucunun tuttuğu port (başka bir projeye ait olsa bile) kullanmaya çalıştığınızda
  adıyla bildirilir.
- Çalışan bir sunucunun host'unu ya da portunu değiştirirseniz ve yeni adres doluysa
  sunucu eski adresinde kalır ve hangi portun kimde olduğunu söyler. "Çalışıyor"
  yazısıyla yeni bir port göstermez.
- `0.0.0.0` üzerindeki sunucuya diğer makineler erişebilir. HTTP editörü bunun
  sunucuyu ağınıza açtığını söyleyerek uyarır; bearer token'ı olmayan bir MCP mock'u,
  yerel olmayan bir adrese bağlıyken ikinci bir uyarı gösterir.

## Bir mock'u sekmede açma

Her türün, Testnizer'ın kendi editörlerinden birini mock'a yönelten bir düğmesi var:

- **HTTP**: bir uç noktadaki **İstek sekmesinde aç**, her yöntem, header, gövde ve
  kimlik doğrulama seçilebilen sıradan bir HTTP isteği açar. Gönderip kaydedebilirsiniz.
  Sunucu durmuşsa düğme **Başlat ve istek sekmesinde aç** olur ve sekmeyi yalnızca
  sunucu başladıysa açar.
- **SSE**: **SSE sekmesinde aç** / **Başlat ve SSE sekmesinde aç**.
- **AI**: **AI Chat sekmesinde aç** ve **AI Chat sekmesinde aç (Anthropic)**. Bu
  sekmeler kayıtlı sağlayıcı anahtarınızı mock'a göndermez ([AI mock sunucu](/tr/docs/mock-server/ai) sayfasına bakın).
- **MCP**: **MCP sekmesinde aç** / **Başlat ve MCP sekmesinde aç**, sunucunun URL'si
  önceden doldurulmuş olarak.

O mock için bir sekme zaten açıksa **Başlat ve aç** onu yeniden kullanır.

## Canlı istek günlüğü

**Loglar** sekmesi sunucunun yanıtladığı her isteği listeler: zaman, yöntem, yol,
durum ve gecikme. İstek ve yanıt header'ları ile gövdeleri için bir satıra tıklayın.
Yalnızca son 500 kayıt bellekte tutulur; uygulamadan çıkınca silinir. Bir akış (SSE
ya da AI) kapanana kadar **akış sürüyor...** olarak işaretlenmiş tek bir satırdır,
her parça için ayrı satır değildir.

![Çalışan bir HTTP mock'un Logs sekmesi: altı istek ve seçilen kaydın isteği ile yanıtı](/docs/screenshots/mock-server-live-log.png)

Günlük History ve Konsol ile aynı biçimde maskelenir: kimlik bilgisi header'ları,
sorgu ve gövde alanları ile secret değişkenlerinizin değerleri saklanmadan önce gizlenir.

## Secret'lar bilgisayarınızda kalır

- **Secret** işaretli bir değişken mock yanıtında asla açılmaz. Secret bir değişken
  için `{{apiKey}}` kullanan şablon `{{apiKey}}` metnini gönderir; bu yüzden mock'u
  çağıran bir istemci onu okuyamaz.
- Mock kimlik doğrulamasındaki token, parola ve API anahtarları ile MCP mock'unun
  bearer token'ı, yerel veritabanında işletim sisteminizin anahtar deposuyla
  şifrelenir. Anahtar deposunun olmadığı kurulumlarda (bazı Linux kurulumları) şifresiz
  saklanır ve uygulama bunu söyler.
- Uygulamadan çıkan her dosyaya (Git, proje dosyaları, dışa aktarmalar) boş değer
  olarak yazılırlar. Pull ya da içe aktarma yerel değerinizin üzerine asla yazmaz.
  Bir takım arkadaşından pull yaptıktan sonra secret'ları kendi bilgisayarınızda
  yeniden girin.
- Kimlik doğrulama kapalı kapıdan çalışır. Kimlik bilgileri boş olan (ya da
  okunamayan) bir mock, istekleri geçirmek yerine reddeder; bearer modunda token'ı
  olmayan bir MCP mock'u başlamaz.
- Hazır şablon, ürettiği token'ı sunucunun açıklamasına kopyalamaz.

## İlgili sayfalar

- [HTTP mock sunucu](/tr/docs/mock-server/http)
- [SSE mock sunucu](/tr/docs/mock-server/sse)
- [AI (LLM) mock sunucu](/tr/docs/mock-server/ai)
- [MCP mock sunucu](/tr/docs/mock-server/mcp)
