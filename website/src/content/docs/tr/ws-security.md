---
title: WS-Security
description: SOAP envelope'larını yerel olarak imzalayın, şifreleyin, doğrulayın ve şifresini çözün — çevrimiçi araç gerekmez.
order: 8
section: Protokoller
---

WS-Security, SOAP mesaj düzeyi güvenlik spesifikasyonudur — XML envelope'larını
imzalamayı, şifrelemeyi ve kimlik doğrulamayı kapsar. Çoğu modern API test aracı
bunu hiç desteklemiyor ya da envelope'unuzu bir satıcıya yükleyen çevrimiçi
"SOAP hata ayıklayıcı"ya yönlendiriyor.

Testnizer bunu cihazda, isteği gönderen aynı ana süreçte yapar. Özel anahtarlar
diskten belleğe yüklenir, işlem için kullanılır ve istek tamamlandığında sıfırlanır.

## Neler destekleniyor

| Özellik | Durum |
|---|---|
| **UsernameToken** — Nonce / created ile Password Text + Password Digest | ✓ |
| **Timestamp** özel TTL ile | ✓ |
| **XML İmzası** RSA-SHA1 / RSA-SHA256, tüm envelope veya belirli öğeler | ✓ |
| **XML Şifreleme** AES-128/256-CBC, AES-128/256-GCM, RSA-OAEP anahtar sarmalama | ✓ |
| **Doğrulama** ekli sertifikaya karşı imza | ✓ |
| **Şifre çözme** proje deposundaki özel anahtarla | ✓ |
| Bağımsız çalışma masası aracı (rastgele XML'e uygula / doğrula / imzala / şifre çöz) | ✓ |

## SOAP isteğine güvenlik ekleme

SOAP isteği açın → **Auth** sekmesi → **WS-Security**.

Yapılandırma koleksiyon başına değil, istek başınadır. Bu, pratikte WS-Security
header'larının çoğunun çalışma şekliyle örtüşür — aynı uç noktadaki farklı
operasyonlar genellikle farklı güvenlik öğelerine ihtiyaç duyar.

### UsernameToken (Password Text)

```xml
<wsse:Security xmlns:wsse="...">
  <wsse:UsernameToken>
    <wsse:Username>alice</wsse:Username>
    <wsse:Password Type="...PasswordText">secret</wsse:Password>
  </wsse:UsernameToken>
</wsse:Security>
```

WS-Security panelinde:

- **Kullanıcı adı**: `alice`
- **Parola türü**: `PasswordText`
- **Parola**: `secret` (işletim sistemi anahtarlık üzerinden geçer — diskte asla
  düz metin olarak saklanmaz)

### UsernameToken (Password Digest)

Nonce + created zaman damgası + `nonce + created + parola`'nın SHA-1 özetini ekler.
Alıcı servis, saklanan karma ile karşılaştırır.

- **Kullanıcı adı**: `alice`
- **Parola türü**: `PasswordDigest`
- **Parola**: `secret`
- **Nonce uzunluğu**: 16 bayt (varsayılan)
- **Created TTL**: 5 dakika (varsayılan)

### Timestamp

`Created` ve `Expires` ile bir `<wsu:Timestamp>` öğesi ekler. Bayat istekte
reddetme davranışı sunucu tarafında uygulanır; TTL'yi uç noktanın tolerans
penceresine göre yapılandırın.

### XML İmzası

Projenin sertifika deposundan bir sertifika seçer. İmzala:

- **Tüm envelope** — `<soap:Body>`'yi imzalar (en yaygın)
- **Belirli öğeler** — XPath ifadesi listesi, her eşleşmeyi imzalar

Algoritma: varsayılan olarak RSA-SHA256; eski uç noktalar için RSA-SHA1.
Sertifikanın açık anahtarı, alıcının ayrı bir anahtar alışverişi olmadan
doğrulayabilmesi için `BinarySecurityToken` olarak gömülür.

### XML Şifreleme

Gövde öğesini hibrit şemayla şifreler:

- Rastgele 128 veya 256 bitlik bir AES anahtarı gövdeyi şifreler
- AES anahtarı alıcının sertifikasıyla RSA-OAEP kullanılarak sarmalanır
- Her ikisi de güvenlik header'ına girer

Alıcının sertifikası projenin sertifika deposunda bulunur. **Sertifikalar → + Yeni**
bölümünden ekleyin ve açılır menüden seçin.

## Bağımsız çalışma masası

**Araçlar → WS-Security çalışma masası**, bir istek göndermeden rastgele XML'e
uygulama / doğrulama / imzalama / şifre çözme işlemi yapmanıza olanak tanır.
Bir envelope yakaladığınızda ve gerçek bir gönderim yapmadan önce onu incelemek
istediğinizde kullanışlıdır.

Aynı motor, aynı özel anahtarlar — çevrimiçi araç gerekmez.

## Bu neden önemli

Çevrimiçi "SOAP hata ayıklayıcıları", üretim XML envelope'larının başkasının
S3 klasörüne girmesinin yoludur. WS-Security envelope'ları genellikle şunları içerir:

- `<soap:Body>` içinde müşteri PII'si
- Güvenlik header'ında kimlik doğrulama token'ları
- Ele geçirildiğinde tekrar oynatılabilecek imzalı iddialar

Ekibinizin imzalı envelope'ları düzenlenmiş veri (bankacılık, sağlık, kamu)
içeriyorsa tek doğru yanıt yerel kriptodur. Testnizer tam olarak bunu sağlar.

## Referans

- W3C [XML İmza Sözdizimi ve İşleme](https://www.w3.org/TR/xmldsig-core1/)
- W3C [XML Şifreleme Sözdizimi ve İşleme](https://www.w3.org/TR/xmlenc-core1/)
- OASIS [WS-Security 1.1](https://docs.oasis-open.org/wss-m/wss/v1.1.1/os/wss-SOAPMessageSecurity-v1.1.1-os.html)
