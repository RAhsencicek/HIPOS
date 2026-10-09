# HIPOS — İlk üç ürün aşaması

Durum: 8 Ekim 2026. Arkadaşlarla yapılan değerlendirme ve [yön taslağı](YENI_URUN_YONU_TASLAK.md) üzerine uygulama planı. İşletme adı ve ayrıntılı iş kuralları ekipçe değiştirilebilir; aşağıdaki varsayımlar ilerlemeyi başlatmak içindir.

## Ürün odağı

İlk tanıtım tek şubeli bir fırın-kafeye odaklanır. Yönetici ürün ve fiyatı, reçete, stok, sayım ve müşteri/tedarikçi carisini aynı işletme verisi üzerinden görür. Gerçek POS, tahsilat, mali belge, web sitesi yayını, kişi bazlı mutfak performansı ve çok şubeli merkez işleri ilk anlatımın parçası değildir. Mevcut test POS ve ödeme simülatörü teknik kanıt olarak kalır.

Geçici örnek: **Mahalle Fırını → Kadıköy Şubesi**. Örnek kişi ve kurumlar kurgusaldır. TRY tek para birimidir. Aynı cari ileride müşteri ve tedarikçi türlerini birlikte taşıyabilecek şekilde tasarlanır. Reçete otomatik stok tüketmez. Sayımın fiziksel girişi stoku değiştirmez; yönetici onayından sonra izli düzeltme hareketi oluşur.

## Aşama 1 — Tutarlı tek şube veri temeli

**Teslim:** Kimlikleri sabit ve tekrar yüklenebilir bir demo veri sözleşmesi; ürün, kategori, fiyat, hammadde, reçete, cari, stok hareketi ve örnek sayım arasında doğrulanabilir bağlantılar. Panel tek şube görünümüyle açılır. PostgreSQL'de var olan katalog tablolarına ürün/fiyat/yayın kayıtları yalnız geliştirme ortamında yüklenir.

**İlk veri temeli:** Kimlikleri sabit demo sözleşmesi ve katalog seed'i kuruldu. Reçete/stok/sayım kalıcılığı aşağıdaki Aşama 3 teslimine alındı; Aşama 1'in bütün bağlantı hedefleri o aşama kapanmadan tamam sayılmaz.

**Bugünkü ilerleme:** [Demo veri dosyası](contracts/demo-single-branch.v1.json) katalog, cari, reçete, stok hareketi ve örnek sayımı aynı kimliklerle tanımlar. Her makinedeki yerel veritabanı ayrı seed edilmelidir. Cari Aşama 2 ilk kalıcı dilimde tamamlandı; reçete/stok/sayım Aşama 3 kalıcı API ve PostgreSQL kabul akışıyla uygulandı.

## Aşama 2 — Cari MVP

**Teslim:** Ortak cari kimliği; müşteri ve tedarikçi sekmeleri; kart oluşturma/düzenleme, detay, aktiflik; elle hareket girişi; TRY bakiye ve tarih aralıklı ekstre. Hareketin yönü, kaynağı ve açıklaması görünür. Başlangıçtaki demo carileri aynı kimliklerle veritabanına alınır.

**İş kuralı:** Kullanıcı bakiye yazmaz; bakiye hareketlerden hesaplanır. Pozitif tutar müşteri için işletmenin alacağı, tedarikçi için işletmenin borcu anlamına gelir; kapama ters yöndedir. Elle girilen örnek hareket gerçek ödeme veya fatura olarak sunulmaz. Firma/şube erişimi, tekrar istek, eşzamanlı kayıt ve denetim izi API'de korunur. Mevcut menüdeki müşteri, tedarikçi, borç ve alacak yolları tek cari verisine bakar.

**Kabul:** Kurgusal müşteri/tedarikçi örnekleri yüklenir. Beta Ofis alacağı ve ABC Gıda borcu hareketlerden çıkar; idempotency çift kayıt üretmez, firma kapsamı korunur. Cari kartı ekranındaki “örnek” ve “kalıcı” durumlar veri kaynağına uygun görünür.

**Cari hesabın mevcut işletilebilir kapsamı:** Cari kart/iletişim, müşteri veresiye-alacak ve tahsilat kaydı, tedarikçi borç ve ödeme kaydı, gerekçeli bakiye düzeltmesi, devir/dönem/kapanış ekstresi, toplam alacak/borç özeti ve müşteri/tedarikçi bağımsız capability kapıları PostgreSQL'de çalışır. Eski imzalı hareketler `legacy_manual` olarak migration ile korunur. Tahsilat/ödeme elle girilen kayıt olup fatura, banka/POS veya kasa işlemi değildir. **Kalan:** belge/vade/yaşlandırma ve ödeme dağıtımı, satın alma-mal kabul/stok bağı, satıştan otomatik cari hareket, finans alt ekran bağlantısı ve gerçek oturum/rol güvenliği.

## Aşama 3 — Reçete, stok ve sayım MVP

