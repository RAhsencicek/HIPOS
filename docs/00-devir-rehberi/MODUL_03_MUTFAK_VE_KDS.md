# Modül 3 Devir Şartnamesi — Mutfak (KDS) & Servis Kuyruğu (A'dan Z'ye)

> **Doküman Durumu:** Kesinleşmiş Modül Devir ve Uygulama Şartnamesi · Sürüm: v3.1
> **Kapsam:** KDS Ekranı, Durum Makinesi, Gecikme Alarmları, İstasyon Filtreleme ve ESC/POS Termal Fiş Basımı
> **Modül Durumu:** Kalıcı KDS çekirdeği, Print Bridge v2 (TCP/USB/Spool) ve Garson `HAZIR` + Satış İptali bağlantısı çalışıyor · Fiziki yazıcılarla saha testi ve çok şubeli dinamik istasyon editörü sıradadır
> **PostgreSQL Şeması:** `kitchen` (`tasks`, `task_audit`, `stations`, `station_categories`) ve `printing` (`printer_profiles`)
> **Yönetim Paneli / POS Ekranı:** Aktif (`apps/pos` `/kitchen` ikiye bölünmüş görünüm, servise hazır, iptal geçmişi, Print Bridge/sync durum rozeti)
> **API:** Var (görev listesi, sürüm kontrollü durum güncelleme, SSE `kitchen.updated`, `PrintingService` & `SyncService`)
> **Test:** `postgres.test.mjs`, `test_faz10_security_multitenant.mjs`, `test_faz11_multiprinter_bridge.mjs`, `test_faz12_13_hardware_sync.mjs`
> **Üretime Hazır mı?:** Yazılım & simülasyon doğrulandı (`hipos.hayatisleri.com.tr`); şubedeki fiziki termal yazıcılarla saha kabulü yapılacaktır
<!-- 23 Ekim 2026: Üst durum özetindeki eksik bilgi mevcut KDS uygulamasına göre eklendi; üretim engelleri silinmeden korundu. -->
> **Dokümantasyon Hiyerarşisi:**
> * **Güncel kod durumu için:** [docs/01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md](../01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md)
> * **Güncel teslim ve yol haritası için:** [docs/00-devir-rehberi/DURUM_VE_YOL_HARITASI.md](DURUM_VE_YOL_HARITASI.md)
> * **Devir ve onboarding için:** [docs/00-devir-rehberi/DEVIR_REHBERI.md](DEVIR_REHBERI.md)
> * **Tarihsel kararlar için:** [docs/05-gecmis-ve-arsiv/](../05-gecmis-ve-arsiv/)
>
> **Sıra Notu:** Bu şartnamedeki modül içi adımlar ve hedefler modül backlog'unu ayrıntılandırır. Repo genelindeki güncel teslim sırası yalnız [Durum ve Yol Haritası](DURUM_VE_YOL_HARITASI.md) belgesindedir; bu backlog gelecekteki kapsamı daraltmaz.

---

### Ayrı mutfak görevi kararı — 22 Ekim 2026

