import { useEffect, useRef, useState } from "react";
import { posFetch, type PosAppKind } from "../terminalScope";

export interface PrinterTargetDto {
  name?: string;
  type?: string;
  enabled?: boolean;
  ipAddress?: string;
  port?: number;
  systemPrinterName?: string | null;
  fallbackToUsb?: boolean;
}

export interface PrinterConfigDto {
  deliveryMode?: string;
  mode?: string;
  autoPrintKitchenOnOrder?: boolean;
  autoSplitKitchenByStation?: boolean;
  kitchenPrinter?: PrinterTargetDto;
  barPrinter?: PrinterTargetDto;
  cashierPrinter?: PrinterTargetDto;
}

export interface BridgePrinterDeviceDto {
  name: string;
  port?: string | null;
  driver?: string | null;
  isDefault?: boolean;
}

export interface BridgeStatusDto {
  connected: boolean;
  activeStreamCount: number;
  lastSeenAt?: string | null;
  bridges?: Array<{
    bridgeId: string;
    hostname: string;
    platform: string;
    localIps?: string[];
    version?: string | null;
    lastHeartbeatAt: string;
  }>;
  availablePrinters?: BridgePrinterDeviceDto[];
  lastJobResult?: {
    jobId?: string | null;
    target: string;
    success: boolean;
    transport?: string | null;
    message?: string | null;
    at: string;
  } | null;
}

interface PrinterFormState {
  deliveryMode: string;
  autoPrintKitchenOnOrder: boolean;
  autoSplitKitchenByStation: boolean;
  kitchenType: string;
  kitchenIp: string;
  kitchenPort: number;
  kitchenSystemPrinterName: string;
  barEnabled: boolean;
  barType: string;
  barIp: string;
  barPort: number;
  barSystemPrinterName: string;
  cashierType: string;
  cashierIp: string;
  cashierPort: number;
  cashierSystemPrinterName: string;
}

const DEFAULT_FORM: PrinterFormState = {
  deliveryMode: "Auto",
  autoPrintKitchenOnOrder: true,
  autoSplitKitchenByStation: true,
  kitchenType: "Network",
  kitchenIp: "192.168.1.116",
  kitchenPort: 9100,
  kitchenSystemPrinterName: "",
  barEnabled: false,
  barType: "Network",
  barIp: "192.168.1.117",
  barPort: 9100,
  barSystemPrinterName: "",
  cashierType: "Usb",
  cashierIp: "192.168.1.100",
  cashierPort: 9100,
  cashierSystemPrinterName: "",
};

function dtoToForm(res: PrinterConfigDto): PrinterFormState {
  return {
    deliveryMode: res.deliveryMode ?? res.mode ?? "Auto",
    autoPrintKitchenOnOrder: res.autoPrintKitchenOnOrder ?? true,
    autoSplitKitchenByStation: res.autoSplitKitchenByStation ?? true,
    kitchenType: res.kitchenPrinter?.type ?? "Network",
    kitchenIp: res.kitchenPrinter?.ipAddress ?? "192.168.1.116",
    kitchenPort: res.kitchenPrinter?.port ?? 9100,
    kitchenSystemPrinterName: res.kitchenPrinter?.systemPrinterName ?? "",
    barEnabled: Boolean(
      res.barPrinter?.enabled &&
      (res.barPrinter?.type ?? "Disabled").toLowerCase() !== "disabled",
    ),
    barType:
      res.barPrinter?.type && res.barPrinter.type !== "Disabled"
        ? res.barPrinter.type
        : "Network",
    barIp: res.barPrinter?.ipAddress ?? "192.168.1.117",
    barPort: res.barPrinter?.port ?? 9100,
    barSystemPrinterName: res.barPrinter?.systemPrinterName ?? "",
    cashierType: res.cashierPrinter?.type ?? "Usb",
    cashierIp: res.cashierPrinter?.ipAddress ?? "192.168.1.100",
    cashierPort: res.cashierPrinter?.port ?? 9100,
    cashierSystemPrinterName: res.cashierPrinter?.systemPrinterName ?? "",
  };
}

