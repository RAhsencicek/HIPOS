import React, { useState } from "react";
import { apiUrl, saveAuthSession, type AuthBranchInfo, type AuthFirmInfo, type AuthUserInfo } from "../../shared/authFetch";

interface LoginResponse {
    token: string;
    user: AuthUserInfo;
    expiresAt: string;
    firm?: AuthFirmInfo | null;
    branches?: AuthBranchInfo[];
}

export function LoginPage({ onLoginSuccess }: { onLoginSuccess?: (data: LoginResponse) => void }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            const response = await fetch(apiUrl("/api/v1/auth/login"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });

            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error("E-posta adresi veya şifre hatalı.");
                }
                throw new Error("Giriş yapılırken bir sunucu hatası oluştu.");
            }

            const data: LoginResponse = await response.json();

            saveAuthSession({
                token: data.token,
                user: data.user,
                firm: data.firm ?? null,
                branches: data.branches ?? [],
            });

            if (onLoginSuccess) {
                onLoginSuccess(data);
            } else {
                window.location.href = "/";
            }
        } catch (err: unknown) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError("Bilinmeyen bir hata oluştu.");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0f172a",
            fontFamily: "system-ui, -apple-system, sans-serif",
            color: "#f8fafc",
            padding: "1rem"
        }}>
            <div style={{
                width: "100%",
                maxWidth: "420px",
                backgroundColor: "#1e293b",
                padding: "2.5rem",
                borderRadius: "1rem",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
                border: "1px solid #334155"
            }}>
                <div style={{ textAlign: "center", marginBottom: "2rem" }}>
                    <div style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "56px",
                        height: "56px",
                        borderRadius: "12px",
                        backgroundColor: "#2563eb",
                        color: "#ffffff",
                        fontSize: "24px",
                        fontWeight: "bold",
                        marginBottom: "1rem"
                    }}>
                        H
                    </div>
                    <h1 style={{ fontSize: "1.75rem", fontWeight: "700", margin: "0 0 0.5rem 0" }}>HIPOS Yönetim Paneli</h1>
                    <p style={{ color: "#94a3b8", fontSize: "0.875rem", margin: 0 }}>
                        Lütfen Şirket Sahibi (Owner) hesabınızla giriş yapın.
                    </p>
                </div>

                {error && (
                    <div style={{
                        backgroundColor: "rgba(239, 68, 68, 0.15)",
                        border: "1px solid #ef4444",
                        color: "#fca5a5",
                        padding: "0.75rem 1rem",
                        borderRadius: "0.5rem",
                        fontSize: "0.875rem",
                        marginBottom: "1.5rem"
                    }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: "1.25rem" }}>
                        <label style={{ display: "block", fontSize: "0.875rem", fontWeight: "500", marginBottom: "0.5rem", color: "#cbd5e1" }}>
                            E-Posta Adresi
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            placeholder="ornek@hipos.local"
                            style={{
                                width: "100%",
                                padding: "0.75rem 1rem",
                                borderRadius: "0.5rem",
                                backgroundColor: "#0f172a",
                                border: "1px solid #334155",
                                color: "#f8fafc",
                                fontSize: "0.95rem",
                                boxSizing: "border-box"
                            }}
                        />
                    </div>

                    <div style={{ marginBottom: "1.5rem" }}>
                        <label style={{ display: "block", fontSize: "0.875rem", fontWeight: "500", marginBottom: "0.5rem", color: "#cbd5e1" }}>
                            Şifre
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            placeholder="••••••••"
                            style={{
                                width: "100%",
                                padding: "0.75rem 1rem",
                                borderRadius: "0.5rem",
                                backgroundColor: "#0f172a",
                                border: "1px solid #334155",
                                color: "#f8fafc",
                                fontSize: "0.95rem",
                                boxSizing: "border-box"
                            }}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            width: "100%",
                            padding: "0.85rem",
                            borderRadius: "0.5rem",
                            backgroundColor: loading ? "#64748b" : "#2563eb",
                            color: "#ffffff",
                            fontSize: "1rem",
                            fontWeight: "600",
                            border: "none",
                            cursor: loading ? "not-allowed" : "pointer",
                            transition: "background-color 0.2s"
                        }}
                    >
                        {loading ? "Giriş Yapılıyor..." : "Giriş Yap"}
                    </button>
                </form>
            </div>
        </div>
    );
}