- Hazırlık bilgisi satış satırını değiştirerek değil, `kitchen.tasks` içinde sipariş kalemine bağlı ayrı görevle tutulacaktır. Ayrıntılı mutfak kılavuzundaki görev modeli esastır.
- Adisyon müşterinin toplam hesabıdır; aynı adisyona sonradan eklenen her sipariş kendi ürün satırları için yeni görevler oluşturur. Tamamlanmış görevler yeniden açılmaz.
- Her görev bir sipariş kalemine bağlıdır; örneğin aynı kalemdeki 2 pizza, miktarı 2 olan tek görevdir. Kısmi miktar hazırlama bu adımın kapsamı değildir.
- Hazırlık sırası `submitted` (Bekliyor) → `preparing` (Hazırlanıyor) → `ready` (Hazır) → `served` (Servis edildi). Hazır görev aktif hazırlık kuyruğundan ayrı “Servise hazır” bölümüne geçer; servis edilen görev son işlemler bölümünde görünür ve geçmişten silinmez.
- Süre adisyonun açılışından değil, ilgili görevin sunucu tarafından kaydedilen başlangıcından hesaplanır. Saat 19.00'da servis edilen pizzanın ardından 20.00'de gelen içeceğin süresi 20.00'de başlar.
- Görevler firma/şube kapsamı taşır. Mevcut satış kalemi kimliği `long` olduğu için görev bağlantısı da `bigint` olmalıdır; satış kimlikleri değiştirilmez.
- Kalıcı entegrasyon adımında aynı sipariş kaleminden ikinci görev oluşması benzersizlikle engellenmeli; durum yazmaları sürüm, tekil istek ve denetim kaydıyla korunmalıdır.
- Yerel ağ ve merkezi eşitleme ayrıntıları daha sonra netleştirilecektir; bu çalışma offline/sync uygulamaz.
- İş modeli, PostgreSQL kalıcılığı, siparişten görev üretimi, liste/durum API'si ve ekran bağlantısı uygulanmıştır. İptal/gerekçe/onay akışı satış modülüyle birlikte sonraki entegrasyonda ele alınacaktır.
- Sipariş kalemi notu için uçtan uca veri altyapısı hazırdır: satış isteği isteğe bağlı `notes` kabul eder, notu satış satırında ve mutfak görevinde saklar, mutfak API'sinde döndürür ve 80 mm fişin Not sütununda gösterir. Garson ekranındaki not giriş alanı henüz bağlı değildir.
- İstasyon modeli ve bölünmüş KDS görünümü: `kitchen.stations` ve `kitchen.station_categories` operasyonel sadeleştirme ile 2 istasyona düşürülmüştür: **Yiyecek** (`food` - pizza, sandwich, dessert) ve **İçecek** (`drink` - drinks). KDS ekranı çift sütunlu bölünmüş görünümde sol tarafta yiyecek siparişlerini, sağ tarafta içecek siparişlerini canlı ve eşzamanlı gösterir; istasyon filtreleri ile tek istasyona da odaklanılabilir. Eşleşmeyen ürün görevleri silinmez ve `Atanmamış` filtresinde/bölümünde kalır. Demo kategori eşleştirmeleri migration ile kurulur; yönetim ekranından istasyon/eşleştirme düzenleme sonraki kapsamdır.
- Sipariş bazlı bilet gruplama: Aynı adisyona aynı sipariş kodu (`order_id`) ile gönderilen birden çok ürün satırı, mutfak ekranında aynı istasyon tarafında tek bir sipariş bilet kartında toplanır (örneğin pizza ve cheesecake yiyecek tarafında tek kartta; filtre kahve ve limonata içecek tarafında tek kartta satır satır gösterilir). Bilet üzerindeki durum butonları (`Hazırlamaya başla` / `Hazır` / `Servis edildi`) biletteki tüm aktif kalemleri toplu ve eşzamanlı günceller.
- İptalin mutfak tarafındaki veri temeli hazırlanmıştır: görev `cancelled` durumunu, iptal zamanı, gerekçe ve aktörü saklar; KDS iptal edilen görevi kırmızı ve üzeri çizili geçmişte gösterebilir. İptal komutunun sahibi satış/adisyon modülüdür. Satış kalemi iptal endpoint'i ve müdür onayı henüz bulunmadığı için mutfak doğrudan iptal başlatmaz; gerçek bağlantı ortak entegrasyonda yapılacaktır.

