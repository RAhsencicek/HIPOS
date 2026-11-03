# Stok Modülü İçin Yapılanlar

> **Belge türü:** Tarihsel çalışma özeti ve devam listesi  
> **Durum tarihi:** 28 Ekim 2026  
> **Kapsam:** Stok, reçete, sayım, mal kabul, tedarikçiye iade ve fire/zayi çalışmaları

> [!IMPORTANT]
> Bu belge yapılan çalışmaların tarihsel özetidir. Güncel ve bağlayıcı gereksinimler için
> [Modül 5 şartnamesi](../00-devir-rehberi/MODUL_05_STOK_VE_RECETE.md),
> [envanter/stok sözleşmesi](../03-is-alanlari-ve-yonetim/ENVANTER_STOK_SATINALMA_SOZLESMESI.md) ve
> [durum/yol haritası](../00-devir-rehberi/DURUM_VE_YOL_HARITASI.md) esas alınmalıdır.

## Şu ana kadar yapılanlar

### Stok ve reçete temeli

- Depo, hammadde, kritik eşik, reçete sürümü ve değiştirilemez stok hareket defteri PostgreSQL API'sine bağlandı.
- Stok özeti, kritik stoklar, hammaddeler, reçeteler, stok hareket geçmişi ve stok sayımları yönetim panelinden erişilebilir hale getirildi.
- Tek şube ve çok şubeli görünüm ayrımı korunarak firma/şube/depo kapsamları API isteklerine taşındı.

### Stok sayımı

- Yeni sayım taslağı başlatma, fiziksel miktar girme, fark hesaplama, onaylama ve iptal akışları çalışır hale getirildi.
- Sayım açıkken ilgili depoda stok hareketi oluşturulması engellendi.
- Sayım ekranındaki “Verileri yenile” davranışı güncel stok bakiyesini gösterecek şekilde düzenlendi.
- Boş sayımın onaylanması engellendi; iptal bildiriminin beş saniye sonra kapanması sağlandı.
- Sayım ekranındaki gereksiz “sayım başı geçmiş snapshot” açıklaması kaldırıldı.

### Mal kabul

- Mal kabul belgesinin taslak kaydı ve sonradan onaylanması eklendi.
- Taslak kayıt stok veya cari bakiyeyi değiştirmez; onay stok girişini ve tedarikçi borcunu aynı işlemde oluşturur.
- Tekrarlanan onayın çift stok/cari kaydı üretmemesi sağlandı.
- Sayım açıkken mal kabul onayı engellendi.
- Mal kabul geçmişi ve belge detayı eklendi.
- Ekran mobil kullanıma göre düzenlendi; etiket ve form aralıkları iyileştirildi.
- Eksik teslim düzeltme formu arayüzden kaldırıldı; geçmiş kayıtların korunması yaklaşımı benimsendi.
- KDV, iskonto, KDV matrahı ve hızlı KDV hesabı mal kabul arayüzünden kaldırıldı. Ekran; hammadde, miktar, birim fiyat ve toplam alanlarına indirildi.

### Tedarikçiye iade

- Onaylanmış mal kabul satırından tedarikçiye iade kaydı oluşturma eklendi.
- İade stoktan çıkış ve tedarikçi borcunda azalışı birlikte oluşturur.
- İade miktarının kabul edilen ve daha önce iade edilmemiş miktarı aşması engellendi.
- İade irsaliye numarası, tarih, miktar ve gerekçe kayda alındı; iade geçmişi belge detayında gösterildi.

### Fire ve zayi

- Hammadde bazlı, gerekçeli fire/zayi kaydı ve bağlı `waste_loss` stok hareketi eklendi.
- Negatif stok koruması ve tekrar gönderilen isteğin ikinci kez stok düşmemesi sağlandı.
- Fire geçmişi ve stok hareket geçmişi bağlantısı kuruldu.
- Fire ekranındaki birim maliyet ve fiyatlandırma alanları kaldırıldı; maliyet/fiyatlandırma ayrı modüle ertelendi.
- Reçeteli ürün zayisi için aktif reçete sürümünü ve bileşenleri sabitleyen teknik bir çalışma yapıldı; nihai kabulü ve ekran davranışı tamamlanacak işler arasında tutuldu.

