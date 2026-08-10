---
title: SAML 2.0
description: SAML assertion ve response'larını çevrimdışı üretin, XML-DSig ile imzalayın ve doğrulayın — hangi elemanın gerçekten imzalandığını kanıtlayan bir doğrulayıcıyla.
order: 4
section: Araçlar
---

**Tools → SAML**, SAML 2.0 mesajları üretir, imzalar ve geleni doğrular.
Tamamı çevrimdışı.

## Üretme

İki şekil:

- **AuthnRequest** — bir servis sağlayıcının kimlik sağlayıcıya gönderdiği.
- **Response / Assertion** — geri gelen; yani gerçek IdP henüz hazır değilken
  genelde taklit etmeniz gereken.

Issuer, destination, subject, audience, geçerlilik penceresi (`NotBefore` /
`NotOnOrAfter`, sapma payıyla) ve öznitelikleri siz belirlersiniz. Pencere siz
kurarken kontrol edilir — `NotBefore`'dan önce düşen bir `NotOnOrAfter`, asla
geçerli olamayacak bir assertion üretir; bu yüzden üretilmez, reddedilir.

## İmzalama

XML-DSig; anahtar ya yapıştırdığınız bir PEM'den ya da bir
**[keystore](/tr/docs/keystore-studio)** girişinden gelir. Keystore girişi
seçildiğinde PEM alanları devre dışı kalır, böylece hangi anahtarın imzaladığı
hiçbir zaman belirsiz olmaz.

Digest ve imza algoritmalarını, kanonikleştirme yöntemini ve imzanın
assertion'a mı, response'a mı, yoksa ikisine birden mi gideceğini seçersiniz.

## Doğrulama

Çoğu aracın atladığı kısım budur ve bu aracın var olma sebebi de budur.

Doğrulama "bir `<Signature>` elemanı var ve doğrulanıyor" ile yetinmez.
İmzanın **gerçekte hangi elemanı kapsadığını** bildirir ve iddia edilenle
uyuşmadığında dokümanı reddeder:

- **İmza sarmalama (signature wrapping)** — geçerli bir imzası, tüketilenden
  *başka* bir eleman üzerinde olan doküman reddedilir ve rapor ikisini de
  adıyla söyler.
- **Algoritma karışıklığı** — asimetrik gerekirken HMAC algoritması, public
  anahtara karşı doğrulanmak yerine reddedilir.
- **SHA-1** — gerekçesiyle reddedilir.
- **XXE** — dış varlıklar çözümlenmez.
- **Süresi dolmuş veya henüz geçerli değil** — bearer koşul penceresi, saat
  kayması dâhil değerlendirilir ve genel bir hata yerine sebep olarak
  raporlanır.

Her ret sebebini söyler. Yalnızca "geçersiz" diyen bir doğrulayıcı işi size
devretmiş olur.

## Binding'ler

**Binding** sekmesi, kullandığınız taşıma için kodlanmış biçimi üretir:

- **HTTP-Redirect** — binding'in gerektirdiği gibi deflate + base64 + URL kodlama.
- **HTTP-POST** — yalnızca base64.

Kodlama seçtiğiniz binding'i izler; seçili binding'e uygulanmayan bir ayar
alttan sessizce açık bırakılmaz.

## Tazelik

XML'i, sertifikayı ya da anahtar kaynağını değiştirin — önceki yargı kaybolur.
O zamandan beri düzenlediğiniz bir dokümanın yanında ekranda kalan yeşil bir
"Valid", yanlış bir güvenlik cevabıdır; yanlış bir güvenlik cevabı ise
cevapsızlıktan kötüdür. Bu yüzden yargı, girdisi değiştiği anda temizlenir.

## Makineden ne çıkar

Hiçbir şey. Üretme, imzalama ve doğrulama uygulamanın süreci içinde koşar.
