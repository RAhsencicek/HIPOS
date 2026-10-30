export type CatalogScope = {
  firmId: string;
  branchId: string | null;
};

export type Money = {
  amountMinor: number;
  currency: "TRY";
};

export type ProductStatus = "draft" | "published";
export type SalesChannel = "pos" | "qr" | "delivery";
export type PriceSource = "central" | "branch_override";

export type CatalogProduct = {
  id: string;
  firmId: string;
  brandId: string | null;
  branchIds: string[];
  name: string;
  sku: string;
  category: { id: string; name: string };
  status: ProductStatus;
  isActive: boolean;
  channels: SalesChannel[];
  image: string;
  recipeLinked: boolean;
  price: Money;
  priceSource: PriceSource;
  updatedAt: string;
  version: number;
};

export type CatalogProductDetail = CatalogProduct & {
  description: string;
  allergens: string[];
  optionGroups: string[];
};

export type PageInfo = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type ProductListRequest = {
  scope: CatalogScope;
  query?: string;
  categoryId?: string;
  page: number;
  pageSize: number;
};

export type ProductListResponse = {
  items: CatalogProduct[];
  pageInfo: PageInfo;
  scope: CatalogScope;
  categories: Array<{ id: string; name: string }>;
};

export type CategoryListResponse = {
  scope: CatalogScope;
  items: Array<{ id: string; name: string; productCount: number; version?: number; isActive?: boolean; sortOrder?: number }>;
};

export type CategoryMutationResult = { id: string; name: string; version: number; isActive: boolean; sortOrder: number };
export type CreateCategoryRequest = { scope: CatalogScope; id: string; name: string };
export type RenameCategoryRequest = { scope: CatalogScope; categoryId: string; name: string; expectedVersion: number };

export type ProductDetailRequest = {
  scope: CatalogScope;
  productId: string;
};

export type DraftFields = {
  name: string;
  sku: string;
  categoryId: string;
  categoryName: string;
  description: string;
  allergens?: string[];
};

export type CreateDraftRequest = DraftFields & {
  scope: CatalogScope;
  draftId: string;
};
export type CreatePricedProductRequest = CreateDraftRequest & { priceVersionId: string; amountMinor: number };

export type UpdateDraftRequest = DraftFields & {
  scope: CatalogScope;
  draftId: string;
  expectedVersion: number;
};
export type UpdatePublishedProductRequest = UpdateDraftRequest & { requestId: string };

export type PriceVersion = {
  id: string;
  productId: string;
  number: number;
  amountMinor: number;
  currency: "TRY";
  createdAt: string;
};

export type Publication = {
  id: string;
  productId: string;
  number: number;
  priceVersionId: string;
  amountMinor: number;
  currency: "TRY";
  channels: SalesChannel[];
  publishedAt: string;
};

export type SetDraftPriceRequest = {
  scope: CatalogScope;
  draftId: string;
  priceVersionId: string;
  amountMinor: number;
  expectedVersion: number;
};

export type PublishDraftRequest = {
  scope: CatalogScope;
  draftId: string;
  publicationId: string;
  expectedVersion: number;
};

export type SetProductActiveRequest = {
  scope: CatalogScope;
  productId: string;
  requestId: string;
  expectedVersion: number;
  isActive: boolean;
};

export type PriceResult = { product: CatalogProductDetail; priceVersion: PriceVersion };
export type PublicationResult = { product: CatalogProductDetail; publication: Publication };

export type CatalogOptionItem = { id: string; name: string; priceDeltaMinor: number; quantityEnabled: boolean; maxQuantity: number; isActive: boolean; sortOrder: number };
export type CatalogOptionGroup = { id: string; name: string; isActive: boolean; sortOrder: number; version: number; items: CatalogOptionItem[] };
export type ProductOptionGroup = { groupId: string; name: string; isActive: boolean; minSelections: number; maxSelections: number | null; sortOrder: number; groupVersion: number; items: CatalogOptionItem[] };
export type ProductOptionGroups = { productId: string; productVersion: number; items: ProductOptionGroup[] };
export type OptionGroupInput = { requestId: string; name: string; isActive: boolean; sortOrder: number };
export type OptionItemInput = { requestId: string; name: string; priceDeltaMinor: number; quantityEnabled: boolean; maxQuantity: number; isActive: boolean; sortOrder: number; expectedVersion: number };
export type ProductOptionInput = { groupId: string; minSelections: number; maxSelections: number | null; sortOrder: number };

