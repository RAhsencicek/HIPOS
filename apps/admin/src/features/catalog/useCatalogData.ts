import { useEffect, useState } from "react";
import { useCatalogProvider } from "../../app/providers";
import { CatalogProviderError } from "./contracts";
import type {
  CatalogProductDetail,
  CategoryListResponse,
  CatalogScope,
  ProductListResponse,
} from "./contracts";

export type CatalogLoad<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: CatalogProviderError };

function asCatalogError(error: unknown): CatalogProviderError {
  return error instanceof CatalogProviderError
    ? error
    : new CatalogProviderError("MOCK_FAILURE", 503, "Ürün verisi yüklenemedi.");
}

export function useProductList(
  scope: CatalogScope,
  query: string,
  categoryId: string | undefined,
): CatalogLoad<ProductListResponse> {
  const { provider, mode, revision } = useCatalogProvider();
  const requestKey = `${mode}:${revision}:${scope.firmId}:${scope.branchId ?? "all"}:${query}:${categoryId ?? "all"}`;
  const [load, setLoad] = useState<{
    key: string;
    value: CatalogLoad<ProductListResponse>;
  }>({
    key: requestKey,
    value: { status: "loading" },
  });

  useEffect(() => {
    let current = true;
    setLoad({ key: requestKey, value: { status: "loading" } });
    provider
      .listProducts({ scope, query, categoryId, page: 1, pageSize: 25 })
      .then((data) => {
        if (current)
          setLoad({ key: requestKey, value: { status: "success", data } });
      })
      .catch((error: unknown) => {
        if (current)
          setLoad({
            key: requestKey,
            value: { status: "error", error: asCatalogError(error) },
          });
      });
    return () => {
      current = false;
    };
  }, [provider, requestKey, scope.firmId, scope.branchId, query, categoryId]);

  return load.key === requestKey ? load.value : { status: "loading" };
}

export function useCategoryList(scope: CatalogScope): CatalogLoad<CategoryListResponse> {
  const { provider, mode, revision } = useCatalogProvider();
  const requestKey = `${mode}:${revision}:${scope.firmId}:${scope.branchId ?? "all"}:categories`;
  const [load, setLoad] = useState<{
    key: string;
    value: CatalogLoad<CategoryListResponse>;
  }>({ key: requestKey, value: { status: "loading" } });

  useEffect(() => {
    let current = true;
    setLoad({ key: requestKey, value: { status: "loading" } });
    provider.listCategories(scope).then((data) => {
      if (current) setLoad({ key: requestKey, value: { status: "success", data } });
    }).catch((error: unknown) => {
      if (current) setLoad({ key: requestKey, value: { status: "error", error: asCatalogError(error) } });
    });
    return () => { current = false; };
  }, [provider, requestKey, scope.firmId, scope.branchId]);

  return load.key === requestKey ? load.value : { status: "loading" };
}

export function useProductDetail(
  scope: CatalogScope,
  productId: string,
): CatalogLoad<CatalogProductDetail> {
  const { provider, mode, revision } = useCatalogProvider();
  const requestKey = `${mode}:${revision}:${scope.firmId}:${scope.branchId ?? "all"}:${productId}`;
  const [load, setLoad] = useState<{
    key: string;
    value: CatalogLoad<CatalogProductDetail>;
  }>({
    key: requestKey,
    value: { status: "loading" },
  });

  useEffect(() => {
    let current = true;
    setLoad({ key: requestKey, value: { status: "loading" } });
    provider
      .getProduct({ scope, productId })
      .then((data) => {
        if (current)
          setLoad({ key: requestKey, value: { status: "success", data } });
      })
      .catch((error: unknown) => {
        if (current)
          setLoad({
            key: requestKey,
            value: { status: "error", error: asCatalogError(error) },
          });
      });
    return () => {
      current = false;
    };
  }, [provider, requestKey, scope.firmId, scope.branchId, productId]);

  return load.key === requestKey ? load.value : { status: "loading" };
}
