# HIPOS — Bugünkü durum ve sonraki yol

Durum tarihi: 8 Ekim 2026. Bu belge uygulanan ile planlananı ayırır. İlk tanıtım odağı **tek şubeli işletmenin yönetim panelidir**; POS, garson, mutfak/KDS, kurye, QR müşteri ve kiosk ekranları sonraki ürünlerdir. Backend bağımlılıkları ve şema sahipliği [Backend Mimarisi](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md), öncelik sırası [İlk Üç Aşama](ILK_UC_ASAMA.md) belgesindedir.

## 1. Ürün hedefi

Tek şubeli işletmede sade, çok şubeli işletmede firma/marka/şube kapsamını açık gösteren bir yönetim paneli kuruyoruz. Yönetici izler, yapılandırır, menü/fiyat ve kampanya yönetir, modül seçer. Günlük sipariş girişi, tahsilat, servis ve mutfak işi yönetici panelinin eylemleri değildir.

Modülerlik iki ayrı konudur: kodun iş alanlarına ayrılması (**modüler monolit**) ve bir şubenin bir özelliği kullanmak istemesi (**özellik tercihi**). İkincisi kod veya tablo silmez; geçmiş veriye erişimi otomatik kapatmaz.

## 2. Gerçekten yapılmış olanlar

| Alan | Bugünkü durum |
| --- | --- |
| Yönetici başlangıç ekranı | Tek şube yöneticisi için sade işletme özeti, ürün/cari/stok/modül kısayolları ve ürün duyuruları vardır. Açık adisyon/masa özeti API sağlayıcısı açıldığında veriyi okur; mock modda örnek veridir. |
| Yönetim paneli | React + TypeScript + Vite ile ekran iskeleti, ortak shell, gezinme, tek/çok şube örnekleri hazır. Çoğu alan görsel prototip/fixture. |
| Ürünler ve Menü | Menü genel bakışı, oluşturma/düzenleme, kategori/ürün seçimi ve sıralama, önizleme ve tek aktif menü seçimi PostgreSQL'e bağlıdır (`catalog.menus`). Menü fiyatı ortak ürün kaydından okunur; web/QR yayını yoktur. Ürün taslağı, fiyat sürümü, ilk POS yayını ve geçmiş API'ye bağlıdır. Kategori oluşturma/ad değiştirme API'si vardır, panel formu henüz yoktur. |
| Tek şube demo ve reçete/stok/sayım | 6 ürün, 4 reçete, 4 cari ve 9 hammadde ortak kimlikli demo sözleşmesindedir. `VITE_INVENTORY_PROVIDER=http` ile hammadde/eşik, depo kapsamlı bakiye/hareket, reçete ve sayım PostgreSQL API'sinden okunur/yazılır. Dashboard kritik uyarıyı API'den alır; stok girişi/çıkışı, teorik üretim, sayım inceleme/onayı ve açık sayım kilidi API+PostgreSQL tarayıcı kabul testinden geçer. İlk demo Kadıköy Ana Depo'yu kullanır. Satıştan otomatik tüketim, satın alma belgesi ve barkod yoktur. |
| Cari ilk işletilebilir dilim | `VITE_CARI_PROVIDER=http` ile müşteri/tedarikçi kartı, iletişim, tür bazlı feature gate, anlamlı borç/alacak/tahsilat/ödeme hareketleri, cari özeti ve tarih aralıklı ekstre PostgreSQL'e bağlanır. Tahsilat/ödeme elle girilen işletme kaydıdır; yasal fatura veya gerçek para transferi değildir. |
| Masa servisi ilk kalıcı dilim | `service` şemasında masa, garson kişi kartı, açık masa-adisyon bağı ve denetim izi vardır. `VITE_SERVICE_PROVIDER=http` ile masa planı gerçek PostgreSQL verisini ve sipariş ayrıntısını okur. Masa servisi kapanınca garson özelliği otomatik kapanır; satış/adisyon ve şube listesi bağımsız kalır. Başlangıç verisi 24 masa, 3 garson, 7 masalı ve 1 self-servis adisyondur. Gerçek servis POS arayüzü yoktur. |
| Test POS, sipariş ve ödeme durumu | Yönetim panelinden ayrı, yalnız Development için `apps/pos` ekranı var. Yayınlanmış üründen gerçek PostgreSQL siparişi oluşur; fiyat ve ürün adı satış anında kopyalanır. `payments.simulator` ile kısmi/başarılı/başarısız/bekleyen/belirsiz test sonuçları kaydedilir. Yönetim Satışlar ekranı sipariş ve **simüle** ödeme durumunu salt okunur okur. Gerçek tahsilat, cihaz ve üretim yetkisi yok. |
| Modül kataloğu | Tanım (`FeatureDefinition`) ve şube durumu (`BranchFeatureState`) ayrıldı. `desiredEnabled`, `effectiveForNewWork`, `lifecycle`, `blockers`, `version` ayrı alanlar. |
| Modül ekranı | Şube bazlı aç/kapa önizlemesi, bağımlılık uyarıları, kurulum/sağlayıcı/kapanma durumları ve sürüm çakışmasında yenileme var. Kapalı modülün geçmiş/örnek okuması sürüyor. |
| .NET API | ASP.NET Core 10 üzerinde modül listesi, durum, sürümlü tercih komutu, örnek kapsam/işlem izni, denetim kaydı ve yeni iş politikası uçları var. |
| Depolama | Varsayılan modül belleği; isteğe bağlı EF Core 10 + Npgsql + PostgreSQL. Modül tercihleri, katalog taslakları, fiyat sürümleri, yayın kayıtları, test siparişleri, simüle ödeme girişimleri, cari, masa servisi ve reçete/stok/sayım verileri kalıcıdır. `modules`, `catalog`, `sales`, `cari`, `service` ve `inventory` şemaları ayrı migration ile kurulur. |
| Eşzamanlılık | Aynı şubenin modül satırları işlem içinde kilitleniyor. Eski `expectedVersion` 409 döndürüyor. Bağımlılık ve yazma aynı işlemde. |
| Testler | Tip/derleme, frontend birim ve tarayıcı testleri; API HTTP testi; panel–API tarayıcı testi; geçici gerçek PostgreSQL ile taslak → fiyat → yayın → sipariş → simüle ödeme zinciri, sunucu yeniden başlatma, şube ayrımı, tekrar istek, çakışma ve denetim kaydı testleri. |

