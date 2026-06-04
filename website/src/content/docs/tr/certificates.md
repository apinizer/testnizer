---
title: Sertifikalar
description: mTLS için istemci sertifikaları ve öz imzalı sunucular için özel CA sertifikaları ekleyin.
order: 5
section: Kılavuzlar
---

Testnizer sertifikaları proje başına yönetir. Her projenin kendi sertifika deposu
vardır — bir projeye eklediğiniz sertifikalar diğerlerinde görünmez.

## Sertifika deposu

**Ayarlar → Sertifikalar**'ı açın (veya sol alt köşedeki sertifika simgesine
tıklayın). Depoda iki bölüm vardır:

- **İstemci sertifikaları** — TLS el sıkışması sırasında sunucuya sunulur
  (karşılıklı TLS / mTLS)
- **CA sertifikaları** — sunucu sertifikalarını doğrulamak için güven çıpasına
  eklenir

## İstemci sertifikaları (mTLS)

İstemci sertifikaları, herhangi bir HTTP kimlik doğrulamasından önce TLS
katmanında sunucunun kimliğinizi doğrulamasını sağlar. Bu durum şu alanlarda
yaygındır:

- Bankacılık ve finansal hizmetler API'leri
- Dahili kurumsal servisler
- `require_client_cert` ile yapılandırılmış API gateway'leri
- Kamu / kamu sektörü uç noktaları

### Desteklenen formatlar

| Format | Uzantı | Notlar |
|---|---|---|
| PEM sertifika + PEM özel anahtar | `.pem` / `.crt` + `.key` | Linux/macOS'ta en yaygın |
| PFX / PKCS#12 paketi | `.pfx` / `.p12` | Windows'ta yaygın; parola ifadesi gerekebilir |

### PEM sertifikası ekleme

1. **Sertifika ekle**'ye tıklayın
2. **PEM** formatını seçin
3. Sertifika dosyasını seçin (`.crt` veya `.pem`)
4. Özel anahtar dosyasını seçin (`.key`)
5. Anahtar şifrelenmiş ise parola ifadesini girin (isteğe bağlı)
6. **Ana bilgisayar adı** kalıbını ayarlayın — aşağıya bakın
7. **Kaydet**'e tıklayın

### PFX sertifikası ekleme

1. **Sertifika ekle**'ye tıklayın
2. **PFX** formatını seçin
3. `.pfx` veya `.p12` dosyasını seçin
4. Parola ifadesini girin
5. **Ana bilgisayar adı** kalıbını ayarlayın
6. **Kaydet**'e tıklayın

### Ana bilgisayar adı eşleştirme

Her sertifika girişinin bir ana bilgisayar adı alanı vardır. Testnizer, TLS el
sıkışması sırasında gönderilen SNI'ye (Sunucu Adı Belirtimi) göre sertifikayı
seçer. Ana bilgisayar adı alanı şunları destekler:

| Kalıp | Eşleşir |
|---|---|
| `api.example.com` | Yalnızca tam eşleşme |
| `*.example.com` | `example.com`'un herhangi bir alt etki alanı |
| `*` | Tüm sunucular (geliştirme ortamları için genel eşleşme olarak kullanın) |

Birden fazla sertifika bir ana bilgisayar adıyla eşleşirse, en spesifik kalıp
kazanır (tam > alt etki alanı joker > `*`).

## CA sertifikaları (özel güven çıpaları)

Sunucunuz özel bir CA tarafından imzalanmış bir sertifika sunduğunda bunu kullanın
— kendi PKI'nızı yönettiğiniz kurumsal ağlarda ve internetsiz ortamlarda yaygındır.

Buraya bir CA sertifikası eklemek, onu işletim sistemi güven deposuna yükleme
ihtiyacını ortadan kaldırır ve onu Testnizer ile sınırlı tutar.

### CA sertifikası ekleme

1. **Ayarlar → Sertifikalar**'da **CA Sertifikaları** sekmesine tıklayın
2. **CA sertifikası ekle**'ye tıklayın
3. CA `.pem` veya `.crt` dosyasını seçin
4. Bir etiket verin (ör. `Dahili PKI Kök CA`)
5. **Kaydet**'e tıklayın

CA, o projeden yapılan tüm HTTPS, WebSocket (wss://) ve gRPC TLS bağlantılarına
uygulanır.

### Sistem güven deposunu devre dışı bırakma (gelişmiş)

Varsayılan olarak Testnizer, işletim sistemi sertifika deposuna artı eklediğiniz
CA'lara güvenir. Yalnızca eklediğiniz CA'lara güvenmek için (işletim sistemi güven
deposunu yok sayarak) CA Sertifikaları sekmesinde **Yalnızca özel CA'ları kullan**
seçeneğini etkinleştirin. Bu, her güvenilir köke ilişkin açık denetim istediğiniz
sıfır güvenli ortamlarda kullanışlıdır.

## İstek başına sertifika geçersiz kılma

HTTP istekleri için isteğin **Ayarlar** panelinde (dişli simgesi) proje sertifika
ayarlarını geçersiz kılabilirsiniz. Bir koleksiyondaki tek bir uç nokta için farklı
bir sertifika gerektiğinde kullanışlıdır.

## Güvenlik notları

Özel anahtarlar, işletim sistemi anahtarlığı kullanılarak şifreli olarak saklanır
(Electron'da `safeStorage.encryptString`). PFX eklerken girdiğiniz parola ifadesi
de aynı şekilde saklanır — hiçbir zaman düz metin olarak diske yazılmaz.

Sertifikalar projenin yerel SQLite veritabanında saklanır. Veritabanını taşımak
veya kopyalamak özel anahtarları açığa çıkarmaz; anahtarlar işletim sistemi
anahtarlığındadır ve yalnızca bağlantı zamanında ana süreçte şifresi çözülür.

## gRPC sertifikaları

gRPC TLS, aynı proje sertifika deposunu kullanır. gRPC düzenleyicisinin **Bağlantı**
panelinde **Karşılıklı TLS**'yi seçin ve sunucunuzla eşleşen ana bilgisayar adı
kalıbını seçin. Ayrıntılar için [gRPC kılavuzuna](/tr/docs/protocols/grpc) bakın.
