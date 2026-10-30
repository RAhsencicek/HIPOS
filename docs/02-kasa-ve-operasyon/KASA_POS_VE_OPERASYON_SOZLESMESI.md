# HIPOS — Kasa, POS ve Parçalı Ödeme Operasyon Sözleşmesi

> **Doküman Durumu:** Kesinleşmiş Geliştirme Sözleşmesi · Sürüm: v2.1 · Güncel uygulama durumu: 30 Ekim 2026
> **İlgili Mimari Referanslar:** [Backend Mimarisi ve Şemalar](../01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) · [Ana Devir Rehberi](../00-devir-rehberi/DEVIR_REHBERI.md) · [Ortak Adisyon Kılavuzu](ADISYON_VE_MASA_YASAM_DONGUSU.md)

---

## 1. Modülün Amacı ve Kapsamı

Kasa ve POS sistemi, bir restoranın **tüm gelir ve nakit akışını yönettiği operasyonel kalbidir**.
Bu sözleşme; yalnız bir nakit çekmecesi defteri değil, masalardan ve hızlı satıştan gelen tahsilatları parçalayan, çoklu kasaları yöneten, personel girişlerini istasyonla eşleştiren ve gün sonunda Z-Raporu ile mutabakat sağlayan tam teşekküllü kasa mimarisini tanımlar.

---

## 2. Güncel uygulama ve sınırları (30 Ekim 2026)

Aşağıdaki davranışlar geliştirme ekranındaki mevcut uygulamayı tarif eder; gerçek restoran tahsilatı değildir. Önceki sözleşme [arşivde](../05-gecmis-ve-arsiv/KASA_POS_VE_OPERASYON_SOZLESMESI_V2.md) saklanır.

- `/cashier` masaları yönetimden belirlenen katlara ayırır; seçilen masanın açık adisyonları, toplamı ve kalan tutarı gösterilir. Bölme, taşıma, birleştirme, indirim, ikram ve ürün iptali kontrolleri mevcut API kuralları ve geliştirme yetkileriyle çalışır. Ödeme girişimi olan adisyon bölünemez; indirim/ikram/iptal uygulanmış adisyonun bölünmesi de mevcut ekranda engellidir. Gerçek yönetici onayı henüz yoktur.
- Sabah açılışında ilk aktif kasanın başlangıç nakdi ve isteğe bağlı 500 karakterlik açılış notu kaydedilir; not vardiya geçmişinde gösterilir. Gösterilen kasiyer gerçek bir oturum değildir. `cash.management` ve Development demo aktörü sınırları [manuel kasa sözleşmesindedir](KASA_MVP_SOZLESMESI.md).
- Vardiya kapatma penceresi isteğe bağlı kupür adetlerinden sayılan toplamı hesaplar. Kırılım saklanmaz; API yalnız toplamı, beklenen tutarı, farkı ve gerekliyse fark açıklamasını kaydeder. Açık masa adisyon sayısı yalnız bilgilendirmedir, sunucuda kapatma kilidi veya yönetici onayı değildir.
- Hızlı satış aktif, yayımlanmış, POS kanalına açık, pozitif fiyatlı ve aktif kategorili ürünleri sunar. Ürün adı veya SKU aranabilir; SKU barkodla aynı veri olmak zorunda değildir. Ürün seçenekleri ve fiyat farkları siparişte sunucu tarafından doğrulanır.
- Ödeme sayfasına geçince masasız adisyon açılır. Açık masasız adisyonlar en fazla 100 kayıtla listelenip sürdürülebilir; liste başka masasız adisyonları da içerebilir. Belirsiz oluşturma isteği aynı tarayıcının yerel depolamasında saklanıp aynı kimlik ve içerikle tekrar edilir. Cihazlar arasında paylaşılan işlem kuyruğu değildir.
- Ödeme sayfasında yalnız nakit ve kart **simülasyonu** yapılır; simüle ödeme kayıtları PostgreSQL'de tutulur, gerçek tahsilat veya kasa/cari hareketi oluşturmaz. Kart alt seçimi kaydedilmez; yemek kartı, cari ve havale önizlemedir; iptal düğmesi pasiftir. Test ödemesi kalan bakiyeyi sıfırladığında adisyon kapanabilir ve son açık adisyon ise masa/grup boşalabilir. Açık vardiya kontrolü ekran tarafındadır; gerçek ödeme yetkisi değildir.
- Hesap fişi seçilen adisyondan elle yazdırılabilir; tam simüle ödeme sonrası tarayıcının yazdırma penceresi açılır. Fiş 80 mm yazıcıya uygun düzenlenir, mali değildir ve test ödemesi açıklanır. Yazıcı seçimi/sürücü tarayıcı ve işletim sistemine aittir; otomatik, sessiz veya fiziksel KPS-80 baskısı doğrulanmamıştır. Son tamamlanan fiş yalnız ekran oturumunda tutulur.
- Gerçek PIN/oturum, gerçek ödeme ve kasa entegrasyonu, mali fiş/ÖKC, Z raporu, gerçek ödeme iptali ve sağlayıcı mutabakatı henüz yoktur. Gerçek ödeme ve mali cihaz için doğrulanmış sonuç, tekrar/uzlaştırma ve yetki kuralları ayrıca tamamlanmalıdır.

