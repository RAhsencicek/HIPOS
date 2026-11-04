# HIPOS — Mevcut Durum ve Modüler Yol Haritası

> **Doküman Durumu:** Canlı Yol Haritası · Sürüm: v2.5 (21 Ekim 2026)
>
> **Dokümantasyon Hiyerarşisi:**
> * **Güncel kod durumu için:** [docs/01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md](../01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md)
> * **Güncel teslim ve yol haritası için:** [docs/00-devir-rehberi/DURUM_VE_YOL_HARITASI.md](DURUM_VE_YOL_HARITASI.md)
> * **Devir ve onboarding için:** [docs/00-devir-rehberi/DEVIR_REHBERI.md](DEVIR_REHBERI.md)
> * **Tarihsel kararlar için:** [docs/05-gecmis-ve-arsiv/](../05-gecmis-ve-arsiv/)

---

## 1. Ürün Hedefi ve Çalışma Kapsamı

HIPOS; gerçek bir restoranın yönetim (ERP), mutfak (KDS), salon servis (Waiter) ve kasa (POS) operasyonlarını **tek bir işletme ve veri omurgasında** birleştirmeyi hedefler.

> Bu maddeler ürün hedefidir; çalışan özelliklerin listesi değildir. Kalıcı MVP dilimleri ve henüz eksik olan gerçek POS/ödeme, Auth, KDS ve çevrimdışı senkronizasyon durumu aşağıdaki modül matrisinde ayrılmıştır.

* **Yönetim Paneli (`apps/admin`):** Ürün, menü, fiyat, personel, masa, hammadde, reçete, stok, cari ve giderleri yönetir.
* **Kasa ve Hızlı Satış (`apps/pos`):** Kasiyerlerin PIN ile girdiği, adisyon tahsil ettiği (nakit, kredi kartı banka seçimi, yemek kartı, cari), kasa avansı eklediği ve gün sonu Z-Raporu aldığı dokunmatik ekrandır.
* **Salon Servis Ekranı (`apps/pos/src/OperationalApps.tsx` - `/waiter`):** Garsonun masaları görüp sipariş aldığı el terminalidir.
* **Mutfak Ekranı (`apps/pos/src/OperationalApps.tsx` - `/kitchen`):** Aşçıların siparişleri istasyon bazlı gördüğü ve hazırlık durumunu yönettiği ekrandır.
* **Çevrimdışı Çalışma (LAN Hub):** Restoranın interneti kopsa bile yerel ağdaki Mini PC üzerinden operasyonun saniyesi saniyesine kesintisiz devam etmesi, internet geldiğinde buluta eşitlenmesidir.

---

## 2. MODÜL MODÜL MEVCUT DURUM VE YAPILACAKLAR (İş Alanları)

Bu bölüm, her bir fonksiyonel modülde **şu an kodda neyin gerçekten çalıştığını**, **neyin henüz eksik olduğunu** ve **modül backlog'unu** özetler. Tek güncel teslim sırası Bölüm 5'tedir; modül backlog maddeleri tüm gelecek kapsamı korur, ayrı bir öncelik sırası tanımlamaz.

Mevcut kalıcı MVP dilimleri katalog/menü, cari, stok-reçete-sayım, manuel kasa, gider kaydı ve ortak adisyon/sipariş çekirdeğidir. `apps/pos` test ekranı ve ödeme simülatörü geliştirme araçlarıdır; gerçek POS veya gerçek ödeme anlamına gelmez.

---

### [Modül 1] Kasa & Hızlı Satış Modülü (Cashier / POS)

