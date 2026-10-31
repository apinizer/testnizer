---
title: Sürüm Notları
description: Testnizer için sürüm notları ve versiyon geçmişi.
order: 5
section: Referans
---

Her Testnizer derlemesi etiketlenir ve burada kayıt altına alınır. Bu
sayfa, sürüm açıklamaları için kaynak referansıdır — CI release job'u her
girdiyi karşılığı olan [GitHub Release](https://github.com/apinizer/testnizer/releases)
sayfasına aynalar; imzalı yükleyiciler ve SHA-256 sağlama toplamları
orada eklenir.

## v1.6.0

**Tam Postman uyumluluğu — her Postman dışa aktarımı içeri, Postman v2.1 ve v3
dışarı, MQTT ve eksiksiz WebSocket ile Socket.IO; MCP tam bir istemciye, mock
sunucuya ve güvenlik tarayıcısına dönüşüyor; mock sunucular akış yapmayı
öğreniyor; AI Chat MCP araçlarını çağırabiliyor; Git'e gerçek bir Commit
paneli geliyor; Electron 44 — ve secret'lar makinenizde kalıyor.**

- **Postman import:** herhangi bir Postman dosyasını bırakın, Testnizer ne
  olduğunu kendisi anlar — v1, v2.0 ya da v2.1 koleksiyonu, v3 koleksiyonu
  (tek bir JSON dosyası ya da Native Git klasörü), bir environment, bir
  globals dosyası, bir hesap veri dökümü ya da bunlardan herhangi birini
  içeren bir `.zip`. Hiçbir şey diske açılmaz; güvenli olmayan arşivler
  (klasörün dışına çıkan yollar, bağlantılar, şifreli ya da aşırı büyük
  girdiler) reddedilir. Her import tek adım olarak çalışır ve sonunda
  dönüştürülen, atlanan ya da taşınamayan her şeyin raporuyla biter.
  Kaydedilmiş yanıtlar örnek olarak, istek ayarları istek ayarı olarak, secret
  değişkenler şifrelenmiş olarak gelir. Koleksiyon kimlik doğrulaması import
  klasörüne (ya da projeye) konur ve istekler onu devralır; path değişkenleri
  (`:id`) kendi tablosuna kavuşur ve Send ile Run'da doldurulur.
  **Koleksiyon değişkenleri ve Postman globals artık projenin Globals'ına
  iniyor**, böylece hangi environment aktif olursa olsun çözülürler; zaten
  sahip olduğunuz bir değişken değerini korur ve çakışma listelenir. form-data
  ve binary gövdelerdeki göreli dosya yolları, Postman'deki gibi **Project
  Settings → Working directory** altından okunur. v3 koleksiyonundaki
  WebSocket, Socket.IO, MQTT, gRPC, GraphQL, MCP ve AI istekleri kendi
  editörlerinde açılır; Kafka ve Postman Data istekleri atlanmış olarak
  listelenir.

- **Postman export:** bir proje ya da test suite'i Postman **v2.1** (artık
  koleksiyon kimliği, kaydedilmiş örnekler, istek ayarları, koleksiyon
  değişkeni olarak proje değişkenleri, AWS Signature ve Hawk kimlik
  doğrulamasıyla) ya da **v3** olarak dışa aktarılır — Postman'in doğrudan
  açtığı tek bir JSON dosyası ya da Native Git klasörü; çıktı Postman'in
  yayımladığı şemaya karşı doğrulanır. v3'ün taşıyamadığı her şey tek bir
  uyarıda listelenir. Environment'lar ve Globals Postman dosyaları olarak
  dışa aktarılır, secret değerler hiçbir zaman yazılmaz.

- **MQTT:** MQTT 3.1.1 ve 5.0 destekli yeni bir protokol — istemci kimliği,
  clean session, keep-alive, kullanıcı adı ve parola, last will, sertifikalarınızla
  TLS, QoS'lu abonelikler, QoS, retain ve MQTT 5 özellikleriyle yayın,
  kaydedilmiş mesajlar ve aranabilir bir mesaj günlüğü. Ctrl+S ile kaydedilir,
  parolası maskelenmiş olarak History'de ve Console'da görünür ve Postman v3
  üzerinden gidip gelir.

- **WebSocket ve Socket.IO:** Postman'in ayarları, mesaj biçimleri (metin,
  JSON, XML, HTML, Base64, hex), kaydedilmiş mesajlar, günlük araması ve
  filtreleri, mesaj başına ayrıntılar ve mesajlar arası süre. Socket.IO ayrıca
  dinleme anahtarlı olay açıklamaları, onaylar (acknowledgement), emit başına
  birden çok argüman, el sıkışmada başlıklar ve v2, v3 ya da v4 istemci seçimi
  getirir (v2 token'ını `token` sorgu parametresi olarak gönderir). Bağlantıyı
  kapatan bir sunucu artık bağlantısı kopmuş olarak görünür. Açık WebSocket,
  Socket.IO ve MQTT bağlantıları, projelerinden ayrıldığınızda kapanır.

- **cURL:** URL çubuğuna bir cURL komutu yapıştırın, istek haline gelir — Undo
  ile; düz bir URL URL olarak kalır. Generate Code ve import üç türü de
  anlar: Linux/macOS kabuğu, Windows CMD ve PowerShell.

- **Generate Code:** bir dil, sonra bir varyant ve seçenekleri seçin — Postman
  CLI dışında Postman'in sunduğu her snippet'i kapsayan 36 varyant. GraphQL ve
  SOAP sekmeleri gerçek isteklerini üretir. form-data, Basic kimlik doğrulama
  ve Python JSON gövdeleri artık her dilde doğru.

- **Script'ler:** Send ve Run tek bir `pm` paylaşır, böylece bir script ikisinde
  de aynı davranır. `done` callback'li `pm.test` onu bekler (eskiden assertion
  başarısız olsa bile geçerdi), 118 Postman dinamik değişkeninin tamamı
  (`{{$randomEmail}}` …) çalışır, `pm.collectionVariables` projenin
  Globals'ını okur ve yazar, `pm.vault` secret değişkenlere karşı çalışır ve
  `pm.require` desteklenmediğini açıkça söyler. Insomnia import'ları
  Insomnia'nın kendi kuralını izler: base environment projenin Globals'ıdır ve
  siz bir environment seçene kadar `insomnia.environment` bu base'dir. Run ve
  mock sunucular artık aynı workspace'teki diğer projelerin Globals'ını
  görmez.

- **MCP istemcisi:** MCP sekmesi artık Postman'in MCP isteğinin yaptığı her
  şeyi kapsıyor. Tools'a ek olarak **Resources** (şablonlarıyla), **Prompts**
  ve **Notifications**; el sıkışma dahil hattaki her şeyin ham JSON-RPC frame
  görünümü, anlaşılan protokol sürümü, sunucu yönergeleri, bağlanırken özel
  HTTP başlıkları (içlerinde `{{değişkenler}}` çalışır), stdio ortam
  değişkenleri ve VS Code, Cursor ve Claude Desktop için MCP yapılandırmasını
  yapıştırma / dışa aktarma var. **Authorization** sekmesi No Auth, Basic,
  Bearer, API Key ve OAuth 2.1 sunuyor. **2026-07-28** protokolü 2024–2025
  sürümlerinin yanında destekleniyor: sekme başına seçici (Auto, Legacy ya da
  sabitlenmiş bir sürüm), bir dönem rozeti ve sunucu çağrı sırasında ek girdi
  istediğinde üretilen bir form. Tool argümanları aracın şemasından üretilen
  bir formla giriliyor (JSON geçişi ve satır içi doğrulamayla), çalışan bir
  çağrı iptal edilebiliyor, Ctrl/Cmd+Enter aktif eylemi çalıştırıyor, sonuç
  başlığı durum, süre ve boyutu Copy düğmesiyle gösteriyor. Sonuçta Postman'deki
  gibi bir **JSON | Preview** geçişi var. Uzun tool açıklamaları Show more ile
  kısaltılıyor; böylece Invoke / Read / Get hiçbir zaman erişilemez bir yere
  kaymıyor, sürüklenebilir (hatırlanan) ayraçlarla liste, çağrı ve sonucun
  boyutunu ayarlayabiliyorsunuz. Çağrılar Ctrl+S ile kaydedilebiliyor (seçili
  tool, argümanlar, resource URI'si, prompt), **Tests** ve **Scripts**
  sekmeleri (`pm.test`, `pm.expect`, `pm.mcp`) kazanıyor ve History'de
  görünüyor. Başka bir origin'e yönlendirme artık kimlik bilgisi başlıklarınızı
  oraya taşımıyor. Sunucunun gönderdiği eksik bir görüntü artık bozuk bir
  simge yerine bu şekilde bildiriliyor ("The server sent incomplete image
  data") ve **Download as received** ile alındığı gibi indirilebiliyor.

- **MCP OAuth 2.1 Debugger:** yetkilendirme el sıkışmasının tamamında adım
  adım ilerleyin — kimliksiz yoklama, protected-resource ve
  authorization-server metadata, dinamik istemci kaydı, PKCE, tarayıcıda
  oturum açma, token değişimi ve kimlik doğrulanmış bağlantı — her istek ve
  yanıt görünür. Connect'te gelen 401 bunu sizin için açıyor. Token'lar, PKCE
  verifier'ı ve istemci secret'ı uygulamanın ana sürecinde kalıyor, arayüz
  katmanına hiç ulaşmıyor; OAuth'a ait hiçbir şey kaydedilmiyor. Düz HTTP
  üzerindeki bir yetkilendirme sunucusu, o istek için açıkça izin vermediğiniz
  sürece reddediliyor; izin verildiğinde sunucunun kendi bildirdiği host'a
  sabitleniyor.

- **MCP Security Scan:** 30 kontrol üzerinden A–F notlu bir rapor — taşıma,
  kimlik doğrulama, protokol davranışı, tool açıklamalarında prompt-injection
  sezgileri, bilgi sızıntısı, CORS ve güvenlik başlıkları; ayrıca isteğe bağlı
  bir rate-limit yoklaması ve 2026-07-28 sunucuları için başlık doğrulama ile
  önbellek kapsamı kontrolleri. Kimlik bilgileri her bulgudan temizleniyor;
  rapor kendi içinde tam bir HTML dosyası olarak dışa aktarılıyor. Test etmeye
  yetkili olduğunuz sunucular içindir; ekran bunu söylüyor. Tarama artık
  **Security** sayfasında da listeleniyor ve oradaki aramayla bulunuyor.

- **Runner, Test Suite ve Scheduler'da MCP:** MCP istekleri atlanmak yerine
  bir koleksiyonda, test suite'inde ya da zamanlanmış görevde çalışıyor; geçti /
  kaldı kuralları ve `pm.*` script'leri Send ile aynı. Bir koşu etkileşimli
  bir isteği (oturum açma, sunucudan gelen bir soru) yanıtlayamaz; bu yüzden
  böyle bir satır açık bir mesajla kalıyor. Bir stdio sunucusunu koşu ancak o
  komuta bu bilgisayarda bir kez bağlandıysanız başlatıyor — Git'ten çekilen
  bir proje bir sonraki koşunuzda bilinmeyen bir programı çalıştıramaz.

- **Mock MCP Server:** Mocks panelinde yeni bir mock türü — yerel bir MCP
  sunucusu (Streamable HTTP ve legacy SSE); hazır şablonlar (Echo, Auth
  required, Error server, Complex schemas, Slow), JSON Schema'lı tool'lar,
  resource'lar, prompt'lar, gerçek korumalı bir sunucu gibi davranan bearer
  kimlik doğrulaması, gecikme ve hata senaryoları (JSON-RPC hatası, `isError`,
  zaman aşımı, HTTP durumu, her N'inci çağrı). Tek bir endpoint hem 2025 hem
  2026-07-28 istemcilerine hizmet ediyor ve o akışı test etmek için çağrı
  sırasında girdi isteyebiliyor. Loglar canlı, **Open in MCP tab** istemciyi
  önceden dolduruyor. Kaydedilmemiş Tools / Resources / Prompts sekmeleri nokta
  gösteriyor, dokunulmamış varsayılanları kaydetmeden önce uyarı çıkıyor ve
  Ctrl+S istek Save diyaloğunu açmak yerine mock'u kaydediyor. New mock server
  artık her tür için tek diyalog ve HTTP mock'ların da hazır şablonları var.

- **SSE ve AI mock sunucular:** iki mock türü daha. Bir **SSE** mock,
  tanımladığınız olayları akıtır (kare başına `{{stream.seq}}`,
  `{{stream.iteration}}`, `{{stream.now}}`); aralık, heartbeat, döngü,
  bağlantıyı açık tutma ve `Last-Event-ID` ile devam etme desteklenir; hazır
  ayarlar: Ticker, Finite replay, Notifications feed, Slow / heartbeat. Bir
  **AI** mock, OpenAI chat API'sini (ve `/v1/models`'i) ve Anthropic
  messages API'sini konuşur; istemci istediğinde akış yapar, aksi halde JSON
  ile yanıtlar, son parçada token kullanımını verir; hazır ayarlar:
  OpenAI-compatible chat, Anthropic messages, bir tool-call gidiş-dönüşü
  (Mock MCP Echo sunucusuyla eşleşir) ve hata yanıtları (`error-429`,
  `error-500`, `error-401`). **Start & open in SSE tab / AI Chat tab**,
  Testnizer'ın kendi istemcisini mock'a yöneltir — kayıtlı hiçbir sağlayıcı
  anahtarını göndermeden — ve AI editörü bir SDK'nın kullanması gereken temel
  URL'yi gösterir. Günlüklerde bir akış, parça başına bir satır değil, tek bir
  satırdır (kapanana kadar "streaming…"). SSE sekmesi artık, bir sunucu akışı
  bitirip yeniden bağlanmayı reddettiğinde "The server closed the stream"
  diyor ve normal biten bir akış artık hata olarak günlüğe yazılmıyor. Yeni
  ekranlar dar pencerelerde ve büyük yazı boyutlarında düzgün sarılıyor, New
  mock server penceresi ok tuşlarıyla çalışıyor, boş bir Mocks sayfası New mock
  server öneriyor ve kenar çubuğu araması tür ile portla eşleşiyor. Akışlar
  sabit boyutlu parçalara bölünebilir ya da bütün olarak gönderilebilir, seçtiğiniz
  durma nedeniyle (her sağlayıcının adlandırdığı biçimde yazılır) biter ve
  bilerek yarıda başarısız olabilir: N olaydan sonra bir SSE `event: error` ya
  da N parçadan sonra bir OpenAI / Anthropic hatası — Errors hazır ayarı ikisini
  de, ayrıca bir Anthropic 529 `overloaded_error`'ı içerir. Yeni bir hazır ayar,
  Anthropic messages API üzerinde bir tool çağrısının gidiş-dönüşünü yapar. Bir
  mock'un türü (HTTP / SSE / AI) hiçbir şey kaybetmeden Settings'ten
  değiştirilebilir; **Open in AI Chat** ayrıca Anthropic uç noktasını sunar ve
  bir Mock MCP sunucusu **Start & open in MCP tab** sunar. Bir mock'tan açılan
  sohbet sekmesi kayıtlı sağlayıcı anahtarınızı asla göndermez.

- **AI Chat:** asistan **MCP sunucularını araç olarak** kullanabilir — kayıtlı
  bir MCP isteği ya da geçici bir URL / stdio komutu, sunucu ve araç başına
  anahtarlarla. Her araç çağrısı varsayılan olarak onayınızı ister (Allow
  once, Allow for this conversation, Deny); "Run tools without asking"
  yalnızca açık sekme için geçerlidir ve asla kaydedilmez. Her yanıt durumunu,
  ilk token'a kadar geçen süreyi, süresini ve token kullanımını gösterir
  (sağlayıcı söylemiyorsa "not reported"). Sohbetler yerelde saklanır — yeni,
  geçiş, yeniden adlandırma, silme — asla dışa aktarılmaz ya da commit'lenmez
  ve yazılırken maskelenir. Ctrl+S artık AI Chat yapılandırmasını kaydedip
  geri yüklüyor; API anahtarları sağlayıcı başına işletim sisteminin anahtar
  deposuyla şifrelenir ve tarayıcı depolamasında tutulmaz; temperature ve max
  tokens ayarlanabilir. Settings ve Tools birlikte açıkken sohbet ince bir
  şeride sıkışıp onay düğmelerini kırpıyordu; yapılandırma artık sohbetin
  üstünde, boyutu değiştirilebilen kendi panelinde kayıyor ve sohbet asgari bir
  yükseklikte kalıyor. Bir sağlayıcı yanıtın ortasında hata bildirdiğinde AI
  Chat artık kısmi metni koruyor ve hatayı altında gösteriyor; eskiden yanıt
  tamamlanmış gibi görünüyordu.

- **Git:** dal menüsünde **Commit…**, Pull, Push, Merge ve **Discard all
  changes** var; ahead / behind sayıları gösteriliyor. Commit paneli neyin
  değiştiğini (eklenen, değişen, silinen) listeliyor ve commit'e girecek
  değişiklikleri seçmenize izin veriyor — gerisi projenizde kalıyor — sonra
  Commit (yerel), Commit and push ya da Discard. Başka bir değişikliğe bağlı
  olan bir değişiklik (bir istek klasörüne ihtiyaç duyar) onunla birlikte
  seçiliyor; böylece bir commit asla olmayan bir şeye işaret etmiyor. Push
  önce commit mesajı soruyor, kaç commit edilmemiş değişikliği içereceğini
  söylüyor ve yalnızca mevcut commit'leri gönderebiliyor. Bir takım
  arkadaşının Pull'u artık **projenin tamamını** getiriyor: proje düzeyindeki
  kimlik doğrulama, ön-istek ve test script'leri, zaman aşımı, SSL, yönlendirme
  ve TLS ayarları onları ayarlayan makinede kalıyordu; bu yüzden proje
  kimlik doğrulamasını miras alan istekler karşı tarafta bozuluyordu. İçlerindeki
  kimlik bilgileri dosyada boşaltılıyor, `{{değişken}}` referansları
  taşınıyor ve Pull bu makinede kaç secret değerinin hâlâ boş olduğunu söylüyor.
  Bir takım arkadaşının merge'ünü yeniden içe aldıktan sonra `main`'den ayrılmak
  artık yerel `main`'inizi uzaktan ayrıştıran yalnızca sıra değişikliği içeren
  bir "Auto-save" commit'i üretmiyor.

- **Secret'lar bu makinede kalıyor:** secret olarak işaretli değişkenler, HTTP mock
  kimlik doğrulaması, Mock MCP bearer token'ı ve sertifika parolaları
  uygulamadan çıkan her dosyada — Git, proje dosyaları, dışa aktarımlar —
  boş değer olarak yazılıyor; bir Pull ya da import yerelde sahip olduğunuz
  değerin üzerine asla yazmıyor. Bir mock şablonu artık token'ını sunucu
  açıklamasına kopyalamıyor ve başka biçimlerde saklanan mock kimlik doğrulaması
  (tek bir `token`, bir API anahtarı değeri, düz bir `password`) da kapsanıyor.
  Kimlik doğrulaması okunamayan bir mock isteklere geçit veriyordu; artık
  reddediyor. Dosyaları ya da parolası bu bilgisayarda olmayan bir sertifika
  devre dışı olarak içe aktarılıyor; böylece host'una giden her isteği
  bozamıyor. Eski bir sürümün yazdığı dosyayı içe aktarmak yarıda kesilmek
  yerine yerel klasör kimlik doğrulamanızı ve script'lerinizi koruyor.
  Yükseltirken: eski bir sürümün Git'e zaten gönderdiği secret'lar depo
  geçmişinde kalır, bu yüzden bunları yenileyin; eski bir sürümdeki bir takım
  arkadaşı bu sürümün yazdığı bir dosyayı çekerse güncelleyene kadar yerel
  secret değerlerinin boşaltıldığını görür; ve basic kimlik doğrulamalı, boş
  parolalı bir mock sunucu artık kimseyi içeri almıyor.

- **Secret'lar diskte şifreli:** secret environment ve global değişkenlerin
  değerleri, mock sunucu kimlik doğrulaması ve Mock MCP bearer token'ı artık
  yerel veritabanında işletim sisteminizin anahtarlığıyla şifreleniyor; AI Chat
  anahtarları ve sertifika parolaları zaten böyleydi. Mevcut değerler ilk
  açılışta bir kez şifrelenir ve veritabanı sıkıştırılır, böylece silinmiş
  değerler boş sayfalarda kalmaz. Bir değer artık çözülemiyorsa — örneğin
  anahtarlık değiştiyse — saklanır ve alan sizden yeniden girmenizi ister.
  Anahtarlığın bulunmadığı yerlerde (bazı Linux kurulumları) değerler eskisi
  gibi şifresiz kalır ve environment editörü ile Settings bunu söyler.

- **Electron 44:** Testnizer artık Chromium 152 ve Node 24 getiren Electron
  44.9.3 üzerinde çalışıyor. Electron 33 artık güvenlik düzeltmesi almıyordu.
  Geçiş, Electron'un kendi advisory'lerini kapatıyor — bunların arasında
  ele geçirilmiş eMudhra sertifikaları, Squirrel.Mac güncelleme yarışı ve
  Brotli kod çözücü açığı (CVE-2026-111497) var. Veritabanınız, şifreli
  secret'lar, ayarlarınız ve açık sekmeleriniz olduğu gibi taşınır. Bir test,
  önceki Electron'un yazdığı bir profili yenisiyle satır satır açar, sonra
  tekrar eskisiyle açar. **macOS 13 (Ventura) ya da üstü artık gerekli.**
  macOS 11 veya 12'de Testnizer 1.4.10 ve sonrası bu güncellemeyi sunmaz ve
  olduğu gibi çalışmaya devam eder; daha eski sürümlerde kurmayın.

- **Her güncellemeden önce veritabanı yedeği:** yeni bir sürüm ilk kez
  başladığında, herhangi bir şeyi değiştirmeden önce veritabanınızı uygulamanın
  veri klasöründeki `backups/` içine kopyalar; kopyadaki secret değerler de
  şifrelidir. En yeni üç kopya saklanır; disk neredeyse doluyken kopya atlanır
  (ve size söylenir) ve başarısız bir kopya daha eski bir kopyayı asla
  silmez. Bir kopyanın nasıl geri yükleneceği Getting started kılavuzunda.

- **SOAP WS-Security:** SOAP editöründe kurduğunuz WS-Security — UsernameToken,
  Timestamp, imza, şifreleme — artık Send'de ve Runner'da zarfa uygulanıyor;
  Send onu eskiden HTTP Basic başlığına çeviriyor, Run ise atlıyordu. Bir sunucu
  bu istekleri yalnızca o Basic başlığı sayesinde kabul ediyorsa, Auth
  sekmesinde Basic'i seçin. Herhangi bir öneki olan zarflar (SoapUI'nin
  yazdığı gibi `soapenv:`, `soap:` ya da varsayılan bir namespace)
  `wsse:Security` başlığını alır, Tools panelinde de; SOAP zarfı olmayan metin
  değişmeden geri dönmek yerine açık bir mesajla reddedilir. SOAP Send artık
  Run'ın yaptığı gibi Auth sekmesini (klasörden ya da projeden devralınan) ve
  Headers sekmesini de gönderiyor ve Generate Code aynı isteği gösteriyor.
  UsernameToken parolası History'de, Console'da ve çalıştırma raporlarında
  maskelenir.

- **Kritik istekler:** bir isteğin Settings sekmesinde **Critical request**
  kutusunu işaretleyin; "Stop run if an error occurs" ne derse desin, o istek
  başarısız olduğunda ya da çalışamadığında koşu durur; diğer istekler eskisi
  gibi hataların ardından devam eder. Sonuçlar, çalıştırma geçmişi ve HTML /
  JSON raporları koşuyu durduran kritik isteği adıyla belirtir ve kritik
  satırlar bir rozet taşır.

- **Tester kontrolünden:** GitHub'ın kısa süreliğine bir sunucu hatasıyla
  reddettiği bir push otomatik olarak yeniden denenir; yine de başarısız olursa
  mesaj hiçbir şeyin kaybolmadığını söyler ve yeniden push etmek ikinci bir
  commit oluşturmaz. macOS'ta dosya seçiciler adı `.jks`, `.p12`, `.pfx` ya da
  `.keystore` ile biten klasörleri açar. Bir Test Suite çalıştırma sonucundaki
  klasör simgesi isteği Tests'te gösterir. Bir mock uç noktası sistem
  tarayıcısı yerine bir istek sekmesinde açılır — herhangi bir metotla, Send ve
  Save ile.

- **Sağlamlaştırma:** bilinen advisory'si olan üretim bağımlılıkları
  güncellendi (kritik olan kalmadı; kalanlar belgelendi). Uygulama penceresi
  artık işletim sisteminin sandbox'ında çalışıyor, web izinleri (bildirimler,
  konum, kamera, mikrofon) uygulamanın kendisi ihtiyaç duymadıkça reddediliyor
  ve sayfa artık ortam değişkenlerine erişemiyor. MCP OAuth debugger'da,
  yazdığınız bir istemci secret'ı başka bir host'taki yetkilendirme sunucusuna ancak
  o host'u onayladıktan sonra gönderilir. Derleme hattımız her GitHub Action'ı
  sabit bir sürüme iliştirir ve salt-okunur izinlerle çalışır.

