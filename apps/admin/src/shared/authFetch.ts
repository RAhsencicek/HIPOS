export interface AuthFirmInfo {
  id: string;
  code: string;
  name: string;
  brandName?: string | null;
}

export interface AuthBranchInfo {
  id: string;
  firmId: string;
  code: string;
  name: string;
  district: string;
}

export interface AuthUserInfo {
  id: string;
  email: string;
  fullName: string;
  role: string;
  firmId: string;
  branchId: string;
  phone?: string | null;
  isPlatformAdmin?: boolean;
}

export interface AuthSessionPayload {
  token?: string;
  user?: AuthUserInfo | null;
  firm?: AuthFirmInfo | null;
  branches?: AuthBranchInfo[] | null;
}

export const AUTH_CHANGED_EVENT = "hipos:auth-changed";

const TOKEN_KEY = "hipos_token";
const USER_KEY = "hipos_user";
const FIRM_KEY = "hipos_firm";
const BRANCHES_KEY = "hipos_branches";

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function getAuthToken(): string | null {
  return safeStorage()?.getItem(TOKEN_KEY) || null;
}

export function getStoredAuthUser(): AuthUserInfo | null {
  const raw = safeStorage()?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUserInfo;
  } catch {
    return null;
  }
}

export function getStoredAuthFirm(): AuthFirmInfo | null {
  const raw = safeStorage()?.getItem(FIRM_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthFirmInfo;
  } catch {
    return null;
  }
}

export function getStoredAuthBranches(): AuthBranchInfo[] {
  const raw = safeStorage()?.getItem(BRANCHES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuthBranchInfo[]) : [];
  } catch {
    return [];
  }
}

export function saveAuthSession(payload: AuthSessionPayload): void {
  const storage = safeStorage();
  if (!storage) return;
  if (payload.token !== undefined) {
    if (payload.token) storage.setItem(TOKEN_KEY, payload.token);
    else storage.removeItem(TOKEN_KEY);
  }
  if (payload.user !== undefined) {
    if (payload.user) storage.setItem(USER_KEY, JSON.stringify(payload.user));
    else storage.removeItem(USER_KEY);
  }
  if (payload.firm !== undefined) {
    if (payload.firm) storage.setItem(FIRM_KEY, JSON.stringify(payload.firm));
    else storage.removeItem(FIRM_KEY);
  }
  if (payload.branches !== undefined) {
    if (payload.branches) storage.setItem(BRANCHES_KEY, JSON.stringify(payload.branches));
    else storage.removeItem(BRANCHES_KEY);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  }
}

export function clearAuthSession(): void {
  const storage = safeStorage();
  if (storage) {
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(USER_KEY);
    storage.removeItem(FIRM_KEY);
    storage.removeItem(BRANCHES_KEY);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  }
}

export function getDemoFallbackActor(firmId?: string): string {
  return firmId === "11111111-1111-4111-8111-111111111111"
    ? "manager-single"
    : "manager-multi";
}

export function buildAuthHeaders(options?: {
  firmId?: string;
  demoActor?: string;
  headers?: HeadersInit;
  hasJsonBody?: boolean;
}): Record<string, string> {
  const merged: Record<string, string> = {};
  if (options?.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((value, key) => {
        merged[key] = value;
      });
    } else if (Array.isArray(options.headers)) {
      for (const [key, value] of options.headers) {
        merged[key] = value;
      }
    } else {
      Object.assign(merged, options.headers);
    }
  }

  if (options?.hasJsonBody && !Object.keys(merged).some((k) => k.toLowerCase() === "content-type")) {
    merged["Content-Type"] = "application/json";
  }

  const token = getAuthToken();
  if (token) {
    merged["Authorization"] = `Bearer ${token}`;
  } else {
    merged["X-Demo-Actor"] = options?.demoActor ?? getDemoFallbackActor(options?.firmId);
  }

  return merged;
}

export function apiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = import.meta.env.VITE_API_BASE_URL ?? "";
  return `${base}${pathOrUrl}`;
}

export async function adminFetch(
  pathOrUrl: string,
  init?: RequestInit & { firmId?: string; demoActor?: string },
): Promise<Response> {
  const { firmId, demoActor, headers: rawHeaders, ...rest } = init ?? {};
  const hasJsonBody = typeof rest.body === "string";
  const headers = buildAuthHeaders({
    firmId,
    demoActor,
    headers: rawHeaders,
    hasJsonBody,
  });

  const response = await fetch(apiUrl(pathOrUrl), { ...rest, headers });
  if (response.status === 401 && getAuthToken()) {
    clearAuthSession();
  }
  return response;
}
