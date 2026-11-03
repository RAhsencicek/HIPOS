# Admin Sayfası & Genel Bakış Modülü İçin Yapılanlar

> **Belge türü:** Tarihsel çalışma özeti ve tamamlanan işler raporu  
> **Durum tarihi:** 3 Kasım 2026  
> **Kapsam:** Yönetim Paneli (`apps/admin`) Genel Bakış (`overview`) kokpiti, operasyonel uyarılar, son işlemler beslemesi, kasa kâr oranı entegrasyonu, ciro grafikleri ve PostgreSQL kalıcılığı

> [!IMPORTANT]
> Bu belge Genel Bakış modülünde yapılan çalışmaların tarihsel özetidir. Güncel ve bağlayıcı sistem mimarisi için [Backend Mimarisi ve Modül Bağımlılıkları](../01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md), teslim sırası için [Durum ve Yol Haritası](../00-devir-rehberi/DURUM_VE_YOL_HARITASI.md) ve genel ilkeler için [Devir Rehberi](../00-devir-rehberi/DEVIR_REHBERI.md) esas alınmalıdır.

---

## 1. Modülün Amacı ve Önemi

Genel Bakış (`overview`), restoran sahibinin veya şube müdürünün sisteme giriş yaptığında karşılaştığı ilk ekrandır. İşletmenin operasyonel, finansal ve lojistik durumunu tek bakışta özetler:
- Satış ve sipariş hacmi (Açık siparişler ve ciro ritmi),
- Salon doluluğu (Masa servisi ve garson atamaları),
- Depo güvenliği (Kritik hammadde ve stok alarmları),
- Nakit akışı ve kârlılık (Kasaların toplam kâr oranı ve hareketleri),
- Operasyonel uyarılar ve son işlemler denetim izi.

---

## 2. Şu Ana Kadar Yapılanlar

### 2.1. Operasyonel Uyarılar Yönetimi (`/admin/overview/alerts`)
- **PostgreSQL Kalıcılığı (`overview.alert_acknowledgments`):** Uyarıların sadece tarayıcı hafızasında kalmaması için `OverviewDbContext` ve `InitialOverviewAlerts` EF Core migration'ı uygulandı.
- **Çok Kullanıcılı Onay İzi:** Müdürü veya yetkili personelin incelediği uyarılar `alert_key`, `category`, `actor` (`X-Demo-Actor`), `acknowledged_at` ve opsiyonel `note` ile veritabanına işlendi.
- **Toplu ve Tekil İşlem:** Kart bazında "İncele & Arşivle" ve sayfa başında tek tıkla "Tümünü İnceledim" aksiyonları eklendi.
- **Yeniden Açma / Sıfırlama Mekanizması:** Arşivlenen veya kapatılan uyarıların gerektiğinde yeniden aktif listeye döndürülebilmesi sağlandı (`POST /overview/alerts/reset`).
- **Kategori Filtreleme Çipleri:** `Tümü`, `Kritik Stok`, `Kasa`, `Mutfak` ve `Masa Servisi` kategorileriyle uyarıların filtrelenebilmesi sağlandı.

### 2.2. Canlı Son İşlemler Akışı (`/admin/overview/activity`)
- **Çoklu Modül Veri Agregasyonu (`/overview/activities`):** Tek bir API çağrısıyla işletmede gerçekleşen tüm olaylar tek zaman çizelgesine toplandı:
  - **Kasa:** Nakit satış girişleri, kasadan ödemeler, tedarikçi çıkışları (`cash.movements`).
  - **Satış:** Yeni masa ve paket siparişleri (`sales.orders`).
  - **Gider:** İşletme masrafları ve kategori bazlı harcamalar (`expenses.expenses`).
  - **Stok:** Mal kabul girişleri, hammadde fire/zayi kayıtları ve sayım düzeltmeleri (`inventory.movements`).
  - **Uyarılar:** Yönetici tarafından onaylanan uyarı geçmişi.
- **Arama ve Hızlı Filtreler:** İşlem başlığı, açıklama veya personele göre canlı arama; modül bazlı etiket filtreleri eklendi.
- **Derin Bağlantılar (Deep Linking):** Her işlem satırından doğrudan ilgili modül ekranına (örn. `/admin/inventory/receiving`, `/admin/cash/movements`) geçiş sağlandı.

### 2.3. Tüm Kasaların Toplam Kâr Oranı Entegrasyonu
- **Backend Kârlılık Analizi (`/overview/cash-profit`):**
  - Şube ve firma genelindeki tüm aktif kasaları (`cash.registers`) ve hareketlerini (`cash.movements`) tarayan özel endpoint yazıldı.
  - Formül:
    $$\text{Toplam Kasa Kâr Oranı} = \frac{\text{Toplam Giriş (manual\_in)} - \text{Toplam Çıkış (manual\_out)}}{\text{Toplam Giriş (manual\_in)}} \times 100$$
  - Giriş, çıkış, net kâr ve kâr oranı hem genel hem de kasa bazında (*Kadıköy Ana Kasa, Bar Kasası vb.*) hesaplanarak döndürüldü.
