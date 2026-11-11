import type { DemoBranch } from "../data/catalog";
import type { AuthUserInfo } from "../shared/authFetch";

export type ViewContext = {
  scenarioId: string;
  firmId: string;
  setScenarioId: (id: string) => void;
  branchId: string;
  branchApiId: string | null;
  setBranchId: (id: string) => void;
  branches: DemoBranch[];
  selectedBranch: DemoBranch | null;
  firm: string;
  brand: string | null;
  isMulti: boolean;
  user?: AuthUserInfo | null;
  isRealAuth?: boolean;
  switchBranchScope?: (branchId: string) => Promise<void>;
  refreshAuthSession?: () => Promise<void>;
};
