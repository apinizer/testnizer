---
title: Sürümleri doğrulama
description: SHA-256 sağlama toplamlarını kullanarak indirilen Testnizer yükleyicilerinin bütünlüğünü nasıl doğrulayacağınız.
order: 1
section: Referans
---

[github.com/apinizer/testnizer](https://github.com/apinizer/testnizer/releases)
adresinde yayımlanan her sürüm, her artifact için SHA-256 sağlama toplamları içerir.
Bunları doğrulamak, indirdiğiniz dosyanın sağlam ulaştığını ve aktarım sırasında
tahrif edilmediğini teyit eder.

## Sağlama toplamları nerede bulunur

Her sürüm sayfası, yükleyicilerin yanında bir `checksums.txt` dosyası listeler.
Her artifact için bir satır içerir:

```
a3f8…  Testnizer-1.4.10-arm64.dmg
c91b…  Testnizer-1.4.10-x64.dmg
e54a…  Testnizer-1.4.10-x64.exe
2d77…  Testnizer-1.4.10-amd64.deb
…
```

(Her artifact için bir `sha256  dosyaadı` satırı — standart `sha256sum` formatı.)

## macOS / Linux'ta doğrulama

```sh
shasum -a 256 Testnizer-1.4.10-arm64.dmg
```

Çıktı karmasını `checksums.txt`'deki eşleşen satırla karşılaştırın. Tam olarak
eşleşmeleri gerekir. İndirdiğin tüm dosyaları tek seferde kontrol etmek için
indirme klasöründe `shasum -a 256 -c checksums.txt` çalıştır.

## Windows'ta doğrulama (PowerShell)

```powershell
Get-FileHash .\Testnizer-1.4.10-x64.exe -Algorithm SHA256
```

`Hash` alanını `checksums.txt` ile karşılaştırın.

## Hava boşluklu kurulum

Tamamen yalıtılmış ağlar için:

1. İnternet erişimi olan bir makinede
   [en son sürümü](https://github.com/apinizer/testnizer/releases/latest)
   açın ve platformunuza uygun yükleyiciyi ve `checksums.txt`'yi indirin
2. SHA-256'yı yukarıdaki gibi doğrulayın
3. Yükleyiciyi USB / SFTP / hava boşluğu geçidini kullanarak yalıtılmış makineye aktarın
4. Normal şekilde yükleyin

Kurulumdan sonra yalıtılmış makinede otomatik güncelleme kontrolünü devre dışı
bırakın: **Ayarlar → Güncellemeler → Otomatik güncelleme kontrolü → kapalı**.

## Sürüm bütünlüğü

Sürümler, yalıtılmış işletim sistemi başına çalıştırıcılarda GitHub Actions
tarafından derlenir. İş akışı günlükleri ve artifact yükleme adımları
[github.com/apinizer/testnizer](https://github.com/apinizer/testnizer/actions)
adresinde kamuya açık olarak görüntülenebilir; böylece her artifact'ı onu üreten
tam derleme çalışmasına kadar izleyebilirsiniz.

## Sorun bildirme

[github.com/apinizer/testnizer/issues](https://github.com/apinizer/testnizer/issues)
adresinde bir sorun açın.

Güvenlik sorunları — herkese açık sorun açmak yerine GitHub'ın özel
güvenlik bildirim kanalını kullanın
([Güvenlik açığını özel olarak bildir](https://github.com/apinizer/testnizer/security/advisories/new)).
