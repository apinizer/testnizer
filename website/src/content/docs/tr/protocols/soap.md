---
title: SOAP
description: WSDL dosyalarını ayrıştırın, envelope'ları otomatik oluşturun ve SOAP 1.1 ile 1.2 isteklerini tamamen çevrimdışı gönderin.
order: 6
section: Protokoller
---

Testnizer'ın SOAP editörü, güvenlik header'ları için `wsse` ile birlikte `soap`
npm kütüphanesi (v1.9) üzerine inşa edilmiştir. WSDL ayrıştırma, envelope oluşturma
ve istek yürütme hepsi Node ana sürecinde çalışır — proxy yok, bulut servisi yok.

## SOAP sekmesi açma

**+ Yeni** → **SOAP** tıklayın. Editör, bir mod seçici ile açılır: WSDL'den
başlayın veya envelope'u manuel olarak yazın.

## WSDL'den başlama

### WSDL'yi yükleme

İki yoldan biriyle WSDL kaynağı sağlayın:

- **URL**: WSDL uç nokta URL'sini yapıştırın (örn. `https://api.example.com/PaymentService?wsdl`)
  ve **Yükle**'ye tıklayın. Testnizer dosyayı ana süreç üzerinden getirir —
  renderer hiçbir zaman ağa dokunmaz.
- **Dosya**: **Dosyadan yükle**'ye tıklayın ve diskten bir `.wsdl` veya `.xml`
  dosyası seçin. Çevrimdışı ortamlar veya bir repo'ya alınmış sürümlü WSDL'ler
  için kullanışlıdır.

Yüklemeden sonra Testnizer servisleri, portları ve operasyonları ayrıştırır.
İçe aktarılan şemalar (`<xsd:import>` / `<wsdl:import>`) temel URL veya dosya
yoluna göre çözülür.

### Servislerde ve operasyonlarda gezinme

Editör araç çubuğunda üç açılır menü görünür:

1. **Servis** — her `<wsdl:service>` öğesi için bir giriş
2. **Port** — seçili servis için portlar
3. **Operasyon** — seçili porttaki kullanılabilir operasyonlar

Bir operasyon seçin ve **Envelope oluştur**'a tıklayın. Testnizer, operasyonun
giriş mesajı şemasından bir iskelet istek envelope'u oluşturur — karmaşık türler
genişletilir, gerekli öğeler dahil edilir, isteğe bağlı öğeler yorum olarak gösterilir.

`GetAccountBalance` operasyonu için oluşturulan envelope örneği:

```xml
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
    xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:tns="http://banking.example.com/accounts">
  <soap:Header/>
  <soap:Body>
    <tns:GetAccountBalance>
      <tns:AccountId><!-- string --></tns:AccountId>
      <tns:Currency><!-- string --></tns:Currency>
    </tns:GetAccountBalance>
  </soap:Body>
</soap:Envelope>
```

İskeleti doğrudan Monaco envelope editöründe düzenleyin. Uç nokta URL'si ve
`SOAPAction` header'ı WSDL binding'den önceden doldurulur.

## Manuel mod

WSDL yüklemeyi atlayıp envelope'u sıfırdan yazmak için editörün üstündeki
**Manuel**'e tıklayın. Şu durumlarda kullanın:

- WSDL kullanılamıyor veya geliştirme makinesinden erişemediğiniz bir VPN'in
  arkasında kilitli
- Servis WSDL'den önce gelen veya standart dışı binding kullanan
- Ağ izinden ham bir envelope yakaladınız ve bunu tekrar oynatmak veya değiştirmek istiyorsunuz

Monaco editörü minimal bir envelope şablonuyla başlar:

```xml
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
    xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header/>
  <soap:Body>
    <!-- istek öğenizi buraya yapıştırın veya yazın -->
  </soap:Body>
</soap:Envelope>
```

Ad alanı bildirimlerini ve gövde öğesini doldurun, uç nokta URL'sini ayarlayın
ve gönderin.

## SOAP 1.1 vs 1.2

SOAP 1.1 ve 1.2 arasında geçiş yapmak için editör araç çubuğundaki **Sürüm**
geçişini kullanın. Testnizer sizin için şu farklılıkları yönetir:

| | SOAP 1.1 | SOAP 1.2 |
|---|---|---|
| Envelope ad alanı | `http://schemas.xmlsoap.org/soap/envelope/` | `http://www.w3.org/2003/05/soap-envelope` |
| Content-Type | `text/xml; charset=utf-8` | `application/soap+xml; charset=utf-8` |
| SOAPAction header | Zorunlu (boş dize olabilir) | Content-Type `action` parametresine taşındı |
| Fault yapısı | `<faultcode>` / `<faultstring>` | `<Code>` / `<Reason>` |