## 3. Hedeflenen İş Kuralları ve Temel Yetenekler

Aşağıdaki kurallar hedef kapsamdır; mevcut uygulanmış davranış listesi değildir.


### 1. Parçalı Ödeme (Multi-Tender / Split Payment)
* Bir adisyon tek bir ödeme aracıyla kapanmak zorunda değildir.
* Müşteriler hesabı istedikleri gibi bölebilir:
  * **Nakit:** Belirtilen tutar doğrudan bağlı kasanın çekmecesine işlenir.
  * **Kredi Kartı (Banka Seçimli):** Restorandaki banka POS cihazlarına göre ayrıştırılır (`Ziraat Bankası POS`, `VakıfBank POS`, `Garanti POS` vb.).
  * **Yemek Kartları:** Sodexo, Multinet, Ticket, Setcard, Metropol.
  * **Cari / Veresiye (Akıllı Hesap):** Müşterinin kayıtlı cari kartına borç yazılır; kasaya nakit girmez.
  * **Banka Havalesi / EFT:** Şirket IBAN'ına gönderilen grup/kurumsal ödemeler için banka seçilir.
* Kalan bakiye `0,00 TL` olduğunda adisyon otomatik olarak `closed` olur.

### 2. Çoklu Kasa & Kasada Kim Var? (İstasyon ve Kasiyer Eşleşmesi)
* Bir şubede birden fazla kasa tanımlanabilir (Örn: `Kasa 1 - Giriş Ana Kasa`, `Kasa 2 - Bahçe/Bar Kasası`, `Kasa 3 - Paket Servis`).
* **Kasiyer Girişi:** Personel 4 haneli PIN kodu ile giriş yaptığında hangi kasanın başında çalıştığı ekranda görünür:
  `🟢 KASA 1 (ANA KASA) · 👤 Ahmet Yılmaz · ⏱️ 09:30'dan beri açık`
* Yapılan tüm tahsilat, iptal ve nakit hareketleri o kasiyerin ve kasanın kimliğiyle damgalanır.

### 3. Yönetici Kasa Yetkileri (Manager Controls)
* **Kasa Açılış Yetkisi:** Yönetici veya yetkilendirilmiş kasiyer kasayı açabilir ve başlangıç bozuk para avansını (Float) belirler.
* **Kasaya Bozuk Para Ekleme (Avans Takviyesi):** Gün içinde bozuk para bittiğinde kasaya ilave nakit eklenir. Bu tutar satış cirosuna karışmaz, avans olarak izlenir.
* **Kasadan Teslim Alma (Safe Drop / Hasılat Çekme):** Kasada biriken fazla nakit (ör. 25.000 TL) gün içinde güvenlik amacıyla alınarak çelik kasaya aktarılır.
* **Kasalar Arası Transfer:** Kasa 1'den Kasa 2'ye nakit aktarımı yapılabilir.
* **Tedarikçiye Ödemede Kasa Seçimi:** Yönetici toptancıya (Kasap, Manav vb.) nakit ödeme yaparken kasaların anlık nakdini görür, seçtiği kasadan çıkış yapar ve tedarikçinin cari borcundan düşer.

### 4. Gün Sonu, Z-Raporu ve Sayım Protokolü
Gün sonunda vardiya kapatılırken:
1. **Açık Masa Kontrolü:** Masalarda açık hesap varsa kasa kapatılamaz veya yönetici onayı ister.
2. **Kupür Sayımı:** Kasiyer fiziksel parayı sayar (200x10, 100x15, madeni paralar).
3. **Z-Raporu Dökümü:** Brüt Ciro, KDV Dağılımı (%1, %10, %20), Nakit, Ziraat POS Toplamı, Vakıf POS Toplamı, Yemek Kartı Toplamı, Cari Devirler.
4. **Kasa Farkı & Hasılat Teslimi:**
   * `Fark = Sayılan Nakit - Sistemde Olması Gereken Nakit`.
   * Yarına devreden bozuk para (ör. 1.000 TL) ayrılır, kalan hasılat teslim alınır.

---

## 4. Hedef Mimari ve Örnek Veritabanı Modeli

Aşağıdaki SQL hedef taslak olup mevcut migration veya çalışan şema tanımı değildir.

