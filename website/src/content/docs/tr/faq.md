---
title: Sık sorulan sorular
description: Çevrimdışı kullanım, veri depolama, uyumluluk, lisanslama ve Postman'den geçiş hakkında yaygın soruların yanıtları.
order: 3
section: Referans
---

## Postman'den nasıl geçiş yaparım?

**İçe Aktar** iletişim kutusunu açın (`Dosya → İçe Aktar` veya sol kenar çubuğuna
dosya sürükleyin) ve Postman dışa aktarma dosyanızı seçin. Testnizer, Postman
Koleksiyonu v2 ve v2.1 biçimini destekler. Postman'den JSON olarak dışa aktarılan
ortamlar da içe aktarılabilir — aynı İçe Aktar iletişim kutusunu kullanın ve ortam
dosyasını seçin.

Klasör hiyerarşisi, istek açıklamaları, ön istek scriptleri, test scriptleri ve
yetkilendirme ayarları korunur. Az sayıda Postman'e özgü koleksiyon çalıştırıcı
seçeneği (örn. `postman.setNextRequest`) işlemsiz olarak kabul edilir ve içe
aktarma sırasında konsola kaydedilir.

---

## Testnizer harici sunuculara veri gönderiyor mu?

Hayır. Testnizer bağımsız bir masaüstü uygulamasıdır. Tüm HTTP istekleri, ana
Electron sürecinden doğrudan hedef API'ye yapılır — herhangi bir ağ çağrısında
Testnizer iletim sunucusu, telemetri uç noktası veya analiz servisi yer almaz.
Bunu yerel bir proxy ile giden trafiği inceleyerek doğrulayabilirsiniz: tek
bağlantılar açıkça talep ettiğiniz ana bilgisayarlara yapılır.

---

## Aynı kurulumu Windows, macOS ve Linux'ta aynı anda kullanabilir miyim?

Evet. Testnizer tüm verileri her makinedeki uygulama veri dizininin içinde yerel
bir SQLite veritabanında (`testnizer.db`) saklar. Merkezi hesap veya lisans sunucusu
yoktur. Uygun platform paketini her makineye bağımsız olarak yükleyin. Koleksiyonları
makineler arasında paylaşmak istiyorsanız Git entegrasyonunu kullanın (aşağıdaki
"Ekibimle nasıl paylaşırım?" bölümüne bakın).

---

## Bir koleksiyonu ekibimle nasıl paylaşırım?

İki yaklaşım vardır.

**Git deposu (önerilen).** Sol kenar çubuğundaki branch panelinden proje klasörü
içinde bir Git deposu başlatın. Değişiklikleri herhangi bir kod tabanında yaptığınız
gibi commit edin ve push edin. Takım üyeleri depoyu klonlar ve Testnizer'da açar.
Branch'lar doğrudan Testnizer branch'larıyla eşlenir.

