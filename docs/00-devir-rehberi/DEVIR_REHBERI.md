# HIPOS — Mühendis ve Ekip Devir Teslim Rehberi (Master Hub)

> **Durum:** Yaşayan Ana Devir Belgesi
> **Son Güncelleme:** 21 Ekim 2026
> **Sorumlu:** Mimari & Devir Koordinasyonu
>
> **Dokümantasyon Hiyerarşisi:**
> * **Güncel kod durumu için:** [docs/01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md](../01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md)
> * **Güncel teslim ve yol haritası için:** [docs/00-devir-rehberi/DURUM_VE_YOL_HARITASI.md](DURUM_VE_YOL_HARITASI.md)
> * **Devir ve onboarding için:** [docs/00-devir-rehberi/DEVIR_REHBERI.md](DEVIR_REHBERI.md)
> * **Tarihsel kararlar için:** [docs/05-gecmis-ve-arsiv/](../05-gecmis-ve-arsiv/)

---

> [!IMPORTANT]
> ### ⚠️ BUGÜNKÜ GERÇEK DURUM (Gerçeklik Beyanı)
> **Bu repo henüz üretime hazır tam bir restoran ERP/POS sistemi DEĞİLDİR.**
>
> * **Mevcut Çalışan Kalıcı Dilimler:**
>   - Katalog ve Menü Yönetimi (`catalog` şeması)
>   - Cari Hesaplar ve Ekstre (`cari` şeması)
>   - Stok, Depo, Reçete ve Sayım Onayı (`inventory` şeması)
>   - Manuel Kasa Vardiyası ve Nakit Defteri (`cash` şeması)
>   - Manuel İşletme Giderleri (`finance` şeması)
>   - Ortak Adisyon ve Sipariş Çekirdeği (`sales` / `service` şeması)
>   - Personel Kartları (`service` şeması)
>   - Geliştirme Test POS'u (`apps/pos`) ve Simüle Ödeme
>
> * **Gerçek Müşteri / Restoran Kullanımı İçin Eksik Olanlar:**
>   - Gerçek kullanıcı kimlik doğrulaması / Auth (şu an sahte `X-Demo-Actor` var, gerçek JWT/PIN yok)
>   - Gerçek banka POS / Ödeme sağlayıcısı entegrasyonu
>   - Beko/Token ÖKC mali cihaz sertifikasyonu ve donanım bağlantısı
>   - İnternet kesildiğinde çift taraflı çalışan gerçek LAN outbox senkronizasyonu
>   - Satışın kasaya otomatik çift deftersiz akması ve parçalı tahsilat
>   - Operasyonel KDS durum makinesi ve terminal yazıcı servisi

---

## 1. Proje Ne İş Yapar? (1 Paragrafta HIPOS)

HIPOS; bir restoranın yönetim (ERP), mutfak (KDS), salon servis (Waiter) ve kasa (POS) operasyonlarını tek bir işletme omurgası üzerinde birleştirmeyi hedefleyen **yeni nesil bir restoran yönetim platformudur (ERP + POS)**.

Bir restoranın günlük hayatında sistem şöyle akar:
* **Yönetici:** Ofisinden menüleri, ürün fiyatlarını, masaları, stokları ve cari hesapları yönetir.
* **Garson:** Ürün seçip masaya sipariş gönderir; ortak adisyon çekirdeği PostgreSQL'e yazılır. Masa taşıma, birleştirme ve adisyon kapatma henüz yoktur.
* **Mutfak:** `/kitchen` siparişleri salt okunur polling ile gösterir. KDS durum makinesi ve otomatik yazıcı bağlantısı henüz yoktur.
* **Kasa:** Yönetim panelinde manuel vardiya ve nakit defteri çalışır. Gerçek POS, parçalı ödeme, otomatik satış-kasa akışı ve Z-Raporu henüz yoktur; test POS ve ödeme simülatörü gerçek tahsilat yapmaz.
* **İnternet Kesilirse:** Gerçek Offline LAN ve merkezi senkronizasyon uygulanmamıştır; bu bir ürün hedefidir.

---

## 📊 2. Modül Gerçeklik ve Üretim Hazırlık Matrisi

Yeni katılan bir geliştiricinin ilk 30 dakikada sistemin neyinin çalışıp neyinin henüz plan aşamasında olduğunu anlamasını sağlayan özet durum tablosu:

### A. Mevcut Çalışan Kalıcı Dilimler (MVP)