- **Üst Özet Kartı Düzenlemesi (Hero Stats):**
  - Genel Bakış karşılama alanına 4. metrik olarak **"Kasa kar oranı"** kartı eklendi.
  - Kullanıcı geri bildirimi doğrultusunda etiket *"Kasa kar oranı"* olarak sadeleştirildi ve yazı rengi diğer özet kartlarıyla (`18`, `11`, `7`) tam uyumlu standart koyu ton (`#382f30`) olarak eşitlendi.
- **İşletmenizin Gündemi — "Kasalar & Kârlılık" Kartı:**
  - Sayfanın gündem ızgarasına dördüncü kart olarak eklenen bu panelde; Toplam Kasa Girişi, Toplam Kasa Çıkışı, Net Kasa Kârı ve her kasanın anlık kâr yüzdesi listelendi.
  - Kart altındaki link ile doğrudan Kasa Hareketleri ekranına geçiş bağlandı.

### 2.4. Ciro Grafiği ve Ay/Gün Analiz Sayfası (`/admin/overview/turnover`)
- **Önceki 3 İşlem Gününün Cirosu:** Ana sayfadaki grafik bileşeni doğrudan gerçek satış verilerinden beslenerek son 3 günün cirosunu ve sipariş adetlerini karşılaştırmalı bar grafik olarak çizdi.
- **Detaylı Ciro Sayfası (`MonthlyDailyTurnoverPage.tsx`):** Kullanıcının her ayın ve her günün cirosunu detaylı inceleyebileceği, ortalama sepet tutarı ve işlem hacmini filtreleyebileceği alt sayfa bağlandı.

### 2.5. Tasarım ve Mobil Uyumluluk
- **4 Kolonlu Hero Stats:** Masaüstünde 4 eşit kolon, tablette 2x2 ve mobilde tek kolon olarak esneyen responsive ızgara kurgulandı.
- **Auto-Fit Gündem Izgarası:** Siparişler, Masalar, Stok ve Kasalar kartları ekran genişliğine göre taşma yapmadan yerleşecek şekilde güncellendi.

---

## 3. İlgili Dosya ve Bileşen Dizini

| Katman | Dosya / Dizin | Görev ve Açıklama |
| :--- | :--- | :--- |
| **Ön Yüz (Ana Sayfa)** | [`apps/admin/src/features/overview/OverviewPage.tsx`](../../apps/admin/src/features/overview/OverviewPage.tsx) | Genel bakış karşılama, kâr oranı kartı, ciro grafiği ve gündem kartları |
| **Ön Yüz (Uyarılar)** | [`apps/admin/src/features/overview/AlertsPage.tsx`](../../apps/admin/src/features/overview/AlertsPage.tsx) | Operasyonel uyarılar listesi, PostgreSQL onay/arşivleme arayüzü |
| **Ön Yüz (Son İşlemler)**| [`apps/admin/src/features/overview/ActivityPage.tsx`](../../apps/admin/src/features/overview/ActivityPage.tsx) | Tüm modüllerden derlenen kronolojik canlı aktivite zaman tüneli |
| **Ön Yüz (Ciro Analizi)**| [`apps/admin/src/features/overview/MonthlyDailyTurnoverPage.tsx`](../../apps/admin/src/features/overview/MonthlyDailyTurnoverPage.tsx) | Aylık ve günlük ciro detay analiz sayfası |
| **Ön Yüz Stilleri** | [`apps/admin/src/styles.css`](../../apps/admin/src/styles.css) | 4 kolonlu stats ızgarası, kârlılık kartı ve uyarı stilleri |
| **Backend API** | [`apps/api/Hipos.Api/Overview/OverviewEndpoints.cs`](../../apps/api/Hipos.Api/Overview/OverviewEndpoints.cs) | `/overview/alerts`, `/overview/activities` ve `/overview/cash-profit` endpoint'leri |
| **Backend DB Context** | [`apps/api/Hipos.Api/Overview/OverviewDbContext.cs`](../../apps/api/Hipos.Api/Overview/OverviewDbContext.cs) | EF Core `overview` şeması ve `alert_acknowledgments` tablosu |
| **EF Migration** | [`apps/api/Hipos.Api/Overview/Migrations/`](../../apps/api/Hipos.Api/Overview/Migrations/) | `InitialOverviewAlerts` veritabanı göç dosyası |

---

## 4. Kalan ve Gelecek Yol Haritası

- **Gerçek Ödeme ve Banka POS Ayrımı:** Şu anki kâr oranı nakit kasa hareketlerini (`cash.movements`) esas almaktadır; ilerleyen aşamalarda banka POS komisyonları ve yemek çeki kesintileri hesaplamaya dahil edilebilir.
- **Rol ve Yetkilendirme (Auth):** Uyarı kapatma ve kâr görüntüleme yetkilerinin sadece işletme sahibi ve şube müdürü rollerine sınırlandırılması.
- **Tarih Aralıklı Kârlılık:** Kasa kâr oranının geçmiş ay ve haftalara göre tarih aralığı seçilerek karşılaştırılabilmesi.