## 3. Bu başarı neyi **henüz** kanıtlamaz?

- `X-Demo-Actor` bir test başlığıdır; herkes taklit edebilir. Gerçek oturum veya kullanıcı yetkisi değildir. Sunucu bu nedenle yalnız Development ortamında açılır.
- PostgreSQL modül tercihini, katalog kayıtlarını, ürün taslaklarını, fiyat/yayın anlık görüntülerini, **test POS siparişlerini ve simüle ödeme sonuçlarını**, cari kart/iletişim/semantik hareketleri, masa servisi bağlarını ve hammadde/reçete/stok/sayım kayıtlarını saklar. Cari işlemler banka/POS tahsilatı veya mali belge değildir; garson kartı çalışma süresi verisi değildir. Kasa, satın alma/mal kabul bağlantısı, fatura ve vade yaşlandırması, barkodlu sayım, satıştan otomatik stok tüketimi, rapor ve entegrasyon işlemleri backend'e bağlı değildir.
- `effectiveForNewWork` etkin `catalog.drafts`, `catalog.price_drafts`, `catalog.publishing`, `sales.pos_orders`, `payments.simulator`, `branches.tables`, `service.waiters` ve `staff.records` için yeni komutu açabilir. Simülatör gerçek ödeme veya üretime hazır POS anlamına gelmez; diğer prototip/planlı özelliklerde `false` kalır.
- `draining` geçişi test amaçlı olayla doğrulanmıştır. Gerçek devam eden mutfak, ödeme veya entegrasyon işlerinin sınırları henüz modellenmemiştir.
- İlk yönetici rolleri aynı menüyü görür; gerçek firma/şube üyeliği ve işlem yetkisi henüz veritabanında değildir.
- Kod iş alanlarına ayrılmaya başlamıştır; tam modüler monolit modül sınırları, modüller arası olaylar ve tüm alanların gerçek verisi henüz kurulmamıştır.
- Gerçek sağlayıcı bağlantıları ve Türkiye mevzuatı uyumu yapılmış gibi gösterilmez.

## 4. Sıradaki çalışma: tek şube işletme temelini tamamlamak

Öncelik, modül düğmesini çoğaltmak veya ödeme derinliğine saplanmak değil, tek şube işletme senaryosunu ortak veriler ve modüler backend kurallarıyla tamamlamaktır. Bugünkü 19 özellik tanımı bütün ekran capability'lerini kapsamaz. Güncel mimari/bağımlılık haritası [Backend Mimarisi](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md), backlog'un ilk üç ürün dilimi [İlk Üç Aşama](ILK_UC_ASAMA.md) içindedir.

İlk envanter, ortak tanım sözleşmesi, katalog taslağı, firma kategorisi, fiyat sürümü ve ilk POS yayını komutları kuruldu. Panel → Test POS → kalıcı sipariş → simüle ödeme → yöneticide salt okunur izleme uçtan uca doğrulandı. Buna masa/garson kartı, adisyona isteğe bağlı masa bağı, masaya tıklayınca sipariş detayı ve masa kapalıyken bağımsız self-servis satış testi eklendi. Cari kartı/hareketi, kart düzenleme ve devir/dönem/kapanış ekstresi ilk kalıcı dilimde hazır; finans ekranı bağlantısı ve pilot güvenlik kapısı açık. Reçete/hammadde/stok hareketi/sayım için migration, API, UI ve PostgreSQL kabul akışı da eklendi. Yakın sonraki ürün işi; şube listesi-kapasite-masa planı-veri bütünlüğü ve garson kartından sorumlu masaları görme kabul senaryolarıdır. Yayın sonrası fiyat değiştirme, yeniden yayın ve çok kanallı/merkezi yayın henüz yoktur. Her komut firma/şube kapsamı, eşzamanlılık ve denetim kaydını sunucuda doğrulamalı.

