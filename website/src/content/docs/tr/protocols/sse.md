---
title: SSE (Server-Sent Events)
description: Bir Server-Sent Events akışına bağlanın, olayları geldikçe izleyin, olay türüne göre filtreleyin, Last-Event-ID ile devam edin ve yerleşik SSE mock sunucusuna karşı test edin.
order: 7
section: Protokoller
---

Testnizer'ın SSE editörü, Node ana sürecinden uzun ömürlü bir `text/event-stream`
bağlantısı açar ve her olayı bir günlükte gösterir. Renderer, ayrıştırılmış olayları
IPC üzerinden alır ve kendisi hiçbir zaman açık bir soket tutmaz.

Sohbet editörünü mü arıyorsunuz? AI Chat'in ayrı bir sayfası var: [AI Chat](/tr/docs/protocols/ai-chat).

## SSE sekmesi açma

**+ Yeni** → **SSE** tıklayın. Editörde bir bağlantı çubuğu (durum, metot, URL,
**Bağlan**), açılıp kapanan **Last-Event-ID**, **Gövde** ve **Özel Başlıklar**
bölümleri ve olay günlüğü bulunur. Yeni bir sekme boş bir URL ile başlar.

## URL, metot ve başlıklar

Uç nokta URL'sini girin. `{{değişkenler}}` Bağlan'a bastığınızda URL'de,
başlıklarda, gövdede ve Last-Event-ID alanında çözülür:

```
{{apiBaseUrl}}/events/stream?topic={{topicId}}
```

İstek başlıklarını **Özel Başlıklar** altına ekleyin, örneğin
`Authorization: Bearer {{accessToken}}`. `Accept` ayarlamazsanız Testnizer
`Accept: text/event-stream` gönderir.

Durum rozetinin yanındaki metot listesi **GET**, **POST**, **PUT**, **PATCH** ve
**DELETE** sunar, çünkü bazı sunucular bir akışı POST'a yanıt olarak açar. GET
dışındaki metotlarda **Gövde** bölümü açılır; türü **JSON** ya da **Text**'tir.
Gövde ekler ve `Content-Type` başlığı vermezseniz Testnizer ona uygun olarak
`application/json` veya `text/plain` ayarlar.

Gövdesiz bir GET, otomatik yeniden bağlanma dahil tarayıcı tarzı `EventSource`
davranışını kullanır. Başka bir metotla ya da gövdeyle yapılan istek düz bir akış
yanıtı olarak okunur ve **kendiliğinden yeniden bağlanmaz**: akış bitince bağlantı da
biter.

Project Settings veya Settings'te özel bir proxy tanımlıysa bağlantı onun
üzerinden gider (bazı sunucular için atlamak istiyorsanız oradaki **Bu host'lar için bypass**
alanına bakın).

## Bağlan, İptal, Bağlantıyı Kes, Yeniden bağlan

- **Bağlan** akışı açar. Durum rozeti **Bağlanıyor…** → **Bağlı** olur. El sıkışma
  15 saniye sonra vazgeçer.
- Bağlanırken düğme **İptal**, bağlandıktan sonra **Bağlantıyı Kes** olur; günlük
  kalır, böylece gelenleri kaydırarak inceleyebilirsiniz.
- **Yeniden bağlan** (bağlıyken görünür) bağlantıyı keser ve editörde o an
  bulunan ayarlarla yeniden bağlanır; günlük sıfırdan başlar.

SSE sekmesindeyken Ctrl/Cmd+Enter bağlanır.

Bağlantı açıkken düşerse durum rozeti bir sonraki başarılı açılışa kadar
**Yeniden bağlanıyor…** yazar. Sunucu akışı kalıcı olarak sonlandırırsa, örneğin
yeniden bağlanma isteğine HTTP 204 yanıtlayarak, sekme **Sunucu akışı kapattı**
(varsa HTTP durumuyla) yazar ve bağlı değil durumuna geçer; kendiliğinden biten
bir akış hata olarak kaydedilmez. Bağlantı hataları neyin nerede ters gittiğini
söyler (reddedildi, zaman aşımı, DNS, TLS, HTTP durumu) ve URL içindeki belirteçler
mesajda asla görünmez.

## Last-Event-ID ve devam etme

**Last-Event-ID** bölümünü açın ve devam etmek istediğiniz olay kimliğini yazın.
Testnizer bunu bağlanırken `Last-Event-ID` istek başlığı olarak gönderir; uyumlu
bir sunucu kaçırdıklarınızı yeniden gönderir.

Akış düşüp istemci kendiliğinden yeniden bağlandığında (gövdesiz GET) aldığı son
olayın kimliğini gönderir. Editördeki alan sizin için doldurulmaz: yalnızca
yazdığınız değeri tutar ve **Yeniden bağlan** son görülen kimliği değil, bu değeri
okur.

## Olay günlüğü

Her olay bir satırdır:

| Bölüm | Gösterir |
|---|---|
| Tür rozeti | `event:` adı; olayın adı yoksa `message` |
| Önizleme | `data:` metni tek satırda, 80 karaktere kısaltılmış |
| **JSON** rozeti | Veri JSON olarak ayrıştırılabiliyorsa görünür |
| `id:` | Varsa olayın `id:` alanı |
| Saat | Olayın geldiği an (yerel saat, milisaniyeli) |

Genişletmek için bir satıra tıklayın. JSON veri biçimlendirilerek gösterilir;
diğer veriler satır sonlarıyla geldiği gibi gösterilir.

- **Filtre.** Akış birden fazla olay türü ürettiğinde günlüğün üstünde **Tüm
  olaylar** ve her tür için bir girdi içeren bir filtre ile `gösterilen / toplam`
  sayısı çıkar. Filtre yalnızca satırları gizler; her şeyi görmek için **Tüm
  olaylar**'ı seçin.
- **Alt çubuk.** Olay sayısı, bağlı kalınan süre, **Otomatik kaydır** kutusu ve
  **Temizle** burada yer alır.
- **Yorum satırları** (`:` ile başlayanlar) gösterilmez. `retry:` değeri otomatik
  yeniden bağlanmalarda kullanılır, gösterilmez.

Olaylar oturum boyunca bellekte tutulur. Diske yazılmazlar; eski bir sürümün
kaydettikleri başlangıçta temizlenir.

## Kaydetme ve Geçmiş

Ctrl+S sekmeyi istekle birlikte kaydeder: URL, metot, gövde, başlıklar,
Last-Event-ID ve filtre. Başlık değeri olarak düz yazılmış bir kimlik bilgisi,
`{{değişken}}` değilse yeniden başlatmadan sonra korunmaz. Bağlantılar kimlik
bilgileri maskelenerek Geçmiş'te görünür ve SSE editöründe yeniden açılır.

SSE istekleri Koleksiyon Runner'ı, Test Paketleri veya Zamanlayıcı tarafından
çalıştırılmaz; desteklenmeyen olarak listelenir ve atlanır.

## Bir mock'a karşı test etme

Editörü denemek için gerçek bir arka uca ihtiyacınız yok. Mocks paneli,
tanımladığınız olayları aralık, kalp atışı, döngü, `Last-Event-ID` ile devam etme
ve bilerek akış ortasında hatalarla akıtan bir **SSE** mock sunucusu içerir.
**Başlat ve SSE sekmesinde aç** bu editörü ona yöneltir. Bkz.
[SSE mock sunucusu](/tr/docs/mock-server/sse).
