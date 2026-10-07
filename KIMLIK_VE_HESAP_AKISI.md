# HIPOS — Kimlik ve hesap akışı kararı

Durum: İlk giriş yöntemi ve pilot başlangıç yolu kararlaştırıldı. Bu belge, henüz uygulanmamış tasarımı anlatır; ayrıntılı hesap deneyimi modüler backend çalışmalarının önüne alınmaz.

## Net karar

Yönetici ilk sürümde **HIPOS hesabıyla** (e-posta ve şifre) giriş yapar. Google/Gmail, Microsoft veya başka bir harici hesapla giriş ilk sürümün önceliği değildir; ileride eklenebilir. Bugünkü `X-Demo-Actor` test başlığı gerçek kullanıcı hesabı değildir ve üretimde kullanılmayacaktır.

## Kullanıcının göreceği basit akış

1. Giriş ekranında e-posta ve şifresini yazar.
2. HIPOS kimliğini doğrular ve kullanıcının üye olduğu firma/şubeleri sunucudan yükler.
3. Panel aynı yönetim ekranlarını gösterir. Kullanıcı şube seçse bile API onun o şubeye erişimini ayrıca denetler.
4. Çıkış yaptığında oturum sonlanır. Şifresini unuttuğunda doğrulanmış e-posta üzerinden sıfırlama akışı kullanır.

**Hesap** ile **işletme üyeliği** farklı kayıtlardır. Bir kişi HIPOS'ta tek hesaba sahip olabilir; bu hesap bir veya daha fazla firmada üyelik taşıyabilir. Firma üyeliği, erişilebilen şubeleri ve ileride işlem yetkilerini belirler. Markanın varlığı isteğe bağlıdır. Başlangıçtaki ürün kararı değişmez: yönetim rolleri aynı menüleri görür; veri erişimi ve işlemler backend'de korunur.

## Yönetici daveti için önerilen akış

- Firma sahibi veya ileride buna izin verilen yönetici bir e-posta adresini, firma ve şube kapsamını seçerek davet eder.
- Davet tek kullanımlık, süreli bir bağlantıdır. Mevcut HIPOS hesabı varsa yeni şifre yaratılmaz; kullanıcı giriş yapıp daveti kabul eder. Hesap yoksa hesabını oluşturup e-postasını doğrular.
- Davet kabul edilmeden firma verisine erişim verilmez. Davetin gönderilmesi, kabul edilmesi, iptali ve üyeliğin kaldırılması kayda geçer.
- Üyelik kaldırılınca erişim kesilir; kullanıcının geçmişte oluşturduğu işletme kayıtları silinmez.

Bu bir **öneridir**, çalışan özellik değildir. İlk firma sahibinin pilotta HIPOS ekibince oluşturulması kararlaştırıldı; sonrasında daveti hangi yönetici rollerinin gönderebileceği uygulama öncesi netleştirilecektir.

## Pilot kararı: ilk firma sahibi nasıl gelir?

**Karar verilen pilot yolu:** HIPOS ekibi pilot işletmeyi ve ilk firma sahibi hesabını kontrollü biçimde açar; sonrasında firma sahibi diğer yöneticileri davet eder. İlk aşamada herkese açık firma oluşturma ekranı yapılmaz. Pilot akış basit tutulur; ancak test başlığı, düz metin parola veya yetkisiz veri erişimi üretime taşınmaz.

**Alternatif:** Herkes web sitesinden kayıt olup kendi firmasını oluşturur. Bu, daha sonra self-servis büyüme için yararlı olabilir; ancak e-posta doğrulama, işletme sahipliği doğrulaması, kötüye kullanım önleme ve ilk kurulum akışı gerektirir. Pilot seçimi otomatik olarak kalıcı ürün politikası değildir.

## Teknik sınırlar ve kabul koşulları

- ASP.NET Core Identity ve EF Core/PostgreSQL kimlik altyapısı için adaydır. Tarayıcı panelinde sunucunun yönettiği güvenli oturum tercih edilir; şifre veya kalıcı kimlik belirteci tarayıcı depolamasına yazılmaz. Yazma istekleri CSRF ve oturum kurallarıyla korunur.
- `401`: giriş yok veya oturum geçersiz. `403`: giriş var ama firma/şube veya işlem yetkisi yok. İkisi aynı genel hata olarak gösterilmez.
- `firmId`/`branchId` istemciden gelse bile üyelik sunucuda doğrulanır. Başka firmanın kimliğini URL'ye yazmak erişim sağlamaz.
- Modül tercihinin denetim kaydı örnek aktör adını değil gerçek kullanıcı kimliğini taşır. Sürüm/bağımlılık/`draining` kuralları değişmez.
- Giriş, davet, şifre sıfırlama ve oturum sonlandırma akışlarında başarı mesajı yalnız gerçekten tamamlanan işlem için gösterilir. E-posta sağlayıcısı kurulmadan “davet gönderildi” denmez.
- E-posta doğrulama, güvenli parola sıfırlama, oturum iptali ve hassas hesaplar için çok faktörlü giriş yayın güvenliği kontrolüne dahildir.

## Uygulama sırası önerisi

1. Modüler backend dilimlerini geliştirme ortamında sürdürürken pilot hesabı/üyeliği için en küçük güvenli veri modelini hazırla.
2. Üretime açılmadan önce giriş/çıkış, gerçek oturum ve firma/şube kapsam denetimini tamamla; `X-Demo-Actor` üretim yolundan çıkar.
3. Pilot işletmeyi ve ilk sahibini kontrollü kur; yönetici davetini gerçek e-posta sağlayıcısı hazır olduğunda aç. Sağlayıcı yoksa “gönderildi” deme.
4. E-posta doğrulama, şifre sıfırlama, oturum iptali ve güvenlik testlerini yayın kapısında tamamla.
5. Herkese açık kendi firmasını oluşturma ve Google/Gmail girişini ancak temel modüller olgunlaştıktan sonra değerlendir.
