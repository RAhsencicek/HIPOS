import React, { useEffect, useRef, useState } from "react";
import {
  AUTH_CHANGED_EVENT,
  apiUrl,
  clearAuthSession,
  getAuthToken,
  getStoredAuthUser,
  saveAuthSession,
  type AuthBranchInfo,
  type AuthFirmInfo,
  type AuthUserInfo,
} from "../../shared/authFetch";
import { LoginPage } from "./LoginPage";

interface AuthGuardProps {
  children: React.ReactNode;
}

interface AuthMePayload {
  user: AuthUserInfo;
  firm?: AuthFirmInfo | null;
  branches?: AuthBranchInfo[];
}

export function AuthGuard({ children }: AuthGuardProps) {
  const [status, setStatus] = useState<"checking" | "authenticated" | "unauthenticated">(() =>
    getAuthToken() ? "checking" : "unauthenticated",
  );
  const verifiedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    async function verifySession() {
      const token = getAuthToken();
      if (!token) {
        verifiedTokenRef.current = null;
        if (active) setStatus("unauthenticated");
        return;
      }

      if (verifiedTokenRef.current === token) {
        if (active) setStatus("authenticated");
        return;
      }

      try {
        const res = await fetch(apiUrl("/api/v1/auth/me"), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!active) return;

        if (res.status === 401 || res.status === 403) {
          verifiedTokenRef.current = null;
          clearAuthSession();
          setStatus("unauthenticated");
          return;
        }

        if (res.ok) {
          const me = (await res.json()) as AuthMePayload;
          verifiedTokenRef.current = token;
          saveAuthSession({
            user: me.user,
            firm: me.firm ?? null,
            branches: me.branches ?? [],
          });
          setStatus("authenticated");
          return;
        }
      } catch {
        // Ağ geçici kapalıysa mevcut kayıtlı kullanıcı oturumuyla devam edilebilir; 401 değildir.
      }

      if (!active) return;
      if (getStoredAuthUser()) {
        verifiedTokenRef.current = token;
        setStatus("authenticated");
      } else {
        setStatus("unauthenticated");
      }
    }

    void verifySession();

    const handleChange = () => {
      const token = getAuthToken();
      if (!token) {
        verifiedTokenRef.current = null;
        setStatus("unauthenticated");
      } else {
        void verifySession();
      }
    };

    window.addEventListener(AUTH_CHANGED_EVENT, handleChange);
    window.addEventListener("storage", handleChange);
    return () => {
      active = false;
      window.removeEventListener(AUTH_CHANGED_EVENT, handleChange);
      window.removeEventListener("storage", handleChange);
    };
  }, []);

  if (status === "checking") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0f172a",
          color: "#94a3b8",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Oturum doğrulanıyor...
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <LoginPage
        onLoginSuccess={(data) => {
          verifiedTokenRef.current = data.token;
          setStatus("authenticated");
        }}
      />
    );
  }

  return <>{children}</>;
}
