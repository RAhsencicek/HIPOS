import React, { useEffect, useState } from "react";
import { LoginPage } from "./LoginPage";

interface AuthGuardProps {
    children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

    useEffect(() => {
        // Tarayıcı hafızasında geçerli token var mı kontrol et
        const token = localStorage.getItem("hipos_token");
        setIsAuthenticated(Boolean(token));
    }, []);

    // Sayfa ilk açılırken kontrol aşaması
    if (isAuthenticated === null) {
        return (
            <div style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#0f172a",
                color: "#94a3b8",
                fontFamily: "system-ui, sans-serif"
            }}>
                Oturum kontrol ediliyor...
            </div>
        );
    }

    // Oturum yoksa doğrudan Login sayfasını göster
    if (!isAuthenticated) {
        return <LoginPage onLoginSuccess={() => setIsAuthenticated(true)} />;
    }

    // Oturum varsa yönetim panelinin içeriğini göster
    return <>{children}</>;
}