**Veritabanı kopyası.** Tek seferlik aktarımlar için `testnizer.db` dosyasını bir
makineden diğerine kopyalayabilirsiniz. Dosya macOS'ta `~/Library/Application
Support/Testnizer` konumunda, Windows'ta `%APPDATA%\Testnizer` konumunda ve
Linux'ta `~/.config/Testnizer` konumundadır. Bu, hedef makinedeki tüm verilerin
yerini alır; bu nedenle yalnızca ilk kurulum veya geçiş senaryoları için kullanın.

---

## Mevcut Postman scriptlerim Testnizer'da çalışır mı?

Scriptlerin büyük çoğunluğu değişiklik gerektirmeden çalışır. Testnizer, `pm.request`,
`pm.response`, `pm.environment`, `pm.globals`, `pm.collectionVariables`,
`pm.variables`, `pm.test`, `pm.expect` ve `pm.sendRequest` dahil olmak üzere `pm`
script API'sini uygular.

Aşağıdaki Postman'e özgü özellikler desteklenmez:

- `postman.setNextRequest()` — koleksiyon çalıştırıcı yalnızca sıralı çalıştırmayı kullanır
- Görselleştirici (`pm.visualizer.set()`) — eşdeğeri yok; çıktı yok sayılır
- `pm.info.iteration` ve `pm.info.iterationCount` — yalnızca koleksiyon çalıştırıcı
  bağlamında kullanılabilir, tek istek çalıştırmalarında değil
- Yerleşik Postman bulut veya izleme API'lerine yapılan başvurular

Bir script desteklenmeyen bir yöntemi çağırırsa Testnizer, isteği başarısız
yapmak yerine konsola bir uyarı kaydeder ve çalıştırmaya devam eder.

---

## WSDL URL'si bir güvenlik duvarının arkasındaysa ne olur?

Testnizer WSDL belgelerini ana süreçten getirir; bu nedenle Testnizer'ı çalıştıran
makine için geçerli olan güvenlik duvarı kuralları WSDL alımı için de geçerlidir.
WSDL URL'sine erişilemiyorsa SOAP editöründe bağlantı hatası görürsünüz.

Kısıtlı bir WSDL URL'sini aşmak için WSDL dosyasını yerel olarak kaydedin ve
SOAP istek editöründeki **Dosyadan yükle** seçeneğini kullanın. Testnizer yerel
dosyayı ayrıştırır ve ağ isteği yapmadan tüm kullanılabilir operasyonları listeler.

---

## Sertifikalar ve özel anahtarlar nasıl saklanır?

İstemci sertifika dosyaları (PEM / P12) dosya yollarıyla başvurulur. Özel anahtar
parolası, varsa, macOS'ta `electron-store` aracılığıyla işletim sistemi anahtarlığında
(Keychain Access) ve Windows'ta Windows Kimlik Bilgisi Yöneticisi'nde saklanır.
Linux'ta parola, makineye özgü bir anahtar kullanılarak uygulama veri dizininde
şifreli bir dosyada saklanır.

Sertifika dosyalarının kendisi asla uygulama veri dizinine kopyalanmaz —
Testnizer onları her istek yapıldığında belirttiğiniz yoldan okur.

---

## Telemetri tamamen devre dışı mı?

Evet. Testnizer hiçbir telemetri, çökme raporlama veya kullanım analizi kütüphanesi
içermez. Uygulama, yazılım güncellemelerini kontrol etmek dışında (aşağıdaki
"Hava boşluklu ortamda güncellemeler nasıl çalışır?" bölümüne bakın) arka planda
herhangi bir ağ isteği yapmaz. Güncelleme kontrolleri **Ayarlar → Genel →
Güncellemeleri otomatik olarak kontrol et** bölümünden de devre dışı bırakılabilir.

---

## Testnizer ticari kullanım için ücretsiz mi?

Evet. Testnizer, kullanıcı, proje veya istek sayısında herhangi bir kısıtlama
olmaksızın kişisel ve ticari kullanım için ücretsizdir. Ücretli katman, koltuk
lisansı veya özellik kilidi yoktur. Projenin kaynağı ve gelecekteki lisans
değişiklikleri, yürürlüğe girmeden önce resmi web sitesinde duyurulacaktır.

---

## Hava boşluklu ortamda güncellemeler nasıl çalışır?

Hava boşluklu ortamda **Ayarlar → Genel** bölümünden otomatik güncelleme
kontrollerini devre dışı bırakın. Yeni bir sürüm mevcut olduğunda, uygun
yükleyiciyi internet erişimi olan bir makinede resmi sürümler sayfasından
indirin, dosyayı hava boşluklu makineye aktarın ve yükleyiciyi manuel olarak
çalıştırın. Yükleyici, uygulama veri dizinini korurken mevcut kurulumun yerini alır.

macOS'ta yeni `.app` paketini Uygulamalar klasörüne sürükleyin. Windows'ta
`.exe` yükleyicisini çalıştırın. Linux'ta `.AppImage` dosyasını değiştirin
veya yeni `.deb` paketini yükleyin.

---

## Bulut senkronizasyon özelliği var mı?

Hayır ve bu kasıtlıdır. Testnizer, istek verilerinin — URL'ler, header'lar ve
yükler dahil — harici bir bulut servisine gönderilmesinin kabul edilemez olduğu
ekipler ve sektörler için tasarlanmıştır. Tüm veriler makinenizde veya kendi
sürüm kontrol sisteminizde kalır.

Makineler arasında senkronizasyon gerekiyorsa, yerleşik Git entegrasyonunu
kullanarak projeyi commit edin ve push edin.

---

## Test sonuçlarını bir CI pipeline'ına nasıl gönderirim?

Testnizer CLI çalıştırıcısını kullanın. Komut satırından şununla bir koleksiyon çalıştırın:

```bash
testnizer run --collection ./my-project.db \
              --environment staging \
              --reporter junit \
              --output ./results/report.xml
