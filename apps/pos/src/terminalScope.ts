import { useEffect, useState } from "react";

export const DEFAULT_DEMO_FIRM_ID = "11111111-1111-4111-8111-111111111111";
export const DEFAULT_DEMO_BRANCH_ID = "33333333-3333-4333-8333-333333333333";

export const TERMINAL_SCOPE_STORAGE_KEY = "hipos_terminal_scope";
export const POS_AUTH_CHANGED_EVENT = "hipos:pos-auth-changed";
export const POS_SCOPE_CHANGED_EVENT = "hipos:pos-scope-changed";

export const POS_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export type PosAppKind = "cashier" | "waiter" | "kitchen" | "pos";

export interface PosUser {
  id: string;
  fullName: string;
  role: string;
  firmId?: string | null;
  branchId?: string | null;
}

export interface PosSession {
  token: string;
  user: PosUser;
}

export interface TerminalScope {
  firmId: string;
  branchId: string;
  firmName?: string;
  branchName?: string;
  isConfigured: boolean;
}

interface StoredScopePayload {
  firmId: string;
  branchId: string;
  firmName?: string;
  branchName?: string;
}

export function getPosAppKind(pathname?: string): PosAppKind {
  const path = pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/");
  if (path.startsWith("/waiter")) return "waiter";
  if (path.startsWith("/kitchen")) return "kitchen";
  if (path.startsWith("/cashier")) return "cashier";
  return "pos";
}

function getStorageKeys(appKind: PosAppKind) {
  return {
    tokenKey: `hipos_${appKind}_token`,
    userKey: `hipos_${appKind}_user`,
  };
}

function isJwtExpired(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    if (typeof payload.exp !== "number") return false;
    // Allow small clock skew only after expiration; if clearly past exp, lock immediately
    return payload.exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}

export function getPosSession(appKind: PosAppKind = getPosAppKind()): PosSession | null {
  if (typeof window === "undefined") return null;
  const { tokenKey, userKey } = getStorageKeys(appKind);
  const token = window.localStorage.getItem(tokenKey);
  const rawUser = window.localStorage.getItem(userKey);
  if (!token || !rawUser) return null;

  if (isJwtExpired(token)) {
    window.localStorage.removeItem(tokenKey);
    window.localStorage.removeItem(userKey);
    return null;
  }

  try {
    const user = JSON.parse(rawUser) as PosUser;
    if (!user || typeof user.id !== "string" || typeof user.role !== "string") {
      return null;
    }
    return { token, user };
  } catch {
    return null;
  }
}

export function getPosToken(appKind: PosAppKind = getPosAppKind()): string | null {
  return getPosSession(appKind)?.token ?? null;
}

export function savePosSession(appKind: PosAppKind, session: PosSession): void {
  if (typeof window === "undefined") return;
  const { tokenKey, userKey } = getStorageKeys(appKind);
  window.localStorage.setItem(tokenKey, session.token);
  window.localStorage.setItem(userKey, JSON.stringify(session.user));
  window.dispatchEvent(new CustomEvent(POS_AUTH_CHANGED_EVENT, { detail: { appKind } }));
}

export function clearPosSession(appKind: PosAppKind = getPosAppKind(), notify = true): void {
  if (typeof window === "undefined") return;
  const { tokenKey, userKey } = getStorageKeys(appKind);
  window.localStorage.removeItem(tokenKey);
  window.localStorage.removeItem(userKey);
  if (notify) {
    window.dispatchEvent(new CustomEvent(POS_AUTH_CHANGED_EVENT, { detail: { appKind } }));
  }
}

export function clearAllPosSessions(notify = true): void {
  const kinds: PosAppKind[] = ["cashier", "waiter", "kitchen", "pos"];
  for (const kind of kinds) {
    clearPosSession(kind, false);
  }
  if (notify && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(POS_AUTH_CHANGED_EVENT, { detail: { appKind: "all" } }));
  }
}

function readStoredScope(): StoredScopePayload | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(TERMINAL_SCOPE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredScopePayload>;
    if (typeof parsed.firmId === "string" && parsed.firmId.trim() && typeof parsed.branchId === "string" && parsed.branchId.trim()) {
      return {
        firmId: parsed.firmId.trim(),
        branchId: parsed.branchId.trim(),
        firmName: typeof parsed.firmName === "string" ? parsed.firmName : undefined,
        branchName: typeof parsed.branchName === "string" ? parsed.branchName : undefined,
      };
    }
  } catch {
    // ignore invalid localStorage data
  }
  return null;
}

function readUrlScope(): StoredScopePayload | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const firmId = (params.get("firmId") ?? params.get("firm") ?? "").trim();
  const branchId = (params.get("branchId") ?? params.get("branch") ?? "").trim();
  if (!firmId || !branchId) return null;

  const firmName = (params.get("firmName") ?? "").trim() || undefined;
  const branchName = (params.get("branchName") ?? "").trim() || undefined;
  return { firmId, branchId, firmName, branchName };
}