WSDL'den yüklenen bir istekte sürüm değiştirdiğinizde Testnizer, envelope
ad alanını yeniden oluşturur ve Content-Type'ı otomatik olarak günceller.

## İstek sekmeleri

### Action URL

WSDL'den alınan veya manuel olarak girilen uç nokta URL'sini geçersiz kılar.
WSDL'nin üretim uç noktasını listelediği ancak bir test ortamını hedeflemek
istediğinizde — veya servis farklı bir yolda bir gateway'in arkasındayken
kullanışlıdır.

URL alanında değişkenler çözülür:

```
{{soapGatewayUrl}}/PaymentService
```

### Özel Header'lar

SOAP isteğiyle birlikte gönderilen HTTP header'larını ekleyin veya geçersiz kılın.
Yaygın kullanımlar:

- `Authorization: Bearer {{accessToken}}` (servis bir OAuth gateway'inin arkasındaysa)
- `X-Correlation-ID: {{$randomUUID}}`
- Özel proxy header'ları

### SOAPAction geçersiz kılma

Testnizer varsayılan olarak `SOAPAction` header'ını WSDL binding'den ayarlar veya
SOAP 1.2 için boş bırakır. Açıkça geçersiz kılmak için bu alana eylem URI'sini girin.

Bazı servisler, özellikle eski Microsoft WCF servisleri, WSDL'nin belirttiğinden
farklı bir SOAPAction dizesi gerektirir.

## WS-Security

Mesaj düzeyinde güvenlik header'ları eklemek için istek editöründeki **WS-Security**
sekmesini açın: UsernameToken (Text ve Digest), Timestamp, XML İmzası ve XML
Şifreleme.

Tam kılavuz için [/tr/docs/ws-security](/tr/docs/ws-security) adresine bakın.

## Yanıt görünümü

### Ham XML

Alınan, değiştirilmemiş yanıt gövdesi — bayt bayt, boşluklar ve kodlama
bildirimleri dahil. Bir gateway'in transit sırasında envelope'u değiştirdiğinden
şüphelendiğinizde kullanın.

### Güzel biçimlendirilmiş

Tutarlı girintilemeyle biçimlendirilmiş aynı XML. Ad alanı önekleri normalleştirilir
ve yapı okunması daha kolay hale gelir.

### XPath sorgu paneli

Sorgu çubuğuna bir XPath ifadesi yazın; Testnizer onu yanıt belgesi karşısında
değerlendirir. Sonuçlar satır içinde vurgulanır ve sorgu çubuğunun altında listelenir.

Yaygın desenler:

```xpath
//soap:Body/*                         (gövdedeki her şeyi seçer)
//tns:AccountBalance/text()           (metin değeri çıkarır)
//*[local-name()='Fault']             (ad alanı önekinden bağımsız hatalar bulur)
```

XPath ifadelerindeki ad alanı önekleri, yanıt belgesinde bildirilen ad alanlarına
göre çözülür.

## Yaygın sorunlar

### HTTP 500 ve SOAP Fault

`500 Internal Server Error` HTTP durumu içeren bir SOAP Fault gövdesi geçerli
SOAP 1.1'dir — servis isteği işledi ve yapılandırılmış bir hata döndürdü. Bu,
ağ veya altyapı hatasından kaynaklanan `500`'den farklıdır.

Testnizer ikisini ayırt eder: yanıt gövdesi bir `<Fault>` öğesi içeren geçerli
bir SOAP envelope olarak ayrıştırılırsa, yanıt paneli HTTP durumu 500 olsa bile
XML görüntüleyicinin üzerinde özel bir başlıkta hata kodunu ve mesajını gösterir.

Gövde SOAP olarak ayrıştırılamazsa (düz HTML hata sayfası, boş gövde), yanıt
paneli hata başlığı olmadan ham HTTP hatasını gösterir.

### Eksik SOAPAction header

Birçok SOAP 1.1 servisi, eksik veya yanlış `SOAPAction` header'ı olan istekleri
belirsiz bir `400 Bad Request` veya `500` yanıtıyla reddeder. WSDL'den yüklenen
bir istekten beklenmedik hata alırsanız, `SOAPAction` header'ının dahil edildiğini
doğrulamak için **Console** sekmesini kontrol edin. WSDL binding eylemi belirtmiyorsa
bunu SOAPAction geçersiz kılma alanında açıkça ayarlayın.

### Karakter kodlaması

Testnizer istekleri varsayılan olarak `charset=utf-8` ile gönderir. Servis kodlama
hatası veya bozuk karakter döndürüyorsa farklı bir kodlama bekliyip beklemiyor
diye kontrol edin (eski IBM veya SAP ABAP servislerinde yaygındır). Farklı bir
charset belirtmek için Custom Headers sekmesinde `Content-Type` header'ını geçersiz kılın.
