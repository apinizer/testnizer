---
title: Socket.IO
description: Socket.IO sunucularına (istemci v2, v3 veya v4) bağlanın, birden çok argümanlı ve onaylı olay gönderin, dinlenecek olayları seçin ve çift yönlü zaman çizelgesini izleyin.
order: 8
section: Protokoller
---

Testnizer, Node ana sürecinde çalışan resmi `socket.io-client` kütüphanesi
tarafından desteklenen yerleşik bir Socket.IO istemcisi içerir. Renderer,
olayları IPC üzerinden alır ve kendisi hiçbir zaman açık bir soket tutmaz.

## Ne zaman kullanılır

Socket.IO düz WebSocket **değildir**. WebSocket'in (HTTP long-polling yedeğiyle)
üzerinde kendi protokolünü çalıştırır ve adlandırılmış olaylar, namespace'ler,
onaylar (acknowledgement) ve otomatik yeniden bağlanma ekler. Sunucunuz arka uçta
`socket.io` kullanıyorsa **WebSocket** editörü çalışmaz — bunu kullanın.

## Socket.IO sekmesi açma

**+ Yeni** → **Socket.IO**'ya tıklayın. Editörün üstünde bir bağlantı çubuğu, altında
istek sekmeleri (**Mesaj**, **Parametreler**, **Başlıklar**, **Olaylar**,
**Ayarlar**) ve en altta olay zaman çizelgesi bulunur.

## Bağlanma

| Alan | Zorunlu | Notlar |
|---|---|---|
| **URL** | evet | Sunucu kaynağı, ör. `http://localhost:3000` veya `https://api.example.com`. Sorgu parametreleri sorguda kalır |
| **Namespace** | hayır | Varsayılan `/`. Namespace'li sunucular için `/admin`, `/chat` vb. ayarlayın; yola eklenir, hiçbir zaman sorgunun içine değil |
| **Bearer token** | hayır | El sıkışma sırasında `auth` yükünün içinde gönderilir (`auth: { token: '...' }`) |

**Parametreler** el sıkışmaya sorgu parametreleri ekler; **Başlıklar** ise `auth` yükü
yerine `Authorization` header'ına bakan sunucular için el sıkışmayla birlikte gönderilir.

**Bağlan**'a tıklayın. Testnizer:

