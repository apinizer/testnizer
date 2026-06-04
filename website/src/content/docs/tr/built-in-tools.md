---
title: Yerleşik araçlar
description: Testnizer ile gelen offline araçların referansı — JWT decoder/encoder, biçimlendiriciler, encoder'lar, diff, JSONPath, XPath, XSLT, Jolt, WS-Security, hash, HMAC, JSON Schema, JSON↔XML, epoch, HTTP durum kodları, sayı tabanı dönüştürücü.
order: 2
section: Araçlar
---

Testnizer **tamamen makinenizde** çalışan eksiksiz bir yardımcı araç seti
ile gelir. SaaS yok, upload yok, telemetri yok — her girdi ve çıktı
uygulama süreci içinde kalır. Herhangi bir aracı sol kenar çubuğundaki
**Tools** sekmesinden açın.

Hedef: Normalde jwt.io, hashing-online, epochconverter veya bir
"json to xml" sitesine yapıştırdığınız her şeyi — veriyi sızdırmadan burada
yapabilirsiniz.

![Testnizer araç tezgahı — JWT debugger (decoder/encoder), hash ve HMAC hesaplayıcılar, epoch converter, HTTP status kodları ve dahası](/testnizer-tools.png)

Tool menüsü yukarıdan aşağıya (en sık kullanılan üstte, yardımcı
hesaplayıcılar altta):

```
İçerik & format        ──────────────
JWT Çözücü             ← decode + encode tek sekmede
JSON Biçimlendirici
XML Biçimlendirici
Encode / Decode
Metin Diff
JSON Schema Üretici
JSONPath Değerlendirici
XPath Değerlendirici
JSON ↔ XML Dönüştürücü
XSLT Değerlendirici
Jolt Değerlendirici
WS-Security

Yardımcı hesaplayıcılar ──────────────
Hash Hesaplayıcı
HMAC Üretici
Epoch Dönüştürücü
HTTP Durum Kodları
Sayı Tabanı Dönüştürücü
UUID Üretici
Regex Tester
YAML ↔ JSON
```

## JWT Çözücü

JSON Web Token'ları **decode eder ve encode eder** — tamamen offline. İki
sekme:

- **JWT Decoder** — token yapıştırın, header + payload'i JSON ya da kolon
  açıklamalı ve ISO render'lı tarih claim'leri (`iat`, `exp`, `nbf`,
  `auth_time`) ile tablo görünümünde görün. HS / RS / PS / ES / EdDSA
  imzalarını paylaşılan secret veya PEM açık anahtarla doğrulayın.
- **JWT Encoder** — header + payload JSON'larını düzenleyin, algoritma
  seçin, paylaşılan secret veya PEM özel anahtarı yapıştırın, taze
  imzalanmış bir token alın.

**Generate example** dropdown'ı, herhangi bir algoritma için çalışan örnek
token üretir — asimetrik algoritmalarda taze bir keypair üretir, token'ı
imzalar ve her iki paneli de doldurur (açık anahtarla doğrulayın, özel
anahtarla imzalayın).

Tam referans için [JWT Çözücü kılavuzu](/tr/docs/jwt-debugger)'na bakın.

## JSON Biçimlendirici

Küçültülmüş veya bozuk JSON yapıştırın:

- Yapılandırılabilir girinti (2/4 boşluk, tab) ile **güzel yazdırılmış çıktı**
- **Söz dizimi doğrulama** — ilk hatanın tam satır ve sütunu
- **Anahtar sıralama** — tüm obje anahtarlarının alfabetik sıralanması, recursive

Çıktı paneli bir Monaco editor — kopyala, ara, düzenle.

## XML Biçimlendirici

Herhangi bir XML belgesini girintili, okunabilir hale getirir.

