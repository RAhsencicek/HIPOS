# Modül 7 Devir Şartnamesi — Kimlik, Oturum ve Yetkilendirme (Auth & Security)

> **Doküman Durumu:** Kesinleşmiş Modül Devir ve Uygulama Şartnamesi · Sürüm: v4.0 (11 Kasım 2026)
> **Kapsam:** Güvenlik Mimarisi, RBAC Yetki Matrisi, PIN Doğrulama, JWT Oturumu, Çok Kiracılı (Multi-Tenant) Firma/Şube İzolasyonu, Onboarding ve Print Bridge Yetkilendirmesi
> **Modül Durumu:** ✅ **Tamamlandı ve Üretim Güvenlik Kilidi Doğrulandı (FAZ 2 + FAZ 10 TAMAM)**
> **PostgreSQL Şeması:** `auth` (`auth.firms`, `auth.branches`, `auth.users`, `auth.memberships`, `auth.pin_codes`) ve `service.employees` Köprüsü
> **Yönetim Paneli:** Login Var ([`LoginPage.tsx`](../../apps/admin/src/features/auth/LoginPage.tsx)) · JWT Koruması Var ([`AuthGuard.tsx`](../../apps/admin/src/features/auth/AuthGuard.tsx), [`authFetch.ts`](../../apps/admin/src/shared/authFetch.ts)) · Şube & Köprü Token / Yeni Restoran Kurulumu Var ([`BranchesPage.tsx`](../../apps/admin/src/features/branches/BranchesPage.tsx)) · Personel & PIN Var ([`ServicePersonnelPage.tsx`](../../apps/admin/src/features/branches/ServicePersonnelPage.tsx))
> **POS Terminalleri:** Rota Bazlı JWT & Şube Bağlama Var ([`terminalScope.ts`](../../apps/pos/src/terminalScope.ts), [`PinPadModal.tsx`](../../apps/pos/src/components/PinPadModal.tsx), [`OperationalApps.tsx`](../../apps/pos/src/OperationalApps.tsx))
> **API:** Var ([`AuthDbContext.cs`](../../apps/api/Hipos.Api/Auth/AuthDbContext.cs), [`AuthTokenService.cs`](../../apps/api/Hipos.Api/Auth/AuthTokenService.cs), [`AuthEndpoints.cs`](../../apps/api/Hipos.Api/Auth/AuthEndpoints.cs), [`TenantProvisioningService.cs`](../../apps/api/Hipos.Api/Auth/TenantProvisioningService.cs), [`AuthDbInitializer.cs`](../../apps/api/Hipos.Api/Auth/AuthDbInitializer.cs), [`DemoAccess.cs`](../../apps/api/Hipos.Api/Features/DemoAccess.cs), [`ServiceEndpoints.cs`](../../apps/api/Hipos.Api/Service/ServiceEndpoints.cs))
> **Ana Devir Rehberi:** [DEVIR_REHBERI.md](DEVIR_REHBERI.md) · **Yol Haritası:** [DURUM_VE_YOL_HARITASI.md](DURUM_VE_YOL_HARITASI.md)

---

### 📌 Gerçeklik ve Uygulama Durumu Özeti

