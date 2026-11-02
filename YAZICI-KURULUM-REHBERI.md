# 🖨️ HIPOS Termal Yazıcı Kurulum ve Entegrasyon Rehberi

Bu rehber, restoranda **Kasa** ve **Mutfak** yazıcılarının kurulması, test edilmesi ve canlıya alınması süreçlerini en kolay ve hatasız şekilde tamamlamanız için hazırlanmıştır.

---

## 📌 Genel Mimari Özeti

HIPOS, esnek ve modern restoran donanım mimarisine sahiptir:

1. **Kasa / Adisyon Yazıcısı (Mac / POS Terminali)**:
   - Kasa terminaline doğrudan **USB** veya **Ağ** (Ethernet) üzerinden bağlanır.
   - Müşteri ara hesap fişi, adisyon özeti basar ve nakit ödemelerde **para çekmecesini otomatik açar**.
2. **Mutfak Yazıcısı (Ağ / Ethernet / Windows)**:
   - Mutfak, ocak başı veya bar bölümünde konumlanır.
   - Doğrudan ağ kablosuyla (Ethernet) modeme/switch'e bağlıdır ve TCP Soket (Port 9100) üzerinden çalışır.
   - Garson masadan sipariş gönderdiğinde veya **Tekrar Bas** dediğinde anında mutfak fişi basar.
3. **Tek Cihaz Geliştirme & Test Modu**:
   - Kurulum öncesinde veya tek bir USB yazıcı olan işletmelerde, her iki fiş de tek bir USB yazıcı üzerinden simüle edilerek test edilebilir.

---

## 🚀 Canlı Restoranda 2. Yazıcıyı Takma (3 Adımda Hızlı Kurulum)

### 1. Adım: Donanım ve Kablolama
1. Mutfak yazıcısını (örneğin KodPOS / Gprinter 80mm) mutfaktaki uygun yerine yerleştirin.
2. Güç adaptörünü takın.
3. Yazıcının arkasındaki **LAN (Ethernet)** portuna standart bir ağ kablosu takıp diğer ucunu restoranın modemine veya ağ anahtarına (switch) bağlayın.
4. 80mm termal rulosunu hazneye yerleştirip kapağı kapatın.

---

### 2. Adım: Yazıcının IP Adresini Öğrenme (Self-Test Fişi)
KodPOS ve standart ESC/POS termal yazıcılar kendi IP adresini otomatik olarak fişe basabilir:
1. Yazıcının güç anahtarını kapatın (**OFF** konuma getirin).
2. Ön paneldeki **`FEED`** (Kağıt İlerletme) tuşuna **parmağınızı basılı tutun**.
3. FEED tuşunu bırakmadan güç anahtarını açın (**ON**).
4. 3-4 saniye bekleyin (yazıcıdan "bip" sesi gelip mekanizma harekete geçince) FEED tuşunu bırakın.
5. Yazıcı otomatik olarak bir **Sistem Bilgi Fişi** basacaktır.
6. Fişin altındaki **`IP Address:`** alanını okuyun (Örnek: `192.168.1.201`).

---

### 3. Adım: HIPOS Ekranından Tanımlama ve Anında Test
1. Garson ekranının sağ üstündeki **`⚙️ Yazıcı Ayarları`** butonuna tıklayın.
2. Pencerenin üstündeki **`🏢 Restoran Canlı Modu (2 Ayrı Cihaz)`** butonuna tıklayın.
3. **IP Adresi** alanına 2. adımda fişten okuduğunuz IP adresini (örn: `192.168.1.201`) yazın. Port olarak `9100` kalmalıdır.
4. **`🔍 IP Test Et (Hızlı Ping)`** butonuna tıklayın:
   - **🟢 Başarılı (`12 ms`)**: Yazıcı hatta, IP doğru ve haberleşme hazır demektir.
   - **🔴 Başarısız**: Kabloyu veya IP adresini kontrol edin (Bkz: Sorun Giderme).
5. **`🧪 Mutfak Test Fişi Gönder`** butonuna basın. Mutfak yazıcısından örnek test fişi çıkmalıdır.
6. **"Ayarları Kaydet"** butonuna basarak işlemi tamamlayın. Artık tüm garson siparişleri otomatik olarak bu yazıcıya düşecektir!

---

## 🔁 Mutfak Fişini Tekrar Basma (Reprint) Özelliği

Aşçının fişi kaybetmesi, üzerine su/yağ dökülmesi veya kağıt bitmesi durumlarında:
- Garson, ilgili masaya tıkladığında ekranda iki farklı noktadan tekrar basım yapabilir:
  1. Masa üst buton çubuğundaki **`🔁 Mutfak Fişi Tekrar`** butonu.
  2. Mutfak sipariş dökümü başlığındaki **`🖨️ Mutfak Fişini Tekrar Bas`** butonu.
- Tekrar basılan fişte çift boyut ve kalın font ile:
  ```text
  ********************************
        *** TEKRAR BASIM ***
  ================================
            HIPOS MUTFAK
        SIPARIS BILETI (KOPYA)
  ================================
  Masa: Masa 01
  Garson: Ayşe Demir
  ...
  ```
  ibaresi basılır. Böylece mutfak personeli siparişi mükerrer (iki kez) hazırlamaz.

---

## 🛠️ Sorun Giderme (Troubleshooting)

### Soru 1: "🔍 IP Test Et" dediğimde "Zaman aşımı / Ulaşılamadı" hatası alıyorum.
- **Kablo Kontrolü**: Yazıcının arkasındaki ağ portunun sarı/yeşil LED'leri yanıp sönüyor mu? Sönüyorsa kabloyu veya switch portunu kontrol edin.
- **Aynı Ağda Olma**: POS bilgisayarı veya tablet ile yazıcı **aynı yerel ağda** olmalıdır. Örneğin POS `192.168.1.100` alıyorsa, yazıcı da `192.168.1.xxx` havuzunda olmalıdır. Farklı bir misafir Wi-Fi ağına bağlı olmadığınızdan emin olun.

### Soru 2: Yazıcı Self-Test fişinde `192.168.123.100` gibi farklı bir IP yazıyor.
- Bazı üreticiler fabrika çıkışında sabit `192.168.123.100` IP'si tanımlar.
- Modemin dağıttığı havuz `192.168.1.x` ise yazıcının IP'sini modemin havuzuna taşımak gerekir:
  1. Bilgisayarınızın Ethernet ayarlarından geçici olarak sabit IP verin (`192.168.123.50`, Ağ maskesi: `255.255.255.0`).
  2. Tarayıcıdan `http://192.168.123.100` adresine girin (Kullanıcı: `admin`, Şifre: `admin` veya boş).
  3. Network sekmesinden IP adresini restoranın IP bloğuna uygun boş bir IP'ye (örneğin `192.168.1.201`) ayarlayıp kaydedin.
  4. Bilgisayarınızı tekrar eski otomatik IP moduna döndürün.

### Soru 3: Mutfakta hazırda bir Windows PC var ve yazıcı ona USB ile bağlı. Ağ kablosu çekmeden kullanabilir miyiz?
- Evet! Windows PC üzerinde yazıcıyı paylaşıma açabilir veya küçük bir RAW TCP proxy (Port 9100 dinleyip USB'ye yönlendiren basit bir servis) çalıştırarak Windows PC'nin IP adresini HIPOS Mutfak IP alanına girebilirsiniz.

### Soru 4: Yazıcı ayarları nerede saklanıyor?
- Ayarlar sunucu tarafında `printer_settings.json` dosyasında güvenle saklanır. Uygulama veya sunucu yeniden başlatılsa bile IP ve port ayarları korunur.
