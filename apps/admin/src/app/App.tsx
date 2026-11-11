import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AuthGuard } from "../features/auth/AuthGuard";
import { scenarios, type DemoBranch } from "../data/catalog";
import {
  AUTH_CHANGED_EVENT,
  adminFetch,
  getAuthToken,
  getStoredAuthBranches,
  getStoredAuthFirm,
  getStoredAuthUser,
  saveAuthSession,
  type AuthBranchInfo,
  type AuthFirmInfo,
  type AuthUserInfo,
} from "../shared/authFetch";
import type { ViewContext } from "./context";
import { Shell } from "../layout/AdminShell";
import { Dashboard } from "../features/overview/OverviewPage";
import { RouteView } from "./routes";

function mapBranchesToView(branches: AuthBranchInfo[], firmName: string, user: AuthUserInfo): DemoBranch[] {
  if (branches.length === 0) {
    return [
      {
        id: user.branchId,
        apiId: user.branchId,
        name: "Ana Şube",
        district: firmName,
        brandId: null,
        tables: 0,
        occupied: 0,
        openChecks: 0,
        kitchen: 0,
        sales: 0,
        health: "good",
      },
    ];
  }

  return branches.map((b) => ({
    id: b.id,
    apiId: b.id,
    name: b.name,
    district: b.district || b.code,
    brandId: null,
    tables: 0,
    occupied: 0,
    openChecks: 0,
    kitchen: 0,
    sales: 0,
    health: "good",
  }));
}

export default function App() {
  const [scenarioId, setScenarioId] = useState("single");
  const [branchId, setBranchId] = useState("all");
  const [authState, setAuthState] = useState<{
    token: string | null;
    user: AuthUserInfo | null;
    firm: AuthFirmInfo | null;
    branches: AuthBranchInfo[];
  }>(() => ({
    token: getAuthToken(),
    user: getStoredAuthUser(),
    firm: getStoredAuthFirm(),
    branches: getStoredAuthBranches(),
  }));

  useEffect(() => {
    const syncAuth = () => {
      setAuthState({
        token: getAuthToken(),
        user: getStoredAuthUser(),
        firm: getStoredAuthFirm(),
        branches: getStoredAuthBranches(),
      });
    };
    window.addEventListener(AUTH_CHANGED_EVENT, syncAuth);
    window.addEventListener("storage", syncAuth);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, syncAuth);
      window.removeEventListener("storage", syncAuth);
    };
  }, []);

  const refreshAuthSession = useCallback(async () => {
    if (!getAuthToken()) return;
    const res = await adminFetch("/api/v1/auth/me");
    if (!res.ok) return;
    const data = (await res.json()) as {
      user: AuthUserInfo;
      firm?: AuthFirmInfo | null;
      branches?: AuthBranchInfo[];
    };
    saveAuthSession({
      user: data.user,
      firm: data.firm ?? null,
      branches: data.branches ?? [],
    });
  }, []);

  const isRealAuth = Boolean(authState.token && authState.user);

  const switchBranchScope = useCallback(
    async (nextBranchId: string) => {
      setBranchId(nextBranchId);
      if (!isRealAuth || !authState.user || nextBranchId === "all") return;
      try {
        const res = await adminFetch("/api/v1/auth/switch-scope", {
          method: "POST",
          firmId: authState.user.firmId,
          body: JSON.stringify({ firmId: authState.user.firmId, branchId: nextBranchId }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            token: string;
            user: AuthUserInfo;
            firm?: AuthFirmInfo | null;
            branches?: AuthBranchInfo[];
          };
          saveAuthSession({
            token: data.token,
            user: data.user,
            firm: data.firm ?? authState.firm,
            branches: data.branches ?? authState.branches,
          });
        }
      } catch {
        // Ağ geçici kesintisinde yerel seçimle devam edilir
      }
    },
    [isRealAuth, authState.user, authState.firm, authState.branches],
  );

  const ctx = useMemo<ViewContext>(() => {
    if (isRealAuth && authState.user) {
      const firmName = authState.firm?.name ?? "İşletmem";
      const realBranches = mapBranchesToView(authState.branches, firmName, authState.user);
      const isMulti = realBranches.length > 1;
      const validBranchId =
        branchId === "all" && isMulti
          ? "all"
          : realBranches.some((b) => b.id === branchId)
            ? branchId
            : realBranches.some((b) => b.id === authState.user!.branchId)
              ? authState.user!.branchId
              : realBranches[0].id;
      const selectedBranch = realBranches.find((b) => b.id === validBranchId) ?? null;

      return {
        scenarioId: isMulti ? "multi" : "single",
        firmId: authState.user.firmId,
        setScenarioId,
        branchId: validBranchId,
        branchApiId: selectedBranch?.apiId ?? null,
        setBranchId: (id) => {
          void switchBranchScope(id);
        },
        branches: realBranches,
        selectedBranch,
        firm: firmName,
        brand: authState.firm?.brandName ?? null,
        isMulti,
        user: authState.user,
        isRealAuth: true,
        switchBranchScope,
        refreshAuthSession,
      };
    }

    const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0];
    const validBranchId = scenario.branches.some((b) => b.id === branchId)
      ? branchId
      : scenario.branches.length > 1
        ? "all"
        : scenario.branches[0].id;
    const selectedBranch = scenario.branches.find((b) => b.id === validBranchId) ?? null;

    return {
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
      user: null,
      isRealAuth: false,
      refreshAuthSession,
    };
  }, [isRealAuth, authState, branchId, scenarioId, switchBranchScope, refreshAuthSession]);

  return (
    <AuthGuard>
      <Shell ctx={ctx}>
        <Routes>
          <Route path="/" element={<Navigate to="/admin" replace />} />
          <Route path="/admin" element={<Dashboard ctx={ctx} />} />
          <Route path="/admin/catalog/price-versions" element={<Navigate to="/admin/catalog/prices" replace />} />
          <Route path="/admin/catalog/scheduled-prices" element={<Navigate to="/admin/catalog/prices" replace />} />
          <Route path="/admin/catalog/publishing" element={<Navigate to="/admin/catalog/channels" replace />} />
          <Route path="/admin/:section" element={<RouteView ctx={ctx} />} />
          <Route path="/admin/:section/:item" element={<RouteView ctx={ctx} />} />
          <Route path="/admin/catalog/products/:productId" element={<RouteView ctx={ctx} />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Shell>
    </AuthGuard>
  );
}
