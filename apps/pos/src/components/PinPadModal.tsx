import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
    POS_API_BASE,
    getPosAppKind,
    savePosSession,
    setTerminalScope,
    useTerminalScope,
    type PosAppKind,
    type PosUser,
} from "../terminalScope";

interface PinPadModalProps {
    title?: string;
    subtitle?: string;
    onSuccess: (data: { token: string; user: PosUser }) => void;
    onCancel?: () => void;
    firmId?: string;
    allowedRoles?: string[];
    branchId?: string;
    appKind?: PosAppKind;
}

interface BranchInfoDto {
    firmId: string;
    firmName: string;
    brandName?: string | null;
    branchId: string;
    branchName: string;
    branchCode?: string;
    district?: string;
}

interface BindBranchOption {
    id: string;
    firmId: string;
    code: string;
    name: string;
    district: string;
}

export function PinPadModal({
    allowedRoles,
    title = "Personel PIN Girişi",
    subtitle = "Lütfen 4 haneli PIN kodunuzu tuşlayın",
    onSuccess,
    onCancel,
    firmId: explicitFirmId,
    branchId: explicitBranchId,
    appKind,
}: PinPadModalProps) {
    const scope = useTerminalScope();
    const hasExplicitScope = Boolean(explicitFirmId && explicitBranchId);
    const activeFirmId = explicitFirmId ?? scope.firmId;
    const activeBranchId = explicitBranchId ?? scope.branchId;
    const canOperateOnScope = hasExplicitScope || scope.isConfigured || import.meta.env.DEV;

    const [pin, setPin] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [branchInfo, setBranchInfo] = useState<BranchInfoDto | null>(null);
    const [branchError, setBranchError] = useState<string | null>(null);

    const [showBindPanel, setShowBindPanel] = useState(!canOperateOnScope);
    const [bindEmail, setBindEmail] = useState("");
    const [bindPassword, setBindPassword] = useState("");
    const [bindLoading, setBindLoading] = useState(false);
    const [bindError, setBindError] = useState<string | null>(null);
    const [bindFirmName, setBindFirmName] = useState<string>("");
    const [bindBranches, setBindBranches] = useState<BindBranchOption[]>([]);

    useEffect(() => {
        if (!canOperateOnScope) {
            setShowBindPanel(true);
            setBranchInfo(null);
            return;
        }
        const controller = new AbortController();
        setBranchError(null);
        const query = `firmId=${encodeURIComponent(activeFirmId)}&branchId=${encodeURIComponent(activeBranchId)}`;
        void fetch(`${POS_API_BASE}/api/v1/auth/branch-info?${query}`, { signal: controller.signal })
            .then(async (res) => {
                if (!res.ok) {
                    const body = await res.json().catch(() => ({})) as { message?: string };
                    throw new Error(body.message ?? "Şube bilgisi doğrulanamadı.");
                }
                return res.json() as Promise<BranchInfoDto>;
            })
            .then((info) => {
                setBranchInfo(info);
                setBranchError(null);
            })
            .catch((err) => {
                if (!controller.signal.aborted) {
                    setBranchInfo(null);
                    setBranchError(err instanceof Error ? err.message : "Şube bilgisi alınamadı.");
                }
            });
        return () => controller.abort();
    }, [activeFirmId, activeBranchId, canOperateOnScope]);

    const handleBindLogin = async (e: FormEvent) => {
        e.preventDefault();
        setBindLoading(true);
        setBindError(null);
        try {
            const response = await fetch(`${POS_API_BASE}/api/v1/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: bindEmail.trim(), password: bindPassword }),
            });
            if (!response.ok) {
                throw new Error("E-posta veya şifre hatalı.");
            }
            const data = await response.json() as {
                firm?: { id: string; name: string } | null;
                branches?: BindBranchOption[] | null;
                user?: { firmId: string; branchId: string };
            };
            const list = data.branches ?? [];
            const firmName = data.firm?.name ?? "";
            setBindFirmName(firmName);
            setBindBranches(list);

            if (list.length === 1) {
                const only = list[0];
                setTerminalScope({
                    firmId: only.firmId,
                    branchId: only.id,
                    firmName: firmName || undefined,
                    branchName: only.name,
                });
                setShowBindPanel(false);
                setBindBranches([]);
                setBindPassword("");
            } else if (list.length === 0 && data.user?.firmId && data.user?.branchId) {
                setTerminalScope({
                    firmId: data.user.firmId,
                    branchId: data.user.branchId,
                    firmName: firmName || undefined,
                });
                setShowBindPanel(false);
                setBindPassword("");
            } else if (list.length === 0) {
                setBindError("Bu hesaba bağlı aktif şube bulunamadı.");
            }
        } catch (err) {
            setBindError(err instanceof Error ? err.message : "Bağlantı hatası.");
        } finally {
            setBindLoading(false);
        }
    };

    const selectBoundBranch = (branch: BindBranchOption) => {
        setTerminalScope({
            firmId: branch.firmId,
            branchId: branch.id,
            firmName: bindFirmName || undefined,
            branchName: branch.name,
        });
        setShowBindPanel(false);
        setBindBranches([]);
        setBindPassword("");
        setPin("");
        setError(null);
    };

    const handleKeyPress = (num: string) => {
        if (!canOperateOnScope || loading) return;
        if (pin.length < 4) {
            const nextPin = pin + num;
            setPin(nextPin);
            setError(null);
            if (nextPin.length === 4) {
                void verifyPin(nextPin);
            }
        }
    };

    const handleDelete = () => {
        setPin((prev) => prev.slice(0, -1));
        setError(null);
    };

    const handleClear = () => {
        setPin("");
        setError(null);
    };

    const verifyPin = async (inputPin: string) => {
        setLoading(true);
        setError(null);
        try {
            const resolvedKind = appKind ?? getPosAppKind();
            const response = await fetch(`${POS_API_BASE}/api/v1/auth/pin-verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    firmId: activeFirmId,
                    branchId: activeBranchId,
                    pin: inputPin,
                    clientType: resolvedKind,
                }),
            });

            if (!response.ok) {
                throw new Error("Girdiğiniz PIN kodu hatalı veya bu şubede yetkili değil.");
            }

            const data = await response.json() as { token: string; user: PosUser };

            if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(data.user.role)) {
                throw new Error("Yetkisiz İşlem: Bu ekrana erişim yetkiniz yok!");
            }

            savePosSession(resolvedKind, { token: data.token, user: data.user });
            onSuccess({ token: data.token, user: data.user });
        } catch (err: unknown) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError("Doğrulama başarısız.");
            }
            setPin("");
        } finally {
            setLoading(false);
        }
    };

    const activeBranchLabel = branchInfo
        ? `${branchInfo.firmName} · ${branchInfo.branchName}`
        : scope.firmName || scope.branchName
            ? `${scope.firmName ?? "İşletme"} · ${scope.branchName ?? "Şube"}`
            : canOperateOnScope
                ? "Varsayılan Demo Şube"
                : "Terminal Şubeye Bağlı Değil";

    return (
        <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            fontFamily: "system-ui, -apple-system, sans-serif",
            padding: "1rem",
        }}>
            <div style={{
                backgroundColor: "#1e293b",
                border: "1px solid #334155",
                borderRadius: "1.25rem",
                padding: "1.75rem",
                width: "100%",
                maxWidth: "390px",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
                textAlign: "center",
                color: "#f8fafc",
            }}>
                {!hasExplicitScope && (
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "0.5rem",
                        backgroundColor: canOperateOnScope && !branchError ? "rgba(15, 23, 42, 0.6)" : "rgba(239, 68, 68, 0.15)",
                        border: `1px solid ${canOperateOnScope && !branchError ? "#334155" : "rgba(239, 68, 68, 0.4)"}`,
                        borderRadius: "0.75rem",
                        padding: "0.5rem 0.75rem",
                        marginBottom: "1rem",
                        fontSize: "0.78rem",
                    }}>
                        <span style={{ textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: canOperateOnScope ? "#cbd5e1" : "#fca5a5" }}>
                            📍 {branchError ? branchError : activeBranchLabel}
                        </span>
                        <button
                            type="button"
                            onClick={() => setShowBindPanel((v) => !v)}
                            style={{
                                flexShrink: 0,
                                backgroundColor: "#334155",
                                color: "#e2e8f0",
                                border: "1px solid #475569",
                                borderRadius: "0.5rem",
                                padding: "0.25rem 0.55rem",
                                fontSize: "0.72rem",
                                cursor: "pointer",
                                fontWeight: 600,
                            }}
                        >
                            {showBindPanel ? "Kapat" : "Şube Bağla"}
                        </button>
                    </div>
                )}

                {showBindPanel && !hasExplicitScope ? (
                    <div style={{ textAlign: "left", marginBottom: "0.5rem" }}>
                        <h2 style={{ margin: "0 0 0.35rem 0", fontSize: "1.2rem", fontWeight: 700, textAlign: "center" }}>
                            Terminali Şubeye Bağla
                        </h2>
                        <p style={{ margin: "0 0 1rem 0", color: "#94a3b8", fontSize: "0.8rem", textAlign: "center" }}>
                            Yönetici e-posta ve şifrenizle giriş yapıp bu cihazın hangi şube için çalışacağını seçin.
                        </p>

                        <form onSubmit={handleBindLogin} style={{ display: "grid", gap: "0.65rem" }}>
                            <input
                                type="email"
                                required
                                placeholder="Yönetici E-posta"
                                value={bindEmail}
                                onChange={(e) => setBindEmail(e.target.value)}
                                style={{
                                    padding: "0.65rem 0.75rem",
                                    borderRadius: "0.6rem",
                                    border: "1px solid #475569",
                                    backgroundColor: "#0f172a",
                                    color: "#f8fafc",
                                    fontSize: "0.9rem",
                                }}
                            />
                            <input
                                type="password"
                                required
                                placeholder="Şifre"
                                value={bindPassword}
                                onChange={(e) => setBindPassword(e.target.value)}
                                style={{
                                    padding: "0.65rem 0.75rem",
                                    borderRadius: "0.6rem",
                                    border: "1px solid #475569",
                                    backgroundColor: "#0f172a",
                                    color: "#f8fafc",
                                    fontSize: "0.9rem",
                                }}
                            />
                            {bindError && (
                                <div style={{ color: "#f87171", fontSize: "0.8rem" }}>{bindError}</div>
                            )}
                            <button
                                type="submit"
                                disabled={bindLoading}
                                style={{
                                    padding: "0.7rem",
                                    borderRadius: "0.65rem",
                                    border: "none",
                                    backgroundColor: "#2563eb",
                                    color: "#fff",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                }}
                            >
                                {bindLoading ? "Doğrulanıyor…" : "Şubeleri Getir"}
                            </button>
                        </form>

                        {bindBranches.length > 0 && (
                            <div style={{ marginTop: "0.9rem", display: "grid", gap: "0.45rem" }}>
                                <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
                                    {bindFirmName} · Şube Seçin:
                                </div>
                                {bindBranches.map((b) => (
                                    <button
                                        key={b.id}
                                        type="button"
                                        onClick={() => selectBoundBranch(b)}
                                        style={{
                                            textAlign: "left",
                                            padding: "0.65rem 0.75rem",
                                            borderRadius: "0.6rem",
                                            backgroundColor: "#334155",
                                            color: "#f8fafc",
                                            border: "1px solid #475569",
                                            cursor: "pointer",
                                            fontWeight: 600,
                                            fontSize: "0.85rem",
                                        }}
                                    >
                                        {b.name} {b.district ? `(${b.district})` : ""}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.4rem", fontWeight: "700" }}>{title}</h2>
                        <p style={{ margin: "0 0 1.5rem 0", color: "#94a3b8", fontSize: "0.85rem" }}>{subtitle}</p>

                        {/* 4 Haneli PIN Noktaları */}
                        <div style={{
                            display: "flex",
                            justifyContent: "center",
                            gap: "1rem",
                            marginBottom: "1.5rem"
                        }}>
                            {[0, 1, 2, 3].map((index) => (
                                <div
                                    key={index}
                                    style={{
                                        width: "20px",
                                        height: "20px",
                                        borderRadius: "50%",
                                        border: "2px solid #3b82f6",
                                        backgroundColor: pin.length > index ? "#3b82f6" : "transparent",
                                        transition: "all 0.15s ease",
                                        transform: pin.length > index ? "scale(1.15)" : "scale(1)"
                                    }}
                                />
                            ))}
                        </div>

                        {error && (
                            <div style={{
                                color: "#f87171",
                                fontSize: "0.85rem",
                                marginBottom: "1rem",
                                fontWeight: "500"
                            }}>
                                {error}
                            </div>
                        )}

                        {/* Dokunmatik Sayı Tuş Takımı */}
                        <div style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(3, 1fr)",
                            gap: "0.75rem",
                            marginBottom: "1rem"
                        }}>
                            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                                <button
                                    key={num}
                                    disabled={loading}
                                    onClick={() => handleKeyPress(num)}
                                    style={{
                                        padding: "1rem",
                                        fontSize: "1.5rem",
                                        fontWeight: "600",
                                        borderRadius: "0.75rem",
                                        backgroundColor: "#334155",
                                        color: "#f8fafc",
                                        border: "none",
                                        cursor: "pointer",
                                        transition: "all 0.1s active",
                                        userSelect: "none"
                                    }}
                                    onMouseDown={(e) => (e.currentTarget.style.backgroundColor = "#475569")}
                                    onMouseUp={(e) => (e.currentTarget.style.backgroundColor = "#334155")}
                                >
                                    {num}
                                </button>
                            ))}

                            <button
                                disabled={loading}
                                onClick={handleClear}
                                style={{
                                    padding: "1rem",
                                    fontSize: "0.9rem",
                                    fontWeight: "600",
                                    borderRadius: "0.75rem",
                                    backgroundColor: "rgba(239, 68, 68, 0.15)",
                                    color: "#f87171",
                                    border: "1px solid rgba(239, 68, 68, 0.3)",
                                    cursor: "pointer"
                                }}
                            >
                                Temizle
                            </button>

                            <button
                                disabled={loading}
                                onClick={() => handleKeyPress("0")}
                                style={{
                                    padding: "1rem",
                                    fontSize: "1.5rem",
                                    fontWeight: "600",
                                    borderRadius: "0.75rem",
                                    backgroundColor: "#334155",
                                    color: "#f8fafc",
                                    border: "none",
                                    cursor: "pointer"
                                }}
                                onMouseDown={(e) => (e.currentTarget.style.backgroundColor = "#475569")}
                                onMouseUp={(e) => (e.currentTarget.style.backgroundColor = "#334155")}
                            >
                                0
                            </button>

                            <button
                                disabled={loading}
                                onClick={handleDelete}
                                style={{
                                    padding: "1rem",
                                    fontSize: "1.1rem",
                                    fontWeight: "600",
                                    borderRadius: "0.75rem",
                                    backgroundColor: "#334155",
                                    color: "#cbd5e1",
                                    border: "none",
                                    cursor: "pointer"
                                }}
                            >
                                ⌫
                            </button>
                        </div>

                        {onCancel && (
                            <button
                                onClick={onCancel}
                                style={{
                                    width: "100%",
                                    padding: "0.6rem",
                                    background: "transparent",
                                    border: "none",
                                    color: "#64748b",
                                    fontSize: "0.85rem",
                                    cursor: "pointer",
                                    marginTop: "0.5rem"
                                }}
                            >
                                İptal
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
