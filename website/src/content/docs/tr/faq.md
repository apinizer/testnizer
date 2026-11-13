---
title: Sık sorulan sorular
description: Çevrimdışı kullanım, veri depolama, uyumluluk, lisanslama ve Postman'den geçiş hakkında yaygın soruların yanıtları.
order: 3
section: Referans
---

## Postman'den nasıl geçiş yaparım?

**İçe Aktar** iletişim kutusunu açın (`Dosya → İçe Aktar` veya sol kenar
çubuğuna dosya sürükleyin), **Postman** kartını seçin ve Postman dosyanızı
seçin. Testnizer, Postman Koleksiyonu **v1, v2.0, v2.1 ve v3** biçimlerini
(tek bir JSON dosyası ya da **Klasör içe aktar…** ile bir Postman 12 *Native Git*
klasörü), Postman ortam ve globals dosyalarını, bir Postman veri dışa aktarımını
ve bunların `.zip` arşivlerini okur. Sürümü dosyadan kendisi algılar; sizin
seçmeniz gerekmez.

Klasör hiyerarşisi, istek açıklamaları, ön istek scriptleri, test scriptleri,
kayıtlı örnekler ve yetkilendirme ayarları korunur. Koleksiyon değişkenleri
projenin **Globaller**'i olur; koleksiyon düzeyindeki kimlik doğrulama ve
scriptler her isteğe kopyalanmak yerine içe aktarma klasörüne taşınır. Bir şey
aktarılamazsa (Testnizer'da olmayan bir kimlik doğrulama türü, bir Kafka isteği,
bir `pm.require` çağrısı) **İçe aktarma tamamlandı** paneli bunu listeler.
Ayrıntılar için [İçe ve dışa aktarma](/tr/docs/import-formats#postman), Globaller
için [Ortamlar ve değişkenler](/tr/docs/environments#globaller) sayfalarına bakın.

---

## Testnizer hangi protokolleri destekliyor?

HTTP / REST, SOAP, WebSocket, GraphQL (query, mutation ve subscription), gRPC, SSE,
Socket.IO, MQTT, MCP ve AI Chat; her birinin kendi editörü var. Mock sunucular dört
türde gelir (HTTP, SSE, AI ve MCP). Bkz. [Protokollere genel bakış](/tr/docs/protocols)
ve [Mock sunucular](/tr/docs/mock-server).

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
Branch'lar doğrudan Testnizer branch'larıyla eşlenir. Bir pull projenin tamamını
getirir: proje düzeyindeki kimlik doğrulamayı, script'leri ve istek ayarlarını da.
Secret değişken değerleri, mock token'ları ve sertifika passphrase'leri dosyaya
asla yazılmaz; her ekip üyesi kendisininkini girer, pull da makinenizde kaç secret
değerin hâlâ boş olduğunu söyler. Bkz. [Git entegrasyonu](/tr/docs/git-branches).

**Veritabanı kopyası.** Tek seferlik aktarımlar için `testnizer.db` dosyasını bir
makineden diğerine kopyalayabilirsiniz. Dosya macOS'ta `~/Library/Application
Support/Testnizer` konumunda, Windows'ta `%APPDATA%\Testnizer` konumunda ve
Linux'ta `~/.config/Testnizer` konumundadır. Bu, hedef makinedeki tüm verilerin
yerini alır; bu nedenle yalnızca ilk kurulum veya geçiş senaryoları için kullanın.

---

## Mevcut Postman scriptlerim Testnizer'da çalışır mı?

Scriptlerin büyük çoğunluğu değişiklik gerektirmeden çalışır. Testnizer, `pm.request`,
`pm.response`, `pm.environment`, `pm.globals`, `pm.collectionVariables`,
`pm.variables`, `pm.vault`, `pm.test` (`done` callback biçimi dahil), `pm.expect`
ve `pm.sendRequest` dahil olmak üzere `pm` script API'sini uygular.

Aşağıdaki Postman'e özgü özellikler desteklenmez:

- Görselleştirici (`pm.visualizer.set()`) — eşdeğeri yok; çıktı yok sayılır
- `pm.require()` (Postman paket kütüphaneleri) — açık bir "desteklenmiyor" hatası
  fırlatır; yerleşik `require()` kütüphaneleri yaygın ihtiyaçları karşılar
- `pm.info.iteration` ve `pm.info.iterationCount` — yalnızca koleksiyon çalıştırıcı
  bağlamında kullanılabilir, tek istek çalıştırmalarında değil
- Yerleşik Postman bulut veya izleme API'lerine yapılan başvurular

`pm.require()` çağıran bir script açık bir "desteklenmiyor" hatasıyla başarısız
olur ve içe aktarma raporu onu kullanan script'leri adıyla listeler. Git'ten ya da
proje dosyasından gelen bir proje, siz bu bilgisayarda izin verene kadar hiçbir
script çalıştırmaz.

---

## WSDL URL'si bir güvenlik duvarının arkasındaysa ne olur?

Testnizer WSDL belgelerini ana süreçten getirir; bu nedenle Testnizer'ı çalıştıran
makine için geçerli olan güvenlik duvarı kuralları WSDL alımı için de geçerlidir.
WSDL URL'sine erişilemiyorsa SOAP editöründe bağlantı hatası görürsünüz.

Kısıtlı bir WSDL URL'sini aşmak için WSDL dosyasını yerel olarak kaydedin ve
SOAP istek editöründeki **Dosyadan yükle** seçeneğini kullanın. Testnizer yerel
dosyayı ayrıştırır ve ağ isteği yapmadan tüm kullanılabilir operasyonları listeler.

---

## Secret'larım şifreli mi?

**Secret** olarak işaretli değişkenler (current ve initial değer), mock sunucu
kimlik doğrulaması, Mock MCP bearer token'ı, sertifika passphrase'leri ve AI Chat
API anahtarları yerel veritabanında işletim sisteminin anahtarlığıyla şifrelenir
(macOS'ta Keychain, Windows'ta DPAPI, Linux'ta libsecret). Uygulamadan çıkan her
dosyaya (Git, proje dosyaları, dışa aktarmalar) boş değer olarak yazılır. Geçmiş,
Console, koşum raporları ve mock logları, bir şey saklanmadan ya da gösterilmeden
önce kimlik bilgilerini ve secret değişkenlerinizin değerlerini maskeler.

Anahtarlığın olmadığı yerlerde (bazı Linux kurulumları) bu değerler şifrelenmeden
saklanır ve ortam editörü ile Ayarlar bunu söyler. Bir değer artık çözülemiyorsa
(örneğin anahtarlık değiştiyse) alan sizden yeniden girmenizi ister. Bir isteğin
Auth sekmesine doğrudan yazdığınız kimlik bilgileri istekte yazdığınız gibi saklanır:
gerçek değeri bir secret değişkende tutun ve `{{secretVar}}` ile başvurun.

Opsiyonel **uygulama şifresi** açılışta bir kilittir, veritabanı şifrelemesi değildir.

---

## Sertifikalar ve özel anahtarlar nasıl saklanır?

İstemci sertifika dosyaları (PEM / P12) dosya yollarıyla başvurulur. Özel anahtar
parolası, varsa, Electron `safeStorage` ile — işletim sistemi anahtarlığıyla —
şifrelenir: macOS'ta Keychain, Windows'ta DPAPI, Linux'ta libsecret. Linux'ta
anahtarlık yoksa parola bilgisayarınızda şifrelenmeden saklanır. Proje dosyalarına,
Git'e ya da dışa aktarımlara asla yazılmaz.

Sertifika dosyalarının kendisi asla uygulama veri dizinine kopyalanmaz —
Testnizer onları her istek yapıldığında belirttiğiniz yoldan okur.

---

## Telemetri tamamen devre dışı mı?

Evet. Testnizer hiçbir telemetri, çökme raporlama veya kullanım analizi kütüphanesi
içermez. Uygulama, yazılım güncellemelerini kontrol etmek dışında (aşağıdaki
"Hava boşluklu ortamda güncellemeler nasıl çalışır?" bölümüne bakın) arka planda
herhangi bir ağ isteği yapmaz. Güncelleme kontrolleri **Proje ayarları →
Güncelleme → Güncellemeleri otomatik kontrol et** bölümünden de devre dışı bırakılabilir.

---

## Testnizer ticari kullanım için ücretsiz mi?

Evet. Testnizer, kullanıcı, proje veya istek sayısında herhangi bir kısıtlama
olmaksızın kişisel ve ticari kullanım için ücretsizdir. Ücretli katman, koltuk
lisansı veya özellik kilidi yoktur. Projenin kaynağı ve gelecekteki lisans
değişiklikleri, yürürlüğe girmeden önce resmi web sitesinde duyurulacaktır.

---

## Hava boşluklu ortamda güncellemeler nasıl çalışır?

Hava boşluklu ortamda **Proje ayarları → Güncelleme** bölümünden otomatik
güncelleme kontrollerini devre dışı bırakın. Yeni bir sürüm mevcut olduğunda, uygun
yükleyiciyi internet erişimi olan bir makinede resmi sürümler sayfasından
indirin, dosyayı hava boşluklu makineye aktarın ve yükleyiciyi manuel olarak
çalıştırın. Yükleyici, uygulama veri dizinini korurken mevcut kurulumun yerini alır.

Varsayılan olarak Testnizer güncellemeyi arka planda indirir ve hazır olunca sorar:
**Yeniden başlat ve yükle**, **Çıkışta yükle** ya da **Bu sürümü atla**. Yeni bir
sürümün ilk açılışı önce veritabanınızı bir `backups` klasörüne kopyalar; bkz.
[Başlarken](/tr/docs/getting-started#güncellemeden-sonra-bir-yedeği-geri-yükleme).
Testnizer 1.6.0, macOS 13 (Ventura) veya üstünü gerektirir.

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

## CI için komut satırı çalıştırıcısı var mı?

1.6.0'da yok. Bağımsız bir CLI yol haritasında ama henüz yayımlanmadı. Tıklamadan
koşum için şimdilik uygulama içi **Scheduler**'ı kullanın ve herhangi bir koşumun
**HTML** ya da **JSON** raporunu kaydedin. Bkz.
[Collection runner & otomasyon](/tr/docs/cli-and-automation).

---

## Testnizer proxy sunucuları destekliyor mu?

Evet. **Ayarlar → Ağ → Proxy** bölümünden ya da tek proje için **Proje Ayarları**'ndan bir
HTTP proxy ayarlayın. HTTP, SOAP, GraphQL (abonelikler dahil), WebSocket, Socket.IO, MQTT ve
SSE için geçerlidir. **Bu host'lar için bypass** listesindeki host'lar doğrudan çıkar. SOCKS
proxy henüz desteklenmiyor; SOCKS ayarlı istek mesajla başarısız olur. gRPC, MCP ve AI Chat
bu ayarı kullanmaz.

Proxy kimlik doğrulama (kullanıcı adı ve parola) desteklenir. Parola, işletim
sistemi anahtarlığıyla (`safeStorage`) şifrelenir ve koleksiyon veya ortam
dosyalarına yazılmaz.

**Sistem proxy'sini kullan** seçiliyse HTTP istekleri macOS ya da Windows ağ ayarlarını değil
`HTTP_PROXY`, `HTTPS_PROXY` ve `NO_PROXY` ortam değişkenlerini okur. WebSocket, Socket.IO, MQTT,
SSE ve GraphQL abonelikleri yalnız özel proxy kullanır.

---

## gRPC için TLS sertifika doğrulamasını kapatabilir miyim?

Hayır. gRPC, HTTP, SOAP ve GraphQL'in kullandığı **SSL doğrulama** ayarını izlemez:
TLS açıkken sunucu sertifikasını her zaman doğrular. Öz imzalı sertifikalı bir
sunucu için [gRPC sayfasında](/tr/docs/protocols/grpc) anlatıldığı gibi CA
sertifikasını ekleyin; TLS kullanmayan yerel bir sunucu için **Plaintext** seçin.