- **History, Console, Runner ve mock günlükleri kimlik bilgilerini gizliyor:**
  kimlik bilgisi başlıkları, her derinlikteki sorgu ve gövde alanları, URL'deki
  `user:pass@`, secret değişkenlerinizin değerleri ve yanıtlardaki token
  alanları, bir şey saklanmadan ya da gösterilmeden önce maskelenir. History,
  bir isteğin yeniden gönderilebilmesi için `{{değişken}}` şablonunu korur;
  Console varsayılan olarak maskeler ve yalnız oturumluk bir **Show secrets**
  sunar; eski History satırları ilk açılışta bir kez maskelenir. v1.6.0
  sürüm taraması daha da ileri gitti: bir istek gövdesinde (JSON, form, XML /
  SOAP — CDATA ve öznitelikler dahil) gönderilen bir kimlik bilgisi, bir sunucu
  onu başka bir adla bile geri yansıtsa her yerde maskelenir; mock günlüğü
  secret değişkenlerinizi aynı şekilde maskeler; ve WebSocket, Socket.IO, SSE,
  GraphQL ve gRPC sekmeleri artık alınan mesajları diske yazmaz — oturum
  boyunca bellekte yaşarlar ve eski bir sürümün kaydettikleri açılışta
  temizlenir. **Generate Code**, kod paneli ve MCP **Copy as…**, "Include
  secret values" işaretlenmedikçe secret değişkenleri `{{name}}` olarak tutar.
  Bir istek editörüne yazılan parolalar, token'lar, API anahtarları ve kimlik
  bilgisi başlıkları — HTTP, MCP, WebSocket, SSE, Socket.IO, MQTT, GraphQL,
  gRPC ve SOAP — artık uygulamanın tarayıcı depolamasında tutulmaz; yalnızca
  `{{değişken}}` başvuruları tutulur. Buna kimlik doğrulama alanları, kimlik
  bilgisi başlıkları ve üstverisi, sorgu parametreleri, form ve JSON gövde
  alanları, GraphQL değişkenleri, bağlantı URL'leri, MCP komut satırları ve
  tool argümanları, SOAP UsernameToken parolası ve imzalama anahtarı, MQTT
  parolası ve user property'leri ve gerçek zamanlı mesaj gövdelerindeki
  kimlik bilgisi alanları dahildir. Kaydedilmiş bir istek bunları kayıtlı
  istekten geri alır (yeniden başlatmanın hemen ardından Send'e bastığınızda
  da), kaydedilmemiş bir sekme ise yeniden başlatmadan sonra onları yeniden
  yazmanızı ister. WebSocket, gRPC, GraphQL, SSE ve Socket.IO çağrıları
  History'den kendi editörlerinde yeniden açılır.

- **Gizlilik politikası ve web sitesi:** metinler artık tam olarak neyin
  şifrelendiğini, neyin yerelde düz metin olarak saklandığını, mock
  sunucuların bellekte ne tuttuğunu, History'nin bağlantı protokolleri için ne
  kaydettiğini ve uygulama parolasının neyi koruduğunu anlatıyor. Metin
  değiştiği için onu yeniden kabul etmeniz isteniyor.