Pilot hesap akışı **kontrollü ve dar kapsamlı** olacak: ilk firma ve sahibi HIPOS ekibi oluşturacak; herkese açık kayıt ve Google/Gmail girişi şimdilik yok. Bu öncelik değişimi güvenliği erteleme izni değildir. Gerçek verili pilot dış kullanıcıya açılmadan önce sunucu oturumu, firma/şube üyeliği ve işlem yetkisi uygulanmalı; seçili şube sunucuda bağımsız doğrulanmalı. İlk UI kararı değişmez: yönetici rolleri aynı ekranları görür. Ayrıntı [Kimlik ve Hesap Akışı](KIMLIK_VE_HESAP_AKISI.md) belgesindedir.

Kimlik kapısının kabul koşulları: girişsiz istek 401; başka firmaya/şubeye okuma ve yazma 403; yetkili yönetici kendi şubesini görür; denetim kaydı demo başlık yerine gerçek kullanıcı kimliğini taşır. Parola saklama, oturum/CSRF koruması, parola sıfırlama ve e-posta doğrulama değerlendirilmeden “üretim girişi tamam” denmez.

## 5. Sonraki teknik/ürün dilimleri

Aşağıdaki genişleme işleri, [tek şube → cari → reçete/stok/sayım](ILK_UC_ASAMA.md) sıralamasının yerine geçmez; ilk üç aşamadan sonraki teknik backlog'dur.

1. **Modül kararını gerçek komutlara bağlama.** Her yeni iş komutu, şube kapsamı ve `effectiveForNewWork` durumunu sunucuda aynı tutarlı işlem sınırında denetlemeli. Kapatma geçmiş veriyi silmemeli; devam eden işin ne zaman tamamlandığı modül bazında tanımlanmalı. Teste özel tamamlama ucu üretimden çıkarılmalı.
2. **Ürünler ve Menü'yü gerçek veriyle derinleştirme.** PostgreSQL okuması, taslak, fiyat sürümü, ilk yayın ve geçmiş panel akışı hazır. Sonra [katalog sözleşmesindeki](KATALOG_BACKEND_SOZLESMESI.md) kategori panel yazması, seçenek/alerjen, kanal görünürlüğü, yeniden fiyatlandırma ve yayını dar dilimler halinde tamamla.
3. **Yönetim alanlarını sırayla gerçek veriye taşıma.** Şube ve canlı durum; satış/adisyon salt okunur izleme; stok, reçete ve satın alma yönetsel akışları; raporlar; kampanya ve merkezi yönetim. Her alanda boş, hata, kapalı, kurulum ve yetkisiz durumları korunur.
4. **Operasyon yüzlerini ayrı ürünler olarak ekleme.** POS, garson, KDS, kurye, QR ve kiosk mevcut yönetim ekranına operasyon düğmeleri olarak sıkıştırılmaz. Aynı backend sözleşmelerine kendi yetki ve iş kurallarıyla bağlanırlar.
5. **Ödeme, mali belge ve sağlayıcılar.** Gerçek banka/ödeme, yemek platformu, ÖKC, e-Fatura/e-Arşiv ve Türkiye mevzuatı bağımsız kabul testleri ve sağlayıcı doğrulaması ister. “Bağlı/başarılı” göstergesi gerçek bağlantı olmadan verilmez.

## 6. Teknik kalite kapıları

- Her yeni alan için API sözleşmesi, firma/şube kapsamı, yetki, sürüm/çakışma, denetim kaydı ve boş/hata durumları tanımlanır.
- Şema migration'ı kod değişikliği/deployment parçasıdır; modül aç/kapa komutu migration çalıştırmaz. Üretime uygulamadan önce migration SQL'i incelenir, yedekleme/geri dönüş planı hazırlanır.
- PostgreSQL testi tek süreçten öteye genişletilir: ayrı API örnekleri, gerçek iş komutları, bekleyen iş kapanışı ve gerekirse satır güvenliği ayrıca sınanır.
- Frontend mock ile HTTP sağlayıcısının sözleşmesi zamanla OpenAPI ve otomatik tip üretimiyle eşleştirilir; iki taraftaki katalog tanımı elle çoğaltılmaya devam etmez.
- Otomatik testler CI'da çalışır; bağımlılık ve güvenlik taraması, erişilebilirlik ve performans eşikleri eklenir.

## 7. Bugünkü net karar

Mevcut mimari yön **doğru**, fakat “üretime hazır modüler restoran sistemi” aşamasında değil. Modül tercihi, örnek şube sınırı, bağımlılık, sürüm çakışması ve panelden kalıcı taslak/fiyat/yayın → test POS siparişi → simüle ödeme akışı doğrulandı. Güvenilir kullanıcı/şube yetkisi ve gerçek ödeme sağlayıcısı müşteri pilotundan önce ayrı kapılardır. Diğer alanlar tek tek, modüller arası uyum testleriyle backend'e taşınır.
