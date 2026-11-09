# Modül 7 Devir Şartnamesi — Kimlik, Oturum ve Yetkilendirme (Auth & Security)

> **Doküman Durumu:** Kesinleşmiş Modül Devir ve Uygulama Şartnamesi · Sürüm: v3.5 (9 Kasım 2026)
> **Kapsam:** Güvenlik Mimarisi, RBAC Yetki Matrisi, PIN Doğrulama, JWT Oturumu ve Personel PIN Yönetim Arayüzü
> **Modül Durumu:** Kalıcı MVP (Çalışıyor) · BCrypt Parola/PIN Hashleme, JWT Üretimi, POS PIN Pad Girişi (Çalışıyor) · **Admin Personel PIN Yönetim Arayüzü (FAZ 2 - Uygulanacak)**
> **PostgreSQL Şeması:** `auth` (`auth.users`, `auth.memberships`, `auth.pin_codes`)
> **Yönetim Paneli:** Login Var (`LoginPage.tsx`) · Personel PIN Arayüzü (FAZ 2)
> **API:** Var (`AuthDbContext.cs`, `AuthEndpoints.cs`, `AuthTokenService.cs`)
> **Ana Devir Rehberi:** [DEVIR_REHBERI.md](DEVIR_REHBERI.md) · **Yol Haritası:** [DURUM_VE_YOL_HARITASI.md](DURUM_VE_YOL_HARITASI.md)

---

### 📌 Gerçeklik ve Uygulama Durumu Özeti

| Alan / Özellik | Durum | Açıklama |
| :--- | :--- | :--- |
| **`auth` PostgreSQL Şeması** | **Çalışıyor** | `auth.users`, `auth.memberships`, `auth.pin_codes` tabloları aktiftir. |
| **Yönetici Girişi (Email + Şifre)** | **Çalışıyor** | `POST /api/v1/auth/login` BCrypt doğrulamasıyla JWT ve kullanıcı DTO döner (`patron@hipos.local`). |
| **Hızlı Dokunmatik PIN Doğrulama** | **Çalışıyor** | `POST /api/v1/auth/pin-verify` Kasiyer (`1111`), Garson (`2222`), Aşçı (`3333`), Patron (`9999`) PIN'lerini BCrypt hash ile doğrular. |
| **POS PIN Pad Kilit Ekranı** | **Çalışıyor** | Kasa ve Garson ekranları dokunmatik numpad ile açılır; inaktivitede kilitlenir. |
| **Admin Personel PIN Yönetim Ekranı** | 🔴 **Eksik (FAZ 2)** | Admin panelinde yeni personele 4 haneli PIN verme / PIN sıfırlama arayüzü henüz yoktur. |

---

## 🎯 1. Modülün Amacı Nedir?

Bu modül; restoran operasyonunu yetkisiz kullanımlardan koruyan güvenlik ve kimlik omurgasıdır. 
İki temel akışı vardır:
1. **Yönetim Paneli (Patron/Müdür):** E-posta ve güçlü şifre ile web üzerinden yönetim merkezine girer.
2. **Restoran Terminalleri (Kasa, Garson, Mutfak):** Hızın kritik olduğu dokunmatik ekranlarda personeller 4 haneli kişisel PIN kodlarıyla saniyeler içinde oturum açar ve yetkilerine göre işlem yapar.

---

## 📂 2. Hangi Dosyalar ve Kod Bloklarıyla Çalışacaksın?

1. **Backend (.NET API):**
   * [AuthDbContext.cs](../../apps/api/Hipos.Api/Auth/AuthDbContext.cs) — Kullanıcılar (`UserRow`), Üyelikler (`MembershipRow`), PIN Kodları (`PinCodeRow`).
   * [AuthEndpoints.cs](../../apps/api/Hipos.Api/Auth/AuthEndpoints.cs) — `/api/v1/auth/login`, `/api/v1/auth/pin-verify`, `/api/v1/auth/owner-override`.
   * [AuthTokenService.cs](../../apps/api/Hipos.Api/Auth/AuthTokenService.cs) — HS256 JWT Token üretimi.
2. **Ön Yüz (Frontend):**
   * [LoginPage.tsx](../../apps/admin/src/features/auth/LoginPage.tsx) — Yönetim paneli patron giriş sayfası.
   * [OperationalApps.tsx](../../apps/pos/src/OperationalApps.tsx) — Kasa ve Garson dokunmatik numpad PIN kilit bileşenleri.
   * `apps/admin/src/features/staff/` (FAZ 2 kapsamında geliştirilecek Personel PIN yönetim arayüzü).

---

## 🚀 3. FAZ 2: Admin Personel ve PIN Yönetim Sözleşmesi

### A. Gerekli API Endpoint'leri (Geliştirilecek):
1. `GET /api/v1/firms/{firmId}/branches/{branchId}/auth/staff`
   - Şubedeki tüm personelleri listeler.
   - Dönen DTO: `{ id, fullName, email, phone, role, hasPin, isActive }` (PIN hash asla istemciye gönderilmez).
2. `POST /api/v1/firms/{firmId}/branches/{branchId}/auth/staff`
   - Yeni personel oluşturur (Ad-Soyad, Rol: `waiter` | `cashier` | `manager` | `chef`, Telefon, 4 haneli başlangıç PIN'i).
   - `auth.users`, `auth.memberships` ve `auth.pin_codes` kayıtlarını tek seferde atomik oluşturur.
3. `PUT /api/v1/firms/{firmId}/branches/{branchId}/auth/staff/{membershipId}/pin`
   - Yöneticinin unutan personelin PIN kodunu sıfırlamasını sağlar: `{ newPin: "4567" }`.
   - Yeni PIN BCrypt ile hash'lenerek `auth.pin_codes.pin_hash` güncellenir.

### B. Admin Arayüzü (`StaffManagementPage.tsx`):
- Modern kart ve tablo görünümü: Personel Adı, Departmanı, Rolü (`Garson`, `Kasiyer`, `Yönetici`, `Aşçı`), PIN Durumu (`Yeşil: Tanımlı` / `Gri: Tanımsız`).
- `[+ Yeni Personel Ekle]` modalı.
- `[ 🔑 PIN Değiştir ]` butonu: 4 haneli PIN girişi ve anında kaydetme.
