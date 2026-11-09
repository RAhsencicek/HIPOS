# HIPOS — Mevcut Durum ve Modüler Yol Haritası

> **Doküman Durumu:** Canlı Yol Haritası ve Fazlı Eylem Planı · Sürüm: v3.5 (9 Kasım 2026)
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
│ FAZ 3: YÖNETİCİ RAPORLARI VE GERÇEK CİRO ANALİTİĞİ (SIRADAKİ FAZ)      │
│ 1. Backend'e GET /api/v1/reports/sales-analytics endpoint'i ekleme     │
│ 2. ReportsPage.tsx'i gerçek satış ve ciro tablolarına bağlama          │
│ 3. Arayüzlerdeki yanıltıcı "Test / Simüle" etiketlerini temizleme      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ FAZ 4: GERÇEK ZAMANLI EŞZAMANLILIK (SSE / SignalR LAN Sync)           │
│ 1. Masa ve sipariş durumu değiştiğinde anlık SSE event fırlatma       │
│ 2. Kasa ve Garson ekranlarının sayfayı yenilemeden anlık güncellenmesi│
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

### 🔷 FAZ 3 TEKNİK SÖZLEŞMESİ: Gerçek Raporlar ve Ciro Analitiği

#### A. API Endpoint'i:
* `GET /api/v1/firms/{firmId}/branches/{branchId}/reports/sales-analytics?from={from}&to={to}`
  Dönen Veri:
  - `grossRevenueMinor`: Brüt ciro.
  - `netRevenueMinor`: Net ciro (indirimler düşülmüş).
  - `cashRevenueMinor`: Kasa çekmecesine giren nakit ciro.
  - `cardRevenueMinor`: Banka POS'larına giren kart cirosu.
  - `checkCount`: Toplam adisyon adedi.
  - `averageCheckMinor`: Ortalama sepet tutarı.
  - `topProducts`: En çok satan ilk 10 ürün (Adet, Ciro payı).
  - `hourlyTrends`: Saatlik sipariş ve ciro dağılımı grafiği (09:00 - 23:00).

#### B. Arayüz (`ReportsPage.tsx`):
* Sahte `SAMPLE_SALES` dizisi kaldırılacak.
* Veriler doğrudan yukarıdaki analitik API'sinden çekilerek patronun önüne konacak.

---

### 🔷 FAZ 4 TEKNİK SÖZLEŞMESİ: Anlık Senkronizasyon (SSE)

#### A. Çalışma Prensibi:
* ASP.NET Core üzerinde `/api/v1/firms/{firmId}/branches/{branchId}/events/stream` SSE endpoint'i.
* Masa durumu değiştiğinde (`table.status_changed`, `check.opened`, `check.paid`, `bill.requested`), API bağlı olan terminal istemcilerine 100 baytlık hafif JSON fırlatır.
* POS Kasiyer ve Garson ekranları sayfayı baştan yüklemeden yalnızca ilgili masanın durumunu reaktif günceller.

---

## 5. DOKÜMANTASYON GÜNCELLEME TAAHHÜDÜ

Her faz uygulandığında:
1. `DURUM_VE_YOL_HARITASI.md` içindeki ilgili fazın durumu `Tamamlandı` olarak işaretlenecektir.
2. İlgili `MODUL_*.md` şartnamesine yeni eklenen endpoint'ler ve UI bileşenleri linkleriyle eklenecektir.
3. Test senaryosu `docs/04-test-ve-rehberler/` altına eklenerek doğrulanacaktır.
