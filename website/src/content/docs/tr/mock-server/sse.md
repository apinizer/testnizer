---
title: SSE mock sunucu
description: Olay olay tanımladığınız bir Server-Sent Events akışı; zamanlama, id'ler, heartbeat, döngü, Last-Event-ID ile devam etme ve akışın ortasında bilerek verilen bir hata.
order: 3
section: Mock sunucular
---

SSE mock sunucu, yazdığınız olayları belirlediğiniz tempoda akıtır. Gerçek bir
backend olmadan id'leri, yeniden bağlanmaları, sessizliği ve hataları nasıl
yönettiklerini denemek için [SSE editörünü](/tr/docs/protocols/sse), bir tarayıcının
`EventSource`'unu ya da kendi istemcinizi ona yöneltin.

[HTTP mock sunucuyla](/tr/docs/mock-server/http) aynı HTTP motorunda çalışır; bu
yüzden uç noktalar, koşullar, şablonlama, kimlik doğrulama ve Loglar sekmesi aynı
şekilde işler. Fark yanıttadır: bir uç noktanın yanıtı **SSE akışı** gövde türünü
taşır ve editör gövdenin yanında bir **Akış** satırı gösterir.

Mock sunucuların genel olarak oluşturulması, başlatılması ve açılması için
[genel bakışa](/tr/docs/mock-server) bakın.

## Hazır şablonlar

Yeni mock sunucu penceresinde bir şablon seçin (tür **SSE**) ya da **Boş**'tan başlayın:

| Şablon | Ne oluşturur |
|---|---|
| **Sayaç** | `GET /events`: istemci ayrılana kadar saniyede bir, artan id'li bir `tick` olayı |
| **Sonlu tekrar** | `GET /events`: beş sabit olay (id 1-5), sonra kapanır. `Last-Event-ID` o id'den sonra devam ettirir; son id `204` alır |
| **Bildirim akışı** | `GET /notifications`: her 2 sn'de JSON verili adlı olaylar (`order`, `message`, `alert`) ve düz JSON olarak `GET /notifications/unread` |
| **Yavaş / heartbeat** | `GET /events`: ilk olay 1500 ms sonra, sonra her 10 sn'de bir olay, her 5 sn'de bir `: keep-alive` yorumu |

Uç noktalar sekmesindeki **Ekle**, sayaç gövdeli bir `GET /events` oluşturur.
Yakaladığınız bir akışı gövdeye de yapıştırabilirsiniz.

## Gövde

Gövde ham SSE metnidir. Testnizer onu boş satırlardan böler ve her bloğu, yazdığınız
gibi birebir, ardına bir boş satır koyarak tele yazar. Olayları ayrıştırıp yeniden
kurmaz; bu yüzden yalnızca `retry:` içeren bir blok, id'yi sıfırlayan bir `id:`, bir
`: yorum` ve çok satırlı `data:` olduğu gibi çıkar.

```text
id: 1
event: order
data: {"id": 1, "total": 42}

id: 2
event: order
data: {"id": 2, "total": 7}
```

Hiçbir şeye dönüşmeyen bir blok atlanır ve olay olarak sayılmaz.

### Şablonlar

Her blok yazıldığı anda şu ek değerlerle işlenir:

| Değer | Anlamı |
|---|---|
| `{{stream.seq}}` | Bu bağlantıdaki olayın 1'den başlayan numarası (heartbeat'ler sayılmaz) |
| `{{stream.iteration}}` | Liste üzerindeki 1'den başlayan tur; **Döngü** açıkken artar |
| `{{stream.now}}` | Olayın işlendiği ISO zamanı |
| `{{request.query.x}}` | Akışı açan isteğin bir sorgu parametresi |

[Şablonlamanın](/tr/docs/mock-server/http) tamamı burada da çalışır. Blok blok
işlemeden iki sınır doğar: `{{#if}}` ve `{{#each}}` bir boş satırı aşamaz, ve kendisi
boş satır içeren bir değer olayı ikiye böler. JSON veriyi, satır sonlarından
kaçan `{{json ...}}` ile yazın.

## Akış satırı

![Stream satırı (aralık, heartbeat, döngü) ve şablon kullanan olay gövdesiyle SSE mock editörü](/docs/screenshots/mock-server-sse-editor.png)

