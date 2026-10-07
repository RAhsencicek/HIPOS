import { Link, useParams } from "react-router";
import type { ReactNode } from "react";
import { ArrowRight, Clock3 } from "lucide-react";
import { sections } from "../data/catalog";
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
import { BranchesPage } from "../features/branches/BranchesPage";
import { SalesPage } from "../features/sales/SalesPage";
import { InventoryPage } from "../features/inventory/InventoryPage";
import { ReportsPage } from "../features/reports/ReportsPage";
import { ModulesPage } from "../features/settings/ModulesPage";
import { IntegrationsPage } from "../features/settings/IntegrationsPage";
import { GenericPage } from "../shared/GenericPage";

const sectionFeatureKey: Record<string, string> = {
  catalog: "catalog.products",
  branches: "branches.tables",
  sales: "sales.monitoring",
  inventory: "inventory.items",
  kitchen: "kitchen.monitoring",
  reports: "reports.sales",
  cash: "cash.monitoring",
  finance: "finance.expenses",
};

function routeFeatureKey(section?: string, item?: string): string | undefined {
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
      "suppliers",
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
  let content: ReactNode;
  if (productId) {
    content = <ProductDetail ctx={ctx} productId={productId} canWriteDraft={canWriteDraft}
      canSetPrice={canSetPrice} canPublish={canPublish} />;
  } else if (
    !section ||
    (section === "overview" && (!item || item === "daily"))
  ) {
    content = <Dashboard ctx={ctx} />;
  } else if (section === "catalog" && item === "products") {
    content = <ProductsPage ctx={ctx} canPreviewNewWork={canPreviewNewWork} canWriteDraft={canWriteDraft} />;
  } else if (section === "catalog" && item === "categories") {
    content = <CategoriesPage ctx={ctx} />;
  } else if (
    section === "branches" &&
    (!item || ["list", "tables"].includes(item))
  ) {
    content = <BranchesPage ctx={ctx} />;
  } else if (
    section === "sales" &&
    (!item || ["summary", "checks", "open"].includes(item))
  ) {
    content = <SalesPage ctx={ctx} />;
  } else if (section === "inventory" && (!item || item === "summary")) {
    content = <InventoryPage />;
  } else if (
    section === "reports" &&
    (!item || item === "sales" || item === "branches")
  ) {
    content = <ReportsPage ctx={ctx} />;
  } else if (section === "settings" && (!item || item === "modules")) {
    content = <ModulesPage ctx={ctx} />;
  } else if (section === "settings" && item === "integrations") {
    content = <IntegrationsPage />;
  } else {
    const found = sections.find((entry) => entry.id === section);
    content = found ? (
      <GenericPage section={found} slug={item} />
    ) : (
      <Dashboard ctx={ctx} />
    );
  }

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
      {content}
    </>
  );
}