- **Editör ve günlük kullanım:** yeni bir HTTP isteği ilk kaydedildiğinde
  adını URL'sinden alır ("New Endpoint" değil, "users"). Sol panelin görünür
  bir daraltma düğmesi var ve durumunu hatırlıyor. Headers sekmesi
  **otomatik üretilen başlıkları** (Accept, User-Agent, Host, Content-Type,
  Content-Length, kimlik doğrulama, cookie'ler) her birinin nereden geldiğiyle
  listeliyor; kimlik doğrulama değerleri maskeli ve eklediğiniz bir başlık
  otomatik olanı geçersiz kılıyor — bu aynı zamanda farklı harf büyüklüğüyle
  yazılmış bir başlığın motorun değerine yenilmesini de düzeltiyor. Her açık
  sekme, Params'a geri atlamak yerine kendi istek alt sekmesini hatırlıyor.
  AI Chat istekleri POST rozeti yerine bir AI çipi gösteriyor. Ctrl+S ve Save
  penceresi her protokol için "Request saved" toast'ı gösteriyor. Zaman aşımı,
  yönlendirme ve SSL ayarları artık istekle birlikte kaydediliyor ve Send ile
  Run'da aynı davranıyor. Yerel açılır listeler artık metinlerini kırpmıyor,
  toast'lar doğru üst üste diziliyor ve kaydetme pencereleri önerilen adın
  dosya uzantısını koruyor (bir HTML raporu artık `.json` olarak inmiyor).
  Pencereler 1x monitörlerde net metin çiziyor; eskiden yarım piksele oturup
  bulanık görünüyorlardı. Yanıt paneli tamamen Türkçeye çevrildi. Uygulama
  genelindeki küçük metinler — ipuçları, rozetler, sayaçlar, günlük satırları —
  artık tasarlandıkları boyutta çiziliyor ve kod benzeri değerler (URL'ler,
  yollar, token'lar, protokol sürümleri) monospace yazı tipini kullanıyor;
  genel bir stil kuralı ikisini de eziyordu. WebSocket ve Socket.IO bağlantı
  çubukları artık MCP ve SSE çubukları gibi görünüyor ve okunuyor — temalı
  durum, çevrilmiş etiketler, karanlık mod. Açılır listeler, girdiler ve metin
  alanları da boyut ve renk sınıflarını izliyor; böylece bir select yanındaki
  girdiyle eşleşiyor, yer tutucular gerçek değerlerden daha açık ve boyutlar
  yazı tipi boyutu ayarını izliyor; Runner sonuç filtresi artık kırpılmıyor.

- **Uygulama parolası ve başlangıç ekranı:** Settings artık bir **App
  password** bölümüne sahip — bir parola ayarlı mı görün, değiştirin ya da
  mevcut parolanızla kapatın (eskiden buna yalnızca Project Home'daki Profile
  penceresinden ulaşılıyordu). Parola yokken Testnizer, ilk açılıştan sonra her
  seferinde "Continue" sormak yerine doğrudan projelerinize açılır ve parolayı
  kapatmak sizi uygulamada tutar. Başlangıç ekranının metni çevrildi ve artık
  doğruyu söylüyor: uygulama parolası açılışta bir kilittir, veritabanı
  şifrelemesi değil ve Testnizer bize hiçbir şey göndermiyor. Parola ayarlıyken
  kullanıcı menüsünde bu bölümü açan **Manage password…** var. Settings artık
  her açılışta geçerli tema, dil ve yazı tipi boyutunu gösteriyor; eskiden bunları
  komut paletinden değiştirip Settings'te Save'e basmak eski değerleri geri
  koyuyordu.

- **Çok sayıda açık sekme:** 20'den fazla sekme açıkken eski bir sekmeye
  dönmek boş bir istek gösterebiliyor, Ctrl+S de onu boş olarak kayıtlı olanın
  üzerine kaydediyordu; kaydedilmemiş bir taslak da metnini aynı şekilde
  kaybedebiliyordu. Kaydedilmemiş değişikliği olan sekmeler artık bellekten asla
  atılmıyor ve sekmesi atılmış (ya da yeniden başlatmadan sonra
  geri yüklenmemiş) kayıtlı bir istek, siz görmeden, kaydetmeden ya da
  göndermeden önce projeden yeniden yükleniyor.

- **Sekme şeritleri:** açık sekmeler ya da istek alt sekmeleri artık sığmadığında
  kaydırma çubukları editörü aşağı itmiyor; şeritler yüksekliğini koruyor,
  fare tekerleğiyle yana kayıyor ve aktif sekmeyi görünür tutuyor. Generate Code
  penceresi çevrildi ve Close düğmesi karanlık modda okunuyor.

- **Export:** tüm bir proje, APIs ağacının kökünden, File → Export'tan, Settings'ten
  ve Home'daki proje kartından **Postman v2.1, OpenAPI 3, Insomnia** ya da
  Testnizer JSON olarak dışa aktarılır. Ctrl+S ile kaydedilen istekler dahildir
  ve bir biçimin taşıyamadığı her şey sessizce düşürülmek yerine bir uyarıda
  listelenir. Postman ve Insomnia export'unda **Tests** sekmesi artık tam olarak
  taşınıyor: assertion satırları yanıt sonrası script'te `pm.test` koduna
  dönüşüyor, proje export'ları klasör kimlik doğrulamasını ve script'lerini
  koruyor ve projenin ön-istek / test script'leri koleksiyonun kendi
  script'leri oluyor. Dosyayı geri içe aktarmak testleri iki kez çalıştırmaz.
  XPath assertion'larının orada bir karşılığı yok ve yalnız Testnizer'da kalır.

- **Silinmiş bir isteği kaydetmek:** bir istek (ya da klasörü) sekmesi
  açıkken silindiyse, Ctrl+S eskiden "Request saved" deyip hiçbir şey yazmıyordu.
  Kaydedilmemiş değişikliği olan bir sekme artık kaydedilmemiş bir taslağa
  dönüşüp açık kalıyor ve Save, neden açıldığını söyleyen Save penceresini
  açıyor; böylece bir ad ve klasör seçiyorsunuz. Bir isteği ağaçtan ya da Tests
  panelinden silmek, kaydedilmemiş değişikliği yoksa sekmesini kapatıyor.

- **Test Suite çalıştırma sırası (gerileme):** birden çok klasörlü bir
  koleksiyondan kurulan bir suite "her modülün ilk isteği, sonra her modülün
  ikinci isteği" şeklinde çalışıyordu; bu yüzden bir modüldeki login, ona ihtiyaç
  duyan çağrılardan sonra çalışabiliyordu. Suite'ler yeniden modül modül
  çalışıyor — Run'da, Quick Run'da, Scheduler'da ve üç suite export'unun hepsinde
  APIs klasörü Run'ıyla aynı sırada. Klasör kimlik doğrulaması ve ön / son
  script'ler APIs'ten kurulan bir suite'e taşınıyor, iç içe klasörleri içe
  aktarmak artık "FOREIGN KEY constraint failed" ile başarısız olmuyor ve Run
  Sequence'ta bir isteği sürüklemek artık onu klasöründen çıkarmıyor.

- **Türkçe arayüz:** 110 metin düzeltildi; kenar çubuğu, sekme şeridi, istek
  editörü, Auth sekmesi, yanıt paneli, Environments penceresi, silme
  onayları, All Runs, Scheduled Tasks, Runner yapılandırması ve sonuçları,
  Console, History ile WebSocket, Socket.IO, GraphQL ve gRPC editörleri
  çevrildi; her kavram için tek terim kullanıldı (Test Paketi, uç nokta, dal).

- **Sürüm incelemesinden cilalar:** dört bağlantı çubuğu (WebSocket, SSE,
  Socket.IO, MCP) tek bir yüksekliği paylaşıyor ve aynı şekilde sarılıyor;
  mock editörü başlığı ve MCP editörü dar pencerelere ve büyük yazı boyutlarına
  sığıyor; **Start & open** sekmeyi bağlıyor ve zaten açık olanı yeniden
  kullanıyor; bir hatayla kesilen sohbet yanıtı "200 · interrupted" gösteriyor;
  yazılan kimlik bilgileri için yeniden başlatma ipucu yalnızca kaybedilecek bir
  şey olduğunda görünüyor; **Set a password…** sizi oturumdan çıkarmak yerine
  Settings içinde (kullanıcı menüsünden de) yerinde çalışıyor.

- **SSL doğrulaması ve yönlendirmeler projeyi izliyor:** bir isteğin **SSL
  verification** ve **Follow redirects** ayarları artık Send'de de Run'da da
  önce Project Settings'ten, sonra App Settings'ten devralınıyor — eskiden
  SSL doğrulaması kapalı bir proje Runner'da kendinden imzalı bir sunucuda yine
  başarısız oluyordu ve her kayıtlı istek kendi `true` değerini taşıyıp proje
  ayarını gizliyordu. Anahtarı hiç değiştirmemiş bir istek artık projeyi
  izliyor; açıkça ayarladığınız seçiminizi koruyor. SOAP ve GraphQL aynı
  ayarları (ve uygulama proxy'sini) kullanıyor ve Generate Code bunları
  taşıyor. gRPC sertifikaları doğrulamaya devam ediyor.

- **Settings nerede geçerli olduğunu söylüyor:** **Settings** ve **Project
  Settings** iki ayrı pencere olarak kalıyor ama her başlık ve alan artık
  kapsamını adlandırıyor — yazı tipi, tema ve dil uygulama genelindedir ve
  yalnızca Settings'te bulunur; zaman aşımı, SSL, yönlendirmeler ve proxy hangi
  düzeyden geldiklerini gösterir ve devralmaya sıfırlanabilir. İki pencere
  birbirine bağlanıyor ve kaydedilmemiş değişiklikleri bırakmadan önce soruyor.
  Uygulama düzeyindeki proxy artık bir projede proxy yokken gerçekten
  kullanılıyor (kaydediliyordu ama yok sayılıyordu), parolası History'de,
  Console'da ve çalıştırma raporlarında gizleniyor ve yalnızca parolası olan
  bir proxy onu koruyor.

- **Runner: sabit eylemler, rapor dışa aktarma, fail script:** **Start**,
  **Schedule** ve **Save**, yapılandırma ne kadar uzun ya da yazı tipi ne kadar
  büyük olursa olsun görünür kalan bir alt çubukta duruyor. Bir test suite'i, bir
  koleksiyon çalıştırması ve All Runs ya da Scheduled geçmişinin herhangi bir
  satırı, tek bir rapor oluşturucu üzerinden **HTML** veya **JSON** olarak
  dışa aktarılıyor; böylece dosyadaki sayılar ekranla eşleşiyor ve kimlik
  bilgileri aynı şekilde maskeleniyor. Bir suite'in (ve zamanlamasının) bir
  **Run fail script**'i olabilir: teardown'dan sonra, yalnızca koşu kırmızıysa
  bir kez çalışır — sonucu bir webhook'a ya da e-posta servisine göndermek için
  `pm.run.summary` ve `pm.run.exportHtml()` / `exportJson()` ile (anahtara
  `{{secretVar}}` olarak başvurun). Bir teardown satırı olarak görünür ve
  koşunun sonucunu asla değiştirmez; script sırasında Stop kaydedilir.

- **Bağlantı hataları her yerde aynı okunuyor:** WebSocket, Socket.IO, SSE, MCP
  ve MQTT hataları neyin nerede ters gittiğini adlandırıyor — reddedildi, zaman
  aşımı, DNS, TLS, HTTP durumu, geçersiz URL — bir ipucuyla, İngilizce ya da
  Türkçe. URL'deki token'lar (kullanıcı bilgisi, `token`, `sig`, `key`…) mesajda
  asla görünmüyor ve bir MCP sunucusunun kendi hata metni korunuyor.

- **Generate Code düz metin kimlik bilgilerini gizliyor:** **Include secret
  values** kapalıyken yazılmış parolalar, token'lar, başlıklardaki, sorgudaki
  ve form gövdelerindeki API anahtarları ve devralınan kimlik doğrulama `***`
  olarak görünür — snippet, Copy ve isteğin kendisi başka türlü değişmeden
  kalır; `{{değişkenler}}` okunur kalır.

- **Dar pencereler ve sekme şeridi:** editör çok daraldığında sağ panel kendi
  kendine kenara çekiliyor (ve geri geliyor) — elle açılırsa editörün üstüne açılıyor — URL kullanılabilir bir genişliği
  koruyor ve ikincil eylemler bir menüye taşınıyor; environment seçici ve **+**
  düğmesi, kaç sekme açık olursa olsun sekme şeridinin sağında sabit kalıyor.

- **Küçük UX borçları:** sağ panel yeni kullanıcılar için kapalı başlıyor ve
  seçiminizi hatırlıyor; yeni bir WebSocket, SSE ya da GraphQL sekmesi boş bir
  URL ile başlıyor; Postman export'u ağaçta gördüğünüz sırayı koruyor; secret
  değerler kısa bir açıklamayla tutarlı biçimde maskeleniyor; yeni bir mock
  sunucu portunu siz yazarken denetliyor; klavye kısayolları her yerde aynı
  gösteriliyor (macOS'ta ⌘) ve listelenenler artık çalışıyor — ⌥⌘C /
  Ctrl+Alt+C Console'u açıp kapatır, ⌥⌘← → / Ctrl+Alt+← → sekmeler arasında
  geçer; bir WebSocket bağlantı durumunu bir kez gösteriyor.

- **Türkçe, son adım:** Türkçe adları ve açıklamalarıyla HTTP durum kodları
  (arama iki dilde de çalışır), Tools yer tutucuları ve ipuçları, Runs,
  History, AI Chat ve günlüklerde tek bir tarih ve saat biçimi ve her iki dilde
  de tanınan varsayılan istek adları. Mock **Örnek ekle** parçalarının adları
  Türkçe, sayaçlar İngilizcede tekil/çoğul doğru yazılır ("1 warning" /
  "2 warnings") ve HTTP, GraphQL ya da SOAP zaman aşımı bağlantı değil istek
  zaman aşımı ayarını gösterir.

- **Run sonuçları ortamı adıyla gösterir:** bir koşu kullandığı ortamı
  kaydeder; sonuçlarda, All Runs'ta, Scheduled geçmişinde, zamanlanmış görev
  listesinde ve HTML / JSON raporda gösterir — ortam yoksa "Ortam yok".
  Ortamı sonradan yeniden adlandırmak ya da silmek geçmişi değiştirmez.

- **Send ve Run için tek aktif ortam:** hiçbir ortam aktif işaretli değilken
  başlık ve Send ilk ortamı, Run, Test Suite, Scheduler ve mock'lar ise hiçbir
  ortamı kullanmıyordu; **Ortam yok** seçimi de kaydedilmiyordu. Aktif ortamın
  artık tek kaynağı var, her seçim kaydedilir ve eski davranışa güvenen
  projeler gördükleri ortamı korur.

- **Dar pencerede Runner ayarları:** sıra listesi ile ayarlar yan yana
  sığmadığında sıra formun üstüne geçer; her alan ve Start / Schedule / Save
  alt çubuğu en küçük pencerede de bütün kalır.

**Testler:** süit 751 dosyada 10142 teste ulaştı ve tam UI uçtan uca süiti 884
spec koşturuyor. Yeni uçtan uca spec'ler Postman import'unu (hesap veri
dökümleri ve artifact'lar, Native Git v3 klasörleri, `.zip` arşivleri,
koleksiyon değişkenleri), Postman v3 export'unu, cURL yapıştırmayı, Generate
Code varyantlarını, MQTT'yi, WebSocket ve Socket.IO paritesini, Electron 44
geçişi boyunca bir profili açan bir yükseltme-verisi denetimini, renderer
sandbox'ını, SSE ve AI mock sunucularını (`tur1/mock-sse`, `tur1/mock-ai`; mock'u
Testnizer'ın kendi AI Chat motoruyla iki sağlayıcı için de süren bir parite
testi ve gerçek bir Mock MCP sunucusuna karşı çevrimdışı bir tool-call
gidiş-dönüşü dahil), iki pencere boyutunda her onay düğmesine isabet testi
yapılmış AI Chat düzenini, Security sayfasındaki MCP Security Scan girdisini,
Git Commit / Discard / seçmeli commit'i, tester-UX düzeltmelerini ve projenin
Postman'e dışa aktarılıp geri alınmasını kapsıyor. Secret'lar kanarya
taramalarıyla kapsanıyor: bir kimlik bilgisinin yaşayabileceği her yere benzersiz
bir nöbetçi değer yerleştirilir ve her dosya sınırının, History'nin,
Console'un, Runner'ın ve mock günlüğünün çıktısında o değer aranır — v1.6.0
taraması yukarıda düzeltilen sızıntıları bu yolla buldu. Git taşınabilirliğinin,
dışa aktarılan her tablonun her sütununu dolduran ve bir takım arkadaşının
bunu, tasarım gereği yerel kalan belgelenmiş bir liste dışında, birebir
aldığını denetleyen bir garanti testi var.

**Ertelenenler:** MCP dışındaki güvenlik taramaları — HTTP, GraphQL, SOAP,
gerçek zamanlı ve LLM uç noktaları; ve CLI / sözleşme / open-banking yol
haritası.

## v1.5.4

**İki makinede ayakta kalan Git senkronu, gerçekten yere inen bir Clone from
Git ve arka planda inip yalnızca hazır olunca soran güncellemeler.**

- **Makineler arası Git senkronu:** RC test turu akışın tamamını iki
  bilgisayarda sürdü — branch, merge, push, pull — ve sonucun birleşmediğini
  gördü. Pull yalnızca aktif branch'i çekiyordu; siz bir feature branch'inde
  otururken bir takım arkadaşının `main`'e gönderdiği merge yerel `main`'inize
  hiç ulaşmıyordu. Üstelik `git merge` sonrasında veritabanı hâlâ merge
  öncesi durumu tutuyor, bir sonraki Push bunu birleşmiş dosyanın *üstüne*
  export edip gönderiyordu — doğru sırayla yapılsa bile merge uzak depodan
  siliniyordu. Pull artık projeyi eşitliyor (her yerel branch uzak
  karşılığına fast-forward oluyor), bir takım arkadaşının ilerlettiği branch'e
  geçmek onu fast-forward ediyor, switch / merge önce veritabanını checkout'a
  yazıp sonra sonucu geri okuyor. Proje dosyası bir belge değil satırlar
  kümesidir; bu yüzden her biri bir istek ekleyen iki branch artık tek çözümü
  bir tarafı çöpe atmak olan metin düzeyinde bir çakışmayla bitmiyor: çakışan
  proje dosyaları **satır düzeyinde** birleştiriliyor (eklemeler korunur, tek
  taraflı değişiklik alınır, iki taraflı değişiklikte yeni düzenleme kazanır,
  değişiklik bayat silmeyi yener); yalnızca birleştiricinin okuyamadığı dosya
  hâlâ mine / theirs diyaloğuna düşüyor. Silmeler nihayet yayılıyor — bir
  makinede silinen istek diğerinin Pull'unda geri gelmiyor, Push'u onu
  diriltmiyor. Proje adı değişikliği depoyla taşınıyor; artık iki makine aynı
  dosyaya yazıyor (eskiden her biri kendi `<ad>.json`'ını yazıp yalnız onu
  okuyordu). **Clone from Git** ikinci makinede uzak depodaki satırları yanlış
  proje kimliğinin altına indiriyor, aynı makinede ise hiçbir ekranda
  görünmeyen *iç* proje adını — "My Project" — basan bir mesajla reddediyordu.
  Satırlar içe alan projeye bağlanıyor; "bir depo, bir yerel proje" kuralı
  proje yaratılmadan *önce* kontrol ediliyor ve projeyi Hub'daki adıyla
  anıyor. Yanlış bir PAT artık arkasında bozuk, boş bir depo bırakmıyor;
  token hiçbir zaman URL'ye ya da `.git/config`'e girmiyor; Push "Invalid
  username or token" yerine net bir mesajla başarısız oluyor.

- **Gerçek bir uzak depoda bulunan Git uç durumları:** boş bir depoya ilk
  Push, proje `main` derken `master` ile açılmış bir depo, kimse push
  yapmadan önce Pull, varsayılan branch'i artık olmayan bir depo ve yalnızca
  `desktop.ini` içeren bir checkout klasörü — hepsi temiz bir clone ile aynı
  duruma varıyor. Push klasördeki diğer *bütün* izlenen `.json` dosyalarını
  emekliye ayırıyordu — depoyu paylaşan ikinci bir proje, ekibin `notes.json`'ı
  — artık yalnızca bu projenin kendi eski dosyasını kaldırıyor. Projeyi yeniden
  adlandırmak Push'un hiçbir şey commit'lemeden başarı bildirmesine yol
  açıyordu; artık commit'liyor.

- **Güncellemeler arka planda iniyor:** güncelleme penceresi, daha hiçbir şey
  inmeden, yeni bir sürüm yalnızca *mevcut* olur olmaz açılıyordu ve arka
  plan indirmesi kapalıydı — her kontrol sizi bölüyor, üstelik yine bir tık
  gerektiriyordu. Güncellemeler artık sessizce iniyor; biri hazır olduğunda
  Testnizer öne geliyor ve köşedeki küçük bir kart soruyor: **Yeniden başlat
  ve yükle**, **Çıkışta yükle** ya da **Bu sürümü atla**. Hiçbiri kalıcı
  pencere değil; kartı kapatmak "çıkışta" demek. Atlanan bir sürüm arka
  planda ne yeniden indiriliyor ne öneriliyor (Ayarlar → Güncellemeleri
  Kontrol Et ile yine yüklenebilir) ve — asıl önemlisi — bir sonraki çıkışta
  sizden habersiz kurulmuyor. Başarısız bir kurulum sessiz kalmak yerine hata
  ve elle indirme bağlantısıyla pencereyi açıyor.

- **Kaydedilen yanıtlar örneğe dönüşüyor:** "Save response" artık yanıtı
  üreten isteği de saklıyor — hem `{{değişken}}`leri korunmuş editör şablonu
  hem de tele giden çözümlenmiş istek, kimlik başlıkları maskeli — ve örneği
  APIs ağacında isteğin altında listeliyor. Örnek kendi salt-okunur sekmesinde
  açılıyor (Gönderilen / Orijinal geçişi, altında kaydedilen yanıt); yeniden
  adlandırma ve silme ağaçtan da Saved sekmesinden de çalışıyor; örnekler
  export, import ve Git ile taşınıyor.

- **Düzenleme ve kaydetme:** Cmd/Ctrl+S APIs ağacını yeniliyor; metot
  değişikliği isteğin rozetinde hiçbir şeyi yeniden açmadan görünüyor.
  Send'in yanındaki Save düğmesi aynı yoldan geçiyor ve Ctrl+S'nin zaten
  yaptığı gibi SOAP, WebSocket, gRPC ve GraphQL üstverisini koruyor. Elle
  yazılmış bir SOAP isteği Save sonrasında boş URL, operasyon ve gövdeyle
  açılmıyor (Send zaten kayıtlı değerleri kullanıyordu) ve Runner elle SOAP'ı
  doğru `Content-Type` / `SOAPAction` ile gönderiyor. Proje kökü ağaçtan
  yeniden adlandırılabiliyor. APIs panelinin arama kutusu ve klasör durumu
  proje sekmeleri arasında paylaşılmıyor. Ön-istek script'indeki
  `pm.variables.set` artık Send'de de Run'daki gibi çözülüyor.

- **AI Chat:** kullanıcı tanımlı HTTP başlıkları destekleniyor ve
  doğrulanıyor (geçersiz olanın adı söyleniyor, değeri asla gösterilmiyor);
  Send düğmesi API anahtarı kullanmayan sağlayıcılar için anahtar dayatmıyor.

**Testler:** süit 320 dosyada 3867 teste ulaştı. Git işi, **gerçek bir bare
depo ve gerçek git** üzerinde, "makine" başına bir bellek-içi veritabanıyla ve
hiç mock olmadan koşan iki süitle kapsanıyor — raporlayanın dokuz adımlık
iki-cihaz akışı birebir, diğer merge sırası, Pull'suz branch değiştirme, silme
yayılımı, push edilmemiş satırların Pull'da hayatta kalması, reddedilen push →
Pull → Push, temiz makinede clone, aynı makinede ret, boş ve yalnız-`master`
depolar, branch oluşturma / silme / yalnız-uzak branch'ler, satır
birleştiricinin reddettiği çakışma (ours, theirs, abort), ad değişikliğinin
yayılması, sihirbazın inceleme adımı ve Save penceresinin checkout ile depo
paylaşan push / pull'u. Satır birleştiricinin kendi birim süiti var. Arka plan
güncelleme akışı store'da, ana süreçteki çıkışta-yükle anahtarında ve derlenmiş
uygulamaya güncelleme olaylarını enjekte edip pencere değil kartın — ve yalnız
indirme bitince — göründüğünü doğrulayan bir e2e spec'iyle kapsanıyor.

**Ertelenenler:** ana süreçteki git hata metinleri arayüz dilinden bağımsız
Türkçe (ana süreçte i18n yok); Save penceresinin kendi Pull'u hâlâ ekleyici
içe aktarıyor; çıkış anında kurulum yalnız birim testlerle sınanıyor, testlerde
güncelleme sunucusu yok.

## v1.5.3

**Parola sıfırlama artık Linux'ta da etki alanı hesaplarıyla çalışıyor — ve
sekmeler nereden gezinirseniz gezinin yanıtlarını koruyor.**

- **Linux / Active Directory'de parola sıfırlama:** sistem parolası doğrulaması
  yalnızca `/etc/shadow` dosyasını okuyan `unix_chkpwd` üzerinden yapılıyordu.
  SSSD ile etki alanına katılmış (`realm join`, Ubuntu'nun varsayılanı) bir
  hesap orada **hiç bulunmaz**; bu yüzden doğru bir etki alanı parolası hiçbir
  zaman doğrulanamıyordu. Doğrulama artık **tam PAM yığınına** düşüyor —
  yerel hesaplar için `pam_unix`, etki alanı hesapları için `pam_sss`; etki
  alanı denetleyicisine erişilemediğinde SSSD'nin çevrimdışı kimlik önbelleği
  de dahil. Yerel hesaplar zaten çalışan yolda kalıyor. Hata mesajları artık
  "parola hatalı" durumunu, "bu makinede `su` kısıtlanmış" ve "etki alanı
  denetleyicisine erişilemiyor" durumlarından ayırıyor — son ikisini parola
  hatası diye bildirmek, insanları sorunsuz bir parolayı sıfırlamaya
  yönlendiriyordu. Bu, v1.5.2'nin Windows tarafında yaptığı işi tamamlıyor.
- **İstek sekmeleri:** yanıt sekme başına saklanıyor, ama sekme şeridi tek
  yanıtlı dönemden kalma bir yanıt temizleme çağrısını hâlâ çalıştırıyordu —
  üstelik bunu aktif sekme değişmeden *önce* yapıyordu, dolayısıyla her geçiş
  ayrıldığınız sekmenin yanıtını siliyordu. Sekme kapatmada aynı hatanın
  ayna görüntüsü vardı. Ayrıca kenar çubuğunda **zaten açık** bir isteğe
  tıklamak, açma yolunun tamamını canlı sekme üzerinde yeniden çalıştırıyor;
  yanıtı siliyor ve kaydedilmemiş değişiklikleri geri alıyordu. Artık her
  açma yolu var olan sekmeyi öne getiriyor. Sekme şeridi de son sekme
  kapandığında — içindeki **+** ile birlikte — yerinde kalıyor; eskiden onunla
  beraber ekrandan kalkıyordu.
- **Collection Runner:** çalıştırma yapılandırması artık suite başına
  saklanıyor — sıra seçimi, Setup/Flow/Teardown rolleri, iterasyonlar,
  gecikmeler, hatada durdurma, yaşam döngüsü script'leri ve seçilen ortam
  açık bir **Save configuration** düğmesiyle kaydediliyor ve suite yeniden
  açıldığında, klasör ağacından doğrudan açıldığında da geri geliyor.
  Çalıştırma sonuçlarına bir **arama kutusu** (istek adı, klasör ve URL) ve
  bir **HTTP metot filtresi** eklendi; ikisi de mevcut All / Passed / Failed
  sekmeleriyle birlikte çalışıyor. Satır başına **Reveal in APIs** eylemi ise
  isteğin klasörlerini ağaçta açıp satıra kaydırıyor.
- **Projeler arası izolasyon:** açık projeler arasında üç şey sızıyordu.
  Runner sekmesi bilinçli olarak tekil olduğundan, kimliğine bağlı her durum
  parçası — çalıştırma sonuçları, rapor, suite kapsamı, görünüm — projeler
  arasında paylaşılıyordu: bir projede suite koşturun, projeyi değiştirin,
  Runner'ı açın; diğer projenin sonuçları orada duruyordu. Mock sunucular
  proje değiştirdiğinizde çalışmaya devam eder (bilerek), ama bir port
  çakışması portun "bu projede" kullanıldığını söylüyor ve kullanıcıyı yanlış
  projede aramaya yolluyordu; artık sunucunun adını veriyor ve portu hangi
  projenin tuttuğunu söylüyor. OAuth 2.0 token önbelleği kimlik bilgilerinin
  yalnız açık yarısını anahtarlıyordu; aynı token adresi ve client id ama
  **farklı secret** kullanan yapılandırmalar tek bir token'ı paylaşıyordu —
  kiracı başına secret kullanımında ve her secret rotasyonunda gerçekten
  yaşanan bir durum: eski token süresi dolana kadar sunulmayı sürdürüyordu.
- **Sağ tık menüsü:** uygulamanın kendine ait bir bağlam menüsü yoktu ve
  Electron da sağlamıyor; bu yüzden bir alana sağ tıklamak hiçbir şey sunmuyor,
  yapıştırmanın tek yolu Ctrl+V oluyordu. Girdi alanları, header/param
  satırları ve kod editörleri artık yerel bir Kes / Kopyala / Yapıştır /
  Tümünü Seç menüsü gösteriyor; yanıt gövdesi gibi salt-okunur alanlarda
  yalnız Kopyala ve Tümünü Seç çıkıyor.
- **Kaydedilmemiş değişiklik göstergesi:** New → HTTP (ya da başka bir
  protokol) ile açılan bir sekmenin henüz veritabanında bir karşılığı olmuyor
  ve değişiklik işaretleyen yardımcı tam da o sekmeleri atlıyordu — yepyeni
  bir istekteki düzenlemeler nokta göstermiyor, onay sormuyor ve kapanışta
  sessizce kayboluyordu. Artık istek benzeri her sekme "kaydedilmedi"
  olabiliyor; araç, Runner ve Mock Server sekmeleri hiçbir zaman olmuyor.
- **Klasörden Test Suite oluşturma:** eylem klasörün tüm alt ağacını seçim
  imkânı olmadan içeri alıyordu. Artık önce bir seçim adımı açılıyor; alt ağaç
  listeleniyor ve her istek için onay kutusu geliyor.

**Testler:** süit 297 dosyada 3674 teste ulaştı. Bu sürümdeki her düzeltme,
düzeltmeden önce başarısız olduğu kanıtlanmış bir regresyon testiyle geliyor.
Linux PAM kararları (hangi hesap yerel sayılır, her çıkış kodu ne demektir,
hangi kullanıcı adları kabuğa güvenle geçirilebilir) birim testli; PAM
çağrısının kendisi CI'da koşamadığı için uçtan uca doğrulama etki alanına
katılmış bir makinede yapılıyor.

## v1.5.2

**Parola sıfırlama artık Windows'ta etki alanı (Active Directory) hesaplarıyla çalışıyor.**

- **Parola sıfırlama / sistem parolası doğrulaması:** Windows'ta doğrulama
  yalnızca **yerel** hesapları kontrol ediyordu — etki alanı (Active
  Directory) hesabında doğru sistem parolası reddediliyor, kurumsal ağ/VPN
  dışındaki bir makinede ise doğrulama hiç yapılamıyordu. Doğrulama zinciri
  artık AD hesaplarını kapsıyor; etki alanı denetleyicisine erişilemediğinde
  Windows kilit ekranının kullandığı yerel kimlik önbelleğine karşı doğrulama
  da dahil. Doğrulama yine de başarısız olursa hata mesajı artık yalnızca
  "parola hatalı" demek yerine etki alanı denetleyicisine erişilemiyor
  olabileceğini söylüyor.

## v1.5.1

**Cookie'ler artık gerçek bir cookie jar gibi davranıyor — artı kenar çubuğu araması ve yerleşim düzeltmeleri.**

- **Cookie jar:** bir istekten dönen `Set-Cookie` artık aynı projedeki sonraki
  isteklerde — tutarlı biçimde — gönderiliyor. Send yolu HTTP motoruna hangi
  projeye ait olduğunu hiç söylemiyordu; elle gönderilen istekler paylaşılan
  varsayılan jar'ı kullanırken Runner proje-bazlı jar'ı kullanıyordu: Send ile
  yapılan bir login Run'a hiç ulaşmıyor, tüm projelerin Send cookie'leri tek
  jar'da birbirine karışıyordu. Send, Runner, test suite'leri, zamanlayıcı ve
  `pm.sendRequest` (script ile login) artık proje başına tek jar paylaşıyor;
  farklı projeler birbirinden yalıtılmış kalıyor.
- **Kenar çubuğu araması:** bir klasör adı arandığında eşleşen alt klasörler
  görünüyor ama klasörün kök seviyesindeki istekler gizleniyordu. Klasör adı
  eşleşmesi artık altındaki her şeyi koruyor — Postman / Insomnia / Bruno
  davranışıyla aynı.
- **Klasör ağacı:** klasöre sağ tık → **Tümünü Genişlet** / **Tümünü Daralt** —
  tüm alt ağacı özyinelemeli açar ya da kapatır; arama filtresi aktifken de
  çalışır.
- **Cookies sekmesi:** uzun cookie değerleri (JWT boyutunda token'lar) artık
  Domain / Path / Flags kolonlarının üzerine taşmak yerine kendi kolonunda
  satır atlıyor.

## v1.5.0

**Güvenlik sürümü.** Testnizer artık daha önce `keytool`, `openssl`, jwt.io ve
bir klasör dolusu betik gerektiren sertifika, anahtar, token ve imza işlerini
kendi içinde yapıyor — çevrimdışı, isteklerinizle aynı pencerede.

Yeni bir **Güvenlik** sayfası hepsini bir araya topluyor: **Keystore Studio**
(JKS / PKCS#12 keystore'ları ve X.509 sertifikalarını açma, oluşturma,
düzenleme, dönüştürme ve dışa aktarma), **JWK / JWKS** (PEM ⇄ JWK, RFC 7638
parmak izleri ve mock sunucudan JWKS yayınlama), **JWT / JOSE** (HS/RS/PS/ES
imzalama ve doğrulama, JWE, JWKS ile doğrulama), **SAML** (oluşturma, XML-DSig
ile imzalama ve doğrulama — doğrulayıcı *hangi* elemanın imzalandığını kanıtlar;
böylece sarmalama saldırıları, HMAC algoritma karışıklığı, SHA-1, XXE ve süresi
dolmuş bearer pencereleri gerekçesiyle birlikte reddedilir), **TLS Inspector**,
WS-Security, OTP ve parola üretici.

Sertifikalar ve özel anahtarlar artık ihtiyaç duyulan her yerde — mTLS,
WS-Security imzalama, JWT/JOSE, SAML — kayıtlı bir keystore'dan gelebiliyor ve
anahtarın kendisi baktığınız pencereye hiç ulaşmıyor. **Kullanmadığınız sürece
hiçbir şey değişmiyor:** PEM yapıştırmak ve CRT/KEY/PFX dosyası seçmek her
ekranda varsayılan olarak kalıyor.

Betikler de dahil: `pm.jose.sign / verify` (ve `require('jose')`) ile bir
ön-istek betiği token üretip sonraki isteğin göndermesini sağlayabiliyor — Send
ve Collection Runner'da birebir aynı.

**Runner: gerçekten çalışan Setup / Teardown.** İstekler *Setup*, *Flow* veya
*Teardown* olarak işaretlenebiliyor; koşu erken bitse bile (hata durdurması, ağ
hatası veya Stop) teardown yine çalışıyor ve ayrı sayılıyor — temizlik bir koşuyu
ne kurtarabiliyor ne de batırabiliyor.

⚠️ **Davranış değişikliği:** Collection Runner artık proje istemci
sertifikalarını tıpkı Send gibi ekliyor. Daha önce sertifikasız giden koşular
artık sertifika sunabilir — her *İstemci Sertifikası* kaydının `*` yerine belirli
bir host taşıdığını kontrol edin.

Ayrıca düzeltildi: Add Request → HTTP editörü açıyor; Add Folder isim soruyor;
arama açıkken klasör daraltma çalışıyor; context menüler pencere kenarında
kırpılmıyor; ikinci klasörde Run o klasörün koşusunu gösteriyor; dışa aktarma
dosya adları Türkçe karakterleri koruyor; yeni test suite'i input'un vaat ettiği
yerde oluşuyor; Test suite klasörleri elle yönetilebiliyor; AI Chat metni
seçilebiliyor ve akış sırasında ekran dibe zıplamıyor.

**Dört tur elle testin ardından.** Hata fırlatan bir ön-istek betiği artık
isteği yine de göndermek yerine durduruyor. Stop artık teardown'ın bir kısmını
atlamıyor; güvenli **Stop** ile anında duran **Stop now** iki ayrı buton ve
koşunun her aşamasında aynı şekilde okunuyor. Console çekmecesi workbench'in
altını kapatmıyor. Runner'a *iterasyonlar arası* gecikme eklendi, mevcut Delay
alanı da hangi boşluğu doldurduğunu söylüyor. Klasörler hem Run Sequence'te hem
test suite'lerinde yapısını koruyor ve kendi Setup / Flow / Teardown rolünü
alabiliyor. Bir suite'in runner sekmesi başka bir sekmeye gidip dönmeye
dayanıyor; Tests içinde açılan yeni sekme Tests'te kalıyor. "Create Test Suite
from this folder" sessizce başarısız olmak yerine ne olduğunu söylüyor. URL
düzeltmesinden önce oluşturulmuş test suite'leri açılışta kendini onarıyor.
About hangi build'i çalıştırdığınızı gösteriyor. Ve environment değişkenleri
tablosu bir arama kutusu kazandı — en baştan hak ettiği satır düzeniyle
birlikte.

## v1.4.37

**İstemci sertifikaları (mTLS) artık istekle birlikte gerçekten gönderiliyor.**

Bir projedeki İstemci Sertifikası sessizce eklenemeyebiliyordu; bu yüzden mTLS
sunucuları isteği reddediyordu (ör. Visa VDP *"Expected input credential was not
present"* dönüyordu). İki ayrı neden düzeltildi. Birincisi host eşleşmesi: istek,
sertifikaları URL'nin çıplak host adıyla (`sandbox.api.visa.com`) eşliyordu; ama
saklanan host senin yazdığın şeydi — çoğu zaman tam bir temel URL
(`https://sandbox.api.visa.com`) — ve katı birebir eşleşme sertifikayı düşürüyordu.
Eşleşme artık yapıştırılan şema, port, path ve büyük/küçük harf farkını tolere
ediyor ve `*` ile `*.domain` desenlerini destekliyor. İkincisi, sertifika bir dosya
*yolu* olarak saklanıp her göndermede yeniden okunuyordu; macOS uygulamaların
`~/Downloads`, `~/Desktop` ve `~/Documents`'i okumasını engellediği için bu okuma
başarısız oluyor ve istek sertifikasız gidiyordu. Testnizer artık dosyayı **sen
seçtiğin an** okuyup kendi deposunda bir kopya tutuyor (Postman'in yaptığı gibi) ve
yapılandırılmış bir sertifika yine de yüklenemezse, isteği sessizce sertifikasız
göndermek yerine net bir hatayla durduruyor. Güncelledikten sonra Project Settings
→ Certificates'ten CRT/KEY (veya PFX) dosyalarını bir kez yeniden seç.

## v1.4.36

**Apinizer test koleksiyonlarını tam-fidelity içe alın — ve onlara geri dışa aktarın.**

Import diyaloğunda (ve kenar çubuğu Import menüsünde) artık Postman'in yanında
first-party bir **Apinizer** seçeneği var. Apinizer test koleksiyonları,
`x-apinizer` uzantısı taşıyan Postman v2.1 koleksiyonlarıdır; bu yüzden ikisini de
aynı içe aktarıcı işler — ayrı kart, Apinizer'dan içe almayı adı konmuş, belirgin
bir yol yapar. Uzantı mevcutsa birincil doğruluk kaynağı olur: dört taşınabilir
türün tamamı için native assertion'lar (durum kodu, gövde, JSONPath, XPath), düz
bir Postman gövdesinin metne indirgeyeceği ham gövde alt-tipi (JSON / XML / HTML)
ve istek zaman aşımı gelir. Bir projeyi veya test suite'ini Postman'a dışa
aktarmak artık taşınabilir fidelity'si olan her isteğe `x-apinizer`'ı geri gömer;
böylece Apinizer assertion'larınızı kayıpsız okur. Testnizer'a özel assertion
türleri Testnizer'ın kendi kanalında kalır ve assertion'ı olmayan istekler temiz
düz Postman olarak dışa aktarılır. Dışa aktarılan `testType` / `apiType` istek
protokolünden türetilir (REST→RESOURCE, SOAP→WSDL, …), çünkü Testnizer'a içe
alınan bir test standalone'dur ve Apinizer proxy bağı yoktur. Özelliğin tamamı
eklemelidir — mevcut Postman / Insomnia / OpenAPI akışları değişmez.

## v1.4.35

**Collection Runner artık her isteğin kendi Authorization header'ını, miras
alınan bir yönetim token'ı yerine gönderiyor.**

Çok adımlı bir koşuda, erken bir kurulum adımı çoğu zaman bir yönetim erişim
token'ı (ör. `Bearer apnz_…`) alır ve bu, koleksiyon / klasör auth'u olarak miras
alınır. Kendi **Authorization header'ını** tanımlayan sonraki istekler — `Basic
client_id:secret` taşıyan bir gateway introspect ya da yeni üretilmiş bir `Bearer
eyJ…` JWT taşıyan bir regenerate — bu header'ın miras alınan token tarafından
sessizce ezilmesine maruz kalıyordu; sunucu yanlış kimlik bilgisini görüyor ve
*Missing Parameter: client_id* veya *Invalid JWT serialization* yanıtını
veriyordu. Artık isteğin kendi Authorization header'ı kazanıyor — Insomnia /
Postman ile aynı davranış. Bundan önce yalnızca Basic-auth yolu buna karşı
korumalıydı; koruma artık Bearer, OAuth 2.0, API-key ve Hawk auth'u da kapsıyor.
Bu, HTTP engine'de tek bir düzeltme olduğu için Send butonu ve Runner birebir aynı
davranıyor (issue #48).

## v1.4.34

**Sidebar sayfaları arasında geçiş artık açık sekmelerinizi bozmuyor, araç
girdileri yerinde kalıyor — ve Test Suite koşuları artık testlerinizin gerçekten
söylediğini raporluyor.**

Açık sekmeler ve aktif sekme artık her sidebar sayfasında ortak. **Tools**'a (ya
da Tests / Mocks / History) basmak artık request sekmelerinizi gizlemiyor, aktif
sekmeyi bırakmıyor veya kaydedilmemiş düzenlemeleri kaybetmiyor — sayfa yalnızca
sol paneli değiştiriyor ve tam bıraktığınız sekmeye dönüyorsunuz. Yerleşik
araçlar (JWT, Diff, Hash, …) bir request sekmesine geçip dönünce yazdığınızı artık
sıfırlamıyor, koruyor. Ayrıca Text Diff aracında sonuçtaki uzun satırlar komşu
metnin üstüne taşmak yerine kendi kolonu içinde sarılıyor.

Test Suite / koleksiyon koşuları için üç düzeltme geliyor. Testi bir 2xx-dışı
kodu açıkça kabul eden bir istek — örneğin durumun 200 / 204 / 404 / 400'den
biri olduğunu doğrulayan idempotent bir DELETE — artık koşu özetinde **geçti**
sayılıyor; bu, Tests sekmesinin ve Postman / Insomnia'nın gösterdiğiyle uyumlu.
Özet eskiden test geçse bile her 4xx/5xx'i başarısız işaretliyordu. İçe aktarılan
Insomnia after-response script'lerinde `insomnia.response.status` / `.body` /
`.json()` okuması bir koşu sırasında yeniden çalışıyor: içe aktarıcı eskiden
`insomnia.*`'ı `pm.*`'a çeviriyor, bu da sayısal durumu sessizce sebep-ifadesi
metnine dönüştürüp durum kontrolü geçerken gövde doğrulamalarını bozuyordu (issue
#47). Ve bir yola bağlı `form-data` dosya alanı — MMDB yüklemesi gibi — yeniden
dosya ve doğru sınır (boundary) ile gönderiliyor; okunamayan bir yol artık sessizce
düşürülüp kafa karıştırıcı bir 400 vermek yerine net bir hata gösteriyor (issue #46).

## v1.4.33

**Otomatik güncellemeler artık gerçekten çalışıyor.**

*Otomatik güncelleme kontrolü* ve *Güncellemeleri otomatik indir* ayarları
kaydediliyor ama hiçbir şey tarafından okunmuyordu — uygulama yalnızca Ayarlar'ı
açıp *Güncellemeleri denetle*'ye bastığınızda güncelleniyordu. Artık uçtan uca
çalışıyor: uygulama açılıştan kısa süre sonra ve birkaç saatte bir yeni sürüm
kontrol ediyor, o seçenek açıkken otomatik indiriyor ve bir güncelleme bulununca
güncelleme penceresini açıyor; tek tıkla kurabiliyorsunuz. Çevrimdışıyken veya
güncelleme zaten bulunmuşken kontrol atlanıyor. (macOS derlemeleri Developer ID
ile imzalı + notarized, Windows derlemeleri Certum imzalı — yani uygulama içi
indir-ve-kur yolu ikisinde de çalışıyor; eksik olan yalnızca düğmelerin
bağlanmasıydı.)

## v1.4.32

**İçe aktarılan test suite'leri artık uçtan uca çalışıyor, açık sekmeleriniz
uygulama yeniden başlatıldığında korunuyor ve REST tezgâhı bir cila turu
geçiriyor.** On beş bildirilen sorunu kapatır.

**Test Suite'leri.** Bir OpenAPI / Postman / Insomnia koleksiyonunu test suite
olarak içe aktarmak artık iç içe klasörleri ve auth + pre/post script cascade'ini
koruyor; böylece bir klasör bearer token'ı veya setup script'i miras alan bir
istek, kaynak araçtaki gibi çalışıyor — 401 ya da "proxy not found" ile başarısız
olmuyor — ve bir Setup adımında türetilen değişkenler sonraki isteklere akıyor.
Bir suite klasörünü ağaçtan doğrudan Quick Run ile çalıştırabilir, bir klasörün
auth ve cascade script'lerini ayarlar penceresinden düzenleyebilirsiniz; düzenlenip
kaydedilmemiş bir istek, runner çalıştırmadan önce kaydediliyor (hem yapılandırılmış
çalıştırma hem Quick Run yolunda). Suite'ler ayrıca native formatın yanı sıra
Postman v2.1 ve Insomnia v4 JSON olarak dışa aktarılıyor.

**İstek tezgâhı.** Açık olan sekmeleriniz — ve içlerindeki istek değerleri —
uygulamayı yeniden açtığınızda geri yükleniyor; ilk proje açılışında siliniyorlardı
çünkü proje-başına sekme önbelleği önyüklemede boş başlıyordu, artık başlatmalar
arasında kalıcı (#31). Yanıt sekme şeridi artık hayalet bir dikey scrollbar
göstermiyor (#34). İstek sekmesi, yanıt paneli gibi accent rengini ve alt çizgiyi
kullanıyor ve iki panelin seçili sekmeleri hizalanıyor (#32, #33), yanıt Headers
kolonları istek tablosuyla eşleşecek şekilde Key / Value okunuyor (#35), URL çubuğu
method seçici ve adresi font boyutuyla ölçekleniyor (#38), Query Params ve Headers
tablo kolonları yeniden boyutlandırılabilir (#36, #37), tek tıkla APIs ağacındaki
her klasör açılıp kapanıyor (#39), bir API'yi yeniden adlandırmak açık sekme
başlığını anında güncelliyor (#40), Ctrl+S açık bir endpoint sekmesini Save As
açmadan yerinde kaydediyor (#41) ve boş satır placeholder'ları artık kolon
başlıkları gibi vurgulanmıyor (#42).

**İstekler & runner.** Bir pre-request script'ten yazılan değer (ör. türetilmiş
bir `ApiProxyName`) sonraki istekler için korunuyor, böylece policy istekleri
"proxy not found" ile başarısız olmayı bırakıyor (#29). Geçen bir `pm.test` ile
2xx olmayan bir yanıt (ör. `oneOf([200, 400])` doğrulayan bir DELETE) Failed değil
Passed olarak raporlanıyor (#30). İçe aktarma penceresinde bir OpenAPI / Postman /
Insomnia spec'ini doğrudan panodan yapıştırabilirsiniz (#28).

**Araçlar.** Text Diff sonucu, sonuç-içi bir arama çubuğu (eşleşme vurgulamalı
Ctrl/Cmd+F) ve önceki / sonraki fark düğmeleri kazanıyor.

1.4.30 x64 yükleyicisinin kurulum sırasında çökmesi (#27) ayrı bir Windows
paketleme araştırmasıdır ve bu derlemede ele alınmamıştır.

## v1.4.31

**UX cilası ve güvenilirlik sürümü — kaydedilmemiş düzenlemeleriniz yerinde
kalıyor, sekme şeridi çift seçim yapmıyor, binary yanıtlar nihayet
görüntülenebiliyor ve istek/yanıt panelleri hizalanıyor.** On bir bildirilen
sorunu kapatır.

**İstek düzenleme & sekmeler.** Save'e basmadan girilen Query Params,
Authorization ve Body değerleri, başka bir API'ye tıklayıp geri dönünce artık
kaybolmuyor — her sekme kendi çalışma kopyasını koruyor (Postman / Insomnia gibi)
(#23). Sekme şeridi birkaç tıklamadan sonra iki sekmeyi aynı anda seçili
göstermiyor (#24).

**İstek & yanıt düzeni.** Params ve Headers tabloları yuvarlak "kart"
kenarlığını ve yan boşluğunu bıraktı; kenarlıksız yanıt Body / Headers ile
eşleşecek şekilde panele dayanıyor (#21). Bulk Edit düğmesi, boş bir ara satır
yerine tablonun Description başlığına taşındı (#22). Yanıt Headers sayısı, istek
rozetiyle eşleşen yeşil bir pill oldu (#19).

**Yanıt görüntüleyici.** Daha önce bozuk görünen görseller, PDF'ler, ses/video
ve diğer binary gövdeler artık satır içinde (veya bir çerçevede) Download
düğmesiyle önizleniyor (#25). Yanıt Headers KEY / VALUE kolonları sürüklenebilir
ve genişlik sekme değişiminde korunuyor (#20).

**Runner & içe aktarma (toplu dahil edildi).** Assertion'ları geçen bir istek,
yalnızca HTTP durumu ≥ 400 diye artık zorla başarısız sayılmıyor (#16). İçe
aktarmalar, hem URL'de hem Params tablosunda bulunan bir query parametresini
ikiye katlamayı bıraktı (`?type=snmp&type=snmp`; Insomnia'da yaygın) (#17). Sol
API ağacı ve sağ Variables paneli yeniden boyutlandırılabilir, genişlikler
korunuyor (#15). Run yolundaki after-response script'lerde `pm.response.json()` /
`.body` için bir regresyon koruması eklendi (#18).

**Doğrulama turundan gelen rötuşlar.** Yeni görsel / PDF önizlemesi artık günlük
kullanımda güvenilir — React StrictMode remount'u artık görüntüleyicinin
altından bellek içi object URL'ini geri çekmiyor (kırık görsel + boş Download),
**History**'den açılan binary yanıtlar doğru önizleniyor ve görüntüleyiciye
**Preview / Raw** geçişi eklendi (#25). History paneli artık yalnızca istekleri
listeliyor — mükerrer runner-run bölümü kaldırıldı (run geçmişi Tests sayfasında
duruyor) ve filtre gösterdiği her şeyi daraltıyor. Tool sekmeleri (JWT, Hash,
Diff, …) arasında geçiş yapmak girdiğiniz veriyi artık silmiyor. Windows'ta,
unutulan uygulama şifresini sıfırlamak için OS şifrenizi doğrularken doğru şifre
reddediliyor ve ham PowerShell CLIXML sızıyordu; artık Win32 `LogonUser` API'si
ile (domain / Azure-AD yedeğiyle) doğruluyor ve temiz bir mesaj gösteriyor.

## v1.4.30

**Windows ve macOS'ta imzalı kurulumlar — artık "bilinmeyen yayıncı" /
"kimliği doğrulanmamış geliştirici" uyarısı yok.** Bu sürüm ayrıca v1.4.19
açılış-çökmesi düzeltmesini de içerir; dolayısıyla herkes için önerilen
derlemedir.

- **Windows:** kurulumlar artık Certum Açık Kaynak kod imzalama sertifikasıyla
  Authenticode imzalı. SmartScreen "bilinmeyen yayıncı" göstermiyor ve uygulama
  içi otomatik güncelleme imzalı derlemeyi kabul ediyor.
- **macOS:** derlemeler Apple Developer ID ile imzalanıp Apple tarafından
  notarize ediliyor; böylece Gatekeeper "kimliği doğrulanmamış geliştirici"
  engeli olmadan açıyor. macOS otomatik güncelleme yeniden çalışıyor
  (`latest-mac.yml` manifesti derlemeyle birlikte yayınlanıyor).

**Devralınan açılış-çökmesi düzeltmesi (v1.4.20'ydi, hiç yayınlanmadı).**
v1.4.19'daki "tek paylaşılan script runtime" değişikliği, script
kütüphanelerini uygulamanın açılış yoluna soktu; bunlardan ikisi üretim
derlemesini bozdu — her ikisi de burada düzeltildi:

- **Uygulama açılmıyordu (tüm platformlar):** paketlenen `uuid` yalnızca ESM
  ve ana süreçte çalışma zamanı `require()` çağrısı olarak kalmıştı; Electron'un
  Node çalışma zamanı bunu yükleyemiyor (`ERR_REQUIRE_ESM`) — uygulama hiçbir
  pencere açılmadan çöküyordu. `uuid` artık ana sürece bundle ediliyor.
- **Boş pencere:** renderer, script kütüphanelerinin ihtiyaç duyduğu Node
  `Buffer` global'ine erişiyordu; bu global tarayıcı bağlamında yok. Uygulama
  yüklenmeden önce bir `Buffer` polyfill'i kuruluyor.

v1.4.19'daki tüm scripting çalışması (tam Chai assertion'ları, yerleşik
`require()` kütüphaneleri, eski Postman arayüzü, Insomnia/Bruno takma adları,
Send/Run paritesi) korunuyor ve artık gerçekten çalışıyor.

**CI sağlamlaştırma:** çökmeyi yakalayan açılış smoke testi artık Windows ve
Linux build job'larında da çalışıyor (önceden yalnızca macOS) — böylece bir
açılış çökmesi hiçbir platformda fark edilmeden yayınlanamaz.

## v1.4.19

**Eksiksiz Postman / Insomnia / Bruno script uyumluluğu. Tüm script API'si artık
tek paylaşılan bir runtime üzerinde çalışıyor; böylece içe aktarılan script'ler
değişiklik gerektirmeden çalışır — tam Chai onayları, yerleşik `require()`
kütüphaneleri, eski Postman arayüzü ve Insomnia/Bruno takma adları; Send ile
Collection Runner'da birebir aynı.**

- **Gerçek Chai onayları:** `pm.expect` artık gerçek Chai BDD kütüphanesi —
  her matcher ve flag çalışıyor: `.deep`, `.nested`, `.not`, `.members`,
  `.match`, `.closeTo`, `.property`, `.throw`, `.oneOf`, `.lengthOf` ve dahası,
  ayrıca `expect.fail`. Çıplak `expect(...)` globali de çalışır.
- **Tam `pm.response`:** `code` (sayı) vs `status` (sebep metni), `reason()`,
  `body`, `text()`, `json()` (geçersiz JSON'da Postman gibi hata fırlatır),
  `jsonp()`, `dataURI()`, `size()`, büyük/küçük harf duyarsız `headers`/`cookies`
  ve tam `pm.response.to.*` seti — `have.status / jsonBody / jsonSchema / header`,
  `be.success / ok / notFound / …`, hepsi `to.not.*` ile olumsuzlanabilir.
- **Yerleşik `require()` kütüphaneleri:** `lodash`, `moment`, `uuid`,
  `crypto-js`, `cheerio`, `ajv`, `tv4`, `xml2js`, `csv-parse`,
  `postman-collection`, `chai` — ayrıca `_`, `CryptoJS`, `atob`, `btoa`
  globalleri. `const _ = require('lodash')` artık çalışıyor.
- **Eski Postman arayüzü:** eski export'lar değişmeden çalışmaya devam eder —
  `responseBody`, `responseCode`, `tests['name'] = bool`,
  `postman.setEnvironmentVariable(...)`, `postman.setNextRequest(...)`,
  `xml2Json(...)`.
- **Insomnia & Bruno:** `insomnia.*` doğru semantikle çalışır
  (`insomnia.response.status` sayısal koddur; `baseEnvironment` /
  `collectionVariables` koleksiyon değişkenlerine eşlenir). Bruno'nun
  getter tabanlı `bru` / `req` / `res` API'si de eşlendi.
- **Eksiksiz pm kapsamları:** `environment` / `globals` / `collectionVariables` /
  `variables` artık `clear()` / `replaceIn()` / `toObject()` kazandı; ayrıca
  `pm.iterationData`, `pm.info`, `pm.cookies` ve `pm.execution`.
- **Tek paylaşılan runtime:** Send ve Collection Runner tek bir script motorunu
  paylaşır; böylece bir script ikisinde de birebir aynı davranır — script API'si
  için Send/Run parite bug sınıfı ortadan kalktı.

**Testler:** 133 senaryoluk paylaşılan-runtime test seti + gerçek
Postman / Insomnia / Bruno / legacy / kütüphane script'leri üzerinde Send≡Run
parite testleri. Birim test toplamı artık 1910. Scripts kılavuzu (EN + TR)
eksiksiz API'ye göre yeniden yazıldı.

## v1.4.18

**Scripting güçlendi: yerleşik OAuth 2.0 token (artık elle token isteği
yazmaya gerek yok), `pm.sendRequest`, script'te response cookie'leri ve Send ile
Run'da aynı script runtime'ı. Ayrıca yeniden yazılmış Scripts kılavuzu.**

- **Yerleşik OAuth 2.0 token grant:** OAuth 2.0 auth tipi artık gerçekten token
  alıyor. Client Credentials veya Password grant seç, token URL / client id /
  secret / scope gir; Testnizer her istekten önce token'ı otomatik alıp **cache**
  ediyor (süresi dolmaya yaklaşınca yeniliyor). Klasör/proje auth inheritance ile
  OAuth 2.0'ı klasöre bir kez ayarla, altındaki her istek taze token alsın —
  token-fetch isteği veya script'e gerek yok.
- **`pm.sendRequest`:** script içinden yardımcı HTTP isteği (`await` veya
  callback) — token alma, polling, setup. Send ve Run'da çalışıyor.
- **Script'te response cookie'leri:** `pm.response.cookies.get('session')`.
- **`pm.*.toObject()`** anlık görüntüleri (environment / globals /
  collectionVariables / variables).
- **Send / Run script paritesi:** Runner artık Send ile aynı global'leri sunuyor
  (`CryptoJS`, `t` alias) — Send'de geçen bir CryptoJS script'i Run'da artık
  patlamıyor.
- **Async script'ler:** pre-request ve test script'leri içinde `await`
  kullanabilirsin.
- **Dokümanlar:** [Scripts kılavuzu](/docs/scripts/) gerçek runtime'a göre
  yeniden yazıldı (desteklenmeyen `require()` yerine CryptoJS, tam `pm` API'si,
  proje → klasör → istek zinciri, auth inheritance ve OAuth 2.0).

## v1.4.17

**Paketleme düzeltmesi: macOS (ve Windows) otomatik güncellemesi yeniden
çalışıyor. Uygulamada değişiklik yok — bu sürüm yalnızca v1.4.16'da bozuk
güncelleme metadata'sı üreten release hattını onarır.**

- **macOS otomatik güncelleme düzeltildi (v1.4.16 regresyonu):** v1.4.16'da macOS
  güncellemesi `sha512 checksum mismatch` ile başarısız oluyordu. macOS ve
  Windows derlemeleri aynı isimde (`Testnizer-<sürüm>-<arch>.zip`) bir zip üretip
  aynı release'e yüklüyordu; Windows arm64 zip'i macOS arm64 zip'ini eziyordu.
  Kullanılmayan Windows `zip` target'ı kaldırıldı, çakışma giderildi.
- **Her iki mimari yeniden güncellenebiliyor (mac + Windows):** her platform artık
  iki mimariyi tek adımda derleyip tek ve eksiksiz `latest-mac.yml` / `latest.yml`
  üretiyor. Önceden her mimari job'u kendi manifest'ini yazıp diğerini eziyordu;
  bu yüzden yalnızca tek mimari listeleniyor, diğeri "güncelleme yok" alıyordu.
- **Runner script ile yazılan değişkenleri tazeliyor:** bir klasör/koleksiyon
  Run'ından sonra, post-response script'inin yakaladığı bir değişken (örn.
  Create-Token isteğinde `pm.environment.set("accessToken", …)`) artık environment
  editöründe anında görünüyor ve sonraki Send'de çözülüyor — önceden değer diske
  kaydediliyor ama uygulama içi environment eski kalıp boş görünüyordu, elle
  yeniden yazmak gerekiyordu.

**v1.4.16'dan macOS'ta yükseltme:** v1.4.16'nın güncelleme metadata'sı bozuk
olduğu için uygulama içi güncelleyici sizi kendiliğinden v1.4.17'ye taşıyamaz —
v1.4.17 `.dmg`'sini bir kez indirin; v1.4.17'den sonra otomatik güncelleme normal
çalışır.

## v1.4.16

**İstekler tarafından miras alınan klasör ve proje seviyesinde yetkilendirme +
script'ler; ayrıca iki Insomnia/Postman import düzeltmesi — böylece import edilen
koleksiyonlar doğru sırada ve ortak auth'u korunmuş hâlde çalışır.**

- **Klasör / projeden auth miras al:** isteğin Auth sekmesine **Üstten miras al**
  seçeneği eklendi (yeni isteklerde varsayılan). Etkin auth en yakın kazanır
  mantığıyla çözülür — istek → en yakın klasör → proje — böylece bir kez klasöre
  (veya Proje Ayarları → Yetkilendirme'ye) `Bearer {{accessToken}}` koyman
  altındaki tüm isteklerce kullanılır. Açık **No Auth** mirası durdurur.
- **Klasör Ayarları (auth + script):** herhangi bir klasöre **sağ-tık →
  Ayarlar** ile yetkilendirmesini ve pre-request / test script'lerini ayarla.
- **Zincirleme (cascade) script'ler:** proje ve klasör pre-request / test
  script'leri artık her istek etrafında **proje → klasör → istek** sırasıyla,
  hem **Gönder** hem **Çalıştır** yolunda çalışır. (Proje seviyesi auth +
  script'ler önceden ayarlanabiliyordu ama çalışma anında uygulanmıyordu — artık
  uygulanıyor.)
- **Insomnia import sırası düzeltildi:** v5 koleksiyonları artık dosya sırasıyla
  değil `meta.sortKey` sırasıyla (Insomnia'nın çalıştırdığı sıra) import edilir —
  böylece Run istekleri amaçlanan sırada gönderir.
- **Import'ta Insomnia/Postman auth mirası:** koleksiyon kökünün (ve klasörlerin)
  `authentication` bloğu, kendi auth'unu taşımayan alt isteklere uygulanır.
  Önceden kökte bir kez `Bearer {{accessToken}}` tanımlanan koleksiyon, alt
  isteklerde hiç Authorization göndermez ve 401 alırdı.

## v1.4.15

**macOS'ta uygulama içi otomatik güncelleme artık gerçekten çalışıyor, güncelleme
paneli kontrol etmeden "güncelsiniz" demeyi bıraktı ve karşılama ekranına sürüm
numarası ile çalışan bir About menüsü eklendi.**

- **macOS otomatik güncelleme (gerçekten):** derlemeler artık imzalı ve notarize
  (v1.4.13+) olduğundan, uygulama içi İndir & Kur akışı macOS'ta da çalışıyor —
  macOS kullanıcılarını manuel indirmeye zorlayan eski engel kaldırıldı (manuel
  indirme bağlantısı yedek olarak duruyor).
- **Dürüst güncelleme durumu:** güncelleme paneli artık hiç kontrol yapmadan
  yeşil "güncelsiniz" göstermiyor. Panel açılınca otomatik kontrol yapılıyor ve
  yalnızca kontrol daha yeni sürüm olmadığını doğruladığında "güncelsiniz"
  deniyor.
- **About karşılama ekranında çalışıyor:** Testnizer → About Testnizer artık
  oturum açmadan önce de About penceresini açıyor (önceden ilk ekranda hiçbir şey
  olmuyordu).
- **Karşılama ekranında sürüm:** ilk açılış ekranı artık derleme sürümünü
  gösteriyor.
- **Türkçe iyileştirme:** güncelleme panelindeki Türkçe metinler artık doğru
  diakritikleri kullanıyor (örn. "Guncelsiniz" yerine "Güncelsiniz").

**Testler:** updater olay→durum eşlemesi, macOS uygulama içi İndir yolu ve
karşılama ekranı sürüm rozeti — birim test takımı 1715'e ulaştı.

## v1.4.14

**Scriptler artık bir kez token alıp tüm suite boyunca yeniden kullanabilir —
`insomnia.*` / `bru.*` script API'leri destekleniyor ve Collection Runner,
scriptlerinizin yazdığı değişkenleri kalıcı tutuyor (Postman "Keep variable
values").**

- **Insomnia / Bruno scriptleri:** ön-istek ve test scriptleri artık `insomnia.*`
  ve `bru.*` nesnelerini (`pm.*` takma adları) kullanabiliyor; böylece Insomnia
  v5 ve Bruno'dan içe aktarılan koleksiyonlar değişmeden çalışıyor. Önceden
  `insomnia.environment.set(...)` "insomnia is not defined" hatası fırlatıyor, bu
  hata yutuluyor ve değişken sessizce hiç set edilmiyordu — setup isteğinde
  oluşturulan token sonraki isteklere ulaşmıyor ve folder Run'lar
  401 Empty Key! ile başarısız oluyordu (issue #12).
- **Runner — kalıcı değişkenler:** Collection Runner artık "Keep variable values"
  ayarına uyuyor. Bir çalıştırma sırasında scriptlerin yazdığı environment /
  global değişkenler (`pm.environment.set`, `insomnia.environment.set`,
  `pm.globals.set`) çalıştırma bitince aktif environment'a / proje globals'ına
  geri yazılıyor; böylece bir kez alınan token sonraki tüm isteklerde ve sonraki
  çalıştırmalarda yeniden kullanılıyor — ve tek yerde yenileniyor. İstek-yerel
  `pm.variables.*` değişkenleri Postman'deki gibi geçici kalıyor.

**Testler:** token yeniden kullanımı, Insomnia/Bruno script takma adları ve
değişken kalıcılığını kapsayan 10 yeni regresyon testi (düzeltmeden önce
başarısız / sonra başarılı) — birim test takımı 1706'ya ulaştı.

## v1.4.13

**macOS derlemeleri artık Apple Developer ID ile imzalanıyor ve Apple
tarafından notarize ediliyor — "bilinmeyen geliştirici" / "uygulama
zarar görmüş" Gatekeeper engeli kalktı, uygulama içi otomatik güncelleme
artık macOS'ta da çalışıyor.**

- **macOS — imzalı & notarize:** her macOS derlemesi artık Developer ID
  Application sertifikasıyla kod imzalanıyor ve Apple notary servisinden
  geçiriliyor; hardened runtime etkin. Gatekeeper uygulamayı doğrudan açar —
  sağ tık → Aç geçici çözümüne gerek yok, Apple Silicon'da "uygulama zarar
  görmüş ve açılamıyor" hatası yok.
- **macOS — otomatik güncelleme:** derlemeler artık notarize edildiği için
  uygulama içi otomatik güncellemeler macOS'ta da çalışıyor (önceden macOS
  kullanıcıları manuel indirmeye yönlendiriliyordu, issue #34).
- **Kalite:** otomatik test katmanı manuel checklist kapsama taramasının
  ardından 679 UI E2E testine ve 1696 birim testine ulaştı — yeni senaryolar
  header otomatik tamamlama, çözümlenmiş gerçek-istek görünümü, auth tipi
  seçimi, mock CORS ve proxy kaydı, Insomnia dışa aktarma, PFX/PKCS12
  sertifikaları ve suite öğesi yeniden adlandırmayı kapsıyor.

İstekler, protokoller veya veride işlevsel değişiklik yok — bu sürüm güven
(imzalama) ve doğrulama (testler) ile ilgili. Windows imzalama hâlâ sürüyor.

## v1.4.12

**İstek yaşam döngüsü iyileştirmeleri (oluşturunca açılma, kaydedilmemiş
değişiklik diyaloğu, tüm protokollerde değişiklik noktası), gerçek Digest/NTLM
kimlik doğrulaması, Runner'ın tüm body tiplerinde değişken çözmesi ve bozuk
veritabanından açılış kurtarmasından kaybolan Socket.IO event'lerine dört
güvenilirlik düzeltmesi.**

- **İstekler:** ağaçta sağ tık **Add Request** ile oluşturulan istek artık
  hemen açılıp odaklanıyor — global "+ New" menüsüyle aynı davranış (issue #6).
- **İstekler:** kaydedilmemiş değişiklik (mavi nokta) göstergesi artık **tüm**
  protokollerde görünüyor — SOAP, WebSocket, SSE, Socket.IO, gRPC ve GraphQL;
  yalnızca HTTP değil (issue #8).
- **İstekler:** değiştirilmiş bir sekmeyi kapatmak artık düzenlemelerinizi
  sessizce atmıyor. Üç seçenekli **Save / Discard / Cancel** diyaloğu × düğmesini
  ve bağlam menüsündeki Close'u her protokolde koruyor (issue #9).
- **Auth:** **Digest** ve **NTLM** kimlik doğrulaması artık gerçekten
  uygulanıyor. Daha önce ikisi de sessizce Basic'e düşüyordu; challenge-response
  isteyen sunucular her zaman 401 dönüyordu.
- **Runner:** **form-data**, **x-www-form-urlencoded** ve **binary dosya yolu**
  body'lerindeki `{{değişkenler}}` artık Run sırasında çözülüyor — Send ile
  birebir. Daha önce yalnızca ham body içeriği yerine konuyordu; form alanları
  tele düz `{{...}}` olarak gidiyordu (issue #10).
- **İçe aktarma:** bir **Insomnia v5 koleksiyonu** içe aktarıldığında artık
  paketli ortamları da değişkenleriyle birlikte gerçek ortam kayıtları olarak
  geliyor — içe aktarmadan sonra her değişkeni elle eklemek yok (issue #11).
- **Dışa aktarma:** ortam dışa aktarma diyaloğu artık Postman markalı bir ad
  yerine `*.testnizer_environment.json` dosya adı öneriyor. Dosya içeriği
  Postman şemasıyla uyumlu kalıyor (issue #7).
- **SSE:** bağlanmadan önce **Last-Event-ID** girmek artık bağlantıyı
  DOMException ile kırmıyor — özel header'lar SSE istemcisinin yeniden bağlanma
  defteriyle artık doğru birleştiriliyor.
- **Socket.IO:** sunucunun **bağlantı anında** push'ladığı event'ler (örn.
  `welcome`) artık kaybolmuyor. Motor, arayüzün event dinleyicisi bağlanana dek
  erken event'leri tamponluyor ve sırayla aktarıyor.
- **WebSocket:** kayıtlı bir WebSocket isteği, sekmesi yeniden açıldığında artık
  URL'ini ve ayarlarını geri yüklüyor. Daha önce istek doğru kaydedildiği halde
  editör varsayılan `wss://echo.websocket.org` adresine dönüyordu.
- **Güvenilirlik:** yerel veritabanı dosyası bozulursa uygulama artık penceresiz
  ve mesajsız şekilde açılmamazlık etmiyor. Bozuk dosya yanına yedekleniyor,
  taze bir veritabanı oluşturuluyor ve ne olduğunu ve yedeğin nerede olduğunu
  açıklayan bir diyalog gösteriliyor.

## v1.4.11

**Collection Runner artık ortam değişkenlerini tam olarak Send gibi çözüyor —
Send ile 200 OK dönen bir istek, Run'da artık "Invalid URL" ile başarısız
olmuyor.**

- **Runner / Mock:** değeri yalnızca **Initial Value** (ilk değer) sütununda
  bulunan ortam ve global değişkenler artık Run sırasında çözülüyor. Bu, bir
  Postman / Insomnia koleksiyonu içe aktarıldıktan hemen sonra ya da ortam
  editöründe yalnızca en soldaki sütun doldurulduğunda sık karşılaşılan durum.
  Daha önce runner yalnızca **Current Value** (geçerli değer) sütununu okuyordu;
  bu yüzden `{{AccessURL}}` gibi bir URL yerine konmadan kalıyor ve istek
  **Invalid URL** ile başarısız oluyordu — aynı istek **Send** ile 200 OK
  dönmesine rağmen. Runner ve mock sunucusu artık Send'in çift-değer modelini
  birebir uyguluyor: önce Current Value, boşsa Initial Value. Projenin aktif
  ortamını otomatik çözen klasör ve koleksiyon çalıştırmaları da aynı
  düzeltmeden yararlanıyor.

## v1.4.10

**v1.4.9 üzerine iki takip düzeltmesi — Home sayfası içe aktarmadan sonra
yenileniyor ve klasör Run aksiyonu Tests genel görünümü yerine doğrudan
çalıştırmayı açıyor.**

- **İçe aktarma:** bir projeyi içe aktarmak artık görünmesi için uygulama
  yeniden başlatma gerektirmiyor — Home sayfasındaki proje listesi içe
  aktarma biter bitmez yenileniyor.
- **Runner:** bir klasöre sağ tık **Run** artık o klasörün endpoint'lerine
  scope'lu çalıştırmayı (çalışmaya hazır run config) açıyor; genel Tests
  görünümüne düşmüyor.

## v1.4.9

**v1.4.8'de yeniden raporlanan dört sorun için takip düzeltmeleri —
klasör dışa/içe aktarma, klasör Run aksiyonu, Windows yükleyici kısayolu
ve macOS güncelleme yolu.**

- **İçe/dışa aktarma:** kaydedilmiş isteklerden oluşan bir koleksiyonu dışa
  aktarıp **Testnizer Native** ile geri içe aktarmak artık kayıpsız. Klasör
  dışa aktarımı yalnızca yapısal endpoint'leri topluyor, ad-hoc kaydedilmiş
  istekleri sessizce düşürüyordu, bu yüzden koleksiyon boş geliyordu.
- **Runner:** APIs ağacında bir klasöre sağ tık **Run** artık runner'ı açıp
  yaşadığı Tests sayfasına geçiyor; eskiden APIs görünümünün arkasında
  görünmez açılıyordu — hiçbir şey olmamış gibi görünüyordu.
- **Windows:** yükleyici artık Başlat Menüsü ve Masaüstü kısayollarını
  açıkça oluşturuyor; kurulum sonrası her zaman bir başlatma noktası var,
  yükleyici `.exe`'yi tekrar çalıştırmaya gerek kalmıyor.
- **macOS güncellemeleri:** macOS derlemesi imzasız olduğundan
  electron-updater kendini kuramıyor; güncelleme penceresi artık macOS
  kullanıcılarını her zaman başarısız olan Download & Install düğmesi yerine
  doğrudan manuel indirmeye yönlendiriyor (açıklamasıyla). Gerçek
  uygulama-içi otomatik güncelleme Apple imzalama + notarization gerektirir.

## v1.4.8

**v1.4.7 kullanıcı raporlarının geniş bir taraması — istek ayarları,
SOAP taşıması, mock şablonlama, içe/dışa aktarma, branch izolasyonu ve
çoklu proje sekmeleri — tüm açık raporları kapatır.**

- **İstek ayarları:** istek bazlı **Settings** sekmesi artık gerçekten
  motora ulaşıyor — timeout (0 = sınırsız), max redirects, follow
  redirects ve SSL doğrulaması proje varsayılanlarına düşmek yerine
  istek başına uygulanıyor. URL çubuğu ile **Params** sekmesi çift yönlü
  senkron (param eklenince URL güncellenir; URL'e query yazılınca Params
  dolar). `Shift+F` body'yi formatlıyor ve `{{değişken}}` vurgusu artık
  caret'i kaydırmıyor.
- **Protokoller:** WSDL'den üretilen istek gövdeleri `http://tempuri.org/`
  yerine servisin gerçek target namespace'ini kullanıyor; manuel SOAP
  isteği SOAP Action'ı sürüme uygun yerde gönderiyor (1.1 için tırnaklı
  `SOAPAction`, 1.2 için Content-Type içinde `action="…"`). Kaydedilen
  SOAP / WebSocket / Socket.IO / GraphQL / gRPC istekleri yeniden
  açılınca tüm durumlarını geri yüklüyor; Socket.IO disconnect'te emit +
  subscription'ları koruyor; WS-Security aracı sekme değişiminde durumunu
  koruyor.
- **Mock sunucular:** yanıt şablonlama istek header'larını
  büyük/küçük harf duyarsız çözüyor, body ipucu query paramları için
  `{{request.query.x}}` belgeliyor ve silme onayı uygulamanın stilli
  diyaloğunu kullanıyor.
- **İçe / dışa aktarma:** HAR import menüde; Insomnia query paramları
  artık Postman gibi URL'de görünüyor; Testnizer-native import içeriği
  doğru yere yerleştiriyor (proje export → yeni proje, folder export →
  mevcut projeye); ve environment Postman uyumlu olarak dışa
  aktarılabiliyor.
- **Branch & projeler:** API ağacı içeriği branch başına izole (bir
  branch'te oluşturulan içerik diğerine sızmıyor), branch silme gerçekten
  siliyor ve **birden çok proje sekmesi açık kalıyor** — projeler arası
  geçiş öncekini kapatmıyor.
- **Navigasyon & ayarlar:** APIs arama kutusu ağacı filtreliyor; sağ tık
  **Run** / **Export** ve **Add Request** çalışıyor; New (+) menüsüne
  Quick Request / Import eklendi; header'a oturum menüsü (kilitle / şifre
  belirle / hakkında) eklendi; Environment yöneticisi istek açık
  olmadan erişilebilir; secret environment değişkenleri maskeli kalıyor;
  Themes accent rengi yeniden başlatmada korunuyor; ve Export project /
  Clear history başarı bildirimi gösteriyor.
- **Güncelleme & paketleme:** güncelleme kendiliğinden uygulanamadığında
  (örn. imzasız macOS build) diyalog daha net bir mesajla manuel-indirme
  bağlantısı sunuyor; Clone-from-Git depoyu diske yazıyor; ve Windows
  installer kısayol yapılandırması sağlamlaştırıldı.

## v1.4.7

**v1.4.4 kullanıcı bug listesinin kapsamlı taranması — Auto Update,
save akışı, Test Suite runner, importer'lar, her protokol editörü ve
credential persistence güvenlik sıkılaştırması.**

- **Auto Update:** Settings → Update'teki sürüm notları artık ham
  `<h2>…</h2>` kaynak metni yerine biçimlendirilmiş HTML (başlık,
  liste, kod) olarak render ediliyor — modal içinde changelog'u
  gizleyen bir DOMPurify interop regression'ı düzeltildi. Windows
  yükleyici akışı, `quitAndInstall` aslında istisna fırlattığında
  artık başarı bildirmiyor; IPC yanıtı hatayı modal'a geri taşıyor,
  böylece kullanıcı asılı kalmış "yeniden başlatılıyor…" yerine
  gerçek bir hata mesajı görüyor. `update-downloaded` olayı ayrıca
  disk üzerindeki yükleyici yolunu post-mortem destek için
  loglıyor.
- **File menüsü ve klavye:** File → New Tab / Close Tab / Save /
  Import… / Export… öğelerinin her biri artık gerçek aksiyonu
  tetikliyor — önceden bunların üçü hiçbir dinleyicisi olmayan ölü
  bir custom-event'e ateşleyip hiçbir şey yapmıyordu. `Ctrl+T` ve
  `Ctrl+W` artık çift fire etmiyor: menü accelerator'u ve pencere
  keydown dinleyicisi aynı kombinasyona bağlıydı, bu yüzden bir tab
  açmak gerçekten iki tab açıyordu. Menü etiketleri platforma uygun
  modifier'ı gösteriyor (`Cmd+T` macOS'ta, `Ctrl+T` Windows/Linux'ta).
  Menüden Close Tab artık kaydedilmemiş değişiklikler için uyarıyor
  ve tab'a özel protokol state'ini temizliyor — Workbench içindeki
  `Ctrl+W` yolu ile eşleşiyor.
- **Save akışı:** Önceden kalıcı hale gelmiş bir istek üzerinde
  `Ctrl+S` artık satırı yerinde günceller; aktif tab bir Test Suite
  item ise APIs'e duplicate request oluşturan folder-picker modal'ı
  açılmıyor. SOAP, Socket.IO, gRPC, WebSocket ve SSE istekleri tüm
  editör state'lerini (WSDL URL / namespace / proto path / custom
  header / composer şablonu / event-type filter / metadata) DB'ye
  yazıyor ve yeniden açıldığında geri yüklüyor — tab kapatmak
  artık sizi bir sonraki açılışta boş editör'e bırakmıyor.
- **Test Suite ve Runner:** "Create Test Suite from this folder"
  kaynak endpoint'in varsayılan case'inin params, headers, body ve
  auth alanlarını her yeni suite item'a taşıyor; böylece istekler
  açıldığında boş gelmiyor. NULL olan varsayılan-case sütunları
  endpoint'in template değerlerini boş fallback ile ezmek yerine
  olduğu gibi bırakıyor. Basic auth credentials artık runner
  geçişinde gösterilen URL'e sızmıyor — Authorization header
  üzerinden taşınıyor (RFC 7617) ve Run Results Request tab'ı
  gönderilen header'ı gerçekten gösteriyor. Header assertion'ları
  (`Header exists` / `equals` / `contains`) büyük/küçük harf
  duyarsız arama, boşluk trim ve `[k, v]` çiftleri vs.
  `Record<string, string>` farkını simetrik şekilde normalize
  ediyor. Tests sidebar'ındaki Import butonu artık Test Suite
  import sihirbazını açıyor — önceden APIs sihirbazını açıyor,
  type-mismatch banner'ı ile suite export'larını reddediyordu.
  Code → cURL / JS / Python snippet üreticileri URL, header, body
  ve binary path'teki `{{var}}` placeholder'larını çözüyor; snippet
  yapıştırmaya hazır geliyor. All Runs → run detayı bir sekme
  değişiminden sağ çıkıyor — sonuç paneli geri dönüldüğünde
  boşalıyordu çünkü snapshot persist edilmiyordu.
- **Importer'lar:** RAML dosyaları (`.raml`) native file picker'da
  seçilebilir ve `!include` direktifleri artık YAML parser'ı
  çökertmiyor — direktif string placeholder olarak korunuyor, tam
  include resolution sonraki iş olarak duruyor. Testnizer-native
  export'ları doğru `kind: "project" | "folder" | "testSuite"`
  şekli altında tespit ediliyor ve "JSON, native değil"
  reddedilmek yerine native importer'a yönlendiriliyor.
- **Protokoller:** Bir folder'a sağ tıklayıp Add Request →
  protokol seçici artık isteği gerçekten oluşturuyor, başarısızlık
  durumları sessizce yutulmak yerine toast ile yüzeye çıkıyor. SOAP
  → WS-Security Tool → "Send to active SOAP" imzalı zarfı doğru
  tab'a enjekte edip isteği gönderiyor (tab-state race'i eski bir
  SOAP tab'ını hedef olarak bırakıyordu). GraphQL Introspect
  şemasız URL'leri (`localhost:4000/graphql`) handle ediyor,
  varsayılan `Content-Type: application/json` ekliyor, boş URL'e
  karşı koruma sağlıyor ve URL hâlâ çözülmemiş `{{var}}`
  placeholder içeriyorsa `http://` eklemiyor — kullanıcı yanıltıcı
  bir DNS hatası yerine "değişken tanımsız" görüyor.
- **History ve credential hijyeni:** Test sonuçları, console
  log'ları ve yakalanan `actualRequest` snapshot'ı geçmiş bir satır
  yeniden açıldığında geri yükleniyor; böylece `pm.test()`
  verdict'leri Tests pane'ine geri geliyor. `user:pass@host`
  userinfo'su her persist edilen URL'den temizleniyor — history
  tablosu, request snapshot ve Run Results gösterimi — v1.4.6'da
  URL bar'daki credentials'ı sonsuza dek SQLite'ta bırakan sızıntı
  kapatıldı. Zaten userinfo taşıyan eski satırlar restore anında
  sanitize ediliyor.
- **Internals:** `cleanupTabState` ve `stripUrlCredentials` paylaşılan
  helper'lara taşındı; böylece menü / klavye / runner / engine
  yolları aynı teardown ve aynı credential-strip mantığını
  kullanıyor. Yeni bir `save-active-request` helper'ı her protokol
  store'unun snapshot'ını tek bir yerde topluyor, böylece Save As
  modalı ile yerinde Ctrl+S yolu yeni protokol eklendiğinde
  birlikte hareket ediyor. `header_contains`, `header_equals`'ın
  trim semantiğine uyduruldu. RunnerTab run-snapshot restore'u
  `useState` lazy initializer'lara taşındı; böylece MB ölçeğinde
  bir `JSON.parse` artık her render'da çalışmıyor.

## v1.4.6

**Tüm APIs Import formatları yanlış-dosya-tipi girdisini artık sessizce
boş klasör oluşturmak veya kafa karıştıran "şu alan eksik" mesajları
vermek yerine tek tutarlı hatayla reddediyor.**

- **Postman, Insomnia, SoapUI, cURL, Testnizer-native:** her
  importer önce girdinin kendisinden istenen formatla eşleştiğini
  doğruluyor. Eşleşmeyen her şey aynı tek satırı alıyor: *"Bu dosya
  bir {format} değil. Bu dosya tipini buradan yükleyemezsiniz."*
  Hayalet klasör yok, çapraz bulaşma yok, "aynı yanlış dosya için
  altı farklı validasyon ipucu" tahmin oyunu yok.
- **Postman:** standalone environment export'larını
  (`_postman_variable_scope: environment`) ve v2.x collection
  olmayan rastgele JSON dosyalarını reddediyor. Postman v1 yine
  kendi "v2.1 olarak yeniden export edin" ipucunu alıyor.
- **Insomnia:** v5 environment YAML dosyalarını reddediyor.
  Endpoint'lerle birlikte environment de içeren Insomnia v4
  collection'ları çalışmaya devam ediyor — v4 request-şeklinde,
  environment'lar yan yolculuk.
- **SoapUI:** ilk 4 KB'sinde `<con:soapui-project ...>` kök
  elementi olmayan her şey reddediliyor. Diğer XML / JSON / YAML
  dosyaları artık project parser'a kadar ulaşamıyor.
- **cURL:** `curl ` ile başlamayan girdi reddediliyor (önündeki
  shell prompt `$ ` tolere ediliyor). Bir JSON dosyası bırakmak
  eskiden parser'ın muğlak "no URL found" mesajına çarpıyordu;
  artık tutarlı yanlış-dosya-tipi hatasını alıyor.
- **Testnizer-native project:** "şu alan eksik" altı farklı dalı
  tek bir generic hataya indirgendi ve artık `kind: "project"`
  zorunlu — bir Postman / Insomnia / SoapUI / vs. dosyası native
  importer'a bırakıldığında tutarlı şekilde fail ediyor. Şekli
  doğru ama gerçekten boş olan export'lar yine kendi "kaynak
  projeyi yeniden export edin" ipucunu alıyor — dosya şeklinin
  doğru ama bayat olduğunu kullanıcı görüyor.
- **Environment-only import'lar** çalışmaya devam ediyor — sadece
  doğru giriş noktasına yönlendirildi. Environments modalindeki
  Import aksiyonu artık yeni `import:postmanEnvironment` /
  `import:insomniaEnvironment` IPC handler'larını çağırıyor;
  bunlar yalnızca env dosyalarını kabul ediyor ve sadece
  environments tablosuna dokunuyor.

## v1.4.5

**Hotfix: Windows update akışı artık uygulamayı sessizce kaldırmıyor.**

- **Updater quitAndInstall:** Windows installer artık `isSilent: false`
  ile çalıştırılıyor — NSIS wizard'ı görünür durumda ilerliyor,
  başarısızlık varsa hata dialogu açık çıkıyor. v1.4.4'te sessiz
  install, eski sürümün uninstall adımı tamamlandıktan sonra
  başarısız olabiliyordu; sonuç olarak kullanıcı tamamen kaldırılmış
  bir uygulama, hiçbir UI ve hiçbir teşhis ipucu bulmadan kalıyordu —
  tek belirti Start Menu / Desktop kısayolunun kaybolmasıydı. Wizard
  artık tamamlanana kadar açık kalıyor; kullanıcı gerçekte ne
  olduğunu görüyor ve gerektiğinde raporlayabiliyor.
- **Custom NSIS hook kaldırıldı:** v1.4.3'te "Missing Shortcut"
  dialogu için eklenen `build/installer.nsh` cleanup macro'ları
  build'e dahil edilmiyor artık. Sessiz install başarısızlığının
  şüpheli katkıcılarından biriydi. NSIS artık electron-builder'ın
  varsayılan install/uninstall akışını yerel eklenti olmadan
  kullanıyor.
- **NSIS `oneClick: false`:** Tek tıklamalı sessiz install yerine
  standart çok adımlı wizard'a geçildi. Kullanıcılar update sırasında
  install ilerlemesi + tamamlama ekranını görüyor; bu hem hataları
  yüzeye çıkarıyor hem de upgrade sürecine tanıdık bir şekil veriyor.

## v1.4.4

**Hotfix: OpenAPI 3 import beyaz ekranı + updater hata mesajı
görünürlüğü + top-level error boundary.**

- **OpenAPI import (beyaz ekran düzeltmesi):** Query/header
  parametrelerinde sayısal default'u olan (örn.
  `page: { schema: { type: integer, default: 1 } }`) bir OpenAPI 3
  dosyası import edildiğinde, kullanıcı listelenen ilk request'e
  tıkladığı an renderer bembeyaz kalıyordu. Sayı doğrudan
  `saved_requests.params[].value` alanına yazılıyordu; tab
  açıldığında KeyValueTable bu değere yalnızca string olarak
  çağrılabilecek API'leri (`isInsideVariableExpression`, suggestion
  filter) uyguluyor, `TypeError` fırlatıyor ve tüm React ağacını
  unmount ediyordu. Bozuk state localStorage'da kaldığı için
  uygulama her açılışta aynı crash'i tekrarlıyordu. Import artık
  default'u string'e dönüştürüyor: string ise olduğu gibi,
  null/undefined ise boş string, object ise JSON-stringified,
  diğerleri `String()` ile.
- **Top-level ErrorBoundary:** Yakalanmayan herhangi bir render
  crash'i artık boş pencere yerine bir recovery panelinde
  sonuçlanıyor. Panel üç seçenek sunuyor: Reload, "UI state'i
  sıfırla ve reload et" (localStorage + sessionStorage temizleniyor
  ama SQLite veritabanı — projeler, request'ler, environment'lar,
  sertifikalar, history kayıtları — olduğu gibi kalıyor) ve hatayı
  panoya kopyala. Bu sayede önceki sürümlerde crash yaşamış
  kullanıcılar kendi kendine kurtulabiliyor.
- **Updater hata görünürlüğü:** "Update check failed" artık tek
  başına detaysız çıkmıyor. Renderer'ın updater store'u yalnızca
  Promise-reject hatalarını yakalıyordu; IPC handler ise hata
  durumunda `{success:false, error:'...'}` ile resolve ediyor —
  böylece gerçek sebep (network, feed yapılandırılmamış, GitHub
  rate-limit) atılıyordu. Store artık sonucu inceleyip gerçek
  mesajı `errorMessage`'a basıyor; modal bunu kullanıcıya gösteriyor.

## v1.4.3

**İkinci test turu bug temizliği — updater, import, tests workbench,
script motoru, WSSE, GraphQL, history ve Windows installer'da 23
iyileştirme.**

- **Updater modali:** Release notları artık ham `<h2>` / `<p>` / `<ul>`
  metni yerine düzgün HTML olarak render ediliyor (DOMPurify ile
  temizleniyor). GitHub Releases'tan electron-updater'ın getirdiği
  içerik aslında Markdown değil HTML; eskiden modal bunu JSX text
  node olarak basıyordu. Birden fazla sürüm atlayan kullanıcılar
  (örn. v1.4.1 → v1.4.3) için `ReleaseNoteInfo[]` payload'ı
  birleştiriliyor; sadece en son sürüm değil, aradaki tüm bloklar
  görünüyor.
- **Windows updater:** "Missing Shortcut: Testnizer.exe değiştirilmiş
  veya taşınmış" hatası giderildi. Özel bir `installer.nsh` betiği
  electron-builder yeni kısayolları oluşturmadan önce eski Desktop /
  Start Menu / Quick Launch kısayollarını proaktif olarak siliyor.
  NSIS `differentialPackage` bayrağı kapatıldı; in-place patch yerine
  her seferinde tam uninstall + install yapılıyor.
- **Script motoru:** `pm.execution.skipRequest()` çağrısı artık pre-
  request script'i gerçekten durduruyor — sonraki kodlar çalışmıyor.
  Eskiden sadece bayrak set ediliyordu, kod akmaya devam ediyordu
  (Postman'in dokümante davranışıyla çelişiyordu). Senkron kesinti
  sentinel error mekanizmasıyla sağlanıyor.
- **Import:**
  - **Insomnia v4 environment export'ları** gerçek `environments`
    satırları + variables olarak persist ediliyor. v4 sadece
    `suggestedEnvVars`'a düşüyordu, Environment Manager'a hiç
    yansımıyordu — kullanıcı "Imported" toast'ı görüp boş listeye
    bakıyordu.
  - **Swagger 2.0 (OpenAPI v2)** istek body'leri artık boş gelmiyor:
    `parameters[].in='body'` schema'dan JSON örneği üretiyor,
    `in='formData'` form-data tablosunu her form alanıyla doldurarak
    getiriyor. petstore tarzı import'larda "This request does not
    have a body" yerine kullanılabilir bir başlangıç payload'ı
    görünüyor.
  - **Test suite re-import'larında** aynı native export, `X`,
    `X (1)`, `X (2)` suffix'leriyle eklenir; iki suite aynı isimle
    yan yana durmaz. (Postman/Insomnia kolunda zaten vardı, native
    branch'te eksikti.)
- **Tests workbench:**
  - Run-results Request sekmesi artık engine'in hat üzerine gerçekten
    koyduğu header / body / URL'i gösteriyor (Content-Type, Host,
    User-Agent, Auth sekmesinden gelen Authorization, query
    parametreleri URL'e gömülmüş halde). Önceden sadece kullanıcının
    elle eklediği header'lar listeleniyordu; auth token'ı ve content
    pazarlığı eksik gözüküyordu.
  - Bir suite item'ı düzenleyip kaydedip tab'ı kapat-aç yaptığınızda
    artık taze DB içeriği yükleniyor, pre-edit cache değil. Per-tab
    `_tabStates` cache'i orijinal snapshot'ı tutup DB okumasını
    bastırıyordu.
  - URL bar'dan istek kaydederken aktif tab'ın method / url / protokol
    chip'i de senkronize ediliyor — GET → POST değişikliği tab'a
    anında yansıyor, kapat-aç gerektirmiyor.
  - Tab'in method tipini değiştirip kaydetmek artık badge'i anında
    güncelliyor.
  - All Runs'tan bir run aç, başka tab'a geç, geri dön → detay paneli
    artık boşalmıyor. Seçili sonuç id'si tab'in sessionStorage'ıyla
    persist ediliyor.
  - APIs tree sağ tık → Add Request artık parent folder'ı otomatik
    expand ediyor — kullanıcı kapalı bir folder'a istek eklediğinde
    yeni request'i anında görüyor.
- **Save dialog'u:** SOAP / WebSocket / SSE editör'ündeki bir istek
  folder'a kaydedilirken artık gerçek protokol payload'ı persist
  ediliyor — eskiden modal yalnızca HTTP istek store'unu okuyup
  sessizce boş `protocol: 'http'` satırı ekliyordu. Her protokolün
  store'u save sırasında danışılıyor, protokole özgü meta veri
  (WSDL URL, seçili operation, WS-Security ayarları) yeni `metadata`
  kolonuyla round-trip ediyor.
- **Save modal scrollbar'ı:** Uzun folder listesi scrollbar belirince
  tüm dialog'u kaydırmıyor — `scrollbar-gutter: stable` boşluğu
  rezerve ediyor, layout net kalıyor.
- **Response pane:** Response Body toolbar'ındaki iki işlevsiz ikon
  (Search + Open-in-new-tab) kaldırıldı — Filter zaten substring /
  JSONPath aramayı kapsıyor, ikinci buton hiç bağlanmamıştı.
- **Console pane:** Console başlığındaki Layout (maximize) butonu
  artık çalışıyor. Response-pane in-tab görünümünde tıklayınca
  console'u alt panele yükseltiyor; alt panel içinden tıklayınca
  kullanıcı boyutu ile ~%78-viewport maksimize görünüm arasında
  toggle ediyor.
- **File menüsü:** Native File menüsünde önceden sadece "Exit"
  vardı. Artık New Tab (⌘/Ctrl+T), New Window, Import…, Export…,
  Save, Settings…, Close Tab ve Exit listeniyor; hepsi yeni
  `menu:*` IPC kanalı üzerinden ilgili in-app aksiyonlara bağlı.
- **Help / About:** Privacy Policy ve EULA footer'larındaki "Source
  repository" artık **public** olan `apinizer/testnizer`
  repo'sunu işaret ediyor (private kaynak repo'su kullanıcıya 404
  döndürüyordu). Posta adresi İstanbul yerine Ankara olarak
  düzeltildi.
- **WSSE aracı:** "Send to active SOAP" artık hem imzalı envelope'ı
  SOAP tab'ına enjekte ediyor HEM istek gönderiyor; tek tıkla beklenen
  tam el sıkışma gerçekleşiyor. Eskiden body sessizce güncelleniyor,
  hat üstüne hiçbir şey gitmiyordu.
- **GraphQL Introspect:** Gerçek introspection hataları (HTTP
  hataları, bozuk JSON, `errors[]` body, eksik `data` alanı) artık
  schema panel'inde gerçek hata mesajı olarak görünüyor. Önceki
  fallback sessizce hatayı sabit kodlu bir demo schema ile değiştir-
  iyordu; kullanıcılar endpoint sorgularının neden çalışmadığını
  anlayamıyordu.
- **History:**
  - Today / runner-history yan paneli her runner-history folder
    grubunu ilk göründüğünde otomatik expand ediyor; suite-run
    satırları manuel tıklamadan görünüyor.
  - Suite-run isteğine tıklayınca response body / headers /
    body-size detayı görünüyor. History `response_snapshot` kolonu
    eskiden sadece `status` / `statusText` / `timing` persist
    ediyordu; detay paneli boş kalıyordu.
- **Code paneli:** Resolve edilemeyen `{{var}}` placeholder'ları
  cURL / JS / Python snippet'inin üstünde küçük turuncu bir banner
  olarak gösteriliyor ("Unresolved: {{employee_body}}") —
  kullanıcılar istek tarafından referans verilen ama aktif
  environment'da bulunmayan değişkenleri anında görüyor.
- **Iç işleyiş:** http-engine error testindeki DNS-hata assertion'ı
  bazı resolver'ların `.invalid` host için aldığı `ECONNABORTED`
  timeout yolunu da kabul edecek şekilde genişletildi; environment'a
  bağımlı CI flake giderildi.

## v1.4.2

**Legacy TLS desteği, Postman-eşdeğeri Console, v1.4.1 test turunun tüm bug'ları kapatıldı.**

- **Legacy TLS (1.0 / 1.1) kurumsal backend'leri yeniden konuşuyor.**
  TLS 1.0 veya 1.1 zorunlu tutan bankacılık, kamu ve sigorta API
  gateway'leri kutudan çıkar çıkmaz erişilebilir: Testnizer Settings →
  Certificates'te protokol pini'ni tespit edip request'i platforma
  özel bir bundle edilmiş statik `curl` binary'sine (~3MB) route
  ediyor; bu da işletim sisteminin TLS yığınını kullanıyor. Sistemde
  curl kurulu olmasına gerek yok — binary her installer'ın içinde
  geliyor, `PATH`'ten `curl.exe` çıkarılmış kilitli Windows imajları
  dahil. Legacy handshake için cipher suite otomatik olarak
  `DEFAULT@SECLEVEL=0`'a düşüyor; dropdown etiketleri yönlendirme
  yolunu açıkça gösteriyor ("TLS 1.0 — via system curl"). Modern TLS
  1.2/1.3 hâlâ hızlı axios path'inde, ek yük yok.
- **Scripting:** `pm` API, Postman script'lerinin beklediği yüzeyi
  kazandı. `pm.request` artık pre-request scope'unda doluyor (önceden
  method / URL / header'lar boştu); `pm.request.headers`
  case-insensitive bir koleksiyon: `add` / `upsert` / `remove` /
  `get` / `has` / `each`; pre-request mutasyonları wire'a gitmeden
  önce outgoing request'e dahil ediliyor. `pm.environment.has` /
  `.unset` ve `pm.globals.has` / `.unset` eklendi.
  `pm.execution.skipRequest()` artık gerçekten request'i iptal
  ediyor. Pre-request script'inde `pm.response`'a erişim, phantom bir
  shell yerine açıklayıcı hata fırlatıyor. AWS SigV4 / HMAC / webhook
  imzalama için `CryptoJS` built-in script global'i olarak sunuluyor.
- **Import:** Insomnia v5 YAML environment export'ları doğru import
  ediliyor — EnvironmentModal v5 şeklini ham metinden tespit edip
  main process'in YAML importer'ına yönlendiriyor. Postman + Insomnia
  env import'ları artık iç katman hatalarını (proje bulunamadı,
  eksik alan) yüzeyliyor; eskiden false-positive "imported" toast'ı
  görünüyordu. Project import'ları, workspace'te aynı isimde proje
  varsa `(imported)` / `(imported N)` suffix ekliyor. Folder/project
  export'ları başarı toast'ı ve net hata mesajı gösteriyor.
- **Tests workbench'i:** Overview, All Runs ve Scheduled Tasks
  sekmelerindeki "New Run" butonu, aynı stil ile paylaşılan tek bir
  component ve hepsinde aynı Test Suite seçici dropdown'unu açıyor.
  Proje içindeki her endpoint'i listeleyen eski APIs-tree seçici
  kaldırıldı — Test Suite'ler giriş noktası artık. Rastgele sekme
  geçişlerinde kullanıcı artık 200 endpoint gösteren scope'suz config
  view'a düşmüyor (eski `sessionStorage` view restore guard'ı
  eklendi). Runner iteration gruplama her iteration'ı kendi açılır
  grubu olarak gösteriyor; "New Run" tıklamasındaki beyaz ekran
  düzeldi.
- **Console:** Her request/response döngüsü için tek bir açılır kayıt
  (Postman ile aynı). Genişletildiğinde Network meta'sı, Request
  Headers, Request Body, Response Headers, Response Body ve Script
  Logs tek bir satırda gösteriliyor. Response pane'inde aynı veriyi
  tekrarlayan iki kırpılmış sekme ("Console" + "Actual") kaldırıldı.
  Network / Timings tablolarını gösteren globe popover'ı artık
  Console panelinin arkasına geçmiyor — portal'a alındı ve aşağıda
  yer kalmadığında otomatik yukarı açılıyor.
- **Branches:** Settings → Branches `main`'i doğru listeliyor
  (branch seeding'inden önce oluşturulmuş projelerde eksikti) ve aynı
  anda yalnızca tek bir active branch gösteriyor (iki active sorunu
  giderildi).
- **History:** History sayfasındaki bir kayda tıklamak onu tab'da
  açıyor — hem HTTP hem SOAP girdileri doğru yönlendiriliyor. Yeni
  tab gerçekten görünür olsun diye sidebar APIs'e geçiyor (eskiden
  yeni tab sessizce açılıyor ama History welcome ekranı yerinde
  kalıyordu).
- **Windows updater:** Start Menu / Desktop kısayollarını koruyan
  sessiz tek tıklı güncellemeler. Differential paketleme update
  download boyutunu yalnızca değişen block'lara indiriyor. "Problem
  with Shortcut: 'Testnizer.exe' has been changed or moved" diyaloğu
  düzeldi — kurulumlar UAC olmadan kullanıcı başına
  `%LOCALAPPDATA%\Programs\Testnizer` yoluna gidiyor. v1.4.1'den
  v1.4.2'ye ilk geçişte hâlâ eski wizard bir kez görünüyor (kurulu
  uninstaller v1.4.1'in NSIS'i); v1.4.2'den itibaren yeni sessiz akış
  devralıyor.