```sql
-- 1. Çoklu Kasa Tanımları
CREATE TABLE cash.registers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL, -- "KASA-01"
    name VARCHAR(100) NOT NULL, -- "Ana Giriş Kasası"
    location VARCHAR(100) NULL, -- "Giriş Salonu", "Üst Kat Bar"
    is_active BOOLEAN NOT NULL DEFAULT true
);

-- 2. Kasa Vardiyaları (Shift & Operator Binding)
CREATE TABLE cash.shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    register_id UUID NOT NULL REFERENCES cash.registers(id),
    opened_by UUID NOT NULL,
    opened_by_name VARCHAR(100) NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    opening_float_minor INT NOT NULL, -- kasadaki başlangıç bozuk parası
    status VARCHAR(20) NOT NULL DEFAULT 'open', -- "open", "closed"
    closed_by UUID NULL,
    closed_at TIMESTAMPTZ NULL,
    counted_cash_minor INT NULL,
    expected_cash_minor INT NULL,
    difference_minor INT NULL,
    retained_float_minor INT NULL, -- yarına devreden avans
    dropped_revenue_minor INT NULL, -- teslim alınan hasılat
    close_note TEXT NULL
);

-- 3. Parçalı Ödeme İşlemleri (Tender Transactions)
CREATE TABLE sales.check_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    check_id UUID NOT NULL REFERENCES sales.checks(id),
    shift_id UUID NOT NULL REFERENCES cash.shifts(id),
    register_id UUID NOT NULL REFERENCES cash.registers(id),
    amount_minor INT NOT NULL,
    method VARCHAR(30) NOT NULL, -- "cash", "credit_card", "meal_card", "on_account", "bank_transfer"
    sub_method VARCHAR(50) NULL, -- "ziraat_pos", "vakif_pos", "sodexo", "multinet"
    cari_id UUID NULL, -- veresiye kapatıldıysa müşteri carisi
    bank_account VARCHAR(50) NULL, -- havale ise şirket banka hesabı
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    actor VARCHAR(100) NOT NULL
);

-- 4. Kasa Hareket Defteri (Nakit Giriş / Çıkış)
-- Nakit satışlar, avans eklemeler, hasılat teslimler buraya akar
ALTER TABLE cash.movements
ADD COLUMN shift_id UUID NOT NULL REFERENCES cash.shifts(id),
ADD COLUMN payment_id UUID NULL REFERENCES sales.check_payments(id),
ADD COLUMN supplier_cari_id UUID NULL; -- tedarikçiye tediye yapıldıysa
```

---

## 5. Hedef Kullanıcı Deneyimi ve Arayüz Akışı

### Kasiyer Ekranı (`apps/pos`)
```text
┌────────────────────────────────────────────────────────────────────────┐
│ MASA 4 · ADİSYON TOPLAMI: 1.200,00 ₺           KALAN: 400,00 ₺         │
├────────────────────────────────────────────────────────────────────────┤
│ [✓] 500,00 ₺ · Kredi Kartı (Ziraat POS)                                │
│ [✓] 300,00 ₺ · Nakit Tahsilat                                          │
├────────────────────────────────────────────────────────────────────────┤
│ KALAN TUTARI TAHSİL ET (400,00 ₺):                                     │
│ [ 💵 NAKİT ]      [ 💳 ZİRAAT POS ]   [ 💳 VAKIF POS ]                 │
│ [ 🎫 SODEXO ]     [ 🎫 MULTİNET ]     [ 📑 CARİYE YAZ (VERESİYE) ]     │
└────────────────────────────────────────────────────────────────────────┘
```

### Yönetici Kasa Özeti Ekranı (`apps/admin`)
* Tüm kasaların anlık durumlarını (Açık/Kapalı, başında kim var, çekmecede kaç TL var) gösteren canlı izleme panosu.
* Kasa açma, kasaya avans para ekleme, kasadan hasılat çekme ve kasalar arası transfer butonları.
* Gün sonu Z-Raporu alma sihirbazı.

---

## 6. Hedef Kabul Kriterleri (Henüz Tamamlanmadı)

1. Bir masada 1.000 TL hesap varken; 400 TL Nakit + 600 TL Ziraat POS ile iki parçada kapatılabilmeli, masanın bakiyesi sıfırlanıp kapanmalıdır.
2. 400 TL nakit ödendiği anda Kasa 1'in nakit çekmecesine otomatik olarak +400 TL `cash_sale` hareketi eklenmeli; yönetici Kasa ekranında bunu anında görmelidir.
3. Yönetici "Kasap Ahmet'e 3.000 TL öde" dediğinde Kasa 1'den 3.000 TL nakit düşmeli ve Kasap Ahmet'in cari borcu 3.000 TL azalmalıdır.
4. Kasiyer akşam kupür sayımı yaptığında (20x200, 10x100 vb.) sistem farkı hesaplamalı; açık masa varsa kapatılmadan önce uyarmalıdır.
