---
title: WebSocket
description: Testnizer'ın tam özellikli WS editörüyle WebSocket mesajlarına bağlanın, gönderin ve alın.
order: 3
section: Protokoller
---

Testnizer'ın WebSocket editörü, ihtiyaç duyduğunuz süre boyunca kalıcı bir bağlantıyı
açık tutar. Mesajlar tek bir zaman çizelgesinde her iki yönde akar ve bağlantı
sekme geçişlerinden etkilenmez.

## WebSocket sekmesi açma

**+ Yeni** → **WebSocket** tıklayın (veya proje kenar çubuğundan WebSocket seçin).
Ayrıca Postman veya Insomnia koleksiyonlarından mevcut bir `ws://` veya `wss://`
isteğini içe aktarabilirsiniz.

## Bağlantı paneli

### URL

`ws://` ve `wss://` her ikisi de desteklenir. Değişkenler gerçek zamanlı olarak çözülür:

```
wss://{{wsHost}}/chat?room={{roomId}}
```

### Header'lar

HTTP yükseltme isteğine özel header'lar ekleyin. Yaygın kullanım durumları:

- `Authorization: Bearer {{token}}`
- `Sec-WebSocket-Protocol: graphql-ws` (buna ihtiyaç duyan GraphQL abonelikleri için)
- Özel cookie'ler (`Cookie` header'ını doğrudan ayarlayın)

Bazı WebSocket sunucuları yükseltme sırasında bilinmeyen header'ları reddeder. Testnizer
tam olarak tanımladığınız header'ları gönderir, fazlasını değil.

### Bağlan / Bağlantıyı kes

Yükseltmeyi gerçekleştirmek için **Bağlan**'a tıklayın. Durum göstergesi yeşile döner ve
bağlantı durumunu gösterir (Bağlanıyor → Açık → Kapalı). Temiz kapatma çerçevesi
göndermek için **Bağlantıyı kes**'e tıklayın.

Sunucu yükseltmeyi reddederse (101 dışı HTTP yanıtı) hata mesajı ve HTTP yanıt
header'ları zaman çizelgesinde gösterilir; böylece auth hatalarını veya protokol
uyumsuzluklarını tespit edebilirsiniz.

## Mesaj gönderme

### Mesaj oluşturucu

Editörün altındaki oluşturucu, göndermeden önce bir mesaj yazmanıza veya yapıştırmanıza
olanak tanır. Formatı seçin:

- **Text** — UTF-8 metin çerçevesi olarak gönderilir
- **JSON** — metinle aynı, ancak Testnizer JSON söz dizimini doğrular ve
  oluşturucu alanını otomatik biçimlendirir
- **Binary** — hex (`0xDEADBEEF`) veya Base64 (`data:`) yapıştırın; Testnizer
  ikili çerçeveye dönüştürür

**Gönder**'e tıklayın veya `Ctrl+Enter` / `Cmd+Enter` tuşlarına basın.

### Kaydedilen mesajlar

Sık kullanılan mesajlar (ping çerçeveleri, abonelik yükleri) sağdaki **Kaydedilen
mesajlar** panelinde kaydedilebilir. Oluşturucuyu önceden doldurmak için kaydedilmiş
bir mesaja tıklayın, ardından düzenleyip gönderin.

## Mesaj zaman çizelgesi

Gönderilen ve alınan her mesaj kronolojik sırayla merkezi zaman çizelgesinde görünür:

- Mavi balon, → ok — gönderdiğiniz mesaj
- Yeşil balon, ← ok — sunucudan gelen mesaj
- Gri çizgi — bağlan / bağlantıyı kes / hata olayları

Ayrıntı panelinde tam yükü görmek için herhangi bir zaman çizelgesi girişine tıklayın.
Büyük yükler zaman çizelgesinde kısaltılır (ilk 256 bayt), ancak ayrıntı görünümünde
tam olarak gösterilir.

### Zaman çizelgesi kontrolleri

| Kontrol | Eylem |
|---|---|
| **Temizle** | Tüm zaman çizelgesi girişlerini kaldırır (bağlantıyı kesmez) |
| **Duraklat** | Mevcut bir girişi incelerken yeni girişlerin kaydırılmasını durdurur |
| **Filtrele** | Tüm yüklerde metin araması yapar |
| **Gönderilenler / alınanlar** | Her yönün görünürlüğünü değiştirir |

## Ping / Pong

Testnizer, sunucu ping çerçevelerine otomatik olarak pong çerçevesiyle yanıt verir.
Mesaj oluşturucudan manuel ping de gönderebilirsiniz (**Tür → Ping**).

## Yeniden bağlan

Bağlantı kesilirse Testnizer zaman çizelgesinde bir **Yeniden bağlan** düğmesi gösterir.
Oluşturucu ve kaydedilen mesajlar korunur, böylece yükleri yeniden girmeden devam
edebilirsiniz.

Otomatik yeniden bağlanma kasıtlı olarak kapalıdır — Socket.IO editöründe
olduğu gibi, WebSocket editörü de bağlantı düşmelerini sessizce yeniden kurmak
yerine görünür kılar; böylece aralıklı hataları paspaslamak yerine teşhis
edebilirsiniz.

## Mesajlarda değişkenler

`{{değişken}}` ikamesi, gönderim anında mesaj oluşturucuda çalışır. Değişken,
her Gönder tuşuna bastığınızda aktif ortamdan (ve proje değişkenlerinden) çözülür,
böylece mesajın kendisini düzenlemeden gönderimler arasında ortam değerini
değiştirebilirsiniz.

## Bağlantı ömrü

WebSocket bağlantıları Electron penceresine değil, Testnizer sekmesine bağlıdır.
Başka bir sekmeye geçmek bağlantıyı kesmez. Sekmeyi kapatmak temiz kapatma
çerçevesi gönderir.