- **Internals:** macOS x64 CI runner'ı `macos-13`'ten (ölü pool,
  job'lar 10+ saat kuyrukta) `macos-14`'e `--x64` cross-build ile
  taşındı. Scheduler test DB şeması production migration'larıyla
  senkronlandı. `pm.request.headers` storage'ı RFC 7230
  case-insensitive semantik'e yeniden yazıldı. Bundled curl 8.20.0,
  OpenSSL 4.0 backend ile.

## v1.4.1

**Zamanlanmış Görevler Test Suite üzerine inşa edildi, kenar çubuğu rötuşları, yerel Hakkında.**

- **Zamanlanmış Görevler:** "New Run" butonu artık bir Test Suite
  seçici açıyor — zamanlamalar tasarım gereği Test Suite'lere ait,
  dolayısıyla ad-hoc APIs endpoint seçici kaldırıldı. Her görev
  satırı genişletildiğinde içindeki endpoint'leri (method rozetleri
  + ad + URL) ve son on çalışmayı (Ne Zaman / Sonuç / Test / Süre)
  gösteriyor. Satır başına bir "Run now" butonu görevi sonraki
  döngüyü beklemeden tetikliyor.
- **Schedule Configuration** Interval / Daily / Weekly / Cron
  modları kazandı. Daily / Weekly yerel saatle `HH:MM` alır; Weekly
  bir haftanın günü çip seçici ekler; Cron canlı doğrulamayla 5
  alanlı bir ifade alır. Scheduler timer her çalışmanın ardından
  sonraki tetiklemeyi yeniden hesaplıyor, böylece daily / weekly /
  cron sapma yapmıyor.
