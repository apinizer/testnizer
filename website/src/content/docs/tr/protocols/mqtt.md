---
title: MQTT
description: MQTT 3.1.1 ve 5.0 aracılarına (broker) bağlanın, konulara abone olun, mesaj yayınlayın, Son Vasiyet tanımlayın ve mesaj günlüğünü izleyin.
order: 10
section: Protokoller
---

Testnizer, Node ana sürecinde çalışan gömülü bir MQTT istemcisi (MQTT.js) içerir.
Arayüz olayları IPC üzerinden alır ve kendisi hiçbir zaman açık bir soket tutmaz.
**MQTT 3.1.1 ve 5.0** konuşur ve Postman'in MQTT isteğinin düzenini izler; bu
yüzden bir Postman v3 MQTT isteği alanlarını kaybetmeden içe ve dışa aktarılır.

## Bir MQTT sekmesi açma

**+ Yeni** → **MQTT**'ye tıklayın. Editörün üstünde bir bağlantı çubuğu, altında
istek sekmeleri (**Mesaj**, **Konular**, **Yetkilendirme**, **Özellikler**, **Son
Vasiyet**, **Ayarlar**) ve en altta mesaj günlüğü bulunur.

## Bağlanma

| Alan | Notlar |
|---|---|
| **MQTT sürümü** | **MQTT 5.0** (varsayılan) veya **MQTT 3.1.1** |
| **Aracı (broker) adresi** | `mqtt://`, `mqtts://` (TLS), `ws://` veya `wss://` (WebSocket üzerinden MQTT); örneğin `mqtt://broker.example.com:1883`. Çıplak bir `host:port` `mqtt://` sayılır. `{{değişkenler}}` Bağlan sırasında çözülür |
| **İstemci kimliği** | Boş bırakılırsa rastgele. **Rastgele istemci kimliği üret** düğmesi bir tane üretir |

**Bağlan**'a tıklayın. Durum rozeti bağlantı durumunu gösterir; bağlanırken
**İptal**, bağlıyken **Bağlantıyı Kes** görünür. Aracı bağlantıyı kabul etmeden
önce başarısız olan bir bağlantı (reddedilen CONNACK, hatalı parola, zaman aşımı)
hatayı düğmenin yanında gösterir ve **yeniden denenmez** — otomatik yeniden
bağlanma yalnızca bir bağlantı başarılı olduktan sonra ve Ayarlar'dan açtıysanız
başlar.

`mqtts://` ve `wss://` araçları için Testnizer, o host için projenin
[istemci sertifikalarını](/tr/docs/certificates) kullanır; HTTP'nin kullandıklarının
aynısı. **Ayarlar → Sunucu sertifikasını doğrula**, aracının sertifikasının
denetlenip denetlenmeyeceğini belirler.

## Mesaj sekmesi: yayınlama

| Kontrol | Notlar |
|---|---|
| **Konu** | Yayınlanacak konu; `{{değişkenler}}` Yayınla sırasında çözülür |
| **Hizmet kalitesi** | QoS 0 (en fazla bir kez), QoS 1 (en az bir kez), QoS 2 (tam olarak bir kez) |
| **Sakla (retain)** | Aracıdan mesajı gelecekteki aboneler için saklamasını ister |
| **Mesaj biçimi** | Metin, JSON, XML, HTML, Base64 veya Onaltılık. Base64 ve onaltılık içerik çözülür ve ham bayt olarak yayınlanır |
| **Biçimlendir** | Oluşturucudaki JSON, XML veya HTML'i güzel basar |
| **Mesaj özellikleri** | Yalnız MQTT 5.0: içerik türü (MIME), yanıt konusu, ilişkilendirme verisi, mesaj geçerlilik süresi, konu takma adı, yük biçimi göstergesi ve kullanıcı özellikleri |
| **Kaydet** | Oluşturucuyu **kayıtlı mesaj** olarak saklar (sağdaki bölme) |
| **Yayınla** | Mesajı gönderir |

Kayıtlı mesajlar konuyu, QoS'u, retain'i, biçimi, yükü ve özellikleri korur.
Oluşturucuya yüklemek için birine tıklayın, yeniden adlandırmak için çift tıklayın
ya da günlükteki bir mesajda **Kayıtlı mesaj olarak kaydet**'i kullanın. İstekle
birlikte kaydedilirler (Ctrl+S) ve Postman v3 dışa aktarmasında taşınırlar.

## Konular sekmesi: abone olma

Bir konu filtresi ekleyin (`+` ve `#` joker karakterleri çalışır, örneğin
`sensors/+/temperature`). **Abone ol** açık olan bir konuya Bağlan sırasında abone
olunur. Bağlıyken **Abone ol**'u açmak ya da kapatmak **hemen** abone olur ya da
aboneliği bırakır; abone olunmuş bir satırın adı değiştirilemez. Bağlıyken
eklediğiniz bir konu Abone ol kapalı başlar — adını yazın, sonra anahtarı açın.

Her konunun bir **QoS**'u ve açıklaması vardır. MQTT 5.0'da **Abonelik
seçenekleri** de bulunur: **Kendi mesajlarımı alma (No local)**, **Yayınlandığı gibi
sakla** ve **Saklanan mesajlar** (*Abone olunca gönder*, *Yalnız yeni abonelikte
gönder* veya *Gönderme*).

