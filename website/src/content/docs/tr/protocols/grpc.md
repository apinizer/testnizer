---
title: gRPC
description: Proto dosyaları yükleyin, dört streaming modunun tamamını çağırın ve Testnizer'ın yerel gRPC motoruyla metadata'yı inceleyin.
order: 5
section: Protokoller
---

Testnizer, ana süreçte `@grpc/grpc-js` ve `@grpc/proto-loader` kullanır —
aracı proxy gerekmez, port yönlendirmesi gerekmez.

> **Çoklu sekme:** Her gRPC sekmesi kendi proto dosyasını bağımsız olarak yükler. Sekmeler yüklenen servisleri paylaşmaz.

## gRPC sekmesi açma

**+ Yeni** → **gRPC** tıklayın. Editör, bir proto kaynak seçici ve boş bir
servis tarayıcısıyla açılır.

## Proto kaynağı

Testnizer, servis tanımını yüklemenin üç yolunu destekler:

### 1. Dosya

**Proto dosyası seç**'e tıklayın ve dosyayı diskten seçin. Testnizer dosyayı
(aynı dizin ağacındaki yerel import'lar dahil) ayrıştırır ve **Servis** ve
**Metod** açılır menülerini doldurur.

Proto'nuz diğer proto dosyalarını göreli yolla içe aktarıyorsa Testnizer onları
aynı kök dizinden çözer — dosyayı düzleştirmeniz gerekmez.

### 2. URL

Bir `.proto` dosyasına işaret eden URL'yi yapıştırın. Testnizer dosyayı gönderim
anında alır ve diskten yüklenmiş gibi tam olarak ayrıştırır. Şema kaydı veya
dahili artifact sunucusunda barındırılan proto dosyaları için kullanışlıdır.

### 3. Sunucu yansıması

Sunucuda gRPC yansıma servisi etkinse Testnizer, proto dosyası olmadan servisleri
listeleyebilir. Bağlantı panelinde **Sunucu yansıması kullan** seçeneğini açın
ve **Servisleri getir**'e tıklayın. Testnizer, yansıma servisini `grpc.reflection.v1`
protokolünü kullanarak sorgular; eski sunucular için otomatik olarak
`grpc.reflection.v1alpha` sürümüne geçer. Yansımayla yüklenen servis tanımları
yerel olarak önbelleğe alınır.

## Sunucu adresi

Hedefi `host:port` biçiminde girin:

```
api.internal:443
localhost:50051
```

Başlangıç şemaları otomatik olarak kaldırılır — `grpc://`, `grpcs://`, `http://`
ve `https://` hepsi çalışır. Port belirtilmezse Testnizer, TLS etkinken `:443`,
etkin değilken `:80` ekler.

**TLS / mTLS**, **Bağlantı** panelinde yapılandırılır:

| Seçenek | Açıklama |
|---|---|
| **Plaintext** | Şifrelenmemiş gRPC (`grpc://`) |
| **Server TLS** | Sistem güven deposunu (veya eklediğiniz özel CA'yı) kullanarak sunucu sertifikasını doğrular |
| **Mutual TLS** | Ayrıca bir istemci sertifikası gönderir — projenin sertifika deposundan seçin |

Geçerli CA'sı olmayan sunucu TLS için **Ayarlar → Sertifikalar** bölümüne öz imzalı
bir CA sertifikası ekleyebilirsiniz; Testnizer bu hostname için ona güvenir.

## Servis ve metod

Proto yüklendikten sonra açılır menülerden bir servis ve metod seçin.
Testnizer, istek mesajı türü için tüm alanları içeren (sıfır değerleriyle dolu)
bir JSON iskeleti oluşturur. Önem verdiğiniz alanları doldurun ve ihtiyaç
duymadıklarınızı temizleyin — seri hale getirici null değerli isteğe bağlı
alanları yok sayar.

## Streaming modları

### Unary

Tek istek, tek yanıt. Testnizer istek mesajını gönderir ve yanıtı sağ panelde
gösterir.

### Server-streaming

Tek istek, yanıt akışı. Testnizer çağrıyı açık tutar ve her yanıt mesajını
geldikçe zaman çizelgesine ekler. Akış etkinken bir **İptal** düğmesi görünür;
tıklamak istemci akışını yarı kapatır.

### Client-streaming

Bir akış açın, birden fazla istek mesajı tek tek gönderin (her biri için **Gönder**
düğmesini kullanarak), ardından yarı kapatmak ve tek yanıtı beklemek için
**Gönderimi bitir**'e tıklayın. Çağrı sırasında bir **İptal** düğmesi görünür;
tıklamak istemci akışını hemen yarı kapatır.

### Bidirectional streaming

İstemci ve sunucu aynı anda akış yapar. İstek mesajları göndermek için **Gönder**
düğmesini kullanın; sunucu mesajları paylaşılan zaman çizelgesinde görünür.
Akış sırasında bir **İptal** düğmesi görünür; tıklamak istemci akışını yarı
kapatır. Normal şekilde bitirmek için **Kapat**'a tıklayın.

## Metadata

**Metadata** sekmesi, anahtar-değer çiftleri olarak gRPC çağrı metadata'sı eklemenizi
sağlar (HTTP header'larına eşdeğer). Hem istek hem de yanıt metadata'sı gösterilir.

Yaygın kullanımlar:

- `authorization: Bearer {{token}}`
- `x-request-id: {{$randomUUID}}`
- `grpc-timeout: 30S`

## İstek ve yanıt görünümü

İstek ve yanıt mesajları güzel biçimlendirilmiş JSON (`protobufjs` JSON temsili)
olarak gösterilir. Enum değerleri sayı yerine adla gösterilir. `bytes` alanları
Base64 olarak gösterilir.

Streaming çağrılar için zaman çizelgesindeki her mesaj ayrı ayrı genişletilebilir.

## Son tarihler

İstek ayarlarında (dişli simgesi) bir çağrı son tarihi ayarlayın. Testnizer
`grpc-timeout` metadata header'ını gönderir ve son tarihe ulaşılırsa çağrıyı
iptal eder; `DEADLINE_EXCEEDED` durumu gösterilir.

## Durum kodları

gRPC durum kodları (`OK`, `CANCELLED`, `NOT_FOUND`, `UNAUTHENTICATED` vb.)
yanıt panosunun üzerindeki durum göstergesinde önem düzeyine göre renklendirilmiş
olarak görünür:

- `OK (0)` → yeşil
- `CANCELLED (1)`, `NOT_FOUND (5)` → sarı
- `INTERNAL (13)`, `UNAVAILABLE (14)`, `UNAUTHENTICATED (16)` vb. → kırmızı

## Ortam değişkenleri

`{{değişken}}` ikamesi, gönderim anında sunucu adresinde, metadata değerlerinde
ve JSON istek gövdesinde çalışır.
