# HIPOS — Çevrimdışı Çalışma ve Merkezi Senkronizasyon (Offline Sync) Kılavuzu

> **Durum:** Öncelikli Geliştirme Alanı · Doküman Sürümü: v1.0
> **İlgili Mimari Referanslar:** [Çevrimdışı Çalışma İlk Sözleşmesi](CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md) · [Teknik Mimari](TEKNIK_MIMARI.md) · [Ana Devir Rehberi](../00-devir-rehberi/DEVIR_REHBERI.md)

> **Dokümantasyon Hiyerarşisi:**
> * **Güncel kod durumu için:** [docs/01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md)
> * **Güncel teslim ve yol haritası için:** [docs/00-devir-rehberi/DURUM_VE_YOL_HARITASI.md](../00-devir-rehberi/DURUM_VE_YOL_HARITASI.md)
> * **Devir ve onboarding için:** [docs/00-devir-rehberi/DEVIR_REHBERI.md](../00-devir-rehberi/DEVIR_REHBERI.md)
> * **Tarihsel kararlar için:** [docs/05-gecmis-ve-arsiv/](../05-gecmis-ve-arsiv/)

---

> [!NOTE]
> ### ✅ Çevrimdışı ve Senkronizasyon Uygulama Durumu (Faz 13 — 11 Kasım 2026)
> * **LAN Hub Dağıtımı:** [`compose.lan.yaml`](../../compose.lan.yaml) ile yerel Mini PC yığını (`db`, `migrate`, `api`, `admin`, `pos`) tanımlandı
> * **`sync` Şeması ([`SyncDbContext.cs`](../../apps/api/Hipos.Api/Sync/SyncDbContext.cs)):** `sync.outbox`, `sync.inbound_events` ve `sync.branch_sync_status` tabloları uygulandı (`20261111193513_InitSync`)
> * **Merkezi Eşitleme:** `SyncBackgroundWorker`, `SyncService`, `GET /sync/status`, `GET /sync/outbox`, `POST /sync/flush`, `POST /api/v1/sync/batch` aktif
> * **Çakışma Koruması:** Aynı `eventId` farklı `payloadHash` ile geldiğinde `IDEMPOTENCY_CONFLICT`; operatör yeniden denemesi için `POST /sync/outbox/{eventId}/retry`
> * **UI Durum Rozeti:** `OperationalApps.tsx` üst çubuğunda `Bulut Bağlı`, `Yerel Ağda · Bulut Bekliyor`, `Eşitleme Durdu`, `Bağlantı Yok` rozeti canlı çalışıyor

---

## 1. Uygulanan Mimari Özeti (`SyncDbContext` & Hibrit Topoloji)