```

JUnit XML çıktısı Jenkins, GitLab CI, GitHub Actions ve diğer CI sistemleriyle
uyumludur. `--reporter json` ile JSON raporlayıcısı da kullanılabilir.
İlk başarısız testte çalıştırmayı durdurmak ve sıfır olmayan bir kodla çıkmak
için `--bail` bayrağını ayarlayın.

Tüm CLI seçenekleri için [CLI ve otomasyon](/tr/docs/cli-and-automation) bölümüne bakın.

---

## Testnizer proxy sunucuları destekliyor mu?

Evet. **Ayarlar → Ağ → Proxy** bölümünden bir proxy yapılandırın. Testnizer
tarafından yapılan tüm isteklere uygulanan HTTP veya SOCKS5 proxy adresi
belirleyebilirsiniz. İstek başına proxy geçersiz kılmaları şu anda desteklenmez;
proxy ayarı globaldir.

Proxy kimlik doğrulama (kullanıcı adı ve parola) desteklenir. Kimlik bilgileri
`electron-store`'da saklanır ve koleksiyon veya ortam dosyalarına yazılmaz.

macOS Ağ Tercihleri'nde veya Windows İnternet Seçenekleri'nde yapılandırılan
sistem proxy'si, Testnizer ayarlarında özel bir proxy belirlemediğiniz sürece
varsayılan olarak dikkate alınır.

---

## gRPC için TLS sertifika doğrulamayı nasıl devre dışı bırakırım?

gRPC istek editöründe **Bağlantı** sekmesini açın ve **TLS modu**'nu `Güvensiz`
olarak ayarlayın. Bu, yalnızca o istek için sunucu sertifika doğrulamasını devre
dışı bırakır ve `grpc.ssl_target_name_override` iletmek ve güvensiz kanal kimlik
bilgisi kullanmakla eşdeğerdir.

Üretim uç noktalarına karşı güvensiz mod kullanmayın. Öz imzalı sertifikalar için
daha iyi yaklaşım, kök CA sertifikasını **Ayarlar → Sertifikalar → Güvenilen CA**
bölümüne yüklemek ve TLS doğrulamasını etkin tutmaktır.

---

## v1.1 için neler planlanıyor?

v1.1 yol haritası, kaba öncelik sırasına göre şu öğeleri içermektedir:

- **Kendi barındırdığınız Git sunucusu üzerinden takım çalışma alanı senkronizasyonu**
  — uygulamadan ayrılmadan uzak kaynak yapılandırması için birinci sınıf kullanıcı arayüzü
- **Ortam değişken grupları** — çok sayıda servisi olan büyük projeler için tek
  ortam içinde değişkenleri adlandırılmış gruplara düzenleme
- **Koleksiyon çalıştırıcı iyileştirmeleri** — CSV/JSON dosyalarından veri güdümlü
  çalıştırmalar, paralel çalıştırma seçeneği ve geliştirilmiş HTML rapor şablonu
- **Yanıt karşılaştırma** — iki kaydedilmiş yanıt arasında veya bir temel çizgi
  ile canlı yanıt arasında yan yana diff
- **WSDL kod üretimi** — yüklenen WSDL'den TypeScript ve Java'da yazılı istemci
  taslakları oluşturma
- **Plugin API (beta)** — üçüncü taraf uzantıların istek editörleri, yanıt
  görüntüleyicileri ve kenar çubuğu panelleri eklemesine izin verme

Yol haritası değişikliğe tabidir. Kesin teslim tarihleri için resmi web sitesindeki
sürüm notlarını takip edin.
