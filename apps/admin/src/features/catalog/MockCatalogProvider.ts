import { catalogIds, catalogRecords } from "./catalog.fixtures";
import type { CatalogProductRecord } from "./catalog.fixtures";
import { CatalogProviderError } from "./contracts";
import type {
  CatalogProduct,
  CategoryListResponse,
  CatalogProductDetail,
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

export type MockCatalogMode =
  | "normal"
  | "empty"
  | "error"
  | "unauthorized"
  | "disabled"
  | "setup_required"
  | "provider_pending";

export class MockCatalogProvider implements CatalogProvider {
  constructor(
    private readonly mode: MockCatalogMode = "normal",
    private readonly delayMs = 90,
  ) {}

  private async wait(): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
  }

  private validate(scope: CatalogScope): void {
    if (this.mode === "error") {
      throw new CatalogProviderError(
        "MOCK_FAILURE",
        503,
        "Örnek veri yüklenemedi.",
      );
    }
    if (this.mode === "unauthorized") {
      throw new CatalogProviderError(
        "UNAUTHORIZED_SCOPE",
        403,
        "Bu kapsama erişim izni yok.",
      );
    }
    if (this.mode === "disabled") {
      throw new CatalogProviderError(
        "FEATURE_DISABLED",
        409,
        "Ürün ve Menü özelliği bu şubede kapalı.",
      );
    }
    if (this.mode === "setup_required") {
      throw new CatalogProviderError(
        "FEATURE_SETUP_REQUIRED",
        409,
        "Önce katalog kurulumunu tamamlayın.",
      );
    }
    if (this.mode === "provider_pending") {
      throw new CatalogProviderError(
        "PROVIDER_PENDING",
        503,
        "Gerekli sağlayıcı bağlantısı bekleniyor.",
      );
    }

    const allowedBranches: Record<string, readonly string[]> = {
      [catalogIds.singleFirm]: [catalogIds.singleBranch],
      [catalogIds.multiFirm]: [
        catalogIds.moda,
        catalogIds.besiktas,
        catalogIds.atasehir,
      ],
    };
    const branches = allowedBranches[scope.firmId];
    if (
      !branches ||
      (scope.branchId !== null && !branches.includes(scope.branchId))
    ) {
      throw new CatalogProviderError(
        "UNAUTHORIZED_SCOPE",
        403,
        "Bu firma/şube kapsamına erişim izni yok.",
      );
    }
  }

  private toProduct(
    record: CatalogProductRecord,
    scope: CatalogScope,
  ): CatalogProduct {
    const branchPrice = scope.branchId
      ? record.branchPrices[scope.branchId]
      : undefined;
    return {
      id: record.id,
      firmId: record.firmId,
      brandId: record.brandId,
      branchIds: [...record.branchIds],
      name: record.name,
      sku: record.sku,
      category: { ...record.category },
      status: record.status,
      channels: [...record.channels],
      image: record.image,
      recipeLinked: record.recipeLinked,
      price: { ...(branchPrice ?? record.basePrice) },
      priceSource: branchPrice ? "branch_override" : "central",
      updatedAt: record.updatedAt,
      version: record.version,
    };
  }

  async listCategories(scope: CatalogScope): Promise<CategoryListResponse> {
    await this.wait();
    this.validate(scope);
    const scoped = this.mode === "empty" ? [] : catalogRecords.filter((record) =>
      record.firmId === scope.firmId &&
      (scope.branchId === null || record.branchIds.includes(scope.branchId)));
    const grouped = new Map<string, CategoryListResponse["items"][number]>();
    for (const record of scoped) {
      const key = `${record.category.id}:${record.category.name}`;
      const current = grouped.get(key);
      if (current) current.productCount++;
      else grouped.set(key, { ...record.category, productCount: 1 });
    }
    return { scope, items: [...grouped.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "tr") || a.id.localeCompare(b.id)) };
  }

  async listProducts(
    request: ProductListRequest,
  ): Promise<ProductListResponse> {
    await this.wait();
    this.validate(request.scope);
    if (
      !Number.isInteger(request.page) ||
      request.page < 1 ||
      !Number.isInteger(request.pageSize) ||
      request.pageSize < 1
    ) {
      throw new RangeError("page ve pageSize pozitif tam sayı olmalı.");
    }
    const firmRecords = catalogRecords.filter(
      (record) => record.firmId === request.scope.firmId,
    );
    const categories = Array.from(
      new Map(
        firmRecords.map((record) => [record.category.id, record.category]),
      ).values(),
    ).map((category) => ({ ...category }));
    const normalizedQuery =
      request.query?.trim().toLocaleLowerCase("tr-TR") ?? "";
    const matching =
      this.mode === "empty"
        ? []
        : firmRecords.filter(
            (record) =>
              (request.scope.branchId === null ||
                record.branchIds.includes(request.scope.branchId)) &&
              (!request.categoryId ||
                record.category.id === request.categoryId) &&
              (!normalizedQuery ||
                `${record.name} ${record.sku}`
                  .toLocaleLowerCase("tr-TR")
                  .includes(normalizedQuery)),
          );
    const start = (request.page - 1) * request.pageSize;
    return {
      items: matching
        .slice(start, start + request.pageSize)
        .map((record) => this.toProduct(record, request.scope)),
      pageInfo: {
        page: request.page,
        pageSize: request.pageSize,
        totalItems: matching.length,
        totalPages: Math.ceil(matching.length / request.pageSize),
      },
      scope: { ...request.scope },
      categories,
    };
  }

  async getProduct(
    request: ProductDetailRequest,
  ): Promise<CatalogProductDetail> {
    await this.wait();
    this.validate(request.scope);
    const record =
      this.mode === "empty"
        ? undefined
        : catalogRecords.find(
            (item) =>
              item.id === request.productId &&
              item.firmId === request.scope.firmId &&
              (request.scope.branchId === null ||
                item.branchIds.includes(request.scope.branchId)),
          );
    if (!record) {
      throw new CatalogProviderError(
        "PRODUCT_NOT_FOUND",
        404,
        "Ürün bu kapsamda bulunamadı.",
      );
    }
    return {
      ...this.toProduct(record, request.scope),
      description: record.description,
      allergens: [...record.allergens],
      optionGroups: [...record.optionGroups],
    };
  }

  createDraft(_request: CreateDraftRequest): Promise<CatalogProductDetail> {
    return Promise.reject(new CatalogProviderError(
      "DRAFT_NOT_AVAILABLE", 409,
      "Bu önizleme gerçek ürün taslağı oluşturmaz. Yerel PostgreSQL API'sini seçin.",
    ));
  }

  updateDraft(_request: UpdateDraftRequest): Promise<CatalogProductDetail> {
    return Promise.reject(new CatalogProviderError(
      "DRAFT_NOT_AVAILABLE", 409,
      "Bu önizleme gerçek ürün taslağı güncellemez. Yerel PostgreSQL API'sini seçin.",
    ));
  }

  setDraftPrice(_request: SetDraftPriceRequest): Promise<PriceResult> {
    return Promise.reject(new CatalogProviderError(
      "DRAFT_NOT_AVAILABLE", 409, "Örnek veri için kalıcı fiyat sürümü oluşturulmaz.",
    ));
  }

  publishDraft(_request: PublishDraftRequest): Promise<PublicationResult> {
    return Promise.reject(new CatalogProviderError(
      "DRAFT_NOT_AVAILABLE", 409, "Örnek veri POS'a gerçekten yayınlanmaz.",
    ));
  }

  async listPriceVersions(request: ProductDetailRequest): Promise<PriceVersion[]> {
    await this.getProduct(request);
    return [];
  }

  async listPublications(request: ProductDetailRequest): Promise<Publication[]> {
    await this.getProduct(request);
    return [];
  }
}
