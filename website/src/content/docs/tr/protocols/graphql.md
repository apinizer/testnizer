---
title: GraphQL
description: Şema içgözlemi ve tür güvenli değişken editörleriyle sorgular, mutasyonlar ve abonelikler çalıştırın.
order: 4
section: Protokoller
---

Testnizer'ın GraphQL editörü, yalnızca HTTP olan uç noktalar ile `graphql-ws`
abonelik transportunu destekleyen sunucular arasındaki farkı anlar ve her
operasyon türünü buna göre yönlendirir.

> **Çoklu sekme:** URL, sorgu, değişkenler, header'lar ve yanıt sekme bazında saklanır. İçgözlenen şema, aynı uç noktayı işaret eden tüm sekmeler arasında **paylaşılır** — bir kez içgözleyin, her yerde kullanın.

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
- `subscription` → bağlantı `graphql-ws` WebSocket transportuna yükseltilir

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

Operasyon `subscription` olduğunda Testnizer otomatik olarak bir WebSocket
bağlantısına yükseltir. Bağlantı `graphql-ws` protokolünü kullanır
(`Sec-WebSocket-Protocol: graphql-ws`).

Abonelik zaman çizelgesi WebSocket editörüyle aynı şekilde davranır — olaylar
geldikçe görünür, duraklatabilir, filtreleyebilir ve bireysel yükleri inceleyebilirsiniz.

Abonelik etkinken bir **Durdur** düğmesi görünür. Tıklamak bir `complete` mesajı
gönderir ve WebSocket'i kapatır. Sekmeyi kapattığınızda da bağlantı kapanır.

Eski `subscriptions-transport-ws` protokolünü kullanan sunucular için istek
ayarlarındaki (dişli simgesi) **Legacy WS** seçeneğini etkinleştirin.

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
