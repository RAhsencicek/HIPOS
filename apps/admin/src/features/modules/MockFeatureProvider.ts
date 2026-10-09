import { scenarios } from "../../data/catalog";
import { featureDefinitions } from "./featureDefinitions";
import { FeatureProviderError } from "./contracts";
import type {
  BranchFeatureState,
  FeatureBlocker,
  FeatureDefinition,
  FeatureProvider,
  FeatureScope,
  SetFeatureDesiredState,
} from "./contracts";

export type MockFeatureMode = "normal" | "unauthorized";

const initiallyDesired = new Set([
  "catalog.products",
  "catalog.pricing",
  "sales.monitoring",
  "branches.tables",
  "staff.records",
  "kitchen.monitoring",
  "reports.sales",
]);

const copyState = (state: BranchFeatureState): BranchFeatureState => ({
  ...state,
  blockers: state.blockers.map((blocker) => ({ ...blocker })),
});

const copyDefinition = (definition: FeatureDefinition): FeatureDefinition => ({
  ...definition,
  dependencies: [...definition.dependencies],
  setupRequirements: definition.setupRequirements && [
    ...definition.setupRequirements,
  ],
});

export class MockFeatureProvider implements FeatureProvider {
  private readonly states = new Map<string, BranchFeatureState>();

  constructor(
    private readonly mode: MockFeatureMode = "normal",
    private readonly delayMs = 70,
  ) {
    for (const scenario of scenarios) {
      for (const branch of scenario.branches) {
        for (const definition of featureDefinitions) {
          const setupPreview =
            branch.id === "moda" && definition.key === "inventory.items";
          const providerPreview =
            branch.id === "moda" && definition.key === "integrations.delivery";
          const drainingPreview =
            branch.id === "atasehir" && definition.key === "kitchen.monitoring";
          const desiredEnabled =
            initiallyDesired.has(definition.key) ||
            setupPreview ||
            providerPreview;
          const lifecycle = drainingPreview
            ? "draining"
            : setupPreview
              ? "setup_required"
              : providerPreview
                ? "provider_pending"
                : desiredEnabled
                  ? "ready"
                  : "disabled";
          const blockers: FeatureBlocker[] = setupPreview
            ? (definition.setupRequirements ?? []).map((message) => ({
                code: "SETUP_REQUIRED",
                message,
              }))
            : providerPreview
              ? [
                  {
                    code: "PROVIDER_PENDING",
                    message: "Yemek platformu bağlantısı henüz kurulmadı.",
                  },
                ]
              : [];
          const state: BranchFeatureState = {
            key: definition.key,
            firmId: scenario.firmId,
            branchId: branch.apiId,
            desiredEnabled: drainingPreview ? false : desiredEnabled,
            effectiveForNewWork: false,
            lifecycle,
            blockers,
            inFlightWorkCount:
              drainingPreview ||
              (branch.id === "moda" && definition.key === "kitchen.monitoring")
                ? 2
                : 0,
            version: 1,
            updatedAt: "2026-10-05T09:30:00Z",
          };
          this.states.set(this.stateKey(state, state.key), state);
        }
      }
    }
  }

  private stateKey(scope: FeatureScope, key: string): string {
    return `${scope.firmId}:${scope.branchId}:${key}`;
  }

  private async wait(): Promise<void> {
    if (this.delayMs)
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }

  private assertScope(scope: FeatureScope): void {
    if (
      this.mode === "unauthorized" ||
      !scenarios.some(
        (scenario) =>
          scenario.firmId === scope.firmId &&
          scenario.branches.some((branch) => branch.apiId === scope.branchId),
      )
    ) {
      throw new FeatureProviderError(
        "UNAUTHORIZED_SCOPE",
        403,
        "Bu firma/şube modül ayarına erişim izni yok.",
      );
    }
  }

  async listDefinitions(): Promise<FeatureDefinition[]> {
    await this.wait();
    return featureDefinitions.map(copyDefinition);
  }

  async listBranchStates(scope: FeatureScope): Promise<BranchFeatureState[]> {
    await this.wait();
    this.assertScope(scope);
    return featureDefinitions.map((definition) =>
      copyState(this.states.get(this.stateKey(scope, definition.key))!),
    );
  }

  async setDesiredEnabled(
    command: SetFeatureDesiredState,
  ): Promise<BranchFeatureState> {
    await this.wait();
    this.assertScope(command);
    const definition = featureDefinitions.find(
      (item) => item.key === command.key,
    );
    const current = this.states.get(this.stateKey(command, command.key));
    if (!definition || !current) {
      throw new FeatureProviderError(
        "FEATURE_NOT_FOUND",
        404,
        "Özellik bulunamadı.",
      );
    }
    if (current.version !== command.expectedVersion) {
      throw new FeatureProviderError(
        "VERSION_CONFLICT",
        409,
        "Ayar başka bir işlemle değişti. Güncel durumu yeniden yükleyin.",
      );
    }
    if (current.lifecycle === "draining") {
      throw new FeatureProviderError(
        "FEATURE_DRAINING",
        409,
        "Devam eden işler bitmeden bu ayar değiştirilemez.",
      );
    }
    if (current.desiredEnabled === command.desiredEnabled)
      return copyState(current);

    if (command.desiredEnabled) {
      const missing = definition.dependencies.filter((key) => {
        const dependency = this.states.get(this.stateKey(command, key));
        return !dependency?.desiredEnabled || dependency.lifecycle !== "ready";
      });
      if (missing.length) {
        throw new FeatureProviderError(
          "DEPENDENCY_NOT_READY",
          409,
          `Önce şu bağımlılıkları açın: ${missing.join(", ")}.`,
        );
      }
    } else {
      const dependents = featureDefinitions.filter(
        (item) =>
          item.dependencies.includes(command.key) &&
          this.states.get(this.stateKey(command, item.key))?.desiredEnabled,
      );
      if (dependents.length) {
        throw new FeatureProviderError(
          "DEPENDENT_ACTIVE",
          409,
          `Önce bağlı özellikleri kapatın: ${dependents.map((item) => item.name).join(", ")}.`,
        );
      }
    }

    const lifecycle = command.desiredEnabled
      ? definition.setupRequirements?.length
        ? "setup_required"
        : definition.providerRequired
          ? "provider_pending"
          : "ready"
      : current.inFlightWorkCount > 0
        ? "draining"
        : "disabled";
    const blockers: FeatureBlocker[] =
      lifecycle === "setup_required"
        ? (definition.setupRequirements ?? []).map((message) => ({
            code: "SETUP_REQUIRED",
            message,
          }))
        : lifecycle === "provider_pending"
          ? [
              {
                code: "PROVIDER_PENDING",
                message: "Sağlayıcı bağlantısı bekleniyor.",
              },
            ]
          : [];
    const next: BranchFeatureState = {
      ...current,
      desiredEnabled: command.desiredEnabled,
      // Bu mock gerçek backend işlemi başlatmaz; hazır önizleme bile fiilen etkin değildir.
      effectiveForNewWork: false,
      lifecycle,
      blockers,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.states.set(this.stateKey(command, command.key), next);
    return copyState(next);
  }
}
