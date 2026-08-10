---
title: TLS Inspector
description: Canlı bir uç noktanın gerçekte ne sunduğunu inceleyin — sertifika zinciri, protokol sürümü, cipher, ALPN — ve sunulan sertifikayı güvenilir olarak kaydedin.
order: 5
section: Araçlar
---

**Tools → TLS Inspector** bir host'a bağlanır ve sunduğunu raporlar.

> Ağı kullanan tek güvenlik aracı budur ve kullanmak zorundadır: bütün işi
> uzaktaki bir uç noktayla konuşmaktır. Hiçbir şey yüklemez — sunucunun
> gönderdiğini okur. Bu bölümdeki diğer her araç kablo çekiliyken çalışır.

## Ne raporlar

**El sıkışma** — anlaşılan TLS sürümü, cipher takımı ve sunucunun seçtiği ALPN
protokolü.

**Zincir** — sunucunun gönderdiği her sertifika, sırasıyla; her biri subject,
issuer, seri no, SAN'lar, geçerlilik, anahtar algoritması ve boyutu, imza
algoritması ve parmak izleriyle.

**Yargı** — hostname eşleşmesi, süre dolumu ve zincirin güvenilir olup olmadığı;
her biri ayrı ayrı belirtilir, böylece hangisinin başarısız olduğunu
ayırt edebilirsiniz.

## El sıkışma başarısız olduğunda

Bağlantı hiç tamamlanmazsa — DNS hatası, reddedilen bağlantı, zaman aşımı —
taşıma hatasını görürsünüz, başka bir şey değil. Sertifika rozetleri çıkmaz,
çünkü ortada sertifika yoktur: çözümlenememiş bir host için "hostname mismatch"
göstermek, gerçek gibi giydirilmiş yanlış bir cevaptır.

El sıkışma boş bir zincirle de başarılı olabilir. Sertifika yargıları açısından
bu da aynı şekilde ele alınır — protokol ve cipher gerçektir, gösterilir;
sertifika rozetleri gösterilmez.

## Host ile SNI

SNI adını bağlandığınız host'tan bağımsız ayarlayabilirsiniz; DNS'in henüz
göstermediği bir sanal host'u böyle test edersiniz.

İkisi farklı olduğunda bu açıkça söylenir: alt bilgi gerçekte çevrilen host ve
port'u gösterir, sonuç ise sertifikanın SNI adına göre doğrulandığını belirtir.
Sahada iki ad varken hangisinin kontrol edildiğinin belirtilmemesi, yanlış bir
"çalışıyor" kaydının oluşma biçimidir.

## Protokol aralığı

Bir anlaşma sorununu yeniden üretmek için `min` ve `max` TLS sürümü
sabitlenebilir — örneğin bir uç noktanın 1.3'ü gerçekten reddedip reddetmediğini
görmek için TLS 1.2'yi zorlamak gibi. `min` değeri `max`'ın üstünde olan bir
aralık, bağlantı denenmeden önce, neyin yanlış olduğunu söyleyen bir mesajla
reddedilir.

## İstemci sertifikaları

İnceleyici bir istemci sertifikası sunabilir; PFX'ten ya da sertifika + anahtar
çiftinden. PFX ile cert/key karşılıklı olarak dışlayıcıdır: ikisini birden
göndermek, üzerine akıl yürütemeyeceğiniz bir yapılandırmadır, bu yüzden izin
verilmez.

## Bir sertifikayı güvenilir olarak eklemek

Sunucunun sunduğu bir sertifika, bir
**[keystore](/tr/docs/keystore-studio)**'a güven girişi olarak kaydedilebilir —
kütüphanenizdeki mevcut bir depoya ya da o anda oluşturulan yenisine. Hiçbir
genel güven deposunun tanımadığı dâhilî bir CA ile çalışırken işe yarar.

Yeni depo oluşturmak, diğer her keystore gibi tür ve parola ister.