| Ayar | Ne yapar | Varsayılan |
|---|---|---|
| **Aralık (ms)** | Olaylar arası süre. İlk olay hemen gider. En çok 600000 | 1000 |
| **Heartbeat (ms)** | Bu sıklıkta bir `: keep-alive` yorumu yazar. 0 kapalı demektir | 0 |
| **Döngü** | Son olaydan sonra ilk olaydan yeniden başlar. Döngüdeki akış 10 ms'den hızlı yazmaz | kapalı |
| **Bitince** | **Kapat** son olaydan sonra yanıtı bitirir; **Açık tut** bağlantıyı açık bırakır (heartbeat'ler sürer) | Kapat |
| **Last-Event-ID'den devam et** | `Last-Event-ID` ile yeniden bağlanan istemci o olaydan sonra devam eder | açık |

Yanıtın **Gecikme (ms)** değeri, akış açılmadan önceki bekleme süresidir.

**Devam et** seçeneği, nedeni gösterilerek, **Döngü** açıkken (döngüdeki akışın "son
olaydan sonrası" yoktur) ve bir `id:` satırı şablon kullandığında kapatılır; çünkü
sunucu şablonlu bir id'yi yeniden bulamaz. Devam et açıkken ve istemci kapanmakta
olan bir akışın son olayının id'sini gönderdiğinde yanıt `204` olur; bu, bir
`EventSource`'un yeniden bağlanmasını durdurur.

### Hata olayı

Akışı bilerek bozmak için **Hata olayı**'nı açın. Belirlediğiniz sayıda olaydan sonra
(ya da liste önce biterse o anda) sunucu verdiğiniz veriyle bir `event: error` olayı
gönderir ve akışı kapatır. Veri, her olay gibi bir şablondur. Varsayılan, 3 olaydan
sonra `{"message": "Mock stream error"}` değeridir. Yeniden bağlanan bir istemci
saymaya yeniden 0'dan başlar. Bir istemcinin sunucu tarafı hatasını akışı bitmiş
saymak yerine gösterip göstermediğini, ya da yeniden deneyip denemediğini sınamak
için kullanın.

## Deneme

- Sunucu başlığındaki **SSE sekmesinde aç**, Testnizer'ın SSE editörünü ilk tam yollu
  `GET` uç noktasında açar; **Başlat ve SSE sekmesinde aç** önce sunucuyu başlatır.
  SSE sekmesi `GET`, `POST`, `PUT`, `PATCH` ya da `DELETE` gönderir.
- **İstek sekmesinde aç** ve HTTP **Gönder** düğmesi akış kapanana kadar bekler; bu
  yüzden yalnızca biten akışlar için kullanın. Canlı olaylar için SSE sekmesini kullanın.
- Tarayıcı da olur: `http://127.0.0.1:<port>/events` adresini açın ya da
  `new EventSource(...)` kullanın. Yanıt `Content-Type: text/event-stream`,
  `Cache-Control: no-cache` ve proxy'lere arabelleğe almamalarını söyleyen bir header
  taşır; yanıtta kendi ayarladığınız header'lar bunların yerini alır.

200-299 dışındaki ya da `204` olan bir durum akıtılmaz: gövde yazıldığı gibi bir kez
gider; böylece bir SSE uç noktasının hata yanıtını mock'layabilirsiniz.

## Sınırlar ve günlük

- Bir gövde en fazla 10.000 olay taşır ve tek bir olay en fazla 64 KiB olabilir. Daha
  büyük işlenen bir olay, nedenini söyleyen bir yorumla akışı bitirir.
- Bir sunucu en fazla 64 açık ya da bekleyen akış tutar. Bir fazlası `503` alır.
- Loglar sekmesinde bir akış **tek satırdır** ve açıkken **akış sürüyor...** olarak
  işaretlenir. Kapandığında satır, yazılanların bir önizlemesini gösterir (en çok 16 KiB,
  kimlik bilgileri maskelenmiş olarak) ve yanıt header'ları, gönderilen olay sayısı
  ile akışın bitiş nedenini taşıyan bir `x-mock-stream` değeri içerir.
- Sunucuyu durdurmak açık akışlarını sonlandırır. Çalışan bir sunucuyu düzenlemek, zaten
  açık olan bir akışı değiştirmez ya da kapatmaz: akış, başladığı olaylarla sürer.

## İlgili sayfalar

- [SSE editörü](/tr/docs/protocols/sse): istemci tarafı
- [HTTP mock sunucu](/tr/docs/mock-server/http): uç noktalar, koşullar, kimlik doğrulama