| Modül Adı | Durum | PostgreSQL Şeması | Panel | API (.NET 10) | Test | Üretime Hazır mı? |
|---|---|---|---|---|---|---|
| **Ortak Adisyon Çekirdeği** | Kalıcı MVP Çekirdeği | `sales` (`checks`, `orders`) | Kısmi (`apps/pos` `/waiter`, yönetim ekranları) | Var (`SalesDbContext.cs`) | Var (`postgres.test.mjs`) | Hayır (Bağlantı, kapatma ve ödeme yaşam döngüsü eksik) |
| **Menü Yönetimi** | Kalıcı MVP | `catalog` (`menus`, `menu_sections`, `menu_items`) | Var (`MenusPage.tsx`) | Var (`CatalogDbContext.cs`) | Var (`MenuProvider.test.ts`, `postgres.test.mjs`) | Hayır (Modifiers ve QR yok) |
| **Cari Yönetimi** | Kalıcı MVP | `cari` (`parties`, `movements`) | Var (`CarilerHttpPage.tsx`) | Var (`CariDbContext.cs`) | Var (`postgres.test.mjs`) | Hayır (Kasadan tediye/tahsilat bağı yok) |
| **Inventory** | Kalıcı MVP | `inventory` (`warehouses`, `items`, `recipes`, `recipe_items`, `movements`, `counts`, `count_items`) | Var (`InventoryHttpPage.tsx`) | Var (`InventoryDbContext.cs`) | Var (`postgres.test.mjs`) | Hayır (Satıştan otomatik tüketim yok) |
| **Manuel Kasa** | Manuel MVP | `cash` (`registers`, `shifts`, `movements`, `audit`) | Var (`CashManagementPage.tsx`) | Var (`CashDbContext.cs`) | Var (`KASA_MANUEL_TEST.md`, `postgres.test.mjs`) | Hayır (Gerçek POS/parçalı ödeme yok) |
| **Gider Yönetimi** | Manuel MVP | `finance` (`expenses`) | Var (`ExpenseManagementPage.tsx`) | Var (`ExpenseDbContext.cs`) | Var (`expenses.test.mjs`) | Hayır (Kasa nakit çıkış bağlantısı yok) |
| **Personel Yönetimi** | Kalıcı MVP | `service` (`employees`, `waiters`, `assignments`) | Var (`ServicePersonnelPage.tsx`) | Var (`ServiceDbContext.cs`) | Var (`postgres.test.mjs`) | Hayır (PIN, oturum ve bordro yok) |

### B. Hedeflenen / Henüz Uygulanmayan Bileşenler

