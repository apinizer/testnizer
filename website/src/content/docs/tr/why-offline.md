---
title: Neden çevrimdışı?
description: Testnizer'ın katı bir çevrimdışı yürütme modeli uygulamasının uyumluluk ve operasyonel nedenleri.
order: 2
section: Başlarken
---

Çoğu API test aracı ağın sorunsuz çalıştığını varsayar. Bunlar,
mobil uygulama geliştiriciler, bağımsız geliştiriciler ve küçük start-up'lar için
oluşturulmuştu — "GitHub ile giriş yap ve koleksiyonların buluta senkronize olsun"
ifadesinin bir özellik değil sorun olduğu kitlelere yönelik.

Bazı ekipler için bu bir sorundur.

## Testnizer kimin içindir

- **Bankacılık, sigorta** — istek gövdelerinde müşteri PII verileri, üçüncü taraf
  veri aktarımına yasal yasak
- **Kamu, savunma** — internetten bağlantısı olmayan hazırlık ağları, sertifikalı
  güvenli kümeler
- **Sağlık** — hasta verilerine karşı imzalanmış bir token'a dokunan her satıcı için
  HIPAA / GDPR riski
- **Dahili platform ekipleri** — SaaS çalışma alanlarını engelleyen kurumsal proxy'ler
  veya koleksiyonların bir satıcının S3'ünde yaşamasını istemeyen kurumsal mimarlar

Güvenlik incelemeniz "bu veriler nereye gidiyor?" sorusuyla başlıyorsa, Testnizer
istisna gerektirmeyen bir yanıttır.

## Burada "çevrimdışı" gerçekte ne anlama geliyor

Üç somut iddia, her biri kod tarafından zorunlu kılınmış:

### 1. Renderer internete erişemez

React arayüzü katı bir
[İçerik Güvenliği Politikası](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) ile çalışır:
`connect-src 'self'`. Tarayıcılar, renderer'ın kendi kaynağı dışına giden her
`fetch`, `WebSocket` veya `EventSource` çağrısını engeller. Kötü niyetli bir
bağımlılık arayüz thread'inden dışarıya sinyal göndermeye çalışsa bile, fiziksel
olarak bunu yapamaz.

Renderer ayrıca **sandbox'lıdır** (Chromium'un işletim sistemi sandbox'ı; context
isolation açık, Node entegrasyonu kapalı) ve preload yalnızca denetlenmiş
`window.api` köprüsünü ile düz `platform` ve `versions` değerlerini sunar — ham IPC
yok, süreç ortam değişkenlerinden hiçbiri yok. **Web izinleri varsayılan olarak
reddedilir**: kamera, mikrofon, konum, bildirimler, aygıt erişimi ve benzerleri,
önizlemede gösterilen bir yanıt gövdesi dahil her çerçeve için reddedilir. Yalnızca
uygulamanın kendi penceresi panoya yazabilir (her Kopyala düğmesi), panodan
okuyabilir (İçe Aktar → panodan yapıştır) ve bir video yanıtını tam ekrana
alabilir. Bir yanıtın satır içi PDF önizlemesi de aynı politika altında çalışır.

### 2. Her API çağrısı denetlenmiş bir handler üzerinden geçer

"Gönder"e bastığınızda, istek IPC sınırından Electron'un ana sürecine geçer.
Orada protokol başına tek bir Node tarafındaki handler üzerinden yönlendirilir —
`http.engine.ts`, `soap.engine.ts`, `grpc.engine.ts`, vb. Bu handler'ların her
biri yalnızca yapılandırdığınız uç noktaya yönlenir — asla bir satıcı sunucusuna
değil.

### 3. Saklanan sırlar işletim sistemi anahtarlığınızla şifrelenir

Sır değişkenler, mock sunucu token'ları, git token'ları, sertifika parolaları ve
keystore'lar Electron'un
[`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) API'sından geçer.
macOS'ta bu Keychain'dir. Windows'ta DPAPI. Linux'ta libsecret. Şifreli blob yerel
SQLite veritabanınızda yaşar ve ham değer yalnızca bir istek gerektirdiğinde ana
süreçte çözülür. Anahtarlığın olmadığı yerde (bazı Linux kurulumları) bu değerler
şifrelenmeden saklanır ve Testnizer bunu size söyler; anahtarlık kullanılabilir olunca
sonraki açılışta şifrelenirler. Bir isteğin Auth sekmesine doğrudan yazdığınız kimlik
bilgileri yerel veritabanında düz metindir — gerçek değeri bir sır değişkende tutun ve
`{{secretVar}}` ile başvurun. Sır değerler her proje dosyasında, Git commit'inde ve
dışa aktarımda boşaltılır.

## Bulut araçlarıyla karşılaştırma

| Endişe | Bulut araçları | Testnizer |
|---|---|---|
| Koleksiyonlar nerede yaşar | Satıcı bulut çalışma alanı | Diskinizdeki yerel SQLite |
| Token'lar nerede saklanır | Satıcı sunucularına senkronize edilir | İşletim sistemi anahtarlığı (Keychain / DPAPI / libsecret), varsa |
| JWT çözümleme | Web uygulaması token'ı uzak servise gönderir | Yerel kripto — token süreç içinde kalır |
| WS-Security imzalama / şifreleme | Çevrimiçi araçlar veya ayrı bir masaüstü uygulama | xml-crypto + Node crypto ile yerleşik ana süreç |
| Telemetri | Varsayılan olarak açık | Yok — ve opt-in da yok |
| Durağan durumdaki ağ çıkışı | Arka plan senkronizasyonu, analizler, giriş ping'leri | Sıfır. CSP `connect-src 'self'` |
| İnternetsiz ağ | Çalışmaz | Çalışır |

## Ödünleşim

Bir ödünleşim var. Bulut olmadan, otomatik ekip senkronizasyonu da yok.

Yanıtımız: zaten sahip olduğunuz Git'i kullanın. Testnizer projeleri klasörlerdir.
Bir depoya ekleyin, dallandırın, PR'larla inceleyin. İşbirliği modeli, mühendislik
organizasyonunuzun zaten güvendiği modeldir — bir satıcının özel "çalışma alanı
paylaşma" özelliği değil.

Git incelemesinin altyapı kodu için zaten doğruluk kaynağı olduğu
organizasyonlar için bu, gerçekten uyum sağlayan kalıptır.

## Daha fazla bilgi

- [Güvenlik modeli](/security) — üç kuralın kodda nasıl uygulandığı
- [Sürümleri doğrulama](/tr/docs/build-from-source) — hava boşluklu transfer için SHA-256 sağlama toplamları