### 📌 Hızlı Gerçeklik Özeti
* **Bugün Kodda Gerçekten Çalışanlar (Mevcut Durum — Faz 10–13):**
  - `/kitchen` ekranı (`OperationalApps.tsx`) SSE (`GET /events/stream`) + 3 saniyelik güvenli fallback ile `kitchen.tasks` görevlerini anlık listeler; PIN girişi ve `auth` şeması aktiftir.
  - Garsonun girdiği her sipariş kalemi ayrı görev olur; aynı adisyona sonradan gelen sipariş kendi süresini başlatır.
  - Dokunmatik `Bekliyor → Hazırlanıyor → Hazır → Servis edildi` geçişleri, sürüm kontrolü ve audit kaydı çalışır; görev `HAZIR` olunca `kitchen.updated` SSE olayı Garson tabletinde anlık toast bildirimi tetikler.
  - İkiye bölünmüş ekran görünümü (sol: Yiyecek, sağ: İçecek), Yiyecek (`food`), İçecek (`drink`) ve Atanmamış filtreleri çalışır; gecikme süresi ve renkleri gösterilir.
  - Satış kalemi iptali (`adjustments` `void`) ve tam adisyon iptali (`POST /sales/checks/{id}/cancel`) bağlı `kitchen.tasks` kayıtlarını otomatik `cancelled` yapar ve Mutfak/Bar yazıcılarına ESC/POS `IPTAL BILETI` gönderir.
  - `PrintingService` + Print Bridge v2 (`scripts/hipos-print-bridge.mjs`), şube bazlı TCP 9100 / USB termal fiş basımı, Yiyecek/Bar ayrıştırması, kapalı yazıcıda disk retry spool ve `--dry-run` önizleme destekler; `/kitchen` başlığında hibrit sync rozeti görünür.
* **Henüz Kodlanmamış / Sırada (Backlog):**
  - Admin panelinden özel istasyon/kategori eşleştirme CRUD ekranı (2 sabit istasyon: Yiyecek `food` + İçecek `drink` çalışır)
  - Garsonun `HAZIR` bildirimini "Teslim alındı" butonuyla susturma/izleme kaydı (servis edildi aksiyonu mevcuttur)
  - Sahadaki fiziksel Mutfak/Bar/Kasa termal yazıcılarıyla canlı baskı kabulü (yalnızca simülatör ve `--dry-run` doğrulandı)

---

## 🎯 1. Modülün Amacı Nedir?

Bu modülün amacı; salondaki garsonların veya kasadaki personelin girdiği yemek siparişlerinin mutfaktaki aşçılara anında **dokunmatik KDS (Kitchen Display System) tablet ekranında** iletilmesini, siparişlerin istasyonlara (Sıcak Mutfak, Fırın, Bar) göre ayrışmasını, sipariş durumlarının (Bekliyor -> Hazırlanıyor -> Hazır) yönetilmesini, geciken siparişlerde renkli alarmlar verilmesini ve ağdaki termal yazıcıya (ESC/POS) otomatik mutfak fişi basılmasını sağlamaktır.

Kısacası: **Restoranın mutfak operasyonunun ve aşçı-garson iletişiminin dijital omurgasıdır.**

---

## 📂 2. Hangi Dosyalar ve Kod Bloklarıyla Çalışacaksın?

Sizin çalışma alanınız temel olarak şuralardır (ilgili kod satırına gitmek için linklere tıklayabilirsiniz):

