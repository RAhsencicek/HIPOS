import { useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { scenarios } from "../data/catalog";
import type { ViewContext } from "./context";
import { Shell } from "../layout/AdminShell";
import { Dashboard } from "../features/overview/OverviewPage";
import { RouteView } from "./routes";

export default function App() {
  const [scenarioId, setScenarioId] = useState("single");
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0];
  const [branchId, setBranchId] = useState("all");
  const validBranchId = scenario.branches.some((b) => b.id === branchId)
    ? branchId
    : scenario.branches.length > 1
      ? "all"
      : scenario.branches[0].id;
  const selectedBranch = useMemo(
    () => scenario.branches.find((b) => b.id === validBranchId) ?? null,
    [scenario, validBranchId],
  );
  const ctx: ViewContext = {
    scenarioId,
    firmId: scenario.firmId,
    setScenarioId: (id) => {
      setScenarioId(id);
      setBranchId(id === "single" ? "kadikoy" : "all");
    },
    branchId: validBranchId,
    branchApiId: selectedBranch?.apiId ?? null,
    setBranchId,
    branches: scenario.branches,
    selectedBranch,
    firm: scenario.firm,
    brand: scenario.brand,
    isMulti: scenario.branches.length > 1,
  };
  return (
    <Shell ctx={ctx}>
      <Routes>
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/admin" element={<Dashboard ctx={ctx} />} />
        <Route path="/admin/:section" element={<RouteView ctx={ctx} />} />
        <Route path="/admin/:section/:item" element={<RouteView ctx={ctx} />} />
        <Route
          path="/admin/catalog/products/:productId"
          element={<RouteView ctx={ctx} />}
        />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Shell>
  );
}