- Yapılandırılabilir girinti genişliği
- Opsiyonel deklarasyon kaldırma (`<?xml version="1.0"?>`)
- Namespace farkındalı (namespaced attribute'lar korunur)
- Roundtrip-safe: belgenin bilgi setini değiştirmez

SOAP zarflarını, OpenAPI XML body'lerini ve CI tarafından üretilen
yapılandırma dosyalarını incelemek için faydalı.

## Encode / Decode

Dört codec modlu tek sekme:

| Mod | Encode / decode |
|---|---|
| **Base64** | Standart (`+/=`) ve URL-safe (`-_`) varyantlar |
| **URL Encoding** | Query string veya path bileşeninin `%xx` percent-encode'u |
| **HTML Varlıkları** | `&amp;`, `&lt;`, `&#8220;`, vb. |
| **JWT payload** | Bir JWT'nin claim bölümünü doğrulamadan Base64URL-decode eder |

Her iki panele yapıştırılabilir — yön ok butonuyla değişir.

## Metin Diff

Herhangi iki metin bloğu için yan yana hizalı diff — JSON, XML, düz metin,
kod snippet'leri.

- Tarafa özel satır numaraları; her header'da satır sayısı
- Removed / added / modified satırlar renk kodlu
- Eşleşen değiştirilmiş satırlar için **karakter düzeyinde intra-line
  vurgular** — tek karakterlik değişiklik bile fark edilir
- Boşluk ve büyük-küçük harf yoksay seçenekleri
- "Original / Changed" başlıkları + Swap butonu

İki API yanıtını, iki şema sürümünü ya da bir test başarısızlığında
beklenen vs. fiili'yi karşılaştırmak için faydalı.

## JSON Schema Üretici

Örnek bir JSON dokümandan draft-07 şema türetir. Hızlı bir çalışan şema
istediğinizde — örneği yapıştırın, şemayı kopyalayın. Tespit ettikleri:

- `string` / `number` / `integer` / `boolean` / `null` / `object` / `array`
- String formatları: `date`, `date-time`, `time`, `email`, `uuid`, `uri`,
  `ipv4`
- Heterojen array'ler `oneOf` item şeması olarak
- Nested object'ler, recursive

Tüm property'lerin `required` olup olmayacağını ve string format
tespitinin yapılıp yapılmayacağını ayarlayın. Çıktı Mock Server'ın
endpoint başına **JSON Schema Validation** alanına doğrudan yapıştırılabilir.

## JSONPath Değerlendirici

Bir JSON dokümanına karşı JSONPath ifadeleri değerlendirir.

- Yazarken canlı değerlendirme
- Kanonik hazır örnek doküman (Goessner-stili "store") ile birlikte
  yazarlar, fiyatlar, slicing, filtreler ve edge case'leri kapsayan
  **17 hazır sorgu**
- Footer'da eşleşme sayısı
- Bracket ve dot notasyon, tam predicate desteği `[?(@.price < 10)]`

## XPath Değerlendirici

JSONPath ile aynı akış, XML ve XPath 1.0 için.

- Canlı değerlendirme, **11 örnek sorgu** dahil, namespace bağlama paneli
- Last / penultimate / first-N predicate'leri hazır
- SOAP yanıt assertion'ları ve XSLT debug için faydalı

## JSON ↔ XML Dönüştürücü

Tek araçta her iki yön. **XML to JSON / JSON to XML** pill'i ile değiştirin.

XML → JSON seçenekleri:

- `xsi:nil="true"`'yu `null` kabul et
- Sayı görünümlü değerleri string yaz (formatı koru)
- Boş elementleri atla
- Kök elementi unwrap et
- Belirli jPath segment'lerini her zaman array yap (örn. `bookstore.book`)

JSON → XML seçenekleri: kök eleman adı, ignore-nulls, ignore-empty.
Attribute'lar JSON'da `@_` prefix'iyle taşınır.

## XSLT Değerlendirici

Bir XML dokümanına XSLT 1.0 stylesheet uygular. **8 hazır örnek** dahil —
eleman çıkarma, yeni XML oluşturma, SOAP zarfı içine sarma, nested eleman
adlandırma vb.

Çıktı method'u (`xml`, `html`, `text`) stylesheet'in `<xsl:output>`
deklarasyonundan tespit edilir. XSLT işlemcisinden gelen hatalar ayrı bir
panelde gösterilir.

## Jolt Değerlendirici

Bir JSON dokümanına [Jolt](https://github.com/bazaarvoice/jolt)
spec'i uygular. **17 örnek** dahil — Inception, prefix-soup
dönüşümleri, list↔map, default değerler, remove'lar, multi-step pipeline'lar.

`shift`, `default` ve `remove` operasyonlarını destekler.

## WS-Security

SOAP güvenlik header'larını oluşturmak, imzalamak ve şifrelemek için
bağımsız tezgah. SOAP editöründeki WS-Security sekmesiyle aynı motor.

- **UsernameToken** — şifre digest veya düz metin, opsiyonel Timestamp
- **Timestamp** — bağımsız expiry token
- **XML Signature** — bir elemanı (genellikle `Body`) X.509 sertifika +
  RSA veya EC anahtar ile imzalar
- **XML Encryption** — bir elemanı AES-128/256-CBC veya AES-GCM ile şifreler

Adım adım anlatım için [WS-Security kılavuzu](/tr/docs/ws-security)'na bakın.

## Hash Hesaplayıcı

Aynı girdi için MD5, SHA-1, SHA-256, SHA-384 ve SHA-512'yi paralel hesaplar.
Her satırın kendi kopyala butonu var. Hashing varsa SubtleCrypto'yla,
SubtleCrypto MD5 sunmadığı için MD5 elle yazılmış implementasyonla yapılır.

Kanonik RFC vektörlerine karşı test edilmiş. Footer'daki byte sayacı girdi
boyutunu gösterir.

## HMAC Üretici

Paylaşılan secret ile HMAC-SHA1 / SHA256 / SHA384 / SHA512. Dört algoritma
da aynı `(mesaj, secret)` çiftine karşı yan yana hesaplanır. RFC 4231
referans vektörlerine karşı test edilmiş.

## Epoch Dönüştürücü

Unix timestamp'leri ve insan-okunabilir tarihler arasında çift yönlü
dönüştürme.

- Birimi (saniye / ms / μs / ns) büyüklüğe göre otomatik tespit
- Sonucu GMT, yerel saat dilimi, ISO 8601 ve görece bir string ("4 saniye
  önce" / "2 saat içinde") olarak gösterir
- Ters yön: yıl / ay / gün / saat / dakika / saniye ve bir saat dilimi
  seçin, saniye + ms olarak epoch'u ve formatlanmış string'leri alın

"Current Unix epoch" göstergesi her saniye güncellenir.

## HTTP Durum Kodları

RFC 9110, IANA registry ve sık kullanılan WebDAV kodlarından 60+ HTTP
durum kodu için aranabilir, kategori filtreli referans.

- Kategoriye göre filtrele (1xx / 2xx / 3xx / 4xx / 5xx)
- Kod, ad ve açıklamada serbest metin arama
- Kategori rozetleri renk kodlu
- Scroll'da kategori başlıkları sticky

Garip / efsane kodlar dahil: 418 ("I'm a teapot"), 451 ("Unavailable for
Legal Reasons"), 425 Too Early, 511 Network Authentication Required.

## Sayı Tabanı Dönüştürücü

Aynı UTF-8 byte sekansının **ASCII metin**, **İkili**, **Sekizlik**,
**Onluk** ve **Onaltılık** temsilleri arasında çevirir. Beş alan da
senkron — birine yazınca diğerleri güncellenir.

- UTF-8 farkındalı — multi-byte karakterler düzgün round-trip eder
  (`€` → `e2 82 ac`)
- Hex tokenları büyük/küçük harfe duyarsız ve opsiyonel `0x` prefix
- Her token geçerli bir byte (0–255) olmalı — geçersiz girdide net hata
  mesajı, sen düzeltene kadar diğer alanlar boş kalır

## UUID Üretici

v1 / v4 / v5 / v7 UUID'lerini 1000'e kadar toplu üret.

- **v4** — tamamen rastgele; en yaygın varyant. 122 rastgele bit, çakışma neredeyse imkansız.
- **v7** — Unix epoch öneki, zaman-sıralı. Oluşma zamanına göre lex sıralama. Primary key olarak ideal.
- **v5** — `(namespace, name)` için SHA-1 hash. Deterministik — aynı
  namespace içinde aynı `name` her zaman aynı UUID üretir. Hazır DNS /
  URL / OID / X.500 namespace preset'leri + özel namespace UUID girişi.
- **v1** — zaman + node. Üretim zamanını ve MAC bazlı node ID'yi ifşa eder.
  Eski sistemler için var; yeni tasarımlarda v7 tercih edin.

Çıktı formatları: küçük harf (kanonik), büyük harf, no-dashes (`32 hex
karakter`), `urn:uuid:...` URN öneki veya `{...}` parantez.

Ayrı bir **Doğrula / incele** alanı, herhangi bir string'in UUID olup
olmadığını tespit eder ve versiyonunu (1–7) raporlar.

## Regex Tester

Adlandırılmış ve numaralı grup yakalamalı canlı regex eşleşmesi.

- Altı JS flag'i bağımsız toggle: `g`, `i`, `m`, `s`, `u`, `y`
- Inline'da vurgulanan eşleşmeler
- Eşleşme tablosu: her eşleşmenin metni, byte aralığı ve yakalanan
  grupları (adlandırılmış gruplar adlarıyla; pozisyonel gruplar
  `$1`, `$2` olarak)
- **Replacement önizlemesini göster** seçeneği: backreference'lı
  (`$1`, `$<name>`, `$&`) bir replacement string'i yazın, tüm eşleşmeler
  değiştirilmiş haliyle önizleme görünür
- **Hazır desen ekle…** dropdown'u: 11 hazır cheatsheet — email, URL,
  IPv4, UUID, ISO 8601 tarih, JWT, hex renk, telefon, kredi kartı,
  boşluk run'ları, HTML tag

## YAML ↔ JSON Dönüştürücü

Pill switch'li (YAML → JSON / JSON → YAML) çift yönlü dönüştürücü.

- Indent: 2 veya 4 boşluk
- Sort keys: tüm obje anahtarlarının alfabetik sıralanması, recursive
- JSON_SCHEMA-safe — `!!js/*` tag'leri yok, JS'e özgü tipler
  deserialise edilmez
- Boş girdi olduğu gibi geçer (sahte hata yok)

OpenAPI spec'leri (genelde diskte YAML, tool'larda JSON), Kubernetes
manifest'leri, GitHub Actions workflow'ları, Helm chart values dosyaları
ve docker-compose dosyalarıyla çalışırken faydalı.

## Offline çalışmanın önemi

Bu araçlar laptop'unuzdan dışarı göndermek istemediğiniz türde girdileri
işler:

- Production'dan gelen, gerçek claim'li JWT'ler
- Gizli materyalin hash'i
- İç loglardan epoch timestamp'leri
- API webhook'larından gelen HMAC imzaları
- NDA altındaki JSON / XML payload'ları

Online "JWT inspector" siteleri yapıştırdığınız her şeyi sessizce
loglar. Tarayıcı uzantıları sayfa erişimi ister. Testnizer'in araçları
uygulamanın geri kalanıyla aynı Electron süreci içinde çalışır — ağ
çıkışı yoktur. Şu an internetten kopsanız bile her araç çalışmaya
devam eder.
