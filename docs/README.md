# HIPOS Dokümantasyon Dizini ve Bilgi Haritası

> **Durum:** Yaşayan Belge
> **Son Güncelleme:** 21 Ekim 2026
> **Sorumlu:** Mimari & Geliştirme Ekibi

Bu dizin, HIPOS restoran yönetim ve operasyon platformunun tüm mimari kararlarını, iş alanı sözleşmelerini, operasyon rehberlerini ve kabul testlerini kategorize edilmiş olarak barındırır.

---

## 📌 Doküman Rolleri ve Tek Kaynak Disiplini

Projeyi devralan bir mühendisin hangi belgeye ne amaçla başvuracağı net olarak ayrılmıştır:

* 🧭 **[docs/README.md](README.md) = "Belgeleri Nerede Bulurum?"** (Dizin ve Belge Envanter Haritası)
* 🚀 **[DEVIR_REHBERI.md](00-devir-rehberi/DEVIR_REHBERI.md) = "Proje Bugün Ne Durumda ve Nasıl Devralınır?"** (Ana Devir Merkezi)
* 🏛️ **[BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md](01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) = "Kodun Gerçek Teknik Kaynağı"** (8 PostgreSQL Şeması, Modül Sınırları ve Veri Sahipliği)
* 🗺️ **[DURUM_VE_YOL_HARITASI.md](00-devir-rehberi/DURUM_VE_YOL_HARITASI.md) = "Güncel Teslim ve Backlog"** (Neler Yapıldı, Sırada Ne Var?)

> [!IMPORTANT]
> **Tek Kaynak Kuralı:** Arşivdeki eski tarihli belgeler (örneğin 2024/2025 taslakları) referans amaçlıdır. Güncel çalışma kararları ve kod gerçekliği için yalnız yukarıdaki **4 canlı belge** esas alınır.

---

## 🧭 Hızlı Başlangıç & Okuma Sırası (Yeni Geliştirici Kılavuzu)

Projeye yeni katılan veya devralan bir mühendisin belgeleri şu sırayla okuması önerilir:

1. 🚀 **1. Adım (Büyük Resmi ve Gerçekliği Anlama):**
   👉 [Mühendis ve Ekip Devir Teslim Rehberi](00-devir-rehberi/DEVIR_REHBERI.md)
   👉 [Mevcut Durum ve Modüler Yol Haritası](00-devir-rehberi/DURUM_VE_YOL_HARITASI.md)
2. 📦 **2. Adım (Üzerinde Çalışacağınız Modülün Şartnamesini İnceleme):**
   * Kasa ve Ödeme üzerinde çalışacaksanız: 👉 [Modül 1: Kasa ve POS](00-devir-rehberi/MODUL_01_KASA_VE_POS.md)
   * Masa ve Adisyon üzerinde çalışacaksanız: 👉 [Modül 2: Masa ve Adisyon](00-devir-rehberi/MODUL_02_MASA_VE_ADISYON.md)
   * Mutfak ve Yazıcılar üzerinde çalışacaksanız: 👉 [Modül 3: Mutfak ve KDS](00-devir-rehberi/MODUL_03_MUTFAK_VE_KDS.md)
   * Reçete ve Stok üzerinde çalışacaksanız: 👉 [Modül 5: Stok ve Reçete](00-devir-rehberi/MODUL_05_STOK_VE_RECETE.md)
   * Kimlik ve Güvenlik üzerinde çalışacaksanız: 👉 [Modül 7: Kimlik ve Auth](00-devir-rehberi/MODUL_07_KIMLIK_VE_AUTH.md)
3. 🏛️ **3. Adım (Teknik Omurga ve Veritabanı Mimarisi):**
   👉 [Teknik Mimari](01-mimari-ve-altyapi/TEKNIK_MIMARI.md) · [Backend Mimarisi ve Şemalar](01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md)
   👉 [Kimlik ve Oturum (Auth)](01-mimari-ve-altyapi/KIMLIK_OTURUM_VE_YETKI.md) · [Çevrimdışı Çalışma (Offline Sync)](01-mimari-ve-altyapi/CEVRIMDISI_VE_SENKRONIZASYON.md) · [Donanım & ÖKC](01-mimari-ve-altyapi/DONANIM_VE_MALI_CIHAZLAR.md)