export function getTerminalScope(): TerminalScope {
  const urlScope = readUrlScope();
  const stored = readStoredScope();

  if (urlScope) {
    const changed = !stored || stored.firmId !== urlScope.firmId || stored.branchId !== urlScope.branchId;
    if (changed && typeof window !== "undefined") {
      const toStore: StoredScopePayload = {
        firmId: urlScope.firmId,
        branchId: urlScope.branchId,
        firmName: urlScope.firmName ?? (stored?.firmId === urlScope.firmId ? stored.firmName : undefined),
        branchName: urlScope.branchName ?? (stored?.branchId === urlScope.branchId ? stored.branchName : undefined),
      };
      window.localStorage.setItem(TERMINAL_SCOPE_STORAGE_KEY, JSON.stringify(toStore));
      if (stored) {
        clearAllPosSessions(false);
      }
      return { ...toStore, isConfigured: true };
    }
    return {
      firmId: urlScope.firmId,
      branchId: urlScope.branchId,
      firmName: urlScope.firmName ?? stored?.firmName,
      branchName: urlScope.branchName ?? stored?.branchName,
      isConfigured: true,
    };
  }

  if (stored) {
    return { ...stored, isConfigured: true };
  }

  return {
    firmId: DEFAULT_DEMO_FIRM_ID,
    branchId: DEFAULT_DEMO_BRANCH_ID,
    isConfigured: false,
  };
}

export function setTerminalScope(next: StoredScopePayload): TerminalScope {
  const previous = readStoredScope();
  const normalized: StoredScopePayload = {
    firmId: next.firmId.trim(),
    branchId: next.branchId.trim(),
    firmName: next.firmName?.trim() || undefined,
    branchName: next.branchName?.trim() || undefined,
  };

  if (typeof window !== "undefined") {
    const branchChanged = !previous || previous.firmId !== normalized.firmId || previous.branchId !== normalized.branchId;
    window.localStorage.setItem(TERMINAL_SCOPE_STORAGE_KEY, JSON.stringify(normalized));
    if (branchChanged) {
      // Clear cached JWTs when terminal switches branch so previous branch tokens are never reused
      clearAllPosSessions(true);
    }
    window.dispatchEvent(new CustomEvent(POS_SCOPE_CHANGED_EVENT, { detail: normalized }));
  }

  return { ...normalized, isConfigured: true };
}

export function useTerminalScope(): TerminalScope {
  const [scope, setScope] = useState<TerminalScope>(() => getTerminalScope());

  useEffect(() => {
    const refresh = () => setScope(getTerminalScope());
    window.addEventListener(POS_SCOPE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("popstate", refresh);
    return () => {
      window.removeEventListener(POS_SCOPE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("popstate", refresh);
    };
  }, []);

  return scope;
}

export function buildPosTerminalHref(routePath: string, scope: TerminalScope): string {
  if (!scope.isConfigured) return routePath;
  const params = new URLSearchParams();
  params.set("firmId", scope.firmId);
  params.set("branchId", scope.branchId);
  return `${routePath}?${params.toString()}`;
}

export interface PosFetchOptions extends RequestInit {
  appKind?: PosAppKind;
  demoActor?: string;
}

export function buildPosHeaders(options?: {
  appKind?: PosAppKind;
  demoActor?: string;
  hasJsonBody?: boolean;
  extra?: HeadersInit;
}): Headers {
  const headers = new Headers(options?.extra);
  const appKind = options?.appKind ?? getPosAppKind();
  const token = getPosToken(appKind);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    headers.delete("X-Demo-Actor");
  } else if (import.meta.env.DEV && options?.demoActor) {
    headers.set("X-Demo-Actor", options.demoActor);
  }

  if (options?.hasJsonBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

export async function posFetch(pathOrUrl: string, options: PosFetchOptions = {}): Promise<Response> {
  const { appKind: explicitAppKind, demoActor, headers: extraHeaders, ...rest } = options;
  const appKind = explicitAppKind ?? getPosAppKind();
  const tokenBeforeCall = getPosToken(appKind);
  const hasJsonBody = typeof rest.body === "string" && rest.body.length > 0;
  const headers = buildPosHeaders({
    appKind,
    demoActor,
    hasJsonBody,
    extra: extraHeaders,
  });

  const url = pathOrUrl.startsWith("/") ? `${POS_API_BASE}${pathOrUrl}` : pathOrUrl;
  const response = await fetch(url, { ...rest, headers });

  if (response.status === 401 && tokenBeforeCall) {
    clearPosSession(appKind, true);
  }

  return response;
}