### Arayüz, API ve belgeler

- Mal kabul, stok sayımı, stok hareketleri ve fire/zayi sayfaları HTTP sağlayıcısına bağlandı.
- İlgili API uçları Postman ile denenebilir hale getirildi; mal kabul, iade ve fire işlemlerinin stok hareketleriyle ilişkisi doğrulandı.
- Manuel test rehberi, stok sözleşmesi, modül şartnamesi ve mimari durum belgeleri yapılan işlere göre güncellendi.

### Satın alma siparişi ve mal kabul entegrasyonu (30 Ekim 2026)

- Onaylı satın alma siparişlerinin (`purchase_orders`) mal kabul formuna tek tıkla bağlanması tamamlandı. Sipariş seçildiğinde tedarikçi ve depo kilitlenir, siparişteki kalem ve miktarlar birebir aktarılır.
- Mal kabul onaylandığında bağlı satın alma siparişi atomik olarak `completed` (tamamlandı) durumuna geçer ve açık siparişler listesinden temizlenir.
- Mal kabul sayfasının sağ üstüne eklenen `+ Yeni Satın Alma Siparişi` modalı ile sayfadan ayrılmadan saniyeler içinde yeni sipariş oluşturulup hemen onaylanabilmesi sağlandı.

### Mal kabulde kasa ödeme ve cari borç entegrasyonu

- Mal kabul onayına **Onay ve Ödeme Modalı** eklendi:
  - **Borç Olarak Yaz (on_account):** Mal kabul tutarının tamamı tedarikçinin cari hesabına borç kaydedilir.
  - **Hemen Ödensin (immediate_cash):** Şubedeki açık kasa vardiyaları (`cash.shifts`) ve çekmecedeki güncel nakitler listelenir; kullanıcı tek veya birden çok kasadan parçalı nakit dağıtarak ödeme yapabilir. Aynı atomik veritabanı işleminde kasalardan nakit düşülür (`cash.movements` `manual_out`) ve cari borç kapatılır (`cari.movements` `supplier_payment`). Kısmi ödemede kalan bakiye cari borç olarak korunur.
- Çekmecedeki mevcut nakitten fazla çıkış yapılması (`INSUFFICIENT_CASH`) engellendi.

### Reçeteli ürün zayisi

- Yanan pizza veya dökülen reçeteli ürünler için aktif reçete sürümünden porsiyon bazlı tüm bileşenleri aynı anda ve atomik düşen reçeteli ürün zayisi (`recipe_waste`) tamamlandı.

### Mobil responsive tablo iyileştirmesi

- Mal kabul satırları, mal kabul geçmişi ve belge detayı tabloları mobil cihazlarda (`max-width: 700px`) taşma yapmayan, hammadde seçimini tam genişlikte gösteren ve etiket-değerleri hizalı temiz kart düzenine kavuşturuldu.

### Eksik teslim düzeltme formu

- Onaylanmış mal kabul belgeleri için hammadde satırı, eksik miktar ve gerekçe girilerek stoktan (`purchase_correction`) ve cari borçtan (`adjustment_decrease`) aynı anda ve atomik düşüş sağlayan Eksik Teslim Düzeltme Fişi arayüz formu panele geri getirildi.

## Ertelenen veya gelecek kapsamda kalanlar

- Satın alma talebi (kritik stok uyarılarından otomatik öneri ve talep havuzu oluşturma).
- Fiyatlandırma, stok maliyeti ve parasal zayi raporu ayrı modülde ele alınacaktır.
- Gerçek şef/yönetici PIN onayı kimlik ve yetkilendirme modülünü beklemektedir.