4. 🧪 **4. Adım (Kabul Testleri ile Doğrulama):**
   👉 [Test Rehberleri](04-test-ve-rehberler/) bölümündeki senaryoları uygulayın.

---

## 📂 Dizin Yapısı ve Belge Envanteri

### 0. [00-devir-rehberi](00-devir-rehberi/) — Devir Teslim ve Yol Haritası
Projeyi devralacak ekipler ve koordinatörler için ana başlangıç noktası:
* [DEVIR_REHBERI.md](00-devir-rehberi/DEVIR_REHBERI.md): **[ANA DEVİR HUB]** Sistemin ne iş yaptığı, modül modül yapılmış/eksik işler, yol haritası ve kalite kapıları.
* [DURUM_VE_YOL_HARITASI.md](00-devir-rehberi/DURUM_VE_YOL_HARITASI.md): Kodun bugünkü gerçekleşmiş durumu, eksiklikler ve sonraki geliştirme fazları.
* [MODUL_01_KASA_VE_POS.md](00-devir-rehberi/MODUL_01_KASA_VE_POS.md): **[Modül 1 Şartnamesi]** A'dan Z'ye Kasa, POS, parçalı tahsilat, yönetici avans/tediye ve Z-Raporu şartnamesi.
* [MODUL_02_MASA_VE_ADISYON.md](00-devir-rehberi/MODUL_02_MASA_VE_ADISYON.md): **[Modül 2 Şartnamesi]** Masa Servisi, Salon Planı, Masa Taşıma/Birleştirme ve Ortak Adisyon şartnamesi.
* [MODUL_03_MUTFAK_VE_KDS.md](00-devir-rehberi/MODUL_03_MUTFAK_VE_KDS.md): **[Modül 3 Şartnamesi]** Mutfak (KDS), Dokunmatik Durum Makinesi ve ESC/POS 9100 Yazıcı şartnamesi.
* [MODUL_04_KATALOG_VE_MENU.md](00-devir-rehberi/MODUL_04_KATALOG_VE_MENU.md): **[Modül 4 Şartnamesi]** Ürün Kataloğu, Fiyat Sürümleri, Seçenek Grupları (Modifiers) ve QR Menü şartnamesi.
* [MODUL_05_STOK_VE_RECETE.md](00-devir-rehberi/MODUL_05_STOK_VE_RECETE.md): **[Modül 5 Şartnamesi]** Stok, Depo, Reçeteli Otomatik Tüketim, Mal Kabul ve Sayım Onayı şartnamesi.
* [MODUL_06_CARI_VE_GIDER.md](00-devir-rehberi/MODUL_06_CARI_VE_GIDER.md): **[Modül 6 Şartnamesi]** Cari Hesaplar, Müşteri Veresiyesi, Toptancı Tediyeleri ve Giderler şartnamesi.
* [MODUL_07_KIMLIK_VE_AUTH.md](00-devir-rehberi/MODUL_07_KIMLIK_VE_AUTH.md): **[Modül 7 Şartnamesi]** Kimlik, Oturum, 4 Haneli Terminal PIN Pad ve Yetkilendirme (Auth) şartnamesi.