- **Runner config:** "Schedule runs" radyosu yalnızca run bir Test
  Suite kaynaklıysa görünüyor. APIs ağacı ve klasör çalışmaları
  tek seferlik — radyoyu orada gizlemek, kimsenin nerede bulacağını
  bilmediği "Scheduled: ad-hoc" görevlerin oluşmasını engelliyor.
  Tests kenar çubuğuna ilk geldiğinde artık 200 endpoint'lik runner
  yapılandırma ekranı yerine Tests Overview açılıyor.
- **Kenar çubuğu:** Hem APIs hem Tests kenar çubuklarında "+" New
  butonunun yanına ayrı bir Import butonu eklendi. Bir format
  seçince Import wizard'ı eski iki-tık "modal aç, sonra format seç"
  yolu yerine doğrudan 2. adımda açılıyor. Format listesi logo
  grid'ini bıraktı (cURL / RAML / WSDL gerçek logoya sahip değildi,
  ad iki kez yazılıyordu) ve yerine kategorili bir liste geldi
  (Specs / Collections / Quick). Tüm kenar çubuğu aksiyon butonları
  28×28'e ve aynı ikon boyutu / kalınlığa standardize edildi; Mocks
  paneli daha önce 26×26 idi. History kenar çubuğu başlığı 44px'e
  yükseltilerek diğer panellerle hizalandı.
