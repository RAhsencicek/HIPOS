import { catalogIds, catalogRecords } from "./catalog.fixtures";
import type { CatalogProductRecord } from "./catalog.fixtures";
import { CatalogProviderError } from "./contracts";
import type {
  CatalogProduct,
  CatalogOptionGroup,
  OptionGroupInput,
  OptionItemInput,
  ProductOptionGroups,
  ProductOptionInput,
  CategoryMutationResult,
  CategoryListResponse,
  CatalogProductDetail,
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
  UpdateDraftRequest,
  UpdatePublishedProductRequest,
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
      isActive: true,
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

  async createCategory(_request: CreateCategoryRequest): Promise<CategoryMutationResult> {
    throw new CatalogProviderError("MOCK_FAILURE", 501, "Örnek veride kategori kaydı yapılamaz.");
  }

  async renameCategory(_request: RenameCategoryRequest): Promise<CategoryMutationResult> {
    throw new CatalogProviderError("MOCK_FAILURE", 501, "Örnek veride kategori adı değiştirilemez.");
  }

  async setPublishedPrice(_request: SetDraftPriceRequest): Promise<PriceResult> {
    throw new CatalogProviderError("MOCK_FAILURE", 501, "Örnek veride fiyat değiştirilemez.");
  }

  async listOptionGroups(_scope: CatalogScope): Promise<CatalogOptionGroup[]> { throw new CatalogProviderError("MOCK_FAILURE", 501, "Örnek veride seçenek grupları yönetilemez."); }
  async listProductOptionGroups(_request: ProductDetailRequest): Promise<ProductOptionGroups> { throw new CatalogProviderError("MOCK_FAILURE", 501, "Örnek veride seçenek grupları yönetilemez."); }
  async createOptionGroup(_scope: CatalogScope, _input: OptionGroupInput): Promise<CatalogOptionGroup> { throw new CatalogProviderError("MOCK_FAILURE", 501, "Örnek veride seçenek grubu kaydedilemez."); }
  async updateOptionGroup(_scope: CatalogScope, _id: string, _input: OptionGroupInput & { expectedVersion: number }): Promise<CatalogOptionGroup> { throw new CatalogProviderError("MOCK_FAILURE", 501, "Örnek veride seçenek grubu kaydedilemez."); }
  async createOptionItem(_scope: CatalogScope, _id: string, _input: OptionItemInput): Promise<unknown> { throw new CatalogProviderError("MOCK_FAILURE", 501, "Örnek veride seçenek kaydedilemez."); }
  async updateOptionItem(_scope: CatalogScope, _groupId: string, _itemId: string, _input: OptionItemInput): Promise<unknown> { throw new CatalogProviderError("MOCK_FAILURE", 501, "Örnek veride seçenek kaydedilemez."); }
  async saveProductOptionGroups(_request: ProductDetailRequest & { requestId: string; expectedVersion: number; items: ProductOptionInput[] }): Promise<ProductOptionGroups> { throw new CatalogProviderError("MOCK_FAILURE", 501, "Örnek veride ürün seçenekleri kaydedilemez."); }

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
    const scopedRecords = firmRecords.filter(record =>
      request.scope.branchId === null || record.branchIds.includes(request.scope.branchId));
    const categories = Array.from(
      new Map(
        scopedRecords.map((record) => [record.category.id, record.category]),
      ).values(),
    ).map((category) => ({ ...category }));
    const normalizedQuery =
      request.query?.trim().toLocaleLowerCase("tr-TR") ?? "";
    const matching =
      this.mode === "empty"
        ? []
        : scopedRecords.filter(
            (record) =>
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
      "Örnek görünümde ürün taslağı kaydedilemez. Kayıt işlemleri için katalog bağlantısı gerekiyor.",
    ));
  }

  createPricedProduct(_request: CreatePricedProductRequest): Promise<CatalogProductDetail> {
    return Promise.reject(new CatalogProviderError("DRAFT_NOT_AVAILABLE", 409, "Örnek veride ürün kaydedilemez."));
  }

  updateDraft(_request: UpdateDraftRequest): Promise<CatalogProductDetail> {
    return Promise.reject(new CatalogProviderError(
      "DRAFT_NOT_AVAILABLE", 409,
      "Örnek görünümde ürün taslağı düzenlenemez. Kayıt işlemleri için katalog bağlantısı gerekiyor.",
    ));
  }

  updatePublishedProduct(_request: UpdatePublishedProductRequest): Promise<CatalogProductDetail> {
    return Promise.reject(new CatalogProviderError("DRAFT_NOT_AVAILABLE", 409, "Örnek veride ürün düzenlenemez."));
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

  setProductActive(_request: import("./contracts").SetProductActiveRequest): Promise<{ isActive: boolean; version: number }> {
    return Promise.reject(new CatalogProviderError("FEATURE_DISABLED", 409,
      "Örnek gösterimde ürün durumu değiştirilmez; kalıcı kayıt için HTTP katalog sağlayıcısını kullanın."));
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
