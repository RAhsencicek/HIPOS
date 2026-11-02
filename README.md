# HIPOS — Restoran Yönetim ve Operasyon Platformu

> **Durum:** Geliştirme Prototipi (MVP) · **Son Güncelleme:** 21 Ekim 2026
> **Ana Devir Merkezi:** [docs/00-devir-rehberi/DEVIR_REHBERI.md](docs/00-devir-rehberi/DEVIR_REHBERI.md)
> **Dokümantasyon Dizin Haritası:** [docs/README.md](docs/README.md)

---

> [!IMPORTANT]
> ### ⚠️ BUGÜNKÜ GERÇEK DURUM (Gerçeklik Beyanı)
> **Bu repo henüz üretime hazır tam bir restoran ERP/POS sistemi DEĞİLDİR.**
>
> * **Mevcut Çalışan Kalıcı Dilimler:** Katalog ve Menü (`catalog`), Cari Hesaplar (`cari`), Stok/Envanter/Reçete (`inventory`), Manuel Kasa Vardiyası ve Defteri (`cash`), Giderler (`finance`), Ortak Adisyon Çekirdeği (`sales` / `service`), Geliştirme Test POS'u (`apps/pos`) ve Simüle Ödeme.
> * **Eksik Olan Üretim Bileşenleri:** Gerçek kimlik doğrulama / Auth (şu an sahte `X-Demo-Actor` var), gerçek banka POS entegrasyonu, Beko/Token ÖKC donanım sertifikasyonu, internet koptuğunda çift taraflı çalışan yerel LAN senkronizasyonu, satışın kasaya otomatik çift deftersiz akışı ve operasyonel kabul testleri.

---

## 1. Proje Nedir?

HIPOS; bir restoranın yönetim (ERP), mutfak (KDS), salon servis (Waiter) ve kasa (POS) operasyonlarını tek bir işletme omurgası üzerinde birleştirmeyi hedefleyen **yeni nesil bir restoran işletim platformudur**.

Proje monorepo mimarisindedir:
* `apps/admin`: Yönetim paneli (React 19 + TypeScript + Vite + Tailwind CSS).
* `apps/pos`: Kasa, Test POS, garson el terminali (`/waiter`) ve mutfak (`/kitchen`) geliştirme ekranları.
* `apps/api`: ASP.NET Core (.NET 10) ve PostgreSQL (EF Core 10) tabanlı modüler REST API.

---

## 2. Hızlı Başlatma (Quickstart)

### macOS Kolay Başlatma (Önerilen)
Repo kök dizinindeki script'e çift tıklayın veya terminalden çalıştırın:
```bash
./HIPOS-Baslat.command
```
Bu script Docker Desktop'ı kontrol eder, PostgreSQL'i ayağa kaldırır, 9 EF Core migration context'ine (`FeatureDbContext`, `CatalogDbContext`, `SalesDbContext`, `CariDbContext`, `ServiceDbContext`, `InventoryDbContext`, `CashDbContext`, `ExpenseDbContext`, `KitchenDbContext`) ait veritabanı migration'larını sırayla uygular, demo seed veri setlerini (`features`, `menus`, `cari`, `service`, `inventory`, `cash`, `expenses`) yükler ve Admin (`5173`), POS (`5176`), API (`5180`) servislerini başlatarak tarayıcıyı açar. `npm run dev` ile manuel başlatma da Admin için `5173` portunu kullanır.

Durdurmak için:
```bash
./HIPOS-Durdur.command
```

### Windows Kolay Başlatma
Repo kök dizinindeki batch dosyasına çift tıklayın veya terminalden (CMD / PowerShell) çalıştırın:
```cmd
HIPOS-Windows-Baslat.bat
```

Durdurmak için:
```cmd
HIPOS-Windows-Durdur.bat
```

### Manuel Başlatma (Adım Adım)
1. **Yerel Veritabanını Başlatın:**
   ```bash
   docker compose up -d db
   ```
2. **Backend API'yi Başlatın:**
   ```bash
   dotnet run --project apps/api/Hipos.Api/Hipos.Api.csproj --urls http://127.0.0.1:5180
   ```
3. **Yönetim Panelini Başlatın:**
   ```bash
   npm run dev
   # Panel: http://localhost:5173/admin
   ```
4. **Test POS / Terminal Ekranlarını Başlatın:**
   ```bash
   npm run dev:pos
   # POS: http://localhost:5176
   ```

---

## 3. Ana Test Komutları

Geliştirilen her özellik aşağıdaki test kapılarından geçmelidir:

```bash
# Dokümantasyon format ve git diff denetimi
npm run docs:check

# Frontend birim ve entegrasyon testleri
npm test

# Panel ve API E2E entegrasyon testleri
npm run test:api-ui

# İzole geçici veritabanında uçtan uca PostgreSQL kabul testleri
npm run test:db

# Tip denetimi ve derleme doğrulaması
npm run typecheck
npm run build
```

---

## 4. Dokümantasyon ve Belge Hiyerarşisi

Projenin tüm mimari kararları, iş alanı sözleşmeleri ve modül şartnameleri [`docs/`](docs/) altında kategorize edilmiştir:

> **Dokümantasyon Hiyerarşisi:**
> * **Güncel kod durumu için:** [docs/01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md](docs/01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md)
> * **Güncel teslim ve yol haritası için:** [docs/00-devir-rehberi/DURUM_VE_YOL_HARITASI.md](docs/00-devir-rehberi/DURUM_VE_YOL_HARITASI.md)
> * **Devir ve onboarding için:** [docs/00-devir-rehberi/DEVIR_REHBERI.md](docs/00-devir-rehberi/DEVIR_REHBERI.md)
> * **Tarihsel kararlar için:** [docs/05-gecmis-ve-arsiv/](docs/05-gecmis-ve-arsiv/)

| Belge | Amacı ve Rolü |
|---|---|
| **[docs/README.md](docs/README.md)** | **Belgeleri Nerede Bulurum?** Tüm dokümanların kategorize dizin haritası. |
| **[DEVIR_REHBERI.md](docs/00-devir-rehberi/DEVIR_REHBERI.md)** | **Proje Bugün Ne Durumda ve Nasıl Devralınır?** Yeni mühendisler için ana devir merkezi. |
| **[BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md](docs/01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md)** | **Kodun Gerçek Teknik Kaynağı:** 8 PostgreSQL şeması ve modül sınırları. |
| **[DURUM_VE_YOL_HARITASI.md](docs/00-devir-rehberi/DURUM_VE_YOL_HARITASI.md)** | **Güncel Teslim ve Backlog:** Modül modül eksikler ve geliştirme sıralaması. |

A'dan Z'ye modül bazlı devir şartnameleri için [docs/00-devir-rehberi/](docs/00-devir-rehberi/) dizinindeki `MODUL_01` — `MODUL_07` belgelerini inceleyin.
