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
  items: Array<{ id: string; name: string; productCount: number }>;
};

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
};

export type CreateDraftRequest = DraftFields & {
  scope: CatalogScope;
  draftId: string;
};

export type UpdateDraftRequest = DraftFields & {
  scope: CatalogScope;
  draftId: string;
  expectedVersion: number;
};

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

export type PriceResult = { product: CatalogProductDetail; priceVersion: PriceVersion };
export type PublicationResult = { product: CatalogProductDetail; publication: Publication };

export interface CatalogProvider {
  listProducts(request: ProductListRequest): Promise<ProductListResponse>;
  listCategories(scope: CatalogScope): Promise<CategoryListResponse>;
  getProduct(request: ProductDetailRequest): Promise<CatalogProductDetail>;
  createDraft(request: CreateDraftRequest): Promise<CatalogProductDetail>;
  updateDraft(request: UpdateDraftRequest): Promise<CatalogProductDetail>;
  setDraftPrice(request: SetDraftPriceRequest): Promise<PriceResult>;
  publishDraft(request: PublishDraftRequest): Promise<PublicationResult>;
  listPriceVersions(request: ProductDetailRequest): Promise<PriceVersion[]>;
  listPublications(request: ProductDetailRequest): Promise<Publication[]>;
}

export type CatalogErrorCode =
  | "UNAUTHORIZED_SCOPE"
  | "PRODUCT_NOT_FOUND"
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
