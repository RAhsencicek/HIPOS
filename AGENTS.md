# HIPOS — Kalıcı proje talimatları

Bu talimatlar bu depodaki bütün sohbetler, açıklamalar ve kod değişiklikleri için geçerlidir.

## Sözleşmelere bağlılık
- Yanıt veya kod hazırlamadan önce ilgili proje sözleşmelerini oku. Belgelerde olmayan bir davranışı kesinleşmiş gereksinim gibi sunma veya kendiliğinden uygulama.
- Belge haritası: `docs/README.md`. Mevcut mimari ve veri sahipliği: `docs/01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md`. Güncel durum ve teslim sırası: `docs/00-devir-rehberi/DURUM_VE_YOL_HARITASI.md`. Genel kapsam: `docs/00-devir-rehberi/DEVIR_REHBERI.md`.
- Yapılacak işle ilgili `docs/00-devir-rehberi/MODUL_*.md` şartnamesini ve referans verdiği iş alanı sözleşmelerini esas al. `contracts/` altındaki ortak veri sözleşmelerini koru.
- Arşiv belgelerini güncel kararların yerine kullanma. Belgeler birbiriyle veya kodla çelişirse çelişkiyi açıkla; davranışı değiştirecek kararı varsayma, kullanıcıdan netleştirme iste.
- Sözleşme dışı değişiklik gerekiyorsa uygulamadan önce gerekçeyi ve gereken sözleşme değişikliğini kullanıcıya sun; açık onay olmadan kapsamı genişletme.

## Kapsam ve dosya disiplini
- Gereksiz dosya oluşturma. Önce mevcut dosyaları kullan; yeni dosyayı yalnızca istenen iş için gerekli olduğunda oluştur.
- İstenmeyen yeniden düzenleme, bağımlılık, özellik veya alternatif mimari ekleme. Kullanıcının mevcut değişikliklerini koru.
- Kalıcı bağlamı bu dosyada ve mevcut proje belgelerinde tut; aynı bilgiyi tekrarlayan ayrı hafıza veya özet dosyaları oluşturma.

## Ürün bağlamı ve anlatım
- Projenin yedi ana modülü: (1) Kasa ve POS, (2) Masa ve Adisyon, (3) Mutfak ve Yazıcı, (4) Ürün Kataloğu ve Menü, (5) Stok ve Reçete, (6) Cari Hesaplar ve Giderler, (7) Kimlik ve Yetkilendirme.
- Çevrimdışı çalışma ve donanım bağlantıları ortak altyapıdır; bunları ek ana modüller gibi sayma.
- Çalışan kalıcı özellikleri, prototipleri ve planlanan özellikleri açıkça ayır. Ekranın varlığını özelliğin tamamlandığına kanıt sayma.
- Türkçe ve sade anlat. Teknik terimleri gerektiğinde kısa, restoran işleyişinden örneklerle açıkla.
- Yeni sohbette geçmiş konuşmanın tamamını bildiğini varsayma; bu talimatları ve görevle ilgili güncel dosyaları okuyarak bağlamı yeniden kur.
