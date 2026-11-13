---
title: GraphQL
description: Şema içgözlemi ve tür güvenli değişken editörleriyle sorgular, mutasyonlar ve abonelikler çalıştırın.
order: 4
section: Protokoller
---

Testnizer'ın GraphQL editörü sorgu ve mutasyonları HTTP ile gönderir, abonelikler için
WebSocket bağlantısı açar.

> **Çoklu sekme:** URL, sorgu, değişkenler, header'lar, yanıt ve içgözlenen şema sekme bazında saklanır. Şemaya ihtiyaç duyan her sekmede içgözlem yapın; yeniden başlatınca şema temizlenir.

## GraphQL isteği oluşturma

**+ Yeni** → **GraphQL** tıklayın. Editör, solda boş bir operasyon paneli, altında
bir değişken editörü ve sağda bir şema tarayıcısıyla açılır.

## Uç nokta URL

GraphQL uç nokta URL'sini yapıştırın. Değişkenler desteklenir:

```
{{apiBaseUrl}}/graphql
```

## Header'lar

Kimlik doğrulama dahil istek için HTTP header'ları ekleyin:

```
Authorization: Bearer {{accessToken}}
Content-Type: application/json   ← otomatik eklenir, gerekirse geçersiz kılın
```

## Operasyon editörü

İçgözlenmiş şemayla desteklenen GraphQL söz dizimi vurgulama, parantez
eşleştirme ve otomatik tamamlamalı bir Monaco örneği.

![İşlem editöründe bir sorgu ve altında JSON yanıtıyla GraphQL sekmesi](/docs/screenshots/graphql-query.png)

Sorgu, mutasyon veya abonelik yazın:

```graphql
query GetUser($id: ID!) {
  user(id: $id) {
    id
    email
    createdAt
    roles {
      name
    }
  }
}
```

**Gönder**'e tıklayın (veya `Ctrl+Enter`). Testnizer operasyon türünü algılar:

- `query` / `mutation` → HTTP POST olarak gönderilir (standart JSON gövdesi)
- `subscription` → WebSocket bağlantısı üzerinden açılır (bkz. [Abonelikler](#abonelikler))

Editörde birden fazla operasyon olabilir. Hangisinin çalışacağını seçmek için
araç çubuğundaki operasyon adı açılır menüsünü kullanın.

## Variables sekmesi

Mevcut operasyon için JSON değişkenlerini düzenleyin:

```json
{
  "id": "usr_01HXYZ"
}
```

Değişken editörü JSON'ı doğrular ve içgözlem mevcut olduğunda şemaya karşı
tür uyumsuzluklarını vurgular.

`{{ortam}}` değişkenleri JSON değerlerinin içinde çözülür:

```json
{
  "id": "{{currentUserId}}"
}
```

## Şema içgözlemi

Şema tarayıcısı başlığındaki **İçgözle**'ye tıklayın. Testnizer, standart içgözlem
sorgusunu uç noktaya gönderir (mevcut header'ları kullanarak, bu nedenle auth
otomatik olarak dahil edilir) ve sonuçtan tür tarayıcısını oluşturur.

Tür tarayıcısı aranabilir. Herhangi bir türe tıklayarak alanlarını, argümanlarını
ve açıklamalarını görüntüleyin. Tür tarayıcısında bir alana tıklamak, onu imleç
konumundaki operasyon editörüne ekler.

İçgözlem sonuçları uç nokta + header kombinasyonuna göre önbelleğe alınır ve
uygulama yeniden başlatmalarında kalıcıdır. Yenilemek için **Yeniden içgözle**'ye
tıklayın.

Sunucu içgözlemi devre dışı bırakırsa (üretimde yaygın), bir şema SDL dosyasını
doğrudan yapıştırabilirsiniz:

1. Şema tarayıcısında **Dosyadan şema yükle**'ye tıklayın
2. Bir `.graphql` veya `.sdl` dosyası seçin
3. Testnizer dosyayı otomatik tamamlama ve tür denetimi için kullanır

## Abonelikler

Operasyon `subscription` olduğunda Testnizer bir WebSocket bağlantısı açar.
`graphql-transport-ws` protokolünü kullanır, sunucu bunu reddederse eski `graphql-ws`'i bir
kez dener. **Bağlantı başlatma içeriği**, bağlantı açılırken gönderilen veridir; birçok
sunucu token'ı burada bekler. Token için `{{değişken}}` kullanın.

Olaylar geldikçe görünür. Günlük son 1000 olayı tutar ve kaçının düştüğünü gösterir.

Abonelik etkinken bir **Durdur** düğmesi görünür. Aboneliği bitirir ve bağlantıyı kapatır.
Sekmeyi kapattığınızda ya da projeden çıktığınızda da bağlantı kapanır.

Abonelik de diğer istekler gibi proxy ayarını kullanır. Belgede birden çok adlandırılmış işlem varsa **İşlem** seçimi görünür ve seçilen işlem çalışır.

## HTTP ayrıntıları

Sorgular ve mutasyonlar için istek şöyle bir POST'tur:

```json
{
  "query": "...",
  "variables": { ... },
  "operationName": "GetUser"
}
```

**Console** sekmesi, tam olarak neyin gönderildiğini doğrulayabilmeniz için ham
HTTP isteğini ve yanıtı gösterir.

Sorgular ve mutasyonlar, HTTP ile aynı **SSL doğrulaması** ve **yönlendirmeleri izle**
ayarlarını (istek, sonra proje, sonra uygulama) ve tanımlı proxy'yi kullanır; bkz.
[Ayarlar sekmesi](/tr/docs/protocols/http#ayarlar-sekmesi). Belge birden çok adlı operasyon
içeriyorsa Gönder, Çalıştır, Abone Ol ve Kod Oluştur **İşlem** seçiminde seçilen
operasyonu kullanır. Postman ve Insomnia dışa aktarımları, bir connection init payload'unu
taşıyamadıklarında bunu söyler.

## Kalıcı sorgular (APQ)

Otomatik Kalıcı Sorgular'ı etkinleştirmek için istek ayarlarında **Automatic
Persisted Queries** seçeneğini açın; önce sorgu karmasını gönderir ve
`PersistedQueryNotFound` hatasında tam sorguya geri döner. Testnizer iki adımlı
alışverişi otomatik olarak gerçekleştirir.

## Yanıt

Yanıt gövdesi Monaco'da gösterilen biçimlendirilmiş JSON'dır. Yanıt gövdesindeki
GraphQL `errors[]` yanıt panosunda **vurgulanır** — her giriş varsa `message` ve
`path` değerini gösterir. Bu, HTTP düzeyindeki hatalardan ayrıdır; `200 OK` yanıtı
yine de GraphQL hataları içerebilir.

Ağ düzeyinde sorunları hata ayıklamak için **Headers** ve **Console** sekmeleri
kullanılabilir.

## Uçuştaki istekleri iptal etme

Sorgular ve mutasyonlar için istek devam ederken bir **İptal** düğmesi görünür.
Tıklamak motora bir iptal sinyali gönderir; sekme hemen boşta duruma döner.
