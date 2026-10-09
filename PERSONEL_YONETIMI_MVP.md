# Personel Yönetimi MVP

## Ürün sınırı

Personel kaydı; çalışanın bölümünü ve görev unvanını işletme içinde düzenlemek içindir. İş unvanı uygulamaya giriş yetkisi değildir. Toast'ın resmi ürün dokümanında çalışan profili, job/rol ve erişim izinleri ayrı yönetilir; Square da çalışan profili ile konum erişimini ayrı adımlar olarak ele alır. HIPOS bu ayrımı korur: bu MVP bordro, ücret, T.C. kimlik numarası, doğum tarihi, vardiya/puantaj, performans veya POS kullanıcı hesabı tutmaz. Telefon alanı isteğe bağlıdır.

İlk tek-şube görünümü yönetim, şef, mutfak ekibi, servis, kasa ve destek gruplarını ayrı kart ızgaralarında gösterir. Mutfak unvanında “şef/chef” geçenler, mutfak ekibinden ayrı Şefler ızgarasında gösterilir. İleride çalışan başka bölüm ve şubelerde görev alabilecek şekilde kayıtlar firma ve şube kapsamı taşır.

## Veri modeli

`service.employees` mevcut `service.waiters` satırlarını silmeden devralır. Mevcut `assignments.waiter_id` yabancı anahtarı aynı personel kimliklerini koruyarak `employees.id` alanına bağlanır.

| Alan | Anlamı |
| --- | --- |
| `id` | Personel kimliği; POST idempotency anahtarı olarak `requestId` kullanılır |
| `firm_id`, `branch_id` | Firma ve çalıştığı şube kapsamı |
| `name` | Ad soyad |
| `department` | `management`, `kitchen`, `service`, `cashier`, `support` |
| `job_title` | Serbest iş unvanı; ör. Baş aşçı, Garson, Kasiyer |
| `phone` | İsteğe bağlı iletişim telefonu |
| `is_active`, `version` | Soft pasife alma ve eşzamanlı düzenleme kontrolü |
| `created_at`, `updated_at` | Kayıt ve son değişiklik zamanı |

Personel kartı silinmez; pasife alınır. Açık masa-adisyon ataması bulunan servis personeli pasife alınamaz veya başka bölüme taşınamaz. Denetim olayı `service.audit` tablosuna yazılır. `staff.records` capability'si masa servisi ve garson atama capability'sinden bağımsızdır. Özelliği kapatmak veriyi veya geçmiş atamaları silmez; okuma sürer, yazma durur.

## API

Temel: `/api/v1/firms/{firmId}/branches/{branchId}/service`

- `GET /employees` — şube kapsamındaki tüm personel kartları; bölüm, görev ve isActive alanlarıyla.
- `POST /employees` — `{ requestId, name, department, jobTitle, phone }`. Aynı requestId ve aynı içerik tekrarında aynı kayıt döner; farklı içerik `409 EMPLOYEE_REQUEST_CONFLICT` alır.
- `PUT /employees/{employeeId}` — `{ expectedVersion, name, department, jobTitle, phone, isActive }`. Eski sürüm `409 VERSION_CONFLICT`; açık servis ataması olan personelin pasifleştirilmesi/bölüm değiştirmesi `409 EMPLOYEE_HAS_OPEN_ASSIGNMENT` alır.
- Önceki `/waiters` okuma/yazma uçları, masa-servis uyumluluğu için servis bölümündeki personel kartlarına adaptör olarak kalır.

Personel verisi HTTP service provider açıkken PostgreSQL'den okunur/yazılır. `X-Demo-Actor` yerel geliştirme prototipidir; üretim kimlik doğrulaması değildir.

## Manuel kabul testi

1. API ve paneli başlat; `VITE_SERVICE_PROVIDER=http` ve `VITE_FEATURE_PROVIDER=http` etkin olsun.
2. `/admin/kitchen/personnel` aç: servis PostgreSQL kayıtları yüklenmeli, boşsa açık empty-state görünmeli.
3. Yönetim, mutfak/şef, mutfak ekibi, servis, kasa ve destek bölümlerine personel ekle. Her kart doğru ayrı ızgarada görünmeli; “Şef” unvanı mutfak ekibi ızgarasında değil ayrı Şefler ızgarasında olmalı.
4. Arama, görev ve telefon görüntüsünü dene; bir kartı düzenle, pasife al ve tekrar aktifleştir. Yenileme sonrası değişiklikler kalmalı.
5. Aynı `requestId` ile aynı POST ikinci çalışan oluşturmamalı. Eski `expectedVersion` güncellemesi 409 olmalı.
6. Garson kartını bir açık adisyona bağla; açık atama sürerken kartı pasifleştirme veya bölümünü değiştirme 409 vermeli. Masa planı yalnızca kayıtlı atamayı göstermeli; personel oluşturma formu içermemeli.
7. `staff.records` kapat: liste okunabilir kalmalı, form yazmaları durmalı. Masa özelliğini kapatmak personel kayıtlarını silmemeli.

## Kaynaklar

- [Toast: çalışan izinleri, job bazlı roller ve konum kapsamı](https://support.toasttab.com/en/article/Assigning-User-Access-Permissions)
- [Square: ekip üyeleri ekleme, düzenleme ve pasife alma](https://squareup.com/help/us/en/article/8356-add-and-manage-team-members)
- [Toast Platform Guide: çalışan işi/job ve izinleri](https://doc.toasttab.com/doc/platformguide/platformEmployeeJobs.html)
