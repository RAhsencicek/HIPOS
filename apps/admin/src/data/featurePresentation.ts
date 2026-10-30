import { featureStory } from "./featureStories";

export type FeatureStage = "working" | "demo" | "inactive" | "setup" | "future";

export type FeaturePresentation = {
  stage: FeatureStage;
  label: string;
  description: string;
};

type Sources = { catalogSource: "mock" | "http"; featureSource: "mock" | "http"; cariSource?: "mock" | "http"; serviceSource?: "mock" | "http"; inventorySource?: "mock" | "http"; cashSource?: "mock" | "http"; expenseSource?: "mock" | "http" };

const configuredSources: Sources = {
  catalogSource: import.meta.env.VITE_CATALOG_PROVIDER === "http" ? "http" : "mock",
  featureSource: import.meta.env.VITE_FEATURE_PROVIDER === "http" ? "http" : "mock",
  cariSource: import.meta.env.VITE_CARI_PROVIDER === "http" ? "http" : "mock",
  serviceSource: import.meta.env.VITE_SERVICE_PROVIDER === "http" ? "http" : "mock",
  inventorySource: import.meta.env.VITE_INVENTORY_PROVIDER === "http" ? "http" : "mock",
  cashSource: import.meta.env.VITE_CASH_PROVIDER === "http" ? "http" : "mock",
  expenseSource: import.meta.env.VITE_EXPENSE_PROVIDER === "http" ? "http" : "mock",
};

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

export function featurePresentation(section: string, item: string, sources: Sources): FeaturePresentation {
  const key = `${section}/${item}`;
  const description = featureStory(section, item).description;
  if (section === "finance" && ["expenses", "expense-categories"].includes(item) && sources.expenseSource === "http")
    return { stage: "working", label: "Çalışıyor", description };
  if (key === "catalog/options" && sources.catalogSource === "http")
    return { stage: "working", label: "Çalışıyor", description };
  if (key === "catalog/menus" && sources.catalogSource === "http")
    return { stage: "working", label: "Çalışıyor", description };
  if (key === "overview/daily")
    return { stage: "demo", label: "Önizleme", description };
  if (section === "cash" && sources.cashSource === "http" &&
    ["summary", "movements", "shifts", "opening-closing"].includes(item))
    return { stage: "working", label: "Çalışıyor", description };
  if (section === "inventory" && sources.inventorySource === "http" &&
    ["summary", "critical", "ingredients", "movements", "counts", "recipes"].includes(item))
    return { stage: "working", label: "Çalışıyor", description };
  if (key === "branches/tables" && sources.serviceSource === "http")
    return { stage: "working", label: "Çalışıyor", description };
  if (key === "kitchen/personnel" && sources.serviceSource === "http")
    return { stage: "working", label: "Çalışıyor", description };
  if (["customers/customers", "customers/accounts", "customers/history", "inventory/suppliers"].includes(key) && sources.cariSource === "http")
    return { stage: "working", label: "Çalışıyor", description };
  if ((key === "catalog/products" || key === "catalog/categories") && sources.catalogSource === "http")
    return { stage: "working", label: "Çalışıyor", description };
  if (key === "settings/modules" && sources.featureSource === "http")
    return { stage: "working", label: "Çalışıyor", description };
  if (demoRoutes.has(key))
    return { stage: "demo", label: "Örnek gösterim", description };
  if (inactiveRoutes.has(key))
    return { stage: "inactive", label: "Çok yakında", description };
  return { stage: "future", label: "Çok yakında", description };
}

export function isFutureSidebarItem(section: string, item: string, sources: Sources = configuredSources): boolean {
  const stage = featurePresentation(section, item, sources).stage;
  return stage === "future" || stage === "inactive";
}
