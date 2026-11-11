# 🖨️ HIPOS Çoklu Termal Yazıcı ve Print Bridge v2 Kurulum Rehberi

Bu rehber, restoran veya kafenizdeki **Kasa**, **Mutfak (Yiyecek)** ve isteğe bağlı **Bar (İçecek)** yazıcılarını her şube için ayrı ayrı tanımlamanız, USB veya ağ (Ethernet/Wi-Fi) üzerinden bağlamanız ve bulut sunucudan yerel donanımlara kesintisiz fiş basmanız için hazırlanmıştır.

---

## 📌 Genel Mimari (Bulut + Şube İçi Print Bridge v2)

HIPOS yazıcı ayarlarını şubeye özel olarak PostgreSQL (`printing.printer_profiles`) veritabanında tutar. Bir işletmenin birden fazla şubesi varsa her şubenin yazıcı IP'leri, USB kuyruk adları ve teslimat modları birbirinden tamamen bağımsızdır.

1. **🍳 Mutfak Yazıcısı (`kitchen`)**:
   - Yiyecek kategorisindeki ürünleri **HIPOS MUTFAK** başlığıyla basar. Bar yazıcısı kapalıysa tüm sipariş tek fişte buraya gelir.
2. **🍸 Bar / İçecek Yazıcısı (`bar` — İsteğe Bağlı)**:
   - Etkinleştirildiğinde, `cat-drink` / `drink` istasyonuna bağlı içecek kalemlerini otomatik olarak ayrı bir **BAR / ICECEK** fişine yönlendirir; mutfak fişine yalnızca yiyecekler gider.
3. **🧾 Kasa / Adisyon Yazıcısı (`cashier`)**:
   - Müşteri ara hesap ve ödeme fişlerini basar (şubenin gerçek marka/şube adıyla); nakit tahsilatlarda para çekmecesini açar (`ESC/POS` drawer kick).

---

## 🚀 Şubede Sıfırdan Kurulum (Windows / macOS Kasa Bilgisayarı)

Bulut sunucu (`https://hipos.hayatisleri.com.tr`) restoranınızın yerel ağındaki yazıcı IP'lerine doğrudan erişemez. Bunun yerine şubedeki kasa bilgisayarına sıfır bağımlılıklı **Print Bridge** kurulur:

### 1. Adım: Ön Koşul (Yalnızca Node.js 18+)
- Kasa bilgisayarında **Node.js 18+** (önerilen LTS) kurulu olmalıdır (`node -v`).