export interface CatalogProvider {
  listProducts(request: ProductListRequest): Promise<ProductListResponse>;
  listCategories(scope: CatalogScope): Promise<CategoryListResponse>;
  createCategory(request: CreateCategoryRequest): Promise<CategoryMutationResult>;
  renameCategory(request: RenameCategoryRequest): Promise<CategoryMutationResult>;
  getProduct(request: ProductDetailRequest): Promise<CatalogProductDetail>;
  createDraft(request: CreateDraftRequest): Promise<CatalogProductDetail>;
  createPricedProduct(request: CreatePricedProductRequest): Promise<CatalogProductDetail>;
  updateDraft(request: UpdateDraftRequest): Promise<CatalogProductDetail>;
  updatePublishedProduct(request: UpdatePublishedProductRequest): Promise<CatalogProductDetail>;
  setDraftPrice(request: SetDraftPriceRequest): Promise<PriceResult>;
  setPublishedPrice(request: SetDraftPriceRequest): Promise<PriceResult>;
  publishDraft(request: PublishDraftRequest): Promise<PublicationResult>;
  setProductActive(request: SetProductActiveRequest): Promise<{ isActive: boolean; version: number }>;
  listPriceVersions(request: ProductDetailRequest): Promise<PriceVersion[]>;
  listPublications(request: ProductDetailRequest): Promise<Publication[]>;
  listOptionGroups(scope: CatalogScope): Promise<CatalogOptionGroup[]>;
  listProductOptionGroups(request: ProductDetailRequest): Promise<ProductOptionGroups>;
  createOptionGroup(scope: CatalogScope, input: OptionGroupInput): Promise<CatalogOptionGroup>;
  updateOptionGroup(scope: CatalogScope, groupId: string, input: OptionGroupInput & { expectedVersion: number }): Promise<CatalogOptionGroup>;
  createOptionItem(scope: CatalogScope, groupId: string, input: OptionItemInput): Promise<unknown>;
  updateOptionItem(scope: CatalogScope, groupId: string, itemId: string, input: OptionItemInput): Promise<unknown>;
  saveProductOptionGroups(request: ProductDetailRequest & { requestId: string; expectedVersion: number; items: ProductOptionInput[] }): Promise<ProductOptionGroups>;
}

export type CatalogErrorCode =
  | "UNAUTHORIZED_SCOPE"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_INACTIVE"
  | "FEATURE_DISABLED"
  | "FEATURE_SETUP_REQUIRED"
  | "PROVIDER_PENDING"
  | "CATALOG_STORAGE_UNAVAILABLE"
  | "DRAFT_NOT_AVAILABLE"
  | "DRAFT_ID_CONFLICT"
  | "DUPLICATE_DRAFT_OR_SKU"
  | "DUPLICATE_SKU"
  | "INVALID_DRAFT"
  | "INVALID_VERSION"
  | "VERSION_CONFLICT"
  | "INVALID_PRICE"
  | "PRICE_REQUIRED"
  | "DRAFT_NOT_FOUND"
  | "PRICE_VERSION_CONFLICT"
  | "PUBLICATION_CONFLICT"
  | "REQUEST_ID_CONFLICT"
  | "FEATURE_DRAINING"
  | "UNAUTHENTICATED"
  | "LOAD_FAILED"
  | "MOCK_FAILURE";

export class CatalogProviderError extends Error {
  constructor(
    public readonly code: CatalogErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CatalogProviderError";
  }
}
