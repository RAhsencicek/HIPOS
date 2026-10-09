import { Link, useParams } from "react-router";
import type { ReactNode } from "react";
import { ArrowRight, Clock3 } from "lucide-react";
import { sections } from "../data/catalog";
import { featurePresentation } from "../data/featurePresentation";
import type { ViewContext } from "./context";
import { useFeatureCatalog } from "../features/modules/useFeatureCatalog";
import { useCatalogProvider, useFeatureProvider } from "./providers";
import type {
  BranchFeatureState,
  FeatureDefinition,
} from "../features/modules/contracts";
import { StatusPill } from "../shared/ui";
import { Dashboard } from "../features/overview/OverviewPage";
import { ProductsPage, ProductDetail, CategoriesPage } from "../features/catalog/CatalogPages";
import { MenusPage } from "../features/catalog/MenusPage";
import { BranchesPage } from "../features/branches/BranchesPage";
import { ServiceTablesPage } from "../features/branches/ServiceTablesPage";
import { ServicePersonnelPage } from "../features/branches/ServicePersonnelPage";
import { SalesPage } from "../features/sales/SalesPage";
import type { SalesView } from "../features/sales/SalesPage";
import { InventoryPage } from "../features/inventory/InventoryPage";
import { ReportsPage } from "../features/reports/ReportsPage";
import { ModulesPage } from "../features/settings/ModulesPage";
import { IntegrationsPage } from "../features/settings/IntegrationsPage";
import { GenericPage, SectionDirectory } from "../shared/GenericPage";
import { CarilerDemoPage, RecipesDemoPage, StockDemoPage } from "../features/demo/DemoBusinessPages";
import { CarilerHttpPage } from "../features/demo/CarilerHttpPage";
import { InventoryHttpPage } from "../features/inventory/InventoryHttpPage";

const sectionFeatureKey: Record<string, string> = {
  catalog: "catalog.products",
  sales: "sales.monitoring",
  inventory: "inventory.items",
  kitchen: "kitchen.monitoring",
  reports: "reports.sales",
  cash: "cash.monitoring",
  finance: "finance.expenses",
};

function routeFeatureKey(section?: string, item?: string): string | undefined {
  if (section === "catalog" && item === "menus") return "catalog.menus";
  if (section === "branches") return item === "tables" ? "branches.tables" : undefined;
  if (section === "kitchen" && item === "personnel") return "staff.records";
  if (section === "inventory" && item === "counts") return "inventory.counts";
  if (
    section === "catalog" &&
    ["prices", "price-versions", "scheduled-prices"].includes(item ?? "")
  )
    return "catalog.pricing";
  if (
    section === "inventory" &&
    ["recipes", "recipe-versions", "portion-cost", "menu-engineering"].includes(
      item ?? "",
    )
  )
    return "inventory.recipes";
  if (
    section === "inventory" &&
    [
      "requests",
      "purchase-orders",
      "receiving",
      "invoices",
    ].includes(item ?? "")
  )
    return "procurement.requests";
  if (section === "reports" && item === "loyalty") return "customers.loyalty";
  if (section === "settings" && item === "integrations")
    return "integrations.delivery";
  return section ? sectionFeatureKey[section] : undefined;
}

function FeatureNotice({
  definition,
  state,
  branchName,
}: {
  definition: FeatureDefinition;
  state: BranchFeatureState;
  branchName: string;
}) {
  if (state.lifecycle === "ready") return null;
  const title =
    state.lifecycle === "draining"
      ? "Yeni işler kapalı; devam eden işler tamamlanıyor"
      : state.lifecycle === "setup_required"
        ? "Kurulum gerekiyor"
        : state.lifecycle === "provider_pending"
          ? "Sağlayıcı bekleniyor"
          : "Bu özellik bu şubede kapalı";
  return (
    <div className="notice branch-pick-notice" role="status">
      <Clock3 size={17} />
      <div>
        <strong>{title}</strong>
        <span>
          {" "}
          {branchName} · {definition.name}. Geçmiş ve örnek veriler salt okunur
          görünür; yeni işlem başlatılamaz.
        </span>
        {state.blockers.map((blocker) => (
          <small key={blocker.code}> {blocker.message}</small>
        ))}
      </div>
      <Link to="/admin/settings/modules" className="subtle-link">
        Modül ayarları <ArrowRight size={15} />
      </Link>
    </div>
  );
}