### 2. Adım: Admin Panelden Tek Tıkla Kurulum Paketini İndirme
1. Yönetici panelinde **Şubeler ve Canlı Durum** sayfasını açın ve ilgili şubenin kartına tıklayın.
2. **Yazıcı Köprüsü (Print Bridge) Tokenı Üret** butonuna tıklayın (365 gün geçerli, yalnızca o şubenin yazıcı kuyruğuna sınırlı `role="bridge"` token üretilir).
3. Açılan kurulum kutusundan kasa bilgisayarında yeni bir klasöre şu iki dosyayı indirin:
   - **`hipos-bridge.config.json`** (Şube kimliği, API adresi ve şifreli token otomatik gömülüdür)
   - İşletim sisteminize göre başlatıcı:
     - Windows için **`HIPOS-Yazici-Koprusu.bat`**
     - macOS için **`HIPOS-Yazici-Koprusu.command`** (İlk çalıştırmadan önce Terminal'de `chmod +x HIPOS-Yazici-Koprusu.command` çalıştırın)

### 3. Adım: Köprüyü Başlatma
- İndirdiğiniz `.bat` veya `.command` dosyasına çift tıklayın.
- Betik ilk açılışta sunucudan (`/api/v1/printing/bridge-script`) güncel `hipos-print-bridge.mjs` istemcisini çeker, bilgisayardaki yerel/USB yazıcıları tarar ve SSE akışını açar:
  ```text
  [OK] Bağlantı aktif — {firmId}/{branchId} için SSE dinleniyor.
  ```
- Köprü bağlandığı anda Admin Paneli ve POS ekranlarındaki **Print Bridge** durumu **🟢 Çevrimiçi** olarak görünür ve bilgisayarınıza bağlı USB/sistem yazıcıları listede belirir.

---

## ⚙️ Yazıcıları Tanımlama ve Canlı Ayar Senkronizasyonu

Admin **Şubeler** ekranından veya POS (**Garson -> ⚙️ Yazıcı Ayarları** / **Kasa -> 🖨️ Yazıcılar**) modalından hedefleri kaydedin:

- **Teslimat Modu**:
  - **Otomatik (`Auto`, Önerilen)**: Print Bridge çevrimiçiyse işi anında SSE ile yerel köprüye yollar; yoksa doğrudan LAN IP'sine bağlanmayı dener.
  - **Bulut Köprüsü (`CloudBridge`)**: Her zaman bağlı Print Bridge'e yönlendirir.
  - **Doğrudan LAN (`DirectLan`)**: Yalnız yerel sunucu kurulumlarında API sunucusundan doğrudan TCP/USB basar.
- **Ağ Yazıcısı (Ethernet / Wi-Fi, Port 9100)**: Yazıcı Self-Test çıktısındaki yerel IP'yi (`192.168.1.201` vb.) girin.
- **USB / İşletim Sistemi Yazıcı Kuyruğu**:
  - Windows Denetim Masası veya macOS CUPS üzerinden ekli USB termal yazıcının adını girin (veya köprünün otomatik tespit ettiği yazıcılar listesinde görünenden seçin).
  - Yerel PC'deki USB kuyruk adlarını listelemek için terminalde `node scripts/hipos-print-bridge.mjs --list-printers` komutunu kullanabilirsiniz.
- **Kesintiye Karşı Yerel Kuyruk (Retry Spool) & Donanımsız Test (`--dry-run`) — Faz 12**:
  - Yazıcı kağıdı bittiğinde, fişi çekildiğinde veya geçici olarak ulaşılamadığında Print Bridge gelen fişi yerel kuyruk dosyasına (`--spool-file`, varsayılan `~/.hipos-print-spool.json` veya config dizini) yazar; yazıcı erişilebilir olduğunda sırayla otomatik basar ve kuyruğu temizler.
  - Fiziksel yazıcı olmadan fiş metnini ve RJ11 `[RJ11-CEKMECE-AC]` çekmece darbesini önizlemek için `--dry-run --preview-dir ./preview` bayraklarıyla çalıştırabilirsiniz (`node scripts/hipos-print-bridge.mjs --help`).
- **Canlı Güncelleme (`printer.config.updated`)**: Panelden yazıcı IP'si veya Bar seçeneği değiştirilip kaydedildiğinde, açık Print Bridge uygulaması yeniden başlatmaya gerek duymadan yeni hedefleri anında alır.

---

## ☀️ Yarın Sabah Saha Testi — 5 Dakikalık Hızlı Kontrol Listesi

1. **Ön Kontrol:** Kasa PC'de `node -v` (`>= 18`), yazıcı fiş kağıdı ve Ethernet/USB kablo bağlantısı takılı; RJ11 para çekmecesi doğrudan Kasa termal yazıcısının arkasındaki portta takılı; USB barkod okuyucu HID klavye modunda bağlanmış (sonuna `Enter` gönderir şekilde).
2. **Kurulum Dosyalarını İndirme:** `https://hipos.hayatisleri.com.tr/admin` → **Şubeler ve Canlı Durum** → ilgili şubede **Print Bridge Token Üret** → `hipos-bridge.config.json` + `.bat`/`.command` dosyalarını aynı klasöre kaydedin ve başlatın.
3. **Yazıcı & USB Tarama:** Köprü terminalinde `[OK] Bağlantı aktif` çıktısını görün; gerekirse `node hipos-print-bridge.mjs --list-printers` ile USB kuyruk adını doğrulayın ve yazıcı modalından kaydedin.
4. **Saha Sıra Testi:**
   - Garson tabletinde 1 yiyecek + 1 içecek girin → **Mutfak** (`HIPOS MUTFAK`) + **Bar** (`BAR / ICECEK`) fişi ayrı mı çıkıyor?
   - KDS ekranında `Hazır` deyin → Garson tabletinde **`HAZIR` toast** bildirimi belirdi mi?
   - Garsondan 1 kalemi `İptal` edin → Mutfakta üzeri çizili + **`IPTAL BILETI`** çıktı mı?
   - Kasa Hızlı Satış'ta **USB barkod** okutun → ürün sepete düşüyor mu; **`💵 Çekmece`** butonuna basınca çekmece açılıyor mu?
   - Vardiya kapatıp Z-Raporu penceresinde **`🖨️ Fiş Yazdır`** deyin → **`GUN SONU Z-RAPORU`** basılıyor mu?
5. **İsteğe Bağlı Restoran İçi LAN Hub (`compose.lan.yaml`):**
   - İnternet kesilse bile restoran içinde kesintisiz çalışmak için yerel sunucuda:
     ```bash
     HIPOS_CLOUD_SYNC_URL=https://hipos.hayatisleri.com.tr HIPOS_CLOUD_SYNC_TOKEN=<token> HIPOS_JWT_SECRET=<ortak-secret> docker compose -f compose.lan.yaml up -d --build
     ```
     komutuyla LAN Hub çalıştırılabilir (`sync.outbox` internet gelince otomatik buluta eşitler).

---

## 💡 KodPOS / Ethernet Yazıcı IP Adresini Öğrenme (Self-Test)
1. Yazıcının güç anahtarını kapatın (**OFF**).
2. Ön paneldeki **`FEED`** tuşuna basılı tutarken güç anahtarını açın (**ON**).
3. 3-4 saniye bekleyip bip sesi gelince bırakın; yazıcı kendi **IP Address** bilgisini kağıda basacaktır.

---

## 🛠️ Sorun Giderme (Troubleshooting)

- **"Print Bridge Bağlı Değil" uyarısı görünüyor:** Kasa PC'deki `.bat`/`.command` penceresinin açık olduğundan ve doğru şube klasöründeki `hipos-bridge.config.json` ile başlatıldığından emin olun.
- **Bulut sunucudan "IP Test Et" başarısız ama köprü çevrimiçi:** Bulut sunucu şubenin `192.168.x.x` iç ağına ping atamaz; köprü çevrimiçiyken **🧪 Test Fişi Gönder** butonunu kullanın — fiş Print Bridge üzerinden yerel ağdaki yazıcıya ulaşacaktır.
- **Yazıcı ayarları nerede saklanıyor?** Ayarlar şube bazlı olarak veritabanındaki `printing.printer_profiles` tablosunda saklanır; sunucu veya köprü yeniden başlasa da kaybolmaz.
