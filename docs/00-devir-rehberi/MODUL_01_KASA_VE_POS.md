# Modül 1 Devir Şartnamesi — Kasa, POS ve Parçalı Tahsilat Mimarisi (A'dan Z'ye)

> **Doküman Durumu:** Kesinleşmiş Modül Devir ve Uygulama Şartnamesi · Sürüm: v3.5 (9 Kasım 2026)
> **Kapsam:** Saha İhtiyaçları, Terminal Sabitleme, Kasiyer PIN Girişi, Z/X-Raporu, Kasa Defteri Senkronizasyonu
> **Modül Durumu:** Kalıcı MVP (Çalışıyor) · Manuel Kasa, Terminal İstasyon Sabitleme, Z/X Raporları, Adisyon Nakit Akışı, Termal Fiş (Çalışıyor)
> **PostgreSQL Şeması:** `cash` (`cash.registers`, `cash.shifts`, `cash.movements`, `cash.audit`)
> **Yönetim Paneli:** Var (`CashManagementPage.tsx`)
> **API:** Var (`CashDbContext.cs`, `CashEndpoints.cs`)
> **Test:** Var (`docs/04-test-ve-rehberler/KASA_MANUEL_TEST.md`, `scratch/test_restaurant_reality_audit.mjs`)
> **Ana Devir Rehberi:** [DEVIR_REHBERI.md](DEVIR_REHBERI.md) · **Yol Haritası:** [DURUM_VE_YOL_HARITASI.md](DURUM_VE_YOL_HARITASI.md)

---

### 📌 Gerçeklik ve Uygulama Durumu Özeti

| Alan / Özellik | Durum | Açıklama |
| :--- | :--- | :--- |
| **Terminal İstasyon Sabitleme** | **Çalışıyor** | Terminal ilk açılışta *"Kadıköy Ana Kasa"* veya *"Bar Kasası"* olarak kilitlenir. Kasiyer değişse bile terminal kasası sabit kalır. Kasa değiştirme müdür PIN'i (`auth.pin_codes` - role: `owner`/`manager`) gerektirir. |
| **Kasiyer PIN Girişi** | **Çalışıyor** | Kasiyerler 4 haneli PIN (`1111`) ile oturum açar; inaktivitede ekran kilitlenir. |
| **Adisyon Tahsilatı ➔ Kasa Senkronizasyonu** | **Çalışıyor** | Masada veya hızlı satışta yapılan nakit tahsilatlar aktif vardiyaya `pos_sale` hareketi olarak otomatik yazılır (`cash.movements`). |
| **Gün Sonu Z-Raporu ve X-Raporu** | **Çalışıyor** | Kupür sayımı (200 TL, 100 TL...), kasa farkı hesabı, yarına devreden bozuk para avansı (`retained_float`) ve kasadan çekilen net ciro (`safe_drop`) tutanağı mevcuttur. |
| **Termal Ağ Yazıcısı Entegrasyonu** | **Çalışıyor** | Kasa tahsilatı bittiğinde ESC/POS ağ yazıcısına (`192.168.1.200:9100`) otomatik adisyon fişi basılır. |
| **Hızlı Satış (Gel-Al / Tezgâh)** | **Çalışıyor** | Sipariş askıya alma (Park Order / Bekletme), bekleyen paket satışlar paneli ve tek tıkla tahsil etme aktiftir. |
| **Çoklu Ödeme & POS / Yemek Kartı (Faz 6)** | **Çalışıyor** | Nakit, Kredi Kartı (Ziraat/Garanti/VakıfBank POS), Yemek Kartı (Sodexo/Multinet/Ticket/Setcard/Metropol), Havale ve Cari ödeme alt tipleri veritabanına ve Z-Raporuna tam kayıtlıdır. Parçalı (Split) tahsilat adisyon fişine dökülür. |
| **Yönetici Raporları & Canlı Ciro Analitiği** | **Çalışıyor** | Mock/demo veri tamamen kaldırıldı. `GET /reports/sales-analytics` üzerinden anlık brüt/net ciro, nakit/kart dağılımı, masa/paket kanalları, en çok satan 10 ürün ve saatlik restoran satış nabzı canlı gösterilir. |

---

## 🎯 1. Modülün Amacı Nedir?

Kasa ve POS modülü; restoranın nakit ve kart akışını denetleyen, kaçakları önleyen, gün başı ve gün sonu mutabakatını sağlayan finansal operasyon merkezidir.

---

## 📂 2. Hangi Dosyalar ve Kod Bloklarıyla Çalışacaksın?

