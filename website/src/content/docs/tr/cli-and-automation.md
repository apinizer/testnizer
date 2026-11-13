---
title: Koleksiyon çalıştırıcı ve otomasyon
description: Koleksiyonları sırayla çalıştırın, HTML raporları oluşturun, tekrarlayan çalıştırmaları zamanlayın ve CI'dan otomatikleştirin.
order: 3
section: Kılavuzlar
---

> **CLI durumu:** henüz bağımsız bir komut satırı çalıştırıcısı yok. Bugün
> uygulama içi koleksiyon çalıştırıcı ve zamanlayıcı kullanıma hazırdır; bir
> koşumun raporu HTML ya da JSON olarak dışa aktarılır.

## Koleksiyon çalıştırıcı

Koleksiyon çalıştırıcısı, her birine ayrı ayrı Gönder'e tıklamadan bir grup
isteği ortamlar, değişken zincirleme ve test onayı takibiyle sırayla çalıştırır.

### Çalıştırma başlatma

1. Sol kenar çubuğunda bir proje açın
2. İstek listesinin üstündeki **Çalıştır** düğmesine tıklayın (ya da bir klasöre
   sağ tıklayıp **Klasörü çalıştır** seçin)
3. Çalıştırmayı yapılandırın:
   - **İstekler** — dahil edilecek tekil istekleri işaretleyin veya kaldırın
   - **Ortam** — koşum projenin etkin ortamını kullanır; sonuçlar, koşum geçmişi
     ve raporlar onu adıyla gösterir (hiçbiri yoksa "Ortam yok")
   - **Yineleme** — tüm diziyi kaç kez çalıştıracağınız (yük örnekleme veya
     veri güdümlü test için kullanışlıdır)
   - **İstekler arası gecikme** — her istek arasında milisaniye cinsinden duraklama
   - **İterasyonlar arası gecikme** — tam turlar arasındaki duraklama; bu farklı
     bir boşluktur ve çoğu zaman asıl istediğiniz odur
   - **Hata olursa çalıştırmayı durdur** — ilk başarısızlıkta çalıştırmayı durdur
4. **Başlat**'a tıklayın

### Kritik istekler

Bir isteğin Ayarlar sekmesinde **Kritik istek**'i işaretleyin (ya da çalıştırma
dizisindeki bir Flow satırında **Kritik** rozetinin yanındaki anahtarı kullanın);
o istek başarısız olduğunda ya da çalışamadığında, *Hata olursa çalıştırmayı durdur*
ne derse desin koşu durur. Diğer istekler eskisi gibi başarısızlıkların ardından
devam eder ve teardown yine koşar. Sonuçlar, koşu geçmişi ve HTML / JSON raporlar
koşuyu durduran kritik isteği adıyla anar; kritik satırlar rozet taşır. Setup ve
Teardown satırlarında bu anahtar yoktur.

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

**Run düzeyi betikler.** İstek başına rollerin yanında, koşu yapılandırmasında
bir **Run setup script** ve bir **Run teardown script** vardır. Bunlar
iterasyon başına değil, run başına bir kez çalışır — ve teardown betiği,
teardown isteklerinin garantilendiği şekilde garantilidir: akış erken
durduğunda da koşar. Sonuçlarda betik satırları bir durum kodu yerine
**SCRIPT** rozeti taşır ve hata fırlatan bir betik hata olarak raporlanır.
Üçüncü slot **Run fail script**, teardown'dan sonra yalnız koşu kırmızıysa bir
kez çalışır — raporu (`pm.run.exportHtml()`) bir e-posta ya da sohbet
webhook'una göndermek için kullanın; bkz.
[Run fail script](/tr/docs/scripts#run-fail-script--kırmızı-runda-uyarı).

Koşu sonuçlarındaki, her **All Runs** satırındaki ve planlanmış bir görevin
geçmişindeki **Export HTML** / **Export JSON** butonları koşu raporunu dosyaya
kaydeder — sırlar maskeli, başlık sayıları ekranla aynı. Kayıtlı bir koşu
yeniden çalıştırılmadan dışarı aktarılır. Birden çok iterasyonda her sonuç satırı
kendi iterasyonunu açar ve HTML rapor her satırı iterasyonuyla etiketler.

Bir koşu, Runner sekmesinden ayrıldığınızda da ekranını korur: geri döndüğünüzde
ilerleme, o ana kadarki satırlar ve **Durdur** oradadır; siz başka yerdeyken biten
bir koşunun sonuçları gösterilir.

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

### Bir koşu neler içerebilir

- **MCP istekleri** Send ile aynı geçti / kaldı kuralları ve aynı `pm.*`
  script'leriyle koşar. Bir koşu etkileşimli bir istemi (bir oturum açma, sunucudan
  bir soru) yanıtlayamaz; bu yüzden böyle bir satır açık bir mesajla başarısız
  olur. Bir stdio sunucusu, ancak o komuta bu bilgisayarda MCP sekmesinden bir kez
  bağlandıysanız başlatılır; böylece Git'ten çekilen bir proje bir sonraki
  koşunuzda bilinmeyen bir programı çalıştıramaz.
- **Script'ler** yalnızca bu bilgisayarda izin verdiğiniz projelerde koşar. Git'ten,
  proje dosyasından ya da script ekleyen bir içe aktarmadan gelen proje, izin
  verene kadar engellidir; **zamanlanmış koşular asla sormaz**, script'li adımları
  siz projeye izin verene kadar bir mesajla başarısız olur.
