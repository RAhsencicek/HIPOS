import { useEffect, useState } from "react";
import { useFeatureProvider } from "../../app/providers";
import { FeatureProviderError } from "./contracts";
import type {
  BranchFeatureState,
  FeatureDefinition,
  FeatureScope,
} from "./contracts";

export type FeatureCatalogLoad =
  | { status: "loading" }
  | {
      status: "success";
      definitions: FeatureDefinition[];
      states: BranchFeatureState[];
    }
  | { status: "error"; error: FeatureProviderError };

export function useFeatureCatalog(
  scope: FeatureScope | null,
): FeatureCatalogLoad {
  const { provider, mode, revision } = useFeatureProvider();
  const requestKey = `${mode}:${revision}:${scope?.firmId ?? "none"}:${scope?.branchId ?? "none"}`;
  const [load, setLoad] = useState<{ key: string; value: FeatureCatalogLoad }>({
    key: requestKey,
    value: { status: "loading" },
  });

  useEffect(() => {
    let current = true;
    setLoad({ key: requestKey, value: { status: "loading" } });
    Promise.all([
      provider.listDefinitions(),
      scope ? provider.listBranchStates(scope) : Promise.resolve([]),
    ])
      .then(([definitions, states]) => {
        if (current)
          setLoad({
            key: requestKey,
            value: { status: "success", definitions, states },
          });
      })
      .catch((error: unknown) => {
        if (!current) return;
        const providerError =
          error instanceof FeatureProviderError
            ? error
            : new FeatureProviderError(
                "LOAD_FAILED",
                503,
                "Modül durumu yüklenemedi.",
              );
        setLoad({
          key: requestKey,
          value: { status: "error", error: providerError },
        });
      });
    return () => {
      current = false;
    };
  }, [provider, requestKey, scope?.firmId, scope?.branchId]);

  return load.key === requestKey ? load.value : { status: "loading" };
}