| Planlanan Bileşen | Durum | PostgreSQL Şeması | Panel / Ekran | API | Test | Üretime Hazır mı? |
|---|---|---|---|---|---|---|
| **Gerçek POS & Parçalı Ödeme** | Planlandı | Yok (`sales.check_payments` sırada) | Yok (Yalnız `PaymentSimulatorPanel.tsx` var) | Kısmi (Yalnızca mock simülasyon) | Yok | Hayır (Banka POS/entegrasyon yok) |
| **Kimlik & PIN (Auth)** | Planlandı | Yok (`auth` şeması henüz kurulmadı) | Yok (Login ekranı yok, `X-Demo-Actor` var) | Kısmi (`DemoAccess.cs` middleware) | Yok | Hayır (JWT/Cookie ve PIN doğrulaması yok) |
| **Mutfak (KDS) & Yazıcı** | Gerçek KDS planlandı; salt-okunur önizleme var | Yok (`sales.orders` üzerinden 3 sn salt-okunur polling) | Kısmi (`OperationalApps.tsx` `/kitchen`) | Yok (Durum endpoint'i yok) | Yok | Hayır (Butonlar ve fiş basımı yok) |
| **Beko / Token ÖKC** | Başvuru Aşaması | Yok (Donanım protokolü bağlanmadı) | Yok | Yok | Yok | Hayır (Mali onay ve cihaz bağlantısı yok) |
| **Çevrimdışı (Offline LAN)** | Planlandı | Yok (`sync.outbox` tablosu kurulmadı) | Yok | Yok | Yok | Hayır (Mini PC yerel senkronizasyonu yok) |

---

## 👥 3. Mühendisler İçin Modül Bazlı İş Dağıtım Modeli

Projeye başlayan geliştiricilere modül kapsamı için **7 modül şartnamesi** atanır. Aşağıdaki tablo modül sahipliğini ve canonical yol haritasındaki ilgili adımları gösterir; ayrı bir öncelik veya sıra tanımlamaz. Güncel sıra yalnız [Durum ve Yol Haritası](DURUM_VE_YOL_HARITASI.md) belgesinin 5. bölümündedir.

| Modül Adı | Kapsam | Ayrıntılı Modül Şartnamesi | Güncel Yol Haritası Referansı |
|---|---|---|---|
| **[Modül 1] Kasa & Hızlı Satış** | Manuel kasa mevcut; gerçek POS, parçalı ödeme ve Z-Raporu planlanıyor. | 👉 [MODUL_01_KASA_VE_POS.md](MODUL_01_KASA_VE_POS.md) | 2. Adisyon ödeme yaşam döngüsü; 7. ÖKC bağlantısı |
| **[Modül 2] Masa Servisi & Adisyon** | Ortak adisyon çekirdeği mevcut; panel/operasyon bağlantısı ve yaşam döngüsü eksik. | 👉 [MODUL_02_MASA_VE_ADISYON.md](MODUL_02_MASA_VE_ADISYON.md) | 1–2. adımlar |
| **[Modül 3] Mutfak (KDS) & Yazıcı** | Salt okunur mutfak önizlemesi mevcut; KDS durumları ve yazıcı eksik. | 👉 [MODUL_03_MUTFAK_VE_KDS.md](MODUL_03_MUTFAK_VE_KDS.md) | 6. adım |
| **[Modül 4] Ürün Kataloğu & Menü** | Katalog ve menü kalıcı MVP'si mevcut; modifiers ve QR yayınlama eksik. | 👉 [MODUL_04_KATALOG_VE_MENU.md](MODUL_04_KATALOG_VE_MENU.md) | Mevcut MVP; genişletmeler ana sıranın dışında |
| **[Modül 5] Stok & Reçeteli Üretim** | Stok, reçete ve sayım mevcut; mal kabul ve otomatik tüketim eksik. | 👉 [MODUL_05_STOK_VE_RECETE.md](MODUL_05_STOK_VE_RECETE.md) | 4–5. adımlar |
| **[Modül 6] Cari Hesaplar & Giderler** | Manuel cari ve gider kayıtları kalıcı MVP'dir; otomatik operasyon bağlantıları eksik. | 👉 [MODUL_06_CARI_VE_GIDER.md](MODUL_06_CARI_VE_GIDER.md) | 2. ve 4. adımlarla kesişir |
| **[Modül 7] Kimlik & Auth Omurgası** | Gerçek Auth ve yetkilendirme uygulanmamıştır. | 👉 [MODUL_07_KIMLIK_VE_AUTH.md](MODUL_07_KIMLIK_VE_AUTH.md) | 3. adım |

---

## 🏛️ 4. MODÜL MODÜL AYRINTILI MİMARİ VE EKRAN DAVRANIŞLARI

---

### [Modül 1] Kasa, POS ve Parçalı Tahsilat Modülü (Cashier / POS)

Restoranın para çekmecesinin, gün sonu hasılatının ve ödeme tahsilatlarının yönetildiği operasyon merkezidir.

#### A. Restorandaki Rolü ve İş Değeri
* Kasa; garsonların açtığı adisyonların paraya dönüştüğü ve gün sonunda kasanın açık/fazla vermeden sahibine teslim edildiği güven kapısıdır.
* Müşteri hesabını tek kartla ödemek zorunda değildir; hesabı nakit, kredi kartı ve yemek kartı arasında parçalayabilir.
* Yönetici kasadan toptancıya (kasap, manav) nakit ödeme yapabilmeli ve bozuk para bittiğinde kasaya avans ekleyebilmelidir.

#### B. ✅ Bugün Kodda Çalışanlar (Mevcut Durum)
* **Yönetici Canlı Kasa Takip Paneli ([CashManagementPage.tsx:L7-L60](../../apps/admin/src/features/cash/CashManagementPage.tsx#L7-L60)):** Tek şube için varsayılan `MAIN` kasasında vardiya açma, nakit avans girişi (`manual_in`), kasadan nakit çıkışı (`manual_out`), gerekçeli ters kayıt (`reversal`) ve basit vardiya kapama formu çalışmaktadır.
* **Backend API ve Veri Modeli ([CashDbContext.cs:L6-L65](../../apps/api/Hipos.Api/Cash/CashDbContext.cs#L6-L65)):** `cash.registers`, `cash.shifts`, `cash.movements`, `cash.audit` tabloları PostgreSQL'de kayıtlıdır. `CashProvisioningService` ile `MAIN` kasa otomatik kurulur.
* **Test kapsamı:** [KASA_MANUEL_TEST.md](../04-test-ve-rehberler/KASA_MANUEL_TEST.md) ve [postgres.test.mjs:L2050-L2100](../../apps/api/Hipos.Api.Tests/postgres.test.mjs#L2050-L2100) kasa senaryolarını içerir.

#### C. 🚧 Henüz Yapılmayanlar & Hedef Ekran Davranışları (Geliştirilecek Backlog)
1. **Dokunmatik Kasa ve Parçalı Tahsilat Ekranı (Hedef Ekran — `apps/pos` içine geliştirilecek):**
   * **Başlık:** Kasa Adı (`Kasa 1`), Kasiyer Rozeti (`👤 Melis K.`), Çekmeceyi Aç Butonu (`[ ⏏️ Çekmeceyi Fırlat ]`).
   * **Sol Panel (Sipariş & Bakiye):** Masadaki ürünler ve büyük dinamik kalan bakiye göstergesi (`Kalan: 450,00 TL` -> Turuncu, `Kalan: 0,00 TL` -> Yeşil).
   * **Orta Panel (Parçalı Ödemeler):** Yapılan her ödeme satır satır görünür (`1.000 TL Nakit`, `400 TL Ziraat POS`). Hatalı ödeme silinebilir.
   * **Sağ Panel (Numpad & Ödeme Türleri):** Büyük dokunmatik butonlar (`[ 💵 Nakit ]`, `[ 💳 Ziraat POS ]`, `[ 💳 Vakıf POS ]`, `[ 🎫 Sodexo ]`, `[ 📑 Cariye Yaz ]`). Nakit seçilirse para üstü hesaplanır.
   * **Kapanış:** Kalan bakiye sıfırlandığı an `[ 🎉 Adisyonu Kapat ve Fiş Bas ]` butonu parlar; tıklandığında masa boşalır, çekmece açılır ve satış kasaya işlenir.
2. **Parçalı Tahsilat Veri Modeli:** `sales.check_payments` tablosunun ve endpoint'lerinin eklenmesi.
3. **Otomatik Kasa Entegrasyonu (Çift Defteri Bitirme):** Nakit tahsilat tamamlandığı an tutarın `cash.movements` tablosuna `cash_sale` hareketi olarak otomatik yazılması.
4. **Kasadan Tedarikçi Tediye Ödemesi:** Yöneticinin toptancıya nakit çıkışını yapması (`supplier_payout`).
5. **Gün Sonu Z-Raporu Sihirbazı Modalı (Hedef Modal):** Fiziksel kupür sayımı (200x, 100x...), fark analizi, yarına devredecek avans ayrımı ve Z-Raporu dökümü.
6. **Kasiyer PIN Girişi:** Kasiyerlerin 4 haneli PIN ile kasa/istasyon seçerek oturum açması.

#### D. Şartname ve İlgili Dokümanlar
* 🌟 **A'dan Z'ye Modül Devir Şartnamesi:** 👉 [MODUL_01_KASA_VE_POS.md](MODUL_01_KASA_VE_POS.md)
* 📖 **Ayrıntılı Kılavuz:** 👉 [Kasa ve POS Operasyon Sözleşmesi](../02-kasa-ve-operasyon/KASA_POS_VE_OPERASYON_SOZLESMESI.md) · [Kasa Test Kılavuzu](../04-test-ve-rehberler/KASA_MANUEL_TEST.md)

---

### [Modül 2] Masa Servisi ve Ortak Adisyon Modülü (Service & Checks)

Salondaki masaların, garson atamalarının ve açık adisyonların yönetildiği modüldür.

#### A. Restorandaki Rolü ve İş Değeri
* Garson salondaki masaları renklerine göre görür: Boş (Yeşil), Dolu/Açık Hesap (Mavi), Hesap İstendi (Sarı), Rezerve (Gri).
* Masaya yeni müşteri oturduğunda adisyon açılır; garson masaya sipariş ekledikçe ortak adisyona yazılır ve mutfağa bilet gider.
* Müşteriler masayı değiştirmek isteyebilir (Masa Taşıma) veya iki masa birleştirilebilir (Masa Birleştirme).
* Arkadaş grubu masadaki hesabı ikiye bölmek isteyebilir (Adisyon Bölme).

#### B. ✅ Bugün Kodda Çalışanlar (Mevcut Durum)
* **Yönetici Masa Planı ([ServiceTablesPage.tsx:L1-L60](../../apps/admin/src/features/branches/ServiceTablesPage.tsx#L1-L60)):** Salon masa listesi, kapasiteleri ve sorumlu garson tanımları görüntülenir.
* **Garson Servis Ekranı ([OperationalApps.tsx:L38-L120](../../apps/pos/src/OperationalApps.tsx#L38-L120) - `/waiter`):** Masalar grid düzeninde listelenir; masaya tıklandığında menüden sipariş kalemleri seçilerek masaya sipariş eklenir.
* **Backend API ve Veri Modeli:**
  * [ServiceDbContext.cs:L6-L30](../../apps/api/Hipos.Api/Service/ServiceDbContext.cs#L6-L30) — `service.tables`, `service.employees`, `service.assignments`, `service.audit`.
  * [SalesDbContext.cs:L6-L56](../../apps/api/Hipos.Api/Sales/SalesDbContext.cs#L6-L56) — `sales.checks`, `sales.orders`, `sales.order_lines`, `sales.payment_attempts` ve audit tabloları.
* **Test kapsamı:** [postgres.test.mjs](../../apps/api/Hipos.Api.Tests/postgres.test.mjs) masa ve adisyon kabul senaryolarını içerir.

#### C. 🚧 Henüz Yapılmayanlar & Hedef Ekran Davranışları (Geliştirilecek Backlog)
1. **Adisyon Kapanışı ve Masayı Boşaltma:** Mevcut kodda adisyonlar hep `status='open'` durumunda kalmaktadır. Kasa modülü tahsilatı tamamladığında adisyonun `paid`/`closed` durumuna geçmesi ve masanın anında yeşile (boş) dönmesi.
2. **Açık Adisyon Draining (Tahliye) Kuralı:** Şubede `service.tables` veya satış yeteneği kapatıldığında açıkta kalan adisyonları denetleyen ve tahliye eden mekanizma henüz yoktur.
3. **Masa Taşıma Modalı (Hedef Modal):** Kaynak Masa (`Masa 4`) -> Hedef Masa (`Masa 9`). Onaylandığında tüm siparişler ve adisyon aktarılır, eski masa boşa çıkar (`POST /service/tables/{id}/transfer`).
4. **Masa Birleştirme Modalı (Hedef Modal):** İki adisyon tek bir adisyonda konsolide edilir (`POST /service/tables/{id}/merge`).
5. **Adisyon Bölme (Split Check):** Aynı masadaki hesabın ayrı adisyon fişlerine ayrılması.
6. **İskonto ve İkram Modalı (Hedef Modal):** Kalem ikramı veya indirim uygulandığında müdür PIN'i ve gerekçe istenir (`check_voids`).

#### D. Şartname ve İlgili Dokümanlar
* 🌟 **A'dan Z'ye Modül Devir Şartnamesi:** 👉 [MODUL_02_MASA_VE_ADISYON.md](MODUL_02_MASA_VE_ADISYON.md)
* 📖 **Ayrıntılı Kılavuz:** 👉 [Adisyon ve Masa Yaşam Döngüsü Kılavuzu](../02-kasa-ve-operasyon/ADISYON_VE_MASA_YASAM_DONGUSU.md)
* 🏛️ **Teknik Altyapı Referansı:** [Ortak Adisyon Sözleşmesi](../02-kasa-ve-operasyon/ORTAK_ADISYON_SOZLESMESI.md) · [Masa Servisi Test Kılavuzu](../04-test-ve-rehberler/MASA_SERVISI_TEST.md)

---

### [Modül 3] Mutfak (KDS) & Servis Kuyruğu Modülü (Kitchen)

Aşçıların siparişleri gördüğü, hazırladığı ve servis garsonuyla haberleştiği istasyondur.

#### A. Restorandaki Rolü ve İş Değeri
* Masadan veya tezgâhtan onaylanan siparişler garsonun bağırmasına gerek kalmadan mutfaktaki KDS ekranına düşer ve termal yazıcıdan bilet basılır.
* Aşçı siparişi aldığında `[ Hazırlanıyor ]`, bitirdiğinde `[ Hazır ]` butonuna basar; garson masaya servis eder.

#### B. ✅ Bugün Kodda Çalışanlar (Mevcut Durum)
* **Geliştirme Önizleme Ekranı ([OperationalApps.tsx:L38-L120](../../apps/pos/src/OperationalApps.tsx#L38-L120) - `/kitchen`):** 3 saniyede bir `sales.orders` tablosunu sorgulayan salt-okunur polling ekranı sipariş kalemlerini listelemektedir.

#### C. 🚧 Henüz Yapılmayanlar & Hedef Ekran Davranışları (Geliştirilecek Backlog)
1. **Mutfak Dokunmatik Durum Butonları (Hedef UI):** Aşçının siparişe tıklayarak `[ Hazırlanıyor ⏱️ ]` ve `[ Hazır / Servise Çıkar 🔔 ]` durumlarına geçirebilmesi.
2. **Durum Güncelleme API'si:** `POST /api/v1/kitchen/orders/{id}/status` endpoint'i.
3. **Gecikme Renk Sayaçları:** 0-10 dakika yeşil, 10-20 dakika sarı uyarı, 20+ dakika yanıp sönen kırmızı alarm.
4. **İstasyon Ayrıştırma Sekmeleri:** `[ Tüm Siparişler ]`, `[ Sıcak Mutfak ]`, `[ Taş Fırın ]`, `[ Bar / İçecek ]` filtreleri.
5. **Termal Mutfak Fişi Basımı:** Garson siparişi onayladığında mutfaktaki ağ yazıcısına (ESC/POS TCP 9100) otomatik sipariş fişi gönderen servis.

#### D. Şartname ve İlgili Dokümanlar
* 🌟 **A'dan Z'ye Modül Devir Şartnamesi:** 👉 [MODUL_03_MUTFAK_VE_KDS.md](MODUL_03_MUTFAK_VE_KDS.md)
* 📖 **Ayrıntılı Kılavuz:** 👉 [Mutfak Ekranı (KDS) ve Yazıcı Kılavuzu](../02-kasa-ve-operasyon/MUTFAK_KDS_VE_YAZICI.md)
* 🏛️ **Teknik Altyapı Referansı:** [Backend Mimarisi ve Şemalar](../01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md)

---

### [Modül 4] Ürün Kataloğu & Menü Yönetimi Modülü (Catalog & Menus)

Restoranın sattığı ürünlerin, reçete bağlarının, fiyat sürümlerinin ve şube menülerinin yönetildiği alandır.

#### A. Restorandaki Rolü ve İş Değeri
* Restoranın sunduğu yiyecek ve içeceklerin tek bir katalogda tanımlanması, fiyat değişikliklerinin sürümlenmesi ve POS terminallerine anlık yayımlanmasıdır.
* Şubelerin farklı menüleri ve farklı fiyatları olabilir (Örn: Kadıköy Şubesi ile Beşiktaş Şubesi farklı fiyat uygulayabilir).

#### B. ✅ Bugün Kodda Çalışanlar (Mevcut Durum)
* **Ürün ve Kategori Yönetimi ([CatalogPages.tsx:L1-L60](../../apps/admin/src/features/catalog/CatalogPages.tsx#L1-L60)):** Ürün ekleme, kategori atama, alerjenler, temel fiyat, taslak hazırlama ve fiyat yayınlama çalışmaktadır.
* **Menü Yönetimi ([MenusPage.tsx:L1-L60](../../apps/admin/src/features/catalog/MenusPage.tsx#L1-L60)):** Menü bölümleri oluşturma (Başlangıçlar, Ana Yemekler, İçecekler), ürün sıralaması ve POS için tek aktif menü seçimi API'ye bağlıdır.
* **Backend API ve Veri Modeli ([CatalogDbContext.cs:L6-L50](../../apps/api/Hipos.Api/Catalog/CatalogDbContext.cs#L6-L50)):** `catalog.products`, `catalog.categories`, `catalog.price_versions`, `catalog.publications`, `catalog.drafts`, `catalog.menus`, `catalog.menu_sections`, `catalog.menu_items` ve `catalog.product_activation_audit` PostgreSQL'e bağlıdır.
* **Test kapsamı:** [HttpCatalogProvider.test.ts](../../apps/admin/src/features/catalog/HttpCatalogProvider.test.ts), [MenuProvider.test.ts](../../apps/admin/src/features/catalog/MenuProvider.test.ts) ve [postgres.test.mjs](../../apps/api/Hipos.Api.Tests/postgres.test.mjs) katalog ve menü senaryalarını içerir.

#### C. 🚧 Henüz Yapılmayanlar & Hedef Ekran Davranışları (Geliştirilecek Backlog)
1. **Ürün Seçenekleri / Modifiers:** "Büyük Boy +20 TL", "Duble Peynir +30 TL", "Acısız/Az Pişmiş" gibi seçenek gruplarının veri modeli, yönetim arayüzü ve POS sipariş akışına eklenmesi.
2. **Masaya Özel QR Menü:** Masaların karekodunu okutan müşterilerin telefonlarından görebileceği dışa açık salt-okunur menü yayını.

#### D. Şartname ve İlgili Dokümanlar
* 🌟 **A'dan Z'ye Modül Devir Şartnamesi:** 👉 [MODUL_04_KATALOG_VE_MENU.md](MODUL_04_KATALOG_VE_MENU.md)
* 📖 **Ayrıntılı Kılavuz:** 👉 [Katalog Backend Sözleşmesi](../03-is-alanlari-ve-yonetim/KATALOG_BACKEND_SOZLESMESI.md) · [Menü Yönetimi MVP](../03-is-alanlari-ve-yonetim/MENU_YONETIMI_MVP.md)

---

### [Modül 5] Stok, Depo & Reçete Modülü (Inventory & Recipes)

Hammaddelerin (un, et, peynir, kahve çekirdeği), reçetelerin ve depo sayımlarının takibidir.

#### A. Restorandaki Rolü ve İş Değeri
* Pizzanın veya yemeğin satılması demek depodaki hammadde stoğunun eksilmesi demektir.
* Reçeteli üretim sayesinde 1 Margherita Pizza satıldığında depodan 150 gr un, 100 gr mozzarella, 80 gr domates sosu otomatik düşmelidir.
* Ay sonlarında depodaki fiziksel un çuvalları sayılır; sayım taslağı ile sistem arasındaki fark yönetici tarafından onaylanarak düzeltme hareketi oluşturulur.

#### B. ✅ Bugün Kodda Çalışanlar (Mevcut Durum)
* **Stok ve Depo Yönetim Ekranı ([InventoryHttpPage.tsx:L1-L60](../../apps/admin/src/features/inventory/InventoryHttpPage.tsx#L1-L60)):** Depodaki mevcut miktarlar, kritik eşik uyarıları, reçete editörü, fiziksel sayım taslağı girişi ve yönetici onay kilitli düzeltme hareketi çalışmaktadır.
* **Backend API ve Veri Modeli ([InventoryDbContext.cs:L6-L50](../../apps/api/Hipos.Api/Inventory/InventoryDbContext.cs#L6-L50)):** `inventory.warehouses`, `inventory.ingredients`, `inventory.recipes`, `inventory.recipe_lines`, `inventory.movements`, `inventory.counts`, `inventory.count_lines` PostgreSQL'e bağlıdır.
* **Test kapsamı:** [STOK_REÇETE_SAYIM_MANUEL_TEST.md](../04-test-ve-rehberler/STOK_REÇETE_SAYIM_MANUEL_TEST.md) rehberi ve [postgres.test.mjs](../../apps/api/Hipos.Api.Tests/postgres.test.mjs) stok ve sayım senaryolarını içerir.

#### C. 🚧 Henüz Yapılmayanlar & Hedef Ekran Davranışları (Geliştirilecek Backlog)
1. **Satış Anında Otomatik Reçete Tüketimi (`recipe_consumption`):** Adisyon kapandığında satılan ürünlerin reçetesindeki gramajları `inventory.movements` tablosundan otomatik düşen arka plan servisi.
2. **Mal Kabul ve Alış İrsaliyesi Ekranı (Hedef Form):** Toptancıdan 50 kg un geldiğinde depoya stok girişi yapma ve irsaliye numarası bağlama.
3. **Fire Kaydı Formu (Hedef Form):** Mutfakta bozulan veya dökülen ürünler için gerekçeli fire çıkışı oluşturma.

#### D. Şartname ve İlgili Dokümanlar
* 🌟 **A'dan Z'ye Modül Devir Şartnamesi:** 👉 [MODUL_05_STOK_VE_RECETE.md](MODUL_05_STOK_VE_RECETE.md)
* 📖 **Ayrıntılı Kılavuz:** 👉 [Reçeteli Stok Düşümü ve Satın Alma Kılavuzu](../03-is-alanlari-ve-yonetim/RECETELI_STOK_VE_SATINALMA.md)
* 🏛️ **Teknik Altyapı Referansı:** [Envanter ve Stok Sözleşmesi](../03-is-alanlari-ve-yonetim/ENVANTER_STOK_SATINALMA_SOZLESMESI.md) · [Stok Test Kılavuzu](../04-test-ve-rehberler/STOK_REÇETE_SAYIM_MANUEL_TEST.md)

---

### [Modül 6] Cari Hesaplar & Gider Yönetimi Modülü (Finance & Cari)

Müşteri veresiyeleri, toptancı borçları ve dükkanın işletme masraflarının takibidir.

#### A. Restorandaki Rolü ve İş Değeri
* Müdavim müşteriler, şirket sahipleri ve çevre esnaf hesabı nakit veya kartla değil *"Bunu benim hesaba yaz"* diyerek kapatır (Veresiye).
* Restoranın toptancılara borcu vardır; faturalar vadeli veya peşin ödenir.
* Dükkandan çıkan harçlıklar (taksi, temizlik malzemesi, kurye yakıtı) Giderler modülünde toplanır.

#### B. ✅ Bugün Kodda Çalışanlar (Mevcut Durum)
* **Cari Ekstresi Ekranı ([CarilerHttpPage.tsx:L1-L60](../../apps/admin/src/features/demo/CarilerHttpPage.tsx#L1-L60)):** Müşteri ve tedarikçi kartları, toplam borç/alacak bakiyesi ve tarih aralıklı hesap ekstresi çalışmaktadır.
* **Gider Yönetimi Ekranı ([ExpenseManagementPage.tsx:L1-L60](../../apps/admin/src/features/expenses/ExpenseManagementPage.tsx#L1-L60)):** Masraf kategorileri (Kira, Fatura, Personel Harçlığı) ve şube gider defteri çalışmaktadır.
* **Backend API ve Veri Modeli:**
  * [CariDbContext.cs:L6-L30](../../apps/api/Hipos.Api/Cari/CariDbContext.cs#L6-L30) — `cari.parties`, `cari.movements`.
  * [ExpenseDbContext.cs:L6-L30](../../apps/api/Hipos.Api/Expenses/ExpenseDbContext.cs#L6-L30) — `finance.expenses`.
* **Test kapsamı:** [expenses.test.mjs](../../apps/api/Hipos.Api.Tests/expenses.test.mjs) ve [postgres.test.mjs](../../apps/api/Hipos.Api.Tests/postgres.test.mjs) gider senaryolarını içerir.

#### C. 🚧 Henüz Yapılmayanlar & Hedef Ekran Davranışları (Geliştirilecek Backlog)
1. **Adisyonun Cariye Yazılması Entegrasyonu:** Kasa parçalı ödemesinde `[ Cariye Yaz ]` seçildiğinde seçilen müşterinin borç bakiyesini artıran otomatik hareket (`customer_charge`).
2. **Kasadan Toptancıya Tediye Ödemesi (`supplier_payout`):** Yöneticinin kasadaki nakitten toptancıya ödeme yapması halinde hem `cash.movements` hem `cari.movements` (`supplier_payment`) yazan atomik servis.
3. **Kasa Harcamasının Giderle Bağlanması:** Kasadan yapılan nakit çıkışının Gider modülü ile atomik bağlanması.

#### D. Şartname ve İlgili Dokümanlar
* 🌟 **A'dan Z'ye Modül Devir Şartnamesi:** 👉 [MODUL_06_CARI_VE_GIDER.md](MODUL_06_CARI_VE_GIDER.md)
* 📖 **Ayrıntılı Kılavuz:** 👉 [Cari Hesaplar MVP](../03-is-alanlari-ve-yonetim/CARI_HESAPLAR_MVP.md) · [Gider Yönetimi MVP](../03-is-alanlari-ve-yonetim/GIDER_YONETIMI_MVP.md)
* 🏛️ **Teknik Altyapı Referansı:** [Cari Test Kılavuzu](../04-test-ve-rehberler/CARI_MANUEL_TEST.md)

---

### [Modül 7] Kimlik, Oturum, Rol ve Yetkilendirme Modülü (Auth & Security)

Sistemin güvenlik kapısı, kullanıcı hesapları ve dokunmatik terminal oturum merkezidir.

#### A. Restorandaki Rolü ve İş Değeri
* Şu an repoda sahte `X-Demo-Actor` başlığı kullanılmaktadır; gerçek bir restoran ortamına gerçek kullanıcılar ve denetim izleri olmadan çıkılamaz.
* Yönetici web panelinde güçlü bir şifre ve e-posta ile giriş yaparken, salondaki garson ve kasiyerler saniyeler içinde masaya sipariş girebilmek için 4 haneli PIN kodu tuşlar.
* Kasiyer kasayı kapatırken, müdür indirim veya iptal yaparken kimin ne işlem yaptığı bu modül üzerinden audit tablosuna yazılır.

#### B. ✅ Bugün Kodda Çalışanlar (Mevcut Durum)
* **Personel Kartları:** `service.employees` tablosunda ve [ServicePersonnelPage.tsx](../../apps/admin/src/features/branches/ServicePersonnelPage.tsx) üzerinde personel tanımları mevcuttur.
* **Geçici Geliştirme Erişimi ([DemoAccess.cs:L25-L58](../../apps/api/Hipos.Api/Features/DemoAccess.cs#L25-L58)):** Geliştirme aşamasında isteklerin kim tarafından yapıldığını simüle eden `X-Demo-Actor` middleware'i aktiftir.

#### C. 🚧 Henüz Yapılmayanlar & Hedef Ekran Davranışları (Geliştirilecek Backlog)
1. **Yönetici Giriş Ekranı (Hedef Ekran — `apps/admin/src/features/auth/LoginPage.tsx`):** E-posta ve şifre ile giriş, JWT token Cookie/Storage yönetimi, oturumu olmayanları Login sayfasına yönlendirme.
2. **Dokunmatik Terminal PIN Pad (Hedef Modal — `apps/pos/src/components/PinPadModal.tsx`):** POS terminali boşta beklerken ekranın kilitli olması; garson veya kasiyer 4 haneli PIN tuşladığı an oturumun açılması.
3. **Backend `auth` Şeması ve `AuthDbContext`:** `auth.users`, `auth.memberships`, `auth.pin_codes` tabloları.
4. **Kimlik Doğrulama API'leri:** `POST /api/v1/auth/login` ve `POST /api/v1/auth/pin-verify`.
5. **Sahte Aktörün Kaldırılması:** `X-Demo-Actor` başlığını emekliye ayırma ve `HttpContext.User` claim'lerine bağlama.

#### D. Şartname ve İlgili Dokümanlar
* 🌟 **A'dan Z'ye Modül Devir Şartnamesi:** 👉 [MODUL_07_KIMLIK_VE_AUTH.md](MODUL_07_KIMLIK_VE_AUTH.md)
* 📖 **Derinlemesine Mimari Kılavuz:** 👉 [Kimlik, Oturum ve Yetkilendirme Kılavuzu](../01-mimari-ve-altyapi/KIMLIK_OTURUM_VE_YETKI.md) · [Kimlik ve Hesap Akışı](../01-mimari-ve-altyapi/KIMLIK_VE_HESAP_AKISI.md)

---

## 🌐 5. İLERİ SEVİYE SİSTEM ALTYAPILARI (Offline Sync & Hardware)

İş mantığı modüllerinin (Modül 1-7) ardında çalışan kritik donanım ve ağ omurgasıdır:

---

### [Altyapı A] Çevrimdışı Çalışma, Yerel LAN ve Bulut Senkronizasyonu (Offline Sync)

Restoranın fiber interneti koptuğunda operasyonun durmasını engelleyen yerel ağ omurgasıdır.

* **Neden Gerekli?:** Restoranda cumartesi akşamı internet koptuğunda garson sipariş alamamazlık veya kasiyer hesap kapatamazlık yapamaz.
* **Ekran Davranışları:** Sağ üstte ağ durumu rozeti: `🟢 İnternet Bağlı` veya `🟡 Çevrimdışı Mod (Yerel LAN) · 4 işlem eşitlenmeyi bekliyor`.
* **Sıradaki Yapılacaklar:**
  1. Restoran içi Mini PC yerel sunucu kurulumu.
  2. `sync.outbox` kuyruk tablosu ve internet kesikken yerel PostgreSQL'e yazma.
  3. İnternet geldiğinde kuyruktaki sipariş ve ödemeleri buluta asenkron eşitleyen `BackgroundService`.
* 📖 **Derinlemesine Mimari Kılavuz:** 👉 [Çevrimdışı Çalışma ve Senkronizasyon Kılavuzu](../01-mimari-ve-altyapi/CEVRIMDISI_VE_SENKRONIZASYON.md)
* 🏛️ **Altyapı Referansı:** [Çevrimdışı Çalışma İlk Sözleşmesi](../01-mimari-ve-altyapi/CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md)

---

### [Altyapı B] Donanım, ÖKC Mali Cihaz & Çevre Birimleri (Hardware Integration)

Restoranın fiziksel çevre birimleriyle haberleştiği katmandır.

> [!WARNING]
> **Token/Beko ÖKC Gerçeklik Durumu:**
> * Başvuru ve süreç bilgisi dokümante edilmiştir.
> * Gerçek SDK/API bağlantısı **YOKTUR**.
> * Test cihazı entegrasyonu **YOKTUR**.
> * ÖKC resmi sertifikasyonu **YOKTUR** (Test ödeme simülatörü kullanılmaktadır).

* **Neden Gerekli?:** Maliye onaylı yazar kasa fişi kesmek, barkod okutmak ve nakit ödemede çekmeceyi otomatik fırlatmak gerekir.
* **Sıradaki Yapılacaklar:**
  1. Beko/Token GMP3 protokolü ile temassız kart tahsilatı ve mali fiş onayı alma.
  2. USB barkod okuyucu klavye dinleyicisi.
  3. Nakit tahsilatta para çekmecesini fırlatan ESC/POS darbe sinyali (RJ11).
* 📖 **Derinlemesine Mimari Kılavuz:** 👉 [Donanım ve Mali Cihaz Kılavuzu](../01-mimari-ve-altyapi/DONANIM_VE_MALI_CIHAZLAR.md)
* 🏛️ **Altyapı Referansı:** [Entegrasyon Envanteri ve Token Süreci](../01-mimari-ve-altyapi/ENTEGRASYON_ENVANTERI_VE_TOKEN_SURECI.md)

---

## 🚀 6. Güncel Yol Haritası ve Modül Backlog'u

Katalog, Cari, Inventory, Manuel Kasa, Gider ve Ortak Adisyon Çekirdeği **mevcut kalıcı MVP dilimleridir**. Eski `Kasa → Masa → Auth → KDS → Katalog → Stok...` sırası yalnız tarihsel plandır. Gerçek POS ve ödeme, gerçek Auth, operasyonel KDS/yazıcı ve Offline LAN/senkronizasyon planlanan/eksik işlerdir.

Güncel teslim sırasının tek kaynağı [Durum ve Yol Haritası](DURUM_VE_YOL_HARITASI.md) belgesidir. Bu rehber modül kapsamını, bugünkü durumu ve her modülün gelecek backlog'unu ayrı ayrı açıklar; backlog maddeleri ek geliştirme kapsamını korur ve canonical sırayı daraltmaz veya yeniden tanımlamaz.

---

## 🛡️ 7. Teknik Kalite Kapıları ve Test Kriterleri

Geliştirilen her yeni özellik şu 5 kalite kapısından geçmek zorundadır:
1. **İdempotency:** Tekrarlanan hiçbir istek veritabanında çift kayıt, çift bilet veya mükerrer tahsilat üretmemelidir (`requestId` zorunluluğu).
2. **Denetim İzi (Audit Log):** Para hareketi, hesap kapama, indirim veya iptal yapan kullanıcının kimliği ve zamanı asla silinemez bir audit tablosuna yazılmalıdır.
3. **Şema İzolasyonu:** Hiçbir servis başka bir iş alanının tablosuna doğrudan SQL güncellemesi atamaz; işlemler sadece tanımlı domain servisleri ve event'ler üzerinden akar.
4. **Görsel Durum Dürüstlüğü:** Mock veri ile gerçek veri ekranda asla karıştırılmamalı, örnek veriler açıkça *"Örnek Gösterim"* etiketi taşımalıdır.
5. **Otomatik Testler:** Değişiklikler Node testleri (`npm test`), API testleri (`test:api`) ve PostgreSQL geçici veritabanı testlerinden (`npm run test:db`) hatasız geçmelidir.