1. **Ön Yüz (Frontend):**
   * [OperationalApps.tsx](../../apps/pos/src/OperationalApps.tsx) (`/cashier`) — Kasa terminali, masa tahsilatı, hızlı satış, Z-Raporu modalı ve istasyon sabitleme diyaloğu.
   * [CashManagementPage.tsx](../../apps/admin/src/features/cash/CashManagementPage.tsx) — Yönetim paneli kasa özeti, vardiya geçmişi, Z-Raporu dökümleri ve kasa hareketleri.
2. **Backend (.NET API):**
   * [CashDbContext.cs](../../apps/api/Hipos.Api/Cash/CashDbContext.cs) — Kasalar (`CashRegisterRow`), Vardiyalar (`CashShiftRow`), Hareketler (`CashMovementRow`), Denetim (`CashAuditRow`).
   * [CashEndpoints.cs](../../apps/api/Hipos.Api/Cash/CashEndpoints.cs) — Vardiya açma/kapama, Z-Raporu alma, para yatırma/çekme, kasa tanımlama.
   * [PaymentSimulator.cs](../../apps/api/Hipos.Api/Sales/PaymentSimulator.cs) — Adisyon ödemelerini kasa hareketlerine bağlayan motor.
   * [ReportsEndpoints.cs](../../apps/api/Hipos.Api/Reports/ReportsEndpoints.cs) — `GET /reports/sales-analytics` gerçek veritabanı satış analitiği ve ciro agregasyon motoru.
   * [ReportsPage.tsx](../../apps/admin/src/features/reports/ReportsPage.tsx) — Yönetim paneli canlı satış analitiği, metrik kartları, saatlik satış nabzı ve şube karşılaştırma ekranı.

---

## 3. Yönetici Raporları ve Satış Analitiği Mimarisi (Faz 3)

### A. API Sözleşmesi
```http
GET /api/v1/firms/{firmId}/branches/{branchId}/reports/sales-analytics?range=today|yesterday|week|month|all
Header: X-Demo-Actor: manager-single
```

**Dönen JSON Alanları:**
- `summary.grossRevenueMinor`: Kapanan adisyon ve ödeme kayıtlarının brüt toplamı (₺3.020,00).
- `summary.netRevenueMinor`: İskonto/ikram indirimleri düşülmüş net ciro.
- `summary.cashRevenueMinor`: Nakit tahsilat tutarı.
- `summary.cardRevenueMinor`: Kredi kartı tahsilat tutarı.
- `summary.completedChecksCount`: Tamamlanan adisyon adedi.
- `summary.averageCheckMinor`: Ortalama sepet büyüklüğü.
- `summary.openChecksCount` & `openChecksBalanceMinor`: Açık masalar ve bekleyen bakiye.
- `paymentBreakdown`: Nakit ve Kredi Kartı işlem adetleri, ciroları ve yüzde payları.
- `channelBreakdown`: Masa servisi (`waiter_web`) ile Paket / Tezgâh (`test_pos`) karşılaştırması.
- `topProducts`: En çok satan ilk 10 ürün (adet, ciro, kategori, yüzde pay).
- `hourlyTrends`: 08:00 - 23:00 saatlik adisyon ve ciro histogramı.
- `branchComparison`: Şubelerin toplam cirodaki payları ve performansları.

---

## 4. Çoklu Ödeme Yöntemleri & Banka POS Slip / Yemek Kartı Entegrasyonu (Faz 6)

### A. Mimari ve Veritabanı Modeli
* **`sales.payment_attempts`:**
  - `method`: `cash`, `card`, `meal`, `transfer`, `cari`
  - `provider`: `Garanti POS`, `Ziraat POS`, `VakıfBank POS`, `Sodexo`, `Multinet`, `Ticket`, `Setcard`, `Metropol`
* **`cash.movements`:**
  - `tender_method`: `cash`, `card`, `meal`, `transfer`, `cari`
  - `provider`: Banka POS adı veya yemek kartı firması
  - `description`: `Kasa tahsilatı · {sağlayıcı} · Adisyon {adisyon_id}`
* **Parçalı Tahsilat (Split Payment):**
  - Müşteri hesabın bir kısmını Kredi Kartı (örn. Garanti POS ₺100), kalan kısmını Yemek Kartı (örn. Sodexo ₺160) ile ödeyebilir.
  - Her parçalı ödeme atomik olarak adisyon kalan bakiyesinden düşülür ve açık kasa vardiyasına işlenir.
  - Termal yazıcıdan çıkan adisyon fişinde tahsilat dökümü `Garanti POS: 100.00 TL | Sodexo: 160.00 TL` şeklinde basılır.
  - Gün sonu Z-Raporu ve X-Raporunda `tenders` listesi banka kartı ve yemek kartı cirolarını ayrı kalemler olarak sunar.
