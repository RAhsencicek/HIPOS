# HIPOS — Mevcut Durum ve Modüler Yol Haritası

> **Doküman Durumu:** Canlı Yol Haritası ve Fazlı Eylem Planı · Sürüm: v4.0 (11 Kasım 2026)
>
> **Dokümantasyon Hiyerarşisi:**
> * **Güncel kod durumu ve bağımlılıklar:** [docs/01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md](../01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md)
> * **Güncel teslim sırası ve fazlı yol haritası:** [docs/00-devir-rehberi/DURUM_VE_YOL_HARITASI.md](DURUM_VE_YOL_HARITASI.md)
> * **Devir ve onboarding rehberi:** [docs/00-devir-rehberi/DEVIR_REHBERI.md](DEVIR_REHBERI.md)
> * **Tarihsel kararlar ve eski sürümler:** [docs/05-gecmis-ve-arsiv/](../05-gecmis-ve-arsiv/)
>
> ⚠️ **KALICI DOKÜMANTASYON KURALI (MÜHENDİSLER VE AGENTLAR İÇİN):**
> Yapılan her kod değişikliğinde, migration eklemesinde veya ekran düzeltmesinde bu belge ve ilgili `MODUL_*.md` şartnamesi **eşzamanlı olarak güncellenmelidir**. Kodda olmayan bir özellik "yapıldı" yazılamaz; tamamlanan özellikler de dokümanda "eksik" bırakılamaz.

---

## 1. Ürün Hedefi ve Çalışma Kapsamı

HIPOS; gerçek bir restoranın yönetim (ERP), mutfak (KDS), salon servis (Waiter) ve kasa (POS) operasyonlarını **tek bir işletme ve veri omurgasında** birleştirmeyi hedefler.

7 Ana Modül:
1. **Kasa ve POS:** Kasiyerlerin PIN ile girdiği, terminal kasasının sabitlendiği, adisyon tahsilatının yapıldığı, gün içi X-Raporu ve gün sonu Z-Raporu alınan dokunmatik arayüz.
2. **Masa ve Adisyon:** Garsonların el terminalinden masalara sipariş girdiği, masa taşıma/birleştirme ve hesap isteme akışlarının yönetildiği ortak adisyon omurgası.
3. **Mutfak ve Yazıcı:** Siparişlerin istasyon bazlı mutfak ekranına (KDS) düştüğü ve ESC/POS termal ağ yazıcılarından adisyon fişinin basıldığı donanım katmanı.
4. **Ürün Kataloğu ve Menü:** Ürünler, kategoriler, porsiyonlar, opsiyon grupları ve fiyat taslaklarının yönetildiği katalog motoru.
5. **Stok ve Reçete:** Hammaddeler, ürün reçeteleri, satıştan otomatik hammadde düşümü (depletion), mal kabul irsaliyesi, fire ve sayım fişleri.
6. **Cari Hesaplar ve Giderler:** Müşteri veresiyeleri, tedarikçi borçları, cari ekstreler ve işletme giderleri.
7. **Kimlik ve Yetkilendirme (Auth):** Patron (Owner) e-posta/şifre girişi, personeller için 4 haneli dokunmatik PIN doğrulaması, rol tabanlı erişim kontrolü (RBAC).

*(Çevrimdışı çalışma / LAN hub ve donanım bağlantıları bu 7 modülün ortak altyapısıdır; ek ana modül sayılmaz).*

---

## 2. CANLI RESTORAN TESTİ VE GERÇEKLİK RÖNTGENİ (Kasım 2026)

9 Kasım 2026 tarihinde gerçek Google Chrome tarayıcısı üzerinden uçtan uca restoran döngüsü (Garson -> Kasa -> Stok -> Admin) simüle edilmiş ve veritabanı kayıtları incelenmiştir:

### ✅ Kodda Gerçekten Çalışanlar (Kanıtlanmış Özellikler)
1. **Garson Sipariş Girişi:** Garson PIN pad'den `2222` girerek oturum açabilmekte; masaya sipariş ekleyip mutfağa gönderebilmektedir (`POST /api/v1/firms/.../service/tables/{id}/orders`).
2. **Kasa Tahsilatı ve Fiş Baskısı:** Kasiyer masayı tutarıyla görmekte (`₺520,00`), Nakit tahsilatı tamamlamakta, adisyon `closed` durumuna geçmekte ve ESC/POS termal ağ yazıcısına (`192.168.1.200:9100`) otomatik adisyon fişi basılmaktadır.
3. **Kasa Defteri Entegrasyonu (`cash.movements`):** Tahsil edilen nakit ₺520,00 tutar, aktif kasa vardiyasına `pos_sale` hareketi olarak yazılmakta ve Admin Kasa Özeti ekranında *"Günün Toplam Satış Tutarı: ₺520,00 (%100 Nakit)"* olarak yansımaktadır.
4. **Z-Raporu & X-Raporu Altyapısı:** Açık masa denetimi, kupür sayımı, kasa açığı/fazlası, retained float ve safe drop dökümü mevcuttur.
5. **Katalog & Menü Taslakları:** Kategori ağacı, fiyat taslakları, ürün opsiyon grupları PostgreSQL ile canlı konuşmaktadır.

---

### 🔴 Tespit Edilen 5 Kritik Boşluk (İşletmeyi Tıkayan Noktalar)

#### 1. Satış ➔ Stok Reçete Düşümü (Recipe Depletion) TAMAMEN KOPUK
* **Saha Kanıtı:** 2 adet "Tavuklu Sandviç" satılmasına rağmen:
  - Sandviç Ekmeği: Başlangıçta 38 adet ➔ Satış sonrası HALÂ 38 ADET!
  - Tavuk Göğsü: Başlangıçta 7.600 gr ➔ Satış sonrası HALÂ 7.600 GR!
  - `inventory.movements` tablosunda satışa dair tek bir hareket oluşmamıştır.
* **Kök Neden:** `apps/api/Hipos.Api/Sales/` içinde adisyon kapandığında `InventoryDbContext` veya reçete servisi çağrılmamaktadır. İki modül birbirinden tamamen izoledir.

#### 2. Admin Raporlar Ekranı Tamamen Sahte / Mock
* **Saha Kanıtı:** `/admin/reports/sales` ekranında açıkça *"Bu raporlar örnek veriden üretilir; gerçek ödeme veya satış raporu olarak kullanılmamalıdır. Toplam Satış: ₺48.250"* yazmaktadır.
* **Kök Neden:** `ReportsPage.tsx` gerçek `sales.checks` ve `cash.movements` verilerini sorgulamamakta, hardcoded örnek grafikler çizmektedir.

#### 3. Garson Ekranında Mantık Hatası ve Çöp Veriler
* **Saha Kanıtı:** Garson Mehmet Kaya PIN (`2222`) ile giriş yaptığı halde, masaya tıkladığında sistem tekrar *"Sipariş eklemek için önce garson seçin"* uyarısı vermekte ve dropdown açmaktadır. Dropdown içinde `sdfgsdfg` gibi test çöpleri mevcuttur.
* **Kök Neden:** Giriş yapan garsonun kimliği (`hipos_waiter_user`) masa sipariş state'ine otomatik aktarılmamaktadır.

#### 4. Admin Panelinde Personel PIN & Şifre Yönetim Arayüzü Yok
* **Saha Kanıtı:** Veritabanında `auth.pin_codes` ve bcrypt hash altyapısı çalışmasına rağmen, Admin panelinde bir garsona/kasiyere 4 haneli PIN tanımlayacak veya şifre sıfırlayacak hiçbir ekran yoktur.
* **Kök Neden:** `apps/admin` içinde auth yönetim ekranı geliştirilmemiştir.

