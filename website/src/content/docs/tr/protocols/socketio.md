---
title: Socket.IO
description: Socket.IO sunucularına bağlanın, JSON yüküyle event emit edin, event adlarına abone olun ve çift yönlü zaman çizelgesini izleyin.
order: 8
section: Protokoller
---

Testnizer, Node ana sürecinde çalışan resmi `socket.io-client` kütüphanesi
tarafından desteklenen yerleşik bir Socket.IO istemcisi içerir. Renderer,
event'leri IPC üzerinden alır ve kendisi hiçbir zaman açık bir soket tutmaz.

## Ne zaman kullanılır

Socket.IO **düz** WebSocket değildir. WebSocket üzerinde kendi protokolünü
çalıştırır (HTTP long-polling fallback'i ile) ve adlandırılmış event'ler,
namespace'ler, ack'lar ve otomatik yeniden bağlanma ekler. Sunucunuz arka
uçta `socket.io` kullanıyorsa **WebSocket** editörü çalışmayacaktır — bunu
kullanın.

## Socket.IO sekmesi açma

**+ Yeni** → **Socket.IO** tıklayın. Editör üstte bir bağlantı çubuğu, solda
emit / subscribe paneli ve sağda bir event zaman çizelgesi ile açılır.

## Bağlanma

| Alan | Zorunlu | Notlar |
|---|---|---|
| **URL** | evet | Sunucu kökü, örn. `http://localhost:3000` veya `https://api.example.com` |
| **Namespace** | hayır | Varsayılan `/`. Namespace'li sunucular için `/admin`, `/chat` vb. olarak ayarlayın |
| **Bearer token** | hayır | El sıkışma sırasında `auth` payload'ı içinde gönderilir (`auth: { token: '...' }`) |

**Connect**'e tıklayın. Testnizer:

1. Socket.IO bağlantısını kurar (tercih edilen transport: WebSocket, fallback
   olarak HTTP polling).
2. Sunucu bağlantıyı ack'leyene kadar 10 saniye bekler.
3. `connect` üzerine durum **Connected**'a değişir ve emit / subscribe paneli
   aktif hale gelir.
4. `connect_error` üzerine durum **Error**'a değişir ve sunucudan gelen mesaj
   Connect butonunun yanında gösterilir.

Otomatik yeniden bağlanma varsayılan olarak **devre dışıdır** — test
araçları bağlantı hatalarını gizlemek yerine görünür kılmalıdır. Soket
düşerse Connect'e tekrar manuel olarak tıklayın.

## Event emit etme

**Emit Event** paneli şunları alır:

- **Event adı** — herhangi bir string, örn. `chat:message` veya `subscribe`
- **Payload** — JSON; ayrıştırılır ve event verisi olarak gönderilir.
  Ayrıştırma başarısız olursa, ham string olduğu gibi gönderilir.

**Emit**'e tıklayın. Event giden bir event olarak (`↑`) zaman çizelgesinde
hemen görünür. Değişkenler (`{{userId}}`, `{{token}}`) hem event adında
hem de payload'da çözülür.

## Event'lere abone olma

Testnizer, bağlantı açılır açılmaz sunucunun yaydığı **her event'i otomatik
olarak yakalar** — gelen event'lerin görünmesi için önceden abone olmanız
gerekmez. **Subscribe** alanı, yakalanan akışın üzerinde çalışan bir
**UI filtresidir**:

- Hiçbir abonelik yokken, alınan her event gelen event olarak (`↓`) zaman
  çizelgesine akar.
- **Subscribe** alanına bir event adı yazıp Enter'a basın (veya `+` tıklayın).
  En az bir abonelik aktif olduğunda zaman çizelgesi yalnızca adı aktif bir
  abonelikle eşleşen event'leri gösterir. Eşleşmeyen önceki event'ler hâlâ
  kayıtta tutulur ve filtreyi kaldırdığınızda yeniden görünür hale gelir.
- Bir aboneliği kaldırmak için yanındaki `×` tıklayın. Tüm abonelikler
  temizlendiğinde zaman çizelgesi her event'i göstermeye geri döner.

Bu sayede henüz abone olmadığınız için erken bir event'i kaçırmazsınız — el
sıkışmanın hemen ardından bir defalık `ready` veya `welcome` event'i yayan
sunucular için işe yarar. Hiçbir şey almayı tamamen durdurmak için üstteki
**Disconnect**'e tıklayın.

## Event zaman çizelgesi

| Sütun | Açıklama |
|---|---|
| Yön | Gönderdiğiniz emit'ler için `↑`; sunucudan alınan event'ler için `↓` |
| Event | Event adı |
| Zaman damgası | Emit / receive yerel saati |
| Payload | Pretty-print edilmiş JSON, JSON değilse ham string |

Tam payload'ı genişletmek için herhangi bir satıra tıklayın. Bağlantıyı
kesmeden zaman çizelgesini temizlemek için **Clear**'e tıklayın.

## Header'lar ve auth

Socket.IO kimlik doğrulaması genellikle el sıkışmanın `auth` payload'ı
üzerinden akar (long-polling fallback'inde de çalıştığı için header'lara
tercih edilir). Testnizer'ın **Bearer token** alanı `auth: { token: '<value>' }`
olarak gönderilir — bu, standart `socket.io` middleware kalıplarının
(`io.use(...)`) beklediği formattır.

Bunun yerine HTTP header'larına (örn. `Authorization`) bakan sunucular için
Testnizer ayrıca WebSocket upgrade el sıkışmasında özel header'ları da
destekler — bunlar `socket.io-client`'ın `extraHeaders` seçeneği üzerinden
sağlanır. Ekstra header'ların long-polling fallback'inde gönderilmediğini
unutmayın çünkü tarayıcı WebSocket spec'i tüm ortamlarda orada özel
header'lara izin vermez.

## Çoklu sekme yalıtımı

Her Socket.IO sekmesi kendi bağlantısını, namespace'ini, aboneliklerini ve
zaman çizelgesini korur. Birden çok sunucuyu, aynı sunucuda birden çok
namespace'i veya tek bir sunucuyu farklı auth token'ları altında test etmek
için birden çok sekme açın — durum sekmeler arasında geçmez.

## Testnizer'ın yapmadıkları

- **Otomatik yeniden bağlanma yok.** Protokol testi için araçlar bağlantı
  düşmelerini gizlemek yerine ortaya çıkarmalıdır.
- **Emit edilen event'lerin kalıcı depolanması yok.** Zaman çizelgesi sekme
  başına bellektedir. Sekmeyi kapatmak temizler.
- **İkili payload editörü yok.** Giden payload'lar JSON veya string'dir;
  `Buffer` veya `ArrayBuffer` göndermeniz gerekiyorsa, bunun yerine script
  güdümlü bir akış kullanın.