### 1. [01-mimari-ve-altyapi](01-mimari-ve-altyapi/) — Sistem Omurgası ve Altyapı
Sistem omurgası, backend mimarisi, kimlik doğrulama, çevrimdışı çalışma ve donanım entegrasyonları:
* [TEKNIK_MIMARI.md](01-mimari-ve-altyapi/TEKNIK_MIMARI.md): Temel teknoloji kararları ve stack genel bakışı.
* [BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md](01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md): 8 PostgreSQL şeması, modüler monolit bağımlılıkları ve veri sahipliği.
* [MODULER_BACKEND_PLANI.md](01-mimari-ve-altyapi/MODULER_BACKEND_PLANI.md): Modül sınırları ve capability yönetim planı.
* [KIMLIK_OTURUM_VE_YETKI.md](01-mimari-ve-altyapi/KIMLIK_OTURUM_VE_YETKI.md): `auth` şeması, RBAC yetki matrisi, JWT/Cookie oturumu ve 4 haneli PIN doğrulama kılavuzu.
* [CEVRIMDISI_VE_SENKRONIZASYON.md](01-mimari-ve-altyapi/CEVRIMDISI_VE_SENKRONIZASYON.md): Restoran LAN'ında internetsiz çalışma, Mini PC yerel hub'ı, `sync.outbox` kuyruğu ve bulut eşitleme protokolü.
* [DONANIM_VE_MALI_CIHAZLAR.md](01-mimari-ve-altyapi/DONANIM_VE_MALI_CIHAZLAR.md): Beko/Token GMP3 ÖKC cihazı, termal yazıcılar, barkod okuyucu ve RJ11 para çekmecesi entegrasyonu.
* [KIMLIK_VE_HESAP_AKISI.md](01-mimari-ve-altyapi/KIMLIK_VE_HESAP_AKISI.md): Kullanıcı oturumu, firma/şube yetkilendirmesi ve pilot hesap akışı ilkeleri.
* [CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md](01-mimari-ve-altyapi/CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md): Çevrimdışı çalışma ilk sözleşmesi.
* [ENTEGRASYON_ENVANTERI_VE_TOKEN_SURECI.md](01-mimari-ve-altyapi/ENTEGRASYON_ENVANTERI_VE_TOKEN_SURECI.md): Beko/Token ÖKC ve dış entegrasyon süreç envanteri.
* [API_VE_MOCK_SOZLESMESI.md](01-mimari-ve-altyapi/API_VE_MOCK_SOZLESMESI.md): Başlangıç API ve mock veri sözleşmesi.

### 2. [02-kasa-ve-operasyon](02-kasa-ve-operasyon/) — Kasa, POS, Masa ve Mutfak
Kasa ekranı, parçalı ödeme, ortak adisyon yaşam döngüsü, masa servisi ve mutfak (KDS):
* [KASA_POS_VE_OPERASYON_SOZLESMESI.md](02-kasa-ve-operasyon/KASA_POS_VE_OPERASYON_SOZLESMESI.md): Yeni nesil dokunmatik kasa, parçalı ödeme (Nakit, Ziraat/Vakıfbank POS, Cari, Havale), kasa seçimi ve gün sonu Z-Raporu sözleşmesi.
* [ADISYON_VE_MASA_YASAM_DONGUSU.md](02-kasa-ve-operasyon/ADISYON_VE_MASA_YASAM_DONGUSU.md): Masa taşıma, masa birleştirme, adisyon bölme, kalem iptali/ikram ve ödeme kapama yaşam döngüsü.
* [MUTFAK_KDS_VE_YAZICI.md](02-kasa-ve-operasyon/MUTFAK_KDS_VE_YAZICI.md): Dokunmatik KDS durum makinesi, istasyon filtreleme (Sıcak/Fırın/Bar) ve ESC/POS 9100 termal fiş basımı.
* [ORTAK_ADISYON_SOZLESMESI.md](02-kasa-ve-operasyon/ORTAK_ADISYON_SOZLESMESI.md): Ortak check yaşam döngüsü ve masa sipariş bağları ilk sözleşmesi.
* [KASA_MVP_SOZLESMESI.md](02-kasa-ve-operasyon/KASA_MVP_SOZLESMESI.md): Mevcut manuel nakit vardiyası ve defter sözleşmesi.
* [KASA_ONBOARDING_VE_SATIS_OLAY_SOZLESMESI.md](02-kasa-ve-operasyon/KASA_ONBOARDING_VE_SATIS_OLAY_SOZLESMESI.md): Kasa oluşturma ve satış olaylarının kasaya yansıması taslağı.
* [TEST_POS_VE_SIPARIS_SOZLESMESI.md](02-kasa-ve-operasyon/TEST_POS_VE_SIPARIS_SOZLESMESI.md): Geliştirme Test POS arayüzü sözleşmesi.
* [ODEME_SIMULATORU_SOZLESMESI.md](02-kasa-ve-operasyon/ODEME_SIMULATORU_SOZLESMESI.md): Test ödeme simülatörü sözleşmesi.