export function RouteView({ ctx }: { ctx: ViewContext }) {
  const catalogSource = useCatalogProvider().source;
  const featureSource = useFeatureProvider().source;
  const cariSource: "http" | "mock" = import.meta.env.VITE_CARI_PROVIDER === "http" ? "http" : "mock";
  const serviceSource: "http" | "mock" = import.meta.env.VITE_SERVICE_PROVIDER === "http" ? "http" : "mock";
  const inventorySource: "http" | "mock" = import.meta.env.VITE_INVENTORY_PROVIDER === "http" ? "http" : "mock";
  const { section, item, productId } = useParams();
  const scope = ctx.selectedBranch
    ? { firmId: ctx.firmId, branchId: ctx.selectedBranch.apiId }
    : null;
  const featureLoad = useFeatureCatalog(scope);
  const key = routeFeatureKey(section, item);
  const definition =
    featureLoad.status === "success"
      ? featureLoad.definitions.find((entry) => entry.key === key)
      : undefined;
  const state =
    featureLoad.status === "success"
      ? featureLoad.states.find((entry) => entry.key === key)
      : undefined;

  if (
    featureLoad.status === "error" &&
    featureLoad.error.status === 403 &&
    scope
  ) {
    return (
      <div className="card empty-list" role="alert">
        <strong>Bu şubenin verilerine erişim yok</strong>
        <span>{featureLoad.error.message}</span>
      </div>
    );
  }

  const canPreviewNewWork = Boolean(
    scope && state?.desiredEnabled && state.lifecycle === "ready",
  );
  const draftState = featureLoad.status === "success"
    ? featureLoad.states.find((entry) => entry.key === "catalog.drafts")
    : undefined;
  const canWriteDraft = Boolean(scope && catalogSource === "http" && featureSource === "http" && draftState?.effectiveForNewWork);
  const priceState = featureLoad.status === "success"
    ? featureLoad.states.find((entry) => entry.key === "catalog.price_drafts") : undefined;
  const publishingState = featureLoad.status === "success"
    ? featureLoad.states.find((entry) => entry.key === "catalog.publishing") : undefined;
  const canSetPrice = Boolean(scope && catalogSource === "http" && featureSource === "http" && priceState?.effectiveForNewWork);
  const canPublish = Boolean(scope && catalogSource === "http" && featureSource === "http" && publishingState?.effectiveForNewWork);
  const menuState = featureLoad.status === "success" ? featureLoad.states.find(entry => entry.key === "catalog.menus") : undefined;
  const canWriteMenus = Boolean(scope && catalogSource === "http" && featureSource === "http" && menuState?.effectiveForNewWork);
  const menus = <MenusPage key={`${ctx.firmId}:${ctx.branchApiId}:${catalogSource}`} ctx={ctx} source={catalogSource} canWrite={canWriteMenus} />;
  const inventoryItemsState = featureLoad.status === "success" ? featureLoad.states.find((entry) => entry.key === "inventory.items") : undefined;
  const inventoryRecipesState = featureLoad.status === "success" ? featureLoad.states.find((entry) => entry.key === "inventory.recipes") : undefined;
  const inventoryCountsState = featureLoad.status === "success" ? featureLoad.states.find((entry) => entry.key === "inventory.counts") : undefined;
  const personnelState = featureLoad.status === "success" ? featureLoad.states.find((entry) => entry.key === "staff.records") : undefined;
  const canWriteInventoryItems = Boolean(scope && inventorySource === "http" && featureSource === "http" && inventoryItemsState?.effectiveForNewWork);
  const canWriteInventoryRecipes = Boolean(scope && inventorySource === "http" && featureSource === "http" && inventoryRecipesState?.effectiveForNewWork);
  const canWriteInventoryCounts = Boolean(scope && inventorySource === "http" && featureSource === "http" && inventoryCountsState?.effectiveForNewWork);
  const canWritePersonnel = Boolean(scope && serviceSource === "http" && featureSource === "http" && personnelState?.effectiveForNewWork);
  const sources = { catalogSource, featureSource, cariSource, serviceSource, inventorySource };
  let content: ReactNode;
  let generic = false;
  if (productId) {
    content = <ProductDetail ctx={ctx} productId={productId} canWriteDraft={canWriteDraft}
      canSetPrice={canSetPrice} canPublish={canPublish} inventorySource={inventorySource} />;
  } else if (!section || (section === "overview" && item === "daily")) {
    content = <Dashboard ctx={ctx} />;
  } else if (section === "catalog" && !item) {
    content = <>{menus}<SectionDirectory section={sections.find(entry => entry.id === "catalog")!} sources={sources} /></>;
  } else if (section === "catalog" && item === "menus") {
    content = menus;
  } else if (!item) {
    const found = sections.find((entry) => entry.id === section);
    if (found && ["overview", "branches", "sales", "inventory", "reports", "settings"].includes(section)) {
      const summary = section === "overview" ? <Dashboard ctx={ctx} /> :
        section === "branches" ? <BranchesPage ctx={ctx} /> :
        section === "sales" ? <SalesPage ctx={ctx} view="summary" /> :
        section === "inventory" ? inventorySource === "http"
          ? <InventoryHttpPage ctx={ctx} view="summary" canWriteItems={canWriteInventoryItems} canWriteRecipes={canWriteInventoryRecipes} canWriteCounts={canWriteInventoryCounts} />
          : <InventoryPage ctx={ctx} /> :
        section === "reports" ? <ReportsPage ctx={ctx} /> : <ModulesPage ctx={ctx} />;
      content = <>{summary}<SectionDirectory section={found} sources={sources} /></>;
    } else {
      generic = true;
      content = found ? <GenericPage section={found} sources={sources} /> : <Dashboard ctx={ctx} />;
    }
  } else if (section === "catalog" && item === "products") {
    content = <ProductsPage ctx={ctx} canPreviewNewWork={canPreviewNewWork} canWriteDraft={canWriteDraft} />;
  } else if (section === "catalog" && item === "categories") {
    content = <CategoriesPage ctx={ctx} />;
  } else if (section === "branches" && item === "tables") {
    content = <ServiceTablesPage ctx={ctx} source={serviceSource} />;
  } else if (section === "kitchen" && item === "personnel") {
    content = <ServicePersonnelPage ctx={ctx} source={serviceSource} canWrite={canWritePersonnel} />;
  } else if (section === "branches" && item === "list") {
    content = <BranchesPage ctx={ctx} />;
  } else if (
    section === "sales" &&
    ["summary", "checks", "open"].includes(item)
  ) {
    content = <SalesPage ctx={ctx} view={item as SalesView} />;
  } else if (section === "inventory" && item === "summary") {
    content = inventorySource === "http"
      ? <InventoryHttpPage ctx={ctx} view="summary" canWriteItems={canWriteInventoryItems} canWriteRecipes={canWriteInventoryRecipes} canWriteCounts={canWriteInventoryCounts} />
      : <InventoryPage ctx={ctx} />;
  } else if (section === "inventory" && item === "recipes") {
    content = inventorySource === "http"
      ? <InventoryHttpPage ctx={ctx} view="recipes" canWriteItems={canWriteInventoryItems} canWriteRecipes={canWriteInventoryRecipes} canWriteCounts={canWriteInventoryCounts} />
      : <RecipesDemoPage ctx={ctx} />;
  } else if (section === "inventory" && ["ingredients", "critical", "movements", "counts", "warehouse-stock"].includes(item)) {
    content = inventorySource === "http"
      ? <InventoryHttpPage ctx={ctx} view={item === "warehouse-stock" ? "warehouseStock" : item as "ingredients" | "critical" | "movements" | "counts"} canWriteItems={canWriteInventoryItems} canWriteRecipes={canWriteInventoryRecipes} canWriteCounts={canWriteInventoryCounts} />
      : <StockDemoPage ctx={ctx} view={item as "ingredients" | "critical" | "movements" | "counts"} />;
  } else if ((section === "customers" && ["customers", "accounts", "history"].includes(item)) ||
    (section === "inventory" && item === "suppliers")) {
    const kind = section === "inventory" ? "supplier" : item === "customers" || item === "history" ? "customer" : "all";
    content = cariSource === "http" ? <CarilerHttpPage ctx={ctx} kind={kind} /> : <CarilerDemoPage ctx={ctx} kind={kind} />;
  } else if (
    section === "reports" &&
    (item === "sales" || item === "branches")
  ) {
    content = <ReportsPage ctx={ctx} />;
  } else if (section === "settings" && item === "modules") {
    content = <ModulesPage ctx={ctx} />;
  } else if (section === "settings" && item === "integrations") {
    content = <IntegrationsPage />;
  } else {
    const found = sections.find((entry) => entry.id === section);
    generic = true;
    content = found ? (
      <GenericPage section={found} slug={item} sources={sources} />
    ) : (
      <Dashboard ctx={ctx} />
    );
  }

  const presentationSection = productId ? "catalog" : section ?? "overview";
  const rootItem: Record<string, string> = { overview: "daily", branches: "list", sales: "summary", inventory: "summary", reports: "sales", settings: "modules" };
  const presentationItem = productId ? "products" : item ?? rootItem[presentationSection] ?? "daily";
  const basePresentation = featurePresentation(presentationSection, presentationItem, sources);
  const presentation = state?.lifecycle === "setup_required" &&
    (basePresentation.stage === "working" || basePresentation.stage === "demo")
    ? { stage: "setup" as const, label: "Kurulum gerekiyor", description: "Bu şubede gerekli kurulum tamamlanmadan yeni işlem başlatılamaz." }
    : basePresentation;

  return (
    <>
      {scope && key && featureLoad.status === "loading" && (
        <div className="notice" role="status">
          Modül durumu yükleniyor; yeni işlem şimdilik kapalı.
        </div>
      )}
      {scope && key && featureLoad.status === "error" && (
        <div className="notice" role="alert">
          Modül durumu doğrulanamadı; yeni işlem kapalı.
        </div>
      )}
      {scope && definition && state && (
        <FeatureNotice
          definition={definition}
          state={state}
          branchName={ctx.selectedBranch!.name}
        />
      )}
      {!scope && section === "catalog" && (
        <div className="notice" role="status">
          <StatusPill tone="blue">Salt okunur</StatusPill> Tüm şubeler
          görünümünde yeni işlem için önce hedef şubeyi seçin.
        </div>
      )}
      {!generic && <div className="notice feature-stage-notice" role="status">
        <StatusPill tone={presentation.stage === "working" ? "green" : presentation.stage === "demo" ? "purple" : "orange"}>{presentation.label}</StatusPill>
        <span>{presentation.description}</span>
      </div>}
      {content}
    </>
  );
}
