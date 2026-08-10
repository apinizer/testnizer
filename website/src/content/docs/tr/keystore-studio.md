---
title: Keystore Studio
description: JKS ve PKCS#12 keystore'ları ile X.509 sertifikalarını açın, oluşturun, düzenleyin, dönüştürün ve dışa aktarın — çevrimdışı, keytool ya da openssl olmadan.
order: 2
section: Araçlar
---

Keystore Studio, Testnizer'ın `keytool`, `openssl` ve ayrı bir sertifika
görüntüleyicinin yerine geçen parçasıdır. **Tools → Keystore Studio**'yu açın.

Her şey uygulamanın main process'inde, sizin makinenizde olur. Özel anahtar
hiçbir yere gönderilmez ve baktığınız pencereye hiç ulaşmaz — arayüz anahtar
materyalini değil, girişlerin tarifini alır.

## Biçimler

| Biçim | Aç | Oluştur | Kaydet | Not |
|---|---|---|---|---|
| **PKCS#12** (`.p12`, `.pfx`) | ✅ | ✅ | ✅ | Taşınabilir olan. Java, .NET, tarayıcılar, curl. |
| **JKS** (`.jks`) | ✅ | ✅ | ✅ | Java'nın kendi biçimi. Çoğu uygulama sunucusu hâlâ bunu bekler. |
| **X.509** (`.cer`, `.crt`, `.pem`, `.der`) | ✅ | — | — | Salt okunur inceleme. |

## Bir keystore açmak

**Open keystore** dosyayı ve depo parolasını ister. Parola yanlışsa bu size
diyaloğun içinde söylenir, arkasında değil.

Alias tablosu her girişi türüyle (`KEY`, `CERT` ya da gizli anahtar),
algoritması ve boyutuyla, sertifikasının geçerliliğiyle ve kendi parolası olup
olmadığıyla listeler. Bir girişi seçtiğinizde sertifikanın tamamı görünür:
subject, issuer, seri no, SAN'lar, anahtar kullanımı ve genişletilmiş kullanım,
imza algoritması, SHA-1 ve SHA-256 parmak izleri.

## Yeni keystore oluşturmak

**New keystore** bir tür ve bir depo parolası ister.

> JKS boş depo parolasını reddeder ve diyalog sebebini söyler: JKS'te anahtar
> akışı dosyanın kendi içinde duran bir salt'tan türetilir, yani boş parola
> şifreleme değildir — özel anahtar hiçbir tahmin gerektirmeden geri alınabilir.
> PKCS#12 boş parolayı kabul eder, ama o durumda depo yalnızca sertifika
> tutabilir: anahtar ya da gizli anahtar ekleyecek her yol reddeder, çünkü
> efektif giriş parolası da boş olurdu.

## Anahtar üretmek

**Generate key pair** bir RSA veya EC anahtarı ve kendinden imzalı bir
sertifika üretir. Algoritmayı ve boyutu, subject DN'i, gün cinsinden
geçerliliği ve uzantıları siz seçersiniz:

- **Basic constraints** — CA olarak işaretleyin ya da işaretlemeyin. CA olarak
  işaretlerseniz Testnizer, sertifika imzalayamayan bir CA'nın işe yaramadığını
  hatırlatır; `keyCertSign` açık olmalıdır.
- **Key usage / extended key usage** — tahmin edilmez, açıkça belirlenir.
- **SAN'lar** — DNS adları ve IP adresleri. Gerçekte bağlanacağınız adı
  taşımayan bir sertifika, sonradan bir saatinizi alan "hostname mismatch"
  hatasının en yaygın sebebidir.

**Generate secret key** simetrik materyal tutan keystore'lar için AES ya da
HMAC gizli anahtarı üretir.

## İçe aktarma

İçe aktarma beş şekli kabul eder ve doğru olanı dosyadan seçer:

- **PKCS#12** paketi (anahtar + zincir)
- sertifikayla birlikte **PEM** özel anahtar
- **DER** sertifika
- **sertifika zinciri**
- güven girişi olarak **yalnızca sertifika**

İkisini birden taşıyan bir içe aktarmadan sonra Testnizer, özel anahtarla
sertifikanın gerçekten eşleşip eşleşmediğini kontrol eder ve eşleşmiyorsa
söyler — giriş yazılmadan önce, ilk başarısız el sıkışmada değil.

## Dönüştürme

**Convert** deponun tamamını diğer biçim olarak yeniden yazar.

Gizli anahtarlar JKS'e aynı şekilde geçemez, bu yüzden atlanır. Bu sessiz
değildir: hangi alias'ların düşeceği adıyla söylenir ve hiçbir şey yazılmadan
önce onayınız istenir. Sonuç bellekte bir oturumdur — diske yazmak için
**Save as** kullanın; o noktada önerilen dosya adı yeni uzantıyı alır.

## Parolalar

- **Change store password** depoyu yeniden şifreler.
- **Set entry password** bir alias'a kendi parolasını verir; böylece bir giriş
  depodan ayrı korunabilir.

İkisi de boş değer kabul etmez. Var olan bir korumayı gevşetmek sessiz bir
zayıflatma olurdu; uyarılmak yerine reddedilir.

## Kütüphaneye kaydetmek

**Save to library** bir keystore'u Testnizer içinde tutar; böylece diğer
ekranlar dosyayı yeniden bulmanıza gerek kalmadan kullanabilir. Parolanın
hatırlanmasını isteyebilirsiniz; bu, işletim sistemi anahtarlığı üzerinden
saklanır (Keychain, DPAPI, libsecret) — asla düz metin olarak, asla proje
veritabanında değil.

Parolası boş olan bir depo hatırlanamaz: şifrelenecek bir şey yoktur, bu yüzden
uygulama bunu sessizce "hatırlandı" diye kaydetmek yerine size söyler.

## Keystore'u başka yerlerde kullanmak

Bir keystore kütüphaneye girdikten sonra, sertifika ve özel anahtar gereken her
yerde bir **anahtar kaynağı** olur:

- **[İstemci sertifikaları / mTLS](/tr/docs/certificates)**
- **[WS-Security](/tr/docs/ws-security)** imzalama ve şifreleme
- **[JWT / JOSE](/tr/docs/jwt-debugger)** imzalama ve doğrulama
- **[SAML](/tr/docs/saml)** XML-DSig imzalama

Bu eklemedir. PEM yapıştırmak ve CRT/KEY/PFX dosyası seçmek çalışmaya devam
eder ve bu ekranların hepsinde varsayılan olarak kalır — hiçbir şey sizi
keystore yüklemeye zorlamaz.

## Uygulamadan ne çıkar

Hiçbir şey. Keystore Studio hiçbir türde ağ çağrısı yapmaz. Okuma, yazma,
dönüştürme, üretme ve imzalama uygulamanın kendi süreci içinde koşar. Bağlantı
açan tek güvenlik ekranı, zaten uzaktaki bir uç noktayla konuşmak için var olan
**[TLS Inspector](/tr/docs/tls-inspector)**'dır.
