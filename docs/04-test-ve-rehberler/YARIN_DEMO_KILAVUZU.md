# HIPOS yerel restoran demosu

Bu demo, tek bir ana bilgisayarın aynı restorandaki telefonlara yönetim, garson, mutfak ve ödeme simülatörü ekranlarını sunmasını amaçlar. Telefonlara uygulama kurmak gerekmez; tarayıcı kullanılır.

## Ekranlar

- Yönetim: `http://<ana-bilgisayar-ip>:5173/admin`
- Yönetici sipariş takibi: `http://<ana-bilgisayar-ip>:5173/admin/sales/checks`
- Garson: `http://<ana-bilgisayar-ip>:5176/waiter`
- Mutfak sipariş kuyruğu: `http://<ana-bilgisayar-ip>:5176/kitchen`
- Ödeme simülatörü: garson sipariş gönderdikten sonra aynı garson ekranında açılır; ayrıca `http://<ana-bilgisayar-ip>:5176/` adresinden test POS ekranı kullanılabilir.

`HIPOS-Baslat.command` başlatma sonunda yerel IP ve bu adresleri yazdırır. Tüm telefonlar aynı Wi-Fi/LAN ağına bağlanmalıdır.

## Demo akışı

1. Yönetim panelindeki tek şube için masa ve servis özelliklerini açın; aktif garson kartı ve POS kanalına yayınlanmış en az bir ürün bulunduğunu doğrulayın.
2. Garson telefonundan garsonu, masayı ve ürünleri seçip “Siparişi mutfağa gönder” düğmesine basın.
3. Yönetici panelinde **Satışlar → Adisyonlar** ekranı siparişi birkaç saniye içinde gösterir. **Şubeler → Masa Planı** ekranında masa/garson bağı görünür.
4. Mutfak ekranı yeni siparişleri yaklaşık üç saniyede bir yeniler. “Mutfak fişi yazdır” düğmesi tarayıcının yazdırma penceresini açar; bağlı ağ yazıcısı oradan seçilebilir.
5. Garson ekranındaki **Ödeme durumunu simüle et** bölümünde kart/nakit senaryosu seçilip ödeme sonucu gösterilebilir. Bu yalnızca yazılım simülasyonudur; gerçek para çekmez, banka POS'u veya Beko/Token ÖKC bağlantısı değildir.

## Yerel ağ ve çevrimdışı çalışma sınırı

İnternet bağlantısı kesilse bile router/Wi-Fi, HIPOS’u çalıştıran ana bilgisayar ve onun yerel PostgreSQL veritabanı açıksa bu ekranlar aynı yerel ağ içinde çalışabilir. Telefonlar ekranlara ana bilgisayarın Vite adresleri üzerinden bağlanır; `/api` çağrıları ana bilgisayardaki yerel API'ye aktarılır.

Router/LAN veya ana bilgisayar kapanırsa ekranlar sipariş kaydedemez. Cihazda çevrimdışı sipariş kuyruğu, bağlantı gelince otomatik eşitleme ve çakışma çözümü bu demo kapsamına dahil değildir. Mutfak yazdırma düğmesi elle tarayıcı baskısı açar; belirli bir termal yazıcıya otomatik baskı için model/sürücü ve yerel yazdırma servisi gerekir.

Bu geliştirme demosudur. Örnek kimlik başlığı kullanır; gerçek kullanıcı girişi ve yetkilendirme içermez. Gerçek müşteri verisi veya gerçek tahsilat için kullanmayın.
