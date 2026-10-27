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

**+ Yeni** → **WebSocket**'e tıklayın (ya da proje kenar çubuğundan WebSocket'i
seçin). Postman veya Insomnia koleksiyonlarındaki mevcut bir `ws://` veya `wss://`
isteğini de içe aktarabilirsiniz; bir Postman v3 WebSocket isteği URL'si,
parametreleri, header'ları, ayarları ve kayıtlı mesajlarıyla içe ve dışa aktarılır.

Editörün üstünde bir bağlantı çubuğu, altında istek sekmeleri (**Mesaj**,
**Parametreler**, **Başlıklar**, **Ayarlar**) ve en altta mesaj günlüğü bulunur.

## Bağlantı çubuğu

`ws://` ve `wss://` ikisi de desteklenir. Değişkenler gerçek zamanlı çözülür:

```
wss://{{wsHost}}/chat?room={{roomId}}
```

Yükseltmeyi (upgrade) yapmak için **Bağlan**'a tıklayın. Durum göstergesi bağlantı
durumunu gösterir (bağlanıyor, bağlandı, bağlantı kesildi); el sıkışma sürerken
**İptal**, bağlıyken **Bağlantıyı Kes** görünür ve temiz bir kapatma çerçevesi
gönderir.

Sunucu yükseltmeyi reddederse (101 olmayan HTTP yanıtı) hata mesajı ve HTTP yanıt
header'ları günlükte gösterilir; böylece yetkilendirme hatalarını ya da protokol
uyumsuzluklarını teşhis edebilirsiniz.

## Parametreler ve Başlıklar

**Parametreler**, el sıkışma URL'sinin sorgu parametreleridir; tablo ve URL
senkron kalır ve bir satır silinmeden devre dışı bırakılabilir.

**Başlıklar** HTTP upgrade isteğine eklenir. Yaygın kullanımlar:

- `Authorization: Bearer {{token}}`
- `Sec-WebSocket-Protocol: graphql-ws` (bunu gerektiren GraphQL subscription'ları için)
- Özel cookie'ler (`Cookie` header'ını doğrudan ayarlayın)

Bazı WebSocket sunucuları upgrade sırasında bilinmeyen header'ları reddeder.
Testnizer tanımladığınız header'ları aynen gönderir, fazlasını değil.

## Mesaj gönderme

### Mesaj sekmesi

**Mesaj** sekmesi oluşturucudur. **Mesaj biçimi**ni seçin:

- **Metin** — UTF-8 metin çerçevesi olarak gönderilir
- **JSON**, **XML**, **HTML** — metin çerçevesi olarak gönderilir; **Biçimlendir**
  içeriği güzel basar (yapamıyorsa nedenini söyler, örneğin geçersiz JSON)
- **İkili** — **Base64** veya **Onaltılık**. Base64 içerik çözülür, onaltılık
  baytlar (örneğin `48 65 6c 6c 6f`) ayrıştırılır ve her mesaj **gerçek bir ikili
  çerçeve** olarak gider

**Mesaj Gönder**'e tıklayın. `{{değişken}}` ikamesi oluşturucuda gönderim anında
çalışır; aktif ortamdan ve projenin Globaller'inden her seferinde çözülür, böylece
mesajı düzenlemeden gönderimler arasında bir değeri değiştirebilirsiniz.

### Kayıtlı mesajlar

Sık kullanılan mesajlar (abonelik yükleri, heartbeat) sağdaki **Kayıtlı mesajlar**
bölmesinde tutulabilir. **Kaydet** oluşturucuyu saklar (yüklü olan kayıtlı mesajı
günceller); bir kayıtlı mesajı oluşturucuya yüklemek için tıklayın, yeniden
adlandırmak için çift tıklayın ya da günlükteki herhangi bir mesajdaki düğmeyle
kaydedin. Kayıtlı mesajlar isteğe aittir: onunla birlikte yazılır (Ctrl+S) ve
Postman v3 dışa aktarmasında taşınır.

## Ayarlar

| Ayar | Varsayılan |
|---|---|
| **Sunucu sertifikasını doğrula** | Açık. Kendinden imzalı sertifikalı bir `wss://` sunucusuna bağlanmak için kapatın |
| **El sıkışma zaman aşımı (ms)** | 15 000 |
| **Yeniden bağlanma denemesi** | 0 (yeniden bağlanma yok) |
| **Yeniden bağlanma aralığı (ms)** | 5 000 |
| **En büyük mesaj boyutu (MB, 0 = sınırsız)** | 100 |

Ayarlar bağlıyken kilitlidir ve bir sonraki Bağlan'da geçerli olur. **Ayarlar**
sekmesindeki bir nokta, varsayılandan farklı bir şey olduğunu gösterir.

Yeniden bağlanma **varsayılan olarak kapalıdır**: Socket.IO editörü gibi WebSocket
editörü de kopmaları sessizce yeniden kurmak yerine görünür kılar; böylece aralıklı
hataları örtmek yerine teşhis edebilirsiniz. Beklenmedik bir kopmadan sonra
Testnizer'ın yeniden denemesi için **Yeniden bağlanma denemesi**'ni artırın; her
deneme ve başarılı bir yeniden bağlanma günlükte bağlantı satırları olarak görünür.

## Mesaj günlüğü

Gönderilen ve alınan her mesaj günlükte kronolojik sırayla görünür. Yukarı ok
gönderdiğiniz mesajı, aşağı ok sunucudan geleni, radyo simgesi bir bağlantı olayını
(bağlandı, bağlantı kesildi, hata, yeniden bağlanıyor, yeniden bağlandı) işaretler.
Tam yükü görmek için bir satıra tıklayın; büyük yükler satırda kısaltılır ama
ayrıntı görünümünde tam gösterilir; ayrıntı mesajın boyutunu, zamanını ve türünü
de gösterir.

| Kontrol | İşlem |
|---|---|
| **Mesajlarda ara** | Tüm yüklerde metin araması |
| **Mesajları filtrele** | **Tümü**, **Gönderilen**, **Alınan** veya **Bağlantı** |
| **Süreleri karşılaştırmak için seç** | İki satır seçerek "Seçilenler arasında N ms" değerini görün |
| **Mesajı kopyala** | Yükü kopyalar |
| **Kayıtlı mesaj olarak kaydet** | Yükü kayıtlı mesajlara ekler |
| **Hexdump** | Alınan ikili çerçeve için metin yerine hex dökümü gösterir |
| **Satırları kaydır** | Uzun yükleri sarar |
| **Otomatik kaydır** / **Temizle** | Yeni mesajları izler; tüm kayıtları siler (bağlantıyı kesmez) |

Alınan mesajlar yalnızca bellekte tutulur; diske yazılmaz.

## Ping / Pong

Testnizer, sunucunun ping çerçevelerine otomatik olarak pong çerçevesiyle yanıt verir.

## Bağlantı ömrü

Bir WebSocket bağlantısı, Electron penceresine değil Testnizer sekmesine aittir.
Başka bir sekmeye geçmek bağlantıyı kesmez. **Sekmeyi kapatmak bağlantıyı kapatır**;
**projeden ayrılmak** da (başka bir projeye geçmek ya da Ana sayfaya dönmek)
kapatır: bir bağlantı görmediğiniz bir projeye mesaj almaya devam etmemelidir. Aynı
kural Socket.IO ve MQTT sekmeleri için de geçerlidir. Geri döndüğünüzde yeniden
bağlanın; oluşturucu, header'lar ve kayıtlı mesajlar korunur.
