---
title: Koleksiyon çalıştırıcı ve otomasyon
description: Koleksiyonları sırayla çalıştırın, HTML raporları oluşturun, tekrarlayan çalıştırmaları zamanlayın ve CI'dan otomatikleştirin.
order: 3
section: Kılavuzlar
---

> **CLI durumu:** Bağımsız `testnizer-cli` paketi v1.1 için aktif olarak
> geliştirilmektedir. Uygulama içi koleksiyon çalıştırıcı ve zamanlayıcı bugün
> kullanıma hazırdır.

## Koleksiyon çalıştırıcı

Koleksiyon çalıştırıcısı, her birine ayrı ayrı Gönder'e tıklamadan bir grup
isteği ortamlar, değişken zincirleme ve test onayı takibiyle sırayla çalıştırır.

### Çalıştırma başlatma

1. Sol kenar çubuğunda bir proje açın
2. İstek listesinin üstündeki **Çalıştır** düğmesine tıklayın (ya da bir klasöre
   sağ tıklayıp **Klasörü çalıştır** seçin)
3. Çalıştırmayı yapılandırın:
   - **İstekler** — dahil edilecek tekil istekleri işaretleyin veya kaldırın
   - **Ortam** — hangi ortamın değişkenlerini kullanacağınızı seçin
   - **Yineleme** — tüm diziyi kaç kez çalıştıracağınız (yük örnekleme veya
     veri güdümlü test için kullanışlıdır)
   - **İstekler arası gecikme** — her istek arasında milisaniye cinsinden duraklama
   - **İterasyonlar arası gecikme** — tam turlar arasındaki duraklama; bu farklı
     bir boşluktur ve çoğu zaman asıl istediğiniz odur
   - **İlk başarısızlıkta dur** — herhangi bir test onayı başarısız olursa çalıştırmayı
     durdur
4. **Başlat**'a tıklayın

### Setup, Flow ve Teardown

Dizideki her istek bir rol taşır; bir klasör de içindeki her şey için bir rol
taşıyabilir:

| Rol | Ne zaman koşar | Karara sayılır mı |
|---|---|---|
| **Setup** | akıştan önce | evet |
| **Flow** | koşunun kendisi | evet |
| **Teardown** | akıştan sonra, her hâlükârda | hayır — ayrı raporlanır |

**Teardown her zaman koşar.** Akış bittiyse de, hatada durduysa da, ağ
koptuysa da, Stop'a bastıysanız da temizlik yine çalışır. Bir şeyi Teardown
olarak işaretlemenin anlamı budur: koşu ters gittiğinde bile oluşturduğunuz
test verisi silinir.

**Başarısız bir Setup adımı akışı atlar.** Koşunun bağlı olduğu şey
oluşturulamadıysa, yarım kurulmuş bir dünyaya karşı akışı çalıştırmak hiçbir
anlamı olmayan hatalar üretir. Akış atlanır, teardown yine koşar — ve bu, *İlk
başarısızlıkta dur* ayarından bağımsız olur; çünkü bu bir tercih değil,
başarısız bir ön koşulun anlamıdır.

**Teardown bir koşuyu ne kurtarabilir ne batırabilir.** Sonuçları kendi
satırında sayılır, üst düzey hata sayacında değil. Başarısız bir temizlik adımı
görülmeye değerdir, ama geçen bir koşuyu kalan bir koşuya çevirmez.

### Bir koşuyu durdurmak

İki buton ve her aşamada farklı anlamları var:

- **Stop** — koşuyu bitir, ama temizliğin tamamlanmasına izin ver. Her teardown
  isteği ve betiği yine çalışır.
- **Stop now** — hemen dur; uçuştaki her şeyi, temizlik dâhil, bırak.

Hiç koşmamış istekler sonuçlarda dışarıda bırakılmaz, `NOT_RUN` olarak
listelenir; böylece yarıda kesilen on iki adımlık bir koşu yine on iki satır
gösterir. Bunlar atlanmış sayılır — ne geçti ne kaldı.

### Değişken zincirleme

Test betikleri `pm.environment`'a (veya `pm.collectionVariables`'a) yazabilir ve
dizideki bir sonraki istek yeni değerleri alır. Yaygın bir kalıp:

```
İstek 1: POST /login → pm.environment.set('token', response.json().token)
İstek 2: GET /me     → Authorization başlığında {{token}} kullanır
İstek 3: DELETE /sessions → {{token}} kullanır
```

Bu, klasörler arasında çalışır. N. yinelemede yazılan değişkenler N+1. yinelemede
kullanılabilir.

### Veri güdümlü çalıştırmalar

Çalıştırıcı yapılandırmasının **Veri** bölümünde bir JSON veya CSV test verisi
dosyası sağlayın. Her satır bir yineleme olur. Geçerli satırın değişkenleri o
yineleme için ortam kapsamına eklenir:

```json
[
  { "userId": "usr_001", "expectedName": "Alice" },
  { "userId": "usr_002", "expectedName": "Bob" }
]
```

URL daha sonra `{{userId}}`'ye referans verebilir ve test `{{expectedName}}`'i
onaylayabilir.

### Çalıştırma sonuçları

Çalıştırma devam ederken, tamamlandıkça her istek yeşil ✓ veya kırmızı ✗ rozeti
gösterir. Çalıştırma bittikten sonra:

- Bir **özet çubuğu** toplam geçti / başarısız / hata sayısını ve toplam duvar
  süresini gösterir
- **İstek başına ayrıntı** paneli yanıt kodunu, süreyi ve bireysel onay sonuçlarını
  gösterir

### HTML rapor dışa aktarma

Çalıştırma sonrasında bağımsız bir HTML dosyası kaydetmek için **Raporu dışa aktar**'a
tıklayın. Rapor:

- Onay başına bir satır içerir (geçti / başarısız / mesaj)
- İstek URL'sini, metodunu, yanıt kodunu, yanıt süresini içerir
- Başarısız istekler için tam istek ve yanıt gövdelerini gömer
- Harici bağımlılığı yoktur — e-posta ile gönderebileceğiniz, bir Jira ticket'ına
  ekleyebileceğiniz veya bir `test-reports/` dizinine taahhüt edebileceğiniz tek
  bağımsız bir dosyadır

Raporlar ayrıca **Geçmiş** panelinde (sol kenar çubuğu → Geçmiş sekmesi) kaydedilir,
böylece yeniden çalıştırmadan geçmiş çalıştırmaları inceleyebilirsiniz.

## Zamanlayıcı

Zamanlayıcı, Testnizer açıkken bir cron zamanlamasına göre koleksiyon çalıştırması
tetikler.

**Araçlar → Zamanlayıcı**'yı açın (ya da alt çubukta Zamanlayıcı sekmesini).
**Zamanlama ekle**'ye tıklayın ve yapılandırın:

- **Koleksiyon / klasör** — ne çalıştırılacak
- **Ortam** — hangi değişken setinin kullanılacağı
- **Cron ifadesi** — standart beş alanlı cron (`0 */6 * * *` = her 6 saatte bir)
- **Etkin / devre dışı** geçiş

Zamanlayıcı sistem saatini kullanır. Zamanlanan bir tetikleyici çalışırken
Testnizer açık değilse, çalıştırma atlanır (telafi yürütmesi yoktur).

Sonuçlar, manuel çalıştırmalar gibi Geçmiş'te görünür.

## Test paketleri

Test paketleri, birden fazla koleksiyonu tek bir "entegrasyon paketi" çalıştırması
için bir araya getirir — birden fazla koleksiyona yayılan bir akışı test etmek
istediğinizde kullanışlıdır (ör. auth koleksiyonu → siparişler koleksiyonu →
faturalandırma koleksiyonu).

**Araçlar → Test Paketleri** → **Yeni paket**'i açın ve koleksiyonları çalıştırmak
istediğiniz sırayla ekleyin. Her paket çalıştırması, birleşik raporu olan tek bir
geçmiş girdisi olarak kaydedilir.

Test verisi dosyaları için desteklenen içe aktarma formatları: JSON dizisi ve CSV
(virgül veya noktalı virgülle ayrılmış, UTF-8, başlık satırıyla).

## CI / gözetimsiz çalıştırmalar (v1.1 önizlemesi)

`testnizer-cli` başsız çalıştırıcıya sahip ayrı bir npm paketi olacaktır:

```sh
npx testnizer-cli run ./collections/payments.tns \
  --env staging \
  --iterations 1 \
  --report ./out/payments.html \
  --exit-code-on-failure
```

`--exit-code-on-failure` herhangi bir test onayı başarısız olduğunda 1 koduyla
çıkar, bu da onu doğrudan CI geçti/başarısız mantığında kullanılabilir kılar.

CLI, masaüstü uygulamasıyla aynı motorları (HTTP, SOAP, gRPC, WebSocket, SSE) ve
aynı `pm` API'sini paylaşır. UI bağımlılığı yok. Telemetri yok.

İlerlemeyi
[sürümler sayfasında](https://github.com/apinizer/testnizer/releases)
takip edin.

## Neden Newman değil?

Newman, CI'da Postman koleksiyonlarını çalıştırır. Çalışır, ancak SOAP, gRPC,
GraphQL abonelikleri, SSE veya SoapUI XML koleksiyonlarını anlayamaz. Ayrıca
Postman'ın barındırılan betik modelini kullanır — betikler `pm.sendRequest`'i
çağırdığında istek, uç noktanıza doğrudan değil Postman'ın analiz hattı üzerinden
gider.

Testnizer CLI, uygulamayla aynı çevrimdışı öncelikli ilke üzerine inşa edilmiştir —
analiz uç noktası yok, uzak yapılandırma yok, tüm kripto ve test yürütmesi
cihazda.