**Teslim:** Hammadde/birim kartları; elle stok hareketi; sistem miktarı ve kritik eşik; ürün başına sürümlü reçete ve geçmiş; tek depo için sayım taslağı, fiziksel miktar, fark, inceleme ve onaylı düzeltme. Aşama 1'deki stok ve reçete kimlikleri veritabanına alınır.

**İş kuralı:** Önceki reçete sürümü değişmez. İlk sürümde fire alanı isteğe bağlıdır; güvenilir alış maliyeti yoksa porsiyon veya sayımın parasal farkı hesaplanmış gibi gösterilmez. Sayım sırasında stok değişirse onay güncel sistem miktarını yeniden doğrular veya çakışma verir. Barkod sonraki giriş yöntemidir; aynı sayım modelini kullanır. Satışın reçeteye göre otomatik stok düşmesi bu aşamada yapılmaz.

**Kabul:** Margherita'nın reçetesindeki mozzarella ile stoktaki mozzarella aynı kayıttır. Sayım taslağı 800 g sistem / 700 g fiziksel miktarı ve -100 g farkı gösterir; onay öncesi stok 800 g kalır, onay sonrası tek bir -100 g düzeltme hareketiyle 700 g olur. Aynı onay isteği ikinci hareket yaratmaz. Eski reçete sürümü ve sayım geçmişi okunabilir.

**İlk kalıcı dilim uygulandı ve kabul edildi:** `inventory` migration'ı, hammadde/reçete sürümü/movement/count/audit tabloları; firma/şube kapsamlı API; tekrarlanabilir ayrı inventory seed'i ve PostgreSQL entegrasyon senaryoları eklendi. UI `VITE_INVENTORY_PROVIDER=http` ile API'ye bağlanır. Modül tercihi `inventory.items` → `inventory.recipes` / `inventory.counts` olarak ayrıdır; stok kapatılınca veri silinmez ve yeni yazma engellenir. İzole PostgreSQL kabul testi geçti; seed tekrar güvenliği, reçete sürümü, idempotent hareket, negatif stok, onaylı tek düzeltme, stok değişimi çakışması ve modül bağımlılığını doğruladı. Bu bilgisayardaki `hipos_features` DB'sinde migration ve seed sonrası 9 hammadde, 4 reçete, 15 hareket, 1 taslak sayım ve 800 g mozzarella doğrulandı. Kapsam ilk MVP'de tek şube/tek stok alanı. Elle panel adımları [stok test rehberinde](STOK_REÇETE_SAYIM_MANUEL_TEST.md).

**Genişletilmiş stok/sayım dilimi:** Aynı sözleşme geriye dönük korunarak `warehouseId`, Kadıköy Ana Depo, yönetilebilir kritik eşik, API tabanlı ana sayfa uyarısı, immutable manuel giriş/çıkış ve denetim, reçeteden teorik üretim, sayım açıkken hareket kilidi, iptal ve modül kapatma koruması eklendi. Yerel ve izole PostgreSQL'de doğrulandı. Ayrıntılı API/tablo kuralları [envanter sözleşmesinde](ENVANTER_STOK_SATINALMA_SOZLESMESI.md); elle panel senaryoları [stok test rehberinde](STOK_REÇETE_SAYIM_MANUEL_TEST.md). Çoklu depo transferi ve satın alma henüz yoktur.

## Üç aşamadan sonra

**Açık ürün işi — şube, masa ve garson ilişkisi:** Şube listesi/kapasitesi ile masa planının tek tutarlı veri kaynağına bağlanması ve garson kartında sorumlu masaların gösterilmesi henüz kanıtlanmadı. Stok/sayım diliminden ayrı kabul senaryolarıyla ele alınacak. Mevcut servis denemesi [elle test rehberinde](MASA_SERVISI_TEST.md).

Genel bakış gerçek kaynaklara bağlanır; mevcut test satış akışı tanıtım hikâyesine uygun şekilde sadeleştirilir. Alt ekranlar “Bu alanda neler var?” ve “Gelecekte neler olacak?” olarak ayrılır. Mutfak kişi performansı çıkarılır. Fiyat listesi ayrı modül olarak açılmaz; ilk sürümde ürün fiyatları mevcut katalog alanında gösterilir. Web sitesi yayını ve ayrıntılı yetki sonraki yol haritasında kalır; gerçek kullanıcı pilotundan önce güvenli giriş ve firma/şube erişimi zorunludur.

## Ekipçe teyit edilen ilk kararlar

İlk tanıtım Mahalle Fırını / Kadıköy Şubesi, TRY ve tek depo üzerinden ilerler. Aynı cari müşteri ve tedarikçi türlerini birlikte taşıyabilir; manuel hareket girilebilir. Sayım taslağını ilk sürümde tek yetkili yönetici onaylar; onaydan önce stok değişmez, onaydan sonra yalnız bir izli düzeltme hareketi oluşur. Reçete otomatik stok tüketmez. Fiyat listesi şimdilik ayrı modül değildir. Pilot/üretim kimlik doğrulaması, gerçek rol bazlı onay ve barkod girişi henüz yapılmadı.