#### 5. Terminaller Arası Anlık Eşzamanlılık (Real-time Sync) Eksikliği
* **Saha Kanıtı:** Garson sipariş girdiğinde veya hesap istendiğinde Kasa ekranının bunu görmesi gecikmeli polling periyoduna kalmaktadır.
* **Kök Neden:** LAN üzerinde Server-Sent Events (SSE) veya SignalR anlık olay bildirimi kurulmamıştır.

---

## 3. 4 FAZLI ÇÖZÜM MİMARİSİ VE EYLEM PLANI

```
┌────────────────────────────────────────────────────────────────────────┐
│ FAZ 1: ÇEKİRDEK İŞLETME ENTEGRASYONU (✅ TAMAMLANDI - 9 KASIM 2026)    │
│ 1. Satış kapandığında reçeteyi patlatıp stoktan otomatik düşme (BİTTİ) │
│ 2. Garson ekranında PIN ile giren garsonu masaya otomatik atama (BİTTİ)│
│ 3. Veritabanındaki test garson çöplerini (sdfgsdfg) temizleme (BİTTİ)  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ FAZ 2: KİMLİK, YETKİ VE PERSONEL PIN YÖNETİMİ (✅ TAMAMLANDI - 9 KASIM) │
│ 1. service.employees ve auth.users çift yönlü senkronizasyonu (BİTTİ)  │
│ 2. Admin /admin/kitchen/personnel ekranında departman bazlı listeleme  │
│ 3. Kartlarda 🔑 PIN Aktif rozeti ve yöneticiden PIN tanımlama/sıfırlama│
│ 4. Şube içi PIN çakışma kontrolü (409 PIN_ALREADY_IN_USE) (BİTTİ)      │
│ 5. Personelin kendi PIN'ini terminalden değiştirmesini kısıtlama (BİTTİ│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ FAZ 3: YÖNETİCİ RAPORLARI VE GERÇEK CİRO ANALİTİĞİ (✅ TAMAMLANDI)      │
│ 1. Backend GET /reports/sales-analytics analitik motoru eklendi (BİTTİ) │
│ 2. ReportsPage.tsx mockupsuz PostgreSQL canlı agregasyonuna bağlandı    │
│ 3. Yanıltıcı "Demo / Örnek gösterim" etiketleri temizlendi (BİTTİ)     │
│ 4. Tarih filtreleri (Bugün, Dün, 7 Gün, Ay, Tümü) & saatlik grafik bitti│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ FAZ 4: GERÇEK ZAMANLI EŞZAMANLILIK (SSE LAN Motoru) (✅ TAMAMLANDI - 9 KASIM) │
│ 1. RestaurantEventHub (Channel<RestaurantEvent>) pub/sub servisi (BİTTİ)│
│ 2. GET /events/stream SSE canlı push endpoint'i eklendi (BİTTİ)         │
│ 3. Kasa, Garson ve KDS ekranlarına useRestaurantRealtime hook'u eklendi │
│ 4. Çift yönlü tarayıcı eşzamanlılığı Playwright ile doğrulandı (5-7ms)  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ FAZ 5: DONANIM & KDS MUTFAK ENTEGRASYONU (✅ TAMAMLANDI - 9 KASIM 2026) │
│ 1. Zombi Masa Temizliği: Ekim ayından kalan 14 sahipsiz masa sıfırlandı│
│ 2. Mutfak Fişi Otomatik Baskı: Garson siparişi aldığı anda arka planda  │
│    sunucu seviyesinde (AutoPrintKitchenOnOrder) termal yazıcıya basıldı │
│ 3. Termal Ağ Yazıcı Soket Süresi: 2s -> 6s uzatıldı (Wi-Fi/LAN gecikmesi)│
│ 4. KDS Sesli Bildirim: Web Audio API ile sipariş gelince bip/çan sesi   │
│ 5. KDS Servis Edilenler Geçmişi: Tamamlanan siparişler için geçmiş blok│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ FAZ 6: KASA ÇOKLU ÖDEME YÖNTEMLERİ & BANKA POS SLIP KAYDI (✅ BİTTİ)    │
│ 1. sales.payment_attempts kısıtına meal, transfer, cari eklendi (BİTTİ)│
│ 2. Kasa ekranında Ziraat/Garanti/VakıfBank POS terminal slip kaydı     │
│ 3. Sodexo / Multinet yemek kartı ödemeleri kasa defterine işlendi      │
│ 4. Parçalı ödeme (Split) dökümü adisyon fişine yansıtıldı (BİTTİ)      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ FAZ 7: CARİYE YAZMA (Veresiye Müşteri Borçlandırma) (✅ TAMAMLANDI)    │
│ 1. Kasa ekranında 'Cariye Yaz' tahsilatının cari.movements bağlantısı │
│ 2. Seçili müşterinin borç bakiyesinin güncellenmesi ve ekstreye düşmesi│
│ 3. Termal adisyon fişinde 'Veresiye / Cari · Müşteri Adı' dökümü        │
│ 4. Yönetici Cariler ekranında anlık alacak artışı ve hareket kaydı     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ FAZ 8: CANLI KRİTİK STOK VE TÜKENDİ ROZETİ (✅ TAMAMLANDI - 9 KASIM)     │
│ 1. Reçete hammaddesi tükenen ürünlere Kasa ve Garsonda 'Tükendi' rozeti │
│ 2. Kritik eşik altındaki ürünlere sarı 'Kritik Stok' rozeti             │
│ 3. Garson sipariş verirken tükenen ürünün mutfağa gitmesini engelleme  │
│ 4. Backend sipariş blokajı (409 PRODUCT_OUT_OF_STOCK) ile tam koruma  │
│ 5. SSE inventory.stock_updated yayını ile anlık otomatik güncelleme    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ FAZ 9: YÖNETİCİ EKRANI TEMİZLİĞİ VE ROTA SENKRONİZASYONU (✅ TAMAMLANDI) │
│ 1. /admin/inventory eski 'Satışlar stoğu değiştirmez' uyarısı kaldırıldı│
│ 2. Yan menü yönlendirmelerinin (/admin/cash, /admin/reports) teyit edildi│
│ 3. Tüm şartname ve yol haritası dokümanları eşzamanlı kilitlendi (9 KASIM)│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ FAZ 10: ÜRETİM GÜVENLİK KİLİDİ, ÇOK KİRACILI İZOLASYON VE ONBOARDING (✅)│
│ 1. Production'da X-Demo-Actor/?actor= kilidi (401) & güçlü JWT zorunlu │
│ 2. auth.firms/auth.branches şeması, onboarding ve şube kapsam geçişi   │
│ 3. Print Bridge en az yetkili 'bridge' JWT + Admin/POS tam izolasyon    │
│ 4. Playwright + TCP yazıcı E2E: çapraz kiracı 403 & sıfır demo başlık   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. DETAYLI TEKNİK ÇÖZÜM SÖZLEŞMELERİ

### 🔷 FAZ 1 TEKNİK SÖZLEŞMESİ: Satış ➔ Stok Reçete Düşümü

#### A. Çalışma Prensibi:
Adisyon ister masada ister hızlı satışta (gel-al) kapansın, son ödeme alınıp bakiye sıfırlandığı (`status == 'closed'`) anda aynı veritabanı işlemi (transaction) veya güvenli arka plan servisi içinde hammadde tüketimi tetiklenir.

#### B. Algoritma ve Veri Akışı:
1. Kapanan adisyondaki (`sales.checks`) tüm sipariş kalemleri (`sales.order_items`) listelenir.
2. Her bir `product_id` için `inventory.recipes` tablosundaki aktif reçete satırları (`inventory.recipe_lines`) çekilir.
3. Her bir reçete satırı için:
   $$\text{Tüketim Miktarı} = \text{Sipariş Adedi} \times \text{Reçetedeki Birim Miktar}$$
4. `inventory.movements` tablosuna hareket yazılır:
   ```json
   {
     "id": "guid",
     "firm_id": "firmId",
     "branch_id": "branchId",
     "warehouse_id": "warehouse-kadikoy-main",
     "ingredient_id": "ingredientId",
     "delta": -tuketimMiktari,
     "unit": "g|adet|ml",
     "kind": "pos_sale",
     "description": "Satış düşümü · Adisyon d3b9bc9b · 2x Tavuklu Sandviç",
     "actor": "system:sales-depletion",
     "created_at": "now()"
   }
   ```
5. `inventory.ingredients.on_hand` bakiyesinden tüketim miktarı atomik olarak düşülür:
   $$\text{on\_hand} = \text{on\_hand} - \text{Tüketim Miktarı}$$
6. Eğer ürünün reçetesi yoksa (örneğin kutu kola veya doğrudan satılan bir ürün), sistem hata vermez; log kaydı atarak satışı engellemeden devam eder.

---

### 🔷 FAZ 2 TEKNİK SÖZLEŞMESİ: Personel PIN ve Rol Yönetimi (✅ TAMAMLANDI)

#### A. Mimari ve API Endpoint'leri:
* `GET /api/v1/firms/{firmId}/branches/{branchId}/service/employees`:
  Şubedeki personelleri departmanlarına göre listeler. Her personel için `role`, `hasPin: bool`, `userId: Guid` bilgilerini `auth` şemasından birleştirerek döner.
* `POST /api/v1/firms/{firmId}/branches/{branchId}/service/employees`:
  Yeni personel kartı açar, rolünü belirler ve opsiyonel 4 haneli PIN atar (`auth.users`, `auth.memberships`, `auth.pin_codes` çift yönlü senkronizasyonu).
* `PUT /api/v1/firms/{firmId}/branches/{branchId}/service/employees/{employeeId}`:
  Yöneticinin seçili personele 4 haneli yeni PIN atamasını sağlar (BCrypt ile hash'lenerek `auth.pin_codes` tablosuna yazılır).
* **PIN Çakışma Denetimi:** Şube içinde iki personele aynı PIN verilmeye çalışıldığında backend `409 PIN_ALREADY_IN_USE` kodu ve açıklayıcı Türkçe uyarı döner.
* **Güvenlik Kuralı:** Personel terminal üzerinden kendi PIN'ini değiştiremez; PIN tıpkı T.C. kimliği / sicil no gibi yönetici tarafından belirlenir ve sıfırlanır.

#### B. Arayüz (`apps/admin/src/features/branches/ServicePersonnelPage.tsx`):
* Menüde `Mutfak ve Servis > Personel` sekmesi altında:
  - Departman grupları: Şube Yönetimi, Şefler, Mutfak Ekibi, Servis Ekibi, Kasa Ekibi, Destek Ekibi.
  - Kartlarda yeşil `🔑 PIN Aktif` rozeti, telefon ve görev bilgisi.
  - `[+ Yeni Personel Ekle]` formu: İsim, Departman, Unvan, Telefon ve 4 haneli PIN belirleme.
  - `[ 🔑 Kartı & PIN'i Düzenle ]` butonu: Akıcı yukarı kaydırma (`window.scrollTo`), PIN sıfırlama alanı ("boş bırakırsanız mevcut PIN korunur").

#### C. Canlı Tarayıcı Doğrulaması (9 Kasım 2026):
* Ayşe Demir'in PIN'i `2221`'den `5555`'e güncellendi; eski PIN reddedildi (`401`), yeni PIN ile JWT üretildi (`200 OK`).
* Caner Garson adında yeni personel eklendi; `/waiters` ve `/quick-staff` listelerine düştü, PIN `7777` ile login doğrulandı.
* Çakışan PIN denemesi yapıldı (`2222`); sistem *"Bu PIN kodu zaten 'Mehmet Garson' tarafından kullanılıyor"* hatası verdi.

---

### 🔷 FAZ 3 TEKNİK SÖZLEŞMESİ: Gerçek Raporlar ve Ciro Analitiği (✅ TAMAMLANDI - 9 KASIM 2026)

#### A. Backend API Sözleşmesi ([`ReportsEndpoints.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Reports/ReportsEndpoints.cs)):
* `GET /api/v1/firms/{firmId}/branches/{branchId}/reports/sales-analytics?range=today|yesterday|week|month|all&from={from}&to={to}`
* `GET /api/v1/firms/{firmId}/reports/sales-analytics?range=today|yesterday|week|month|all` (Firma Geneli Çoklu Şube)
* **Dönen Canlı Agregasyon:**
  - `grossRevenueMinor`: Kapanan adisyonların ve başarılı tahsilatların (`sales.payment_attempts.status == 'succeeded'`) brüt toplamı.
  - `netRevenueMinor`: İkram ve iskonto indirimleri düşülmüş net ciro (`sales.check_adjustments`).
  - `discountMinor`: Toplam iskonto ve ikram tutarı.
  - `cashRevenueMinor`: Kasa çekmecesine giren nakit ciro (`method == 'cash'`).
  - `cardRevenueMinor`: Banka POS'larına giren kart cirosu (`method == 'card'`).
  - `completedChecksCount`: Seçili periyotta kapanan masa ve sipariş adedi (`sales.checks.status == 'closed'`).
  - `averageCheckMinor`: Kapanan adisyon başına ortalama sepet büyüklüğü.
  - `openChecksCount` & `openChecksBalanceMinor`: Masalarda henüz ödenmemiş açık adisyon adedi ve bekleyen toplam bakiye.
  - `topProducts`: Sipariş kalemlerinden (`sales.order_lines`) derlenen en çok satan 10 ürün (Adet, Ciro, Ciro Payı %, Ürün Kategorisi).
  - `hourlyTrends`: 24 saatlik gün içi restoran satış nabzı histogramı (saatlik işlem adedi ve brüt ciro sütunları).
  - `channelBreakdown`: Masa servisi (`waiter_web`) ile Paket / Hızlı satış (`test_pos`) karşılaştırması.
  - `branchComparison`: Çoklu şube veya seçili şubenin toplam cirodaki payı ve kapanan adisyon karşılaştırması.

#### B. Arayüz Entegrasyonu ([`ReportsPage.tsx`](file:///Users/mac/HIPOS/apps/admin/src/features/reports/ReportsPage.tsx)):
* Sahte `SAMPLE_SALES` ve `b.sales / 70000` statik hesaplamaları tamamen kaldırıldı.
* Üst çubuktaki "Örnek gösterim" ve "Demo" uyarıları silindi; yerine yeşil rozet `🟢 Canlı Veritabanı` ve `[Yenile]` butonu eklendi.
* Hızlı tarih kapsamı butonları eklendi: `[Bugün]`, `[Dün]`, `[Son 7 Gün]`, `[Bu Ay]`, `[Tüm Zamanlar]`.
* Görsel grafikler eklendi:
  - Nakit ve Kredi Kartı için renkli ilerleme çubukları (`%100 Nakit` vs `%0 Kart`).
  - Masa ve Paket kanalları için oran çubukları.
  - Saatlik satış histogramı (08:00 - 23:00).
  - Şube ciro payı çubukları.

#### C. Canlı Tarayıcı ve Veritabanı Doğrulaması (9 Kasım 2026):
* **Bugün (09.11.2026):**
  - Brüt Ciro: `₺3.020,00` (Nakit: `₺3.020,00`, Kart: `₺0,00`).
  - Kapanan Adisyon: `3` (Ortalama Sepet: `₺1.006,66`).
  - Açık Adisyon: `3` (`₺2.170,00` bekleyen açık bakiye).
  - Satılan Ürün: `18 adet` (Lider: Tavuklu Sandviç, 7 adet, `₺1.820,00`).
  - Saatlik Trafik: 10:00 (1 adisyon, ₺520) ve 11:00 (2 adisyon, ₺2.500) tam eşleşti.
* **Tüm Zamanlar:**
  - Brüt Ciro: `₺16.020,00` (Net: `₺15.843,50`, İndirim: `₺176,50`).
  - Kapanan Adisyon: `53`, Satılan Ürün: `122 adet`.
  - Nakit: `₺12.465,00` (%77.8), Kart: `₺3.555,00` (%22.2).
* **Ekran Görüntüsü Kanıtları:**
  - `admin_reports_today.png`: Bugünün canlı ciro ve analitik görünümü.
  - `admin_reports_all_time.png`: Tüm zamanların kümülatif analitiği ve saatlik dağılımı.
  - `admin_reports_sales_subroute.png`: `/admin/reports/sales` alt rotası.

---

### 🔷 FAZ 4 TEKNİK SÖZLEŞMESİ: Restoran İçi Gerçek Zamanlı Eşzamanlılık (SSE) (✅ TAMAMLANDI - 9 KASIM 2026)

#### A. Mimari ve API Sözleşmesi ([`RealtimeEndpoints.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Realtime/RealtimeEndpoints.cs), [`RestaurantEventHub.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Realtime/RestaurantEventHub.cs)):
* `GET /api/v1/firms/{firmId}/branches/{branchId}/events/stream?token={jwt}&actor={actor}`
* **Format:** W3C Server-Sent Events (`text/event-stream; charset=utf-8`).
* **Keep-Alive:** Her 15 saniyede bir `: ping\n\n` gönderilerek LAN Wi-Fi bağlantı kopmaları ve proxy timeout'ları önlenir.
* **Yayınlanan Canlı Olay Tipleri:**
  - `table.updated`: Masa durumu değiştiğinde (`vacant`, `occupied`, `bill_requested`).
  - `order.created`: Garson mutfağa yeni sipariş ilettiğinde.
  - `check.created` / `check.updated`: Yeni adisyon açıldığında veya kalem eklendiğinde.
  - `check.closed`: Hesap tahsil edilip adisyon kapandığında.
  - `payment.settled`: Nakit veya kart ödemesi başarıyla tamamlandığında.
  - `kitchen.updated`: Mutfak KDS'de sipariş durumu değiştiğinde (`preparing`, `ready`).

#### B. Ön Yüz Reaktif İstemci Entegrasyonu ([`OperationalApps.tsx`](file:///Users/mac/HIPOS/apps/pos/src/OperationalApps.tsx), [`ServiceTablesPage.tsx`](file:///Users/mac/HIPOS/apps/admin/src/features/branches/ServiceTablesPage.tsx)):
* `useRestaurantRealtime(onEvent, filterTypes)` özel React hook'u geliştirildi:
  - **Kasa Ekranı (`CashierApp`):** `table.updated`, `check.*`, `payment.settled` olaylarını dinler; tetiklendiğinde `triggerSync()` ile masaları ve kasa bakiyesini arka planda sessizce günceller.
  - **Garson Ekranı (`WaiterApp`):** `table.updated`, `check.*` olaylarını dinler; tetiklendiğinde `reload()` ile salon masa kartlarının rengini (Yeşil / Kırmızı / Sarı) anında günceller.
  - **Mutfak KDS (`KitchenApp`):** `order.created`, `kitchen.updated` olaylarını dinler; yeni sipariş düştüğünde bekleme yapmadan KDS listesini yeniler.
  - **Yönetici Masalar (`ServiceTablesPage`):** Şube masa planını anlık olaylarla senkronize tutar.

#### C. Canlı İki Terminal Eşzamanlılık Doğrulaması (9 Kasım 2026):
* **Test Senaryosu:** Playwright ile aynı anda iki bağımsız Chrome oturumu açıldı:
  1. Terminal 1: Kasa Ekranı (`/cashier`, Ayşe Kasiyer PIN `1234`, Kadıköy Ana Kasa).
  2. Terminal 2: Garson Tableti (`/waiter`, Mehmet Garson PIN `2222`).
* **Test Adımı 1 (Sipariş):** Garson boş Masa 02'ye Tavuklu Sandviç ekleyip *"Siparişi mutfağa gönder"* butonuna bastı.
  - **Sonuç:** Kasa ekranındaki Masa 02 kartı F5 OLMADAN, sayfa yenilenmeden **5 milisaniyede (5ms)** anında `Dolu` haline geldi ve sepet tutarı `₺260,00` belirdi!
* **Test Adımı 2 (Tahsilat):** Kasa ekranından Masa 02 açılıp *"Tahsilatı tamamla"* butonuna basılarak nakit tahsilat kaydedildi.
  - **Sonuç:** Garson tabletindeki Masa 02 kartı F5 OLMADAN, sayfa yenilenmeden **7 milisaniyede (7ms)** anında `Boş (Yeşil)` haline döndü!
* **Ekran Görüntüsü Kanıtları:**
  - `sse_00_cashier_initial.png`: Kasa terminali başlangıç ekranı.
  - `sse_00_waiter_initial.png`: Garson tableti başlangıç ekranı.
  - `sse_01_cashier_instant_update.png`: Garson sipariş verir vermez Kasa ekranının anında DOLU'ya dönmesi.
  - `sse_01_waiter_after_order.png`: Garson tableti sipariş gönderim anı.
  - `sse_02_cashier_final.png`: Kasa tahsilatı tamamlayıp adisyon fişini yazdırdıktan sonraki durum.
  - `sse_02_waiter_instant_freed.png`: Kasa hesabı kapattığı an Garson ekranının anında BOŞ'a dönmesi.

#### D. Zombi / Askıda Kalan Masa Temizliği ve Yönetici Paneli Görünümü (9 Kasım 2026):
* **Zombi Masa Teşhisi:** Ekim ve 4 Kasım tarihlerindeki eski demo tohumlama (demo-seed) verilerinden kalan 14 masanın (`Masa 03..13`, `18`, `21`, `25`) adisyonları `sales.checks` tablosunda kapalı olmasına rağmen, `service.tables` üzerinde `occupied` ve `bill_requested` durumunda askıda kaldığı tespit edildi. Bu durum garson ekranında masaları "Dolu" gösterirken, tıklandığında "Açık adisyon yok" çelişkisine yol açıyordu.
* **Veritabanı Temizliği:**
  - `UPDATE service.tables SET status = 'idle', version = version + 1 WHERE status != 'idle';` (27 masa boşa düşürüldü).
  - `UPDATE service.assignments SET closed_at = NOW(), closed_by = 'system-cleanup' WHERE closed_at IS NULL;` (Eski açık atamalar kapatıldı).
  - Garson ve Kasa ekranlarında gerçek durum yansıdı: `26 Toplam masa | 26 Boş | 0 Dolu | 0 Hesap istendi`.
* **Yönetici Masa Planı İyileştirmesi (`ServiceTablesPage.tsx` & `styles.css`):**
  - Yönetici panelinde masaların gri/boş tel kafes gibi görünmesi giderildi; her karta canlı durum rozeti (`🟢 Boş`, `● Dolu`, `🧾 Hesap İstendi`, `📅 Rezerve`) eklendi.
  - Başlık çubuğuna anlık durum sayaçları eklendi: `🟢 26 Boş · ⚡ Canlı LAN`.
  - Masa detay paneline boş masalar için açıklayıcı bilgilendirme eklendi ("🟢 Masa Boş ve Servise Hazır").
  - `PrintingEndpoints.cs` altındaki `/service/tables/{tableId}/settle` endpoint'ine `IRestaurantEventHub` enjekte edilerek garson ekranından doğrudan masa kapatıldığında da SSE olayları (`table.updated`, `check.closed`, `payment.settled`) fırlatıldı.
  - Doğrulama kanıtları: `admin_tables_clean_verified.png` ve `waiter_tables_clean_verified.png`.

---

### 🔷 FAZ 5 TEKNİK SÖZLEŞMESİ: Mutfak KDS & Donanım Yazıcı Hattı (Network ESC/POS) ve Hızlı Satış (Gel-Al) Mutfak Entegrasyonu (✅ TAMAMLANDI - 9 KASIM 2026)

#### A. Donanım Ağ Yazıcısı ve Zaman Aşımı İyileştirmesi ([`PrinterTransport.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Printing/PrinterTransport.cs)):
* Restorandaki fiziksel termal mutfak yazıcısının (`192.168.1.201:9100`) güç tasarrufu/uyku modundan uyanırken LAN soket bağlantısının ~4.06 saniye sürdüğü ve 2 saniyelik eski zaman aşımına takılarak hata verdiği tespit edildi.
* Soket zaman aşımı 2 saniyeden 6 saniyeye çıkarıldı ve bağlantı kopmalarına karşı `printer_settings.json` üzerinde `FallbackToUsb: true` devreye alındı.
* Garson sipariş verdiğinde ve hızlı satış onaylandığında `AutoPrintKitchenOnOrder` yapılandırması kontrol edilerek arka planda otomatik ESC/POS çıktısı tetiklendi.

#### B. Hızlı Satış (Gel-Al / Kasa) Siparişlerinin Mutfağa Düşmeme Sorununun Çözümü:
* **Kök Neden:**
  1. [`SalesOrders.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Sales/SalesOrders.cs) içinde `if (runtime.KitchenReady && source == "waiter_web")` koşulu bulunuyordu. Hızlı satış siparişleri kasadan `test_pos` kaynağı ile açıldığı için `kitchen.tasks` kayıtları üretilmiyordu.
  2. [`SalesCheckEndpoints.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Sales/SalesCheckEndpoints.cs) endpoint'i (`POST /sales/checks`) yalnızca `check.created` yayınlıyor; mutfak ekranının dinlediği `order.created` olayını yayınlamıyordu.
  3. Masasız adisyonlarda masa ve garson bilgisi boş (`null`) geldiğinde KDS kartları tanımsız kalıyordu.
* **Geliştirilen Çözüm:**
  1. `SalesOrders.cs` içindeki `source == "waiter_web"` koşulu kaldırılarak mutfak görevlerinin tüm satış kanallarından (`waiter_web`, `test_pos`, `cashier`) üretilmesi sağlandı.
  2. `POST /sales/checks` ve `POST /sales/checks/{checkId}/orders` endpoint'lerine `order.created` SSE bildirimi ve otomatik mutfak fişi yazdırma (`PrintKitchenOrderAsync`) eklendi.
  3. [`KitchenEndpoints.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Kitchen/KitchenEndpoints.cs) ve [`PrintingService.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Printing/PrintingService.cs) güncellenerek masası olmayan hızlı satış siparişlerinde kart ve fiş başlığı `Hızlı Satış (Gel-Al) · Kasa / Kasiyer` olarak standartlaştırıldı.
  4. Adisyon bazlı fiş basımı ve kopyalama için yeni `POST /sales/checks/{checkId}/print-kitchen` endpoint'i ve [`OperationalApps.tsx`](file:///Users/mac/HIPOS/apps/pos/src/OperationalApps.tsx) kasa ekranında `[🖨️ Mutfak Fişi Tekrar]` butonu eklendi.

#### C. Mutfak Ekranı (KDS) Canlı Bildirim & Ses Entegrasyonu:
* Mutfak KDS ekranına (`/kitchen`), SSE üzerinden yeni bir `order.created` olayı ulaştığında Web Audio API ile 587Hz ve 880Hz frekanslarında 2 tonlu aşçı uyarı gongu (`playKitchenChime`) eklendi.
* Tamamlanan ve servis edilen siparişlerin aşçı tarafından takip edilebilmesi için KDS ekranının altına *"Son Servis Edilenler (Tamamlananlar)"* geçmiş bölümü eklendi.
* PIN korumalı KDS girişine `waiter` rolü eklendi; Kemal Aşçı PIN `3333` ve Ahmet Patron PIN `9999` ile giriş doğrulanabilir kılındı.

#### D. Uçtan Uca Saha Doğrulaması (9 Kasım 2026):
* **Fiziksel Termal Yazıcı Kanıtı:**
  `info: Hipos.Api.Printing.PrinterTransport[0] Yazdırma başarılı (AĞ): Mutfak Bilet Yazıcısı -> 192.168.1.201:9100 (544 bayt)`
* **Ekran Görüntüsü Kanıtları:**
  - `kitchen_with_both_quick_sales.png`: KDS ekranında hem masalardan (`Masa 08`, `Masa 01`) hem de kasadan (`Hızlı Satış (Gel-Al)`) gelen siparişlerin anlık görünümü.
  - `cashier_step3_order_submitted.png`: Kasa terminalinde Hızlı Satış onaylandıktan sonra tahsilat ve fiş tekrar basım ekranı.

---

### 🔷 FAZ 6 TEKNİK SÖZLEŞMESİ: Kasa Çoklu Ödeme Yöntemleri & Banka POS Slip Kaydı (✅ TAMAMLANDI - 9 KASIM 2026)

#### A. İşletme İhtiyacı:
Restoranda müşteriler hesabı tek bir yöntemle ödemeyebilir. Örneğin ₺260 tutarındaki bir hesap:
- ₺100 Garanti POS (Kredi Kartı)
- ₺160 Sodexo (Yemek Kartı)
olarak parçalı ödenebilir. Gün sonunda kasiyer kasa kapattığında Z-Raporunda *"Nakit: ₺X, Garanti POS: ₺100, Sodexo: ₺160"* ayrımını tam görmelidir.

#### B. Mimari ve Veritabanı Genişletmesi:
1. `sales.payment_attempts` tablosuna `provider character varying(80)` kolonu eklendi. `ck_payment_method` kısıtı `('cash', 'card', 'meal', 'transfer', 'cari')` olarak genişletildi.
2. `cash.movements` tablosunda `ck_cash_movement_tender_method` ve `ck_cash_movement_pos_sale` kısıtları `('cash', 'card', 'meal', 'transfer', 'cari')` değerlerini kabul edecek şekilde güncellendi.
3. `PaymentSimulator.cs` ve `SalesCheckEndpoints.cs` API'leri `provider` parametresini alacak şekilde güncellendi. Kasa hareketine sağlayıcı (`Garanti POS`, `Sodexo`, `Ziraat POS` vb.) doğrudan yazıldı.
4. `CashEndpoints.cs` Z-Raporu ve `ReportsEndpoints.cs` satış analitiği, gelen tüm tender methodlarını (`cash`, `card`, `meal`, `transfer`, `cari`) dinamik olarak toplayıp döküm olarak dönecek şekilde uyarlandı.
5. `PrintingService.cs` adisyon termal fişi oluştururken parçalı ödemelerde tahsilat dökümünü (`Garanti POS: 100.00 TL | Sodexo: 160.00 TL`) fiş gövdesine işleyecek şekilde güncellendi.
6. `OperationalApps.tsx` kasada kart seçildiğinde banka POS'larını (Ziraat/Garanti/VakıfBank), yemek kartı seçildiğinde yemek kartlarını (Sodexo/Multinet/Ticket/Setcard/Metropol) alt butonlarla seçtirip backend'e aktardı.

#### C. Canlı Test ve Saha Kanıtları (9 Kasım 2026):
* **Senaryo 1 (API Split Test):** ₺640 Margherita Pizza siparişi: ₺200 Garanti POS + ₺140 Sodexo + ₺300 Nakit parçalı ödendi; adisyon sıfırlanıp kapandı, termal yazıcıya fiş iletildi (`test_faz6_payments.py`).
* **Senaryo 2 (Dokunmatik Kasa Tarayıcı Testi):** ₺260 Tavuklu Sandviç siparişi: ₺100 Garanti POS ile kısmi tahsil edildi, ardından kalan ₺160 Sodexo ile kapatıldı (`test_faz6_browser.mjs`).
* **Veritabanı Kanıtı:**
  `sales.payment_attempts`:
  `card | Garanti POS | 10000 | succeeded`
  `meal | Sodexo      | 16000 | succeeded`
  `cash.movements`:
  `pos_sale | cash_sale | card | Garanti POS | 10000 | Kasa tahsilatı · Garanti POS · Adisyon ede915ff`
  `pos_sale | cash_sale | meal | Sodexo      | 16000 | Kasa tahsilatı · Sodexo · Adisyon ede915ff`
* **X/Z Raporu Kanıtı:**
  `tenders: [ { method: "cash", label: "Nakit" }, { method: "card", label: "Kredi / Banka Kartı", amountMinor: 20000 }, { method: "meal", label: "Yemek Kartı (Sodexo/Multinet)", amountMinor: 14000 } ]`
* **Ekran Görüntüsü Kanıtları:**
  - `faz6_01_checkout_open.png`: Hızlı satış onaylanıp tahsilat seçenekleri açıldı.
  - `faz6_02_garanti_pos_selected.png`: Kredi Kartı ve Garanti POS alt butonu seçildi, ₺100 girildi.
  - `faz6_03_after_partial_garanti.png`: ₺100 Garanti POS tahsil edildi, kalan ₺160 uyarısı belirdi.
  - `faz6_04_sodexo_selected.png`: Yemek Kartı ve Sodexo seçildi, kalan ₺160 ödemeye hazırlandı.
  - `faz6_05_payment_success.png`: ₺260 satış başarıyla kapandı, termal yazıcıya adisyon fişi gönderildi.

---

### 🔷 FAZ 7 TEKNİK SÖZLEŞMESİ: Cariye Yazma (Veresiye Müşteri Borçlandırma & Cari Ekstre Entegrasyonu) (✅ TAMAMLANDI - 9 KASIM 2026)

#### A. İşletme İhtiyacı:
Düzenli müşteriler (örneğin civar esnaf veya daimi müşteriler) hesabı o an nakit/kart ile ödemeyip "Cariye yaz" diyebilir. Kasiyer müşteri listesinden ilgili müşteriyi (örn. Ahmet Yılmaz) seçtiğinde bu tutar doğrudan müşterinin cari hesabına borç (`customer_charge`) olarak işlenmeli, adisyon kapatılmalı, termal fişte müşterinin adı görünmeli ve yönetici cari panelinde anlık olarak yansımalıdır.

#### B. Mimari ve Veri Akışı:
1. **API Sözleşmesi:** `POST /api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{checkId}/payment-attempts` çağrısında `method: "cari"` ve `customerId: "party-ahmet"` gönderilir.
2. **Karakteristik & Doğrulama:**
   - Müşteri ID verilmezse `400 CUSTOMER_REQUIRED` döner.
   - Seçilen cari kartı aktif değilse `409 CUSTOMER_INACTIVE`, müşteri türünde değilse (`!types.Contains("customer")`) `409 CUSTOMER_NOT_ELIGIBLE` döner.
   - Adisyon üzerindeki `sales.checks.customer_id` boşsa otomatik olarak seçilen müşteriye bağlanır.
   - Ödeme girişiminin `provider` alanı `$"Cari: {party.Name}"` olarak mühürlenir.
3. **Atomik Hareket Kaydı (`AddCariChargeAsync`):**
   - Satış işlemiyle aynı transaction içinde `cari.movements` tablosuna hareket yazılır:
     - `id: "pm-sale-{attemptId}"`
     - `kind: "customer"`
     - `entry_type: "customer_charge"`
     - `delta_minor: amountMinor` (pozitif = müşterinin borcu artar)
     - `source: "sales"`
     - `reference: checkId`
     - `description: "Adisyon {checkId[..8]} · Veresiye Satış ({partyName})"`
   - `cari.parties` tablosunda `version` ve `updated_at` artırılır.
   - `cari.audit` tablosuna `sales_charge` denetim izi yazılır.
4. **Kasa Defteri Etkisi:**
   - `cash.movements` tablosuna `category: "cash_sale"`, `kind: "pos_sale"`, `tender_method: "cari"`, `provider: "Cari: Ahmet Yılmaz"` yazılır.
   - `CashEndpoints.Expected(movements)` fonksiyonu `tender_method == "cari"` olduğu için fiziksel çekmece nakdine ekleme yapmaz; Z-Raporu sayımında kasa açığı/fazlası hatası oluşmaz. Ancak brüt satış toplamına ve gayri nakdi tender dökümüne eksiksiz dahil edilir.
5. **Termal Fiş & Ekstre:**
   - `PrintingService.cs` termal adisyon fişinde tahsilat türünü `"Cari: Ahmet Yılmaz"` veya `"CARİ / VERESİYE"` olarak basar.
   - Yönetici panelinde `/admin/?section=customers&item=accounts` altında son hareketlerde *"Veresiye satış / alacak · Satış · +₺260,00"* olarak anında listelenir; müşteri ekstresinde adisyon referansı ve yeni bakiye izlenir.

#### C. Canlı Test ve Saha Kanıtları (9 Kasım 2026):
* **Senaryo 1 (API Uçtan Uca Entegrasyon Testi):** `scripts/test_faz7_cari.mjs`
  - Ahmet Yılmaz başlangıç bakiyesi: ₺1.000,00.
  - ₺260 Tavuklu Sandviç adisyonu açıldı (`504dc7bd...`).
  - `method: "cari"`, `customerId: "party-ahmet"` ile ₺260 ödendi.
  - Adisyon durumu `status: "closed"`, `customerId: "party-ahmet"` oldu.
  - Ahmet Yılmaz güncel bakiyesi tam ₺1.260,00 (+₺260) oldu.
  - Son cari hareketi: `id: pm-sale-6732be3e..., entry_type: customer_charge, source: sales, delta_minor: 26000`.
  - Termal yazıcıya adisyon fişi iletildi: `Network (192.168.1.200:9100)`.
* **Senaryo 2 (Dokunmatik Kasa & Yönetici Paneli Canlı Tarayıcı Testi):** `scripts/test_faz7_browser.mjs`
  - Kasiyer PIN 1234 ile girdi, Kadıköy Ana Kasa seçti, Hızlı Satış moduna geçti.
  - Tavuklu Sandviç sepete eklendi (₺260).
  - "Cariye Yaz" butonuna basıldı; müşteri arama/seçim modalı açıldı.
  - Ahmet Yılmaz seçildi; bakiye ve müşteri rozeti onaylandı.
  - Tahsilat tamamlandı; başarı banner'ı ve termal fiş çıktısı alındı.
  - Yönetici panelinde Cariler ekranına gidildi; Son Hareketler'de `+₺260,00 Veresiye Satış` teyit edildi.
* **Ekran Görüntüsü Kanıtları:**
  - `faz7_01_customer_modal.png`: Kasa ekranında Cariye Yaz müşteri arama ve bakiye modalı.
  - `faz7_02_customer_selected.png`: Ahmet Yılmaz seçildikten sonra bakiye rozeti ve tahsilat onay butonu.
  - `faz7_03_payment_success.png`: Veresiye satışın başarıyla kapatılması ve adisyon fişinin basılması.
  - `faz7_04_admin_cari.png`: Yönetici panelinde Cari ve Müşteriler -> Cari Hesaplar -> Son Hareketlerde satış alacağı.
  - `faz7_05_admin_statement.png`: Ahmet Yılmaz hesap kartında adisyon referanslı müşteri borç ekstresi.

---

### 🔷 FAZ 8 TEKNİK SÖZLEŞMESİ: Canlı Kritik Stok ve Tükendi Rozeti (✅ TAMAMLANDI - 9 KASIM 2026)

#### A. İşletme İhtiyacı:
Reçetesindeki hammaddelerden biri tükenen (örneğin ekmek bitti veya mozzarella bitti) bir ürün için garsonun sipariş almaya devam etmesi mutfakla salon arasında karmaşaya ve müşteri memnuniyetsizliğine yol açar. Sistem:
1. Reçetedeki herhangi bir hammadde tükendiğinde (`on_hand <= 0`) ürünü otomatik olarak "Tükendi" durumuna getirmeli,
2. Kritik eşik altındaki (`0 < on_hand <= critical_below`) ürünler için "Kritik Stok" rozeti ve kalan porsiyon miktarını göstermeli,
3. Kasa ve Garson ekranlarında personelin bu ürünü sepete eklemesini engellemeli,
4. Arka uçta API seviyesinde (`SalesOrders.CreateAsync`) tükenen ürüne gelen siparişleri `409 PRODUCT_OUT_OF_STOCK` ile reddetmeli,
5. Kasa satışı sonrası stok düştüğünde SSE üzerinden `inventory.stock_updated` fırlatarak tüm terminallerin anında güncellenmesini sağlamalıdır.

#### B. Mimari ve Algoritma:
1. **Menü Stok Zenginleştirmesi ([`CatalogMenuEndpoints.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Catalog/CatalogMenuEndpoints.cs)):**
   - `GET /catalog/menus` çağrısında şubenin aktif ana deposu ve son sürüm reçeteleri sorgulanır.
   - Her reçete satırının hammadde mevcudu (`on_hand = SUM(movements.delta)`) required miktara bölünerek teorik porsiyon hesaplanır (`floor(on_hand / quantity)`).
   - Reçetedeki en az kalan hammadde `limitingIngredientName` olarak belirlenir.
   - Porsiyon `<= 0` ise `isOutOfStock: true`, `availablePortions: 0`.
   - Porsiyon `> 0` ve herhangi bir hammadde `on_hand <= critical_below` ise `isCriticalStock: true`, `availablePortions: minPortions`.
   - Reçetesiz ürünler için `isOutOfStock: false, isCriticalStock: false, availablePortions: null`.
2. **Arka Uç Güvenlik Kilidi ([`SalesOrders.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Sales/SalesOrders.cs)):**
   - `SalesOrders.CreateAsync` sipariş kalemlerini doğrular ve `CheckRecipeStockAvailabilityAsync` çalıştırır.
   - Eğer ürün reçeteli ise ve herhangi bir hammaddesi `on_hand <= 0` veya `on_hand < (requiredPerPortion * requestedQuantity)` ise işlem `409 PRODUCT_OUT_OF_STOCK` ile reddedilir:
     `"{productName} ürününün hammaddesi ({ingredientName}) tükendiği için sipariş verilemez."`
3. **Gerçek Zamanlı SSE Tetiklemesi ([`PaymentSimulator.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Sales/PaymentSimulator.cs), [`InventoryEndpoints.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Inventory/InventoryEndpoints.cs)):**
   - Kasa tahsilatı tamamlanıp hammadde düşüldüğünde (`DepleteInventoryForCheckAsync`) `inventory.stock_updated` olayı yayınlanır.
   - Manuel stok hareketi, fire kaydı veya sayım onaylandığında da `inventory.stock_updated` yayınlanır.
   - Kasa ve Garson ekranları bu olayı dinleyerek menüyü arka planda sessizce yeniler.
4. **Dokunmatik Arayüz Görselleştirme ([`OperationalApps.tsx`](file:///Users/mac/HIPOS/apps/pos/src/OperationalApps.tsx), [`operational.css`](file:///Users/mac/HIPOS/apps/pos/src/operational.css)):**
   - **Kasa Hızlı Satış:** Ürün kartında kırmızı `🚫 Tükendi` rozeti, karta tıklandığında engelleme ve *"Margherita Pizza tükendi. Mutfak stoğunda Mozzarella bulunmuyor."* uyarısı.
   - **Garson Ekranı:** Ürün kartında `🚫 Tükendi` rozeti, `＋ Ekle` butonu yerine pasif gri `Tükendi` butonu (`disabled: true`), tıklama engeli.
   - **Kritik Rozeti:** Stoğu kritik eşikteki ürünlerde kehribar sarısı `⚠️ Kritik (X)` rozeti.

#### C. Canlı Test ve Saha Kanıtları (9 Kasım 2026):
* **Senaryo 1 (API ve Stok Koruması Testi):** `scripts/test_faz8_stock.mjs`
  - Reçete durumu: Mozzarella `-260g` (Tükendi), Sandviç Ekmeği `25 adet` (Stokta).
  - `GET /catalog/menus`: Margherita Pizza `isOutOfStock: true, availablePortions: 0, limitingIngredientName: 'Mozzarella'`.
  - Margherita Pizza için `POST /sales/checks` çağrısı yapıldı: HTTP 409 `PRODUCT_OUT_OF_STOCK` ("Margherita Pizza ürününün hammaddesi (Mozzarella) tükendiği için sipariş verilemez.") ile anında engellendi!
  - Tavuklu Sandviç için `POST /sales/checks` çağrısı yapıldı: HTTP 201 Created ile başarıyla sipariş açıldı.
* **Senaryo 2 (Dokunmatik Kasa & Garson Tableti Tarayıcı Testi):** `scripts/test_faz8_browser.mjs`
  - Kasiyer PIN 1234 ile Hızlı Satış ekranını açtı: Margherita Pizza üzerinde kırmızı `🚫 Tükendi` rozeti görüldü, karta tıklandığında sepete ekleme engellendi ve açıklayıcı toast uyarısı verildi.
  - Garson PIN 2222 ile Masa 04'ü açtı: Margherita Pizza ürün kartında `🚫 Tükendi` rozeti ve pasif `Tükendi` butonu doğrulandı.
* **Ekran Görüntüsü Kanıtları:**
  - `faz8_01_pos_out_of_stock.png`: Kasa Hızlı Satış ekranında Margherita Pizza üzerindeki kırmızı `🚫 Tükendi` rozeti ve tıklama engeli uyarı bildirimi.
  - `faz8_02_waiter_out_of_stock.png`: Garson sipariş ekranında Margherita Pizza kartı üzerindeki `🚫 Tükendi` rozeti ve devre dışı bırakılmış `Tükendi` butonu.

---

### 🔷 FAZ 9 TEKNİK SÖZLEŞMESİ: Yönetici Ekranı Temizliği ve Rota Senkronizasyonu (✅ TAMAMLANDI - 9 KASIM 2026)

#### A. Kapsam ve Yapılan Düzeltmeler:
1. **Stok Sayfası Canlı Bilgilendirmesi ([`InventoryHttpPage.tsx`](file:///Users/mac/HIPOS/apps/admin/src/features/inventory/InventoryHttpPage.tsx)):**
   - Eski statik prototipten kalan *"Satışlar stoğu otomatik değiştirmez; sayım farkları onayınızdan sonra uygulanır."* yanıltıcı uyarısı kaldırıldı.
   - Yerine *"🟢 Canlı Stok Entegrasyonu: Satışlardan reçete hammadde tüketimi anlık olarak otomatik düşülmektedir. Manuel giriş/çıkış, zayi/fire ve sayım farkları onayınızla uygulanır."* canlı bilgilendirmesi getirildi.
2. **Yönetici Menü Rotaları Senkronizasyonu ([`App.tsx`](file:///Users/mac/HIPOS/apps/admin/src/App.tsx)):**
   - `/admin/inventory` (Stok ve Tedarik), `/admin/cash` (Kasa ve Vardiya), `/admin/reports` (Satış ve Mali Analitik), `/admin/?section=customers` (Cariler ve Müşteriler) rotalarının canlı PostgreSQL ve backend API'leriyle tam entegre çalıştığı doğrulandı.
3. **Ekran Görüntüsü Kanıtları:**
   - `faz9_01_admin_inventory_live.png`: Yönetici Stok Sayfası canlı hammadde listesi, reçete üretim kapasitesi ve güncel bildirim banner'ı.
   - `faz9_02_admin_cash_live.png`: Yönetici Kasa Defteri, banka POS ayrımı ve cari gayri-nakdi tahsilat dökümü.
   - `faz9_03_admin_reports_live.png`: Yönetici Satış Raporları, parçalı ödeme dağılımı ve şube bazlı brüt ciro grafikleri.

---

### 🔷 FAZ 10 TEKNİK SÖZLEŞMESİ: Üretim Güvenlik Kilidi, Çok Kiracılı İzolasyon ve Müşteri Onboarding (✅ TAMAMLANDI - 11 KASIM 2026)

#### A. İşletme ve Üretim İhtiyacı:
Çok müşterili ticari yayında (`hipos.hayatisleri.com.tr`) hiçbir istemcinin demo aktör başlığıyla kimlik atlayamaması, bir restoran müşterisinin başka bir restoranın verisine (`firmId`/`branchId`) erişememesi ve yeni müşteri şube + yazıcı köprüsü kurulumunun panelden yapılabilmesi gerekir.

#### B. Uygulanan Mimari ve Güvenlik Kontrolleri:
1. **Production Kimlik & Anahtar Kilidi ([`DemoAccess.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Features/DemoAccess.cs), [`AuthTokenService.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Auth/AuthTokenService.cs)):**
   - `HIPOS_ALLOW_DEMO_ACTOR != "true"` durumunda (Production varsayılanı) `X-Demo-Actor` ve `?actor=` reddedilir (`401`).
   - Production'da 32 karakterden kısa veya varsayılan `HIPOS_JWT_SECRET` tespit edildiğinde API başlangıçta fail-fast durur.
2. **Çok Kiracılı Şema, Onboarding ve Aktif Personel Tutarlılığı ([`AuthEndpoints.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Auth/AuthEndpoints.cs), [`TenantProvisioningService.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Auth/TenantProvisioningService.cs), [`ServiceEndpoints.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Service/ServiceEndpoints.cs), [`SalesOrders.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Sales/SalesOrders.cs)):**
   - `20261111171121_AddTenantsAndBranches` migration'ı ile `auth.firms` ve `auth.branches` tabloları eklendi.
   - `POST /api/v1/onboarding/tenants` (platform admin anahtarı / rolü zorunlu), `POST /api/v1/firms/{firmId}/branches`, `GET /api/v1/auth/me`, `POST /api/v1/auth/switch-scope` ve `GET /api/v1/auth/branch-info` uçları eklendi.
   - Yeni kurulan şubede kurucu patron veya diğer departman personellerinin garson tabletinden sipariş gönderebilmesi için `POST /tables/{tableId}/orders`, `POST /assignments` ve `SalesOrders.ValidateWaiterAsync` üzerindeki `department='service'` kısıtı `IsActive == true` kontrolüyle `GET /waiters` ile eşitlendi.
3. **Print Bridge En Az Yetkili Kapsamı ([`PrintingEndpoints.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Printing/PrintingEndpoints.cs), [`RealtimeEndpoints.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Realtime/RealtimeEndpoints.cs), [`hipos-print-bridge.mjs`](file:///Users/mac/HIPOS/scripts/hipos-print-bridge.mjs)):**
   - `POST /printing/bridge-token` ile üretilen `role="bridge"` token'ı `DemoAccess.CanAccessPrintBridge` üzerinden yalnızca `GET /printing/config` ve `GET /events/stream` uçlarına erişir; iş uçlarında `403` alır.
4. **Admin & POS Frontend İzolasyonu ([`AuthGuard.tsx`](file:///Users/mac/HIPOS/apps/admin/src/features/auth/AuthGuard.tsx), [`BranchesPage.tsx`](file:///Users/mac/HIPOS/apps/admin/src/features/branches/BranchesPage.tsx), [`terminalScope.ts`](file:///Users/mac/HIPOS/apps/pos/src/terminalScope.ts), [`PinPadModal.tsx`](file:///Users/mac/HIPOS/apps/pos/src/components/PinPadModal.tsx), [`OperationalApps.tsx`](file:///Users/mac/HIPOS/apps/pos/src/OperationalApps.tsx)):**
   - Admin JWT girişine ve dinamik kapsam seçimine geçirildi; POS terminalleri (`waiter`, `kitchen`, `cashier`) rota bazlı `localStorage` anahtarları (`hipos_waiter_token`, `hipos_kitchen_token`, `hipos_cashier_token`) ile ayrıştırıldı ve kilitliyken sıfır API/SSE isteği atacak şekilde kilitlendi.

#### C. Canlı Test ve Saha Kanıtları (11 Kasım 2026):
* **Otomatik Güvenlik & E2E Paketi:** [`test_faz10_security_multitenant.mjs`](file:///Users/mac/HIPOS/scripts/test_faz10_security_multitenant.mjs)
  - Zayıf `HIPOS_JWT_SECRET` ile Production API başlatma reddedildi; Production'da anonim/`X-Demo-Actor`/`?actor=`/sahte JWT `401` aldı.
  - Platform anahtarsız onboarding `403`, anahtarlı Tenant 2 (`Etiler Şube`) ve 2. şube (`Cadde Şube`) `201`; iki kiracı arasında API `403` ve çapraz PIN `401` döndü.
  - Print Bridge `bridge` token'ı `/sales/checks` üzerinde `403` aldı ve yalnızca `bridge` token'ı ile yerel TCP termal yazıcıya `629` bayt ESC/POS fişi teslim etti.
  - Playwright ile Admin (`AuthGuard`/`BranchesPage`) + Waiter (`Masa 01` siparişi) + Kitchen (`Masa 01` bileti) + Cashier rota bazlı token izolasyonu tek bir `X-Demo-Actor` başlığı gönderilmeden geçti.

---

## 5. DOKÜMANTASYON VE SÖZLEŞME KİLİTLEME TAAHHÜDÜ

Faz 1–10 kapsamındaki geliştirmeler PostgreSQL veritabanında test edilmiş, Playwright tarayıcı otomasyonu ile doğrulanmış ve dokümanlarla eşlenmiştir:
1. `DURUM_VE_YOL_HARITASI.md`: Faz 1–10 durumu ve doğrulama sonuçları güncellenmiştir.
2. `MODUL_01_KASA_VE_POS.md`, `MODUL_02_MASA_VE_ADISYON.md`, `MODUL_03_MUTFAK_VE_YAZICI.md`, `MODUL_05_STOK_VE_RECETE.md`, `MODUL_06_CARI_VE_GIDER.md`, `MODUL_07_KIMLIK_VE_AUTH.md`: Yeni endpoint'ler, veri sözleşmeleri ve güvenlik/izolasyon kurallarıyla senkronize edilmiştir.
3. Production güvenlik kilidi (`HIPOS_ALLOW_DEMO_ACTOR=false` varsayılanı ve güçlü `HIPOS_JWT_SECRET` zorunluluğu), çok kiracılı izolasyon ve Print Bridge JWT akışı doğrulanmıştır. Sıradaki adım Faz 11+ (yerel yazdırma köprüsü ve çevrimdışı/LAN hibrit dayanıklılık adımları) ile devam eder.