- **Ağaç sağ tık:** Endpoint sağ tık menüsü "Bu istekten Test Suite
  oluştur" ve "Bu istekten Mock Sunucu oluştur" kazandı; oluşan
  suite veya mock isteğin adını otomatik alıyor. Klasör sağ tık
  menüsündeki Run girdisi kaldırıldı — Send tek endpoint için
  yeterli, Test Suite çoklu endpoint için.
- **İçe / Dışa aktar ikonları:** Yön uygulama genelinde düzeltildi
  — İçe aktarım için Download (aşağı ok, sisteme), dışa aktarım
  için Upload (yukarı ok, dışarı). Tests paneli context menüsü,
  Proje Hub ana ekran butonu ve Environment modali etkilendi.
- **Alt bar + yerel Hakkında:** Footer'daki Runner bağlantısı
  kaldırıldı (Tests kenar çubuğundaki Overview / All Runs /
  Scheduled Tasks girdileri açıkça kapsıyor). Enterprise butonu
  artık panoya kopyalanabilir e-posta adresli bir uygulama içi
  modal açıyor — gövde lisanslama, lokal kurulum ve özel desteği
  kapsıyor. macOS "About Testnizer" menü öğesi artık Electron'un
  varsayılan paneli (atom logosu + framework sürümü) yerine bizim
  markalı About modalimizi açıyor.
