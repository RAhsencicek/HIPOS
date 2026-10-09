export type FeatureAvailability = "real" | "backend_preview" | "prototype" | "planned";
export type FeatureLifecycle =
  | "disabled"
  | "setup_required"
  | "provider_pending"
  | "ready"
  | "draining";

export type FeatureDefinition = {
  key: string;
  name: string;
  category: string;
  description: string;
  scopeType: "branch";
  availability: FeatureAvailability;
  dependencies: string[];
  icon: string;
  setupRequirements?: string[];
  providerRequired?: boolean;
  disableWithParent?: boolean;
};

export type FeatureBlocker = { code: string; message: string };

export type BranchFeatureState = {
  key: string;
  firmId: string;
  branchId: string;
  desiredEnabled: boolean;
  effectiveForNewWork: boolean;
  lifecycle: FeatureLifecycle;
  blockers: FeatureBlocker[];
  inFlightWorkCount: number;
  version: number;
  updatedAt: string;
};

export type FeatureScope = { firmId: string; branchId: string };

export type SetFeatureDesiredState = FeatureScope & {
  key: string;
  desiredEnabled: boolean;
  expectedVersion: number;
};

export type FeatureErrorCode =
  | "LOAD_FAILED"
  | "UNAUTHORIZED_SCOPE"
  | "FEATURE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "DEPENDENCY_NOT_READY"
  | "DEPENDENT_ACTIVE"
  | "FEATURE_DRAINING";

export class FeatureProviderError extends Error {
  constructor(
    public readonly code: FeatureErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FeatureProviderError";
  }
}

export interface FeatureProvider {
  listDefinitions(): Promise<FeatureDefinition[]>;
  listBranchStates(scope: FeatureScope): Promise<BranchFeatureState[]>;
  setDesiredEnabled(
    command: SetFeatureDesiredState,
  ): Promise<BranchFeatureState>;
}