### 3. [03-is-alanlari-ve-yonetim](03-is-alanlari-ve-yonetim/) — ERP Modülleri ve Yönetim Paneli
Yönetim paneli ERP modülleri, katalog, reçeteli stok, cari ve giderler:
* [RECETELI_STOK_VE_SATINALMA.md](03-is-alanlari-ve-yonetim/RECETELI_STOK_VE_SATINALMA.md): Adisyon kapanışında reçeteli hammadde otomatik tüketimi, toptancı irsaliyesi/mal kabul ve fire takibi kılavuzu.
* [KATALOG_BACKEND_SOZLESMESI.md](03-is-alanlari-ve-yonetim/KATALOG_BACKEND_SOZLESMESI.md): Kategori, ürün taslağı, fiyat sürümü ve POS yayını.
* [MENU_YONETIMI_MVP.md](03-is-alanlari-ve-yonetim/MENU_YONETIMI_MVP.md): Şube menüleri, özel bölümler ve sıralı ürün seçimi.
* [ENVANTER_STOK_SATINALMA_SOZLESMESI.md](03-is-alanlari-ve-yonetim/ENVANTER_STOK_SATINALMA_SOZLESMESI.md): Depo, hammadde, reçeteler, sayım ve onay güvenliği.
* [CARI_HESAPLAR_MVP.md](03-is-alanlari-ve-yonetim/CARI_HESAPLAR_MVP.md): Müşteri/tedarikçi kartları, semantik borç/alacak hareketleri ve ekstre.
* [GIDER_YONETIMI_MVP.md](03-is-alanlari-ve-yonetim/GIDER_YONETIMI_MVP.md): Firma gider kategorileri ve şube manuel gider defteri.
* [PERSONEL_YONETIMI_MVP.md](03-is-alanlari-ve-yonetim/PERSONEL_YONETIMI_MVP.md): Çalışan kartları, mutfak/servis görev ve bölüm tanımları.
* [OZELLIK_ENVANTERI.md](03-is-alanlari-ve-yonetim/OZELLIK_ENVANTERI.md): Yönetim paneli ekran ve yetenek envanteri.
* [UI_UYGULAMA_PLANI.md](03-is-alanlari-ve-yonetim/UI_UYGULAMA_PLANI.md): Ekran iskeleti ve UI bileşen uygulama planı.
* [TASARIM_YONU.md](03-is-alanlari-ve-yonetim/TASARIM_YONU.md): Görsel tasarım ve tipografi ilkeleri.

### 4. [04-test-ve-rehberler](04-test-ve-rehberler/) — Manuel Testler ve Doğrulama
Manuel test senaryoları ve yerel demo çalıştırma kılavuzları:
* [KASA_MANUEL_TEST.md](04-test-ve-rehberler/KASA_MANUEL_TEST.md): Kasa vardiya açma, hareket, düzeltme ve kapama testleri.
* [CARI_MANUEL_TEST.md](04-test-ve-rehberler/CARI_MANUEL_TEST.md): Cari kart, borçlandırma, tahsilat ve ekstre testleri.
* [MASA_SERVISI_TEST.md](04-test-ve-rehberler/MASA_SERVISI_TEST.md): Masa planı, garson siparişi ve KDS kuyruk testleri.
* [STOK_REÇETE_SAYIM_MANUEL_TEST.md](04-test-ve-rehberler/STOK_REÇETE_SAYIM_MANUEL_TEST.md): Hammadde, reçete kaydı, sayım kilidi ve onay testleri.
* [YARIN_DEMO_KILAVUZU.md](04-test-ve-rehberler/YARIN_DEMO_KILAVUZU.md): Telefonlarla Wi-Fi/LAN üzerinde garson ve mutfak demo kılavuzu.

### 5. [05-gecmis-ve-arsiv](05-gecmis-ve-arsiv/) — Tarihsel Belgeler ve Arşiv
Tarihsel ürün kararları ve ilk aşama taslakları:
* [URUN_TANIMI.md](05-gecmis-ve-arsiv/URUN_TANIMI.md): İlk aşama ürün tanımı (eski panel öncelikleri).
* [ILK_UC_ASAMA.md](05-gecmis-ve-arsiv/ILK_UC_ASAMA.md): Tarihsel ilk 3 aşama geliştirme planı.
* [YENI_URUN_YONU_TASLAK.md](05-gecmis-ve-arsiv/YENI_URUN_YONU_TASLAK.md): 19 Ekim öncesi ürün yönü tartışma taslağı.