- **Console paneli:** Toolbar'daki ölü üç-nokta butonu kaldırıldı —
  click handler'ı yoktu ve Auto / Clear aksiyonlarının üzerine
  biniyordu. Toolbar'a sağ padding eklendi, böylece panelin
  kapatma butonuyla çakışmıyor.
- **İçeride:** `runner_history`'ye `scheduled_task_id` eklendi,
  böylece görev başına geçmiş, görev yeniden adlandırılsa bile
  korunuyor. `scheduled_tasks`'a `schedule_type`, `schedule_time`,
  `schedule_days`, `schedule_cron` ve `suite_id` sütunları eklendi
  (ek — eski satırlar 'interval' yolunda kalır). Yeni
  `scheduler:history`, `scheduler:runNow`,
  `scheduler:taskEndpoints` ve `scheduler:validateCron` IPC
  handler'ları yeni UI'a güç veriyor. About öğesinin
  bağlanabilmesi için varsayılanın yerine geçen özel bir macOS
  uygulama menüsü eklendi. CI, her derlemeden önce eski artifact,
  cache ve workflow run'larını boşaltan yeni bir `cleanup` job'u
  kazandı; artifact saklama süresi 90 günden 1 güne düştü —
  Actions depolama kotası release derlemelerini öldürüyordu.

## v1.4.0

**Üç ekipli QA turu: script'ler tekrar çalışıyor, dışa aktarım round-trip yapıyor, Test Suite dürüst.**

