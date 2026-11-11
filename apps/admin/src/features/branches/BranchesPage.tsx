import { useState } from "react";
import type * as React from "react";
import { ArrowRight, Building2, Check, Copy, KeyRound, Plus, Printer, Store } from "lucide-react";
import { Link } from "react-router";
import type { ViewContext } from "../../app/context";
import {
  adminFetch,
  getStoredAuthBranches,
  getStoredAuthFirm,
  saveAuthSession,
  type AuthBranchInfo,
} from "../../shared/authFetch";
import { DemoNotice, PageHeading, StatusPill } from "../../shared/ui";

function getPosBaseUrl(): string {
  if (typeof window === "undefined") return "";
  return window.location.port === "5173"
    ? `${window.location.protocol}//${window.location.hostname}:5176`
    : window.location.origin;
}

export function BranchesPage({ ctx }: { ctx: ViewContext }) {
  const selected = ctx.selectedBranch;
  const activeBranchId = selected?.apiId ?? (ctx.branchId !== "all" ? ctx.branchId : null);

  // Kopyalama durumu
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Print Bridge token
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [bridgeTokenInfo, setBridgeTokenInfo] = useState<{
    token: string;
    expiresAt: string;
    branchId: string;
  } | null>(null);

  // Yeni Şube Oluşturma
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchDistrict, setNewBranchDistrict] = useState("");
  const [newBranchTables, setNewBranchTables] = useState(10);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branchNotice, setBranchNotice] = useState<string | null>(null);

  // Yeni İşletme / Müşteri Kurulumu (Onboarding)
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [platformAdminKey, setPlatformAdminKey] = useState("");
  const [tenantFirmName, setTenantFirmName] = useState("");
  const [tenantBrandName, setTenantBrandName] = useState("");
  const [tenantBranchName, setTenantBranchName] = useState("Merkez Şube");
  const [tenantDistrict, setTenantDistrict] = useState("Merkez");
  const [tenantOwnerName, setTenantOwnerName] = useState("");
  const [tenantOwnerEmail, setTenantOwnerEmail] = useState("");
  const [tenantOwnerPassword, setTenantOwnerPassword] = useState("");
  const [tenantOwnerPin, setTenantOwnerPin] = useState("9999");
  const [tenantTables, setTenantTables] = useState(10);
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [createdTenant, setCreatedTenant] = useState<{
    firm: { id: string; code: string; name: string };
    branch: { id: string; code: string; name: string };
    owner: { email: string; fullName: string };
    terminalUrls: { waiter: string; cashier: string; kitchen: string; qrMenu: string };
  } | null>(null);

  const canManageBranches =
    !ctx.isRealAuth ||
    ctx.user?.isPlatformAdmin ||
    ctx.user?.role === "owner";

  const canOnboardTenant = Boolean(ctx.user?.isPlatformAdmin || import.meta.env.DEV);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      // Pano erişimi engellendiyse sessiz kal
    }
  };

  const handleGenerateBridgeToken = async () => {
    if (!activeBranchId) return;
    setBridgeLoading(true);
    setBridgeError(null);
    try {
      const res = await adminFetch(
        `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(activeBranchId)}/printing/bridge-token`,
        { method: "POST", firmId: ctx.firmId },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };
        throw new Error(body.message ?? body.detail ?? `Köprü tokenı oluşturulamadı (${res.status}).`);
      }
      const data = (await res.json()) as { token: string; expiresAt: string; branchId: string };
      setBridgeTokenInfo(data);
    } catch (err) {
      setBridgeError(err instanceof Error ? err.message : "Bilinmeyen bir hata oluştu.");
    } finally {
      setBridgeLoading(false);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBranchError(null);
    setBranchNotice(null);
    setCreatingBranch(true);
    try {
      const res = await adminFetch(`/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches`, {
        method: "POST",
        firmId: ctx.firmId,
        body: JSON.stringify({
          branchName: newBranchName.trim(),
          district: newBranchDistrict.trim() || "Merkez",
          initialTableCount: Number(newBranchTables) || 10,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        branch?: AuthBranchInfo;
        token?: string | null;
        branches?: AuthBranchInfo[] | null;
      };
      if (!res.ok || !data.branch) {
        throw new Error(data.message ?? `Şube oluşturulamadı (${res.status}).`);
      }

      const existingBranches = getStoredAuthBranches();
      const nextBranches = data.branches ?? [...existingBranches, data.branch];
      saveAuthSession({
        ...(data.token ? { token: data.token } : {}),
        firm: getStoredAuthFirm(),
        branches: nextBranches,
      });
      await ctx.refreshAuthSession?.();
      ctx.setBranchId(data.branch.id);
      setNewBranchName("");
      setNewBranchDistrict("");
      setBranchNotice(`"${data.branch.name}" şubesi kuruldu (Ana Depo, Ana Kasa, Salon ve Mutfak istasyonları hazır).`);
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : "Şube oluşturulamadı.");
    } finally {
      setCreatingBranch(false);
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setTenantError(null);
    setCreatingTenant(true);
    try {
      const res = await adminFetch("/api/v1/onboarding/tenants", {
        method: "POST",
        firmId: ctx.firmId,
        headers: platformAdminKey.trim()
          ? { "X-Platform-Admin-Key": platformAdminKey.trim() }
          : undefined,
        body: JSON.stringify({
          firmName: tenantFirmName.trim(),
          brandName: tenantBrandName.trim() || null,
          branchName: tenantBranchName.trim(),
          district: tenantDistrict.trim() || "Merkez",
          ownerName: tenantOwnerName.trim(),
          ownerEmail: tenantOwnerEmail.trim(),
          ownerPassword: tenantOwnerPassword,
          ownerPin: tenantOwnerPin.trim(),
          initialTableCount: Number(tenantTables) || 10,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        firm?: { id: string; code: string; name: string };
        branch?: { id: string; code: string; name: string };
        owner?: { email: string; fullName: string };
        terminalUrls?: { waiter: string; cashier: string; kitchen: string; qrMenu: string };
      };
      if (!res.ok || !data.firm || !data.branch || !data.owner || !data.terminalUrls) {
        throw new Error(data.message ?? `İşletme kurulamadı (${res.status}).`);
      }
      setCreatedTenant({
        firm: data.firm,
        branch: data.branch,
        owner: data.owner,
        terminalUrls: data.terminalUrls,
      });
      setTenantFirmName("");
      setTenantBrandName("");
      setTenantOwnerName("");
      setTenantOwnerEmail("");
      setTenantOwnerPassword("");
    } catch (err) {
      setTenantError(err instanceof Error ? err.message : "Yeni işletme kurulumu başarısız.");
    } finally {
      setCreatingTenant(false);
    }
  };

  const posBase = getPosBaseUrl();
  const terminalLinks = activeBranchId
    ? [
        { key: "waiter", label: "Garson Tableti", url: `${posBase}/waiter?firmId=${encodeURIComponent(ctx.firmId)}&branchId=${encodeURIComponent(activeBranchId)}` },
        { key: "cashier", label: "Kasa Ekranı", url: `${posBase}/cashier?firmId=${encodeURIComponent(ctx.firmId)}&branchId=${encodeURIComponent(activeBranchId)}` },
        { key: "kitchen", label: "Mutfak KDS", url: `${posBase}/kitchen?firmId=${encodeURIComponent(ctx.firmId)}&branchId=${encodeURIComponent(activeBranchId)}` },
        { key: "qr", label: "QR Menü", url: `${posBase}/menu/${encodeURIComponent(ctx.firmId)}/${encodeURIComponent(activeBranchId)}` },
      ]
    : [];

  return (
    <>
      <PageHeading
        eyebrow="ŞUBELER VE TERMİNAL KURULUMU"
        title="Şube listesi"
        description="İşletmenin şubelerini seçin, yeni şube açın veya her şubenin Garson/Kasa/Mutfak terminal bağlantılarını kopyalayın."
        action={<StatusPill tone="blue">{ctx.isRealAuth ? ctx.firm : "Şube kapsamı"}</StatusPill>}
      />

      {!ctx.isRealAuth && (
        <DemoNotice>Şube kartları bu önizlemede örnek işletme verisidir. Gerçek oturum açtığınızda işletmenizin kendi şubeleri listelenir.</DemoNotice>
      )}

      <div className="branch-list-grid">
        {ctx.branches.map((branch) => (
          <button
            key={branch.id}
            className={`card branch-list-card ${selected?.id === branch.id ? "chosen" : ""}`}
            onClick={() => ctx.setBranchId(branch.id)}
            aria-pressed={selected?.id === branch.id}
          >
            <span className="branch-list-icon">
              <Store size={19} />
            </span>
            <span className="branch-list-copy">
              <strong>{branch.name}</strong>
              <small>{branch.district}</small>
            </span>
            <StatusPill tone={branch.health === "busy" ? "orange" : "green"}>
              {branch.health === "busy" ? "Yoğun" : "Aktif"}
            </StatusPill>
            {selected?.id === branch.id && <small className="branch-list-selected">Seçili şube</small>}
          </button>
        ))}
      </div>

      {selected && (
        <section className="card branch-selected-summary" style={{ flexDirection: "column", alignItems: "stretch", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <span className="card-kicker">AKTİF ÇALIŞMA KAPSAMI</span>
              <h2>{selected.name}</h2>
              <p>
                {selected.district} · Şube Kimliği: <code>{activeBranchId}</code>
              </p>
            </div>
            <Link to="/admin/branches/tables" className="primary-button branch-plan-link">
              Bu şubenin masa planını aç <ArrowRight size={15} />
            </Link>
          </div>

          {activeBranchId && (
            <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "1rem", display: "grid", gap: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                <strong>Bu Şubenin Terminal Bağlantıları (Tablet / Kasa / Mutfak)</strong>
                <button
                  type="button"
                  onClick={() => void handleGenerateBridgeToken()}
                  disabled={bridgeLoading}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    padding: "0.45rem 0.85rem",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    backgroundColor: "#f8fafc",
                    color: "#0f172a",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                  }}
                >
                  <Printer size={15} />
                  {bridgeLoading ? "Oluşturuluyor..." : "Yazıcı Köprüsü (Print Bridge) Tokenı Üret"}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "0.65rem" }}>
                {terminalLinks.map((item) => (
                  <div
                    key={item.key}
                    style={{
                      padding: "0.65rem 0.8rem",
                      borderRadius: "8px",
                      backgroundColor: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.4rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ fontSize: "0.85rem" }}>{item.label}</strong>
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <button
                          type="button"
                          onClick={() => void copyText(item.key, item.url)}
                          style={{
                            border: "1px solid #cbd5e1",
                            background: "#fff",
                            borderRadius: "6px",
                            padding: "0.2rem 0.5rem",
                            fontSize: "0.75rem",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.25rem",
                          }}
                        >
                          {copiedKey === item.key ? <Check size={12} /> : <Copy size={12} />}
                          {copiedKey === item.key ? "Kopyalandı" : "Kopyala"}
                        </button>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            border: "1px solid #2563eb",
                            color: "#2563eb",
                            background: "#eff6ff",
                            borderRadius: "6px",
                            padding: "0.2rem 0.5rem",
                            fontSize: "0.75rem",
                            textDecoration: "none",
                            fontWeight: 600,
                          }}
                        >
                          Aç
                        </a>
                      </div>
                    </div>
                    <code style={{ fontSize: "0.72rem", color: "#475569", wordBreak: "break-all" }}>{item.url}</code>
                  </div>
                ))}
              </div>

              {bridgeError && (
                <div role="alert" style={{ color: "#b91c1c", fontSize: "0.85rem" }}>
                  {bridgeError}
                </div>
              )}

              {bridgeTokenInfo && bridgeTokenInfo.branchId === activeBranchId && (
                <div
                  style={{
                    padding: "0.85rem",
                    borderRadius: "8px",
                    backgroundColor: "#0f172a",
                    color: "#e2e8f0",
                    display: "grid",
                    gap: "0.5rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: "0.85rem", color: "#93c5fd" }}>
                      <KeyRound size={14} style={{ verticalAlign: "middle", marginRight: "0.35rem" }} />
                      Şube Yazıcı Köprüsü Çalıştırma Komutu (365 Gün Geçerli)
                    </strong>
                    <button
                      type="button"
                      onClick={() =>
                        void copyText(
                          "bridge-cmd",
                          `HIPOS_API_URL="${window.location.origin}" node scripts/hipos-print-bridge.mjs --firm "${ctx.firmId}" --branch "${activeBranchId}" --token "${bridgeTokenInfo.token}"`,
                        )
                      }
                      style={{
                        border: "1px solid #334155",
                        background: "#1e293b",
                        color: "#f8fafc",
                        borderRadius: "6px",
                        padding: "0.25rem 0.65rem",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                      }}
                    >
                      {copiedKey === "bridge-cmd" ? "Komut Kopyalandı ✓" : "Komutu Kopyala"}
                    </button>
                  </div>
                  <code style={{ fontSize: "0.75rem", wordBreak: "break-all", color: "#cbd5e1" }}>
                    HIPOS_API_URL="{window.location.origin}" node scripts/hipos-print-bridge.mjs --firm "{ctx.firmId}" --branch "{activeBranchId}" --token "{bridgeTokenInfo.token}"
                  </code>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {canManageBranches && (
        <section className="card" style={{ marginTop: "1.25rem", display: "grid", gap: "0.9rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
            <div>
              <span className="card-kicker">ŞUBE GENİŞLETME</span>
              <h2 style={{ margin: "0.2rem 0 0 0" }}>İşletmeye Yeni Şube Ekle</h2>
              <p style={{ margin: "0.2rem 0 0 0", color: "#64748b", fontSize: "0.9rem" }}>
                Tek adımda yeni şube, Salon katı, başlangıç masaları, Ana Kasa, Mutfak istasyonları ve Ana Depo oluşturulur.
              </p>
            </div>
            {canOnboardTenant && (
              <button
                type="button"
                onClick={() => setShowOnboarding((v) => !v)}
                style={{
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                  borderRadius: "8px",
                  padding: "0.45rem 0.85rem",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                }}
              >
                <Building2 size={15} />
                {showOnboarding ? "Yeni İşletme Kurulumunu Gizle" : "Sıfırdan Yeni Restoran (Müşteri) Kur"}
              </button>
            )}
          </div>

          {branchError && <div role="alert" style={{ color: "#b91c1c", fontSize: "0.875rem" }}>{branchError}</div>}
          {branchNotice && <div role="status" style={{ color: "#047857", fontSize: "0.875rem", fontWeight: 600 }}>{branchNotice}</div>}

          <form
            onSubmit={handleCreateBranch}
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.75rem", alignItems: "end" }}
          >
            <label style={{ display: "grid", gap: "0.35rem", fontSize: "0.85rem", fontWeight: 600 }}>
              Yeni Şube Adı
              <input
                type="text"
                required
                minLength={2}
                placeholder="Örn. Beşiktaş Şubesi"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                style={{ padding: "0.55rem 0.75rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem", fontSize: "0.85rem", fontWeight: 600 }}>
              İlçe / Bölge
              <input
                type="text"
                placeholder="Örn. İstanbul · Beşiktaş"
                value={newBranchDistrict}
                onChange={(e) => setNewBranchDistrict(e.target.value)}
                style={{ padding: "0.55rem 0.75rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem", fontSize: "0.85rem", fontWeight: 600 }}>
              Başlangıç Masa Sayısı
              <input
                type="number"
                min={1}
                max={100}
                value={newBranchTables}
                onChange={(e) => setNewBranchTables(Number(e.target.value))}
                style={{ padding: "0.55rem 0.75rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>
            <button type="submit" disabled={creatingBranch} className="primary-button" style={{ justifyContent: "center" }}>
              <Plus size={16} />
              {creatingBranch ? "Kuruluyor..." : "Yeni Şubeyi Kur"}
            </button>
          </form>
        </section>
      )}

      {showOnboarding && canOnboardTenant && (
        <section className="card" style={{ marginTop: "1.25rem", display: "grid", gap: "0.9rem", border: "1px solid #bfdbfe" }}>
          <div>
            <span className="card-kicker">PLATFORM KURULUMU (TENANT ONBOARDING)</span>
            <h2 style={{ margin: "0.2rem 0 0 0" }}>Yeni Müşteri Restoranı Oluştur</h2>
            <p style={{ margin: "0.2rem 0 0 0", color: "#64748b", fontSize: "0.9rem" }}>
              Başka bir işletme için tamamen izole firma, ilk şube, patron hesabı ve tüm başlangıç modüllerini tek seferde açar.
            </p>
          </div>

          {tenantError && <div role="alert" style={{ color: "#b91c1c", fontSize: "0.875rem" }}>{tenantError}</div>}

          <form
            onSubmit={handleCreateTenant}
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.75rem", alignItems: "end" }}
          >
            <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
              İşletme / Restoran Adı
              <input
                type="text"
                required
                placeholder="Örn. Gaziantep Kebap Salonu"
                value={tenantFirmName}
                onChange={(e) => setTenantFirmName(e.target.value)}
                style={{ padding: "0.55rem 0.75rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
              Marka (Opsiyonel)
              <input
                type="text"
                placeholder="Örn. Antep Sofrası"
                value={tenantBrandName}
                onChange={(e) => setTenantBrandName(e.target.value)}
                style={{ padding: "0.55rem 0.75rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
              İlk Şube Adı
              <input
                type="text"
                required
                value={tenantBranchName}
                onChange={(e) => setTenantBranchName(e.target.value)}
                style={{ padding: "0.55rem 0.75rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
              İlçe / Bölge
              <input
                type="text"
                value={tenantDistrict}
                onChange={(e) => setTenantDistrict(e.target.value)}
                style={{ padding: "0.55rem 0.75rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
              Patron Adı Soyadı
              <input
                type="text"
                required
                placeholder="Örn. Mehmet Usta"
                value={tenantOwnerName}
                onChange={(e) => setTenantOwnerName(e.target.value)}
                style={{ padding: "0.55rem 0.75rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
              Patron E-Posta
              <input
                type="email"
                required
                placeholder="patron@yeniisletme.com"
                value={tenantOwnerEmail}
                onChange={(e) => setTenantOwnerEmail(e.target.value)}
                style={{ padding: "0.55rem 0.75rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
              Patron Şifresi (en az 6 krk)
              <input
                type="password"
                required
                minLength={6}
                value={tenantOwnerPassword}
                onChange={(e) => setTenantOwnerPassword(e.target.value)}
                style={{ padding: "0.55rem 0.75rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
              Patron Terminal PIN (4-6 hane)
              <input
                type="text"
                required
                pattern="[0-9]{4,6}"
                value={tenantOwnerPin}
                onChange={(e) => setTenantOwnerPin(e.target.value)}
                style={{ padding: "0.55rem 0.75rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
              Başlangıç Masa Sayısı
              <input
                type="number"
                min={1}
                max={100}
                value={tenantTables}
                onChange={(e) => setTenantTables(Number(e.target.value))}
                style={{ padding: "0.55rem 0.75rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
              Platform Anahtarı (Üretimde)
              <input
                type="password"
                placeholder="X-Platform-Admin-Key (opsiyonel)"
                value={platformAdminKey}
                onChange={(e) => setPlatformAdminKey(e.target.value)}
                style={{ padding: "0.55rem 0.75rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </label>
            <button type="submit" disabled={creatingTenant} className="primary-button" style={{ justifyContent: "center" }}>
              {creatingTenant ? "Kuruluyor..." : "Yeni İşletmeyi Kur"}
            </button>
          </form>

          {createdTenant && (
            <div style={{ padding: "0.9rem", borderRadius: "8px", backgroundColor: "#ecfdf5", border: "1px solid #6ee7b7", display: "grid", gap: "0.4rem" }}>
              <strong>✓ {createdTenant.firm.name} ({createdTenant.branch.name}) başarıyla kuruldu!</strong>
              <span style={{ fontSize: "0.85rem" }}>
                Firma ID: <code>{createdTenant.firm.id}</code> · Şube ID: <code>{createdTenant.branch.id}</code> · Giriş: <code>{createdTenant.owner.email}</code>
              </span>
              <span style={{ fontSize: "0.8rem", color: "#065f46" }}>
                Garson linki: <code>{posBase}{createdTenant.terminalUrls.waiter}</code>
              </span>
            </div>
          )}
        </section>
      )}
    </>
  );
}
