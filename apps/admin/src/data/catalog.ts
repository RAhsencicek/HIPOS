import singleDemo from "../../../../contracts/demo-single-branch.v1.json";

export type NavItem = { label: string; slug: string };
export type NavSection = {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
};

export const sections: NavSection[] = [
  {
    id: "overview",
    label: "Genel Bakış",
    icon: "layout-dashboard",
    items: [
      { label: "Günlük Durum", slug: "daily" },
      { label: "Uyarılar", slug: "alerts" },
      { label: "Son İşlemler", slug: "activity" },
    ],
  },
  {
    id: "branches",
    label: "Şubeler ve Canlı Durum",
    icon: "store",
    items: [
      { label: "Şube Listesi", slug: "list" },
      { label: "Masa Planı", slug: "tables" },
      { label: "Açık Adisyonlar", slug: "open-checks" },
      { label: "Mutfak Yoğunluğu", slug: "kitchen-load" },
      { label: "Şube Karşılaştırması", slug: "comparison" },
    ],
  },
  {
    id: "catalog",
    label: "Ürünler ve Menü",
    icon: "book-open",
    items: [
      { label: "Menüler", slug: "menus" },
      { label: "Kategoriler", slug: "categories" },
      { label: "Ürünler", slug: "products" },
      { label: "Seçenek Grupları", slug: "options" },
      { label: "Alerjenler", slug: "allergens" },
      { label: "Ürün Görselleri", slug: "images" },
      { label: "Menü Kompozisyonu", slug: "composition" },
      { label: "Kanal Görünürlüğü", slug: "channels" },
      { label: "Şube Görünürlüğü", slug: "branch-visibility" },
      { label: "Fiyatlar", slug: "prices" },
      { label: "Fiyat Sürümleri", slug: "price-versions" },
      { label: "İleri Tarihli Fiyatlar", slug: "scheduled-prices" },
      { label: "POS'a Ürün Yayını", slug: "publishing" },
      { label: "Yayın Geçmişi", slug: "publish-history" },
    ],
  },
  {
    id: "sales",
    label: "Satışlar ve Adisyonlar",
    icon: "receipt-text",
    items: [
      { label: "Satış Özeti", slug: "summary" },
      { label: "Adisyonlar", slug: "checks" },
      { label: "Açık Adisyonlar", slug: "open" },
      { label: "Kapanan Adisyonlar", slug: "closed" },
      { label: "İptal Edilenler", slug: "cancelled" },
      { label: "İkramlar", slug: "complimentary" },
      { label: "İndirimler", slug: "discounts" },
      { label: "İadeler", slug: "refunds" },
      { label: "Kanal Dağılımı", slug: "channels" },
      { label: "Masa Satışları", slug: "table-sales" },
      { label: "Paket Satışları", slug: "delivery-sales" },
      { label: "QR Satışları", slug: "qr-sales" },
      { label: "Mutfak Durumları", slug: "kitchen-status" },
    ],
  },
  {
    id: "customers",
    label: "Cari ve Müşteriler",
    icon: "users-round",
    items: [
      { label: "Müşteriler", slug: "customers" },
      { label: "Cari Hesaplar", slug: "accounts" },
      { label: "Müşteri Grupları", slug: "groups" },
      { label: "Müşteri Geçmişi", slug: "history" },
      { label: "Segmentler", slug: "segments" },
      { label: "Sadakat Puanları", slug: "loyalty" },
      { label: "Kuponlar", slug: "coupons" },
      { label: "İzinler", slug: "consents" },
      { label: "İletişim Geçmişi", slug: "communications" },
      { label: "Geri Kazanma", slug: "winback" },
    ],
  },
  {
    id: "cash",
    label: "Kasalar",
    icon: "wallet",
    items: [
      { label: "Kasa Özeti", slug: "summary" },
      { label: "Kasa Hareketleri", slug: "movements" },
      { label: "Kasa Vardiyaları", slug: "shifts" },
      { label: "Açılış / Kapanış", slug: "opening-closing" },
      { label: "Nakit", slug: "cash" },
      { label: "Kart", slug: "card" },
      { label: "Yemek Kartı", slug: "meal-card" },
      { label: "Karma Ödemeler", slug: "mixed" },
      { label: "İadeler", slug: "refunds" },
      { label: "Kasa Farkı", slug: "difference" },
      { label: "Gün Sonu", slug: "end-of-day" },
    ],
  },
  {
    id: "finance",
    label: "Giderler ve Finans",
    icon: "landmark",
    items: [
      { label: "Giderler", slug: "expenses" },
      { label: "Gider Kategorileri", slug: "expense-categories" },
      { label: "Cari Borçlar", slug: "payables" },
      { label: "Cari Alacaklar", slug: "receivables" },
      { label: "Tedarikçi Borçları", slug: "supplier-debts" },
      { label: "Banka Hareketleri", slug: "bank" },
      { label: "Kasa-Banka Mutabakatı", slug: "reconciliation" },
      { label: "Dönem Özeti", slug: "period" },
      { label: "Vergi Özeti", slug: "tax" },
      { label: "Mali Belgeler", slug: "documents" },
      { label: "Muhasebe Aktarımı", slug: "export" },
    ],
  },
  {
    id: "inventory",
    label: "Stok ve Satın Alma",
    icon: "boxes",
    items: [
      { label: "Stok Özeti", slug: "summary" },
      { label: "Kritik Stoklar", slug: "critical" },
      { label: "Hammadde", slug: "ingredients" },
      { label: "Stok Ürünleri", slug: "items" },
      { label: "Birimler ve Dönüşümler", slug: "units" },
      { label: "Depolar", slug: "warehouses" },
      { label: "Depo Stokları", slug: "warehouse-stock" },
      { label: "Reçeteler", slug: "recipes" },
      { label: "Reçete Sürümleri", slug: "recipe-versions" },
      { label: "Üretim", slug: "production" },
      { label: "Fire Kayıtları", slug: "waste" },
      { label: "Stok Sayımları", slug: "counts" },
      { label: "Stok Düzeltmeleri", slug: "adjustments" },
      { label: "Depo Transferleri", slug: "transfers" },
      { label: "Tedarikçiler", slug: "suppliers" },
      { label: "Satın Alma Talepleri", slug: "requests" },
      { label: "Satın Alma Siparişleri", slug: "purchase-orders" },
      { label: "Mal Kabul", slug: "receiving" },
      { label: "Alış Faturaları", slug: "invoices" },
      { label: "Maliyet Analizi", slug: "costs" },
      { label: "Porsiyon Maliyeti", slug: "portion-cost" },
      { label: "Menü Mühendisliği", slug: "menu-engineering" },
      { label: "Stok Hareket Geçmişi", slug: "movements" },
    ],
  },
  {
    id: "kitchen",
    label: "Mutfak ve Servis",
    icon: "chef-hat",
    items: [
      { label: "Mutfak Özeti", slug: "summary" },
      { label: "İstasyonlar", slug: "stations" },
      { label: "KDS İşleri", slug: "jobs" },
      { label: "Hazırlık Süreleri", slug: "prep-times" },
      { label: "Geciken İşler", slug: "delayed" },
      { label: "Yazıcı Yedekleri", slug: "printer-backups" },
      { label: "Servis Durumu", slug: "service" },
      { label: "Personel", slug: "personnel" },
      { label: "Garson Çağrıları", slug: "calls" },
      { label: "İstasyon Performansı", slug: "performance" },
    ],
  },
  {
    id: "reports",
    label: "Raporlar",
    icon: "chart-no-axes-combined",
    items: [
      { label: "Satış Raporları", slug: "sales" },
      { label: "Ürün Raporları", slug: "products" },
      { label: "Kategori Raporları", slug: "categories" },
      { label: "Kanal Raporları", slug: "channels" },
      { label: "Şube Karşılaştırma", slug: "branches" },
      { label: "Kasa Raporları", slug: "cash" },
      { label: "Ödeme Raporları", slug: "payments" },
      { label: "Stok Raporları", slug: "inventory" },
      { label: "Maliyet Raporları", slug: "costs" },
      { label: "Personel Raporları", slug: "staff" },
      { label: "Mutfak Performansı", slug: "kitchen" },
      { label: "İptal / İkram Raporu", slug: "exceptions" },
      { label: "Rezervasyon Raporu", slug: "reservations" },
      { label: "Kurye Raporu", slug: "couriers" },
      { label: "Sadakat Raporu", slug: "loyalty" },
      { label: "AI Önerileri", slug: "recommendations" },
    ],
  },
  {
    id: "central",
    label: "Merkezi Yönetim",
    icon: "network",
    items: [
      { label: "Marka Yapısı", slug: "brands" },
      { label: "Şube Grupları", slug: "groups" },
      { label: "Merkezi Menü", slug: "menus" },
      { label: "Merkezi Fiyat", slug: "prices" },
      { label: "Merkezi Kampanya", slug: "campaigns" },
      { label: "Şubelere Yayın", slug: "publishing" },
      { label: "Yayın Geçmişi", slug: "history" },
      { label: "Şube İstisnaları", slug: "exceptions" },
      { label: "Geri Alma", slug: "rollback" },
      { label: "Konsolide Rapor", slug: "consolidated" },
      { label: "Şube Kıyaslama", slug: "comparison" },
    ],
  },
  {
    id: "settings",
    label: "Ayarlar",
    icon: "settings-2",
    items: [
      { label: "Modüller ve Özellikler", slug: "modules" },
      { label: "Kullanıcılar ve Yetkiler", slug: "users" },
      { label: "Entegrasyonlar", slug: "integrations" },
      { label: "Cihazlar", slug: "devices" },
      { label: "Bildirimler", slug: "notifications" },
      { label: "Para Birimleri", slug: "currencies" },
      { label: "Vergi Ayarları", slug: "tax" },
      { label: "Ödeme Ayarları", slug: "payments" },
      { label: "Şube Ayarları", slug: "branches" },
      { label: "Sistem Ayarları", slug: "system" },
    ],
  },
];

