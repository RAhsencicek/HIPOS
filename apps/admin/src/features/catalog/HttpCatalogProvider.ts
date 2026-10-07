import { CatalogProviderError } from "./contracts";
import type {
  CatalogProductDetail,
  CategoryListResponse,
  CatalogProvider,
  CatalogScope,
  CreateDraftRequest,
  ProductDetailRequest,
  ProductListRequest,
  ProductListResponse,
  PriceResult,
  PriceVersion,
  Publication,
  PublicationResult,
  PublishDraftRequest,
  SetDraftPriceRequest,
  UpdateDraftRequest,
} from "./contracts";

type ApiProblem = { code?: string; detail?: string };

// Yalnız Development API prototipi; X-Demo-Actor gerçek kullanıcı oturumu değildir.
export class HttpCatalogProvider implements CatalogProvider {
  constructor(private readonly baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180") {}

  private actor(scope: CatalogScope): string {
    return scope.firmId === "11111111-1111-4111-8111-111111111111"
      ? "manager-single"
      : "manager-multi";
  }

  private async request<T>(
    path: string, scope: CatalogScope,
    method: "GET" | "POST" | "PUT" = "GET", body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "X-Demo-Actor": this.actor(scope),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new CatalogProviderError("LOAD_FAILED", 503, "Yerel katalog API'sine bağlanılamadı.");
    }
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as ApiProblem;
      throw new CatalogProviderError(
        (problem.code ?? "LOAD_FAILED") as CatalogProviderError["code"],
        response.status,
        problem.detail ?? "Ürün verisi yüklenemedi.",
      );
    }
    return response.json() as Promise<T>;
  }

  private productPath(scope: CatalogScope): string {
    return `/api/v1/firms/${encodeURIComponent(scope.firmId)}/catalog/products`;
  }

  listProducts(request: ProductListRequest): Promise<ProductListResponse> {
    const params = new URLSearchParams({
      page: String(request.page),
      pageSize: String(request.pageSize),
    });
    if (request.scope.branchId) params.set("branchId", request.scope.branchId);
    if (request.query) params.set("query", request.query);
    if (request.categoryId) params.set("categoryId", request.categoryId);
    return this.request(`${this.productPath(request.scope)}?${params}`, request.scope);
  }

  listCategories(scope: CatalogScope): Promise<CategoryListResponse> {
    const params = new URLSearchParams();
    if (scope.branchId) params.set("branchId", scope.branchId);
    const query = params.size ? `?${params}` : "";
    return this.request(`/api/v1/firms/${encodeURIComponent(scope.firmId)}/catalog/categories${query}`, scope);
  }

  getProduct(request: ProductDetailRequest): Promise<CatalogProductDetail> {
    const params = new URLSearchParams();
    if (request.scope.branchId) params.set("branchId", request.scope.branchId);
    const query = params.size ? `?${params}` : "";
    return this.request(
      `${this.productPath(request.scope)}/${encodeURIComponent(request.productId)}${query}`,
      request.scope,
    );
  }

  createDraft(request: CreateDraftRequest): Promise<CatalogProductDetail> {
    if (!request.scope.branchId)
      return Promise.reject(new CatalogProviderError(
        "INVALID_DRAFT", 400, "Yeni taslak için bir şube seçin.",
      ));
    return this.request(
      this.draftPath(request.scope), request.scope, "POST",
      {
        draftId: request.draftId,
        name: request.name,
        sku: request.sku,
        categoryId: request.categoryId,
        categoryName: request.categoryName,
        description: request.description,
      },
    );
  }

  updateDraft(request: UpdateDraftRequest): Promise<CatalogProductDetail> {
    if (!request.scope.branchId)
      return Promise.reject(new CatalogProviderError(
        "INVALID_DRAFT", 400, "Taslak düzenlemek için bir şube seçin.",
      ));
    return this.request(
      `${this.draftPath(request.scope)}/${encodeURIComponent(request.draftId)}`,
      request.scope, "PUT",
      {
        name: request.name,
        sku: request.sku,
        categoryId: request.categoryId,
        categoryName: request.categoryName,
        description: request.description,
        expectedVersion: request.expectedVersion,
      },
    );
  }

  setDraftPrice(request: SetDraftPriceRequest): Promise<PriceResult> {
    if (!request.scope.branchId)
      return Promise.reject(new CatalogProviderError("INVALID_DRAFT", 400, "Fiyat için bir şube seçin."));
    return this.request(`${this.draftPath(request.scope)}/${encodeURIComponent(request.draftId)}/price`,
      request.scope, "PUT", {
        priceVersionId: request.priceVersionId,
        amountMinor: request.amountMinor,
        expectedVersion: request.expectedVersion,
      });
  }

  publishDraft(request: PublishDraftRequest): Promise<PublicationResult> {
    if (!request.scope.branchId)
      return Promise.reject(new CatalogProviderError("INVALID_DRAFT", 400, "Yayın için bir şube seçin."));
    return this.request(`${this.draftPath(request.scope)}/${encodeURIComponent(request.draftId)}/publish`,
      request.scope, "POST", {
        publicationId: request.publicationId,
        expectedVersion: request.expectedVersion,
      });
  }

  listPriceVersions(request: ProductDetailRequest): Promise<PriceVersion[]> {
    if (!request.scope.branchId)
      return Promise.reject(new CatalogProviderError("INVALID_DRAFT", 400, "Fiyat geçmişi için bir şube seçin."));
    return this.request(`${this.historyPath(request.scope, request.productId)}/price-versions`, request.scope);
  }

  listPublications(request: ProductDetailRequest): Promise<Publication[]> {
    if (!request.scope.branchId)
      return Promise.reject(new CatalogProviderError("INVALID_DRAFT", 400, "Yayın geçmişi için bir şube seçin."));
    return this.request(`${this.historyPath(request.scope, request.productId)}/publications`, request.scope);
  }

  private historyPath(scope: CatalogScope, productId: string): string {
    return `/api/v1/firms/${encodeURIComponent(scope.firmId)}/branches/${encodeURIComponent(scope.branchId!)}/catalog/products/${encodeURIComponent(productId)}`;
  }

  private draftPath(scope: CatalogScope): string {
    return `/api/v1/firms/${encodeURIComponent(scope.firmId)}/branches/${encodeURIComponent(scope.branchId!)}/catalog/drafts`;
  }
}
