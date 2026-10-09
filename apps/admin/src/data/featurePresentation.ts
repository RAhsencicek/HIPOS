export type FeatureStage = "working" | "demo" | "inactive" | "setup" | "future";

export type FeaturePresentation = {
  stage: FeatureStage;
  label: string;
  description: string;
};

type Sources = { catalogSource: "mock" | "http"; featureSource: "mock" | "http"; cariSource?: "mock" | "http"; serviceSource?: "mock" | "http"; inventorySource?: "mock" | "http" };

// Alt ekranların görünür olgunluğu. Burada bulunmayan yol gelecekteki ürün planıdır.
const demoRoutes = new Set([
  "overview/daily",
  "branches/list", "branches/tables",
  "kitchen/personnel",
  "catalog/menus", "catalog/categories", "catalog/products",
  "sales/summary", "sales/checks", "sales/open",
  "customers/customers", "customers/accounts", "customers/history",
  "inventory/summary", "inventory/critical", "inventory/ingredients",
  "inventory/recipes", "inventory/counts", "inventory/suppliers", "inventory/movements",
  "reports/sales", "reports/branches",
  "settings/modules",
]);

// İlk üç aşamanın hedefi: menüde görünür, fakat henüz işlem başlatmaz.
const inactiveRoutes = new Set([
  "catalog/prices", "catalog/price-versions", "catalog/publishing", "catalog/publish-history",
  "customers/groups", "customers/consents",
  "inventory/items", "inventory/units", "inventory/warehouses", "inventory/warehouse-stock",
  "inventory/recipe-versions", "inventory/adjustments",
  "finance/payables", "finance/receivables", "finance/supplier-debts",
]);

const routeDescriptions: Record<string, string> = {
  "catalog/prices": "Fiyatlar şu an ürün ayrıntısında görülebilir; ayrı fiyat listesi ekranı henüz etkin değil.",
  "catalog/price-versions": "Fiyat sürümleri ürün ayrıntısında izlenir; bağımsız liste ekranı henüz etkin değil.",
  "catalog/publishing": "İlk POS yayını ürün ayrıntısından yapılabilir; ayrı yayın ekranı henüz etkin değil.",
  "catalog/publish-history": "Yayın geçmişi ürün ayrıntısında görülebilir; bağımsız ekran henüz etkin değil.",
  "inventory/recipe-versions": "Sürümler reçete kartında saklanır; ayrı sürüm geçmişi ekranı henüz etkin değil.",
  "inventory/adjustments": "Sayım onay düzeltmeleri hareket geçmişinde izlenir; bağımsız düzeltme ekranı henüz etkin değil.",
  "inventory/units": "Birim ve dönüşüm tanımları stok aşamasında etkinleşecek.",
  "inventory/warehouses": "İlk stok aşaması tek depo ile başlayacak; depo yönetimi henüz etkin değil.",
  "inventory/warehouse-stock": "Depo bazlı kalıcı stok görünümü henüz etkin değil.",
  "customers/groups": "Müşteri grupları cari kartlarından sonraki aşamada değerlendirilecek.",
  "customers/consents": "İletişim izinleri için kalıcı kayıt ve yetki kuralları henüz etkin değil.",
  "finance/payables": "Tedarikçi borçları cari hareketlerinden beslenecek; finans ekranı henüz etkin değil.",
  "finance/receivables": "Müşteri alacakları cari hareketlerinden beslenecek; finans ekranı henüz etkin değil.",
  "finance/supplier-debts": "Tedarikçi borcu için ayrı kayıt oluşturulmayacak; cari temelinden okunacak.",
  "catalog/scheduled-prices": "İleri tarihli fiyatların geçerlilik ve yayın kuralları sonraki sürüme bırakıldı.",
  "reports/staff": "Personelin çalışma süresi ve performansı için güvenilir veri kaynağı henüz yok.",
  "reports/kitchen": "Kişi bazlı mutfak performansı bu sürümde hesaplanmıyor.",
  "kitchen/jobs": "KDS işleri için gerçek mutfak ekranı ve sipariş bağlantısı gerekecek.",
  "settings/users": "Ayrıntılı yetkilendirme pilot öncesi güvenli giriş çalışmasıyla tasarlanacak.",
  "settings/integrations": "Dış sağlayıcı bağlantıları kurulmadı; bu ekranda yalnız planlanan kapsam gösterilir.",
};