1. Socket.IO bağlantısını kurar (tercih edilen taşıma: WebSocket, yedek olarak HTTP
   polling — Ayarlar'dan değiştirilebilir).
2. Sunucunun bağlantıyı onaylamasını bekler (Ayarlar'daki **El sıkışma zaman aşımı**,
   varsayılan 10 saniye).
3. `connect` olduğunda durum **Bağlandı**'ya döner ve Mesaj sekmesi etkinleşir.
4. `connect_error` olduğunda durum **Hata**'ya döner ve sunucudan gelen mesaj Bağlan
   düğmesinin yanında gösterilir (örneğin el sıkışmayı reddeden bir `io.use(...)`
   middleware'inin metni).

El sıkışma sırasında **İptal** onu temiz biçimde iptal eder. **Sunucu** bağlantıyı
kapatırsa (örneğin istemciyi atarsa) sekme **Bağlantı kesildi** durumuna geçer,
yapılandırmasını ve zaman çizelgesini korur ve yeniden bağlanana kadar bir gönderim
"Not connected" ile başarısız olur.

## Ayarlar ve istemci sürümü

| Ayar | Varsayılan | Notlar |
|---|---|---|
| **İstemci sürümü** | v4 | **v4**, **v3** veya **v2** — aşağıya bakın |
| **El sıkışma yolu** | `/socket.io` | Sunucunun `path` seçeneği |
| **Taşıma** | Önce WebSocket, sonra polling | Ya da **Yalnız WebSocket** / **Yalnız polling** |
| **Sunucu sertifikasını doğrula** | Açık | `https://` sunucuları için, hem polling hem WebSocket taşımasında geçerli |
| **El sıkışma zaman aşımı (ms)** | 10 000 | |
| **Yeniden bağlanma denemesi** | 0 | 0 yeniden bağlanma yok demektir |
| **Yeniden bağlanma aralığı (ms)** | 1 000 | |

**İstemci sürümü.** Socket.IO 3 ve 4 sunucuları aynı protokolü konuşur; bu yüzden
**v3 ve v4 aynı istemciyi kullanır**. Socket.IO 2 sunucusu için **v2**'yi seçin:
Testnizer o zaman 2.x istemcisini kullanır. Socket.IO 2 sunucusunda **el sıkışma
`auth`'u yoktur**; bu yüzden v2 seçiliyken bearer token, bu tür sunucuların okuduğu
**`token` sorgu parametresi** (`socket.handshake.query.token`) olarak gönderilir.
Sunucu ve proxy günlükleri sorgu parametrelerini kaydedebilir; bu yolla gönderilen
bir token bu günlüklere düşebilir. Ayarlar bağlıyken kilitlidir ve bir sonraki
Bağlan'da geçerli olur.

Otomatik yeniden bağlanma varsayılan olarak **kapalıdır** — test araçları bağlantı
hatalarını örtmek yerine görünür kılmalıdır. Beklenmedik bir kopmadan sonra
Testnizer'ın yeniden denemesi için **Yeniden bağlanma denemesi**'ni artırın; her
deneme zaman çizelgesinde bir bağlantı satırı olarak görünür.

## Olay gönderme

**Mesaj** sekmesi şunları alır:

- **Olay adı** — herhangi bir dize, ör. `chat:message` veya `subscribe`
- **Argümanlar** — bir Socket.IO olayı birden çok argüman taşıyabilir. Her
  argümanın kendi **biçimi** vardır: **Metin**, **JSON**, **Base64** veya
  **Onaltılık**. Base64 ve onaltılık argümanlar ikili olarak gönderilir. Daha fazlası
  için **Argüman ekle**'yi kullanın
- **Onay (ack)** — sunucudan olayı onaylamasını ister; yanıtı zaman çizelgesinde bir
  "Onay" satırı olarak görünür
- **Kaydet** — olay adını, argümanları ve Onay ayarını sağdaki bölmede **kayıtlı
  mesaj** olarak saklar (yüklemek için tıklayın, yeniden adlandırmak için çift tıklayın)

**Gönder**'e tıklayın (ya da bağlıyken olay adı alanında Enter'a basın). Olay,
zaman çizelgesinde hemen giden olay olarak görünür. Değişkenler (`{{userId}}`,
`{{token}}`) olay adında ve argümanlarda çözülür.

## Olayları dinleme

**Olaylar** sekmesi zaman çizelgesinde neyin gösterileceğini belirler:

- **Tüm olayları dinle** — sunucunun gönderdiği her olay gösterilir.
- Aksi halde yalnızca eklediğiniz ve açtığınız olaylar gösterilir. Bir **olay adı**
  yazın, **Olay ekle**'ye tıklayın ve satırındaki anahtarla dinleyip dinlemeyeceğinizi
  belirleyin. Postman'in Socket.IO isteği de böyle çalışır.

Hiç dinleyicisi olmayan ve **Tüm olayları dinle** kapalı bir istek, hiçbir şeyin
dinlenmediğini söyleyen bir bildirim gösterir; böylece eksik bir `welcome` olayı
gizem olmaz. Testnizer'ın eski bir sürümünde kaydedilmiş bir isteğin dinleyici ayarı
yoktur ve siz değiştirene kadar her olayı göstermeye devam eder.

## Olay zaman çizelgesi

| Sütun | Açıklama |
|---|---|
| Yön | Gönderdiğiniz olaylar için yukarı ok; alınanlar için aşağı ok; bağlantı olayları için radyo simgesi |
| Olay | Olay adı |
| Zaman damgası | Gönderme / alma anının yerel saati |
| Yük | Güzel basılmış JSON ya da JSON değilse ham dize |

Tam yükü genişletmek için bir satıra tıklayın. Araç çubuğunda **arama**, bir
**filtre** (Tümü, Gönderilen, Alınan, Bağlantı), **kopyala**, **kayıtlı mesaj olarak
kaydet**, **iki satır arasındaki süreyi karşılaştır**, ikili argümanlar için
**Hexdump** görünümü ve **Temizle** bulunur. Alınan olaylar yalnızca bellekte
tutulur; diske yazılmaz.

## Header'lar ve kimlik doğrulama

Socket.IO kimlik doğrulaması genellikle el sıkışmanın `auth` yükünden geçer
(long-polling yedeğinde de korunduğu için header'lara tercih edilir). Testnizer'ın
**Bearer token** alanı `auth: { token: '<değer>' }` olarak gönderilir — standart
`socket.io` middleware kalıplarının (`io.use(...)`) beklediği biçim budur. Socket.IO
2 sunucusunda yukarıda anlatıldığı gibi sorguda gider.

Yazılan bir token, istek kaydedilmedikçe yeniden başlatmadan sonra korunmaz; ortamda
saklamak için bunun yerine bir `{{değişken}}` (gizli bir değişken) kullanın.

## Çok sekmeli yalıtım ve ömür

Her Socket.IO sekmesi kendi bağlantısını, namespace'ini, dinleyicilerini ve zaman
çizelgesini taşır. Birden çok sunucuyu, aynı sunucudaki birden çok namespace'i ya da
tek bir sunucuyu farklı auth token'larıyla test etmek için birden çok sekme açın —
sekmeler arasında hiçbir durum geçmez.

Bağlantı sekmesine aittir: **sekmeyi kapatmak bağlantıyı keser** (ya da süren el
sıkışmayı iptal eder); **projeden ayrılmak** da (proje değiştirmek ya da Ana sayfaya
dönmek) keser. Aynı kural WebSocket ve MQTT sekmeleri için de geçerlidir.

## Testnizer'ın yapmadıkları

- **Varsayılan olarak otomatik yeniden bağlanma yok.** Bu bir ayardır; denemeleri
  artırmadıkça kapalıdır.
- **Alınan olayların kalıcı saklanması yok.** Zaman çizelgesi sekme başına bellektedir;
  kayıtlı mesajlar aldıklarınızı değil, oluşturduklarınızı tutar.