| Alan / Özellik | Durum | Açıklama |
| :--- | :--- | :--- |
| **`auth` PostgreSQL Şeması** | **Çalışıyor** | `auth.firms`, `auth.branches`, `auth.users`, `auth.memberships`, `auth.pin_codes` tabloları aktiftir (`20261111171121_AddTenantsAndBranches` migration'ı dahil). |
| **Yönetici Girişi & Kapsam Geçişi** | **Çalışıyor** | `POST /api/v1/auth/login` BCrypt doğrulamasıyla JWT döner; `GET /api/v1/auth/me` kullanıcı yetkilerini/şubelerini döner; `POST /api/v1/auth/switch-scope` yeni şube kapsamlı JWT üretir. |
| **Production `X-Demo-Actor` Kilidi** | ✅ **Çalışıyor (FAZ 10)** | Production ortamında (`HIPOS_ALLOW_DEMO_ACTOR != "true"`) `X-Demo-Actor` header'ı ve `?actor=` parametresi tamamen reddedilir (`401`). `HIPOS_JWT_SECRET` Production'da en az 32 karakter olmalıdır; zayıf/varsayılan anahtarla API başlatılmaz (fail-fast). |
| **Çok Kiracılı Firma/Şube Onboarding** | ✅ **Çalışıyor (FAZ 10)** | `POST /api/v1/onboarding/tenants` (`X-Platform-Admin-Key` / `IsPlatformAdmin` korumalı) ve `POST /api/v1/firms/{firmId}/branches` yeni firma/şube, masa, kasa ve kurucu hesapları atomik oluşturur; çapraz firma/şube erişimleri `403` döner. |
| **Print Bridge En Az Yetkili Token** | ✅ **Çalışıyor (FAZ 10)** | `POST /api/v1/firms/{firmId}/branches/{branchId}/printing/bridge-token` yalnızca tek şube için `role="bridge"` token'ı üretir (`DemoAccess.CanAccessPrintBridge`); `bridge` token'ı sadece `GET /printing/config` ve `GET /events/stream` SSE akışına erişebilir, diğer uçlarda `403` alır. |
| **POS Terminal Şube Bağlama & İzolasyon** | ✅ **Çalışıyor (FAZ 10)** | `/waiter`, `/kitchen` ve `/cashier` PIN açılışına kadar korumalı API/SSE çağrısı yapmaz; her terminal rolü kendi route anahtarında (`hipos_waiter_token`, `hipos_kitchen_token`, `hipos_cashier_token`) izole JWT tutar ve `GET /api/v1/auth/branch-info` ile bağlı şubeyi doğrular. |
| **Hızlı Dokunmatik PIN Doğrulama** | **Çalışıyor** | `POST /api/v1/auth/pin-verify` Kasiyer (`1111`), Garson (`2222`), Aşçı (`3333`), Patron (`9999`) ve şubedeki tüm personellerin PIN'lerini BCrypt hash ile doğrular. |
| **POS PIN Pad Kilit Ekranı** | **Çalışıyor** | Kasa ve Garson ekranları dokunmatik numpad ile açılır; inaktivitede kilitlenir. |
| **Admin Personel & PIN Yönetim Ekranı** | ✅ **Çalışıyor (FAZ 2)** | `/admin/kitchen/personnel` ekranında tüm departman personelleri listelenir; yeşil `🔑 PIN Aktif` rozeti gösterilir; yönetici yeni PIN tanımlayabilir veya mevcut PIN'i sıfırlayabilir. |
| **PIN Çakışma ve Güvenlik Denetimi** | ✅ **Çalışıyor** | Aynı şubede iki personele aynı PIN'in verilmesi backend seviyesinde (`PIN_ALREADY_IN_USE - 409`) engellenir ve çakışan personelin adı bildirilir. |

---

## 🎯 1. Modülün Amacı ve PIN Güvenlik Mantığı

Bu modül; restoran operasyonunu yetkisiz kullanımlardan koruyan güvenlik ve kimlik omurgasıdır.

### Temel İş Kuralları:
1. **Yönetim Paneli (Patron/Müdür):** E-posta ve şifre (`Patron123!`) ile web üzerinden yönetim merkezine girer.
2. **Restoran Terminalleri (Kasa, Garson, Mutfak):** Dokunmatik ekranlarda personeller 4 haneli kişisel PIN kodlarıyla saniyeler içinde oturum açar ve yetkilerine göre işlem yapar.
3. **PIN Değiştirilemezlik ve Yönetici Kontrolü Kuralı:**
   - Personel terminal PIN kodu, personelin **dijital sicil numarası / T.C. kimliği** gibidir.
   - Personel terminal üzerinden kendi PIN'ini kafasına göre değiştiremez.
   - PIN yalnızca Şube Yöneticisi / Patron tarafından Admin panelinden belirlenir veya unutan personel için sıfırlanır.

---

## 📂 2. Mimari ve İlgili Dosyalar

1. **Backend (.NET API):**
   * [AuthDbContext.cs](../../apps/api/Hipos.Api/Auth/AuthDbContext.cs) — Kullanıcılar (`UserRow`), Üyelikler (`MembershipRow`), PIN Kodları (`PinCodeRow`).
   * [AuthEndpoints.cs](../../apps/api/Hipos.Api/Auth/AuthEndpoints.cs) — `/api/v1/auth/login`, `/api/v1/auth/pin-verify`, `/api/v1/auth/quick-staff`.
   * [AuthDbInitializer.cs](../../apps/api/Hipos.Api/Auth/AuthDbInitializer.cs) — Çekirdek demo kullanıcıları ve `service.employees` ile `auth.users` arasındaki çift yönlü başlangıç senkronizasyonu (`SynchronizeStaffAndAuthAsync`).
   * [ServiceEndpoints.cs](../../apps/api/Hipos.Api/Service/ServiceEndpoints.cs) — Personel kartları, PIN tanımlama/sıfırlama ve çakışma kontrolü (`GET /employees`, `POST /employees`, `PUT /employees/{id}`).
2. **Ön Yüz (Frontend):**
   * [LoginPage.tsx](../../apps/admin/src/features/auth/LoginPage.tsx) — Yönetim paneli patron giriş sayfası.
   * [ServicePersonnelPage.tsx](../../apps/admin/src/features/branches/ServicePersonnelPage.tsx) — Departman bazlı personel dizini, `🔑 PIN Aktif` rozeti, kart ve PIN düzenleme formu.
   * [OperationalApps.tsx](../../apps/pos/src/OperationalApps.tsx) — Kasa ve Garson dokunmatik numpad PIN kilit ve garson otomatik seçim bileşenleri.

---

## 🚀 3. FAZ 2 Kapsamında Tamamlanan ve Doğrulanan Sözleşmeler

### A. Backend API Endpoint'leri:
1. `GET /api/v1/firms/{firmId}/branches/{branchId}/service/employees`:
   - Şubedeki tüm personelleri departmanlarına göre listeler.
   - Her personel için `role`, `hasPin: bool` ve `userId: Guid` bilgilerini `auth` şemasından birleştirerek döner.
2. `POST /api/v1/firms/{firmId}/branches/{branchId}/service/employees`:
   - Şubeye yeni çalışan ekler (`service.employees`).
   - Aynı anda `auth.users` ve `auth.memberships` kayıtlarını oluşturur.
   - 4-6 haneli `pin` girilmişse BCrypt ile hash'leyerek `auth.pin_codes` içine kaydeder.
   - PIN çakışması varsa `409 PIN_ALREADY_IN_USE` döner.
3. `PUT /api/v1/firms/{firmId}/branches/{branchId}/service/employees/{employeeId}`:
   - Personel kartını (Ad-Soyad, Bölüm, Unvan, Telefon, Aktiflik) günceller.
   - Eğer `pin` alanı dolu gönderilmişse, şube içindeki diğer çalışanlarla çakışmadığını doğrular ve `auth.pin_codes` kaydını günceller.
   - Başarılı PIN sıfırlamada `employee_pin_reset` audit kaydı düşer.

### B. Admin Arayüzü (`ServicePersonnelPage.tsx`):
- Şube Ekibi 6 bölüme ayrılmıştır:
  - **Şube Yönetimi:** Ahmet Patron (Owner), Emre Aydın
  - **Şefler:** Mert Aksoy, Kemal Aşçı, Derya Kaplan
  - **Mutfak Ekibi:** Burak Şen, Ece Arı
  - **Servis Ekibi:** Ayşe Demir, Mehmet Garson, Mehmet Kaya, Zeynep Arslan
  - **Kasa Ekibi:** Ayşe Kasiyer, Ceren Uçar
  - **Destek Ekibi:** Ali Koç
- Her kartta yeşil **`🔑 PIN: {pin}`** rozeti (ör. `🔑 PIN: 1234`) ve `Kartı & PIN'i Düzenle` butonu yer alır. Yöneticiler her personelin mevcut PIN'ini doğrudan kartında görür.
- Düzenleme tıklandığında sayfa akıcı biçimde formun başına kayar (`window.scrollTo`), PIN giriş alanı `Mevcut PIN: 1234` bilgisiyle açılır.
- PIN değiştirilmediğinde boş bırakılabilir, mevcut PIN korunur.

### C. Çoklu Rol ve Terminal Yetkilendirmesi (`OperationalApps.tsx`):
- Restoran pratiğinde kasiyerler ve yöneticiler yoğun saatlerde salona geçip masalardan sipariş alabildikleri için, `/waiter` tablet girişindeki rol kısıtlaması genişletildi (`allowedRoles: ["waiter", "cashier", "owner", "manager", "chef"]`).
- `GET /waiters` uç noktası şubedeki tüm aktif personeli dönecek şekilde güncellendi; böylece masaya sipariş giren kasiyer veya garson otomatik olarak sipariş sahibi garson (`waiterId`) olarak seçilmektedir.

### D. Saha Testi ve Kanıtlar (9 Kasım 2026):
1. **PIN Doğrulama:** `Ayşe Demir` PIN'i `2221` ile `POST /pin-verify` çağrıldı; JWT üretildi (Başarılı).
2. **PIN Sıfırlama:** Admin API üzerinden `Ayşe Demir` PIN'i `5555` yapıldı:
   - Eski PIN `2221` ile giriş denendi: `401 Unauthorized` (Başarılı).
   - Yeni PIN `5555` ile giriş denendi: `200 OK` (Başarılı).
3. **PIN Çakışma Koruması:** `Ayşe Demir`'e Mehmet Garson'un PIN'i olan `2222` atanmaya çalışıldı:
   - Backend `409 PIN_ALREADY_IN_USE` cevabı verdi ve *"Bu PIN kodu zaten 'Mehmet Garson' tarafından kullanılıyor"* uyarısı döndü (Başarılı).
4. **Yeni Personel Ekleme:** `Caner Garson` (PIN: `7777`) oluşturuldu; anında hem Admin'de, hem `/waiters` listesinde, hem de `POST /pin-verify` sorgusunda doğrulandı (Başarılı).
5. **Kasiyerin Garson Tabletine Girişi (Canlı Tarayıcı Testi):**
   - Admin üzerinden Ayşe Kasiyer'in PIN'i `1234` yapıldı ve kartında `🔑 PIN: 1234` rozeti belirdi.
   - Google Chrome ile `http://localhost:5176/waiter` açıldı, PIN pad'e `1234` girildi.
   - Ayşe Kasiyer başarıyla oturum açtı, header'da *"Hoş geldin, Ayşe Kasiyer"* yazdı ve garson dropdown'unda otomatik seçilerek 26 masa siparişe hazır hale geldi.

---

## 🔒 4. FAZ 10 Kapsamında Tamamlanan Üretim Güvenlik Kilidi ve Çok Kiracılı Mimari (11 Kasım 2026)

1. **Production Güvenlik Kilidi (`DemoAccess.cs`, `Program.cs`, `AuthTokenService.cs`):**
   - `HIPOS_JWT_SECRET` Production ortamında zorunlu hale getirildi ve 32 karakterden kısa veya varsayılan anahtarla başlatma engellendi (fail-fast çıkış).
   - `HIPOS_ALLOW_DEMO_ACTOR` açıkça `"true"` yapılmadıkça (ve Production'da) `X-Demo-Actor` header'ı ve `?actor=` query parametresi yok sayılır; imzasız/sahte JWT ve anonim istekler `401` döner.
2. **Çok Kiracılı Şema & Onboarding (`AuthEndpoints.cs`, `TenantProvisioningService.cs`, `20261111171121_AddTenantsAndBranches`):**
   - `auth.firms` ve `auth.branches` tabloları eklendi.
   - `POST /api/v1/onboarding/tenants` (`X-Platform-Admin-Key` veya `IsPlatformAdmin`) yeni müşteri firması, ilk şube, salon/masalar, Ana Kasa (`MAIN`) ve kurucu patron hesabı + PIN kaydını oluşturur.
   - `POST /api/v1/firms/{firmId}/branches` mevcut firmaya ek şube açar; `POST /api/v1/auth/switch-scope` kullanıcının üyeliği varsa seçili `(firmId, branchId)` için yeni kapsamlı JWT üretir. Yetkisiz çapraz firma/şube erişimleri `403` ile kesilir.
   - Çok kiracılı kurulum sonrası kurucu patron/kasiyer gibi diğer departman personellerinin de `/waiter` ekranından sipariş gönderebilmesi için `ServiceEndpoints.cs` (`POST /tables/{tableId}/orders`, `POST /assignments`) ve `SalesOrders.cs` üzerindeki `department='service'` zorunluluğu kaldırılarak `GET /waiters` ile uyumlu biçimde şubedeki tüm aktif personellerin (`IsActive == true`) sipariş alabilmesi sağlandı.
3. **Print Bridge En Az Yetkili (`bridge`) Kapsamı (`DemoAccess.cs`, `RealtimeEndpoints.cs`, `PrintingEndpoints.cs`, `scripts/hipos-print-bridge.mjs`):**
   - `POST /api/v1/firms/{firmId}/branches/{branchId}/printing/bridge-token` yalnızca ilgili şubeye sınırlı `role="bridge"` JWT'si üretir.
   - `DemoAccess`: `IsBridge` kullanıcılarında `CanRead` ve `CanReadFirm` `false` döner; yalnızca `CanAccessPrintBridge` açıktır (`GET /printing/config` ve `GET /events/stream`). Satış/kasa/adisyon uçları `bridge` token'a `403` döner.
   - `scripts/hipos-print-bridge.mjs` `--token` / `HIPOS_BRIDGE_TOKEN` veya `--email` + `--password` ile JWT doğrulaması kullanır ve `Authorization: Bearer` ile SSE dinler.
4. **Admin & POS Frontend İzolasyonu (`AuthGuard.tsx`, `authFetch.ts`, `BranchesPage.tsx`, `terminalScope.ts`, `PinPadModal.tsx`, `OperationalApps.tsx`):**
   - Admin arayüzü JWT zorunlu hale getirildi, statik firma/şube ID'leri ve `X-Demo-Actor` gönderimi kaldırıldı; Şubeler sayfasına (`BranchesPage.tsx`) şube oluşturma, terminal URL kopyalama, Print Bridge token üretimi ve platform yöneticisi onboarding formu eklendi.
   - POS arayüzü (`@hipos/pos`) `?firmId=&branchId=` + `hipos_terminal_scope` üzerinden dinamik şube bağlar, kilitliyken API/SSE isteği atmaz ve `/waiter`, `/kitchen`, `/cashier` oturumlarını ayrı `localStorage` anahtarlarında (`hipos_waiter_token`, `hipos_kitchen_token`, `hipos_cashier_token`) tutar.
5. **Doğrulama Kanıtı (`scripts/test_faz10_security_multitenant.mjs`):**
   - Zayıf JWT sırrıyla Production API başlatma reddedildi; Production API'de anonim, `X-Demo-Actor`, `?actor=` ve sahte JWT istekleri `401` aldı; Tenant 2 onboarding (`403` -> `201`), çoklu şube oluşturma, çapraz kiracı izolasyonu (`403` + `401`), `bridge` token kapsam sınırı + sahte TCP termal yazıcıya 629 bayt ESC/POS teslimatı ve Playwright ile Admin + Waiter (`Masa 01` siparişi) + Kitchen (`Masa 01` kartı) + Cashier rota izolasyonu uçtan uca sıfır `X-Demo-Actor` başlığı ile doğrulandı.
