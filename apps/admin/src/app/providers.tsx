import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { MockCatalogProvider } from "../features/catalog/MockCatalogProvider";
import { HttpCatalogProvider } from "../features/catalog/HttpCatalogProvider";
import type { MockCatalogMode } from "../features/catalog/MockCatalogProvider";
import type { CatalogProvider } from "../features/catalog/contracts";
import { MockFeatureProvider } from "../features/modules/MockFeatureProvider";
import { HttpFeatureProvider } from "../features/modules/HttpFeatureProvider";
import type { MockFeatureMode } from "../features/modules/MockFeatureProvider";
import type { FeatureProvider } from "../features/modules/contracts";

const modes: MockCatalogMode[] = [
  "normal",
  "empty",
  "error",
  "unauthorized",
  "disabled",
  "setup_required",
  "provider_pending",
];

type CatalogProviderValue = {
  provider: CatalogProvider;
  mode: MockCatalogMode;
  source: "mock" | "http";
  revision: number;
  notifyChange: () => void;
};
const CatalogContext = createContext<CatalogProviderValue | null>(null);
type FeatureProviderValue = {
  provider: FeatureProvider;
  mode: MockFeatureMode;
  source: "mock" | "http";
  revision: number;
  notifyChange: () => void;
};
const FeatureContext = createContext<FeatureProviderValue | null>(null);

export function AppProviders({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const requestedMode = searchParams.get(
    "catalogState",
  ) as MockCatalogMode | null;
  const mode =
    requestedMode && modes.includes(requestedMode) ? requestedMode : "normal";
  const catalogSource =
    import.meta.env.VITE_CATALOG_PROVIDER === "http" && mode === "normal"
      ? "http"
      : "mock";
  const provider = useMemo<CatalogProvider>(
    () => catalogSource === "http" ? new HttpCatalogProvider() : new MockCatalogProvider(mode),
    [catalogSource, mode],
  );
  const featureMode: MockFeatureMode =
    searchParams.get("featureState") === "unauthorized"
      ? "unauthorized"
      : "normal";
  const source =
    import.meta.env.VITE_FEATURE_PROVIDER === "http" && featureMode === "normal"
      ? "http"
      : "mock";
  const featureProvider = useMemo<FeatureProvider>(
    () =>
      source === "http"
        ? new HttpFeatureProvider()
        : new MockFeatureProvider(featureMode),
    [source, featureMode],
  );
  const [revision, setRevision] = useState(0);
  const notifyChange = useCallback(() => setRevision((value) => value + 1), []);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const notifyCatalogChange = useCallback(() => setCatalogRevision((value) => value + 1), []);

  return (
    <CatalogContext.Provider value={{ provider, mode, source: catalogSource, revision: catalogRevision, notifyChange: notifyCatalogChange }}>
      <FeatureContext.Provider
        value={{
          provider: featureProvider,
          mode: featureMode,
          source,
          revision,
          notifyChange,
        }}
      >
        {children}
      </FeatureContext.Provider>
    </CatalogContext.Provider>
  );
}

export function useCatalogProvider(): CatalogProviderValue {
  const value = useContext(CatalogContext);
  if (!value) throw new Error("CatalogProvider bağlamı bulunamadı.");
  return value;
}

export function useFeatureProvider(): FeatureProviderValue {
  const value = useContext(FeatureContext);
  if (!value) throw new Error("FeatureProvider bağlamı bulunamadı.");
  return value;
}
