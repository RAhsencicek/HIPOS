import { useCallback, useEffect, useState } from "react";
import type * as React from "react";
import { ArrowRight, Building2, Check, Copy, Download, KeyRound, Plus, Printer, RefreshCw, Store, Wifi, WifiOff } from "lucide-react";
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

function getBridgeApiBaseUrl(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  if (typeof envBase === "string" && /^https?:\/\//i.test(envBase)) {
    return envBase.replace(/\/+$/, "");
  }
  if (typeof window === "undefined") return "";
  return window.location.port === "5173"
    ? `${window.location.protocol}//${window.location.hostname}:5180`
    : window.location.origin;
}

function downloadBlobFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface BranchPrinterTarget {
  name?: string;
  type: string;
  enabled?: boolean;
  ipAddress: string;
  port: number;
  systemPrinterName?: string | null;
  fallbackToUsb?: boolean;
}

interface BranchPrinterConfig {
  deliveryMode: string;
  autoPrintKitchenOnOrder: boolean;
  autoSplitKitchenByStation: boolean;
  cashierPrinter: BranchPrinterTarget;
  kitchenPrinter: BranchPrinterTarget;
  barPrinter?: BranchPrinterTarget;
}

interface BridgeStatusData {
  connected: boolean;
  activeStreamCount: number;
  lastSeenAt?: string | null;
  bridges?: Array<{
    bridgeId: string;
    hostname: string;
    platform: string;
    localIps: string[];
    version?: string | null;
  }>;
  availablePrinters?: Array<{
    name: string;
    port?: string | null;
    driver?: string | null;
    isDefault: boolean;
  }>;
}

