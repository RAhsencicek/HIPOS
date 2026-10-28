# Modül 3 — Mutfak ve KDS: Yapılanlar ve Yapılacaklar Gelişim Raporu

> **Doküman Türü:** Tarihsel Gelişim, Durum Özeti ve Kalan İşler Raporu  
> **Konum:** `docs/05-gecmis-ve-arsiv/MUTFAK_MODULU_ICIN_YAPILANLAR.md`  
> **Referans Şartname:** [docs/00-devir-rehberi/MODUL_03_MUTFAK_VE_KDS.md](../00-devir-rehberi/MODUL_03_MUTFAK_VE_KDS.md) · [docs/02-kasa-ve-operasyon/MUTFAK_KDS_VE_YAZICI.md](../02-kasa-ve-operasyon/MUTFAK_KDS_VE_YAZICI.md)  
> **Tarih:** 28 Ekim 2026  
> **İlgili Git Dalı (Branch):** `origin/codex/kitchen-kds` (Commit: `6a8aa6b`)

---

## 📌 1. Modülün Amacı ve Restoran Operasyonundaki Rolü

Mutfak (KDS - Kitchen Display System) ve Yazıcı Modülü; salondaki garsonların veya kasadaki personelin girdiği ürün siparişlerinin anlık olarak mutfaktaki dokunmatik ekranlara iletilmesini, siparişlerin istasyonlara göre ayrışmasını, sipariş durumlarının (Bekliyor → Hazırlanıyor → Hazır → Servis Edildi) yönetilmesini, geciken siparişlerde renkli uyarılar verilmesini ve mutfak termal fişlerinin dökülmesini sağlayan **dijital operasyon omurgasıdır**.

---

## ✅ 2. Şu Ana Kadar Yapılanlar (Mevcut ve Çalışan Özellikler)

Mutfak modülünde çekirdek iş mantığından arayüze, veritabanı kalıcılığından kabul testlerine kadar tamamlanan çalışmalar:

### 2.1. Kalıcı Mutfak Görev Modeli (`kitchen.tasks`)
- **Bağımsız Görev Mimarisi:** Sipariş satırları doğrudan değiştirilmez; `sales.order_lines` tablosuyla ilişkili bağımsız `kitchen.tasks` kayıtları üretilir (`bigint` kalem ID'si, `firm_id`, `branch_id`, `station_id`).
- **Adisyon ve Ek Sipariş Ayrımı:** Aynı adisyona sonradan eklenen her yeni sipariş kalemi kendi bağımsız görevini başlatır. Hazırlık süresi adisyonun açılışından değil, ilgili sipariş kaleminin sisteme kaydedildiği andan itibaren hesaplanır.
- **Tekillik Güvencesi:** Aynı sipariş kaleminden mükerrer görev üretilmesi veritabanı kısıtlarıyla engellenmiştir.

### 2.2. Durum Makinesi ve API ([`KitchenEndpoints.cs`](../../apps/api/Hipos.Api/Kitchen/KitchenEndpoints.cs))
- **Durum Akışı:** `submitted` (Bekliyor) → `preparing` (Hazırlanıyor) → `ready` (Hazır) → `served` (Servis Edildi).
- **Endpoint:** `POST /api/v1/firms/{firmId}/branches/{branchId}/kitchen/tasks/{taskId}/status`
- **Sürüm Kontrolü ve İdempotency:** Her durum geçişinde `expectedVersion` kontrolü yapılır, eşzamanlı çakışmalar engellenir.
- **Denetim İzi (`kitchen.task_audit`):** Tüm durum geçişleri işlem zamanı, aktör ve kaynak bilgisiyle kalıcı olarak saklanır.

### 2.3. İstasyon Ayrımı ve Otomatik Yönlendirme
- `kitchen.stations` ve `kitchen.station_categories` tabloları üzerinden ürün kategorisine göre otomatik istasyon ayrımı kurgulanmıştır:
  - 🍕 **Taş Fırın**
  - 🍳 **Sıcak Mutfak**
  - 🍹 **Bar / İçecek**
  - 🥗 **Soğuk Mutfak**
- Kategorisi eşleşmeyen veya istasyonu tanımlanmamış ürünler kaybolmaz; **"Atanmamış"** sekmesinde toplanır.

### 2.4. Dokunmatik KDS Arayüzü ([`OperationalApps.tsx`](../../apps/pos/src/OperationalApps.tsx#L38-L120) — `/kitchen`)
- **Canlı Polling:** 3 saniyelik periyodik sorgulama ile PostgreSQL veritabanındaki görevleri canlı listeler.
- **İstasyon Sekmeleri:** Aşçının kendi istasyonunu seçebildiği filtreleme çubuğu (`Tümü`, `Fırın`, `Sıcak Mutfak`, `Bar`, `Soğuk Mutfak`, `Atanmamış`).
- **Geçen Süre Sayaçları ve Renk Alarmları:**
  - `0 - 10 dk`: Normal süre.
  - `10 - 20 dk`: Sarı gecikme uyarısı.
  - `20+ dk`: Kırmızı alarm.
- **Aşamalı Paneller:**
  - **Aktif Hazırlık Kuyruğu:** Bekleyen ve hazırlanan siparişler.
  - **Servise Hazır Bölümü:** Hazırlanıp servis bekleyen ürünler.
  - **Son Servis Edilenler:** Servis edilmiş siparişlerin geçmiş takibi.

### 2.5. Sipariş Kalem Notu Entegrasyonu (`notes`)
- Satış satırına (`sales.order_lines.notes`) ve mutfak görevine (`kitchen.tasks.notes`) özel sipariş notu alanı eklenmiştir (`EF Core Migration`).
- Müşterinin *"Az pişmiş"*, *"Buzsuz"*, *"Alerjen uyarısı"* gibi özel talepleri satıştan mutfak ekranına ve fiş önizlemesine taşınmıştır.

### 2.6. 80 mm Termal Mutfak Fişi Önizlemesi (Modal)
- KDS ekranındaki her sipariş bileti için **80 mm standart termal fiş önizleme modalı** eklenmiştir.
- Monospace font, masa numarası, garson adı, sipariş saati, ürün adedi ve özel sipariş notlarını içeren standart mutfak fişi dökümü görselleştirilmiştir.

### 2.7. İptal Durumu Altyapısı
- `kitchen.tasks` modelinde `cancelled` durumu, iptal gerekçesi, iptal zamanı ve aktör alanları tanımlanmıştır.
- KDS ekranında iptal edilen görevlerin üzeri çizili ve kırmızı renkte geçmişe düşmesi sağlanmıştır.

### 2.8. Test Kapsamı ve Git Yedeklemesi
- [`postgres.test.mjs`](../../apps/api/Hipos.Api.Tests/postgres.test.mjs) altında KDS görev üretimi, istasyon eşleşmesi, durum güncellemeleri, sürüm kilitleri, audit logları ve sipariş notu akışı uçtan uca otomatik test edilmiştir.
- Yapılan tüm mutfak değişiklikleri `origin/codex/kitchen-kds` uzak dalına commit (`6a8aa6b`) edilip pushlanmıştır.

---

## 📋 3. Yapılacaklar (Hedeflenen Mutfak Backlog'u)

• **Siparişlerin yiyecek ve içecek şeklinde 2 bölüme ayrılması:**
  Mutfak ve bar operasyonunun birbirinden net ayrılması amacıyla sipariş biletlerinin ve KDS ekranlarının ana hatlarıyla **Yiyecek (Mutfak)** ve **İçecek (Bar)** olmak üzere iki ana bölüme ayrılması ve istasyon yönlendirmesinin bu temel ayrım üzerinde optimize edilmesi.

• **Gerçek termal yazıcıya otomatik fiş gönderilmesi:**
  Garson masada siparişi onayladığı anda mutfak veya bardaki fiziksel termal fiş yazıcılarına (TCP port 9100) raw ESC/POS protokolüyle otomatik sipariş biletinin dökülmesi ve giyotinle kesilmesi.

• **Yazıcı bağlantı hataları, kuyruk ve tekrar deneme yönetimi:**
  Yazıcıda kağıt bitmesi, bağlantı kopması veya cihazın kapalı olması gibi hata durumlarında sipariş fişlerinin kaybolmaması için bilet kuyruğu oluşturulması, otomatik tekrar deneme mekanizması ve gerektiğinde bileti alternatif (yedek) bir yazıcıya yönlendirme altyapısı.

• **Diğer ekiplerle birlikte garsona hazır bildirimi ve satış iptalinin mutfağa aktarılması:**
  - **Hazır Bildirimi:** Aşçı ekranda *"Hazır / Servise Çıkar"* butonuna bastığında, ilgili masanın garson ekranına anlık bildirim (WebSocket / SSE) düşmesi ve yemeğin servis edildiği bilgisinin teyit edilmesi.
  - **Satış İptali Entegrasyonu:** Salon/kasa ekibi tarafından adisyondan bir kalem silindiğinde veya iptal edildiğinde (müdür PIN onayı ve iptal gerekçesiyle), mutfak KDS ekranındaki görevin anında `cancelled` durumuna geçmesi ve aşçıya görsel uyarı verilmesi.

• **Ortak çevrimdışı kuyruk ve senkronizasyon bağlantısı:**
  Restoranın ana internet bağlantısı kesildiğinde yerel ağdaki (LAN) mutfak tabletleri, garson terminalleri ve yazıcı servisinin kesintisiz çalışmaya devam etmesi; internet bağlantısı sağlandığında yerel kuyruktaki tüm hareketlerin merkezi veritabanıyla çift taraflı senkronize edilmesi.

---

## 🔗 4. İlgili Dosya ve Bileşen Dizini

| Katman | Dosya / Yol | Açıklama |
| :--- | :--- | :--- |
| **KDS Ön Yüz** | [`apps/pos/src/OperationalApps.tsx`](../../apps/pos/src/OperationalApps.tsx) | Dokunmatik mutfak ekranı, filtreler, sayaçlar ve fiş modalı |
| **KDS Stilleri** | [`apps/pos/src/operational.css`](../../apps/pos/src/operational.css) | Mutfak kartı stilleri, renk alarmları ve termal fiş tasarımı |
| **Backend API** | [`apps/api/Hipos.Api/Kitchen/KitchenEndpoints.cs`](../../apps/api/Hipos.Api/Kitchen/KitchenEndpoints.cs) | Mutfak görev listesi ve durum geçiş endpoint'leri |
| **Veritabanı Modeli** | [`apps/api/Hipos.Api/Kitchen/KitchenTask.cs`](../../apps/api/Hipos.Api/Kitchen/KitchenTask.cs) | `kitchen.tasks` ve `kitchen.task_audit` entity tanımları |
| **DB Context & Göçler** | [`apps/api/Hipos.Api/Kitchen/KitchenDbContext.cs`](../../apps/api/Hipos.Api/Kitchen/KitchenDbContext.cs) | PostgreSQL EF Core KitchenDbContext ve migration dosyaları |
| **Satış Bağlantısı** | [`apps/api/Hipos.Api/Sales/SalesOrders.cs`](../../apps/api/Hipos.Api/Sales/SalesOrders.cs) | Sipariş onayında otomatik KDS görevi üretimi ve not aktarımı |
| **Otomasyon Testleri** | [`apps/api/Hipos.Api.Tests/postgres.test.mjs`](../../apps/api/Hipos.Api.Tests/postgres.test.mjs) | Mutfak durum makinesi, istasyon ve not entegrasyon testleri |
| **Modül Şartnamesi** | [`docs/00-devir-rehberi/MODUL_03_MUTFAK_VE_KDS.md`](../00-devir-rehberi/MODUL_03_MUTFAK_VE_KDS.md) | Güncel KDS şartnamesi ve mimari gereksinimler |