## Yetkilendirme, Özellikler, Son Vasiyet ve Ayarlar

- **Yetkilendirme** — CONNECT içinde gönderilen **Kullanıcı adı** ve **Parola**.
  Parola tarayıcı depolamasına, Geçmiş'e ya da Konsol'a asla yazılmaz (bkz.
  [Verileriniz nereye gider](#verileriniz-nereye-gider)); isteği kaydetmeden yeniden
  başlatmadan sonra da korumak için bir `{{değişken}}` kullanın.
- **Özellikler** — MQTT 5.0 CONNECT özellikleri: **Oturum geçerlilik süresi**,
  **En fazla alınacak mesaj**, **En büyük paket boyutu**, **Yanıt bilgisi iste** ve
  **Kullanıcı özellikleri**. Boş bir özellik gönderilmez. 3.1.1 bağlantısında sekme,
  bunların yalnız MQTT 5.0 için olduğunu söyler ve Testnizer hiçbirini göndermez.
- **Son Vasiyet** — bağlantı Disconnect olmadan koparsa aracının yayınladığı mesaj.
  Yalnızca **Vasiyet konusu** girildiğinde gönderilir; kendi QoS'u, retain'i, biçimi
  ve yükü vardır; MQTT 5.0'da kendi özellikleri de vardır (**Vasiyet gecikmesi**
  dahil). Sizin tıkladığınız **Bağlantıyı Kes** düzgün bir DISCONNECT gönderir, bu
  yüzden vasiyet yayınlanmaz.
- **Ayarlar** — **Sunucu sertifikasını doğrula**, **Bağlantı zaman aşımı** (ms,
  varsayılan 30 000), **Canlı tutma** (sn, varsayılan 60, 0 = kapalı), **Temiz
  oturum** (varsayılan açık) ve **Bağlantı koparsa otomatik yeniden bağlan**
  (varsayılan kapalı; açıkken başarılı olana ya da bağlantıyı kesene kadar her
  saniye dener). Ayarlar bağlıyken kilitlidir ve bir sonraki Bağlan'da geçerli olur.

## Mesaj günlüğü

Gönderilen ve alınan mesajlar, bağlantı olaylarıyla (Bağlandı, Abone olundu,
Abonelik reddedildi, Abonelik bırakıldı, Bağlantı koptu, Yeniden bağlanıyor, Yeniden
bağlandı, aracının neden koduyla Aracı bağlantıyı kesti, Yayınlama başarısız) tek
bir zaman çizelgesinde görünür. WebSocket ve Socket.IO editörleriyle aynı günlüktür:
**arama**, **filtre** (Tümü, Gönderilen, Alınan, Bağlantı), **mesajı kopyala**,
**süreleri karşılaştırmak için iki kayıt seçme**, ikili yükler için **Hexdump**
görünümü ve **Satırları kaydır**. Alınan mesajlar yalnızca bellekte tutulur;
diske yazılmaz.

## Bağlantı ömrü

Bir MQTT bağlantısı sekmesine aittir. Sekmeyi kapatmak bağlantıyı keser; projeden
ayrılmak da (proje değiştirmek ya da Ana sayfaya dönmek) keser: bir bağlantı
görmediğiniz bir projeye mesaj almaya devam etmemelidir. Aynı kural WebSocket ve
Socket.IO sekmeleri için de geçerlidir. Geri döndüğünüzde yeniden bağlanın.

## Verileriniz nereye gider

- Parola, kimlik bilgisi adlı bir kullanıcı özelliği ve aracı adresindeki
  `kullanici:parola@` ya da `?token=` localStorage'a yazılmaz. Kayıtlı bir istek
  bunları saklar; kaydedilmemiş bir sekme yeniden başlatmadan sonra bunları yeniden
  yazmanızı ister.
- Geçmiş ve Konsol isteği parola maskelenmiş olarak kaydeder ve isteğin yeniden
  gönderilebilmesi için `{{değişken}}` şablonunu korur.

## Postman v3

Bir MQTT isteği Postman v3 koleksiyonundan (klasör veya JSON) bağlantısı, MQTT 5.0
özellikleri, Son Vasiyeti, abonelik seçenekleriyle konuları, Basic auth'u ve kayıtlı
mesajlarıyla içe aktarılır ve aynı şekilde geri dışa aktarılır. v3'te alanı olmayan
ayrıntılar dışa aktarmada raporlanır: XML ve HTML yük biçimleri (metin olarak dışa
aktarılır), devre dışı mesaj kullanıcı özellikleri ve kaydedilmemiş composer
taslağı. Testnizer'ın tanımadığı bir MQTT sürümü, içe aktarma raporunda bir notla
5.0 olarak içe aktarılır.

## Testnizer'ın yapmadıkları

- **Görselleştirme yok.** Postman'in konu başına grafikleri yoktur.
- **Varsayılan olarak otomatik yeniden bağlanma yok.** Bu bir ayardır ve varsayılan
  olarak kapalıdır; test ederken kopmaların görünür olması için.
