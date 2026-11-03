import { useState } from "react";

interface PinPadModalProps {
    title?: string;
    subtitle?: string;
    onSuccess: (data: { token: string; user: { id: string; fullName: string; role: string } }) => void;
    onCancel?: () => void;
    firmId?: string;
    allowedRoles?: string[];
    branchId?: string;
}

export function PinPadModal({
    allowedRoles,
    title = "Personel PIN Girişi",
    subtitle = "Lütfen 4 haneli PIN kodunuzu tuşlayın",
    onSuccess,
    onCancel,
    firmId = "11111111-1111-4111-8111-111111111111",
    branchId = "33333333-3333-4333-8333-333333333333",
}: PinPadModalProps) {
    const [pin, setPin] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleKeyPress = (num: string) => {
        if (pin.length < 4) {
            const nextPin = pin + num;
            setPin(nextPin);
            setError(null);
            if (nextPin.length === 4) {
                verifyPin(nextPin);
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
            const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
            const response = await fetch(`${apiBase}/api/v1/auth/pin-verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    firmId,
                    branchId,
                    pin: inputPin,
                    clientType: "pos",
                }),
            });

            if (!response.ok) {
                throw new Error("Girdiğiniz PIN kodu hatalı.");
            }

            const data = await response.json();

            // ROL DENETİMİ (RBAC Güvenlik Kontrolü)
            if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(data.user.role)) {
                throw new Error("Yetkisiz İşlem: Bu ekrana erişim yetkiniz yok!");
            }

            localStorage.setItem("hipos_pos_token", data.token);
            localStorage.setItem("hipos_pos_user", JSON.stringify(data.user));
            onSuccess(data);
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
            fontFamily: "system-ui, -apple-system, sans-serif"
        }}>
            <div style={{
                backgroundColor: "#1e293b",
                border: "1px solid #334155",
                borderRadius: "1.25rem",
                padding: "2rem",
                width: "100%",
                maxWidth: "360px",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
                textAlign: "center",
                color: "#f8fafc"
            }}>
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
            </div>
        </div>
    );
}