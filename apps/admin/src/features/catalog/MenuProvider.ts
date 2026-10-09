import demo from "../../../../../contracts/demo-single-branch.v1.json";
import type { CatalogScope, Money } from "./contracts";

export type MenuSection = { sectionId: string; name: string; productIds: string[] };
export type RestaurantMenu = { id: string; name: string; description: string; isActive: boolean;
  version: number; updatedAt: string; sections: MenuSection[] };
export type MenuProduct = { id: string; name: string; categoryId: string; status: string; image: string; price: Money };
export type MenuWorkspace = { source: "postgres" | "mock"; items: RestaurantMenu[];
  categories: { id: string; name: string; isActive: boolean }[]; products: MenuProduct[] };
export type MenuSaveInput = { requestId: string; expectedVersion: number; name: string; description: string; sections: MenuSection[] };
export class MenuApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export class HttpMenuProvider {
  constructor(private baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180") {}
  private path(scope: CatalogScope) {
    if (!scope.branchId) throw new MenuApiError("BRANCH_REQUIRED", "Menü yönetimi için şube seçin.");
    return `/api/v1/firms/${encodeURIComponent(scope.firmId)}/branches/${encodeURIComponent(scope.branchId)}/catalog/menus`;
  }
  private async request<T>(scope: CatalogScope, suffix: string, method = "GET", body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${this.path(scope)}${suffix}`, { method,
        headers: { "X-Demo-Actor": scope.firmId === demo.firm.id ? "manager-single" : "manager-multi",
          ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new MenuApiError("LOAD_FAILED", "Menü sunucusuna ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin."); }
    const result = await response.json().catch(() => null) as T & { code?: string; detail?: string } | null;
    if (!response.ok) throw new MenuApiError(result?.code ?? (response.status >= 500 ? "LOAD_FAILED" : "REQUEST_FAILED"), result?.detail ?? "Menü işlemi tamamlanamadı.");
    if (!result) throw new MenuApiError("LOAD_FAILED", "Sunucu yanıtı okunamadı. Kayıt durumunu kontrol edin.");
    return result;
  }
  load(scope: CatalogScope) { return this.request<MenuWorkspace>(scope, ""); }
  save(scope: CatalogScope, id: string | null, body: MenuSaveInput) {
    return this.request<{ id: string }>(scope, id ? `/${encodeURIComponent(id)}` : "", id ? "PUT" : "POST", body);
  }
  activate(scope: CatalogScope, menu: RestaurantMenu, requestId: string) {
    return this.request<{ id: string }>(scope, `/${encodeURIComponent(menu.id)}/activation`, "POST",
      { requestId, expectedVersion: menu.version, isActive: !menu.isActive });
  }
}

export function sampleMenus(scope: CatalogScope): MenuWorkspace {
  if (scope.firmId !== demo.firm.id || scope.branchId !== demo.branch.id)
    return { source: "mock", categories: [], products: [], items: [] };
  return { source: "mock", categories: demo.categories.map(x => ({ ...x, isActive: true })),
    products: demo.products.map(x => ({ id: x.id, name: x.name, categoryId: x.categoryId, status: "published", image: x.image,
      price: { amountMinor: x.priceMinor, currency: "TRY" } })),
    items: [{ id: "sample-main", name: "Ana Menü", description: "Fırından çıkan lezzetler, tatlılar ve içecekler.", isActive: true,
      version: 1, updatedAt: "2026-10-08T09:00:00Z", sections: demo.categories.map(c => ({ sectionId: `catalog-${c.id}`, name: c.name,
        productIds: demo.products.filter(p => p.categoryId === c.id).map(p => p.id) })) }] };
}