export function PrinterSettingsModal({
  open,
  firmId,
  branchId,
  appKind,
  onClose,
  onSaved,
}: {
  open: boolean;
  firmId: string;
  branchId: string;
  appKind: PosAppKind;
  onClose: () => void;
  onSaved?: (notice: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<PrinterFormState>(DEFAULT_FORM);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatusDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testPrinting, setTestPrinting] = useState<string | null>(null);
  const [ipTestingTarget, setIpTestingTarget] = useState<string | null>(null);
  const [ipTestResults, setIpTestResults] = useState<
    Record<string, { reachable: boolean; latencyMs: number; error?: string; bridgeConnected?: boolean }>
  >({});
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const actor = appKind === "cashier" ? "pos-cashier" : "pos-single";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function loadAll() {
    setLoading(true);
    setFeedback(null);
    setIpTestResults({});
    try {
      const [cfgRes, bridgeRes] = await Promise.all([
        posFetch(`/api/v1/firms/${encodeURIComponent(firmId)}/branches/${encodeURIComponent(branchId)}/printing/config`, {
          appKind,
          demoActor: actor,
        }),
        posFetch(`/api/v1/firms/${encodeURIComponent(firmId)}/branches/${encodeURIComponent(branchId)}/printing/bridge-status`, {
          appKind,
          demoActor: actor,
        }),
      ]);

      if (cfgRes.ok) {
        const cfgJson = (await cfgRes.json()) as PrinterConfigDto;
        setForm(dtoToForm(cfgJson));
      }
      if (bridgeRes.ok) {
        const bridgeJson = (await bridgeRes.json()) as BridgeStatusDto;
        setBridgeStatus(bridgeJson);
      }
    } catch {
      // Yüklenemese de form varsayılanlarla açılır
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, firmId, branchId]);

  function applyPreset(preset: "single_usb" | "two_printers" | "three_printers") {
    setIpTestResults({});
    setFeedback(null);
    if (preset === "single_usb") {
      setForm((prev) => ({
        ...prev,
        deliveryMode: "Auto",
        kitchenType: "Usb",
        barEnabled: false,
        cashierType: "Usb",
      }));
    } else if (preset === "two_printers") {
      setForm((prev) => ({
        ...prev,
        deliveryMode: "CloudBridge",
        kitchenType: "Network",
        kitchenIp: prev.kitchenIp && prev.kitchenIp !== "127.0.0.1" ? prev.kitchenIp : "192.168.1.201",
        barEnabled: false,
        cashierType: "Usb",
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        deliveryMode: "CloudBridge",
        autoSplitKitchenByStation: true,
        kitchenType: "Network",
        kitchenIp: prev.kitchenIp && prev.kitchenIp !== "127.0.0.1" ? prev.kitchenIp : "192.168.1.201",
        barEnabled: true,
        barType: "Network",
        barIp: prev.barIp && prev.barIp !== "127.0.0.1" ? prev.barIp : "192.168.1.202",
        cashierType: "Usb",
      }));
    }
  }

  async function testIp(target: "kitchen" | "bar" | "cashier", ip: string, port: number) {
    if (ipTestingTarget || !ip.trim()) return;
    setIpTestingTarget(target);
    try {
      const res = await posFetch(
        `/api/v1/firms/${encodeURIComponent(firmId)}/branches/${encodeURIComponent(branchId)}/printing/check-connection?ip=${encodeURIComponent(ip.trim())}&port=${port || 9100}`,
        { appKind, demoActor: actor },
      );
      const data = (await res.json()) as {
        reachable: boolean;
        latencyMs: number;
        error?: string;
        bridgeConnected?: boolean;
      };
      setIpTestResults((prev) => ({ ...prev, [target]: data }));
    } catch (err) {
      setIpTestResults((prev) => ({
        ...prev,
        [target]: {
          reachable: false,
          latencyMs: -1,
          error: err instanceof Error ? err.message : "Bağlantı testi başarısız.",
        },
      }));
    } finally {
      setIpTestingTarget(null);
    }
  }

  async function runTestPrint(target: "kitchen" | "bar" | "cashier") {
    if (testPrinting) return;
    setTestPrinting(target);
    setFeedback(null);
    try {
      const res = await posFetch(
        `/api/v1/firms/${encodeURIComponent(firmId)}/branches/${encodeURIComponent(branchId)}/printing/test?target=${target}`,
        { appKind, demoActor: actor, method: "POST", body: "{}" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        transportUsed?: string;
        error?: string;
        message?: string;
        detail?: string;
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.error ?? data.message ?? data.detail ?? "Test fişi yazdırılamadı.");
      }
      const label = target === "kitchen" ? "Mutfak" : target === "bar" ? "Bar / İçecek" : "Kasa";
      setFeedback({
        kind: "success",
        text: `🧪 ${label} test fişi gönderildi (${data.transportUsed ?? "OK"}).`,
      });
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Test fişi gönderilemedi.",
      });
    } finally {
      setTestPrinting(null);
    }
  }

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await posFetch(
        `/api/v1/firms/${encodeURIComponent(firmId)}/branches/${encodeURIComponent(branchId)}/printing/config`,
        {
          appKind,
          demoActor: actor,
          method: "POST",
          body: JSON.stringify({
            deliveryMode: form.deliveryMode,
            autoPrintKitchenOnOrder: form.autoPrintKitchenOnOrder,
            autoSplitKitchenByStation: form.autoSplitKitchenByStation,
            kitchenType: form.kitchenType,
            kitchenEnabled: form.kitchenType !== "Disabled",
            kitchenIp: form.kitchenIp.trim(),
            kitchenPort: Number(form.kitchenPort) || 9100,
            kitchenSystemPrinterName: form.kitchenSystemPrinterName,
            kitchenFallbackToUsb: form.kitchenType === "Usb",
            barEnabled: form.barEnabled,
            barType: form.barEnabled ? form.barType : "Disabled",
            barIp: form.barIp.trim(),
            barPort: Number(form.barPort) || 9100,
            barSystemPrinterName: form.barSystemPrinterName,
            barFallbackToUsb: form.barType === "Usb",
            cashierType: form.cashierType,
            cashierEnabled: form.cashierType !== "Disabled",
            cashierIp: form.cashierIp.trim(),
            cashierPort: Number(form.cashierPort) || 9100,
            cashierSystemPrinterName: form.cashierSystemPrinterName,
            cashierFallbackToUsb: true,
          }),
        },
      );
      if (!res.ok) {
        const problem = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };
        throw new Error(problem.message ?? problem.detail ?? `Kaydedilemedi (${res.status}).`);
      }
      const saved = (await res.json()) as PrinterConfigDto;
      setForm(dtoToForm(saved));
      onSaved?.("✅ Şube yazıcı ayarları veritabanına kaydedildi!");
      onClose();
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Yazıcı ayarları kaydedilemedi.",
      });
    } finally {
      setSaving(false);
    }
  }

  const detectedPrinters = bridgeStatus?.availablePrinters ?? [];
  const activeBridgeNode = bridgeStatus?.bridges?.[0];

  function renderUsbPrinterPicker(
    value: string,
    onChange: (next: string) => void,
    placeholder: string,
  ) {
    return (
      <div style={{ display: "grid", gap: "6px", marginTop: "6px" }}>
        <label className="waiter-note-field" style={{ margin: 0 }}>
          Bilgisayardaki USB / Sistem Yazıcı Adı (Boş bırakılırsa otomatik bulunur)
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
          />
        </label>
        {detectedPrinters.length > 0 && (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "11px", color: "#475569" }}>Köprüde bulunanlar:</span>
            {detectedPrinters.map((p) => (
              <button
                key={p.name}
                type="button"
                className="waiter-quiet-action"
                style={{
                  fontSize: "11px",
                  padding: "2px 7px",
                  background: value === p.name ? "#dbeafe" : "#fff",
                  borderColor: value === p.name ? "#3b82f6" : "#cbd5e1",
                  color: "#1e293b",
                }}
                onClick={() => onChange(p.name)}
              >
                🖨️ {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderTargetResult(key: string) {
    const res = ipTestResults[key];
    if (!res) return null;
    return (
      <div
        style={{
          marginTop: "8px",
          fontSize: "12px",
          padding: "7px 10px",
          borderRadius: "6px",
          background: res.reachable ? "#f0fdf4" : res.bridgeConnected ? "#eff6ff" : "#fef2f2",
          border: `1px solid ${res.reachable ? "#bbf7d0" : res.bridgeConnected ? "#bfdbfe" : "#fecaca"}`,
          color: res.reachable ? "#166534" : res.bridgeConnected ? "#1e40af" : "#991b1b",
        }}
      >
        {res.reachable
          ? `🟢 Ulaşıldı (${res.latencyMs} ms) — Yazıcı hazır.`
          : `${res.bridgeConnected ? "ℹ️" : "🔴"} ${res.error ?? "Bağlantı zaman aşımına uğradı."}`}
      </div>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="waiter-reservation-dialog"
      aria-labelledby="printer-settings-title"
      onCancel={(e) => {
        if (saving) e.preventDefault();
        else onClose();
      }}
      onClose={onClose}
    >
      {open && (
        <form
          className="waiter-custom-modal"
          style={{ maxWidth: "660px", maxHeight: "90vh", overflowY: "auto" }}
          onSubmit={(e) => void saveConfig(e)}
        >
          <header>
            <div>
              <span className="ops-eyebrow">ŞUBE DONANIM & YAZICI YÖNETİMİ</span>
              <h2 id="printer-settings-title">Yazıcı Yapılandırması</h2>
            </div>
            <button
              type="button"
              className="waiter-modal-close"
              onClick={onClose}
              aria-label="Kapat"
            >
              ×
            </button>
          </header>

          {/* Köprü Durumu & Hızlı Teslimat Bilgisi */}
          <div
            style={{
              marginTop: "10px",
              padding: "10px 12px",
              borderRadius: "8px",
              background: bridgeStatus?.connected ? "#f0fdf4" : "#fff7ed",
              border: `1px solid ${bridgeStatus?.connected ? "#86efac" : "#fed7aa"}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: "12.5px", color: bridgeStatus?.connected ? "#14532d" : "#9a3412" }}>
              {bridgeStatus?.connected ? (
                <>
                  <strong>🟢 Print Bridge Çevrimiçi</strong>
                  {activeBridgeNode && (
                    <span>
                      {" "}
                      — {activeBridgeNode.hostname} ({activeBridgeNode.localIps?.[0] ?? activeBridgeNode.platform})
                    </span>
                  )}
                  <div style={{ fontSize: "11px", opacity: 0.9 }}>
                    Fişler buluttan veya yerelden bu mağaza bilgisayarına anında iletilir.
                  </div>
                </>
              ) : (
                <>
                  <strong>🔴 Yerel Yazıcı Köprüsü (Print Bridge) Bağlı Değil</strong>
                  <div style={{ fontSize: "11px" }}>
                    Bulut sunucu kullanıyorsanız şubedeki Kasa PC&apos;de Print Bridge&apos;i başlatın (Admin &gt; Şubeler).
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              className="waiter-quiet-action"
              style={{ fontSize: "11.5px", padding: "4px 9px" }}
              disabled={loading}
              onClick={() => void loadAll()}
            >
              {loading ? "Yenileniyor…" : "🔄 Durumu Yenile"}
            </button>
          </div>

          {feedback && (
            <p
              role={feedback.kind === "error" ? "alert" : "status"}
              className={feedback.kind === "error" ? "ops-error" : "ops-success"}
              style={{ marginTop: "10px", padding: "8px 10px", borderRadius: "6px" }}
            >
              {feedback.text}
            </p>
          )}

          {/* Hızlı Hazır Profiller */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "6px", margin: "12px 0" }}>
            <button
              type="button"
              className="waiter-quiet-action"
              style={{ fontSize: "11.5px", padding: "7px 8px" }}
              onClick={() => applyPreset("single_usb")}
            >
              🏠 Tek PC (USB Test)
            </button>
            <button
              type="button"
              className="waiter-quiet-action"
              style={{ fontSize: "11.5px", padding: "7px 8px" }}
              onClick={() => applyPreset("two_printers")}
            >
              🏢 Mutfak (Ağ) + Kasa (USB)
            </button>
            <button
              type="button"
              className="waiter-quiet-action"
              style={{ fontSize: "11.5px", padding: "7px 8px" }}
              onClick={() => applyPreset("three_printers")}
            >
              🍸 Mutfak + Bar + Kasa
            </button>
          </div>

          <section style={{ margin: "10px 0", padding: "10px 12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", display: "grid", gap: "8px" }}>
            <label className="waiter-select" style={{ margin: 0 }}>
              Fiş Teslimat Yolu
              <select
                value={form.deliveryMode}
                onChange={(e) => setForm((f) => ({ ...f, deliveryMode: e.target.value }))}
              >
                <option value="Auto">Otomatik (Köprü bağlıysa Köprü, değilse Yerel Ağ/USB)</option>
                <option value="CloudBridge">Bulut Köprüsü (Print Bridge SSE — Uzak Sunucu için Önerilen)</option>
                <option value="DirectLan">Doğrudan Yerel Ağ / USB (Yerel API Kurulumu)</option>
              </select>
            </label>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", fontSize: "12.5px", color: "#334155" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={form.autoPrintKitchenOnOrder}
                  onChange={(e) => setForm((f) => ({ ...f, autoPrintKitchenOnOrder: e.target.checked }))}
                />
                Sipariş gönderilince otomatik fiş bas
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={form.autoSplitKitchenByStation}
                  onChange={(e) => setForm((f) => ({ ...f, autoSplitKitchenByStation: e.target.checked }))}
                />
                Yiyecek / İçecek istasyonlarına göre fişi otomatik böl
              </label>
            </div>
          </section>

          {/* 1. MUTFAK YAZICISI */}
          <section style={{ margin: "10px 0", padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <h3 style={{ fontSize: "14px", margin: "0 0 6px", color: "#1e293b" }}>🍳 1. Mutfak Yazıcısı (Yiyecek İstasyonu)</h3>
            <label className="waiter-select" style={{ marginBottom: "8px" }}>
              Bağlantı Türü
              <select
                value={form.kitchenType}
                onChange={(e) => setForm((f) => ({ ...f, kitchenType: e.target.value }))}
              >
                <option value="Network">Ağ / Ethernet / Wi-Fi (TCP Port 9100)</option>
                <option value="Usb">USB / Windows veya Mac Yazıcı Kuyruğu</option>
                <option value="Disabled">Devre Dışı</option>
              </select>
            </label>
            {form.kitchenType === "Network" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
                  <label className="waiter-note-field">
                    Mutfak IP Adresi
                    <input
                      value={form.kitchenIp}
                      onChange={(e) => setForm((f) => ({ ...f, kitchenIp: e.target.value }))}
                      placeholder="192.168.1.201"
                    />
                  </label>
                  <label className="waiter-note-field">
                    Port
                    <input
                      type="number"
                      value={form.kitchenPort}
                      onChange={(e) => setForm((f) => ({ ...f, kitchenPort: Number(e.target.value) || 9100 }))}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="waiter-quiet-action"
                    style={{ fontSize: "12px" }}
                    disabled={Boolean(ipTestingTarget) || !form.kitchenIp.trim()}
                    onClick={() => void testIp("kitchen", form.kitchenIp, form.kitchenPort)}
                  >
                    {ipTestingTarget === "kitchen" ? "Kontrol ediliyor…" : "🔍 IP Ping"}
                  </button>
                  <button
                    type="button"
                    className="waiter-quiet-action"
                    style={{ fontSize: "12px", background: "#e0f2fe", borderColor: "#bae6fd" }}
                    disabled={Boolean(testPrinting)}
                    onClick={() => void runTestPrint("kitchen")}
                  >
                    {testPrinting === "kitchen" ? "Gönderiliyor…" : "🧪 Mutfak Test Fişi"}
                  </button>
                </div>
                {renderTargetResult("kitchen")}
              </>
            )}
            {form.kitchenType === "Usb" && (
              <>
                {renderUsbPrinterPicker(
                  form.kitchenSystemPrinterName,
                  (val) => setForm((f) => ({ ...f, kitchenSystemPrinterName: val })),
                  "Örn: KodPOS_Mutfak",
                )}
                <button
                  type="button"
                  className="waiter-quiet-action"
                  style={{ marginTop: "8px", fontSize: "12px", background: "#e0f2fe", borderColor: "#bae6fd" }}
                  disabled={Boolean(testPrinting)}
                  onClick={() => void runTestPrint("kitchen")}
                >
                  {testPrinting === "kitchen" ? "Gönderiliyor…" : "🧪 Mutfak Test Fişi (USB)"}
                </button>
              </>
            )}
          </section>

          {/* 2. BAR / İÇECEK YAZICISI */}
          <section style={{ margin: "10px 0", padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <h3 style={{ fontSize: "14px", margin: 0, color: "#1e293b" }}>🍸 2. Bar / İçecek Yazıcısı</h3>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={form.barEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, barEnabled: e.target.checked }))}
                />
                Ayrı Bar Yazıcısı Kullan
              </label>
            </div>
            {!form.barEnabled ? (
              <p style={{ fontSize: "12px", color: "#64748b", margin: "6px 0 0" }}>
                Kapalıyken tüm içecek kalemleri de Mutfak yazıcısındaki tek adisyonda çıkar.
              </p>
            ) : (
              <div style={{ marginTop: "8px" }}>
                <label className="waiter-select" style={{ marginBottom: "8px" }}>
                  Bağlantı Türü
                  <select
                    value={form.barType}
                    onChange={(e) => setForm((f) => ({ ...f, barType: e.target.value }))}
                  >
                    <option value="Network">Ağ / Ethernet (TCP Port 9100)</option>
                    <option value="Usb">USB / Sistem Yazıcı Kuyruğu</option>
                  </select>
                </label>
                {form.barType === "Network" ? (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
                      <label className="waiter-note-field">
                        Bar IP Adresi
                        <input
                          value={form.barIp}
                          onChange={(e) => setForm((f) => ({ ...f, barIp: e.target.value }))}
                          placeholder="192.168.1.202"
                        />
                      </label>
                      <label className="waiter-note-field">
                        Port
                        <input
                          type="number"
                          value={form.barPort}
                          onChange={(e) => setForm((f) => ({ ...f, barPort: Number(e.target.value) || 9100 }))}
                        />
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="waiter-quiet-action"
                        style={{ fontSize: "12px" }}
                        disabled={Boolean(ipTestingTarget) || !form.barIp.trim()}
                        onClick={() => void testIp("bar", form.barIp, form.barPort)}
                      >
                        {ipTestingTarget === "bar" ? "Kontrol ediliyor…" : "🔍 IP Ping"}
                      </button>
                      <button
                        type="button"
                        className="waiter-quiet-action"
                        style={{ fontSize: "12px", background: "#f3e8ff", borderColor: "#d8b4fe" }}
                        disabled={Boolean(testPrinting)}
                        onClick={() => void runTestPrint("bar")}
                      >
                        {testPrinting === "bar" ? "Gönderiliyor…" : "🧪 Bar Test Fişi"}
                      </button>
                    </div>
                    {renderTargetResult("bar")}
                  </>
                ) : (
                  <>
                    {renderUsbPrinterPicker(
                      form.barSystemPrinterName,
                      (val) => setForm((f) => ({ ...f, barSystemPrinterName: val })),
                      "Örn: Bar_Yazici",
                    )}
                    <button
                      type="button"
                      className="waiter-quiet-action"
                      style={{ marginTop: "8px", fontSize: "12px", background: "#f3e8ff", borderColor: "#d8b4fe" }}
                      disabled={Boolean(testPrinting)}
                      onClick={() => void runTestPrint("bar")}
                    >
                      {testPrinting === "bar" ? "Gönderiliyor…" : "🧪 Bar Test Fişi (USB)"}
                    </button>
                  </>
                )}
              </div>
            )}
          </section>

          {/* 3. KASA YAZICISI */}
          <section style={{ margin: "10px 0", padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <h3 style={{ fontSize: "14px", margin: "0 0 6px", color: "#1e293b" }}>🧾 3. Kasa / Adisyon Yazıcısı</h3>
            <label className="waiter-select" style={{ marginBottom: "8px" }}>
              Bağlantı Türü
              <select
                value={form.cashierType}
                onChange={(e) => setForm((f) => ({ ...f, cashierType: e.target.value }))}
              >
                <option value="Usb">USB / Kasa PC Yazıcısı (Gprinter / KodPOS)</option>
                <option value="Network">Ağ / TCP Soket (Port 9100)</option>
                <option value="Disabled">Devre Dışı</option>
              </select>
            </label>
            {form.cashierType === "Network" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
                  <label className="waiter-note-field">
                    Kasa Yazıcı IP Adresi
                    <input
                      value={form.cashierIp}
                      onChange={(e) => setForm((f) => ({ ...f, cashierIp: e.target.value }))}
                      placeholder="192.168.1.100"
                    />
                  </label>
                  <label className="waiter-note-field">
                    Port
                    <input
                      type="number"
                      value={form.cashierPort}
                      onChange={(e) => setForm((f) => ({ ...f, cashierPort: Number(e.target.value) || 9100 }))}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="waiter-quiet-action"
                    style={{ fontSize: "12px" }}
                    disabled={Boolean(ipTestingTarget) || !form.cashierIp.trim()}
                    onClick={() => void testIp("cashier", form.cashierIp, form.cashierPort)}
                  >
                    {ipTestingTarget === "cashier" ? "Kontrol ediliyor…" : "🔍 IP Ping"}
                  </button>
                  <button
                    type="button"
                    className="waiter-quiet-action"
                    style={{ fontSize: "12px", background: "#fef3c7", borderColor: "#fde68a" }}
                    disabled={Boolean(testPrinting)}
                    onClick={() => void runTestPrint("cashier")}
                  >
                    {testPrinting === "cashier" ? "Gönderiliyor…" : "🧪 Kasa Test Fişi"}
                  </button>
                </div>
                {renderTargetResult("cashier")}
              </>
            )}
            {form.cashierType === "Usb" && (
              <>
                {renderUsbPrinterPicker(
                  form.cashierSystemPrinterName,
                  (val) => setForm((f) => ({ ...f, cashierSystemPrinterName: val })),
                  "Örn: KodPOS_Kasa",
                )}
                <button
                  type="button"
                  className="waiter-quiet-action"
                  style={{ marginTop: "8px", fontSize: "12px", background: "#fef3c7", borderColor: "#fde68a" }}
                  disabled={Boolean(testPrinting)}
                  onClick={() => void runTestPrint("cashier")}
                >
                  {testPrinting === "cashier" ? "Gönderiliyor…" : "🧪 Kasa Test Fişi (USB)"}
                </button>
              </>
            )}
          </section>

          <footer>
            <button type="button" className="waiter-cancel-custom" onClick={onClose}>
              Kapat
            </button>
            <button type="submit" className="ops-primary" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Ayarları Kaydet"}
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}
