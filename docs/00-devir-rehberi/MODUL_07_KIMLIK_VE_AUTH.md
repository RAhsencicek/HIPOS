# Modül 7 Devir Şartnamesi — Kimlik, Oturum ve Yetkilendirme (Auth & Security)

> **Doküman Durumu:** Kesinleşmiş Modül Devir ve Uygulama Şartnamesi · Sürüm: v3.6 (9 Kasım 2026)
> **Kapsam:** Güvenlik Mimarisi, RBAC Yetki Matrisi, PIN Doğrulama, JWT Oturumu ve Yönetici Personel PIN Yönetim Arayüzü
> **Modül Durumu:** ✅ **Tamamlandı ve Canlı Tarayıcıda Doğrulandı (FAZ 2 TAMAM)**
> **PostgreSQL Şeması:** `auth` (`auth.users`, `auth.memberships`, `auth.pin_codes`) ve `service.employees` Köprüsü
> **Yönetim Paneli:** Login Var (`LoginPage.tsx`) · Personel Kartları & PIN Sıfırlama Var (`ServicePersonnelPage.tsx`)
> **API:** Var (`AuthDbContext.cs`, `AuthEndpoints.cs`, `AuthDbInitializer.cs`, `ServiceEndpoints.cs`)
> **Ana Devir Rehberi:** [DEVIR_REHBERI.md](DEVIR_REHBERI.md) · **Yol Haritası:** [DURUM_VE_YOL_HARITASI.md](DURUM_VE_YOL_HARITASI.md)

---

### 📌 Gerçeklik ve Uygulama Durumu Özeti

| Alan / Özellik | Durum | Açıklama |
| :--- | :--- | :--- |
| **`auth` PostgreSQL Şeması** | **Çalışıyor** | `auth.users`, `auth.memberships`, `auth.pin_codes` tabloları aktiftir. |
| **Yönetici Girişi (Email + Şifre)** | **Çalışıyor** | `POST /api/v1/auth/login` BCrypt doğrulamasıyla JWT ve kullanıcı DTO döner (`patron@hipos.local`). |
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
- Her kartta yeşil `🔑 PIN Aktif` rozeti ve `Kartı & PIN'i Düzenle` butonu yer alır.
- Düzenleme tıklandığında sayfa akıcı biçimde formun başına kayar (`window.scrollTo`), PIN giriş alanı `Terminal PIN Sıfırla (4 hane)` başlığıyla açılır.
- PIN değiştirilmediğinde boş bırakılabilir, mevcut PIN korunur.

### C. Saha Testi ve Kanıtlar (9 Kasım 2026):
1. **PIN Doğrulama:** `Ayşe Demir` PIN'i `2221` ile `POST /pin-verify` çağrıldı; JWT üretildi (Başarılı).
2. **PIN Sıfırlama:** Admin API üzerinden `Ayşe Demir` PIN'i `5555` yapıldı:
   - Eski PIN `2221` ile giriş denendi: `401 Unauthorized` (Başarılı).
   - Yeni PIN `5555` ile giriş denendi: `200 OK` (Başarılı).
3. **PIN Çakışma Koruması:** `Ayşe Demir`'e Mehmet Garson'un PIN'i olan `2222` atanmaya çalışıldı:
   - Backend `409 PIN_ALREADY_IN_USE` cevabı verdi ve *"Bu PIN kodu zaten 'Mehmet Garson' tarafından kullanılıyor"* uyarısı döndü (Başarılı).
4. **Yeni Personel Ekleme:** `Caner Garson` (PIN: `7777`) oluşturuldu; anında hem Admin'de, hem `/waiters` listesinde, hem de `POST /pin-verify` sorgusunda doğrulandı (Başarılı).