Bir restoranın internet bağlantısı koptuğunda operasyonun durmaması için şube içi LAN Hub (`compose.lan.yaml`, `HIPOS_CLOUD_SYNC_URL` tanımlı) satış, mutfak ve kasa kayıtlarını kendi yerel PostgreSQL veritabanına yazar ve her mutasyon sonunda [`SyncService.TryEnqueueAsync`](../../apps/api/Hipos.Api/Sync/SyncService.cs) ile olayı `sync.outbox` tablosuna ekler. İnternet geri geldiğinde [`SyncBackgroundWorker`](../../apps/api/Hipos.Api/Sync/SyncBackgroundWorker.cs) (veya UI rozetine tıklayarak çağrılan `POST /sync/flush`) olayları `POST /api/v1/sync/batch` üzerinden merkezi bulut sunucusundaki `sync.inbound_events` tablosuna aktarır. *(Detaylı gereksinim ve kabul senaryoları için [Çevrimdışı Çalışma Sözleşmesi](CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md) §11'e bakın.)*

---

## 2. Sistem Mimarisi ve Çalışma Seviyeleri

```mermaid
graph TD
    subgraph Restoran_Ici_LAN [Restoran İçi Yerel Ağ]
        POS[Kasa Terminali] --> LocalAPI[Yerel Mini PC / Hub API]
        Waiter[Garson Telefonu] --> LocalAPI
        KDS[Mutfak Ekranı] --> LocalAPI
        LocalAPI --> LocalDB[(Yerel PostgreSQL)]
        LocalDB --> Outbox[(sync.outbox)]
    end

    subgraph Bulut_Merkez [Bulut / Merkez Sunucu]
        CloudAPI[Merkezi Bulut API]
        CloudDB[(Merkezi Veritabanı)]
        CloudAPI --> CloudDB
    end

    Outbox -.->|İnternet Varken Asenkron Eşitleme| CloudAPI
```

1. **Seviye A (İnternet Var):** Yerel sunucu tüm işlemleri yerel DB'ye yazar, arka planda anlık olarak buluta eşitler.
2. **Seviye B (İnternet Kesik, Yerel Ağ Var):** Tüm restoran içi sipariş, adisyon ve kasa işlemleri yerel Mini PC üzerinde kesintisiz devam eder. Kayıtlar `sync.outbox` tablosunda sıraya alınır.
3. **Seviye C (İnternet Geri Geldi):** Yerel Sync servisi uyanır, kuyruktaki tüm olayları idempotency anahtarıyla sırayla buluta gönderir.

---

## 3. Mimari ve Veritabanı Modeli (`sync` Şeması)

Yerel veritabanında kuyruk mekanizması:

```sql
CREATE SCHEMA IF NOT EXISTS sync;

-- Senkronizasyon Outbox Tablosu
CREATE TABLE sync.outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- "check", "order", "cash_movement", "stock_movement"
    entity_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL, -- "create", "update", "close"
    payload_json JSONB NOT NULL,
    idempotency_key VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    synced_at TIMESTAMPTZ NULL,
    retry_count INT NOT NULL DEFAULT 0,
    last_error TEXT NULL
);

-- Bulut Tarafında Eşitleme Durumu Takibi
CREATE TABLE sync.branch_sync_status (
    branch_id UUID PRIMARY KEY,
    last_synced_at TIMESTAMPTZ NOT NULL,
    pending_count INT NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'healthy' -- healthy, lagging, offline
);
```

---

## 4. Adım Adım Uygulama Yol Haritası

### Adım 1: Outbox Event Interceptor / Filter
* EF Core içinde `SaveChanges` veya transaction tamamlandığında:
  * Eğer işlem gören entity `ISyncable` arayüzünü uyguluyorsa (Adisyon, Sipariş, Kasa Hareketi vb.),
  * Değişiklik aynı transaction içinde JSON olarak `sync.outbox` tablosuna yazılır.

### Adım 2: Yerel Arka Plan Eşitleme Servisi (`SyncBackgroundWorker`)
* .NET `IHostedService` veya `BackgroundService` olarak her 15 saniyede bir çalışır:
  1. `sync.outbox` tablosundaki `synced_at IS NULL` olan en eski 50 kaydı çeker.
  2. İnternet bağlantısını kontrol eder (`GET /api/v1/health` to Cloud).
  3. Kayıtları topluca buluta POST eder: `POST /api/v1/sync/batch`.
  4. Buluttan `200 OK` yanıtı gelince yereldeki kayıtların `synced_at = clock_timestamp()` alanını günceller.

### Adım 3: Çakışma Çözümleme Kuralları (Conflict Resolution)
* **Adisyon ve Ödemeler (Append-Only):** Kasa hareketleri ve adisyonlar değiştirilemez olduğu için çakışma riski düşüktür; her benzersiz `idempotency_key` bulutta tek bir kayda denk gelir.
* **Masa Durumu:** Yerel sunucu her zaman **fiziksel restoranın anlık durumunda hakemdir (Source of Truth)**. Bulut masa durumunu yerelden gelen son duruma göre günceller.
* **Ürün & Menü Değişiklikleri:** Merkezden şubeye tek yönlü (downstream) akar. Şube menü değiştiremez, sadece merkezin yayınladığı menüyü indirir.

### Adım 4: Kullanıcı Arayüzünde Senkronizasyon Durum Rozeti
* `apps/pos` ve `apps/admin` ekranlarının üst çubuğunda canlı durum göstergesi:
  * 🟢 **Bulut Bağlı:** Tüm işlemler eşitlendi.
  * 🟡 **Yerel Modda (X Bekleyen Kayıt):** İnternet yok, yerelde çalışıyor; işlemler kuyrukta bekliyor.
  * 🔴 **Bağlantı Hatası:** Yerel sunucuya da ulaşılamıyor (kablo/Wi-Fi kopuk).

---

## 5. Kabul Kriterleri (Devir Doğrulama Testi)

1. Restoranın internet kablosu çekildiğinde Kasa ve Garson ekranı hata vermeden sipariş almaya ve adisyon açmaya devam edebilmeli.
2. Çevrimdışı iken 10 adet sipariş ve 5 adet ödeme kaydedildiğinde bu 15 işlem `sync.outbox` tablosunda birikmeli.
3. İnternet kablosu geri takıldığında en geç 30 saniye içinde bulut veritabanında bu 15 işlem eksiksiz ve çiftleme olmadan belirmelidir.