| Kriter | Detay |
|---|---|
| **Veritabanı Şeması** | `cash` şeması (`cash.registers`, `cash.shifts`, `cash.movements`, `cash.audit`) |
| **İlgili EF Core Context** | [CashDbContext.cs:L6-L65](../../apps/api/Hipos.Api/Cash/CashDbContext.cs#L6-L65) |
| **Ön Yüz Ekranı** | [CashManagementPage.tsx:L7-L60](../../apps/admin/src/features/cash/CashManagementPage.tsx#L7-L60) |
| **Kılavuz Doküman** | 👉 [Modül 1 Şartnamesi](MODUL_01_KASA_VE_POS.md) · [Kasa ve POS Operasyon Sözleşmesi](../02-kasa-ve-operasyon/KASA_POS_VE_OPERASYON_SOZLESMESI.md) · [Kasa Test Kılavuzu](../04-test-ve-rehberler/KASA_MANUEL_TEST.md) |

* **Şu An Ne Yapılmış? (Mevcut Durum):**
  - Tek bir kasa için manuel vardiya açma/kapatma ve elle nakit giriş/çıkış defteri PostgreSQL API'sine tam bağlıdır.
  - İdempotent `MAIN` kasa provisioning mekanizması ve hareket düzeltme (reversal) zinciri mevcuttur.
  - Adisyon ödemeleri (parçalı nakit/kart ve masa hesap kapatmaları) aktif kasa vardiyasına `pos_sale` hareketi olarak otomatik yansıtılır ve nakit çekmece bakiyesi senkronize edilir.
  - Kasiyer ve Garson ekranlarında adisyon indirimleri, ürün ikramları ve kalem iptallerinde müdür/yetkili PIN kodu (`auth.pin_codes` - role: `owner` veya `manager`) doğrulaması ve `sales.check_audit` / `sales.check_adjustments` izlenebilirliği tamamlanmıştır.
  - Gün Sonu Z-Raporu ve gün içi X-Raporu altyapısı (`GET /cash/shifts/{id}/z-report`) geliştirilmiştir. Ciro özeti (brüt/net/indirim/ikram), ödeme kanalları dağılımı (nakit/kart/cari vb.), KDV dağılımı (%10 matrah ve vergi), kasa çekmecesi mutabakatı, kupür sayım dökümü (`cash.shifts.denominations`), kasa farkı, yarına devreden bozuk para avansı (`retained_float_minor`) ve patrona/çelik kasaya teslim edilen net hasılat tutanağı (Safe Drop - `dropped_revenue_minor`) hem POS Kasiyer ekranında hem de Yönetim Paneli Kasa Özeti ekranında termal fiş formatında tam entegredir. Açık adisyon varken vardiya kapatma kilidi sunucu ve arayüzde zorunludur.
  - Hızlı Satış / Tezgâh ekranında sipariş askıya alma (Park Order / Bekletme), bekleyen tezgâh ve paket satışları paneli (etiket, bekleme süresi, ürün özeti, tek tıkla `[ ⚡ Tahsil Et ]`), ödeme ekranından `[ ⏸️ Beklet & Menüye Dön ]` ve vazgeçilen tezgâh siparişlerini yönetici onayıyla iptal etme (`POST /sales/checks/{id}/cancel`) tamamlanmıştır. Salondaki masa adisyonlarıyla tezgâh satışları tamamen izole edilmiştir.
* **Ne Eksik? (Henüz Yapılmamış Olanlar):**
  - Çoklu kasa (Ana Kasa, Bar vb.) ve kasiyer PIN ile kasa seçimi yoktur.
  - Açılış notu vardiyada saklanır; hesap fişi tarayıcı üzerinden mali olmayan çıktı olarak yazdırılır. Tam simüle tahsilat sonrasında yazdırma penceresi açılır; gerçek ÖKC ve otomatik donanım baskısı yoktur.
* **Modül backlog'u (teslim sırası için §5'e bakın):**
  1. `sales.check_payments` tablosunun eklenmesi ve parçalı ödeme tiplerinin desteklenmesi. (Tamamlandı)
  2. Adisyon kapatıldığında nakit tutarın otomatik `cash.movements`'a işlenmesi. (Tamamlandı)
  3. Kasiyerlerin 4 haneli PIN ile istasyon/kasa seçerek oturum açması.
  4. Gün sonu açık masa kilit denetimi, kupür sayımı ve Z-Raporu dökümü. (Tamamlandı)

---

### [Modül 2] Masa Servisi ve Ortak Adisyon Modülü (Service & Checks)

| Kriter | Detay |
|---|---|
| **Veritabanı Şeması** | `service` ve `sales` şemaları (`service.tables`, `service.employees`, `sales.checks`, `sales.orders`) |
| **İlgili EF Core Context** | [ServiceDbContext.cs:L6-L30](../../apps/api/Hipos.Api/Service/ServiceDbContext.cs#L6-L30), [SalesDbContext.cs:L6-L56](../../apps/api/Hipos.Api/Sales/SalesDbContext.cs#L6-L56) |
| **Ön Yüz Ekranı** | [ServiceTablesPage.tsx:L1-L60](../../apps/admin/src/features/branches/ServiceTablesPage.tsx#L1-L60), [OperationalApps.tsx:L38-L120](../../apps/pos/src/OperationalApps.tsx#L38-L120) (`/waiter`) |
| **Kılavuz Doküman** | 👉 [Modül 2 Şartnamesi](MODUL_02_MASA_VE_ADISYON.md) · [Adisyon, Sipariş ve Masa Yaşam Döngüsü](../02-kasa-ve-operasyon/ADISYON_VE_MASA_YASAM_DONGUSU.md) · [Ortak Adisyon](../02-kasa-ve-operasyon/ORTAK_ADISYON_SOZLESMESI.md) |

* **Şu An Ne Yapılmış? (Mevcut Durum):**
  - 24 masa, garson çalışanları ve açık masa-adisyon bağlantıları PostgreSQL'e bağlıdır.
  - Garson ekranından (`/waiter`) masaya sipariş girildiğinde ortak adisyon oluşturulmakta ve kalemler API'ye yazılmaktadır.
  - Development simüle tahsilatında bakiye tamamlandığında adisyon kapatılır; masada veya fiziksel grupta başka açık adisyon varsa masa korunur. Son açık adisyon kapandığında Service tarafı aynı transaction içinde atamaları kapatıp masaları/grubu boşaltır. `CloseChecksAfterPayment` migration'ı uygulanmalıdır.
* **Ne Eksik? (Henüz Yapılmamış Olanlar):**
  - Masa taşıma/birleştirme API'leri garson ekranındaki modal akışlara bağlandı; birleştirme açık ve ödeme girişimi olmayan adisyonlarla sınırlıdır.
  - Adisyon bölme API'si kalem/miktar seçen garson ekranına bağlandı.
  - Gerçek kasa/POS tahsilatının adisyon kapanışına bağlanması, ödeme hareketinin kasa kaydıyla eşleştirilmesi ve gerçek müdür yetkisi eksiktir.
  - Ürün seçenekleri garson ve kasa hızlı satış ekranından sipariş kalemine eklenebilir.
* **Modül backlog'u (teslim sırası için §5'e bakın):**
  1. Masa taşıma/birleştirme ve bölme UI akışları eklendi; gerçek veritabanı kabul testleri gereklidir.
  2. İndirim/ikram/kalem iptali API'si ve gerçek yetki/audit altyapısı.
  3. Kasa/POS adisyon tahsilatı ve kasa hareket kaydı (`pos_sale`) adisyon kapanışına bağlandı (Tamamlandı).

---

### [Modül 3] Mutfak (KDS) & Servis Kuyruğu Modülü (Kitchen)

| Kriter | Detay |
|---|---|
| **Veritabanı Şeması** | `kitchen` görev/audit/istasyon şeması; kaynak sipariş için `sales`, masa ve garson bağı için `service` |
| **İlgili EF Core Context** | [KitchenDbContext.cs](../../apps/api/Hipos.Api/Kitchen/KitchenDbContext.cs) · [SalesDbContext.cs](../../apps/api/Hipos.Api/Sales/SalesDbContext.cs) |
| **Ön Yüz Ekranı** | [OperationalApps.tsx:L38-L120](../../apps/pos/src/OperationalApps.tsx#L38-L120) (`/kitchen`) |
| **Kılavuz Doküman** | 👉 [Modül 3 Şartnamesi](MODUL_03_MUTFAK_VE_KDS.md) · [Mutfak Ekranı (KDS) ve Yazıcı Kılavuzu](../02-kasa-ve-operasyon/MUTFAK_KDS_VE_YAZICI.md) |

* **Şu An Ne Yapılmış? (Mevcut Durum):**
  - Garson siparişindeki her kalem transaction içinde kalıcı `kitchen.tasks` görevine dönüşür; aynı adisyona sonradan eklenen sipariş yeni görev üretir.
  - `/kitchen` ekranı görevleri 3 saniyede bir yeniler; dokunmatik durum geçişleri, gecikme görünümü, servise hazır ve son servis edilen bölümleri çalışır.
  - İlk kategori-istasyon yönlendirmesi ve Fırın/Sıcak Mutfak/Bar/Soğuk Mutfak/Atanmamış filtreleri çalışır.
  - Tekil istek, sürüm kontrolü ve audit kaydı uygulanmıştır; iptal verisi ve ekran görünümü hazırdır.
  <!-- 23 Ekim 2026: Modülün salt-okunur prototip olduğu yönündeki eksik durum bilgisi, yapılan KDS işleriyle güncellendi. -->
* **Ne Eksik? (Henüz Yapılmamış Olanlar):**
  - `Hazır` durumunun garson ekranına anlık bildirimi ve teslim alma akışı yoktur.
  - Satış/adisyon kalem iptali ve müdür PIN onayı mutfak görevine bağlı değildir.
  - İstasyon/kategori eşleştirmelerini yönetecek panel yoktur; yalnız başlangıç eşleştirmeleri vardır.
  - Gerçek kullanıcı/PIN yetkilendirmesi ve offline/sync kuyruğu yoktur.
  - Sipariş onaylandığında mutfaktaki termal bilet yazıcısından (ESC/POS 9100) otomatik fiş basılmamaktadır.
  <!-- 23 Ekim 2026: Çalışan durum makinesi ve ilk istasyon ayrımı eksik listesinden çıkarıldı; devam eden sorunlar silinmeden ayrıntılandırıldı. -->
* **Modül backlog'u (teslim sırası için §5'e bakın):**
  1. Garsona hazır bildirimi ve satış/adisyon iptal entegrasyonu.
  2. Gerçek PIN/rol yetkisi, yönetilebilir istasyonlar ve offline işlem kuyruğu.
  3. Yerel ağdaki termal yazıcıya TCP 9100 üzerinden otomatik mutfak fişi basım servisi ve yazıcı kuyruğu.

---

### [Modül 4] Ürün Kataloğu & Menü Yönetimi Modülü (Catalog & Menus)

| Kriter | Detay |
|---|---|
| **Veritabanı Şeması** | `catalog` şeması (`catalog.products`, `catalog.categories`, `catalog.menus`, `catalog.price_versions`) |
| **İlgili EF Core Context** | [CatalogDbContext.cs:L6-L50](../../apps/api/Hipos.Api/Catalog/CatalogDbContext.cs#L6-L50) |
| **Ön Yüz Ekranı** | [MenusPage.tsx:L1-L60](../../apps/admin/src/features/catalog/MenusPage.tsx#L1-L60), [CatalogPages.tsx:L1-L60](../../apps/admin/src/features/catalog/CatalogPages.tsx#L1-L60) |
| **Kılavuz Doküman** | 👉 [Modül 4 Şartnamesi](MODUL_04_KATALOG_VE_MENU.md) · [Katalog Backend Sözleşmesi](../03-is-alanlari-ve-yonetim/KATALOG_BACKEND_SOZLESMESI.md) · [Menü Yönetimi MVP](../03-is-alanlari-ve-yonetim/MENU_YONETIMI_MVP.md) |

* **Şu An Ne Yapılmış? (Mevcut Durum):**
  - Şube kategorileri, fiyatlı ürün kaydı, tek şubeli ürün düzenleme, fiyat sürümleri ve POS yayını PostgreSQL'e bağlıdır.
  - İleri tarihli fiyat planları şube kapsamında kaydedilir; zamanı geldiğinde API arka plan işlemi mevcut fiyat/yayın akışıyla uygular. API kapalıysa planlar yeniden başladığında işlenir.
  - Ürün ayrıntısında seçenek grubu ve seçenek yönetimi API'ye bağlıdır; sipariş API'si seçilen seçenekleri ve fiyat farklarını doğrular.
  - Menü oluşturma, kategori ve ürün sıralama, aynı şubede birden fazla menüyü POS'ta kullanılabilir yapma API üzerinden çalışmaktadır.
* **Ne Eksik? (Henüz Yapılmamış Olanlar):**
  - Ürün görseli yükleme ve menü/operasyon ekranlarında gösterimi için katalog migration’ı uygulanmalıdır; kanal yayını genişletmeleri tamamlanmamıştır.
  - Yapılandırılmış şubenin aktif menülerini ve katalog kategorilerini, QR'a uygun ürünleriyle gösteren salt okunur QR menü arayüzü vardır (kahve-zeytin yeşili kafe sıcaklığı teması, hareketli görsel, anlık arama, tıklanabilir ürün detay modalı ve yönetim panelinden tek tıkla erişim tamamlandı); masalara özel QR kod çıktısı üretimi, sipariş ve dış ortamda barındırma henüz yoktur.
* **Modül backlog'u (teslim sırası için §5'e bakın):**
  1. Garson ve kasa hızlı satışında seçenek seçimleri sipariş API'sine bağlandı.
  2. Şube menülerinin masalara özel QR kod çıktısı üretmesi ve dış ortamda barındırılması.

---

### [Modül 5] Stok, Depo & Reçete Modülü (Inventory & Recipes)

| Kriter | Detay |
|---|---|
| **Veritabanı Şeması** | `inventory` şeması (depo, hammadde, reçete, hareket, sayım, mal kabul ve fire kayıtları) |
| **İlgili EF Core Context** | [InventoryDbContext.cs:L6-L50](../../apps/api/Hipos.Api/Inventory/InventoryDbContext.cs#L6-L50) |
| **Ön Yüz Ekranı** | [InventoryHttpPage.tsx](../../apps/admin/src/features/inventory/InventoryHttpPage.tsx) · [ReceivingPage.tsx](../../apps/admin/src/features/inventory/ReceivingPage.tsx) · [WastePage.tsx](../../apps/admin/src/features/inventory/WastePage.tsx) |
| **Kılavuz Doküman** | 👉 [Modül 5 Şartnamesi](MODUL_05_STOK_VE_RECETE.md) · [Reçeteli Stok ve Satın Alma](../03-is-alanlari-ve-yonetim/RECETELI_STOK_VE_SATINALMA.md) · [Stok Test Kılavuzu](../04-test-ve-rehberler/STOK_REÇETE_SAYIM_MANUEL_TEST.md) |

* **Şu An Ne Yapılmış? (Mevcut Durum):**
  - Hammadde listesi, kritik stok uyarıları, reçete tanımları ve fiziksel sayım onay kilitleri PostgreSQL'e bağlıdır.
  - Mal kabul taslağı ve onayı çalışır; onay stok girişini ve tedarikçi borcunu atomik olarak oluşturur. Tedarikçiye iade ayrı ters kayıtla çalışır.
  - Gerekçeli fire/zayi kaydı stoğu `waste_loss` hareketiyle düşürür. Fire ekranında fiyat veya maliyet bilgisi istenmez.
  - Reçeteli ürün zayisi aktif reçete sürümünü snapshot alır ve tüm bileşenleri atomik olarak stoktan düşürür.
  - Fiyat içermeyen satın alma siparişi taslak/onay akışı, onaylı siparişin aynı miktarlarla tek seferde mal kabule bağlanması ve tamamlanması çalışır.
  - Onaylı mal kabul belgesinde eksik teslim düzeltmesi (`purchase_correction`) ve tedarikçiye iade (`supplier_return`) formları arayüzden çalıştırılabilir.
* **Ne Eksik? (Henüz Yapılmamış Olanlar):**
  - Satış yapıldığında hammadde stoktan otomatik düşmemektedir (reçete tüketim motoru yoktur).
  - Satın alma talebi yoktur; siparişte kısmi teslim bilinçli olarak desteklenmez.
  - Gerçek şef PIN onayı yoktur.
  - Fiyatlandırma, stok maliyeti ve parasal zayi raporu ayrı modül kararına ertelenmiştir.
* **Modül backlog'u (teslim sırası için §5'e bakın):**
  1. Adisyon kapandığında reçetedeki gramajları stok hareketlerinden otomatik düşen `recipe_consumption` motoru.
  2. Gerçek kimlik/yetkilendirme tamamlandığında fire ve kritik stok işlemlerine rol/PIN denetimi bağlanması.
  3. Kritik stoktan satın alma talebi oluşturma ve onaylı talebi siparişe dönüştürme.
  4. Fiyatlandırma ve maliyet alanının ayrı sözleşmeyle tasarlanması.

---

### [Modül 6] Cari Hesaplar & Gider Yönetimi Modülü (Finance & Cari)

| Kriter | Detay |
|---|---|
| **Veritabanı Şeması** | `cari` ve `finance` şemaları (`cari.parties`, `cari.movements`, `finance.expenses`) |
| **İlgili EF Core Context** | [CariDbContext.cs:L6-L30](../../apps/api/Hipos.Api/Cari/CariDbContext.cs#L6-L30), [ExpenseDbContext.cs:L6-L30](../../apps/api/Hipos.Api/Expenses/ExpenseDbContext.cs#L6-L30) |
| **Ön Yüz Ekranı** | [CarilerHttpPage.tsx:L1-L60](../../apps/admin/src/features/demo/CarilerHttpPage.tsx#L1-L60), [ExpenseManagementPage.tsx:L1-L60](../../apps/admin/src/features/expenses/ExpenseManagementPage.tsx#L1-L60) |
| **Kılavuz Doküman** | 👉 [Modül 6 Şartnamesi](MODUL_06_CARI_VE_GIDER.md) · [Cari Hesaplar MVP](../03-is-alanlari-ve-yonetim/CARI_HESAPLAR_MVP.md) · [Gider Yönetimi MVP](../03-is-alanlari-ve-yonetim/GIDER_YONETIMI_MVP.md) |

* **Şu An Ne Yapılmış? (Mevcut Durum):**
  - Müşteri/tedarikçi kartları, borç/alacak/tahsilat hareketleri ve tarih aralıklı ekstre PostgreSQL'e bağlıdır.
  - Firma gider kategorileri ve şube gider defteri çalışmaktadır.
* **Ne Eksik? (Henüz Yapılmamış Olanlar):**
  - Masada hesap "Cari/Veresiye" kapatıldığında müşterinin cari bakiyesine borç yazılamamaktadır.
  - Toptancıya kasadan nakit tediye ödemesi yapıldığında hem kasadan düşüp hem cari borcu azaltan atomik akış yoktur.
* **Modül backlog'u (teslim sırası için §5'e bakın):**
  1. Kasa parçalı ödemesinde `[Cari Hesaba Yaz]` seçeneğinin cari hareket üretmesi.
  2. Toptancıya kasadan ödeme yaparken kasa seçimi ve cari borç kapama entegrasyonu.

---

## 3. TEKNİK OMURGA VE ALTYAPI DURUMU

Tüm iş modüllerinin arkasındaki mimari omurganın durumu şöyledir:

---

### [Altyapı A] Kimlik, Oturum, Rol ve Şube İzolasyonu (Auth / Multi-Tenancy)
* **Mevcut Kod Durumu:** `X-Demo-Actor` HTTP başlığı ile sahte aktör kullanılmaktadır. Veritabanında `auth` şeması ve kullanıcı tablosu yoktur.
* **Hedef:** PostgreSQL `auth` şeması, BCrypt parola hash'leme, JWT/Cookie oturum middleware'i ve terminaller için 4 haneli kasiyer/garson PIN doğrulaması.
* 📖 **Mimari Kılavuz:** 👉 [Kimlik, Oturum ve Yetkilendirme Kılavuzu](../01-mimari-ve-altyapi/KIMLIK_OTURUM_VE_YETKI.md) · **[Modül 7 Şartnamesi](MODUL_07_KIMLIK_VE_AUTH.md)**

---

### [Altyapı B] Çevrimdışı Çalışma, Yerel LAN ve Bulut Senkronizasyonu (Offline Sync)
* **Mevcut Kod Durumu:** Sistem doğrudan tek bir veritabanına bağlanır; internet koptuğunda çalışmayı sağlayacak outbox kuyruğu yoktur.
* **Hedef:** Restorandaki Mini PC üzerinde çalışan yerel PostgreSQL, `sync.outbox` tablosu ve internet geldiğinde kuyruktaki olayları merkezi buluta asenkron aktaran `SyncWorker` servisi.
* 📖 **Mimari Kılavuz:** 👉 [Çevrimdışı Çalışma ve Senkronizasyon Kılavuzu](../01-mimari-ve-altyapi/CEVRIMDISI_VE_SENKRONIZASYON.md)

---

### [Altyapı C] Donanım, ÖKC Mali Cihaz & Çevre Birimleri (Hardware Integration)
* **Mevcut Kod Durumu:** Ödeme simülatörü (`apps/pos`) sanal olarak çalışmaktadır; gerçek POS veya yazıcı bağlantısı yoktur.
* **Hedef:** Beko/Token GMP3 entegrasyonu ile temassız ödeme ve mali fiş onayı, USB barkod okuyucu dinleyicisi ve nakit ödemede para çekmecesini fırlatan RJ11 darbe sinyali.
* 📖 **Mimari Kılavuz:** 👉 [Donanım ve Mali Cihaz Kılavuzu](../01-mimari-ve-altyapi/DONANIM_VE_MALI_CIHAZLAR.md)

---

## 4. Bu Durum Neyi HENÜZ Kanıtlamaz? (Kritik Uyarılar)

1. **`X-Demo-Actor` Bir Güvenlik Mekanizması Değildir:** Geliştirme kolaylığı için konulmuştur; API internete açıldığı an taklit edilebilir.
2. **Kasa Defteri Henüz Otomatik Değildir:** Adisyon satışları kasaya otomatik akmadığı için kasa bakiyesi şu an sadece elle girilen avansları ve nakit hareketleri tutar.
3. **Mutfak Çekirdeğinin Üretim Bağları Eksiktir:** Kalıcı durum makinesi ve hazırlık butonları çalışır; garson bildirimi, satış iptali, gerçek auth, offline kuyruk ve yazıcı çıktıları henüz bağlı değildir.
<!-- 23 Ekim 2026: Eski salt-okunur uyarısındaki eksik bilgi eklendi; devam eden üretim riskleri korunmuştur. -->
4. **Offline Sync Henüz Canlı Değildir:** Bugün çalışan LAN demosu, aynı Wi-Fi ağındaki cihazların aynı yerel IP'ye bağlanmasından ibarettir; gerçek çift taraflı Outbox senkronizasyonu değildir.

---

## 5. Güncel Sıralı Geliştirme Yol Haritası (8 Öncelikli Adım)

> [!NOTE]
> **Tarihsel Not:** Eski dokümantasyonda yer alan `Kasa → Masa → Auth → KDS → Katalog → Stok...` sırası tarihsel plan olarak kalmıştır ve artık güncel öncelik değildir. Katalog, Cari, Inventory, Manuel Kasa, Gider, Ortak Adisyon ve kalıcı KDS çekirdeği mevcut MVP dilimleridir. Gerçek POS ve ödeme, Auth, KDS’nin garson/iptal/yazıcı üretim bağları ve Offline LAN/senkronizasyon henüz uygulanmamıştır. Bu bölüm belgedeki tek güncel teslim sırasıdır.
<!-- 23 Ekim 2026: Yol haritası özetine tamamlanan KDS çekirdeği eklendi; eksik üretim entegrasyonları korunmuştur. -->
>
> Bu sekiz adım ana teslim sırasını belirtir; modül şartnamelerinde yer alan tüm gelecek özelliklerin yerine geçmez. Ayrıntılı hedef ekranlar, alt akışlar ve kabul ölçütleri kendi modül belgelerinde korunur.

```mermaid
graph TD
    Step1["1. Ortak adisyonun panel ve operasyon ekranlarına bağlanması"] --> Step2["2. Adisyon kapatma ve ödeme yaşam döngüsü"]
    Step2 --> Step3["3. Gerçek Auth ve yetkilendirme"]
    Step3 --> Step4["4. Satın alma ve mal kabul"]
    Step4 --> Step5["5. Satıştan stok tüketimi"]
    Step5 --> Step6["6. KDS ve yazıcı"]
    Step6 --> Step7["7. Token/Beko ÖKC entegrasyonu"]
    Step7 --> Step8["8. Offline LAN ve merkezi senkronizasyon"]
```

1. **Ortak adisyonun panel ve operasyon ekranlarına bağlanması:** `sales.checks`, `sales.orders` ve `service.tables` kayıtlarının yönetim paneli ile garson/operasyon ekranlarında ortak ve tutarlı gösterilmesi.
2. **Adisyon kapatma ve ödeme yaşam döngüsü:** Parçalı tahsilat, adisyonu `paid`/`closed` durumuna geçirme, ödeme kaydının kasa hareketiyle ilişkilendirilmesi ve masa bağının boşaltılması.
3. **Gerçek Auth ve yetkilendirme:** `X-Demo-Actor` yerine gerçek kullanıcı oturumu, rol/yetki denetimi ve terminaller için personel PIN doğrulaması.
4. **Satın alma ve mal kabul:** Satın alma belgesi ve irsaliye üzerinden stoğa giriş ile tedarikçi cari borcunun tutarlı kaydı.
5. **Satıştan stok tüketimi:** Adisyon kapandığında satılan ürünlerin reçetesindeki hammaddeleri `inventory.movements` üzerinden otomatik düşme.
6. **KDS ve yazıcı:** Mutfak sipariş durumlarını yönetme, istasyon ve gecikme görünümü, termal yazıcıya otomatik bilet gönderme.
7. **Token/Beko ÖKC entegrasyonu:** Gerekli sağlayıcı ve cihaz süreci tamamlandığında mali cihazla gerçek tahsilat ve mali fiş akışı.
8. **Offline LAN ve merkezi senkronizasyon:** Yerel sunucu, dayanıklı olay kuyruğu ve bağlantı geri geldiğinde merkezi sisteme senkronizasyon.

---

## 6. Teknik Kalite Kapıları ve Test Kriterleri

Geliştirilen her yeni özellik şu 5 kalite kapısından geçmek zorundadır:
1. **İdempotency:** Tekrarlanan hiçbir istek veritabanında çift kayıt, çift bilet veya mükerrer tahsilat üretmemelidir (`requestId` zorunluluğu).
2. **Denetim İzi (Audit Log):** Para hareketi, hesap kapama, indirim veya iptal yapan kullanıcının kimliği ve zamanı asla silinemez bir audit tablosuna yazılmalıdır.
3. **Şema İzolasyonu:** Hiçbir servis başka bir iş alanının tablosuna doğrudan SQL güncellemesi atamaz; işlemler sadece tanımlı domain servisleri ve event'ler üzerinden akar.
4. **Görsel Durum Dürüstlüğü:** Mock veri ile gerçek veri ekranda asla karıştırılmamalı, örnek veriler açıkça *"Örnek Gösterim"* etiketi taşımalıdır.
5. **Otomatik Testler:** Değişiklikler Node testleri (`npm test`), API testleri (`test:api`) ve PostgreSQL geçici veritabanı testlerinden (`npm run test:db`) hatasız geçmelidir.

### 23 Ekim 2026 — Fiziksel masa grubu

Garson ekranında kalabalık misafirler için ana masa ve boş ek masaları birlikte kullanımda tutma eklendi. Tüm üyeler ana masanın hesabını açar; mutfak birlikte kullanılan masa adlarını gösterir. Grup ayırma hesabı ana masada korur. Service şeması `table_groups` kaydı ve `tables.table_group_id` bağıyla sahipliği tutar; mevcut adisyon birleştirme davranışı korunur. Sınırlar, API ve yeni Service migration [Modül 2 sözleşmesinde](../00-devir-rehberi/MODUL_02_MASA_VE_ADISYON.md), elle kontroller [masa servisi test rehberinde](../04-test-ve-rehberler/MASA_SERVISI_TEST.md) kayıtlıdır. Gerçek tahsilat/otomatik masa kapatma bu dilime dahil değildir.

### 04 Kasım 2026 — Adisyon Tahsilatı Kasa Senkronizasyonu & Müdür PIN Onayı

1. **Adisyon Ödemesi ➔ Kasa Senkronizasyonu:** Hızlı satış ve masa tahsilatlarında alınan nakit ödemeler, şubenin açık kasa vardiyasına otomatik `pos_sale` hareketi olarak işlenir; nakit çekmece bakiyesi ve sistem bakiyesi anlık senkronize edilir. Kredi kartı ödemeleri çekmece nakdini şişirmez; ödeme dökümü ve harici referanslar denetim izine bağlanır.
2. **Müdür PIN Onayı ve Audit İzlenebilirliği:** Kasiyer ve Garson ekranlarında yapılan adisyon indirimleri, ürün ikramları ve kalem iptallerinde müdür/patron 4 haneli PIN kodu doğrulaması (`auth.pin_codes`) devreye alındı. Geçersiz PIN'ler `401 INVALID_MANAGER_PIN` ile reddedilir. Onaylanan işlemler `sales.check_adjustments.approval_mode` ve `sales.check_audit` tablolarında onaylayan yetkili personelin adı ve rolüyle kayıt altına alınır.
