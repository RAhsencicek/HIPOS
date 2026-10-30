import { CatalogProviderError } from "./contracts";
import type {
  CatalogProductDetail,
  CatalogOptionGroup,
  OptionGroupInput,
  OptionItemInput,
  ProductOptionGroups,
  ProductOptionInput,
  CategoryMutationResult,
  CategoryListResponse,
  CatalogProvider,
  CatalogScope,
  CreateCategoryRequest,
  CreateDraftRequest,
  CreatePricedProductRequest,
  ProductDetailRequest,
  ProductListRequest,
  ProductListResponse,
  RenameCategoryRequest,
  PriceResult,
  PriceVersion,
  Publication,
  PublicationResult,
  PublishDraftRequest,
  SetDraftPriceRequest,
  SetProductActiveRequest,
  UpdateDraftRequest,
  UpdatePublishedProductRequest,
} from "./contracts";

type ApiProblem = { code?: string; detail?: string };

// Yalnız Development API prototipi; X-Demo-Actor gerçek kullanıcı oturumu değildir.
export class HttpCatalogProvider implements CatalogProvider {
  constructor(private readonly baseUrl = import.meta.env.VITE_API_BASE_URL ?? "") {}

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
    if (!scope.branchId) {
      return Promise.reject(new CatalogProviderError("INVALID_DRAFT", 400, "Kategorileri görüntülemek için bir şube seçin."));
    }
    const params = new URLSearchParams();
    params.set("branchId", scope.branchId);
    const query = params.size ? `?${params}` : "";
    return this.request(`/api/v1/firms/${encodeURIComponent(scope.firmId)}/catalog/categories${query}`, scope);
  }

  createCategory(request: CreateCategoryRequest): Promise<CategoryMutationResult> {
    if (!request.scope.branchId) {
      return Promise.reject(new CatalogProviderError("INVALID_DRAFT", 400, "Kategori oluşturmak için bir şube seçin."));
    }
    const params = new URLSearchParams({ branchId: request.scope.branchId });
    return this.request(`/api/v1/firms/${encodeURIComponent(request.scope.firmId)}/catalog/categories?${params}`,
      request.scope, "POST", { id: request.id, name: request.name });
  }

  renameCategory(request: RenameCategoryRequest): Promise<CategoryMutationResult> {
    if (!request.scope.branchId) {
      return Promise.reject(new CatalogProviderError("INVALID_DRAFT", 400, "Kategori düzenlemek için bir şube seçin."));
    }
    const params = new URLSearchParams({ branchId: request.scope.branchId });
    return this.request(`/api/v1/firms/${encodeURIComponent(request.scope.firmId)}/catalog/categories/${encodeURIComponent(request.categoryId)}?${params}`,
      request.scope, "PUT", { name: request.name, expectedVersion: request.expectedVersion });
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

  createPricedProduct(request: CreatePricedProductRequest): Promise<CatalogProductDetail> {
    if (!request.scope.branchId)
      return Promise.reject(new CatalogProviderError("INVALID_DRAFT", 400, "Ürün oluşturmak için bir şube seçin."));
    return this.request(`/api/v1/firms/${encodeURIComponent(request.scope.firmId)}/branches/${encodeURIComponent(request.scope.branchId)}/catalog/products`,
      request.scope, "POST", { draftId: request.draftId, priceVersionId: request.priceVersionId,
        name: request.name, sku: request.sku, categoryId: request.categoryId, categoryName: request.categoryName,
        description: request.description, amountMinor: request.amountMinor, allergens: request.allergens });
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
        allergens: request.allergens,
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

  updatePublishedProduct(request: UpdatePublishedProductRequest): Promise<CatalogProductDetail> {
    if (!request.scope.branchId)
      return Promise.reject(new CatalogProviderError("INVALID_DRAFT", 400, "Ürün düzenlemek için bir şube seçin."));
    return this.request(`${this.historyPath(request.scope, request.draftId)}`, request.scope, "PUT", {
      requestId: request.requestId, name: request.name, sku: request.sku, categoryId: request.categoryId,
      categoryName: request.categoryName, description: request.description, allergens: request.allergens, expectedVersion: request.expectedVersion,
    });
  }

  setPublishedPrice(request: SetDraftPriceRequest): Promise<PriceResult> {
    if (!request.scope.branchId)
      return Promise.reject(new CatalogProviderError("INVALID_DRAFT", 400, "Fiyat için bir şube seçin."));
    return this.request(`${this.historyPath(request.scope, request.draftId)}/price`, request.scope, "PUT", {
      priceVersionId: request.priceVersionId, amountMinor: request.amountMinor, expectedVersion: request.expectedVersion,
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

  setProductActive(request: SetProductActiveRequest): Promise<{ isActive: boolean; version: number }> {
    if (!request.scope.branchId)
      return Promise.reject(new CatalogProviderError("INVALID_DRAFT", 400, "Ürün durumu için şube seçin."));
    return this.request(`/api/v1/firms/${encodeURIComponent(request.scope.firmId)}/branches/${encodeURIComponent(request.scope.branchId)}/catalog/products/${encodeURIComponent(request.productId)}/activation`,
      request.scope, "POST", { requestId: request.requestId, expectedVersion: request.expectedVersion, isActive: request.isActive });
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

  private optionPath(scope: CatalogScope): string {
    return `/api/v1/firms/${encodeURIComponent(scope.firmId)}/catalog/option-groups`;
  }

  async listOptionGroups(scope: CatalogScope): Promise<CatalogOptionGroup[]> {
    const response = await this.request<{ items: CatalogOptionGroup[] }>(this.optionPath(scope), scope);
    return response.items;
  }

  listProductOptionGroups(request: ProductDetailRequest): Promise<ProductOptionGroups> {
    return this.request(`${this.productPath(request.scope)}/${encodeURIComponent(request.productId)}/option-groups`, request.scope);
  }

  createOptionGroup(scope: CatalogScope, input: OptionGroupInput): Promise<CatalogOptionGroup> {
    return this.request(this.optionPath(scope), scope, "POST", input);
  }

  updateOptionGroup(scope: CatalogScope, groupId: string, input: OptionGroupInput & { expectedVersion: number }): Promise<CatalogOptionGroup> {
    return this.request(`${this.optionPath(scope)}/${encodeURIComponent(groupId)}`, scope, "PUT", input);
  }

  createOptionItem(scope: CatalogScope, groupId: string, input: OptionItemInput): Promise<unknown> {
    return this.request(`${this.optionPath(scope)}/${encodeURIComponent(groupId)}/items`, scope, "POST", input);
  }

  updateOptionItem(scope: CatalogScope, groupId: string, itemId: string, input: OptionItemInput): Promise<unknown> {
    return this.request(`${this.optionPath(scope)}/${encodeURIComponent(groupId)}/items/${encodeURIComponent(itemId)}`, scope, "PUT", input);
  }

  saveProductOptionGroups(request: ProductDetailRequest & { requestId: string; expectedVersion: number; items: ProductOptionInput[] }): Promise<ProductOptionGroups> {
    return this.request(`${this.productPath(request.scope)}/${encodeURIComponent(request.productId)}/option-groups`, request.scope, "PUT",
      { requestId: request.requestId, expectedVersion: request.expectedVersion, items: request.items });
  }

  private historyPath(scope: CatalogScope, productId: string): string {
    return `/api/v1/firms/${encodeURIComponent(scope.firmId)}/branches/${encodeURIComponent(scope.branchId!)}/catalog/products/${encodeURIComponent(productId)}`;
  }

  private draftPath(scope: CatalogScope): string {
    return `/api/v1/firms/${encodeURIComponent(scope.firmId)}/branches/${encodeURIComponent(scope.branchId!)}/catalog/drafts`;
  }
}