- **Script'ler:** Pre-request ve post-response script'leri tekrar
  çalışıyor — v1.3.1 `new Function()`'ı bloke eden bir CSP gönderdi,
  bu yüzden her `pm.*` script'i sessizce "Refused to evaluate a
  string as JavaScript" ile patladı. Renderer CSP'si artık
  kullanıcı tarafından yazılmış script'ler için `'unsafe-eval'`'a
  izin veriyor. `pm.expect` zinciri eksik Chai-BDD bağlayıcılarını
  anlıyor: `.that`, `.with`, `.is`, `.and`, ayrıca `.empty` ve
  `.lengthOf(n)`. `pm.expect(res.errors).to.be.an('array').that.is.empty`
  gibi assertion'lar artık response gerçekten eşleştiğinde geçiyor.
  Scripts ve Tests sekmeleri, script veya assertion mevcut
  olduğunda Auth sekmesinin konvansiyonuyla uyumlu yeşil-nokta
  göstergesi kazandı. Scripts Kılavuzu modali Ctrl/Cmd+A'yı odaktaki
  snippet'in içine kapatıyor — tüm diyaloğu seçmek yerine.
- **Yedekleme & Geri yükleme:** Export Project artık projenin
  verisi yüklenmediğinde 200 byte'lık stub yazmayı reddediyor. Dışa
  aktarım yükü bir sayım özeti (klasör / endpoint / environment /
  suite / mock) döndürüyor — UI bunu bir toast'ta gösteriyor — ve
  içe aktarıcı boş kabukları "Invalid project file format" yerine
  spesifik bir hatayla reddediyor. Bir projeyi Export → Import
  üzerinden round-trip yapmak uçtan uca tekrar çalışıyor.
- **Test Suite:** Form-data gövdeleri üretilen cURL'da görünüyor.
  cURL snippet'leri `{{variable}}` placeholder'larını aktif
  environment karşısında resolve ediyor — kelimesi kelimesine
  emitlemek yerine. Suite import'ları aynı isimli bir suite zaten
  projede varsa `(1)`, `(2)`… ekleyerek otomatik
  ayrıştırıyor. Test Suite Import → Insomnia artık `.yaml` /
  `.yml` dosyalarını kabul ediyor (Insomnia v5 export şekli).
  Insomnia v5 environment YAML'leri v4 yoluna düşmek yerine
  ayrı bir importer'a yönleniyor. Runner sekmesi singleton —
  "Run"'a üç kez sağ tıklamak artık üç hayalet runner sekmesi
  bırakmıyor. Suite-item sağ-tık menüsü dışarı tıklamayla
  kapanıyor. Runner geçmiş snapshot'ı artık çözülmüş header'ları,
  query param'ları, body önizlemesini ve auth tipini içeriyor;
  böylece run detaylarındaki Request paneli kabloda gerçekten ne
  gittiğini yansıtıyor. Sağ-tık "Run" yolu otomatik başlatmak
  yerine runner yapılandırma görünümünü açıyor ve runner
  sekmesinin aktif görünümü (config / results / history) sekme
  değişimleri arasında korunuyor.
- **İçe / Dışa aktarım:** Postman içe aktarımları başıboş "New
  Request" placeholder öğelerini (URL boş + varsayılan ad)
  atlıyor. Klasör dışa aktarım dosya adları projenin display
  name'ini kullanıyor ve duplike `folder-` prefix'ini bırakıyor;
  v1.3.1 `folder-folder-2026-mm-dd.json` dosya adı gitti.
  Format seçici, bir export'u yeni proje olarak yüklemek için
  `save:importProjectFromContent`'i yeniden kullanan bir
  "Testnizer Native" girdisi kazandı. Import → cURL dosya
  seçicinin yanına kod modunda bir textarea sunuyor. SoapUI
  importer'ı `con:operation`'a ek olarak `con:resource` /
  `con:method` ağaçlarını dolaşıyor; böylece SoapUI 5.x
  projelerindeki REST endpoint'ler boş interface klasörlerinde
  kaybolmuyor.
- **Environment içe aktarımları:** Postman environment ve
  Insomnia v4 environment içe aktarımları artık aktif-environment
  seçicisine yayılıyor — içe aktarma başarı toast'ı artık
  yalan söylemiyor.
- **Branch UX:** Bir branch oluşturmak otomatik olarak ona
  geçiyor (VS Code / IntelliJ / GitKraken ile uyumlu). Branch
  dropdown'u git fetch boş döndüğünde bile mevcut branch'i
  listeliyor; böylece pill ve menü uyuşuyor.
- **Project Hub:** Wizard avatar baş harfleri Details
  önizlemesi ile Storage Settings özet kartı arasında tutarlı
  — ikisi de `display_name`'i çekiyor, Storage Settings'in
  slug'dan baş harf türetmesine izin vermek yerine. `Cmd/Ctrl+P`
  Project Hub'ı açıyor. Header proje rozeti kullanıcıları aynı
  kısayola yönlendiren bir tooltip kazandı ve tıklamayla ana
  ekrana gidiyor — v1.3.1 "MP avatar hiçbir şey yapmıyor" UX
  şikayetini gideriyor. Bir klasöre sağ tıklamak artık tek bir
  transaction'da gerçek bir sunucu tarafı deep clone (alt
  klasörler, endpoint'ler, kaydedilmiş istekler) tetikliyor;
  Project Hub `…` menüsü aynı export → import-as-new pipeline'ı
  ile desteklenen bir Duplicate öğesi kazandı.
- **Kenar çubuğu:** Ağaç kök etiketi projenin slug'ı yerine
  display name'ini gösteriyor. Proje kökü üzerinde ağaç sağ
  tıklaması "Bu projeden Test Suite oluştur" / "Bu projeden Mock
  Sunucu oluştur" okuyor (ayrı i18n anahtarları; EN + TR
  aynası). Proje kökünü dışa aktarmak `save:exportFolder` yerine
  `save:exportProject` üzerinden yönleniyor; böylece JSON doğru
  şekilde `kind: 'project'` taşıyor. Klasör çoğaltma artık
  özelliğin henüz bağlı olmadığını açıklayan net bir toast
  gösteriyor — sessizce hiçbir şey yapmak yerine. APIs welcome
  ekranında en son beş istek tek tıklamalı kartlar olarak durum
  rengi, method rozeti ve "Xm ago" mührüyle render ediliyor.
- **APIs ↔ Tests ↔ Mocks round-trip'leri** kullanıcıyı welcome
  ekranına atmak yerine önceden odaklı sekmeyi geri yüklüyor.
  Tabs store kenar çubuğu sayfası başına son aktif sekmeyi
  yer imine alıyor.
- **Commit history kenar çubuğu:** History kenar çubuğu aktif
  projenin branch'i için git commit'lerini listeleyen bir
  "Commits" sekmesi kazandı — endpoint Save aksiyonları artık
  kullanıcıların beklediği yerde görünüyor.
- **Sertifikalar:** Project Settings modali'nin Save Changes
  butonu kayıttan sonra modali gerçekten kapatıyor. TLS 1.0 /
  1.1 sürüm dropdown'larında "desteklenmiyor" olarak
  işaretlendi ve runtime'da BoringSSL varsayılanına açıkça
  zorla çevriliyor; böylece bunları seçmek artık
  `ERR_SSL_INVALID_COMMAND` ile patlamıyor — seçenek zaten
  yanlış reklamcılık olarak vardı.
- **Hakkında:** Sürümünü `package.json`'dan okuyor (derleme
  zamanında paketlenmiş) ve fallback olarak
  `app.getVersion()` ile; böylece diyalog artık Electron
  framework'ünün `1.0.0` placeholder'ını göstermiyor.
- **Cmd/Ctrl+S** protocol alanı sekme durumuna yayılmadan
  önce bile aktif endpoint / kaydedilmiş istek / suite öğesi
  sekmesini proje kayıt modali yerine tercih ediyor.
- **Header autocomplete:** Substring eşleşmesi — "type"
  yazmak "Content-Type"'ı tekrar yüzeye çıkarıyor. Prefix
  eşleşmeleri en üstte kalıyor.
- **Değişkenler:** Runner tarafı Variables paneli
  `type: secret` değerlerini düz metinle göstermek yerine
  `••••••••` ile maskeliyor.
- **Durum çubuğu:** `ui.store.setStatusMessage(text, ttlMs)`
  merkezi, otomatik temizlenen bir status mesaj slotu
  sağlıyor; böylece bayat banner'lar alaka düzeylerinin
  ötesine geçemiyor.
- **Yeni endpoint baseline'ı:** Sekme şeridindeki "+ New" ve
  her welcome kartı her protokol store'unu
  `activeTabId`'daki bir Workbench efekti ile boş durumuna
  çeviriyor. Daha önce taze bir sekme son endpoint'in URL /
  param / script'lerini miras alıyordu. Scripts sekmesindeki
  "+ Insert example" butonu artık her zaman görünür durumda,
  ilk tuş vuruşunda kaybolmak yerine snippet'i ekliyor.
- **HTTP timing breakdown** soket yaşam döngüsü olayları
  (`lookup`, `connect`, `secureConnect`) artı axios'un
  `onDownloadProgress`'i üzerine yeniden inşa edildi —
  TTFB / download ayrımı için. TLS handshake HTTPS istekleri
  için doldurulmuş; download süresi body stream'ini yansıtıyor.
- **İçeride:** Tab durum cache'i sınırlandırıldı — request
  store, 20 cache'lenmiş sekmeden sonra en eski girdileri
  tahliye ediyor; böylece uzun oturumlar sınırsız sekme başı
  durum biriktirmiyor. Chai zinciri, TLS sürüm validatörü,
  header autocomplete substring semantiği,
  `validateProjectExport` (7 senaryo), Postman placeholder-
  öğe filtresi ve Insomnia v5 environment YAML importer'ı
  için regresyon kapsamı eklendi.

## v1.3.1

**Her yerde içe aktarım, Script Kılavuzu ve derin denetim turu.**

- **İçe Aktarımlar:** Tests panelindeki Import butonu artık doğrudan OS
  dosya seçicisini açmak yerine bir format-seçim modali (Testnizer /
  Postman v2.x / Insomnia v4-v5) açıyor. APIs tarafındaki içe aktarıcı,
  Insomnia 8'in tüm doküman alt türlerini (`collection`, `spec`, `proxy`
  — daha önce "bilinmeyen format" olarak reddediliyordu) kabul ediyor;
  `js-yaml` fallback'i sayesinde Insomnia v5 YAML dışa aktarımları
  JSON'a çevrilmeden hem endpoint hem test paketi olarak içe aktarılıyor.
  44 testlik fixture denetimi, 18 gerçek Insomnia dışa aktarımı + bir
  Postman + SoapUI fixture'ını uçtan uca sürüyor.
- **Environment'lar:** Environment modalindeki dedicated Import butonu
  Postman environment dosyalarını ve Insomnia dışa aktarımlarını alır,
  Postman koleksiyonlarını dostane bir mesajla APIs yoluna yönlendirir,
  tanınmayan dosyalar için net hata toast'ı verir.
- **Script'ler:** Hem Scripts tab'ında (Pre / Post varyantları) hem de
  Tests tab'ının Post-response Script bölümünde "?" Script Kılavuzu
  modali açılıyor — 4-6 kopyalanabilir snippet, 15 satırlık `pm.*` API
  tablosu, ve alias / async / scope / console üzerine notlar.
- **Header UX:** Value-cell autocomplete artık Accept, Cache-Control,
  Connection, Authorization, X-Requested-With ve diğerlerini kapsıyor;
  hücre boş olsa bile focus üzerine açılıyor ve popup hücre DIV'ine
  bağlanıyor — eskiden ekran dışına render oluyordu. Variable
  Autocomplete (`{{var}}`) aynı hücrede çalışıyor.
- **Runner Sonuçları:** Request ve Response panelleri artık standart HTTP
  mesaj sırasına uyuyor — status / headers üstte, body altta — ve Request
  tab'ı Method + URL'i özet başlık olarak gösteriyor.
- **Test Suite item'ları** tamamen self-contained (copy-on-add): kaynak
  endpoint silinse bile suite boşalmıyor. Bir suite item'a tıklamak
  artık her zaman onun editörünü Tests sayfasında açıyor (item'ları
  sessizce APIs'a sızdıran routing bug'ı düzeltildi).
- **Komut Paleti:** `Cmd+K` `cmdk` tabanlı bir palet açıyor — endpoint,
  recent, tool, mock server ve settings kategorileri. `?` klavye
  kısayolu cheat-sheet'i açıyor.
- **Toast + a11y:** `sonner` toast bildirimleri, EmptyState bileşenleri
  panel'ler arasında genişletildi ve her özel modal Radix Dialog
  wrapper'a taşındı — ESC + focus-trap + dışına tıklama ile kapanma.
- **İptal edilebilir istekler:** Her protokol (HTTP, SOAP, WebSocket,
  GraphQL, gRPC, SSE, Socket.IO, MCP) artık in-flight Cancel tıklamasına
  saygı duyuyor ve main process'te işi durduruyor.
- **About sayfası** EN ve TR'de düzgün label'lar (Version / Platform /
  Electron / Node / Chrome / License) gösteriyor — daha önce ham i18n
  anahtarları görünüyordu.
- **Page-aware workbench:** Tab strip aktif sidebar sayfasına scope'lu;
  sayfa değişimi tab oraya ait değilse aktif tab'ı temizliyor ve boş
  workbench her sayfanın doğru welcome ekranını gösteriyor (APIs'ta
  ProjectWelcome, Tests'te TestsHome, Mocks / History / Tools'ta
  EmptyState).
- **Düzeltmeler:** İçe aktarımlar kaynak sayfada kalıyor (APIs import'tan
  sonra otomatik Tests'e geçiş yok). Pre-script / post-script `pm.test()`
  sonuçları visual assertion'larla tek bir `response.testResults`
  array'inde birleşiyor. Postman environment dosyaları Postman import
  yolundan seçildiğinde doğru algılanıyor. `Cmd+S` aktif tab'ı kaydediyor.
- **Dahili:** IPC handler tiplemeleri sıkılaştırıldı, renderer-side `any`
  cast'ları kaldırıldı. Main-process handler'larında her renderer-sağlı
  path doğrulandı. RCE / path-traversal advisory'leri için `simple-git`
  3.36.0'a ve `fast-uri` 3.1.2'ye yükseltildi. Pre-release migration
  kodu kaldırıldı. Project export → import artık environment ve global
  değişkenler için `project_id` foreign key'ini koruyor (eskiden sessizce
  düşüyordu). Yinelenen import format dedektörleri temizlendi. 250+ test
  eklendi — IPC handler'lar, suite çoklu-format import, project export
  round-trip, header value önerileri, sayfa routing, cert + mTLS pipeline
  ve `BADSSL_NETWORK=1` ile gate'lenmiş opt-in BadSSL network suite.

## v1.3.0

**Git iş birliği ve geçmiş kapsamı.**

- `git merge` ve `git pull` çakışmaları için yan yana **Benimkini kullan
  / Onlarınkini kullan** seçici eklendi — endpoint, mock server, test
  suite ve environment için öğe-sayısı özetleriyle.
- Çoklu dosya çakışmaları için dosya başına sekme stripi, locale-aware
  commit mesajları ve çakışmayı iptal etme desteği eklendi.
- Mock Server, mock endpoint, mock response ve istemci sertifikaları
  `git push / pull / branch-switch` round-trip'ine alındı — önceden
  yalnızca DB'deydi, branch değişimi mock konfiglerini sessizce
  düşürüyordu.
- İstek geçmişi her protokol için kaydedilmeye başlandı: SOAP, GraphQL,
  gRPC unary, WebSocket / SSE / Socket.IO (bağlantı seviyesi) ve MCP
  tool çağrıları. History paneli artık aktif projeye scope'lu tam
  tabloyu gösteriyor.
- macOS giriş ekranındaki About butonunun traffic-light kümesinin altına
  girmesi düzeltildi.
- **Dahili:** Çakışma sırasında `git.show` okumaları paralelleştirildi,
  IPC'den ölü payload temizlendi, disk-import helper'ı tekilleştirildi,
  çakışma çözücü için 13 unit test eklendi.

## v1.2.0

**Mock Server ve Tools workbench genişlemesi.**

- **Mock Server:** `127.0.0.1`'e bağlı, çoklu instance destekli gerçek
  bir HTTP sunucusu eklendi.
- Endpoint eşleştirme için exact, param, wildcard ve regex modları
  desteklendi.
- Header, query, path-param, body-JSONPath, body-XPath ve method üzerinde
  koşullu yanıtlar uygulandı; `and` / `or` kompozisyonu desteklendi.
- Handlebars ve dinamik-değer template'leme, 5 saniyelik `vm`
  sandbox'ında pre-response JavaScript ve sunucu bazlı in-memory state
  eklendi.
- Bearer / Basic / API-key auth (endpoint-bazlı override), draft-07
  JSON Schema gövde doğrulaması, hata enjeksiyonu, sliding-window rate
  limit, ince-ayar CORS, `/__echo` endpoint'i ve opsiyonel recording'li
  proxy passthrough eklendi.
- OpenAPI 3 ve Postman v2 içe aktarma desteklendi. Copy / Copy as cURL
  / Open butonlu tam URL barı ve canlı istek log'u eklendi.
- **Tools workbench:** 17 offline araç yayınlandı — JWT debugger yeniden
  yazıldı (Decoder + Encoder sekmeleri, JSON / Table görünümü, her
  algoritma için Generate example), karakter düzeyinde intra-line vurgulu
  yan yana diff, Hash ve HMAC hesaplayıcıları (RFC vektörleri), Epoch
  dönüştürücü, HTTP status kodu referansı, sayı tabanı dönüştürücü
  (ASCII / Bin / Oct / Dec / Hex), JSON Schema üretici, JSON ↔ XML
  dönüştürücü, UUID üretici (v1 / v4 / v5 / v7), cheatsheet'li Regex
  tester ve YAML ↔ JSON dönüştürücü.
- JSONPath, XPath, Jolt ve XSLT için 17 hazır örnek bundle'landı.

## v1.1.1

**Runner, test motoru, console ve import iyileştirmeleri.**

- **Collection Runner:** Multi-iteration koşumu düzeltildi, açılabilir
  sonuç satırlarına Request / Response / Tests sekmeleri eklendi,
  skipped-count doğrulandı.
- **`pm` test motoru:** Async `pm.test()` artık bekleniyor, `pm.expect()`
  chain getter düzeltildi, `pm.info.requestName` dolduruluyor,
  `jsonBody(path)` uygulandı.
- **AI Chat:** Uç nokta URL'si her zaman görünür hale getirildi, 14
  sağlayıcı 2026 model kataloguyla yenilendi.
- **Console:** gRPC trailers, WS / SSE / Socket.IO / MCP handshake
  header'ları, event başına timing ve sizing eklendi; filter dropdown
  tamamlandı.
- **Import / export:** GraphQL gövdesi Postman ve Insomnia round-trip'te
  korundu, HAR disabled flag'ı dikkate alındı.
- **Kurumsal:** Kurumsal iletişim About modal, Footer ve EULA'ya eklendi.
  EULA, no-maintenance ve air-gap maddeleriyle güncellendi.

## v1.1.0

**MCP, Socket.IO ve Postman pariteliği.**

- MCP (Model Context Protocol) ve Socket.IO protokol desteği eklendi.
- Postman script ve collection variable import'u eklendi.
- gRPC reflection desteklendi (v1 ve v1alpha).
- Sekme kalıcılığı ve `Cmd+T` / `Cmd+W` kısayollu IDE-tarzı sağ-tık
  menüsü eklendi.
- `pm` ve `t` test API'si genişletildi.

## v1.0.3

- WS-Security çalışma tezgahı iyileştirildi.
- SOAP arayüz hataları düzeltildi.
- Açık sekmeler tekilleştirildi.

## v1.0.2

- gRPC tam akış desteği eklendi.
- GraphQL abonelikleri eklendi.

## v1.0.1

- İçe aktarma formatları genişletildi: HAR, Insomnia v4, SoapUI.

## v1.0.0

- İlk kamuya açık sürüm.