export type DemoBranch = {
  id: string;
  apiId: string;
  name: string;
  district: string;
  brandId: string | null;
  tables: number;
  occupied: number;
  openChecks: number;
  kitchen: number;
  sales: number;
  health: "good" | "busy";
};
export type DemoScenario = {
  id: string;
  firmId: string;
  firm: string;
  brand: string | null;
  branches: DemoBranch[];
};

export const scenarios: DemoScenario[] = [
  {
    id: "single",
    firmId: "11111111-1111-4111-8111-111111111111",
    firm: singleDemo.firm.name,
    brand: null,
    branches: [
      {
        id: "kadikoy",
        apiId: "33333333-3333-4333-8333-333333333333",
        name: singleDemo.branch.name,
        district: singleDemo.branch.district,
        brandId: null,
        tables: 24,
        occupied: 16,
        openChecks: 19,
        kitchen: 7,
        sales: 48250,
        health: "busy",
      },
    ],
  },
  {
    id: "multi",
    firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    firm: "ABC Restoran Grubu",
    brand: "PizzaMarka",
    branches: [
      {
        id: "moda",
        apiId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        name: "Moda Şubesi",
        district: "İstanbul · Kadıköy",
        brandId: "pizza-marka",
        tables: 28,
        occupied: 19,
        openChecks: 22,
        kitchen: 8,
        sales: 64280,
        health: "busy",
      },
      {
        id: "besiktas",
        apiId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        name: "Beşiktaş Şubesi",
        district: "İstanbul · Beşiktaş",
        brandId: "pizza-marka",
        tables: 22,
        occupied: 10,
        openChecks: 12,
        kitchen: 3,
        sales: 41670,
        health: "good",
      },
      {
        id: "atasehir",
        apiId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
        name: "Ataşehir Şubesi",
        district: "İstanbul · Ataşehir",
        brandId: "pizza-marka",
        tables: 30,
        occupied: 14,
        openChecks: 16,
        kitchen: 5,
        sales: 52740,
        health: "good",
      },
    ],
  },
];