1. **Ön Yüz (Frontend):**
   * [OperationalApps.tsx:L38-L120](../../apps/pos/src/OperationalApps.tsx#L38-L120) — Aşçıların siparişleri gördüğü `/kitchen` dokunmatik arayüzü.
   * [operational.css:L1-L60](../../apps/pos/src/operational.css#L1-L60) — Mutfak ekranının dokunmatik kart stilleri ve renk temaları.
2. **Backend (.NET API):**
   * [SalesDbContext.cs:L6-L56](../../apps/api/Hipos.Api/Sales/SalesDbContext.cs#L6-L56) — Siparişler (`SalesOrderRow`) ve Sipariş Kalemleri (`SalesOrderLineRow`).
   * Yeni Servis: `apps/api/Hipos.Api/Kitchen/` — Mutfak durum makinesi ve yazıcı kuyruk yöneticisi.
3. **Mevcut Testler:**
   * [postgres.test.mjs:L2050-L2100](../../apps/api/Hipos.Api.Tests/postgres.test.mjs#L2050-L2100) — Sipariş kabul testleri.

---

## ✅ 3. Şu An Neler Zaten Hazır? (Neyi Baştan Yazmayacaksın?)

* Garson ekranından girilen siparişler PostgreSQL `sales.orders` tablosuna kaydedilmektedir.
* `/kitchen` ekranı 3 saniyede bir polling yaparak açık siparişleri listeleyebilmektedir.
* Adisyon bölme, sipariş ilk gönderildiğindeki mutfak kalem/miktar anlık görüntüsünü değiştirmez ve mutfağa yeni bilet oluşturmaz; bölünmüş siparişler yeni hazırlık işi olarak gösterilmez.

---

## 🖥️ 4. Ekran Ekran Detaylı Davranış ve Özellikler

### 📱 EKRAN 1: Dokunmatik Mutfak KDS Ekranı (Mevcut Polling Ekranı: `OperationalApps.tsx` `/kitchen` — Butonlar ve Sayaçlar Geliştirilecek)
* **İstasyon Filtreleme Sekmeleri (Üst Çubuk - Geliştirilecek):**
  * `[ Tüm Siparişler ]` · `[ 🍳 Sıcak Mutfak ]` · `[ 🍕 Taş Fırın ]` · `[ 🍹 Bar / İçecek ]` · `[ 🥗 Soğuk / Meze ]`.
  * Aşçı sadece kendi bölümüne ait yemekleri görür (Örn: Fırıncı sadece Lahmacun ve Pideleri görür).
* **Dokunmatik Sipariş Bilet Kartları:**
  * **Kart Başlığı:** Masa Numarası (`Masa 4`), Garson Adı (`Ahmet Y.`), Sipariş Başlangıç Saati (`14:25`) ve Geçen Süre Sayacı (`⏱️ 12 dk`).
  * **Sipariş Kalemleri:** Ürün Adı, Porsiyon Adedi ve Özel Notlar (Örn: `2x Margherita Pizza - Not: Az pişmiş olsun`, `1x Kola`).
  * **Gecikme Renk Sayaçları (Geliştirilecek):**
    * 0 - 10 dakika: 🟢 **Yeşil Kart** (Süre normal).
    * 10 - 20 dakika: 🟡 **Sarı Kart** (Gecikme uyarısı).
    * 20+ dakika: 🔴 **Kırmızı Yanıp Sönen Alarm Kartı** (Acil servis uyarısı).
  * **Dokunmatik Durum Butonları (Kart Altı - Geliştirilecek):**
    * 1. Adım: `[ Hazırlanıyor ⏱️ ]` -> Aşçı siparişi tezgaha aldığında tıklar; garson ekranında *"Yemeğiniz hazırlanıyor"* rozeti çıkar.
    * 2. Adım: `[ Hazır / Servise Çıkar 🔔 ]` -> Yemek bittiğinde tıklar; garson terminaline bildirim gider ve kart mutfak ekranından arşive kaldırılır.

### 🖨️ EKRAN 2: Otomatik Termal Bilet Fişi Basımı (ESC/POS 9100) (Hedef Donanım Servisi — Geliştirilecek)
* Garson masada siparişi onayladığı saniyede:
  * Ağdaki termal fiş yazıcısına (TCP port 9100) raw ESC/POS komutu gönderilir.
  * Mutfak bilet fişi otomatik basılır ve kağıt giyotinle kesilir:
    ```
    ========================================
             MUTFAK SİPARİŞ BİLETİ
    Masa: 4          Garson: Ahmet Yılmaz
    Saat: 14:25      Sipariş No: #ORD-88421
    ----------------------------------------
    [ 2 ] Margherita Pizza
          >> NOT: Az pişmiş olsun
    [ 1 ] Penne Arrabbiata
          >> NOT: Ekstra acılı
    ========================================
    ```

---

## 🚀 5. Senden Ne Bekleniyor? (Adım Adım Yol Haritası)

```mermaid
graph TD
    A[1. Adım: Mutfak Kalem Durum API'si] --> B[2. Adım: Dokunmatik KDS Butonları ve Renk Alarmları]
    B --> C[3. Adım: İstasyon Bazlı Kategori Filtreleme]
    C --> D[4. Adım: Ağ Yazıcısı ESC/POS 9100 Servisi]
```

1. **1. Adım: Mutfak Durum Güncelleme API'si:**
   * `POST /api/v1/firms/{f}/branches/{b}/kitchen/tasks/{taskId}/status`
   * Durumlar: `submitted` -> `preparing` -> `ready` -> `served`.
2. **2. Adım: KDS Arayüzü Geliştirmesi:**
   * `/kitchen` ekranına dokunmatik büyük butonlar ve geçen süre sayaçları ekleme.
3. **3. Adım: İstasyon Filtreleme:**
   * Ürün kategorisine göre istasyon eşleşmesi (`Fırın`, `Bar`, `Sıcak Mutfak`).
4. **4. Adım: Şubeye Özel ESC/POS Çoklu Yazıcı ve Print Bridge Entegrasyonu (`PrintingDbContext`, `PrintingService`, `BridgePresenceRegistry`):**
   * Şubeye özel Kasa (`cashier`), Mutfak (`kitchen`) ve opsiyonel Bar / İçecek (`bar`) hedefleri PostgreSQL `printing.printer_profiles` tablosunda saklanır (`GET/POST /api/v1/firms/{f}/branches/{b}/printing/config`).
   * `BarPrinter.Enabled` açık ve `AutoSplitKitchenByStation=true` iken `CatalogDbContext.Products` + `KitchenDbContext.StationCategories` eşleşmesiyle içecek kalemleri `target="bar"` (`BAR / ICECEK`), yemek kalemleri `target="kitchen"` (`HIPOS MUTFAK`) fişlerine otomatik ayrıştırılır.
   * Yerel ağdaki Windows/macOS kasalara kurulan `scripts/hipos-print-bridge.mjs` (`GET /api/v1/printing/bridge-script`, `POST /printing/bridge-token`) SSE (`print.job` ve canlı ayar yenilemesi `printer.config.updated`) + heartbeat (`POST /printing/bridge-heartbeat`, `GET /printing/bridge-status`) üzerinden hem TCP 9100 ağ yazıcılarına hem de OS USB ham yazıcı kuyruklarına basar.

---

## 💾 6. Veritabanı ve Şema Modelleri

```sql
-- Mutfak İstasyonları
CREATE TABLE kitchen.stations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id VARCHAR(64) NOT NULL,
    branch_id VARCHAR(64) NOT NULL,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(50) NOT NULL,            -- "Mutfak", "Bar / İçecek"
    is_active BOOLEAN NOT NULL DEFAULT true
);

-- Şube Bazlı Yazıcı Profili (PrintingDbContext)
CREATE TABLE printing.printer_profiles (
    firm_id VARCHAR(64) NOT NULL,
    branch_id VARCHAR(64) NOT NULL,
    delivery_mode VARCHAR(32) NOT NULL DEFAULT 'Auto', -- Auto | CloudBridge | DirectLan
    cashier_printer_json JSONB NOT NULL,
    kitchen_printer_json JSONB NOT NULL,
    bar_printer_json JSONB NOT NULL,
    auto_print_kitchen_on_order BOOLEAN NOT NULL DEFAULT true,
    auto_split_kitchen_by_station BOOLEAN NOT NULL DEFAULT true,
    version INT NOT NULL DEFAULT 1,
    updated_by VARCHAR(120) NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (firm_id, branch_id)
);

-- Hazırlık durumu sales.order_lines'a eklenmez.
-- Ayrı kitchen.tasks modeli ve istasyon bağları için MUTFAK_KDS_VE_YAZICI.md esas alınır.
```

---

## ✅ 7. Kabul Kriterleri (Devir Doğrulama Testi)

1. Aşçı ekranda `[ Hazır ]` butonuna bastığında sipariş kartı KDS ekranından kaybolmalı ve garson ekranında masanın üzerinde *"Yemek Hazır"* bildirimi çıkmalıdır.
2. 20 dakikayı geçen sipariş kartları kırmızı renkle yanıp sönerek dikkat çekmelidir.
3. Ağ yazıcısına sipariş bilet komutu gönderildiğinde yazıcıdan fiş hatasız dökülmelidir.
4. `npm test` ve `npm run test:api` testleri hatasız geçmelidir.

---

## 📖 8. Ayrıntılı Referans Belgeleri

* 📘 **Mutfak Ekranı (KDS) ve Yazıcı Kılavuzu:** 👉 [MUTFAK_KDS_VE_YAZICI.md](../02-kasa-ve-operasyon/MUTFAK_KDS_VE_YAZICI.md)
* 🏛️ **Backend Mimarisi ve Şemalar:** 👉 [BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md](../01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md)