export function BranchesPage({ ctx }: { ctx: ViewContext }) {
  const selected = ctx.selectedBranch;
  const activeBranchId = selected?.apiId ?? (ctx.branchId !== "all" ? ctx.branchId : null);

  // Kopyalama durumu
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Print Bridge token & Şube Yazıcı Durumu
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [bridgeTokenInfo, setBridgeTokenInfo] = useState<{
    token: string;
    expiresAt: string;
    branchId: string;
  } | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatusData | null>(null);
  const [bridgeStatusLoading, setBridgeStatusLoading] = useState(false);
  const [printerConfig, setPrinterConfig] = useState<BranchPrinterConfig | null>(null);
  const [printerSaving, setPrinterSaving] = useState(false);
  const [printerFeedback, setPrinterFeedback] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [testingTarget, setTestingTarget] = useState<string | null>(null);

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

  const loadBranchPrinting = useCallback(async () => {
    if (!activeBranchId) {
      setBridgeStatus(null);
      setPrinterConfig(null);
      return;
    }
    setBridgeStatusLoading(true);
    try {
      const [statusRes, configRes] = await Promise.all([
        adminFetch(
          `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(activeBranchId)}/printing/bridge-status`,
          { firmId: ctx.firmId },
        ),
        adminFetch(
          `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(activeBranchId)}/printing/config`,
          { firmId: ctx.firmId },
        ),
      ]);
      if (statusRes.ok) {
        setBridgeStatus((await statusRes.json()) as BridgeStatusData);
      }
      if (configRes.ok) {
        const cfg = (await configRes.json()) as BranchPrinterConfig;
        setPrinterConfig({
          deliveryMode: cfg.deliveryMode ?? "Auto",
          autoPrintKitchenOnOrder: cfg.autoPrintKitchenOnOrder ?? true,
          autoSplitKitchenByStation: cfg.autoSplitKitchenByStation ?? true,
          cashierPrinter: cfg.cashierPrinter ?? { type: "Usb", enabled: true, ipAddress: "192.168.1.100", port: 9100, fallbackToUsb: true },
          kitchenPrinter: cfg.kitchenPrinter ?? { type: "Network", enabled: true, ipAddress: "192.168.1.116", port: 9100, fallbackToUsb: false },
          barPrinter: cfg.barPrinter ?? { type: "Disabled", enabled: false, ipAddress: "192.168.1.117", port: 9100, fallbackToUsb: false },
        });
      }
    } catch {
      // Şube yazıcı önizlemesi sessizce geçilir
    } finally {
      setBridgeStatusLoading(false);
    }
  }, [activeBranchId, ctx.firmId]);

  useEffect(() => {
    setPrinterFeedback(null);
    void loadBranchPrinting();
  }, [loadBranchPrinting]);

  const handleSaveBranchPrinters = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBranchId || !printerConfig) return;
    setPrinterSaving(true);
    setPrinterFeedback(null);
    try {
      const bar = printerConfig.barPrinter ?? { type: "Disabled", enabled: false, ipAddress: "192.168.1.117", port: 9100, fallbackToUsb: false };
      const res = await adminFetch(
        `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(activeBranchId)}/printing/config`,
        {
          method: "POST",
          firmId: ctx.firmId,
          body: JSON.stringify({
            deliveryMode: printerConfig.deliveryMode,
            autoPrintKitchenOnOrder: printerConfig.autoPrintKitchenOnOrder,
            autoSplitKitchenByStation: printerConfig.autoSplitKitchenByStation,
            cashierIp: printerConfig.cashierPrinter.ipAddress,
            cashierPort: Number(printerConfig.cashierPrinter.port) || 9100,
            cashierType: printerConfig.cashierPrinter.type,
            cashierSystemPrinterName: printerConfig.cashierPrinter.systemPrinterName?.trim() || null,
            cashierFallbackToUsb: printerConfig.cashierPrinter.fallbackToUsb ?? true,
            cashierEnabled: printerConfig.cashierPrinter.enabled ?? true,
            kitchenIp: printerConfig.kitchenPrinter.ipAddress,
            kitchenPort: Number(printerConfig.kitchenPrinter.port) || 9100,
            kitchenType: printerConfig.kitchenPrinter.type,
            kitchenSystemPrinterName: printerConfig.kitchenPrinter.systemPrinterName?.trim() || null,
            kitchenFallbackToUsb: printerConfig.kitchenPrinter.fallbackToUsb ?? false,
            kitchenEnabled: printerConfig.kitchenPrinter.enabled ?? true,
            barEnabled: Boolean(bar.enabled),
            barIp: bar.ipAddress,
            barPort: Number(bar.port) || 9100,
            barType: bar.enabled ? (bar.type === "Disabled" ? "Network" : bar.type) : "Disabled",
            barSystemPrinterName: bar.systemPrinterName?.trim() || null,
            barFallbackToUsb: Boolean(bar.fallbackToUsb),
          }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message ?? `Kaydedilemedi (${res.status}).`);
      }
      const saved = (await res.json()) as BranchPrinterConfig;
      setPrinterConfig(saved);
      setPrinterFeedback({
        tone: "ok",
        text: "Şube yazıcı ayarları kaydedildi; Print Bridge açıksa ayarlar anında güncellendi.",
      });
    } catch (err) {
      setPrinterFeedback({
        tone: "err",
        text: err instanceof Error ? err.message : "Yazıcı ayarları kaydedilemedi.",
      });
    } finally {
      setPrinterSaving(false);
    }
  };

  const handleTestBranchPrinter = async (target: "kitchen" | "bar" | "cashier") => {
    if (!activeBranchId || testingTarget) return;
    setTestingTarget(target);
    setPrinterFeedback(null);
    try {
      const res = await adminFetch(
        `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(activeBranchId)}/printing/test?target=${target}`,
        { method: "POST", firmId: ctx.firmId },
      );
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; transportUsed?: string; error?: string; message?: string };
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? body.message ?? `Test yazdırma başarısız (${res.status}).`);
      }
      setPrinterFeedback({
        tone: "ok",
        text: `${target.toUpperCase()} test fişi gönderildi (${body.transportUsed ?? "OK"}).`,
      });
    } catch (err) {
      setPrinterFeedback({
        tone: "err",
        text: err instanceof Error ? err.message : "Test fişi gönderilemedi.",
      });
    } finally {
      setTestingTarget(null);
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

              {bridgeTokenInfo && bridgeTokenInfo.branchId === activeBranchId && (() => {
                const bridgeApiBase = getBridgeApiBaseUrl();
                const bridgeConfigJson = JSON.stringify(
                  {
                    apiUrl: bridgeApiBase,
                    firmId: ctx.firmId,
                    branchId: activeBranchId,
                    token: bridgeTokenInfo.token,
                    heartbeatIntervalMs: 20000,
                  },
                  null,
                  2,
                );
                const windowsBat = [
                  "@echo off",
                  "setlocal",
                  "cd /d %~dp0",
                  "echo HIPOS Yazici Koprusu Baslatiliyor...",
                  "where node >nul 2>nul",
                  "if errorlevel 1 (",
                  "  echo HATA: Node.js 18+ kurulu degil. https://nodejs.org uzerinden LTS kurun.",
                  "  pause",
                  "  exit /b 1",
                  ")",
                  `powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing -Uri '${bridgeApiBase}/api/v1/printing/bridge-script' -OutFile 'hipos-print-bridge.mjs'"`,
                  "if errorlevel 1 (",
                  "  echo UYARI: Betik indirilemedi, mevcut yerel kopya ile devam ediliyor...",
                  ")",
                  'node "%~dp0hipos-print-bridge.mjs" --config "%~dp0hipos-bridge.config.json"',
                  "pause",
                ].join("\r\n");
                const macCommand = [
                  "#!/bin/bash",
                  'DIR="$(cd "$(dirname "$0")" && pwd)"',
                  'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"',
                  'if ! command -v node >/dev/null 2>&1; then',
                  '  echo "HATA: Node.js 18+ kurulu degil. https://nodejs.org adresinden kurun."',
                  "  read -n 1 -s -r -p 'Devam etmek icin bir tusa basin...'",
                  "  exit 1",
                  "fi",
                  `curl -fsSL "${bridgeApiBase}/api/v1/printing/bridge-script" -o "$DIR/hipos-print-bridge.mjs" || echo "Yerel betik kullaniliyor..."`,
                  'exec node "$DIR/hipos-print-bridge.mjs" --config "$DIR/hipos-bridge.config.json"',
                ].join("\n");

                return (
                  <div
                    style={{
                      padding: "0.95rem",
                      borderRadius: "10px",
                      backgroundColor: "#0f172a",
                      color: "#e2e8f0",
                      display: "grid",
                      gap: "0.65rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                      <strong style={{ fontSize: "0.85rem", color: "#93c5fd" }}>
                        <KeyRound size={14} style={{ verticalAlign: "middle", marginRight: "0.35rem" }} />
                        Şube Yazıcı Köprüsü Kurulum Paketi (365 Gün Geçerli)
                      </strong>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                        <button
                          type="button"
                          onClick={() => downloadBlobFile("hipos-bridge.config.json", bridgeConfigJson, "application/json;charset=utf-8")}
                          style={{
                            border: "1px solid #3b82f6",
                            background: "#1d4ed8",
                            color: "#ffffff",
                            borderRadius: "6px",
                            padding: "0.3rem 0.65rem",
                            fontSize: "0.75rem",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.3rem",
                            fontWeight: 600,
                          }}
                        >
                          <Download size={13} /> hipos-bridge.config.json
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadBlobFile("HIPOS-Yazici-Koprusu.bat", windowsBat)}
                          style={{
                            border: "1px solid #475569",
                            background: "#1e293b",
                            color: "#f8fafc",
                            borderRadius: "6px",
                            padding: "0.3rem 0.65rem",
                            fontSize: "0.75rem",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.3rem",
                          }}
                        >
                          <Download size={13} /> Windows (.bat)
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadBlobFile("HIPOS-Yazici-Koprusu.command", macCommand)}
                          style={{
                            border: "1px solid #475569",
                            background: "#1e293b",
                            color: "#f8fafc",
                            borderRadius: "6px",
                            padding: "0.3rem 0.65rem",
                            fontSize: "0.75rem",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.3rem",
                          }}
                        >
                          <Download size={13} /> macOS (.command)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void copyText(
                              "bridge-cmd",
                              `HIPOS_API_URL="${bridgeApiBase}" node scripts/hipos-print-bridge.mjs --firm "${ctx.firmId}" --branch "${activeBranchId}" --token "${bridgeTokenInfo.token}"`,
                            )
                          }
                          style={{
                            border: "1px solid #334155",
                            background: "#1e293b",
                            color: "#f8fafc",
                            borderRadius: "6px",
                            padding: "0.3rem 0.65rem",
                            fontSize: "0.75rem",
                            cursor: "pointer",
                          }}
                        >
                          {copiedKey === "bridge-cmd" ? "Komut Kopyalandı ✓" : "CLI Komutunu Kopyala"}
                        </button>
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: "0.76rem", color: "#94a3b8" }}>
                      Kasa PC&apos;sinde yeni bir klasöre <code>hipos-bridge.config.json</code> ile birlikte Windows için <code>.bat</code> veya macOS için <code>.command</code> dosyasını indirin (Mac&apos;te ilk sefer <code>chmod +x HIPOS-Yazici-Koprusu.command</code>), ardından çift tıklayın.
                    </p>
                    <code style={{ fontSize: "0.73rem", wordBreak: "break-all", color: "#cbd5e1" }}>
                      HIPOS_API_URL="{bridgeApiBase}" node scripts/hipos-print-bridge.mjs --firm "{ctx.firmId}" --branch "{activeBranchId}" --token "{bridgeTokenInfo.token}"
                    </code>
                  </div>
                );
              })()}

              {/* Canlı Print Bridge Durumu & Şube Yazıcı Profili */}
              <div
                style={{
                  borderTop: "1px solid #e2e8f0",
                  paddingTop: "0.9rem",
                  display: "grid",
                  gap: "0.85rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.6rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
                    {bridgeStatus?.connected ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          padding: "0.28rem 0.7rem",
                          borderRadius: "999px",
                          background: "#dcfce7",
                          color: "#166534",
                          fontWeight: 600,
                          fontSize: "0.8rem",
                        }}
                      >
                        <Wifi size={14} /> Print Bridge Çevrimiçi
                        {bridgeStatus.bridges?.[0]?.hostname ? ` (${bridgeStatus.bridges[0].hostname})` : ""}
                      </span>
                    ) : (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          padding: "0.28rem 0.7rem",
                          borderRadius: "999px",
                          background: "#fee2e2",
                          color: "#991b1b",
                          fontWeight: 600,
                          fontSize: "0.8rem",
                        }}
                      >
                        <WifiOff size={14} /> Print Bridge Bağlı Değil
                      </span>
                    )}
                    {bridgeStatus?.bridges?.[0]?.localIps?.length ? (
                      <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
                        LAN: {bridgeStatus.bridges[0].localIps.join(", ")}
                      </span>
                    ) : null}
                    {(bridgeStatus?.availablePrinters?.length ?? 0) > 0 && (
                      <span style={{ fontSize: "0.78rem", color: "#0f766e" }}>
                        Algılanan USB/OS yazıcılar:{" "}
                        <strong>{bridgeStatus?.availablePrinters?.map((p) => p.name).join(", ")}</strong>
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadBranchPrinting()}
                    disabled={bridgeStatusLoading}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      padding: "0.32rem 0.7rem",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      background: "#fff",
                      fontSize: "0.78rem",
                      cursor: "pointer",
                    }}
                  >
                    <RefreshCw size={13} /> {bridgeStatusLoading ? "Yenileniyor..." : "Durumu Yenile"}
                  </button>
                </div>

                {printerConfig && (
                  <form onSubmit={(e) => void handleSaveBranchPrinters(e)} style={{ display: "grid", gap: "0.75rem" }}>
                    <datalist id={`branch-printers-${activeBranchId}`}>
                      {bridgeStatus?.availablePrinters?.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.isDefault ? `${p.name} (Varsayılan)` : p.name}
                        </option>
                      ))}
                    </datalist>

                    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center", fontSize: "0.82rem" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                        <span>Teslimat Modu:</span>
                        <select
                          value={printerConfig.deliveryMode}
                          onChange={(e) => setPrinterConfig({ ...printerConfig, deliveryMode: e.target.value })}
                          style={{ padding: "0.3rem 0.5rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                        >
                          <option value="Auto">Otomatik (Bridge varsa Köprü, yoksa Direkt LAN)</option>
                          <option value="CloudBridge">Yalnızca Bulut -&gt; Print Bridge (SSE)</option>
                          <option value="DirectLan">Doğrudan LAN (Yerel Sunucu)</option>
                        </select>
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={printerConfig.autoPrintKitchenOnOrder}
                          onChange={(e) => setPrinterConfig({ ...printerConfig, autoPrintKitchenOnOrder: e.target.checked })}
                        />
                        Siparişte otomatik mutfak/bar fişi
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={printerConfig.autoSplitKitchenByStation}
                          onChange={(e) => setPrinterConfig({ ...printerConfig, autoSplitKitchenByStation: e.target.checked })}
                        />
                        İstasyonlara göre fişi ayır (Yemek / İçecek)
                      </label>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "0.65rem" }}>
                      {/* Mutfak */}
                      <div style={{ padding: "0.7rem", borderRadius: "8px", border: "1px solid #e2e8f0", background: "#f8fafc", display: "grid", gap: "0.45rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <strong style={{ fontSize: "0.84rem" }}>🍳 Mutfak Yazıcısı</strong>
                          <button type="button" disabled={Boolean(testingTarget)} onClick={() => void handleTestBranchPrinter("kitchen")} style={{ fontSize: "0.72rem", padding: "0.2rem 0.5rem", borderRadius: "5px", border: "1px solid #bae6fd", background: "#e0f2fe", cursor: "pointer" }}>
                            {testingTarget === "kitchen" ? "..." : "Test"}
                          </button>
                        </div>
                        <select
                          value={printerConfig.kitchenPrinter.type}
                          onChange={(e) => setPrinterConfig({ ...printerConfig, kitchenPrinter: { ...printerConfig.kitchenPrinter, type: e.target.value } })}
                          style={{ padding: "0.35rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }}
                        >
                          <option value="Network">Ağ / TCP 9100</option>
                          <option value="Usb">USB / İşletim Sistemi Kuyruğu</option>
                          <option value="Console">Sadece Konsol (Test)</option>
                          <option value="Disabled">Devre Dışı</option>
                        </select>
                        {printerConfig.kitchenPrinter.type === "Network" && (
                          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.35rem" }}>
                            <input
                              value={printerConfig.kitchenPrinter.ipAddress}
                              onChange={(e) => setPrinterConfig({ ...printerConfig, kitchenPrinter: { ...printerConfig.kitchenPrinter, ipAddress: e.target.value } })}
                              placeholder="192.168.1.201"
                              style={{ padding: "0.35rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }}
                            />
                            <input
                              type="number"
                              value={printerConfig.kitchenPrinter.port}
                              onChange={(e) => setPrinterConfig({ ...printerConfig, kitchenPrinter: { ...printerConfig.kitchenPrinter, port: Number(e.target.value) || 9100 } })}
                              placeholder="9100"
                              style={{ padding: "0.35rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }}
                            />
                          </div>
                        )}
                        {printerConfig.kitchenPrinter.type === "Usb" && (
                          <input
                            list={`branch-printers-${activeBranchId}`}
                            value={printerConfig.kitchenPrinter.systemPrinterName ?? ""}
                            onChange={(e) => setPrinterConfig({ ...printerConfig, kitchenPrinter: { ...printerConfig.kitchenPrinter, systemPrinterName: e.target.value } })}
                            placeholder="USB Yazıcı Adı (boş=otomatik)"
                            style={{ padding: "0.35rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }}
                          />
                        )}
                      </div>

                      {/* Bar / İçecek */}
                      <div style={{ padding: "0.7rem", borderRadius: "8px", border: "1px solid #e2e8f0", background: "#f8fafc", display: "grid", gap: "0.45rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.84rem", fontWeight: 700, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={Boolean(printerConfig.barPrinter?.enabled)}
                              onChange={(e) => {
                                const prevBar = printerConfig.barPrinter ?? { type: "Network", ipAddress: "192.168.1.117", port: 9100, fallbackToUsb: false };
                                setPrinterConfig({
                                  ...printerConfig,
                                  barPrinter: {
                                    ...prevBar,
                                    enabled: e.target.checked,
                                    type: e.target.checked && prevBar.type === "Disabled" ? "Network" : prevBar.type,
                                  },
                                });
                              }}
                            />
                            🍹 Bar / İçecek Yazıcısı
                          </label>
                          <button type="button" disabled={Boolean(testingTarget) || !printerConfig.barPrinter?.enabled} onClick={() => void handleTestBranchPrinter("bar")} style={{ fontSize: "0.72rem", padding: "0.2rem 0.5rem", borderRadius: "5px", border: "1px solid #ddd6fe", background: "#ede9fe", cursor: "pointer" }}>
                            {testingTarget === "bar" ? "..." : "Test"}
                          </button>
                        </div>
                        {printerConfig.barPrinter?.enabled ? (
                          <>
                            <select
                              value={printerConfig.barPrinter.type}
                              onChange={(e) => setPrinterConfig({ ...printerConfig, barPrinter: { ...printerConfig.barPrinter!, type: e.target.value } })}
                              style={{ padding: "0.35rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }}
                            >
                              <option value="Network">Ağ / TCP 9100</option>
                              <option value="Usb">USB / İşletim Sistemi Kuyruğu</option>
                              <option value="Console">Sadece Konsol (Test)</option>
                            </select>
                            {printerConfig.barPrinter.type === "Network" && (
                              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.35rem" }}>
                                <input
                                  value={printerConfig.barPrinter.ipAddress}
                                  onChange={(e) => setPrinterConfig({ ...printerConfig, barPrinter: { ...printerConfig.barPrinter!, ipAddress: e.target.value } })}
                                  placeholder="192.168.1.117"
                                  style={{ padding: "0.35rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }}
                                />
                                <input
                                  type="number"
                                  value={printerConfig.barPrinter.port}
                                  onChange={(e) => setPrinterConfig({ ...printerConfig, barPrinter: { ...printerConfig.barPrinter!, port: Number(e.target.value) || 9100 } })}
                                  placeholder="9100"
                                  style={{ padding: "0.35rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }}
                                />
                              </div>
                            )}
                            {printerConfig.barPrinter.type === "Usb" && (
                              <input
                                list={`branch-printers-${activeBranchId}`}
                                value={printerConfig.barPrinter.systemPrinterName ?? ""}
                                onChange={(e) => setPrinterConfig({ ...printerConfig, barPrinter: { ...printerConfig.barPrinter!, systemPrinterName: e.target.value } })}
                                placeholder="USB Yazıcı Adı (boş=otomatik)"
                                style={{ padding: "0.35rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }}
                              />
                            )}
                          </>
                        ) : (
                          <p style={{ margin: 0, fontSize: "0.76rem", color: "#64748b" }}>
                            Kapalı — İçecek ürünleri mutfak fişiyle birlikte basılır. Ayrı bar yazıcısı için kutuyu işaretleyin.
                          </p>
                        )}
                      </div>

                      {/* Kasa */}
                      <div style={{ padding: "0.7rem", borderRadius: "8px", border: "1px solid #e2e8f0", background: "#f8fafc", display: "grid", gap: "0.45rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <strong style={{ fontSize: "0.84rem" }}>🧾 Kasa / Adisyon Yazıcısı</strong>
                          <button type="button" disabled={Boolean(testingTarget)} onClick={() => void handleTestBranchPrinter("cashier")} style={{ fontSize: "0.72rem", padding: "0.2rem 0.5rem", borderRadius: "5px", border: "1px solid #fde68a", background: "#fef3c7", cursor: "pointer" }}>
                            {testingTarget === "cashier" ? "..." : "Test"}
                          </button>
                        </div>
                        <select
                          value={printerConfig.cashierPrinter.type}
                          onChange={(e) => setPrinterConfig({ ...printerConfig, cashierPrinter: { ...printerConfig.cashierPrinter, type: e.target.value } })}
                          style={{ padding: "0.35rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }}
                        >
                          <option value="Usb">USB / İşletim Sistemi Kuyruğu</option>
                          <option value="Network">Ağ / TCP 9100</option>
                          <option value="Console">Sadece Konsol (Test)</option>
                          <option value="Disabled">Devre Dışı</option>
                        </select>
                        {printerConfig.cashierPrinter.type === "Network" && (
                          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.35rem" }}>
                            <input
                              value={printerConfig.cashierPrinter.ipAddress}
                              onChange={(e) => setPrinterConfig({ ...printerConfig, cashierPrinter: { ...printerConfig.cashierPrinter, ipAddress: e.target.value } })}
                              placeholder="192.168.1.100"
                              style={{ padding: "0.35rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }}
                            />
                            <input
                              type="number"
                              value={printerConfig.cashierPrinter.port}
                              onChange={(e) => setPrinterConfig({ ...printerConfig, cashierPrinter: { ...printerConfig.cashierPrinter, port: Number(e.target.value) || 9100 } })}
                              placeholder="9100"
                              style={{ padding: "0.35rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }}
                            />
                          </div>
                        )}
                        {printerConfig.cashierPrinter.type === "Usb" && (
                          <input
                            list={`branch-printers-${activeBranchId}`}
                            value={printerConfig.cashierPrinter.systemPrinterName ?? ""}
                            onChange={(e) => setPrinterConfig({ ...printerConfig, cashierPrinter: { ...printerConfig.cashierPrinter, systemPrinterName: e.target.value } })}
                            placeholder="USB Yazıcı Adı (boş=otomatik)"
                            style={{ padding: "0.35rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }}
                          />
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                      <div style={{ fontSize: "0.8rem", color: printerFeedback?.tone === "err" ? "#b91c1c" : "#15803d" }}>
                        {printerFeedback?.text ?? ""}
                      </div>
                      <button type="submit" className="primary-button" disabled={printerSaving}>
                        {printerSaving ? "Kaydediliyor..." : "Şube Yazıcı Ayarlarını Kaydet"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
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