export type DemoCheck = {
  id: string;
  scenarioId: string;
  branchId: string;
  table: string;
  items: string;
  total: number;
  status: "Hazırlanıyor" | "Serviste" | "Ödeme bekliyor" | "Hazır";
  age: string;
  channel: string;
};
export const checks: DemoCheck[] = [
  {
    id: "ADS-2408",
    scenarioId: "multi",
    branchId: "moda",
    table: "Masa 12",
    items: "2 ürün",
    total: 760,
    status: "Hazırlanıyor",
    age: "6 dk önce",
    channel: "Masa",
  },
  {
    id: "ADS-2407",
    scenarioId: "multi",
    branchId: "besiktas",
    table: "Masa 04",
    items: "4 ürün",
    total: 1380,
    status: "Serviste",
    age: "12 dk önce",
    channel: "Masa",
  },
  {
    id: "ADS-2406",
    scenarioId: "multi",
    branchId: "atasehir",
    table: "Paket #38",
    items: "3 ürün",
    total: 935,
    status: "Hazır",
    age: "17 dk önce",
    channel: "Paket",
  },
  {
    id: "ADS-2405",
    scenarioId: "multi",
    branchId: "moda",
    table: "Masa 18",
    items: "2 ürün",
    total: 540,
    status: "Ödeme bekliyor",
    age: "22 dk önce",
    channel: "Masa",
  },
  {
    id: "ADS-1041",
    scenarioId: "single",
    branchId: "kadikoy",
    table: "Masa 12",
    items: "2 ürün",
    total: 760,
    status: "Hazırlanıyor",
    age: "6 dk önce",
    channel: "Masa",
  },
  {
    id: "ADS-1040",
    scenarioId: "single",
    branchId: "kadikoy",
    table: "Masa 04",
    items: "4 ürün",
    total: 1380,
    status: "Serviste",
    age: "12 dk önce",
    channel: "Masa",
  },
  {
    id: "ADS-1039",
    scenarioId: "single",
    branchId: "kadikoy",
    table: "Paket #12",
    items: "3 ürün",
    total: 935,
    status: "Hazır",
    age: "17 dk önce",
    channel: "Paket",
  },
  {
    id: "ADS-1038",
    scenarioId: "single",
    branchId: "kadikoy",
    table: "Masa 18",
    items: "2 ürün",
    total: 540,
    status: "Ödeme bekliyor",
    age: "22 dk önce",
    channel: "Masa",
  },
];


export const formatMoney = (value: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value);
