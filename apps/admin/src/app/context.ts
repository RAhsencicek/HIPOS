import type { DemoBranch } from "../data/catalog";

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
};