const futureBySection: Record<string, string> = {
  central: "Çok şubeli merkez yönetimi tek şubeli ilk tanıtımdan sonraki ürün aşamasıdır.",
  cash: "Kasa ve gerçek tahsilat işlemleri sonraki ürün aşamasıdır.",
  kitchen: "Mutfak ve servis operasyonları için gerçek iş akışı henüz kurulmadı.",
  finance: "Finans ekranı için kalıcı işlem ve hesaplama kuralları henüz kurulmadı.",
  settings: "Bu ayar için kalıcı iş akışı veya bağlantı henüz kurulmadı.",
};

export function featurePresentation(section: string, item: string, sources: Sources): FeaturePresentation {
  const key = `${section}/${item}`;
  if (key === "catalog/menus" && sources.catalogSource === "http")
    return { stage: "working", label: "Çalışıyor", description: "Menü taslağı, özel bölüm, ikonlu ürün seçimi ve şubede tek yayındaki menü PostgreSQL'e bağlıdır. QR ve web yayını sonraki ürün aşamasıdır." };
  if (key === "overview/daily")
    return { stage: "demo", label: "Karma kaynak görünümü", description: "Satış, masa ve kritik stok kartları sağlayıcı açıksa yerel API'den; diğer alanlar örnek işletme verisinden gelir. Her kart kendi veri kaynağını belirtir." };
  if (section === "inventory" && sources.inventorySource === "http" &&
    ["summary", "critical", "ingredients", "movements", "counts", "recipes"].includes(item))
    return { stage: "working", label: "Çalışıyor", description: "Hammadde, reçete sürümleri, hareket defteri ve sayım akışı kalıcı inventory PostgreSQL şemasına bağlıdır. Yeni işlemler şube modül durumuna göre açılır; bu geliştirme önizlemesi üretim yetkilendirmesi değildir." };
  if (key === "branches/tables" && sources.serviceSource === "http")
    return { stage: "working", label: "Çalışıyor", description: "Masa, garson ve açık masa-adisyon bağı yerel PostgreSQL API'sinden okunur. Yeni işler şube modül durumuna bağlıdır." };
  if (key === "kitchen/personnel" && sources.serviceSource === "http")
    return { stage: "working", label: "Çalışıyor", description: "Personel kartları bölüm ve görev bazında PostgreSQL'e kaydedilir. Bordro, vardiya ve POS yetkilendirmesi bu ekranın dışındadır." };
  if (["customers/customers", "customers/accounts", "customers/history", "inventory/suppliers"].includes(key) && sources.cariSource === "http")
    return { stage: "working", label: "Çalışıyor", description: "Cari kartları ve manuel hareketler yerel PostgreSQL API'sine bağlıdır. Gerçek ödeme, fatura ve üretim kimlik doğrulaması henüz etkin değildir." };
  if ((key === "catalog/products" || key === "catalog/categories") && sources.catalogSource === "http")
    return { stage: "working", label: "Çalışıyor", description: "Bu ekran seçili firma/şubenin katalog verisini yerel PostgreSQL API'sinden okur. Yazma işlemleri ayrıca modül durumuna bağlıdır." };
  if (key === "settings/modules" && sources.featureSource === "http")
    return { stage: "working", label: "Çalışıyor", description: "Modül tercihleri geliştirme API'sine bağlıdır. Bu, üretim kullanıcısı veya diğer iş alanlarının hazır olduğu anlamına gelmez." };
  if (demoRoutes.has(key))
    return { stage: "demo", label: "Örnek gösterim", description: "Bu alt ekrandaki örnekler tanıtım verisidir; burada yeni kalıcı iş kaydı oluşturulmaz." };
  if (inactiveRoutes.has(key))
    return { stage: "inactive", label: "Bu özellik henüz etkin değil", description: routeDescriptions[key] ?? "Bu iş ilk üç aşamanın kapsamındadır; kalıcı işlem henüz etkinleştirilmedi." };
  return { stage: "future", label: "Gelecek planı", description: routeDescriptions[key] ?? futureBySection[section] ?? "Bu özellik ürün yol haritasındadır; bu sürümde işlem veya güvenilir veri sunmaz." };
}

export function isFutureSidebarItem(section: string, item: string): boolean {
  const stage = featurePresentation(section, item, { catalogSource: "mock", featureSource: "mock" }).stage;
  return stage === "future" || stage === "inactive";
}