- Koşu, Send ile aynı proxy (bypass listesi ve tür dahil), SSL ve yönlendirme
  ayarlarını kullanır.

### Çalıştırma sonuçları

Çalıştırma devam ederken, tamamlandıkça her istek yeşil ✓ veya kırmızı ✗ rozeti
gösterir. Çalıştırma bittikten sonra:

- Bir **özet çubuğu** toplam geçti / başarısız / hata sayısını ve toplam duvar
  süresini gösterir
- **İstek başına ayrıntı** paneli yanıt kodunu, süreyi ve bireysel onay sonuçlarını
  gösterir

### HTML rapor dışa aktarma

Çalıştırma sonrasında bağımsız bir HTML dosyası kaydetmek için **HTML Dışarı
Aktar**'a tıklayın (**JSON Dışarı Aktar** aynı koşumu JSON olarak kaydeder). HTML
rapor:

- Onay başına bir satır içerir (geçti / başarısız / mesaj)
- İstek URL'sini, metodunu, yanıt kodunu, yanıt süresini içerir
- Başarısız istekler için tam istek ve yanıt gövdelerini gömer
- Harici bağımlılığı yoktur — e-posta ile gönderebileceğiniz, bir Jira ticket'ına
  ekleyebileceğiniz veya bir `test-reports/` dizinine taahhüt edebileceğiniz tek
  bağımsız bir dosyadır

Raporlar ayrıca **Geçmiş** panelinde (sol kenar çubuğu → Geçmiş sekmesi) kaydedilir,
böylece yeniden çalıştırmadan geçmiş çalıştırmaları inceleyebilirsiniz.

## Zamanlayıcı

Zamanlayıcı, Testnizer açıkken bir koşumu bir zamanlamaya göre tetikler.

Runner yapılandırmasında **Elle çalıştır** yerine **Çalıştırmaları planla**'yı
seçin, tekrar sıklığını belirleyin ve **Çalıştırmayı planla**'ya tıklayın:

- **Aralık** — her N dakikada ya da saatte bir
- **Günlük** — her gün seçtiğiniz saatte
- **Haftalık** — seçtiğiniz günlerde seçtiğiniz saatte
- **Cron** — beş alanlı bir ifade (`m h dom mon dow`, örneğin `0 9 * * 1-5`)

Tüm saatler yerel saatinizdir. **Planlanmış Görevler** görünümü her görevi sıradaki
çalıştırması, zamanlaması, ortamı ve uç nokta sayısıyla listeler; görevi **Şimdi
çalıştır**, **Duraklat** / **Sürdür** ya da **Sil** yapabilir ve çalıştırma geçmişini
gösterebilirsiniz. Ortam sütunu görevin kullandığı ortamı adıyla gösterir; silinmişse
satır bunu söyler. Bir paket ve zamanlaması **Çalıştırma hata betiği** taşıyabilir.

Zamanlanan bir tetikleyici çalışırken Testnizer açık değilse, çalıştırma atlanır
(telafi yürütmesi yoktur). Zamanlanmış koşular bir projenin script'lerine güvenip
güvenmeyeceğinizi asla sormaz: script'li bir adım, projeye izin verene kadar bir
mesajla başarısız olur. Sonuçlar, elle çalıştırmalar gibi koşu geçmişinde görünür
ve her satır HTML ya da JSON olarak dışa aktarılır.

## Test paketleri

Test paketleri, birden fazla koleksiyonu tek bir "entegrasyon paketi" çalıştırması
için bir araya getirir — birden fazla koleksiyona yayılan bir akışı test etmek
istediğinizde kullanışlıdır (ör. auth koleksiyonu → siparişler koleksiyonu →
faturalandırma koleksiyonu).

**Testler** panelinde bir paket ekleyin ve istekleri ya da koleksiyonları
çalıştırmak istediğiniz sırayla ekleyin. Paket modül modül koşar: her klasör için
önce kendi istekleri, sonra alt klasörleri; APIs panelinden o klasörü çalıştırmakla
aynı sırada. Çalıştır, Quick Run, Zamanlayıcı ve paket dışa aktarmaları bu
sırayı kullanır. Klasör kimlik doğrulaması ve pre / post script'leri, APIs panelinden
kurulan bir pakete taşınır. Her paket çalıştırması, birleşik raporu olan tek bir
geçmiş girdisi olarak kaydedilir.

Test verisi dosyaları için desteklenen içe aktarma formatları: JSON dizisi ve CSV
(virgül veya noktalı virgülle ayrılmış, UTF-8, başlık satırıyla).

## Gözetimsiz çalıştırmalar ve CI

1.6.0'da başsız bir komut satırı çalıştırıcısı yoktur. Tıklamadan çalıştırmak için
yukarıdaki Zamanlayıcı'yı kullanın; sonuçları başka bir sisteme aktarmak için
koşumu JSON ya da HTML olarak dışa aktarın veya koşum kırmızı bittiğinde raporu bir
webhook'a göndermek için bir **Çalıştırma hata betiği** kullanın (bkz.
[Script'ler](/tr/docs/scripts#run-fail-script--kırmızı-runda-uyarı)). Bir CLI yol
haritasındadır ama henüz yayımlanmadı.
