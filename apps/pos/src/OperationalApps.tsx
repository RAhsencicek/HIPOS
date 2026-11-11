import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createRequestId } from "./requestId";
import { ProductOptionPicker, type SelectedOption, type OptionSelection } from "./ProductOptionPicker";
import "./operational.css";
import { PinPadModal } from "./components/PinPadModal";
import { PrinterSettingsModal } from "./components/PrinterSettingsModal";
import {
  POS_API_BASE,
  POS_AUTH_CHANGED_EVENT,
  buildPosTerminalHref,
  clearPosSession,
  getPosAppKind,
  getPosSession,
  getPosToken,
  getTerminalScope,
  posFetch,
  savePosSession,
  useTerminalScope,
  type PosSession,
} from "./terminalScope";

const money = (minor: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(minor / 100);
type ApiProblem = { code?: string; detail?: string; message?: string };
type ApiRequestError = Error & { status?: number; code?: string };
type ProductOption = { groupName: string; optionName: string };
type CartLine = { cartId: string; productId: string; quantity: number; note: string; options: SelectedOption[] };
type Product = { id: string; name: string; sku?: string; category: { id: string; name: string }; image: string; status: string; isActive: boolean; channels: string[]; desiredChannels: string[]; price: { amountMinor: number; currency: string }; isOutOfStock?: boolean; isCriticalStock?: boolean; availablePortions?: number | null; limitingIngredientName?: string | null };
type MenuSection = { sectionId: string; name: string; productIds: string[] };
type RestaurantMenu = { id: string; name: string; isActive: boolean; sections: MenuSection[] };
type MenuWorkspace = { items: RestaurantMenu[]; categories: Array<{ id: string; name: string; isActive: boolean }>;
  products: Array<{ id: string; name: string; sku?: string; categoryId: string; status: string; isActive: boolean; channels: string[]; desiredChannels: string[]; image: string; price: { amountMinor: number; currency: string }; isOutOfStock?: boolean; isCriticalStock?: boolean; availablePortions?: number | null; limitingIngredientName?: string | null }> };
type Waiter = { id: string; name: string; isActive: boolean };
type TableGroup = { id: string; primaryTableId: string; tableIds: string[]; tableNames: string[]; guestCount: number; version: number; closedAt: string | null };
type CheckAdjustment = { requestId?: string; action: "discount" | "comp" | "void"; valueType?: "percentage" | "fixed" | null; value?: number | null; orderLineId?: number | null; quantity: number; amountMinor: number; reason: string; actor?: string; approvalMode?: string; createdAt?: string };
type Table = { id: string; number: number; name: string; isActive: boolean; floor?: string | null; status?: "idle" | "occupied" | "bill_requested" | "reserved"; reservedFor?: string | null; reservationGuestName?: string | null; version?: number; group?: TableGroup | null; assignment?: {
  id: string; orderId: string; orderIds?: string[]; waiterId: string | null; waiterName: string | null; totalMinor: number;
  paymentStatus: string; version: number; grossTotalMinor: number; adjustmentMinor: number; adjustments: CheckAdjustment[];
  items: Array<{ productId: string; productName: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; orderLineId: number; note?: string | null; options?: ProductOption[] }>;
} | null };

function normalizeFloorName(floor?: string | null): string {
  const trimmed = floor?.trim() ?? "";
  if (!trimmed) return "unassigned";
  if (trimmed === "lower") return "Alt kat";
  if (trimmed === "upper") return "Üst kat";
  return trimmed;
}

function buildFloorSections(tables: Table[], configuredFloors: string[] = []): Array<{ key: string; label: string }> {
  const seen = new Set<string>();
  const list: Array<{ key: string; label: string }> = [];
  for (const raw of [...configuredFloors, ...tables.map((t) => t.floor ?? "")]) {
    const normalized = normalizeFloorName(raw);
    if (normalized !== "unassigned" && !seen.has(normalized)) {
      seen.add(normalized);
      list.push({ key: normalized, label: normalized });
    }
  }
  list.push({ key: "unassigned", label: "Katı belirlenmemiş masalar" });
  return list;
}

function useRestaurantRealtime(
  onEvent: (event: { type: string; data?: any }) => void,
  enabled = true,
  authToken?: string | null
) {
  const scope = useTerminalScope();
  const appKind = getPosAppKind();

  useEffect(() => {
    if (!enabled) return;
    const token = authToken ?? getPosToken(appKind);
    if (!token && !import.meta.env.DEV) return;

    const sseUrl = token
      ? `${POS_API_BASE}/api/v1/firms/${scope.firmId}/branches/${scope.branchId}/events/stream?token=${encodeURIComponent(token)}`
      : `${POS_API_BASE}/api/v1/firms/${scope.firmId}/branches/${scope.branchId}/events/stream?actor=pos-single`;
    let eventSource: EventSource | null = null;
    let retryTimeout: number | null = null;
    let isDisposed = false;

    function connect() {
      if (isDisposed) return;
      try {
        eventSource = new EventSource(sseUrl);

        eventSource.addEventListener("connected", () => {
          console.log("⚡ [SSE] Restoran LAN canlı senkronizasyonuna bağlandı.");
        });

        const eventTypes = [
          "table.updated",
          "check.created",
          "check.updated",
          "check.closed",
          "check.cancelled",
          "payment.settled",
          "kitchen.updated",
          "order.created",
          "sync.status_updated",
          "sync.batch_applied",
        ];

        eventTypes.forEach((type) => {
          eventSource?.addEventListener(type, (e: MessageEvent) => {
            console.log(`⚡ [SSE] Anlık olay: ${type}`, e.data);
            if (type === "sync.status_updated" || type === "sync.batch_applied") {
              window.dispatchEvent(new CustomEvent("hipos:sync-updated"));
            }
            try {
              const parsed = JSON.parse(e.data);
              onEvent({ type, data: parsed.data ?? parsed });
            } catch {
              onEvent({ type });
            }
          });
        });

        eventSource.onerror = () => {
          if (isDisposed) return;
          console.warn("⚠️ [SSE] Bağlantı kesildi, yeniden bağlanılıyor...");
          eventSource?.close();
          retryTimeout = window.setTimeout(connect, 3000);
        };
      } catch (err) {
        if (!isDisposed) {
          retryTimeout = window.setTimeout(connect, 5000);
        }
      }
    }

    connect();

    return () => {
      isDisposed = true;
      if (retryTimeout) window.clearTimeout(retryTimeout);
      eventSource?.close();
    };
  }, [onEvent, enabled, authToken, scope.firmId, scope.branchId, appKind]);
}

type BranchSyncStatus = {
  firmId: string;
  branchId: string;
  nodeMode: string;
  localApiReachable: boolean;
  cloudReachable: boolean;
  pendingCount: number;
  blockedCount: number;
  oldestPendingAt?: string | null;
  lastAckAt?: string | null;
  lastCloudCheckAt?: string | null;
  lastError?: string | null;
  uiState: string;
  originNodeId: string;
};

function useBranchSyncStatus(firmId: string, branchId: string, enabled: boolean, actor: string) {
  const [syncStatus, setSyncStatus] = useState<BranchSyncStatus | null>(null);
  const [localReachable, setLocalReachable] = useState(true);
  const [flushing, setFlushing] = useState(false);

  const refreshSyncStatus = useCallback(async () => {
    if (!enabled) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setLocalReachable(false);
      return;
    }
    try {
      const data = await request<BranchSyncStatus>(
        `/api/v1/firms/${encodeURIComponent(firmId)}/branches/${encodeURIComponent(branchId)}/sync/status`,
        actor
      );
      setSyncStatus(data);
      setLocalReachable(true);
    } catch (cause) {
      const err = cause as ApiRequestError | undefined;
      if (!err?.status) setLocalReachable(false);
    }
  }, [enabled, firmId, branchId, actor]);

  const triggerFlush = useCallback(async () => {
    if (!enabled || flushing) return;
    if (syncStatus?.nodeMode !== "lan_hub") {
      await refreshSyncStatus();
      return;
    }
    setFlushing(true);
    try {
      await request(
        `/api/v1/firms/${encodeURIComponent(firmId)}/branches/${encodeURIComponent(branchId)}/sync/flush`,
        actor,
        {}
      );
    } catch {
      // Hata durumunda refreshSyncStatus mevcut outbox/bulut durumunu yansıtır
    } finally {
      setFlushing(false);
      void refreshSyncStatus();
    }
  }, [enabled, flushing, syncStatus?.nodeMode, firmId, branchId, actor, refreshSyncStatus]);

  useEffect(() => {
    if (!enabled) return;
    void refreshSyncStatus();
    const interval = window.setInterval(() => {
      void refreshSyncStatus();
    }, 10_000);
    const onSyncEvt = () => { void refreshSyncStatus(); };
    const onOnline = () => {
      setLocalReachable(true);
      void refreshSyncStatus();
    };
    const onOffline = () => { setLocalReachable(false); };
    window.addEventListener("hipos:sync-updated", onSyncEvt);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("hipos:sync-updated", onSyncEvt);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [enabled, refreshSyncStatus]);

  return { syncStatus, localReachable, flushing, refreshSyncStatus, triggerFlush };
}

function SyncStatusPill({
  syncStatus,
  localReachable,
  apiOffline,
  apiLoading,
  flushing,
  onTrigger,
}: {
  syncStatus: BranchSyncStatus | null;
  localReachable: boolean;
  apiOffline?: boolean;
  apiLoading?: boolean;
  flushing: boolean;
  onTrigger: () => void;
}) {
  let stateClass = "online";
  let dataState = "online_synced";
  let label = syncStatus?.nodeMode === "lan_hub" ? "Bulut Bağlı (LAN)" : "Bulut Bağlı";
  let title = syncStatus?.lastAckAt
    ? `Bulut senkronizasyonu güncel (Son aktarım: ${new Date(syncStatus.lastAckAt).toLocaleTimeString("tr-TR")})`
    : "Bulut bağlantısı aktif";

  if (!localReachable || apiOffline) {
    stateClass = "offline";
    dataState = "offline";
    label = "Bağlantı Yok";
    title = "Yerel POS sunucusuna ulaşılamıyor. Ağ ve sunucu durumunu kontrol edin.";
  } else if (syncStatus?.uiState === "sync_blocked" || (syncStatus?.blockedCount ?? 0) > 0) {
    const blocked = syncStatus?.blockedCount ?? 0;
    stateClass = "blocked";
    dataState = "sync_blocked";
    label = `Eşitleme Durdu (${blocked})`;
    title = syncStatus?.lastError || "Çakışan veya engellenen senkronizasyon kayıtları var; yeniden denemek için tıklayın.";
  } else if (
    syncStatus?.uiState === "lan_pending" ||
    (syncStatus?.nodeMode === "lan_hub" && (!syncStatus.cloudReachable || syncStatus.pendingCount > 0))
  ) {
    const pending = syncStatus?.pendingCount ?? 0;
    stateClass = "lan-pending";
    dataState = "lan_pending";
    label = pending > 0 ? `Yerel Ağda · Bulut Bekliyor (${pending})` : "Yerel Ağda · Bulut Bekliyor";
    title = syncStatus?.lastError
      ? `Yerel ağda çalışıyor (${syncStatus.lastError}). Şimdi buluta eşitlemek için tıklayın.`
      : "Siparişler yerel sunucuda güvende, internet bağlantısı gelince buluta aktarılır. Tıklayarak hemen deneyin.";
  } else if (apiLoading && !syncStatus) {
    stateClass = "checking";
    dataState = "checking";
    label = "Bağlanıyor";
    title = "Sunucu ve senkronizasyon durumu kontrol ediliyor…";
  }

  return (
    <button
      type="button"
      className={`pos-sync-pill ${stateClass}`}
      data-sync-state={dataState}
      disabled={flushing}
      onClick={onTrigger}
      title={title}
    >
      <i className="sync-dot" aria-hidden="true" />
      <span>{flushing ? "Eşitleniyor…" : label}</span>
    </button>
  );
}
type OpenCheck = { id: string; status: string; paymentStatus?: string; tableId?: string | null; version: number; totalMinor: number; paidMinor?: number; remainingMinor?: number; grossTotalMinor: number; adjustmentMinor: number; adjustments: CheckAdjustment[]; payments: Array<{ id: string; amountMinor?: number; status?: string }>; orders: Array<{ id: string; version?: number; remainingMinor?: number; items: Array<{ id: number; productName: string; quantity: number; unitPriceMinor: number; note?: string | null }> }> };
type KitchenStatus = "pending" | "preparing" | "ready" | "served" | "cancelled";
type KitchenStatusItem = { id: string; orderId: string; productName: string; quantity: number; note?: string | null; status: KitchenStatus; statusChangedAt?: string | null };
type Order = { id: string; source: string; status: string; paymentStatus: string; totalMinor: number; createdAt: string; tableName?: string; waiterName?: string; items: Array<{ productName: string; quantity: number; lineTotalMinor?: number; note?: string | null; options?: ProductOption[]; status?: KitchenStatus; statusChangedAt?: string | null }>; kitchenItems?: Array<{ productId: string; productName: string; quantity: number; note?: string | null; options: ProductOption[]; status?: KitchenStatus; statusChangedAt?: string | null }> };
type KitchenTask = { id: string; orderId: string; orderLineId: number; productName: string; quantity: number;
  notes?: string;
  status: "submitted" | "preparing" | "ready" | "served" | "cancelled"; version: number; submittedAt: string;
  preparedAt?: string; readyAt?: string; servedAt?: string; tableName?: string; waiterName?: string;
  cancelledAt?: string; cancellationReason?: string; cancelledBy?: string;
  stationId?: string; stationCode: string; stationName: string };
type KitchenStation = { id: string; code: string; name: string };

function PosProductImage({ image, productId, name }: { image: string; productId: string; name: string }) {
  const [url, setUrl] = useState("");
  const { firmId, branchId } = useTerminalScope();
  useEffect(() => {
    if (!image.startsWith("upload:")) return;
    const controller = new AbortController(); let objectUrl = ""; setUrl("");
    const path = `/api/v1/firms/${firmId}/branches/${branchId}/catalog/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.slice(7))}`;
    void posFetch(path, { demoActor: "pos-single", signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("image unavailable"); return response.blob(); })
      .then(blob => { if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } })
      .catch(() => {});
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image, productId, firmId, branchId]);
  if (!image.startsWith("upload:")) return <>{image || "🍽️"}</>;
  return url ? <img src={url} alt={name} /> : <span aria-label="Görsel yüklenemedi">🍽️</span>;
}

async function request<T>(path: string, actor: string, body?: unknown, method?: "PUT" | "POST" | "DELETE"): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25_000);
  try {
    response = await posFetch(path, {
      demoActor: actor,
      method: method ?? (body ? "POST" : "GET"),
      signal: controller.signal,
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    if (controller.signal.aborted)
      throw new Error("Sunucu zamanında yanıt vermedi. Sipariş kaydedilmiş olabilir; yeniden deneyin, aynı sipariş kimliği kullanılacak.");
    throw new Error("Yerel HIPOS sunucusuna ulaşılamadı. Cihazların aynı Wi-Fi ağına bağlı olduğunu kontrol edin.");
  } finally { window.clearTimeout(timeout); }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as ApiProblem;
    const error = new Error(problem.message ?? problem.detail ?? `İstek başarısız (${response.status}).`) as ApiRequestError;
    error.status = response.status;
    error.code = problem.code;
    throw error;
  }
  return response.json() as Promise<T>;
}

const demoDescriptions: Record<string, string> = {
  "55555555-5555-4555-8555-555555555501": "Domates sosu, mozzarella ve fesleğen.",
  "55555555-5555-4555-8555-555555555502": "Tavuk ve taze sebzeli sandviç.",
  "55555555-5555-4555-8555-555555555503": "Fırınlanmış cheesecake dilimi.",
  "55555555-5555-4555-8555-555555555504": "Taze çekilmiş kahveden hazırlanır.",
  "55555555-5555-4555-8555-555555555505": "Limon ve şekerle hazırlanır.",
  "55555555-5555-4555-8555-555555555506": "Karışık malzemeli, fırından yeni çıkmış pizza.",
};

type CashOverview = { responsibles?: Array<{ id: string; name: string; roleTitle?: string | null }>; registers: Array<{ id: string; name: string; code: string; responsible?: string | null }>; openShifts: Array<{ shift: { id: string; version: number; registerId: string; openedBy: string; openedAt: string; openingCashMinor: number; expectedCashMinor: number | null; retainedFloatMinor?: number | null; droppedRevenueMinor?: number | null } }> };

type ZReportTax = { taxRatePercent: number; taxBaseMinor: number; taxAmountMinor: number; grossTotalMinor: number };
type ZReportTender = { method: string; label: string; amountMinor: number; transactionCount: number };
type ZReport = {
  reportType: "Z" | "X";
  reportNumber: string;
  shiftId: string;
  registerId: string;
  registerCode: string;
  registerName: string;
  firmId: string;
  branchId: string;
  openedAt: string;
  openedBy: string;
  closedAt: string | null;
  closedBy: string | null;
  closeNote: string | null;
  sales: {
    grossSalesMinor: number;
    discountAmountMinor: number;
    compAmountMinor: number;
    voidAmountMinor: number;
    netSalesMinor: number;
    checkCount: number;
  };
  cashDrawer: {
    openingFloatMinor: number;
    cashSalesMinor: number;
    cashInMinor: number;
    cashOutMinor: number;
    expectedCashMinor: number;
    countedCashMinor: number | null;
    differenceMinor: number | null;
    retainedFloatMinor: number | null;
    droppedRevenueMinor: number | null;
  };
  tenders: ZReportTender[];
  taxes: ZReportTax[];
  denominations: Array<{ denominationMinor: number; quantity: number; totalMinor: number }>;
  generatedAt: string;
};

type CashierCustomer = { id: string; name: string; phone: string | null; isActive: boolean; customerBalanceMinor: number };
type CashierCheck = Omit<OpenCheck, "orders" | "payments"> & { createdAt: string; paymentStatus: "unpaid" | "partially_paid" | "paid" | "pending" | "unknown"; payments: Array<{ id: string; amountMinor: number; method: string; provider?: string; status: string; createdAt: string }>; paidMinor: number; remainingMinor: number; orders: Array<{ id: string; version: number; remainingMinor: number; items: Array<{ id: number; productName: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; note?: string | null; options?: ProductOption[] }> }> };
type AccountReceipt = { check: CashierCheck; location: string; printedAt: string };
type QuickCreate = { requestId: string; firstOrderId: string; items: Array<{ productId: string; quantity: number; note?: string | null; options: Array<{ groupId: string; optionId: string; quantity: number }> }>; customerId: null; tableId: null; waiterId: null };
export function CashierApp() {
  const terminalScope = useTerminalScope();
  const { firmId, branchId } = terminalScope;
  const servicePath = `/api/v1/firms/${firmId}/branches/${branchId}/service`;
  const checksPath = `/api/v1/firms/${firmId}/branches/${branchId}/sales/checks`;
  const quickRequestKey = `hipos.quick-create.${firmId}.${branchId}`;
  const morningOpenRequestKey = `hipos.cash-opening.${firmId}.${branchId}`;
  const assignedRegisterKey = `hipos_pos_assigned_register_id.${firmId}.${branchId}`;

  const [cashierSession, setCashierSession] = useState<PosSession | null>(() => getPosSession("cashier"));

  useEffect(() => {
    const sync = () => setCashierSession(getPosSession("cashier"));
    window.addEventListener(POS_AUTH_CHANGED_EVENT, sync);
    return () => window.removeEventListener(POS_AUTH_CHANGED_EVENT, sync);
  }, []);
  const [tables, setTables] = useState<Table[]>([]);
  const [configuredFloors, setConfiguredFloors] = useState<string[]>([]);
  const [cashOverview, setCashOverview] = useState<CashOverview | null>(null);
  const [selectedRegisterId, setSelectedRegisterId] = useState("");
  const [stationModalOpen, setStationModalOpen] = useState(false);
  const [stationMode, setStationMode] = useState<"initial" | "change">("initial");
  const [stationManagerPin, setStationManagerPin] = useState("");
  const [stationError, setStationError] = useState("");
  const initialStationChecked = useRef(false);
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);
  const { syncStatus, localReachable, flushing: syncFlushing, triggerFlush: triggerSyncFlush } = useBranchSyncStatus(
    firmId,
    branchId,
    Boolean(cashierSession),
    "pos-single"
  );

  useEffect(() => {
    if (!cashierSession) return;
    let timer: number;
    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        clearPosSession("cashier");
        setCashierSession(null);
      }, 10 * 60 * 1000);
    };
    const events = ["mousedown", "mousemove", "keypress", "scroll", "touchstart"];
    events.forEach((name) => window.addEventListener(name, resetTimer));
    resetTimer();
    return () => {
      window.clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, resetTimer));
    };
  }, [cashierSession]);
  const [cashError, setCashError] = useState("");
  const [cashLoading, setCashLoading] = useState(true);
  const [cashDialog, setCashDialog] = useState<{ mode: "open" | "close"; registerId: string; shiftId?: string; version?: number; expected?: number } | null>(null);
  const [cashAmount, setCashAmount] = useState("");
  const [cashDenominations, setCashDenominations] = useState<Record<number, number>>({});
  const [cashNote, setCashNote] = useState("");
  const [cashBusy, setCashBusy] = useState(false);
  const [cashActionError, setCashActionError] = useState("");
  const [cashNotice, setCashNotice] = useState("");
  useEffect(() => {
    if (!cashNotice) return;
    const t = window.setTimeout(() => setCashNotice(""), 6000);
    return () => window.clearTimeout(t);
  }, [cashNotice]);
  const [cashRefresh, setCashRefresh] = useState(0); const [responsibleBusy, setResponsibleBusy] = useState(false);
  const [morningAmount, setMorningAmount] = useState("");
  const [morningNote, setMorningNote] = useState("");
  const [morningError, setMorningError] = useState("");
  const [morningConfirming, setMorningConfirming] = useState(false);
  const [morningDismissed, setMorningDismissed] = useState(false);
  const [retainedFloatInput, setRetainedFloatInput] = useState("");
  const [activeZReport, setActiveZReport] = useState<ZReport | null>(null);
  const [zReportPrinting, setZReportPrinting] = useState(false);
  const [drawerOpening, setDrawerOpening] = useState(false);
  const zReportDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = zReportDialogRef.current;
    if (activeZReport && dialog && !dialog.open) dialog.showModal();
    if (!activeZReport && dialog?.open) dialog.close();
  }, [activeZReport]);

  async function openZReport(shiftId: string) {
    try {
      const res = await request<{ report: ZReport }>(
        `/api/v1/firms/${firmId}/branches/${branchId}/cash/shifts/${encodeURIComponent(shiftId)}/z-report`,
        "pos-single"
      );
      setActiveZReport(res.report);
    } catch (cause) {
      setCashNotice(cause instanceof Error ? cause.message : "Z-Raporu alınamadı.");
    }
  }

  async function printZReport(shiftId: string) {
    if (zReportPrinting) return;
    setZReportPrinting(true);
    try {
      const res = await request<{ success: boolean; shiftId: string; target: string; transportUsed: string }>(
        `/api/v1/firms/${firmId}/branches/${branchId}/cash/shifts/${encodeURIComponent(shiftId)}/print-z-report`,
        "pos-single",
        {}
      );
      showPrintToast(
        `${activeZReport?.reportType === "Z" ? "Z-Raporu" : "X-Raporu"} Yazdırıldı`,
        `Kasa termal yazıcısı (${res.transportUsed})`,
        "🧾"
      );
      setCashNotice(`🧾 ${activeZReport?.reportType === "Z" ? "Z-Raporu" : "X-Raporu"} kasa yazıcısına gönderildi (${res.transportUsed}).`);
    } catch (cause) {
      showPrintToast("Z-Raporu Yazdırılamadı", cause instanceof Error ? cause.message : "Yazıcı hatası", "⚠️");
      setCashNotice(cause instanceof Error ? `Yazıcı hatası: ${cause.message}` : "Z-Raporu yazdırılamadı.");
    } finally {
      setZReportPrinting(false);
    }
  }

  async function openCashDrawer() {
    if (drawerOpening) return;
    setDrawerOpening(true);
    try {
      const res = await request<{ success: boolean; target: string; transportUsed: string }>(
        `/api/v1/firms/${firmId}/branches/${branchId}/printing/open-drawer`,
        "pos-single",
        {}
      );
      showPrintToast("Nakit Çekmecesi Açıldı", `RJ11 sinyali gönderildi (${res.transportUsed})`, "💵");
    } catch (cause) {
      showPrintToast("Çekmece Açılamadı", cause instanceof Error ? cause.message : "Yazıcı/Köprü bağlantısı yok", "⚠️");
    } finally {
      setDrawerOpening(false);
    }
  }

  const mainRegister = cashOverview?.registers.find((register) => register.id === selectedRegisterId);
  const activeShift = mainRegister ? cashOverview?.openShifts.find((item) => item.shift.registerId === mainRegister.id)?.shift : undefined;
  const isShiftOpen = Boolean(activeShift);
  const showMorningScreen = !cashLoading && Boolean(mainRegister) && !isShiftOpen && !morningDismissed;

  async function changeResponsible(registerId: string, responsible: string) {
    if (!responsible || responsibleBusy) return;
    setResponsibleBusy(true); setCashActionError(""); setCashNotice("");
    try {
      await request(`/api/v1/firms/${firmId}/branches/${branchId}/cash/registers/${encodeURIComponent(registerId)}/responsible`, "pos-single", { requestId: createRequestId(), responsible }, "PUT");
      setCashNotice(`Kasa sorumlusu ${responsible} olarak güncellendi.`);
      setCashRefresh((value) => value + 1);
    } catch (cause) { setCashError(cause instanceof Error ? cause.message : "Kasa sorumlusu güncellenemedi."); }
    finally { setResponsibleBusy(false); }
  }
  void changeResponsible;

  function selectRegister(id: string) {
    setSelectedRegisterId(id);
    setMorningDismissed(false);
    setMorningConfirming(false);
    setMorningAmount("");
    setMorningNote("");
    setMorningError("");
    setCashNotice("");
  }

  async function handleAssignStation(registerId: string) {
    if (stationMode === "change") {
      if (!stationManagerPin.trim()) {
        setStationError("Kasa değiştirmek için lütfen yönetici PIN kodunuzu girin.");
        return;
      }
      try {
        const res = await fetch(`${POS_API_BASE}/api/v1/auth/pin-verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ firmId, branchId, pin: stationManagerPin, clientType: "cashier" }),
        });
        if (!res.ok) {
          setStationError("Girdiğiniz yönetici PIN kodu hatalı.");
          return;
        }
        const data = await res.json() as { user: { role: string; fullName: string } };
        if (!["owner", "manager"].includes(data.user.role)) {
          setStationError("Bu işlem için yalnız Yönetici / Patron yetkisi geçerlidir.");
          return;
        }
      } catch {
        setStationError("Yetki doğrulaması başarısız oldu.");
        return;
      }
    }

    localStorage.setItem(assignedRegisterKey, registerId);
    selectRegister(registerId);
    setStationModalOpen(false);
    setStationManagerPin("");
    setStationError("");
    const reg = cashOverview?.registers.find((r) => r.id === registerId);
    setCashNotice(`✅ Terminal başarıyla ${reg?.name ?? "Kasaya"} kilitlendi.`);
  }

  const todayFormatted = useMemo(() => {
    return new Intl.DateTimeFormat("tr-TR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date());
  }, []);

  const morningMinor = useMemo(() => {
    const input = morningAmount.trim().replace(/\s/g, "");
    const normalized = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(input) ? input.replaceAll(".", "").replace(",", ".") : input.replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
    const m = Math.round(Number(normalized) * 100);
    return Number.isSafeInteger(m) && m >= 0 ? m : null;
  }, [morningAmount]);

  async function handleOpenMorningShift(amountStr: string, noteStr?: string) {
    if (!mainRegister || cashBusy) return;
    const input = amountStr.trim().replace(/\s/g, "");
    if (!input) { setMorningError("Başlangıç nakit tutarını girin. Avanssız açılış için 0 seçebilirsiniz."); return; }
    const normalized = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(input) ? input.replaceAll(".", "").replace(",", ".") : input.replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) { setMorningError("Geçerli bir TL tutarı girin."); return; }
    const minor = Math.round(Number(normalized) * 100);
    if (!Number.isSafeInteger(minor) || minor < 0 || minor > 999999999999) { setMorningError("Geçerli bir TL tutarı girin."); return; }

    setCashBusy(true);
    setMorningError("");
    const note = noteStr?.trim() || null;
    let pending: { requestId: string; registerId: string; amountMinor: number; note: string | null } | null = null;
    try { pending = JSON.parse(sessionStorage.getItem(morningOpenRequestKey) ?? "null"); } catch { pending = null; }
    if (!pending || pending.registerId !== mainRegister.id || pending.amountMinor !== minor || pending.note !== note) {
      pending = { requestId: createRequestId(), registerId: mainRegister.id, amountMinor: minor, note };
      sessionStorage.setItem(morningOpenRequestKey, JSON.stringify(pending));
    }
    try {
      await request(`/api/v1/firms/${firmId}/branches/${branchId}/cash/shifts`, "pos-single", {
        requestId: pending.requestId,
        registerId: pending.registerId,
        openingCashMinor: pending.amountMinor,
        note: pending.note,
      });
      sessionStorage.removeItem(morningOpenRequestKey);
      setMorningConfirming(false);
      setMorningDismissed(false);
      setCashNotice(`☀️ Günaydın! Vardiya ${money(minor)} başlangıç avansı ile başarıyla açıldı.`);
      setCashRefresh((v) => v + 1);
    } catch (cause) {
      try {
        const latest = await request<CashOverview>(`/api/v1/firms/${firmId}/branches/${branchId}/cash/overview`, "pos-single");
        const confirmed = latest.openShifts.some(item => item.shift.id === pending!.requestId && item.shift.registerId === pending!.registerId);
        if (confirmed) {
          sessionStorage.removeItem(morningOpenRequestKey);
          setMorningConfirming(false);
          setMorningDismissed(false);
          setCashNotice(`☀️ Günaydın! Vardiya ${money(minor)} başlangıç avansı ile başarıyla açıldı.`);
          setCashRefresh((v) => v + 1);
          return;
        }
      } catch { /* Yanıt durumu belirsiz; aynı idempotent istek kimliği saklanır. */ }
      setMorningError("Açılışın sonucu henüz doğrulanamadı. Bağlantı gelince aynı açılış isteği güvenle yeniden denenebilir.");
    } finally {
      setCashBusy(false);
    }
  }

  function handleMorningKeypad(key: string) {
    setMorningError("");
    if (key === "⌫") {
      setMorningAmount((prev) => prev.slice(0, -1));
    } else if (key === "C") {
      setMorningAmount("");
    } else if (key === "+100") {
      const cur = Number(morningAmount.replace(/\./g, "").replace(",", ".")) || 0;
      setMorningAmount(String(cur + 100));
    } else if (key === "+500") {
      const cur = Number(morningAmount.replace(/\./g, "").replace(",", ".")) || 0;
      setMorningAmount(String(cur + 500));
    } else {
      setMorningAmount((prev) => (prev === "0" ? key : prev + key));
    }
  }
  const cashRequestId = useRef<{ key: string; id: string } | null>(null);
  const cashDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = cashDialogRef.current; if (cashDialog && dialog && !dialog.open) dialog.showModal(); if (!cashDialog && dialog?.open) dialog.close(); }, [cashDialog]);
  const [checks, setChecks] = useState<Record<string, CashierCheck[]>>({});
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get("tableId") ?? "");
  const [selectedCheckId, setSelectedCheckId] = useState("");
  const [amountInput, setAmountInput] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "meal" | "cari" | "transfer" | null>(null);
  const [paymentSubMethod, setPaymentSubMethod] = useState(""); const [payBusy, setPayBusy] = useState(false); const [payError, setPayError] = useState(""); const payRequest = useRef<{ key: string; ids: string[] } | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customers, setCustomers] = useState<CashierCustomer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerSelected, setCustomerSelected] = useState<CashierCustomer | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const customerDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = customerDialog.current; if (customerOpen && dialog && !dialog.open) dialog.showModal(); if (!customerOpen && dialog?.open) dialog.close(); }, [customerOpen]);
  useEffect(() => {
    if (!customerOpen) return;
    let live = true;
    setCustomerLoading(true); setCustomerError("");
    request<{ items: CashierCustomer[] }>(`/api/v1/firms/${firmId}/branches/${branchId}/caris?type=customer`, "pos-single")
      .then((result) => { if (live) setCustomers(result.items.filter((item) => item.isActive)); })
      .catch((cause) => { if (live) { setCustomers([]); setCustomerError(cause instanceof Error ? cause.message : "Müşteriler alınamadı."); } })
      .finally(() => { if (live) setCustomerLoading(false); });
    return () => { live = false; };
  }, [customerOpen]);
  const [cashierAction, setCashierAction] = useState<"transfer" | "merge" | "discount" | "comp" | "void" | null>(null);
  const [actionTarget, setActionTarget] = useState("");
  const [actionSources, setActionSources] = useState<string[]>([]);
  const [actionReason, setActionReason] = useState("");
  const [actionValue, setActionValue] = useState("");
  const [actionValueType, setActionValueType] = useState<"percentage" | "fixed">("percentage");
  const [actionLine, setActionLine] = useState("");
  const [actionQuantity, setActionQuantity] = useState(1);
  const [actionManagerPin, setActionManagerPin] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const actionDialog = useRef<HTMLDialogElement>(null);
  const actionRequest = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => { const dialog = actionDialog.current; if (cashierAction && dialog && !dialog.open) dialog.showModal(); if (!cashierAction && dialog?.open) dialog.close(); }, [cashierAction]);
  const [splitCheck, setSplitCheck] = useState<CashierCheck | null>(null);
  const [cashierMode, setCashierMode] = useState<"tables" | "quick">("tables");
  const [quickStep, setQuickStep] = useState<"menu" | "payment">("menu");
  const [quickCart, setQuickCart] = useState<Array<{ id: string; product: Product; quantity: number; options: SelectedOption[] }>>([]);
  const [quickOptionProduct, setQuickOptionProduct] = useState<Product | null>(null);
  const [quickOptionSelection, setQuickOptionSelection] = useState<OptionSelection | null>(null);
  const [quickActiveCheck, setQuickActiveCheck] = useState<CashierCheck | null>(null);
  const [orderSentToast, setOrderSentToast] = useState<{ id: string; label: string; count: number; totalMinor: number } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [lastCompletedReceipt, setLastCompletedReceipt] = useState<AccountReceipt | null>(null);
  const [printToast, setPrintToast] = useState<{ title: string; subtitle?: string; icon?: string } | null>(null);
  const printToastTimer = useRef<number | null>(null);

  function showPrintToast(title: string, subtitle?: string, icon: string = "🧾") {
    if (printToastTimer.current) window.clearTimeout(printToastTimer.current);
    setPrintToast({ title, subtitle, icon });
    printToastTimer.current = window.setTimeout(() => {
      setPrintToast(null);
    }, 2200);
  }

  async function printThermalCashierBill(checkId: string, openCashDrawer: boolean = false, paymentMethod: string = "NAKIT") {
    try {
      const res = await request<{ success: boolean; target: string; transportUsed: string }>(
        `${checksPath}/${encodeURIComponent(checkId)}/print-bill?openCashDrawer=${openCashDrawer}&paymentMethod=${encodeURIComponent(paymentMethod)}`,
        "pos-single",
        {}
      );
      showPrintToast("Adisyon Fişi Yazıcıya İletildi", `Termal Yazıcı (${res.transportUsed})`, "🧾");
      setSplitNotice(`🧾 Adisyon fişi basıldı (${res.transportUsed})`);
      return true;
    } catch (cause) {
      console.warn("Termal adisyon fişi basılamadı:", cause);
      showPrintToast("Yazıcıya Ulaşılamadı", cause instanceof Error ? cause.message : "Bağlantı hatası", "⚠️");
      return false;
    }
  }

  function printAccountReceipt(receipt: AccountReceipt, openCashDrawer: boolean = false, paymentMethod: string = "NAKIT") {
    void printThermalCashierBill(receipt.check.id, openCashDrawer, paymentMethod);
    showPrintToast("Tahsilat Tamamlandı", "Adisyon fişi termal yazıcıya aktarıldı", "🧾");
  }

  const [kitchenPrinting, setKitchenPrinting] = useState(false);
  async function printKitchenTicketForCheck(checkId: string) {
    if (kitchenPrinting) return;
    setKitchenPrinting(true);
    try {
      const res = await request<{ success: boolean; target: string; transportUsed: string }>(
        `/api/v1/firms/${firmId}/branches/${branchId}/sales/checks/${encodeURIComponent(checkId)}/print-kitchen?isReprint=true`,
        "pos-single",
        {}
      );
      showPrintToast("Mutfak Fişi Basıldı", `Kopya · ${res.transportUsed}`, "🖨️");
      setSplitNotice(`🖨️ Mutfak fişi basıldı (KOPYA - ${res.transportUsed})`);
    } catch (cause) {
      showPrintToast("Mutfak Fişi Hatası", cause instanceof Error ? cause.message : "Yazdırılamadı", "⚠️");
      setSplitNotice(cause instanceof Error ? `Mutfak fişi hatası: ${cause.message}` : "Mutfak fişi basılamadı.");
    } finally {
      setKitchenPrinting(false);
    }
  }
  const [unfinishedChecks, setUnfinishedChecks] = useState<CashierCheck[]>([]);
  const [unfinishedError, setUnfinishedError] = useState("");
  const [pendingQuick, setPendingQuick] = useState<QuickCreate | null>(() => { try { const value = localStorage.getItem(quickRequestKey); return value ? JSON.parse(value) as QuickCreate : null; } catch { return null; } });
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [catalogCategories, setCatalogCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedQuickCat, setSelectedQuickCat] = useState("all");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState("");
  const [quickNotice, setQuickNotice] = useState("");
  const [quickSuccess, setQuickSuccess] = useState<{
    changeMinor: number;
    paidMinor: number;
    totalMinor: number;
    method: string;
    payments: Array<{ id: string; amountMinor: number; method: string }>;
  } | null>(null);

  const [parkDialogOpen, setParkDialogOpen] = useState(false);
  const [parkLabelInput, setParkLabelInput] = useState("");
  const parkDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = parkDialogRef.current;
    if (parkDialogOpen && dialog && !dialog.open) dialog.showModal();
    if (!parkDialogOpen && dialog?.open) dialog.close();
  }, [parkDialogOpen]);

  const [cancellingCheck, setCancellingCheck] = useState<{ id: string; version: number; label: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelManagerPin, setCancelManagerPin] = useState("");
  const [cancellingBusy, setCancellingBusy] = useState(false);
  const cancelDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = cancelDialogRef.current;
    if (cancellingCheck && dialog && !dialog.open) dialog.showModal();
    if (!cancellingCheck && dialog?.open) dialog.close();
  }, [cancellingCheck]);

  useEffect(() => {
    if (!cashierSession) return;
    let live = true;
    request<MenuWorkspace>(`/api/v1/firms/${firmId}/branches/${branchId}/catalog/menus`, "pos-single")
      .then((menuResult) => {
        if (!live) return;
        const activeCategories = menuResult.categories.filter(category => category.isActive);
        const categoryNames = new Map(activeCategories.map((c) => [c.id, c.name]));
        setCatalogCategories(activeCategories);
        setCatalogProducts(menuResult.products.filter(p => p.status === "published" && p.isActive && p.channels.includes("pos") && p.desiredChannels.includes("pos") && p.price.amountMinor > 0 && categoryNames.has(p.categoryId)).map((p) => ({
          ...p, category: { id: p.categoryId, name: categoryNames.get(p.categoryId) ?? "Kategorisiz" },
        })));
        setCatalogError("");
      })
      .catch(cause => { if (live) { setCatalogProducts([]); setCatalogError(cause instanceof Error ? cause.message : "Ürünler yüklenemedi."); } });
    return () => { live = false; };
  }, [cashierSession, firmId, branchId, catalogRevision]);
  useEffect(() => {
    if (!cashierSession) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") setCatalogRevision(value => value + 1); }, 60_000);
    return () => window.clearInterval(timer);
  }, [cashierSession]);

  const quickTotalMinor = quickCart.reduce((sum, item) => sum + item.quantity * (item.product.price.amountMinor + item.options.reduce((delta, option) => delta + option.priceDeltaMinor * option.quantity, 0)), 0);
  const quickCartCount = quickCart.reduce((sum, item) => sum + item.quantity, 0);

  async function loadUnfinishedChecks() {
    try {
      const result = await request<{ items: CashierCheck[] }>(`${checksPath}?unassignedOpen=true`, "pos-single");
      setUnfinishedChecks(result.items.filter(check => check.status === "open" && check.tableId == null));
      setUnfinishedError("");
    } catch (cause) {
      setUnfinishedError(cause instanceof Error ? cause.message : "Açık satışlar yüklenemedi.");
    }
  }
  useEffect(() => {
    if (!cashierSession) return;
    if (cashierMode === "quick") void loadUnfinishedChecks();
  }, [cashierSession, cashierMode]);
  async function resumeQuickCheck(checkId: string) {
    setQuickBusy(true); setQuickError("");
    try {
      const check = await request<CashierCheck>(`${checksPath}/${encodeURIComponent(checkId)}`, "pos-single");
      if (check.status !== "open" || check.tableId != null) {
        await loadUnfinishedChecks();
        setQuickError("Bu satış artık açık değil.");
        return;
      }
      setQuickActiveCheck(check);
      setAmountInput(`${Math.floor(check.remainingMinor / 100)},${String(check.remainingMinor % 100).padStart(2, "0")}`);
      setPaymentMethod("cash");
    } catch (cause) {
      setQuickError(cause instanceof Error ? cause.message : "Satış yüklenemedi.");
    } finally {
      setQuickBusy(false);
    }
  }

  function addToQuickCart(product: Product, options: SelectedOption[]) {
    setQuickSuccess(null);
    setQuickNotice("");
    setQuickCart((current) => [...current, { id: createRequestId(), product, quantity: 1, options }]);
  }

  function updateQuickCartQty(id: string, delta: number) {
    setQuickCart((current) => current.map((item) => {
      if (item.id === id) {
        const next = item.quantity + delta;
        return next > 0 ? { ...item, quantity: next } : null;
      }
      return item;
    }).filter((item): item is { id: string; product: Product; quantity: number; options: SelectedOption[] } => item !== null));
  }

  function formatElapsedMinutes(createdAt: string): string {
    const diffMs = Date.now() - new Date(createdAt).getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return "Az önce";
    if (diffMinutes === 1) return "1 dk önce";
    if (diffMinutes < 60) return `${diffMinutes} dk önce`;
    const diffHours = Math.floor(diffMinutes / 60);
    return `${diffHours} sa ${diffMinutes % 60} dk önce`;
  }

  async function parkQuickCart(customNote?: string) {
    if (quickBusy || (!pendingQuick && quickCart.length === 0)) return;
    if (!isShiftOpen) {
      setMorningDismissed(false);
      setQuickError("İşlem yapabilmek için önce sabah kasa açılışını tamamlamalısınız.");
      return;
    }
    setQuickBusy(true);
    setQuickError("");
    setQuickNotice("");
    try {
      const defaultLabel = `Paket #${new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
      const label = customNote?.trim() || defaultLabel;
      const items = quickCart.map((item, index) => ({
        productId: item.product.id,
        quantity: item.quantity,
        note: index === 0 ? label : undefined,
        options: item.options.map((option) => ({ groupId: option.groupId, optionId: option.optionId, quantity: option.quantity })),
      }));
      const payload: QuickCreate = {
        requestId: createRequestId(),
        firstOrderId: createRequestId(),
        items,
        customerId: null,
        tableId: null,
        waiterId: null,
      };
      await request<CashierCheck>(checksPath, "pos-single", payload);
      setQuickCart([]);
      setParkDialogOpen(false);
      setParkLabelInput("");
      setQuickNotice(`Sipariş askıya alındı: ${label}`);
      await loadUnfinishedChecks();
    } catch (cause) {
      setQuickError(`${cause instanceof Error ? cause.message : "Adisyon askıya alınamadı."}`);
    } finally {
      setQuickBusy(false);
    }
  }

  async function cancelQuickCheck(checkId: string, version: number, reason: string, managerPin?: string) {
    setCancellingBusy(true);
    setQuickError("");
    try {
      await request(
        `${checksPath}/${encodeURIComponent(checkId)}/cancel`,
        "pos-single",
        { expectedVersion: version, reason: reason.trim() || "Müşteri vazgeçti / terk etti", managerPin: managerPin?.trim() || undefined },
        "POST"
      );
      if (quickActiveCheck?.id === checkId) {
        setQuickActiveCheck(null);
        setQuickStep("menu");
      }
      setCancellingCheck(null);
      setCancelReason("");
      setCancelManagerPin("");
      setQuickNotice("Sipariş iptal edildi.");
      await loadUnfinishedChecks();
    } catch (cause) {
      setQuickError(cause instanceof Error ? cause.message : "Sipariş iptal edilemedi.");
    } finally {
      setCancellingBusy(false);
    }
  }

  async function proceedToPayment() {
    if (quickBusy || (!pendingQuick && quickCart.length === 0)) return;
    if (!isShiftOpen) {
      setMorningDismissed(false);
      setQuickError("Ödeme alabilmek için önce sabah kasa açılışını tamamlamalısınız.");
      return;
    }
    setQuickBusy(true);
    setQuickError("");
    setQuickNotice("");
    try {
      const defaultLabel = `Hızlı Satış #${new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
      const items = quickCart.map((item, index) => ({
        productId: item.product.id,
        quantity: item.quantity,
        note: index === 0 ? defaultLabel : undefined,
        options: item.options.map(option => ({ groupId: option.groupId, optionId: option.optionId, quantity: option.quantity })),
      }));

      const payload: QuickCreate = pendingQuick ?? {
        requestId: createRequestId(),
        firstOrderId: createRequestId(),
        items,
        customerId: null,
        tableId: null,
        waiterId: null,
      };
      if (!pendingQuick) { localStorage.setItem(quickRequestKey, JSON.stringify(payload)); setPendingQuick(payload); }
      const createdCheck = await request<CashierCheck>(checksPath, "pos-single", payload);
      localStorage.removeItem(quickRequestKey); setPendingQuick(null);

      if (createdCheck.status !== "open") {
        setQuickCart([]);
        setQuickNotice("Önceki satış tamamlanmış. Yeni satış başlatabilirsiniz.");
        return;
      }

      // 2 Saniyelik Yerel Mutfak Onay Bildirimi
      const shortId = createdCheck.id.slice(0, 6).toUpperCase();
      const itemCount = items.reduce((sum, it) => sum + it.quantity, 0);
      setOrderSentToast({ id: createdCheck.id, label: shortId, count: itemCount, totalMinor: createdCheck.totalMinor });
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => {
        setOrderSentToast(null);
      }, 2000);

      // Sepeti temizle: Tezgâh hemen yeni sipariş almaya hazır olur
      setQuickCart([]);
      // Oluşturulan adisyonu sağ bölüme aktif et
      setQuickActiveCheck(createdCheck);
      setAmountInput(`${Math.floor(createdCheck.remainingMinor / 100)},${String(createdCheck.remainingMinor % 100).padStart(2, "0")}`);
      setPaymentMethod("cash");
      void loadUnfinishedChecks();
    } catch (cause) {
      setQuickError(`${cause instanceof Error ? cause.message : "Adisyon oluşturulamadı."} İşlem sonucunu kesinleştirmek için aynı isteği tekrar deneyin.`);
    } finally {
      setQuickBusy(false);
    }
  }

  const [splitQuantities, setSplitQuantities] = useState<Record<number, number>>({});
  const [splitError, setSplitError] = useState("");
  const [splitNotice, setSplitNotice] = useState("");
  const [splitting, setSplitting] = useState(false);
  const splitRequest = useRef<{ key: string; id: string } | null>(null);
  const splitDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = splitDialog.current;
    if (splitCheck && dialog && !dialog.open) dialog.showModal();
    if (!splitCheck && dialog?.open) dialog.close();
  }, [splitCheck]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const serial = useRef(0);
  const tableErrorCount = useRef(0);
  const cashErrorCount = useRef(0);

  const reload = useCallback(async () => {
    const current = ++serial.current;
    try {
      const [tableResult, checksResult] = await Promise.all([
        request<{ items: Table[]; floors?: string[] }>(`${servicePath}/tables`, "pos-single"),
        request<{ items: CashierCheck[] }>(checksPath, "pos-single"),
      ]);
      const active = tableResult.items.filter((table) => table.isActive);
      const openChecks = checksResult.items.filter((check) => check.status === "open");
      const checksMap: Record<string, CashierCheck[]> = {};
      for (const check of openChecks) {
        if (check.tableId) {
          if (!checksMap[check.tableId]) checksMap[check.tableId] = [];
          checksMap[check.tableId].push(check);
        }
      }
      if (current !== serial.current) return;
      tableErrorCount.current = 0;
      setTables(active);
      setConfiguredFloors(tableResult.floors ?? []);
      setChecks(checksMap);
      setUpdated(new Date());
      setError("");
    } catch (cause) {
      if (current === serial.current) {
        tableErrorCount.current++;
        // Geçici Wi-Fi paket düşmelerinde panik yapma; 3 ardışık başarısızlıktan sonra göster
        if (tableErrorCount.current >= 3) {
          setError(cause instanceof Error ? cause.message : "Masa ve adisyon bilgileri alınamadı.");
        }
      }
    } finally { if (current === serial.current) setLoading(false); }
  }, [servicePath, checksPath]);

  const loadCash = useCallback(async () => {
    try {
      const overview = await request<CashOverview>(`/api/v1/firms/${firmId}/branches/${branchId}/cash/overview`, "pos-single");
      cashErrorCount.current = 0;
      setCashOverview(overview);
      if (!initialStationChecked.current && overview.registers.length > 0) {
        initialStationChecked.current = true;
        const savedStation = localStorage.getItem(assignedRegisterKey);
        if (savedStation && overview.registers.some((r) => r.id === savedStation)) {
          setSelectedRegisterId(savedStation);
        } else if (overview.registers.length === 1) {
          localStorage.setItem(assignedRegisterKey, overview.registers[0].id);
          setSelectedRegisterId(overview.registers[0].id);
        } else {
          setStationMode("initial");
          setStationModalOpen(true);
          setSelectedRegisterId(overview.registers[0].id);
        }
      } else if (!selectedRegisterId && overview.registers.length > 0) {
        const savedStation = localStorage.getItem(assignedRegisterKey);
        if (savedStation && overview.registers.some((r) => r.id === savedStation)) {
          setSelectedRegisterId(savedStation);
        } else {
          setSelectedRegisterId(overview.registers[0].id);
        }
      }
      setCashError("");
    } catch (cause) {
      cashErrorCount.current++;
      // Geçici Wi-Fi paket düşmelerinde panik yapma; 3 ardışık başarısızlıktan sonra göster
      if (cashErrorCount.current >= 3) {
        setCashError(cause instanceof Error ? cause.message : "Kasa bilgileri alınamadı.");
      }
    } finally {
      setCashLoading(false);
    }
  }, [firmId, branchId, assignedRegisterKey, selectedRegisterId]);

  // Canlı senkronizasyon fonksiyonu
  const triggerSync = useCallback(() => {
    void reload();
    void loadCash();
    if (cashierMode === "quick" && quickStep === "menu") {
      void loadUnfinishedChecks();
    }
  }, [reload, loadCash, cashierMode, quickStep]);

  // 1. SSE ile anlık LAN push bildirimi (Masa açılınca, sipariş girilince, hesap istenince anında güncellenir)
  useRestaurantRealtime(
    useCallback(
      (evt) => {
        console.log("⚡ [CashierApp] Anlık LAN bildirimi alındı:", evt.type);
        triggerSync();
        if (evt.type === "inventory.stock_updated" || evt.type === "check.closed") {
          setCatalogRevision((v) => v + 1);
        }
      },
      [triggerSync]
    ),
    Boolean(cashierSession),
    cashierSession?.token
  );

  // 2. Yedek periyodik kontrol ve ekran odaklanma tetikleyicisi
  useEffect(() => {
    if (!cashierSession) return;
    triggerSync();
    const intervalTimer = window.setInterval(triggerSync, 15000);

    const handleWakeOrFocus = () => {
      triggerSync();
    };

    document.addEventListener("visibilitychange", handleWakeOrFocus);
    window.addEventListener("focus", handleWakeOrFocus);
    window.addEventListener("online", handleWakeOrFocus);

    return () => {
      window.clearInterval(intervalTimer);
      document.removeEventListener("visibilitychange", handleWakeOrFocus);
      window.removeEventListener("focus", handleWakeOrFocus);
      window.removeEventListener("online", handleWakeOrFocus);
    };
  }, [cashierSession, triggerSync, cashRefresh]);

  async function submitCashShift(event: React.FormEvent) {
    event.preventDefault();
    if (!cashDialog || cashBusy) return;
    const input = cashAmount.trim().replace(/\s/g, "");
    const normalized = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(input) ? input.replaceAll(".", "").replace(",", ".") : input.replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) { setCashActionError("Geçerli bir TL tutarı girin."); return; }
    const minor = Math.round(Number(normalized) * 100);
    if (!Number.isSafeInteger(minor) || minor > 999999999999) { setCashActionError("Geçerli bir TL tutarı girin."); return; }
    const note = cashNote.trim();
    const currentExpected = activeShift?.expectedCashMinor ?? cashDialog.expected;
    const currentVersion = activeShift?.version ?? cashDialog.version;
    if (cashDialog.mode === "close" && currentExpected != null && minor !== currentExpected && !note) { setCashActionError("Sayılan tutar beklenen nakitten farklıysa fark açıklaması yazın."); return; }
    const denominations = cashDialog.mode === "close" ? [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 25, 10, 5, 1]
      .filter(denominationMinor => (cashDenominations[denominationMinor] ?? 0) > 0)
      .map(denominationMinor => ({ denominationMinor, quantity: cashDenominations[denominationMinor] })) : [];
    if (cashDialog.mode === "close" && denominations.length > 0 && denominations.reduce((sum, item) => sum + item.denominationMinor * item.quantity, 0) !== minor) {
      setCashActionError("Kupür dökümü toplamı kasada sayılan tutarla aynı olmalı."); return;
    }
    const targetShiftId = cashDialog.shiftId;
    const retainedMinor = cashDialog.mode === "close"
      ? Math.max(0, Math.round(Number(retainedFloatInput.trim().replace(/\s/g, "").replace(",", ".")) * 100) || 0)
      : undefined;
    const key = JSON.stringify([cashDialog.mode, cashDialog.shiftId, currentVersion, minor, note, denominations, retainedMinor]);
    if (cashRequestId.current?.key !== key) cashRequestId.current = { key, id: createRequestId() };
    const base = `/api/v1/firms/${firmId}/branches/${branchId}/cash`;
    const path = cashDialog.mode === "open" ? `${base}/shifts` : `${base}/shifts/${encodeURIComponent(cashDialog.shiftId!)}/close`;
    const body = cashDialog.mode === "open" ? { requestId: cashRequestId.current.id, registerId: cashDialog.registerId, openingCashMinor: minor } : { requestId: cashRequestId.current.id, expectedVersion: currentVersion, countedCashMinor: minor, note: note || null, retainedFloatMinor: retainedMinor, ...(denominations.length ? { denominations } : {}) };
    setCashBusy(true); setCashActionError("");
    try {
      await request(path, "pos-single", body);
      cashRequestId.current = null; setCashDialog(null);
      setCashNotice(cashDialog.mode === "open" ? "Vardiya açıldı." : "Vardiya kapatıldı. Gün sonu Z-Raporu hazırlandı.");
      setCashRefresh((value) => value + 1);
      if (cashDialog.mode === "close") {
        setMorningDismissed(false);
        if (targetShiftId) void openZReport(targetShiftId);
      }
    } catch (cause) { setCashRefresh((value) => value + 1); void reload(); void loadUnfinishedChecks(); setCashActionError(cause instanceof Error ? cause.message : "Vardiya işlemi tamamlanamadı."); }
    finally { setCashBusy(false); }
  }

  const selected = tables.find((table) => table.id === selectedId);
  const statusOf = (table: Table) => {
    const primary = tables.find((item) => item.id === (table.group?.primaryTableId ?? table.id)) ?? table;
    return primary.status === "bill_requested" ? "bill_requested" : table.status === "reserved" ? "reserved" : table.assignment || table.group || table.status === "occupied" ? "occupied" : "idle";
  };
  const isQuickPayment = cashierMode === "quick";
  const primarySelectedId = selected?.group?.primaryTableId ?? selectedId;
  const selectedChecks = isQuickPayment ? (quickActiveCheck ? [quickActiveCheck] : []) : (checks[primarySelectedId] ?? []);
  const activeCheck = isQuickPayment ? quickActiveCheck : (selectedChecks.find((check) => check.id === selectedCheckId) ?? selectedChecks[0]);
  const tableTotal = selectedChecks.reduce((sum, check) => sum + check.totalMinor, 0);
  const tableRemaining = selectedChecks.reduce((sum, check) => sum + check.remainingMinor, 0);
  const paymentLabel = (status: CashierCheck["paymentStatus"]) => ({ unpaid: "Açık", partially_paid: "Kısmi ödeme (test)", paid: "Ödendi (test)", pending: "Ödeme bekliyor (test)", unknown: "Ödeme belirsiz (test)" }[status] ?? "Durum bilinmiyor");
  useEffect(() => {
    if (activeCheck) {
      setAmountInput(`${Math.floor(activeCheck.remainingMinor / 100)},${String(activeCheck.remainingMinor % 100).padStart(2, "0")}`);
      setPaymentMethod("cash");
      setPaymentSubMethod("");
      setCustomerSelected(null);
      setPayError("");
    } else {
      setAmountInput("0");
      setPaymentMethod(null);
      setPaymentSubMethod("");
      setCustomerSelected(null);
      setPayError("");
    }
  }, [activeCheck?.id]);
  const amountParts = amountInput.split(",");
  const amountMinor = Number(amountParts[0] || "0") * 100 + Number((amountParts[1] ?? "").padEnd(2, "0"));
  function enterAmountKey(key: string) {
    setAmountInput((current) => {
      if (key === "C") return "0";
      if (key === "⌫") return current.length > 1 ? current.slice(0, -1) : "0";
      if (key === ",") return current.includes(",") ? current : `${current},`;
      const [whole, decimal] = current.split(",");
      if (decimal !== undefined) return decimal.length < 2 ? `${whole},${decimal}${key}` : current;
      if (whole.length >= 8) return current;
      return whole === "0" ? key : whole + key;
    });
  }
  // Tahsilat: ödeme simülatörü kaydı + seçili kasanın açık vardiyasına kasa hareketi (postToCash) aynı transaction'da yazılır.
  const isZeroBalance = Boolean(activeCheck && activeCheck.remainingMinor <= 0);
  const demoPayable = Boolean(paymentMethod);
  const payBlocker = !activeCheck ? "Açık adisyon seçin." : isZeroBalance ? "" : !paymentMethod ? "Ödeme yöntemi seçin." : (paymentMethod === "cari" && !customerSelected) ? "Cariye yazmak için lütfen müşteri seçin." : amountMinor <= 0 ? "Tutar girin." : "";
  async function submitPayment() {
    if (!activeCheck || !paymentMethod || !demoPayable || payBusy || payBlocker || error) return;
    if (!isShiftOpen) {
      setMorningDismissed(false);
      setPayError("Tahsilat yapabilmek için önce sabah kasa açılışını tamamlamalısınız.");
      return;
    }
    const method = paymentMethod;
    const providerName = paymentSubMethod || (method === "card" ? "Ziraat POS" : method === "meal" ? "Sodexo" : method === "transfer" ? "Havale/EFT" : method === "cari" && customerSelected ? `Cari: ${customerSelected.name}` : undefined);
    let left = Math.min(amountMinor, activeCheck.remainingMinor);
    const parts: Array<{ orderId: string; version: number; amountMinor: number }> = [];
    for (const order of activeCheck.orders) {
      if (left <= 0) break;
      const part = Math.min(left, order.remainingMinor);
      if (part > 0) { parts.push({ orderId: order.id, version: order.version, amountMinor: part }); left -= part; }
    }
    if (!parts.length || left > 0) { setPayError("Tutar siparişlere dağıtılamadı. Ekranı yenileyip tekrar deneyin."); return; }
    const key = JSON.stringify([activeCheck.id, method, providerName, parts]);
    if (payRequest.current?.key !== key) payRequest.current = { key, ids: parts.map(() => createRequestId()) };
    setPayBusy(true); setPayError("");
    try {
      let latestCheck: CashierCheck = activeCheck;
      for (const [index, part] of parts.entries()) {
        const res = await request<{ attempt: unknown; check: CashierCheck }>(`${checksPath}/${encodeURIComponent(activeCheck.id)}/payment-attempts`, "pos-single", {
          orderId: part.orderId, attemptId: payRequest.current.ids[index], amountMinor: part.amountMinor, method,
          provider: providerName,
          customerId: method === "cari" ? customerSelected?.id : undefined,
          simulatedOutcome: "succeeded", expectedOrderVersion: part.version, postToCash: true, registerId: mainRegister?.id,
        });
        latestCheck = res.check;
      }
      payRequest.current = null; setAmountInput("0"); setPaymentMethod(null); setPaymentSubMethod(""); setCustomerSelected(null);
      const isPaidComplete = latestCheck.status === "closed" || latestCheck.remainingMinor <= 0;
      const tenderTitle = method === "cash" ? "NAKIT" : (providerName || method.toUpperCase());
      const methodDisplay = method === "cash" ? "Nakit" : (providerName || method);

      if (isPaidComplete) {
        const receipt = { check: latestCheck, location: isQuickPayment ? "Hızlı satış" : selected?.name ?? "Masa", printedAt: new Date().toISOString() };
        setLastCompletedReceipt(receipt);
        printAccountReceipt(receipt, method === "cash", tenderTitle);
      } else {
        // Parçalı ara ödeme fişi termal yazıcıya anında gönderilir!
        void printThermalCashierBill(
          latestCheck.id,
          method === "cash",
          tenderTitle
        );
      }
      if (isQuickPayment) {
        if (isPaidComplete) {
          setQuickSuccess({
            changeMinor: method === "cash" && amountMinor > activeCheck.remainingMinor ? amountMinor - activeCheck.remainingMinor : 0,
            paidMinor: latestCheck.totalMinor,
            totalMinor: latestCheck.totalMinor,
            method: methodDisplay,
            payments: latestCheck.payments,
          });
          setQuickActiveCheck(null);
          setQuickCart([]);
          setSplitNotice(`Satış tamamlandı: ${money(latestCheck.totalMinor)} (${methodDisplay}) ${mainRegister?.name ?? "kasa"} kasasına kaydedildi.`);
        } else {
          setQuickActiveCheck(latestCheck);
          setAmountInput(`${Math.floor(latestCheck.remainingMinor / 100)},${String(latestCheck.remainingMinor % 100).padStart(2, "0")}`);
          setPaymentMethod("cash");
          setSplitNotice(`Kısmi tahsilat kaydedildi: ${money(Math.min(amountMinor, activeCheck.remainingMinor))} (${methodDisplay}). Kalan tutar: ${money(latestCheck.remainingMinor)}.`);
        }
      } else {
        setSplitNotice(`Tahsilat kaydedildi: ${money(Math.min(amountMinor, activeCheck.remainingMinor))} (${methodDisplay}) · ${mainRegister?.name ?? "Kasa"}.`);
      }
      setCashRefresh((v) => v + 1);
      await reload();
      void loadUnfinishedChecks();
    } catch (cause) {
      const failure = cause as ApiRequestError;
      if (failure.status === 409 && ["VERSION_CONFLICT", "PAYMENT_ID_CONFLICT"].includes(failure.code ?? "")) { payRequest.current = null; await reload(); setPayError("Adisyon başka bir işlemle değişti; güncel bilgiler yüklendi, tutarı kontrol edip tekrar deneyin."); }
      else if (failure.status === 409 && failure.code === "OPEN_CASH_SHIFT_REQUIRED") { setMorningDismissed(false); setPayError(failure.message); }
      else if (failure.status === 409 && failure.code === "FEATURE_DISABLED") setPayError("Ödeme simülatörü bu şube için kapalı. Ayarlar → Modüller ve Özellikler'den payments.simulator özelliğini açın.");
      else { await reload(); setPayError(cause instanceof Error ? cause.message : "Tahsilat tamamlanamadı."); }
    } finally { setPayBusy(false); }
  }
  async function closeZeroCheck() {
    if (!activeCheck || payBusy || error || activeCheck.totalMinor > 0) return;
    setPayBusy(true); setPayError("");
    try {
      await request(`${checksPath}/${encodeURIComponent(activeCheck.id)}/close-zero-balance`, "pos-single", { expectedVersion: activeCheck.version });
      setLastCompletedReceipt({ check: activeCheck, location: isQuickPayment ? "Hızlı satış" : selected?.name ?? "Masa", printedAt: new Date().toISOString() });
      if (isQuickPayment) {
        setQuickActiveCheck(null);
        setQuickCart([]);
        setQuickStep("menu");
        setSplitNotice("Tutarı sıfır olan adisyon kapatıldı.");
      } else {
        setSelectedCheckId(""); setSplitNotice("Tutarı sıfır olan adisyon kapatıldı.");
        setCashRefresh((v) => v + 1);
      await reload();
      void loadUnfinishedChecks();
      }
    } catch (cause) {
      if (!isQuickPayment) await reload();
      setPayError(cause instanceof Error ? cause.message : "Adisyon kapatılamadı.");
    } finally { setPayBusy(false); }
  }
  const cashierActionLines = activeCheck?.orders.flatMap((order) => order.items) ?? [];
  const transferOptions = tables.filter((table) => table.id !== selected?.id && !table.assignment && !table.group && statusOf(table) === "idle");
  const mergeOptions = tables.filter((table) => table.id !== selected?.id && table.assignment && !table.group);
  function showCashierAction(action: "transfer" | "merge" | "discount" | "comp" | "void") {
    setCashierAction(action); setActionTarget(""); setActionSources([]); setActionReason(""); setActionValue(""); setActionLine(""); setActionQuantity(1); setActionManagerPin(""); setActionError(""); setSplitNotice("");
  }
  async function submitCashierAction(event: React.FormEvent) {
    event.preventDefault();
    if (!cashierAction || (!selected && !isQuickPayment) || !activeCheck || actionBusy || error) return;
    let path = ""; let body: Record<string, unknown> = {};
    if (cashierAction === "transfer") {
      if (!selected || !selected.assignment || !actionTarget) { setActionError("Boş hedef masayı seçin."); return; }
      path = `${servicePath}/tables/${encodeURIComponent(selected.id)}/transfer`;
      body = { targetTableId: actionTarget, expectedVersion: selected.assignment.version };
    } else if (cashierAction === "merge") {
      const sources = tables.filter((table) => actionSources.includes(table.id) && table.assignment && !table.group);
      if (!selected || !selected.assignment || !sources.length || sources.length !== actionSources.length) { setActionError("Birleştirilecek masaları seçin."); return; }
      path = `${servicePath}/tables/${encodeURIComponent(selected.id)}/merge`;
      body = { sourceTableIds: actionSources, expectedVersions: Object.fromEntries([[selected.id, selected.assignment.version], ...sources.map((table) => [table.id, table.assignment!.version])]) };
    } else {
      if (activeCheck.payments.length) { setActionError("Ödeme girişimi olan adisyona işlem uygulanamaz."); return; }
      if (cashierAction !== "void" && !actionReason.trim()) { setActionError("Gerekçe zorunludur."); return; }
      let value: number | null = null; let lineId: number | null = null; let quantity = 0;
      if (cashierAction === "discount") {
        const normalized = actionValue.trim().replace(",", ".");
        if (!/^\d+(\.\d{1,2})?$/.test(normalized)) { setActionError("Geçerli bir indirim girin."); return; }
        const number = Number(normalized);
        if (actionValueType === "percentage" && (!Number.isInteger(number) || number < 1 || number > 100)) { setActionError("İndirim oranı 1 ile 100 arasında tam sayı olmalı."); return; }
        value = actionValueType === "percentage" ? number : Math.round(number * 100);
        if (!Number.isSafeInteger(value) || value <= 0 || (actionValueType === "fixed" && value > activeCheck.totalMinor)) { setActionError("İndirim tutarı geçersiz."); return; }
      } else {
        const line = cashierActionLines.find((item) => item.id === Number(actionLine));
        if (!line || !Number.isInteger(actionQuantity) || actionQuantity < 1 || actionQuantity > line.quantity) { setActionError("Ürün ve geçerli adet seçin."); return; }
        lineId = line.id; quantity = actionQuantity;
      }
      path = `${checksPath}/${encodeURIComponent(activeCheck.id)}/adjustments`;
      body = { expectedVersion: activeCheck.version, action: cashierAction, valueType: cashierAction === "discount" ? actionValueType : null, value, orderLineId: lineId, quantity, reason: actionReason.trim(), managerPin: actionManagerPin.trim() || undefined };
    }
    const key = JSON.stringify([path, body]);
    if (actionRequest.current?.key !== key) actionRequest.current = { key, id: createRequestId() };
    setActionBusy(true); setActionError("");
    try {
      const res = await request<{ adjustment?: CheckAdjustment }>(path, "pos-single", { ...body, requestId: actionRequest.current.id });
      actionRequest.current = null; setCashierAction(null);
      if (cashierAction === "transfer") { setSelectedId(actionTarget); setSelectedCheckId(""); }
      const actionName = cashierAction === "discount" ? "İndirim" : cashierAction === "comp" ? "İkram" : "Ürün iptali";
      const approval = res?.adjustment?.approvalMode?.startsWith("manager_pin:") ? `Yönetici Onayı: ${res.adjustment.approvalMode.slice(12)}` : "Geliştirme onayı";
      setSplitNotice(cashierAction === "transfer" ? "Masa taşındı." : cashierAction === "merge" ? "Masalar birleştirildi." : `${actionName} kaydedildi (${approval}).`);
      setCashRefresh((v) => v + 1);
      await reload();
      void loadUnfinishedChecks();
    } catch (cause) {
      const failure = cause as ApiRequestError;
      if (failure.status === 409 && ["VERSION_CONFLICT", "STALE_CHECK_VERSION"].includes(failure.code ?? "")) { actionRequest.current = null; setCashierAction(null); await reload(); setSplitNotice("Bilgiler başka bir cihazda değişti; güncel bilgileri kontrol edip işlemi yeniden başlatın."); }
      else setActionError(cause instanceof Error ? cause.message : "İşlem tamamlanamadı.");
    } finally { setActionBusy(false); }
  }
  const splitLines = splitCheck?.orders.flatMap((order) => order.items) ?? [];
  const splitTotal = splitLines.reduce((sum, line) => sum + (splitQuantities[line.id] ?? 0) * line.unitPriceMinor, 0);
  async function submitCashierSplit() {
    if (!splitCheck || splitting) return;
    const items = splitLines.map((line) => ({ orderLineId: line.id, quantity: splitQuantities[line.id] ?? 0 })).filter((line) => line.quantity > 0);
    if (!items.length || splitTotal <= 0 || splitTotal >= splitCheck.totalMinor || splitCheck.payments.length || splitCheck.adjustments.length) {
      setSplitError("Ürün miktarlarını kontrol edin. Kaynak adisyonda ürün kalmalı; ödeme girişimi veya indirim/ikram bulunan adisyonlar bölünemez."); return;
    }
    const key = `${splitCheck.id}:${splitCheck.version}:${JSON.stringify(items)}`;
    if (splitRequest.current?.key !== key) splitRequest.current = { key, id: createRequestId() };
    setSplitting(true); setSplitError("");
    try {
      await request(`${checksPath}/${encodeURIComponent(splitCheck.id)}/split`, "pos-single", {
        requestId: splitRequest.current.id, expectedVersion: splitCheck.version, items,
      });
      splitRequest.current = null;
      setSplitCheck(null);
      if (isQuickPayment) {
        setSplitNotice("");
        setQuickActiveCheck(null);
        setQuickStep("menu");
        setQuickNotice("Adisyon bölündü. Kaynak ve yeni adisyon açık satışlar listesinde.");
        await loadUnfinishedChecks();
      } else {
        setSplitNotice("Adisyon bölündü. Yeni adisyon aynı masada görüntüleniyor.");
        setCashRefresh((v) => v + 1);
      await reload();
      void loadUnfinishedChecks();
      }
    } catch (cause) {
      const failure = cause as ApiRequestError;
      if (failure.status === 409 && ["STALE_CHECK_VERSION", "VERSION_CONFLICT"].includes(failure.code ?? "")) {
        splitRequest.current = null; setSplitCheck(null); await reload();
        setSplitNotice("Adisyon başka bir işlemle değişti. Güncel bilgileri kontrol edip bölme işlemini yeniden başlatın.");
      } else setSplitError(cause instanceof Error ? cause.message : "Adisyon bölünemedi.");
    } finally { setSplitting(false); }
  }
  const filteredQuickProducts = catalogProducts.filter((product) => {
    return selectedQuickCat === "all" || product.category.id === selectedQuickCat;
  });

  // USB HID Barkod Okuyucu dinleyicisi (Hızlı Satış ekranında SKU/barkod eşleşmesi)
  const barcodeBufferRef = useRef("");
  const barcodeLastKeyRef = useRef(0);
  const barcodeOptionCacheRef = useRef(new Map<string, boolean>());
  const barcodeProductsRef = useRef(catalogProducts);
  barcodeProductsRef.current = catalogProducts;
  const barcodeBlockedRef = useRef(false);
  barcodeBlockedRef.current = Boolean(
    !cashierSession ||
    cashierMode !== "quick" ||
    pendingQuick ||
    stationModalOpen ||
    cashDialog ||
    activeZReport ||
    printerSettingsOpen ||
    quickOptionProduct ||
    parkDialogOpen ||
    cancellingCheck
  );

  useEffect(() => {
    function handleScannedBarcode(rawCode: string) {
      const code = rawCode.trim().toLowerCase();
      if (!code) return;
      const match = barcodeProductsRef.current.find((p) => (p.sku ?? "").trim().toLowerCase() === code);
      if (!match) {
        showPrintToast("Barkod Bulunamadı", `Kod: ${rawCode.trim()}`, "⚠️");
        return;
      }
      if (match.isOutOfStock) {
        setQuickError(`${match.name} tükendi. Mutfak stoğunda ${match.limitingIngredientName || "hammadde"} bulunmuyor.`);
        return;
      }
      void (async () => {
        try {
          let hasOptions = barcodeOptionCacheRef.current.get(match.id);
          if (hasOptions === undefined) {
            const res = await posFetch(
              `/api/v1/firms/${encodeURIComponent(firmId)}/branches/${encodeURIComponent(branchId)}/catalog/products/${encodeURIComponent(match.id)}/option-groups`,
              { demoActor: "pos-single" }
            );
            if (res.ok) {
              const data = (await res.json()) as { items?: unknown[] };
              hasOptions = Array.isArray(data.items) && data.items.length > 0;
              barcodeOptionCacheRef.current.set(match.id, hasOptions);
            } else {
              hasOptions = false;
            }
          }
          if (hasOptions) {
            setQuickOptionSelection(null);
            setQuickOptionProduct(match);
            return;
          }
          setQuickSuccess(null);
          setQuickNotice("");
          setQuickCart((current) => {
            const idx = current.findIndex((item) => item.product.id === match.id && item.options.length === 0);
            if (idx >= 0) {
              return current.map((item, i) => (i === idx ? { ...item, quantity: item.quantity + 1 } : item));
            }
            return [...current, { id: createRequestId(), product: match, quantity: 1, options: [] }];
          });
          showPrintToast("Barkod Okundu", `${match.name} sepete eklendi`, "📷");
        } catch {
          setQuickOptionSelection(null);
          setQuickOptionProduct(match);
        }
      })();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (barcodeBlockedRef.current) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const now = performance.now();
      if (event.key === "Enter") {
        const scanned = barcodeBufferRef.current;
        const delta = now - barcodeLastKeyRef.current;
        barcodeBufferRef.current = "";
        barcodeLastKeyRef.current = 0;
        if (scanned.length >= 4 && delta <= 140) {
          event.preventDefault();
          handleScannedBarcode(scanned);
        }
        return;
      }
      if (event.key.length === 1) {
        if (now - barcodeLastKeyRef.current > 75) {
          barcodeBufferRef.current = event.key;
        } else {
          barcodeBufferRef.current += event.key;
        }
        barcodeLastKeyRef.current = now;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [firmId, branchId]);

  if (!cashierSession) {
    return (
      <PinPadModal
        title="Kasa Dokunmatik Ekranı"
        appKind="cashier"
        allowedRoles={["cashier", "owner", "manager"]}
        subtitle="Kasayı açmak ve tahsilat yapmak için 4 haneli PIN kodunuzu tuşlayın"
        onSuccess={(data) => {
          savePosSession("cashier", data);
          setCashierSession(data);
        }}
      />
    );
  }

  return <main className={`ops-shell waiter-shell cashier-shell${selected || cashierMode === "quick" ? " cashier-detail-shell" : " cashier-table-overview"}`}>
    <header className="ops-header cashier-header-clean">
      {/* SOL: Logo + Sabit İstasyon Rozeti */}
      <div className="cashier-header-left">
        <a href={buildPosTerminalHref("/cashier", terminalScope)} className="ops-brand waiter-brand">
          <img src="/hipos-logo.png" alt="HIPOS" />
          <span className="cashier-badge-pill">KASA</span>
        </a>

        <div className="cashier-station-badge" title="Fiziki terminalin bağlı olduğu kasa">
          <span className="station-icon">📍</span>
          <span className="station-name">
            {mainRegister ? `${mainRegister.name} (${mainRegister.code})` : "İstasyon Seçilmedi"}
          </span>
          <button
            type="button"
            className="station-change-btn"
            title="Terminal istasyon kasasını değiştir (Yönetici Onayı Gerekir)"
            onClick={() => {
              setStationMode("change");
              setStationManagerPin("");
              setStationError("");
              setStationModalOpen(true);
            }}
          >
            ⚙️ Değiştir
          </button>
        </div>
      </div>

      {/* ORTA: Mod Geçişi (Büyük Dokunmatik Masalar & Hızlı Satış Sekmeleri) */}
      <div className="cashier-header-center">
        <nav className="cashier-segmented-nav" aria-label="Kasa Modu">
          <button
            type="button"
            className={`cashier-seg-btn ${cashierMode === "tables" ? "active" : ""}`}
            onClick={() => { setCashierMode("tables"); setSelectedId(""); }}
          >
            <span className="seg-icon">🍽️</span>
            <span>Masalar & Salon</span>
          </button>
          <button
            type="button"
            className={`cashier-seg-btn quick ${cashierMode === "quick" ? "active" : ""}`}
            onClick={() => { setCashierMode("quick"); setSelectedId(""); }}
          >
            <span className="seg-icon">⚡</span>
            <span>Hızlı Satış (Gel-Al)</span>
          </button>
        </nav>
      </div>

      {/* SAĞ: Kasiyer Bilgisi, Kilitleme, Vardiya İşlemleri ve Bağlantı */}
      <div className="cashier-header-right">
        {/* İşlem Butonları Grubu (X-Raporu, Vardiya, Son Fiş, Geri Dön) */}
        <div className="cashier-header-actions">
          {/* Vardiya Kapat / Aç Butonu */}
          {activeShift && mainRegister ? (
            <button
              type="button"
              className="cashier-header-btn btn-close-shift"
              disabled={cashBusy || cashLoading || Boolean(cashError)}
              onClick={() => {
                setCashAmount("");
                setCashDenominations({});
                setCashNote("");
                setRetainedFloatInput(activeShift ? String(Math.floor(activeShift.openingCashMinor / 100)) : "0");
                setCashActionError("");
                setCashNotice("");
                void reload();
                void loadUnfinishedChecks();
                setCashDialog({
                  mode: "close",
                  registerId: mainRegister.id,
                  shiftId: activeShift.id,
                  version: activeShift.version,
                  expected: activeShift.expectedCashMinor ?? undefined,
                });
              }}
              title="Vardiyayı kapat ve gün sonu Z-Raporu al"
            >
              🔒 Vardiyayı Kapat
            </button>
          ) : (
            mainRegister && !isShiftOpen && (
              <button
                type="button"
                className="cashier-header-btn btn-open-shift"
                onClick={() => {
                  setMorningError("");
                  setMorningConfirming(false);
                  setMorningDismissed(false);
                }}
                title="Sabah kasa açılışı yap ve vardiyayı başlat"
              >
                ☀️ Vardiya Aç
              </button>
            )
          )}

          {/* Son hesap fişi (varsa) */}
          {lastCompletedReceipt && (
            <button
              type="button"
              className="cashier-header-btn"
              onClick={() => printAccountReceipt(lastCompletedReceipt, false, "BILGI")}
              title="Son tamamlanan tahsilatın bilgi fişini tekrar yazdır"
            >
              🧾 Son Fiş
            </button>
          )}

          <button
            type="button"
            className="cashier-header-btn"
            disabled={drawerOpening}
            onClick={() => void openCashDrawer()}
            title="Nakit çekmecesini aç (RJ11)"
          >
            {drawerOpening ? "Açılıyor…" : "💵 Çekmece"}
          </button>

          <button
            type="button"
            className="cashier-header-btn"
            onClick={() => setPrinterSettingsOpen(true)}
            title="Şube yazıcıları (Kasa, Mutfak, Bar) ve Print Bridge durumu"
          >
            🖨️ Yazıcılar
          </button>

          {/* Detay ekranındayken Geri Dön */}
          {selected && cashierMode === "tables" && (
            <button type="button" className="cashier-header-btn btn-back" onClick={() => setSelectedId("")}>
              ← Masalara Dön
            </button>
          )}
        </div>

        {/* Personel Rozeti & Kilitleme */}
        <div className="cashier-operator-pill">
          <span className="operator-name">👤 {cashierSession.user.fullName}</span>
          <button
            type="button"
            className="operator-lock-btn"
            title="Kasiyeri değiştir veya ekranı kilitle"
            onClick={() => {
              clearPosSession("cashier");
              setCashierSession(null);
            }}
          >
            🔒 Kilitle
          </button>
        </div>

        {/* Hibrit Bağlantı & Bulut Eşitleme Durumu */}
        <SyncStatusPill
          syncStatus={syncStatus}
          localReachable={localReachable}
          apiOffline={Boolean(error)}
          apiLoading={loading}
          flushing={syncFlushing}
          onTrigger={() => void triggerSyncFlush()}
        />
      </div>
    </header>
    {!cashLoading && !isShiftOpen && morningDismissed && <section className="cashier-shift-closed-banner" aria-label="Vardiya kapalı">
      <div className="banner-left"><span className="banner-icon">🔒</span><div><strong>Vardiya henüz açılmadı</strong><span>Ekran salt okunur. Tahsilat için vardiya açılışını tamamlayın.</span></div></div>
      <button type="button" className="banner-action-btn" onClick={() => { setMorningError(""); setMorningConfirming(false); setMorningDismissed(false); }}>Vardiyayı Aç</button>
    </section>}
    {cashError && <p className="ops-error" role="alert">Kasa bilgileri alınamadı. {cashOverview ? "Son bilgiler güncel olmayabilir." : ""}</p>}
    {!cashLoading && !cashError && !mainRegister && <p className="ops-error" role="alert">{cashOverview?.registers.length ? "Seçili kasa artık kullanılabilir değil. Lütfen bir kasa seçin." : "Aktif kasa bulunamadı."}</p>}
    {cashNotice && (
      <div
        role="status"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          margin: "0 0 10px",
          background: "#f0fdf4",
          border: "1px solid #bbf7d0",
          borderRadius: "8px",
          color: "#166534",
          fontSize: "13px",
          fontWeight: 600,
        }}
      >
        <span>{cashNotice}</span>
        <button
          type="button"
          onClick={() => setCashNotice("")}
          aria-label="Kapat"
          style={{
            background: "transparent",
            border: "none",
            color: "#166534",
            cursor: "pointer",
            fontSize: "16px",
            lineHeight: 1,
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </div>
    )}
    {showMorningScreen && mainRegister && <div className="morning-shift-overlay" role="dialog" aria-modal="true" aria-labelledby="morning-shift-title">
        <div className="morning-shift-card">
          <div className="morning-shift-header">
            <div className="morning-shift-icon-wrap">
              <span>☀️</span>
            </div>
            <div className="morning-shift-titles">
              <div className="morning-shift-topline">
                <span className="morning-shift-badge">
                  <span className="morning-status-dot closed" />
                  <span>Kasa Kapalı • Gün Başlangıcı</span>
                </span>
                <span className="morning-shift-date">{todayFormatted}</span>
              </div>
              <h2 id="morning-shift-title">Sabah Kasa Açılışı</h2>
            </div>
            <div className="morning-shift-info-pills">
              <label className="morning-register-select">Kasa
                <select aria-label="Açılacak kasa" value={mainRegister.id} disabled={cashBusy || Boolean(cashError)} onChange={(event) => selectRegister(event.target.value)}>
                  {cashOverview?.registers.map((register) => <option key={register.id} value={register.id}>{register.name} ({register.code})</option>)}
                </select>
              </label>
              <span>👤 Sorumlu: <b>{mainRegister.responsible || "Atanmamış"}</b></span>
            </div>
          </div>

          <div className="morning-shift-body">
            <div className="morning-left-pane">
              <div className="morning-prompt-box">
                <label htmlFor="morning-amount-input" className="morning-input-label">
                  Çekmecedeki Başlangıç Nakit Tutarı (Bozuk Para / Avans)
                </label>
                <div className="morning-display-row">
                  <div className="morning-display-val">
                    <input
                      id="morning-amount-input"
                      type="text"
                      inputMode="decimal"
                      className="morning-amount-input"
                      value={morningAmount}
                      onChange={(e) => {
                        setMorningError("");
                        setMorningAmount(e.target.value);
                      }}
                      placeholder="Tutarı girin"
                      autoFocus
                      disabled={cashBusy}
                    />
                    <span className="morning-currency">₺</span>
                  </div>
                  <button
                    type="button"
                    className="morning-clear-btn"
                    onClick={() => {
                      setMorningError("");
                      setMorningAmount("");
                    }}
                    disabled={cashBusy}
                    title="Sıfırla"
                  >
                    Temizle
                  </button>
                </div>
                {morningMinor !== null && (
                  <div className="morning-amount-helper">
                    Girilen avans: <b>{money(morningMinor)}</b>
                  </div>
                )}

                <div className="morning-presets-row">
                  <span className="morning-presets-title">Hızlı Seçim (Önerilen Avanslar):</span>
                  <div className="morning-presets-list">
                    {[
                      { label: "₺ 500", val: "500" },
                      { label: "₺ 1.000", val: "1000", highlight: true },
                      { label: "₺ 1.500", val: "1500" },
                      { label: "₺ 2.000", val: "2000" },
                      { label: "₺ 3.000", val: "3000" },
                      { label: "0 ₺ (Avanssız)", val: "0" },
                    ].map((preset) => (
                      <button
                        key={preset.val}
                        type="button"
                        className={`morning-preset-chip ${morningAmount === preset.val ? "active" : ""} ${preset.highlight ? "highlight" : ""}`}
                        onClick={() => {
                          setMorningError("");
                          setMorningAmount(preset.val);
                        }}
                        disabled={cashBusy}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="morning-note-wrap">
                  <label className="morning-note-label">Açılış Notu / Açıklama (İsteğe bağlı):</label>
                  <input
                    type="text"
                    className="morning-note-input"
                    maxLength={500}
                    value={morningNote}
                    onChange={(e) => setMorningNote(e.target.value)}
                    placeholder="Örn: 200 TL bozuk para, 800 TL banknot..."
                    disabled={cashBusy}
                  />
                </div>

                {morningConfirming && morningMinor !== null && (
                  <section className="morning-opening-summary" aria-live="polite">
                    <strong>Açılış özeti</strong>
                    <div><span>Kasada sayılan</span><b>{money(morningMinor)}</b></div>
                    {morningNote.trim() && <div><span>Açılış notu</span><p>{morningNote.trim()}</p></div>}
                    <small>Bilgileri kontrol edin. Onayladığınızda vardiya açılacak.</small>
                  </section>
                )}

                {morningError && (
                  <div className="morning-error-box" role="alert">
                    ⚠️ {morningError}
                  </div>
                )}
              </div>
            </div>

            <div className="morning-right-pane">
              <span className="morning-keypad-title">Dokunmatik Tuş Takımı</span>
              <div className="morning-keypad-grid">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "+100", "0", "⌫"].map((btn) => (
                  <button
                    key={btn}
                    type="button"
                    className={`morning-keypad-btn ${btn === "+100" ? "increment" : btn === "⌫" ? "backspace" : ""}`}
                    disabled={cashBusy}
                    onClick={() => handleMorningKeypad(btn)}
                  >
                    {btn}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="morning-shift-footer">
            <button
              type="button"
              className="morning-skip-btn"
              disabled={cashBusy}
              onClick={() => setMorningDismissed(true)}
            >
              👀 Şimdilik Atla (Salt Okunur)
            </button>
            <button
              type="button"
              className="morning-submit-btn"
              disabled={cashBusy}
              onClick={() => {
                if (morningConfirming) void handleOpenMorningShift(morningAmount, morningNote);
                else if (morningMinor !== null) { setMorningError(""); setMorningConfirming(true); }
                else void handleOpenMorningShift(morningAmount, morningNote);
              }}
            >
              {cashBusy ? "Açılış doğrulanıyor…" : morningConfirming ? "Onayla ve vardiyayı aç" : "Açılışı gözden geçir"}
            </button>
          </div>
        </div>
      </div>}
    <dialog ref={cashDialogRef} className="waiter-reservation-dialog" onCancel={(event) => { if (cashBusy) event.preventDefault(); else setCashDialog(null); }} onClose={() => setCashDialog(null)}>
      {cashDialog && (() => {
        const openTableEntries = Object.entries(checks).flatMap(([tId, list]) =>
          list.filter((c) => c.status === "open").map((check) => ({
            tableId: tId,
            tableName: tables.find((t) => t.id === tId)?.name ?? tId,
            check,
          }))
        );
        const openQuickEntries = unfinishedChecks.filter((c) => c.status === "open");
        const totalOpenCount = openTableEntries.length + openQuickEntries.length;
        const expectedMinor = activeShift?.expectedCashMinor ?? cashDialog.expected;
        return (
          <form className="waiter-custom-modal" onSubmit={(event) => void submitCashShift(event)}>
            <header>
              <h2>{cashDialog.mode === "open" ? "Vardiyayı aç" : `${mainRegister?.name ?? "Kasa"} · Vardiyayı kapat`}</h2>
            </header>
            {cashDialog.mode === "close" && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, background: "#f3f8f4", border: "1px solid #cce0d0", borderRadius: 10, padding: "10px 12px" }}>
                  <span style={{ fontSize: 13, color: "#254430" }}>
                    Kasada olması beklenen nakit: <strong style={{ fontSize: 15, color: "#153620" }}>{expectedMinor === undefined ? "—" : money(expectedMinor)}</strong>
                  </span>
                </div>
                <fieldset className="cash-count-grid">
                  <legend>Kupür sayımı (isteğe bağlı — doğrudan toplamı da yazabilirsiniz)</legend>
                  {[20000, 10000, 5000, 2000, 1000, 500, 100, 50, 25, 10, 5, 1].map((denomination) => (
                    <label key={denomination}>
                      {money(denomination)}
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={cashDenominations[denomination] ?? ""}
                        disabled={cashBusy}
                        onChange={(event) => {
                          const value = Math.max(0, Math.min(1000000, Math.floor(Number(event.target.value) || 0)));
                          const next = { ...cashDenominations, [denomination]: value };
                          setCashDenominations(next);
                          const total = Object.entries(next).reduce((sum, [unit, count]) => sum + Number(unit) * count, 0);
                          setCashAmount(`${Math.floor(total / 100)},${String(total % 100).padStart(2, "0")}`);
                        }}
                      />
                    </label>
                  ))}
                </fieldset>
              </>
            )}
            <label className="waiter-note-field">
              {cashDialog.mode === "open" ? "Başlangıç nakdi (TL)" : "Kasada sayılan fiziksel nakit (TL)"}
              <input
                inputMode="decimal"
                autoFocus
                value={cashAmount}
                onChange={(event) => setCashAmount(event.target.value)}
                placeholder="Örn. 1.000,00"
                disabled={cashBusy}
                readOnly={cashDialog.mode === "close" && Object.values(cashDenominations).some((count) => count > 0)}
              />
            </label>
            {cashDialog.mode === "close" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
                  <label className="waiter-note-field">
                    Yarına devreden bozuk para (TL)
                    <input
                      inputMode="decimal"
                      value={retainedFloatInput}
                      onChange={(event) => setRetainedFloatInput(event.target.value)}
                      disabled={cashBusy}
                      placeholder="Örn. 1.000,00"
                    />
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", background: "#f7fafc", padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: 12, color: "#4a5568", fontWeight: 600 }}>Teslim Edilecek Hasılat (Safe Drop)</span>
                    <strong style={{ fontSize: 16, color: "#2b6cb0" }}>
                      {(() => {
                        const raw = cashAmount.trim().replace(/\s/g, "").replace(",", ".");
                        const countedMinor = !isNaN(Number(raw)) ? Math.round(Number(raw) * 100) : 0;
                        const retainedMinor = Math.round(Number(retainedFloatInput.trim().replace(/\s/g, "").replace(",", ".")) * 100) || 0;
                        return money(Math.max(0, countedMinor - retainedMinor));
                      })()}
                    </strong>
                  </div>
                </div>
                <label className="waiter-note-field">
                  Fark açıklaması (sayılan tutar beklenenden farklıysa zorunlu)
                  <textarea rows={2} maxLength={500} value={cashNote} onChange={(event) => setCashNote(event.target.value)} disabled={cashBusy} placeholder="Kasa tam denkse boş bırakabilirsiniz" />
                </label>
              </>
            )}
            {cashDialog.mode === "close" && totalOpenCount > 0 && (
              <div
                role="region"
                aria-label="Kapatılmamış açık adisyonlar"
                style={{
                  background: "#fff8f1",
                  border: "1px solid #f0c48c",
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#9a4706", fontWeight: 800, fontSize: 13.5 }}>
                  <span aria-hidden="true">⚠️</span>
                  <span>Şubede Kapatılmamış {totalOpenCount} Açık Adisyon Var</span>
                </div>
                <p style={{ margin: 0, fontSize: 12.5, color: "#6e461d", lineHeight: 1.45 }}>
                  Vardiya kapatılmadan önce tüm açık hesapların tahsilatı tamamlanmalı veya iptal edilmelidir. Doğrudan ilgili hesaba gitmek için aşağıdan seçin:
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {openTableEntries.map(({ tableId, tableName, check }) => (
                    <button
                      key={check.id}
                      type="button"
                      onClick={() => {
                        setCashDialog(null);
                        setCashierMode("tables");
                        setSelectedId(tableId);
                        setSelectedCheckId(check.id);
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid #e3b276",
                        background: "#ffffff",
                        color: "#7c3b04",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      🍽️ {tableName} · {money(check.remainingMinor)} → Hesaba Git
                    </button>
                  ))}
                  {openQuickEntries.map((check) => (
                    <button
                      key={check.id}
                      type="button"
                      onClick={() => {
                        setCashDialog(null);
                        setCashierMode("quick");
                        void resumeQuickCheck(check.id);
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid #e3b276",
                        background: "#ffffff",
                        color: "#7c3b04",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      ⚡ Hızlı Satış #{check.id.slice(0, 6)} · {money(check.remainingMinor)} → Hesaba Git
                    </button>
                  ))}
                </div>
              </div>
            )}
            {cashActionError && (
              <div
                role="alert"
                style={{
                  background: "#fff5f5",
                  border: "1px solid #feb2b2",
                  borderRadius: 10,
                  padding: "11px 14px",
                  color: "#9b2c2c",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                <strong style={{ display: "block", marginBottom: 3 }}>⚠️ Vardiya Kapatılamadı</strong>
                <span>{cashActionError}</span>
              </div>
            )}
            <footer>
              <button type="button" className="waiter-cancel-custom" disabled={cashBusy} onClick={() => setCashDialog(null)}>Vazgeç</button>
              <button type="submit" className="ops-primary" disabled={cashBusy}>{cashBusy ? "Kaydediliyor…" : cashDialog.mode === "open" ? "Vardiyayı aç" : "Say ve vardiyayı kapat"}</button>
            </footer>
          </form>
        );
      })()}
    </dialog>
    {error && <p className="ops-error" role="alert">{error}{updated && " Gösterilen bilgiler son başarılı güncellemeye aittir."}</p>}
    {loading && <p className="ops-message">Masalar ve adisyonlar yükleniyor…</p>}
    {!selected && cashierMode === "tables" && (() => {
      const floorSections = buildFloorSections(tables, configuredFloors).filter((f) => tables.some((t) => normalizeFloorName(t.floor) === f.key));
      const hasMultipleFloors = floorSections.length > 1;

      return (
        <>
          <div className="cashier-table-toolbar">
            <h2 className="cashier-table-title">🍽️ Masalar</h2>
            <button type="button" className="cashier-refresh-btn" onClick={() => void reload()} disabled={loading}>
              🔄 Yenile
            </button>
          </div>
          {!loading && !error && tables.length === 0 && <p className="ops-message">Gösterilecek aktif masa bulunamadı.</p>}
          {floorSections.map((floor) => {
            const floorTables = tables.filter((table) => normalizeFloorName(table.floor) === floor.key);
            if (!floorTables.length) return null;
            return (
              <section className="waiter-floor-section" key={floor.key} aria-label={floor.label}>
                {hasMultipleFloors && (
                  <div className="waiter-floor-heading">
                    <h3>{floor.label}</h3>
                    <span>{floorTables.length} masa</span>
                  </div>
                )}
                <div className="waiter-table-grid">
                  {floorTables.map((table) => {
                    const status = statusOf(table);
                    const visual = status === "bill_requested" ? "bill-requested" : table.group ? "grouped" : status === "reserved" ? "reserved" : status === "occupied" ? "occupied" : "empty";
                    const label = status === "bill_requested" ? "Hesap istendi" : table.group ? "Grupta" : status === "reserved" ? "Rezerve" : status === "occupied" ? "Dolu" : "Boş";
                    const primaryId = table.group?.primaryTableId ?? table.id;
                    const tableChecks = checks[primaryId] ?? [];
                    return (
                      <button type="button" key={table.id} className={`waiter-table-card ${visual}`} onClick={() => setSelectedId(primaryId)}>
                        <svg className="waiter-table-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                          <rect x="5" y="6" width="14" height="12" rx="3" />
                          <path d="M9 3h6M9 21h6M2 10v4M22 10v4" />
                        </svg>
                        <strong>{table.name}</strong>
                        <span className="waiter-table-status">{label}</span>
                        {table.group && <small className="waiter-group-card-label">Ana masa: {table.group.tableNames[0]}</small>}
                        {tableChecks.length > 0 && (
                          <>
                            <span className="waiter-table-owner">{tableChecks.length} açık adisyon{table.group ? " · ortak" : ""}</span>
                            <b>{money(tableChecks.reduce((sum, check) => sum + check.totalMinor, 0))}</b>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      );
    })()}
    {cashierMode === "quick" && (
      <section className="cashier-quick-split-container" aria-label="Hızlı Satış ve Tahsilat Ekranı">
        {/* SOL BÖLÜM: %65 - Menü ve Menü Altı Sepet */}
        <div className="cashier-quick-left-col">
          {unfinishedChecks.length > 0 && quickActiveCheck && (
            <div className="quick-pending-banner">
              <span>⏸️ <strong>{unfinishedChecks.length}</strong> bekleyen tezgâh / paket satışı var</span>
              <button
                type="button"
                className="quick-pending-banner-btn"
                onClick={() => {
                  setQuickActiveCheck(null);
                  setQuickNotice("Bekleyen satışlar sağ panelde listeleniyor.");
                }}
              >
                Bekleyenleri Gör →
              </button>
            </div>
          )}

          {quickNotice && <p className="ops-success" role="status" style={{ margin: "0 0 6px" }}>{quickNotice}</p>}
          {quickError && <p className="ops-error" role="alert" style={{ margin: "0 0 6px" }}>{quickError}</p>}
          {unfinishedError && <p className="ops-error" role="alert" style={{ margin: "0 0 6px" }}>Açık satışlar yüklenemedi: {unfinishedError}</p>}
          {catalogError && (
            <p className="ops-error" role="alert" style={{ margin: "0 0 6px" }}>
              Ürünler yüklenemedi: {catalogError}{" "}
              <button type="button" onClick={() => setCatalogRevision((v) => v + 1)}>Tekrar dene</button>
            </p>
          )}

          {/* Kategori Sekmeleri */}
          <div className="cashier-quick-categories" aria-label="Kategoriler">
            <button
              type="button"
              className={`cashier-quick-cat-btn ${selectedQuickCat === "all" ? "active" : ""}`}
              onClick={() => setSelectedQuickCat("all")}
            >
              Tüm Ürünler ({catalogProducts.length})
            </button>
            {catalogCategories.map((cat) => (
              <button
                type="button"
                key={cat.id}
                className={`cashier-quick-cat-btn ${selectedQuickCat === cat.id ? "active" : ""}`}
                onClick={() => setSelectedQuickCat(cat.id)}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Ürün Kartları Izgarası */}
          <div className="cashier-quick-products-grid">
            {filteredQuickProducts.length === 0 ? (
              <p className="ops-message" style={{ gridColumn: "1 / -1" }}>Eşleşen ürün bulunamadı.</p>
            ) : (
              filteredQuickProducts.map((product) => {
                const inCart = quickCart.find((item) => item.product.id === product.id);
                return (
                  <div
                    key={product.id}
                    className={`cashier-quick-product-card ${inCart ? "has-cart" : ""} ${product.isOutOfStock ? "out-of-stock" : ""}`}
                    onClick={() => {
                      if (product.isOutOfStock) {
                        setQuickError(`${product.name} tükendi. Mutfak stoğunda ${product.limitingIngredientName || "hammadde"} bulunmuyor.`);
                        return;
                      }
                      if (!pendingQuick) {
                        setQuickOptionSelection(null);
                        setQuickOptionProduct(product);
                      }
                    }}
                  >
                    <div className="cashier-quick-product-top">
                      {product.image.startsWith("upload:") && (
                        <span className="cashier-quick-product-image">
                          <PosProductImage image={product.image} productId={product.id} name={product.name} />
                        </span>
                      )}
                      <span className="cashier-quick-product-name">{product.name}</span>
                      {product.isOutOfStock ? (
                        <span className="cashier-stock-badge out-of-stock">🚫 Tükendi</span>
                      ) : product.isCriticalStock ? (
                        <span className="cashier-stock-badge critical-stock">⚠️ Kritik ({product.availablePortions ?? 0})</span>
                      ) : inCart ? (
                        <span className="cashier-quick-product-badge">Sepette ({inCart.quantity})</span>
                      ) : null}
                    </div>
                    <strong className="cashier-quick-product-price">{money(product.price.amountMinor)}</strong>
                  </div>
                );
              })
            )}
          </div>

          {/* Menü Altı Canlı Sepet ve Onay Alanı */}
          {(quickCart.length > 0 || orderSentToast) && (
            <section className="quick-cart-inline" aria-label="Menü Altı Sepet">
              {/* 2 Saniyelik Minik Onay Rozeti (Sadece burada görünür ve kaybolur) */}
              {orderSentToast && (
                <div className="quick-order-sent-toast" role="status">
                  <span className="toast-icon">✅</span>
                  <div className="toast-content">
                    <strong>Sipariş mutfağa iletildi!</strong>
                    <span>{orderSentToast.label} · {orderSentToast.count} ürün · {money(orderSentToast.totalMinor)}</span>
                  </div>
                </div>
              )}

              {quickCart.length > 0 && (
                <>
                  <div className="quick-cart-inline-header">
                    <h3>🛒 Sepet ({quickCartCount} Ürün)</h3>
                    <strong>Toplam: {money(quickTotalMinor)}</strong>
                  </div>

                  <div className="quick-cart-inline-list">
                    {quickCart.map((item) => (
                      <div className="quick-cart-inline-row" key={item.id}>
                        <div className="quick-cart-inline-info">
                          <strong>{item.product.name}</strong>
                          {item.options.length > 0 && (
                            <small>
                              {item.options.map((opt) => `${opt.optionName}${opt.quantity > 1 ? ` × ${opt.quantity}` : ""}`).join(", ")}
                            </small>
                          )}
                          <span className="item-price">
                            {money(
                              (item.product.price.amountMinor +
                                item.options.reduce((sum, opt) => sum + opt.priceDeltaMinor * opt.quantity, 0)) *
                                item.quantity
                            )}
                          </span>
                        </div>
                        <div className="quick-cart-inline-qty">
                          <button
                            type="button"
                            disabled={Boolean(pendingQuick)}
                            onClick={() => updateQuickCartQty(item.id, -1)}
                            aria-label={`${item.product.name} azalt`}
                          >
                            −
                          </button>
                          <b>{item.quantity}</b>
                          <button
                            type="button"
                            disabled={Boolean(pendingQuick)}
                            onClick={() => updateQuickCartQty(item.id, 1)}
                            aria-label={`${item.product.name} artır`}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Sabit Sepet Aksiyon Çubuğu */}
                  <div className="quick-cart-inline-actions">
                    <button
                      type="button"
                      className="quick-cart-btn-clear"
                      disabled={quickBusy || Boolean(pendingQuick)}
                      onClick={() => setQuickCart([])}
                    >
                      🗑️ Sepeti Temizle
                    </button>
                    <button
                      type="button"
                      className="quick-cart-btn-park"
                      disabled={quickBusy || Boolean(pendingQuick)}
                      onClick={() => {
                        setParkLabelInput(`Paket #${new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`);
                        setParkDialogOpen(true);
                      }}
                    >
                      ⏸️ Askıya Al / Beklet
                    </button>
                    <button
                      type="button"
                      className="quick-cart-btn-submit"
                      disabled={quickBusy || Boolean(pendingQuick)}
                      onClick={() => void proceedToPayment()}
                    >
                      {quickBusy
                        ? "Sipariş Oluşturuluyor…"
                        : `🛒 Sepeti Onayla & Mutfağa Gönder (${quickCartCount} Ürün · ${money(quickTotalMinor)}) →`}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>

        {/* SAĞ BÖLÜM: %35 - Canlı Adisyon & Masa Tipi Detaylı Tahsilat */}
        <div className="cashier-quick-right-col">
          {quickSuccess && (
            <div className="cashier-quick-success-banner" role="status">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>✅ Satış Tamamlandı</strong>
                <button
                  type="button"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#14532d", fontWeight: 700 }}
                  onClick={() => setQuickSuccess(null)}
                >
                  ✕
                </button>
              </div>
              <div>Toplam: {money(quickSuccess.totalMinor)} · {quickSuccess.method}</div>
              {quickSuccess.changeMinor > 0 && (
                <div className="change-alert" style={{ marginTop: 4 }}>
                  💵 Verilecek Para Üstü: <strong>{money(quickSuccess.changeMinor)}</strong>
                </div>
              )}
            </div>
          )}

          {splitNotice && <p className="ops-success" role="status" style={{ margin: "0 0 6px" }}>{splitNotice}</p>}

          {quickActiveCheck ? (
            <article className="quick-checkout-card">
              <header className="quick-checkout-header">
                <div>
                  <span className="quick-checkout-eyebrow">⚡ GEL-AL / PAKET ADİSYONU</span>
                  <h2 className="quick-checkout-title">
                    {quickActiveCheck.orders[0]?.items[0]?.note || `Satış #${quickActiveCheck.id.slice(0, 8).toUpperCase()}`}
                  </h2>
                  <small className="quick-checkout-meta">
                    Açılış: {new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(quickActiveCheck.createdAt))} · {mainRegister?.name ?? "Kasa"}
                  </small>
                </div>
                <span className={`cashier-open-badge ${quickActiveCheck.paymentStatus}`}>
                  {paymentLabel(quickActiveCheck.paymentStatus)}
                </span>
              </header>

              {/* Kalemler Listesi */}
              <div className="quick-checkout-items">
                {quickActiveCheck.orders.flatMap((order) =>
                  order.items.map((line) => (
                    <div className="quick-checkout-item-row" key={`${order.id}:${line.id}`}>
                      <span className="item-qty">{line.quantity}×</span>
                      <div className="item-details">
                        <strong>{line.productName}</strong>
                        <small>{line.quantity} × {money(line.unitPriceMinor)}</small>
                        {Boolean(line.note || line.options?.length) && (
                          <small className="item-options">
                            {[...(line.options ?? []).map((o) => o.optionName), line.note].filter(Boolean).join(" · ")}
                          </small>
                        )}
                      </div>
                      <b className="item-total">{money(line.lineTotalMinor)}</b>
                    </div>
                  ))
                )}
              </div>

              {/* Masa Tipi Yönetim Butonları (Müdür PIN Korumalı) */}
              <div className="quick-checkout-actions">
                <button
                  type="button"
                  className="quick-action-btn"
                  disabled={Boolean(error) || quickActiveCheck.payments.length > 0}
                  onClick={() => showCashierAction("discount")}
                  title={quickActiveCheck.payments.length > 0 ? "Ödeme alınmış adisyona indirim uygulanamaz" : "İndirim uygula"}
                >
                  🏷️ İndirim
                </button>
                <button
                  type="button"
                  className="quick-action-btn"
                  disabled={Boolean(error) || quickActiveCheck.payments.length > 0}
                  onClick={() => showCashierAction("comp")}
                  title={quickActiveCheck.payments.length > 0 ? "Ödeme alınmış adisyona ikram uygulanamaz" : "Ürün ikramı"}
                >
                  🎁 İkram
                </button>
                <button
                  type="button"
                  className="quick-action-btn"
                  disabled={Boolean(error) || quickActiveCheck.payments.length > 0}
                  onClick={() => showCashierAction("void")}
                  title={quickActiveCheck.payments.length > 0 ? "Ödeme alınmış adisyondan ürün iptal edilemez" : "Kalem iptali"}
                >
                  🗑️ İptal
                </button>
                <button
                  type="button"
                  className="quick-action-btn"
                  disabled={Boolean(error) || quickActiveCheck.payments.length > 0}
                  onClick={() => {
                    setSplitCheck(quickActiveCheck);
                    setSplitQuantities({});
                    setSplitError("");
                    setSplitNotice("");
                  }}
                  title={quickActiveCheck.payments.length > 0 ? "Ödeme alınmış adisyon bölünemez" : "Adisyonu böl"}
                >
                  ✂️ Böl
                </button>
                <button
                  type="button"
                  className="quick-action-btn park"
                  onClick={() => {
                    setQuickActiveCheck(null);
                    setQuickNotice("Adisyon askıya alındı. Sıradaki müşterinin siparişini alabilirsiniz.");
                    void loadUnfinishedChecks();
                  }}
                >
                  ⏸️ Askıya Al
                </button>
                <button
                  type="button"
                  className="quick-action-btn cancel"
                  disabled={quickActiveCheck.payments.length > 0}
                  onClick={() => {
                    setCancellingCheck({
                      id: quickActiveCheck.id,
                      version: quickActiveCheck.version,
                      label: quickActiveCheck.orders[0]?.items[0]?.note || `Satış #${quickActiveCheck.id.slice(0, 6)}`,
                    });
                  }}
                >
                  ❌ İptal Et
                </button>
              </div>

              {/* Bakiye Özeti */}
              <div className="quick-checkout-balance-box">
                <div className="quick-checkout-due-row">
                  <div>
                    <span className="due-label">KALAN TUTAR</span>
                    {quickActiveCheck.paidMinor > 0 && (
                      <small className="paid-sublabel">Ödenen: {money(quickActiveCheck.paidMinor)}</small>
                    )}
                  </div>
                  <strong className="due-value">{money(quickActiveCheck.remainingMinor)}</strong>
                </div>
                {quickActiveCheck.adjustmentMinor > 0 && (
                  <div className="quick-checkout-discount-row">
                    <span>Uygulanan İndirim / İkram:</span>
                    <strong>−{money(quickActiveCheck.adjustmentMinor)}</strong>
                  </div>
                )}
              </div>

              {/* Ödeme Yöntemleri Seçimi */}
              <div className="quick-checkout-methods">
                <div className="quick-methods-grid">
                  <button
                    type="button"
                    className={`quick-method-btn ${paymentMethod === "cash" ? "active" : ""}`}
                    onClick={() => { setPaymentMethod("cash"); setPaymentSubMethod(""); }}
                  >
                    💵 Nakit
                  </button>
                  <button
                    type="button"
                    className={`quick-method-btn ${paymentMethod === "card" ? "active" : ""}`}
                    onClick={() => { setPaymentMethod("card"); setPaymentSubMethod("Ziraat POS"); }}
                  >
                    💳 Kredi Kartı
                  </button>
                  <button
                    type="button"
                    className={`quick-method-btn ${paymentMethod === "meal" ? "active" : ""}`}
                    onClick={() => { setPaymentMethod("meal"); setPaymentSubMethod("Sodexo"); }}
                  >
                    🍱 Yemek Kartı
                  </button>
                  <button
                    type="button"
                    className={`quick-method-btn ${paymentMethod === "cari" ? "active" : ""}`}
                    onClick={() => { setPaymentMethod("cari"); setCustomerSearch(""); setCustomerOpen(true); }}
                  >
                    👤 Cariye Yaz
                  </button>
                  <button
                    type="button"
                    className={`quick-method-btn ${paymentMethod === "transfer" ? "active" : ""}`}
                    onClick={() => { setPaymentMethod("transfer"); setPaymentSubMethod(""); }}
                  >
                    🏦 Havale / EFT
                  </button>
                </div>

                {/* Alt Metodlar (POS veya Yemek Kartı) */}
                {paymentMethod === "card" && (
                  <div className="quick-submethods-row">
                    {["Ziraat POS", "VakıfBank POS", "Garanti POS"].map((sub) => (
                      <button
                        type="button"
                        key={sub}
                        className={`quick-submethod-btn ${paymentSubMethod === sub ? "active" : ""}`}
                        onClick={() => setPaymentSubMethod(sub)}
                      >
                        {sub}
                      </button>
                    ))}
                  </div>
                )}
                {paymentMethod === "meal" && (
                  <div className="quick-submethods-row">
                    {["Sodexo", "Multinet", "Ticket", "Setcard", "Metropol"].map((sub) => (
                      <button
                        type="button"
                        key={sub}
                        className={`quick-submethod-btn ${paymentSubMethod === sub ? "active" : ""}`}
                        onClick={() => setPaymentSubMethod(sub)}
                      >
                        {sub}
                      </button>
                    ))}
                  </div>
                )}
                {paymentMethod === "cari" && customerSelected && (
                  <div className="quick-customer-badge">
                    <span>Müşteri: <strong>{customerSelected.name}</strong> ({money(customerSelected.customerBalanceMinor)})</span>
                    <button type="button" onClick={() => { setCustomerSearch(""); setCustomerOpen(true); }}>Değiştir</button>
                  </div>
                )}
                {paymentMethod === "cari" && !customerSelected && (
                  <div className="quick-submethods-row">
                    <button
                      type="button"
                      className="quick-submethod-btn active"
                      style={{ background: "#fef3c7", color: "#92400e", borderColor: "#f59e0b", fontWeight: 700 }}
                      onClick={() => { setCustomerSearch(""); setCustomerOpen(true); }}
                    >
                      👤 Müşteri Seçin (Cariye Yazmak İçin Tıklayın)
                    </button>
                  </div>
                )}
              </div>

              {/* Hızlı Banknotlar & Tuş Takımı */}
              <div className="quick-checkout-keypad-box">
                <div className="quick-amounts-grid">
                  <button
                    type="button"
                    onClick={() =>
                      setAmountInput(
                        `${Math.floor(quickActiveCheck.remainingMinor / 100)},${String(
                          quickActiveCheck.remainingMinor % 100
                        ).padStart(2, "0")}`
                      )
                    }
                  >
                    TAM ({money(quickActiveCheck.remainingMinor)})
                  </button>
                  <button type="button" onClick={() => setAmountInput("100,00")}>100 ₺</button>
                  <button type="button" onClick={() => setAmountInput("200,00")}>200 ₺</button>
                  <button type="button" onClick={() => setAmountInput("500,00")}>500 ₺</button>
                  <button type="button" className="clear-btn" onClick={() => enterAmountKey("C")}>C</button>
                </div>

                <div className="quick-input-display">
                  <span>{paymentMethod === "cash" ? "ALINAN NAKİT" : "GİRİLEN TUTAR"}:</span>
                  <strong>{money(amountMinor)}</strong>
                </div>

                {paymentMethod === "cash" && amountMinor > quickActiveCheck.remainingMinor && (
                  <div className="quick-change-display">
                    <span>💵 VERİLECEK PARA ÜSTÜ:</span>
                    <strong>{money(amountMinor - quickActiveCheck.remainingMinor)}</strong>
                  </div>
                )}

                <div className="quick-numpad-grid">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"].map((key) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => enterAmountKey(key)}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tahsilatı Tamamla Butonu */}
              <button
                type="button"
                className="quick-submit-payment-btn"
                disabled={Boolean(payBlocker) || payBusy || Boolean(error)}
                onClick={() => {
                  if (isZeroBalance) void closeZeroCheck();
                  else void submitPayment();
                }}
              >
                {payBusy
                  ? "İşleniyor & Yazdırılıyor…"
                  : isZeroBalance
                  ? "Adisyonu Kapat (0,00 ₺)"
                  : `⚡ ${paymentMethod === "cash" ? "💵" : paymentMethod === "cari" ? "👤" : paymentMethod === "meal" ? "🍱" : paymentMethod === "transfer" ? "🏦" : "💳"} ${money(Math.min(amountMinor, quickActiveCheck.remainingMinor))} Tahsil Et & Yazdır`}
              </button>

              {payError && <p className="ops-error" role="alert" style={{ margin: "6px 0 0" }}>{payError}</p>}

              <footer className="quick-checkout-footer">
                <button
                  type="button"
                  className="quick-print-receipt-btn"
                  disabled={payBusy}
                  onClick={() =>
                    printAccountReceipt(
                      {
                        check: quickActiveCheck,
                        location: "Hızlı Satış",
                        printedAt: new Date().toISOString(),
                      },
                      false,
                      paymentMethod ? paymentMethod.toUpperCase() : "BILGI"
                    )
                  }
                >
                  🧾 Bilgi Fişi Yazdır
                </button>
              </footer>
            </article>
          ) : (
            <article className="quick-empty-checkout-card">
              <div className="quick-empty-icon">⚡</div>
              <h3>Hızlı Satış Tezgâhı Hazır</h3>
              <p>Sol taraftaki menüden ürünleri sepete ekleyip <strong>'Sepeti Onayla'</strong> butonuna basın veya aşağıdaki bekleyen siparişlerden birini seçin.</p>

              {unfinishedChecks.length > 0 && (
                <div className="quick-unfinished-list">
                  <header className="quick-unfinished-header">
                    <h4>⏸️ BEKLEYEN SATIŞLAR ({unfinishedChecks.length})</h4>
                    <button type="button" onClick={() => void loadUnfinishedChecks()} disabled={quickBusy}>
                      🔄
                    </button>
                  </header>
                  <div className="quick-unfinished-items">
                    {unfinishedChecks.map((chk) => {
                      const label = chk.orders[0]?.items[0]?.note || `Satış #${chk.id.slice(0, 6)}`;
                      const itemsSummary = chk.orders.flatMap((o) => o.items).map((it) => `${it.quantity}× ${it.productName}`).join(", ");
                      return (
                        <div key={chk.id} className="quick-unfinished-card">
                          <div className="unfinished-info">
                            <strong>{label}</strong>
                            <small>{itemsSummary}</small>
                            <span className="unfinished-time">⏱️ {formatElapsedMinutes(chk.createdAt)}</span>
                          </div>
                          <div className="unfinished-actions">
                            <b className="unfinished-price">{money(chk.remainingMinor)}</b>
                            <button
                              type="button"
                              className="unfinished-resume-btn"
                              onClick={() => void resumeQuickCheck(chk.id)}
                              disabled={quickBusy}
                            >
                              ⚡ Tahsil Et
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </article>
          )}
        </div>
      </section>
    )}
    {quickOptionProduct && <div className="waiter-modal-backdrop" role="dialog" aria-modal="true" aria-label={`${quickOptionProduct.name} seçenekleri`}><div className="waiter-custom-modal"><header><h2>{quickOptionProduct.name}</h2><button type="button" className="waiter-modal-close" onClick={() => setQuickOptionProduct(null)} aria-label="Kapat">×</button></header><ProductOptionPicker key={quickOptionProduct.id} firmId={firmId} branchId={branchId} actor="pos-single" productId={quickOptionProduct.id} basePriceMinor={quickOptionProduct.price.amountMinor} onChange={setQuickOptionSelection} /><p>Birim fiyat: {money(quickOptionSelection?.unitPriceMinor ?? quickOptionProduct.price.amountMinor)}</p><footer><button type="button" className="waiter-cancel-custom" onClick={() => setQuickOptionProduct(null)}>Vazgeç</button><button type="button" className="ops-primary" disabled={!quickOptionSelection?.valid} onClick={() => { if (quickOptionSelection?.valid) addToQuickCart(quickOptionProduct, quickOptionSelection.items); setQuickOptionProduct(null); }}>Sepete ekle</button></footer></div></div>}
    {selected && cashierMode === "tables" && <section className="cashier-details" aria-label="Masa ve adisyon detayı">
      {splitNotice && <p className="ops-success" role="status">{splitNotice}</p>}
      {selected?.group && <p className="cashier-group-note">Ortak masa grubu: {selected.group.tableNames.join(" + ")} · Ana masa: {selected.name}</p>}
      <div className="cashier-detail-grid">
        <article className="cashier-detail-panel cashier-bill">
          <header className="cashier-bill-header">
            {!isQuickPayment && <span className="cashier-table-number"><small>MASA</small>{selected?.number}</span>}
            <div className="cashier-bill-heading-copy">
              <h1>{isQuickPayment ? (activeCheck?.orders[0]?.items[0]?.note ? `📦 ${activeCheck.orders[0].items[0].note}` : "Hızlı Satış (Gel-Al)") : selected?.name}</h1>
              <span>{activeCheck ? (isQuickPayment ? "1 açık adisyon" : `${selectedChecks.length} açık adisyon`) : "Açık adisyon yok"}</span>
              <span className="cashier-table-meta">{isQuickPayment ? "Kasa: Hızlı Satış Terminali" : `Garson: ${selected?.assignment?.waiterName ?? "Atanmamış"}`}</span>
              {activeCheck?.createdAt && <span className="cashier-table-meta">Adisyon açılışı: {new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(activeCheck.createdAt))} ({formatElapsedMinutes(activeCheck.createdAt)})</span>}
            </div>
            <span className="cashier-open-badge">{isQuickPayment ? (activeCheck?.paymentStatus === "partially_paid" ? "Kısmi Ödeme" : "Açık Adisyon") : selected?.status === "bill_requested" ? "Hesap istendi" : activeCheck ? "Açık adisyon" : "Boş"}</span>
          </header>
          {activeCheck && <div className="cashier-balance"><span><strong>KALAN TUTAR</strong><small>{activeCheck.paidMinor > 0 ? "Simüle ödeme düşülmüştür" : "Adisyon bakiyesi"}</small></span><b>{money(activeCheck.remainingMinor)}</b></div>}
          {!isQuickPayment && selectedChecks.length > 0 && <section className="cashier-check-list" aria-label="Masanın açık adisyonları"><div className="cashier-check-list-heading"><strong>MASA ADİSYONLARI</strong><span>{selectedChecks.length} açık</span></div><div className="cashier-table-total"><span>Masa toplamı <small>Açık adisyonların toplamı</small></span><strong>{money(tableTotal)}</strong></div><div className="cashier-table-remaining"><span>Kalan toplam <small>Simüle ödemeler düşülür</small></span><strong>{money(tableRemaining)}</strong></div><div className="cashier-check-list-items">{selectedChecks.map((check, index) => <button type="button" className={`cashier-check-option${activeCheck?.id === check.id ? " selected" : ""}`} key={check.id} aria-pressed={activeCheck?.id === check.id} onClick={() => setSelectedCheckId(check.id)}><span><strong>Adisyon {index + 1}</strong><small className={`cashier-payment-status ${check.paymentStatus}`}>{paymentLabel(check.paymentStatus)}</small></span><b>{money(check.totalMinor)}</b></button>)}</div></section>}

          <div className="cashier-bill-items">{activeCheck ? activeCheck.orders.flatMap((order) => order.items.map((line) => <div className="cashier-bill-line" key={`${order.id}:${line.id}`}><span className="cashier-quantity">{line.quantity}×</span><div><strong>{line.productName}</strong><small>{line.quantity} × {money(line.unitPriceMinor)}</small>{Boolean(line.note || line.options?.length) && <small>{[...(line.options ?? []).map((option) => option.optionName), line.note].filter(Boolean).join(" · ")}</small>}</div><b>{money(line.lineTotalMinor)}</b></div>)) : <p className="cashier-empty">Bu masada açık adisyon bulunmuyor.</p>}</div>
          {activeCheck && <footer className="cashier-bill-footer"><div><span>Ara toplam</span><b>{money(activeCheck.grossTotalMinor)}</b></div>{activeCheck.adjustmentMinor > 0 && <div><span>İndirim / düzeltmeler</span><b>−{money(activeCheck.adjustmentMinor)}</b></div>}{activeCheck.adjustments.length > 0 && <section className="cashier-adjustments"><strong>İşlem detayları</strong>{activeCheck.adjustments.map((adjustment, index) => <div key={adjustment.requestId ?? index}><span>{adjustment.action === "discount" ? "İndirim" : adjustment.action === "comp" ? "İkram" : "Ürün iptali"} · −{money(adjustment.amountMinor)}</span><small>Gerekçe: {adjustment.reason}</small><small>İşlemi yapan: {adjustment.actor ?? "Bilinmiyor"}</small><small>{adjustment.approvalMode === "development_bypass" ? "Yönetici onayı alınmadı (geliştirme)" : "Yönetici onayı bilgisi yok"}</small></div>)}</section>}<div><span>Toplam adisyon tutarı</span><b>{money(activeCheck.totalMinor)}</b></div>{activeCheck.paidMinor > 0 && <div className="cashier-simulated"><span>Simüle ödeme</span><b>{money(activeCheck.paidMinor)}</b></div>}</footer>}
          {activeCheck?.payments.length ? <p className="cashier-action-warning">Ödeme girişimi olan adisyon bölünemez veya indirim/ikram işlemine alınamaz.</p> : null}
          <div className="cashier-bill-actions cashier-action-grid">
            {isQuickPayment && (
              <button
                type="button"
                className="cashier-split-button"
                style={{ background: "#fef3c7", color: "#92400e", borderColor: "#f59e0b", fontWeight: 700 }}
                onClick={() => {
                  setQuickActiveCheck(null);
                  setQuickStep("menu");
                  setQuickNotice("Açık satış beklemeye alındı. Sıradaki müşterinin siparişini alabilirsiniz.");
                  void loadUnfinishedChecks();
                }}
              >
                ⏸️ Beklet & Menüye Dön
              </button>
            )}
            {isQuickPayment && activeCheck && (
              <button
                type="button"
                className="cashier-split-button"
                style={{ background: "#fee2e2", color: "#991b1b", borderColor: "#f87171", fontWeight: 700 }}
                disabled={activeCheck.payments.length > 0}
                title={activeCheck.payments.length > 0 ? "Ödeme alınmış adisyon doğrudan iptal edilemez" : "Siparişi iptal et"}
                onClick={() => {
                  setCancellingCheck({
                    id: activeCheck.id,
                    version: activeCheck.version,
                    label: activeCheck.orders[0]?.items[0]?.note || `Satış #${activeCheck.id.slice(0, 6)}`,
                  });
                }}
              >
                🗑️ Siparişi İptal Et
              </button>
            )}
            {activeCheck && (
              <button
                type="button"
                className="cashier-split-button"
                style={{ background: "#e0f2fe", color: "#0369a1", borderColor: "#38bdf8", fontWeight: 700 }}
                disabled={kitchenPrinting}
                onClick={() => void printKitchenTicketForCheck(activeCheck.id)}
              >
                {kitchenPrinting ? "Basılıyor…" : "🖨️ Mutfak Fişi Tekrar"}
              </button>
            )}
            <button className="cashier-split-button" disabled={!activeCheck || Boolean(error)} onClick={() => { if (activeCheck) { setSplitCheck(activeCheck); setSplitQuantities({}); setSplitError(""); setSplitNotice(""); } }}>Adisyonu böl</button>
            {!isQuickPayment && <button className="cashier-split-button" disabled={!selected?.assignment || Boolean(selected?.group) || Boolean(error)} onClick={() => showCashierAction("transfer")}>Masayı taşı</button>}
            {!isQuickPayment && <button className="cashier-split-button" disabled={!selected?.assignment || Boolean(selected?.group) || Boolean(error)} onClick={() => showCashierAction("merge")}>Masaları birleştir</button>}
            <button className="cashier-split-button" disabled={!activeCheck || Boolean(error)} onClick={() => showCashierAction("discount")}>İndirim uygula</button>
            <button className="cashier-split-button" disabled={!activeCheck || Boolean(error)} onClick={() => showCashierAction("comp")}>İkram</button>
            <button className="cashier-split-button" disabled={!activeCheck || Boolean(error)} onClick={() => showCashierAction("void")}>Ürün iptali</button>
            <button className="cashier-split-button" disabled={loading} onClick={() => void reload()}>Yenile</button>
          </div>
        </article>
        <article className="cashier-detail-panel cashier-methods"><div className="cashier-panel-heading"><h2>ÖDEME YÖNTEMİ</h2><span>Tahsilat Seçimi</span></div><div className="cashier-method-list">{([
          { key: "cash", icon: "💵", name: "Nakit Ödeme", detail: "Nakit tahsilat" },
          { key: "card", icon: "💳", name: "Kredi Kartı / POS", detail: paymentSubMethod && paymentMethod === "card" ? paymentSubMethod : "Banka terminali seçin" },
          { key: "meal", icon: "🍱", name: "Yemek Kartı", detail: paymentSubMethod && paymentMethod === "meal" ? paymentSubMethod : "Yemek kartı seçin" },
          { key: "cari", icon: "👤", name: "Cariye Yaz (Veresiye)", detail: customerSelected ? `${customerSelected.name} (${money(customerSelected.customerBalanceMinor)})` : "Müşteri seçin" },
          { key: "transfer", icon: "🏦", name: "Banka Havalesi / EFT", detail: "Havale/EFT tahsilatı" },
        ] as const).map((method) => <div className={`cashier-method-group ${paymentMethod === method.key ? "selected" : ""}`} key={method.key}><button type="button" className="cashier-method-button" disabled={!activeCheck} aria-pressed={paymentMethod === method.key} onClick={() => { setPaymentMethod(method.key); setPaymentSubMethod(method.key === "card" ? "Ziraat POS" : method.key === "meal" ? "Sodexo" : ""); if (method.key === "cari") { setCustomerSearch(""); setCustomerOpen(true); } }}><span className="cashier-method-icon">{method.icon}</span><span className="cashier-method-text"><strong>{method.name}</strong><small>{method.detail}</small></span><span className="cashier-method-arrow">›</span></button>{paymentMethod === method.key && (method.key === "card" || method.key === "meal") && <div className="cashier-submethods" aria-label={method.key === "card" ? "Banka POS seçimi" : "Yemek kartı seçimi"}>{(method.key === "card" ? ["Ziraat POS", "VakıfBank POS", "Garanti POS"] : ["Sodexo", "Multinet", "Ticket", "Setcard", "Metropol"]).map((name) => <button type="button" className={paymentSubMethod === name ? "selected" : ""} aria-pressed={paymentSubMethod === name} key={name} onClick={() => setPaymentSubMethod(name)}>{name}</button>)}</div>}{paymentMethod === method.key && method.key === "cari" && <div className="cashier-submethods" aria-label="Cari müşteri seçimi"><button type="button" className="selected" onClick={() => { setCustomerSearch(""); setCustomerOpen(true); }}>{customerSelected ? `👤 Seçili: ${customerSelected.name} (Bakiye: ${money(customerSelected.customerBalanceMinor)}) · Değiştir` : "🔍 Müşteri Seçin (Listeyi Aç)"}</button></div>}</div>)}</div><div className="cashier-payment-history"><div className="cashier-panel-heading"><h2>ÖDEME GEÇMİŞİ</h2><span>{activeCheck?.payments.length ?? 0} işlem</span></div>{activeCheck?.payments.length ? activeCheck.payments.map((payment) => <div className="cashier-payment-row" key={payment.id}><strong>{money(payment.amountMinor)} · {payment.provider || (payment.method === "cash" ? "Nakit" : payment.method === "card" ? "Kredi Kartı" : payment.method === "meal" ? "Yemek Kartı" : payment.method === "transfer" ? "Havale/EFT" : payment.method === "cari" ? "Cari" : payment.method)}</strong><small>{payment.createdAt ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(payment.createdAt)) : "Saat bilgisi yok"} · {payment.status === "succeeded" ? "Tahsil Edildi" : payment.status}</small><small>Yöntem: {(payment.provider || payment.method).toUpperCase()}</small></div>) : <p>Bu adisyonda ödeme kaydı yok.</p>}</div></article>
        <article className="cashier-detail-panel cashier-keypad-panel"><div className="cashier-amount"><span>{paymentMethod === "cash" ? "ALINAN NAKİT · ÖNİZLEME" : "GİRİLEN TUTAR"}</span><strong aria-live="polite">{activeCheck ? money(amountMinor) : "—"}</strong><small>{activeCheck ? `Adisyonda kalan: ${money(activeCheck.remainingMinor)}` : "Tutar girmek için açık adisyon seçin"}</small></div>{paymentMethod === "cash" && activeCheck && <div className="cashier-change" aria-live="polite"><span>PARA ÜSTÜ <small>Önizleme · tahsilat kaydedilmez</small></span><strong>{money(Math.max(0, amountMinor - activeCheck.remainingMinor))}</strong></div>}<div className="cashier-quick-amounts" aria-label="Hızlı tutarlar">{[{ label: "TAM KALAN", minor: activeCheck?.remainingMinor ?? 0 }, { label: "100 ₺", minor: 10000 }, { label: "200 ₺", minor: 20000 }, { label: "500 ₺", minor: 50000 }, { label: "1.000 ₺", minor: 100000 }].map((item) => <button type="button" disabled={!activeCheck} key={item.label} onClick={() => setAmountInput(`${Math.floor(item.minor / 100)},${String(item.minor % 100).padStart(2, "0")}`)}>{item.label}</button>)}<button type="button" className="cashier-clear-amount" disabled={!activeCheck} onClick={() => enterAmountKey("C")}>Temizle</button></div><div className="cashier-keypad" aria-label="Tutar tuş takımı">{["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"].map((key) => <button type="button" disabled={!activeCheck} key={key} aria-label={key === "C" ? "Tutarı temizle" : key === "⌫" ? "Son karakteri sil" : key === "," ? "Kuruş için virgül" : key} onClick={() => enterAmountKey(key)}>{key}</button>)}</div><button className="cashier-complete" disabled={Boolean(payBlocker) || payBusy || Boolean(error)} onClick={() => { if (isZeroBalance) void closeZeroCheck(); else void submitPayment(); }}>{payBusy ? (isZeroBalance ? "Kapatılıyor…" : "Kaydediliyor…") : isZeroBalance ? "Adisyonu Kapat (0,00 ₺)" : "Tahsilatı tamamla"}</button>{payError && <p className="ops-error" role="alert">{payError}</p>}<p className="cashier-disabled-hint">{isZeroBalance ? "Ödenecek tutar bulunmuyor. Adisyonu kapatıp masayı boşaltmak için butona tıklayın." : (payBlocker || (paymentMethod === "card" && activeCheck && amountMinor > activeCheck.remainingMinor ? `Kart çekimi kalan tutar kadar yapılır: ${money(activeCheck.remainingMinor)}.` : `Tahsilat ${mainRegister?.name ?? "seçili kasa"} vardiyasına kaydedilir.`))}</p></article>
      </div><div className="cashier-detail-footer"><span>Geliştirme ekranı · Gerçek tahsilat yapılmaz</span><button type="button" disabled={!activeCheck || Boolean(error)} onClick={() => { if (activeCheck) printAccountReceipt({ check: activeCheck, location: isQuickPayment ? "Hızlı satış" : selected?.name ?? "Masa", printedAt: new Date().toISOString() }, false, "BILGI"); }}>🧾 Hesap fişi yazdır</button><button disabled={!activeCheck || activeCheck.totalMinor > 0 || payBusy || Boolean(error)} title={activeCheck && activeCheck.totalMinor > 0 ? "Önce tahsilatı tamamlayın" : undefined} onClick={() => void closeZeroCheck()}>{payBusy ? "Kaydediliyor…" : "Adisyonu kapat"}</button></div>
    </section>}
    <dialog ref={customerDialog} className="waiter-reservation-dialog" aria-labelledby="cashier-customer-title" onCancel={() => setCustomerOpen(false)} onClose={() => setCustomerOpen(false)}>
      {customerOpen && <section className="waiter-custom-modal"><header><div><span className="ops-eyebrow">CARİYE YAZ (VERESİYE)</span><h2 id="cashier-customer-title">Müşteri Seçimi</h2></div><button type="button" className="waiter-modal-close" onClick={() => setCustomerOpen(false)} aria-label="Kapat">×</button></header><label className="waiter-note-field">Ad veya telefon<input autoFocus type="search" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Müşteri adı veya telefonu ara…" /></label><p className="cashier-preview-note" style={{ color: "#059669", fontWeight: 600 }}>✅ Seçilen müşterinin cari kartına borç kaydı (customer_charge) işlenir.</p>{customerLoading && <p className="ops-message">Müşteriler yükleniyor…</p>}{customerError && <p className="ops-error" role="alert">{customerError}</p>}
      {!customerLoading && !customerError && <div className="cashier-customer-list">{customers.filter((customer) => { const query = customerSearch.trim().toLocaleLowerCase("tr-TR"); const digits = query.replace(/\D/g, ""); return !query || customer.name.toLocaleLowerCase("tr-TR").includes(query) || (digits.length > 0 && (customer.phone ?? "").replace(/\D/g, "").includes(digits)); }).map((customer) => <button type="button" key={customer.id} onClick={() => { setCustomerSelected(customer); setCustomerOpen(false); }}><span><strong>{customer.name}</strong><small>{customer.phone ?? "Telefon yok"}</small></span><span><strong>{customer.customerBalanceMinor > 0 ? "Borç" : customer.customerBalanceMinor < 0 ? "Alacak" : "Bakiye"}: {money(Math.abs(customer.customerBalanceMinor))}</strong><small>Limit bilgisi yok</small></span></button>)}{customers.filter((customer) => { const query = customerSearch.trim().toLocaleLowerCase("tr-TR"); const digits = query.replace(/\D/g, ""); return !query || customer.name.toLocaleLowerCase("tr-TR").includes(query) || (digits.length > 0 && (customer.phone ?? "").replace(/\D/g, "").includes(digits)); }).length === 0 && <p className="ops-message">Eşleşen aktif müşteri bulunamadı.</p>}</div>}<footer><button type="button" className="waiter-cancel-custom" onClick={() => setCustomerOpen(false)}>Kapat</button></footer></section>}
    </dialog>
    <dialog ref={actionDialog} className="waiter-reservation-dialog" aria-labelledby="cashier-action-title" onCancel={(event) => { if (actionBusy) event.preventDefault(); else setCashierAction(null); }} onClose={() => setCashierAction(null)}>
      {cashierAction && <form className="waiter-custom-modal" onSubmit={(event) => void submitCashierAction(event)}><header><div><span className="ops-eyebrow">{selected?.name}</span><h2 id="cashier-action-title">{cashierAction === "transfer" ? "Masayı taşı" : cashierAction === "merge" ? "Masaları birleştir" : cashierAction === "discount" ? "İndirim uygula" : cashierAction === "comp" ? "Ürün ikramı" : "Ürün iptali"}</h2></div><button type="button" className="waiter-modal-close" disabled={actionBusy} onClick={() => setCashierAction(null)} aria-label="Kapat">×</button></header>
      {cashierAction === "transfer" && <><p className="waiter-action-description">Masanın açık hesapları seçilen boş masaya taşınır.</p><label className="waiter-note-field">Boş hedef masa<select value={actionTarget} onChange={(event) => setActionTarget(event.target.value)} disabled={actionBusy}><option value="">Masa seçin</option>{transferOptions.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label></>}
      {cashierAction === "merge" && <><p className="waiter-action-description">Seçilen masaların hesapları bu masada birleştirilir. İndirim ve ikramlar korunur; ödeme girişimi olan adisyonlar birleştirilemez.</p><fieldset className="waiter-action-source-list"><legend>Birleştirilecek masalar</legend>{mergeOptions.map((table) => <label key={table.id}><input type="checkbox" disabled={actionBusy} checked={actionSources.includes(table.id)} onChange={(event) => setActionSources((current) => event.target.checked ? [...current, table.id] : current.filter((id) => id !== table.id))} /><span><strong>{table.name}</strong><small>{money(table.assignment!.totalMinor)}</small></span></label>)}{mergeOptions.length === 0 && <p>Birleştirilecek açık masa bulunmuyor.</p>}</fieldset></>}
      {(cashierAction === "discount" || cashierAction === "comp" || cashierAction === "void") && <><p className="waiter-adjustment-dev-note">İndirim, ikram ve iptal işlemleri için yetkili yönetici onayı gereklidir.</p>{activeCheck?.payments.length ? <p className="ops-error">Ödeme girişimi olan adisyona bu işlem uygulanamaz.</p> : null}{cashierAction === "discount" ? <><label className="waiter-note-field">İndirim türü<select value={actionValueType} onChange={(event) => setActionValueType(event.target.value as "percentage" | "fixed")} disabled={actionBusy}><option value="percentage">Yüzde</option><option value="fixed">Sabit tutar (TL)</option></select></label><label className="waiter-note-field">{actionValueType === "percentage" ? "İndirim oranı (%)" : "İndirim tutarı (TL)"}<input inputMode="decimal" value={actionValue} onChange={(event) => setActionValue(event.target.value)} disabled={actionBusy} /></label></> : <><label className="waiter-note-field">Ürün<select value={actionLine} onChange={(event) => { setActionLine(event.target.value); setActionQuantity(1); }} disabled={actionBusy}><option value="">Ürün seçin</option>{cashierActionLines.map((line) => <option key={line.id} value={line.id}>{line.quantity} × {line.productName}</option>)}</select></label><label className="waiter-note-field">Adet<input type="number" min="1" step="1" max={cashierActionLines.find((line) => String(line.id) === actionLine)?.quantity ?? 1} value={actionQuantity} onChange={(event) => setActionQuantity(Number(event.target.value))} disabled={actionBusy} /></label></>}<label className="waiter-note-field">Gerekçe {cashierAction === "void" && <small>(isteğe bağlı)</small>}<input required={cashierAction !== "void"} maxLength={500} value={actionReason} onChange={(event) => setActionReason(event.target.value)} disabled={actionBusy} /></label><label className="waiter-note-field">Yönetici PIN Onayı <small>(Müdür / Patron PIN kodu, örn. 9999)</small><input type="password" inputMode="numeric" maxLength={8} placeholder="••••" value={actionManagerPin} onChange={(event) => setActionManagerPin(event.target.value)} disabled={actionBusy} /></label></>}
      {actionError && <p className="ops-error" role="alert">{actionError}</p>}<footer><button type="button" className="waiter-cancel-custom" disabled={actionBusy} onClick={() => setCashierAction(null)}>Vazgeç</button><button type="submit" className="ops-primary" disabled={actionBusy || Boolean((cashierAction === "discount" || cashierAction === "comp" || cashierAction === "void") && activeCheck?.payments.length)}>{actionBusy ? "Kaydediliyor…" : "İşlemi uygula"}</button></footer></form>}
    </dialog>
    <dialog ref={splitDialog} className="waiter-reservation-dialog" aria-labelledby="cashier-split-title" onCancel={(event) => { if (splitting) event.preventDefault(); else setSplitCheck(null); }} onClose={() => setSplitCheck(null)}>
      {splitCheck && <div className="waiter-custom-modal"><header><div><span className="ops-eyebrow">{isQuickPayment ? "Hızlı Satış" : selected?.name}</span><h2 id="cashier-split-title">Adisyonu böl</h2></div><button className="waiter-modal-close" disabled={splitting} onClick={() => setSplitCheck(null)} aria-label="Kapat">×</button></header>
        <p className="waiter-action-description">Yeni adisyona aktarılacak ürün miktarlarını seçin. Kaynak adisyonda en az bir ürün kalmalıdır.</p>
        <div className="waiter-split-lines">{splitLines.map((line) => <label key={line.id}><span><strong>{line.productName}</strong><small>Mevcut: {line.quantity} · {money(line.unitPriceMinor)} / adet</small>{Boolean(line.note || line.options?.length) && <small>{[...(line.options ?? []).map((option) => option.optionName), line.note].filter(Boolean).join(" · ")}</small>}</span><input aria-label={`${line.productName} bölünecek miktar`} type="number" min="0" max={line.quantity} step="1" disabled={splitting} value={splitQuantities[line.id] ?? 0} onChange={(event) => { const quantity = Math.max(0, Math.min(line.quantity, Math.floor(Number(event.target.value) || 0))); setSplitQuantities((current) => ({ ...current, [line.id]: quantity })); setSplitError(""); }} /></label>)}</div>
        <div className="waiter-split-total"><span>Yeni adisyon tutarı</span><strong>{money(splitTotal)}</strong></div>
        {splitCheck.payments.length > 0 && <p className="ops-error">Ödeme girişimi olan adisyon bölünemez.</p>}
        {splitCheck.adjustments.length > 0 && <p className="ops-error">İndirim, ikram veya iptal işlemi olan adisyon bölünemez.</p>}
        {splitError && <p className="ops-error" role="alert">{splitError}</p>}
        <footer><button className="waiter-cancel-custom" disabled={splitting} onClick={() => setSplitCheck(null)}>Vazgeç</button><button className="ops-primary" disabled={splitting || splitCheck.payments.length > 0 || splitCheck.adjustments.length > 0 || splitTotal <= 0 || splitTotal >= splitCheck.totalMinor} onClick={() => void submitCashierSplit()}>{splitting ? "Bölünüyor…" : "Adisyonu böl"}</button></footer>
      </div>}
    </dialog>
    <dialog ref={zReportDialogRef} className="waiter-reservation-dialog" aria-labelledby="z-report-title" onCancel={() => setActiveZReport(null)} onClose={() => setActiveZReport(null)}>
      {activeZReport && (
        <section className="waiter-custom-modal" style={{ maxWidth: 440, width: "100%", padding: "18px 20px" }}>
          <header style={{ borderBottom: "2px dashed #cbd5e0", paddingBottom: 12, marginBottom: 14 }}>
            <div style={{ textAlign: "center", width: "100%" }}>
              <span className="ops-eyebrow" style={{ letterSpacing: 2, fontSize: 11 }}>{activeZReport.registerName.toUpperCase()} ({activeZReport.registerCode})</span>
              <h2 id="z-report-title" style={{ margin: "4px 0 2px", fontSize: 20 }}>
                {activeZReport.reportType === "Z" ? "GÜN SONU Z-RAPORU" : "GÜN İÇİ X-RAPORU"}
              </h2>
              <small style={{ color: "#718096", fontSize: 12, fontWeight: 700 }}>Rapor No: {activeZReport.reportNumber}</small>
            </div>
            <button type="button" className="waiter-modal-close" onClick={() => setActiveZReport(null)} aria-label="Kapat">×</button>
          </header>

          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "#2d3748" }}>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #edf2f7", paddingBottom: 6 }}>
              <span>Açılış:</span>
              <strong>{new Date(activeZReport.openedAt).toLocaleString("tr-TR")} ({activeZReport.openedBy})</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #edf2f7", padding: "6px 0" }}>
              <span>{activeZReport.reportType === "Z" ? "Kapanış:" : "Rapor Anı:"}</span>
              <strong>{activeZReport.closedAt ? `${new Date(activeZReport.closedAt).toLocaleString("tr-TR")} (${activeZReport.closedBy})` : "Vardiya Açık"}</strong>
            </div>

            {/* Satış Özeti */}
            <div style={{ marginTop: 12, background: "#f7fafc", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: "#4a5568", marginBottom: 6, textTransform: "uppercase" }}>📊 Satış & Ciro Özeti</div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Brüt Satış:</span><strong>{money(activeZReport.sales.grossSalesMinor)}</strong></div>
              {activeZReport.sales.discountAmountMinor + activeZReport.sales.compAmountMinor > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "#c53030" }}>
                  <span>İndirim / İkram:</span>
                  <strong>−{money(activeZReport.sales.discountAmountMinor + activeZReport.sales.compAmountMinor)}</strong>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px dashed #cbd5e0", marginTop: 4, paddingTop: 4, fontWeight: 800, fontSize: 14 }}>
                <span>Net Ciro:</span>
                <strong style={{ color: "#2b6cb0" }}>{money(activeZReport.sales.netSalesMinor)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#718096", marginTop: 2 }}>
                <span>Tamamlanan Adisyon:</span>
                <span>{activeZReport.sales.checkCount} adet</span>
              </div>
            </div>

            {/* Ödeme Kanalları */}
            <div style={{ marginTop: 10, background: "#f7fafc", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: "#4a5568", marginBottom: 6, textTransform: "uppercase" }}>💳 Ödeme Kanalları Dağılımı</div>
              {activeZReport.tenders.map((tender) => (
                <div key={tender.method} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{tender.label} ({tender.transactionCount} işlem):</span>
                  <strong>{money(tender.amountMinor)}</strong>
                </div>
              ))}
            </div>

            {/* KDV Dağılımı */}
            {activeZReport.taxes.length > 0 && (
              <div style={{ marginTop: 10, background: "#f7fafc", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <div style={{ fontWeight: 800, fontSize: 12, color: "#4a5568", marginBottom: 6, textTransform: "uppercase" }}>🧾 KDV Dağılımı</div>
                {activeZReport.taxes.map((t) => (
                  <div key={t.taxRatePercent} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span>%{t.taxRatePercent} KDV (Matrah: {money(t.taxBaseMinor)}):</span>
                    <strong>{money(t.taxAmountMinor)}</strong>
                  </div>
                ))}
              </div>
            )}

            {/* Kasa & Çekmece Mutabakatı */}
            <div style={{ marginTop: 10, background: "#fffaf0", padding: "10px 12px", borderRadius: 8, border: "1px solid #feebc8" }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: "#7b341e", marginBottom: 6, textTransform: "uppercase" }}>💵 Kasa & Çekmece Mutabakatı</div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Sabah Açılış Avansı:</span><strong>{money(activeZReport.cashDrawer.openingFloatMinor)}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Nakit Satışlar:</span><strong style={{ color: "#2f855a" }}>+{money(activeZReport.cashDrawer.cashSalesMinor)}</strong></div>
              {activeZReport.cashDrawer.cashInMinor > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Kasaya Nakit Girişi:</span><strong style={{ color: "#2f855a" }}>+{money(activeZReport.cashDrawer.cashInMinor)}</strong></div>
              )}
              {activeZReport.cashDrawer.cashOutMinor > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Kasadan Nakit Çıkışı (Masraf/Tediye):</span><strong style={{ color: "#c53030" }}>−{money(activeZReport.cashDrawer.cashOutMinor)}</strong></div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px dashed #e2e8f0", marginTop: 4, paddingTop: 4 }}>
                <span>Çekmecede Olması Gereken Nakit:</span>
                <strong>{money(activeZReport.cashDrawer.expectedCashMinor)}</strong>
              </div>
              {activeZReport.cashDrawer.countedCashMinor != null && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Kapanışta Fiziksel Sayılan Nakit:</span>
                  <strong>{money(activeZReport.cashDrawer.countedCashMinor)}</strong>
                </div>
              )}
              {activeZReport.cashDrawer.differenceMinor != null && (
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, color: activeZReport.cashDrawer.differenceMinor === 0 ? "#2f855a" : activeZReport.cashDrawer.differenceMinor > 0 ? "#2b6cb0" : "#c53030" }}>
                  <span>Kasa Farkı:</span>
                  <span>{activeZReport.cashDrawer.differenceMinor === 0 ? "Kasa Denk (0,00 ₺)" : activeZReport.cashDrawer.differenceMinor > 0 ? `+${money(activeZReport.cashDrawer.differenceMinor)} (Kasa Fazlası)` : `${money(activeZReport.cashDrawer.differenceMinor)} (Kasa Açığı)`}</span>
                </div>
              )}
            </div>

            {/* Hasılat Teslim & Devir */}
            {(activeZReport.cashDrawer.retainedFloatMinor != null || activeZReport.cashDrawer.droppedRevenueMinor != null) && (
              <div style={{ marginTop: 10, background: "#ebf8ff", padding: "10px 12px", borderRadius: 8, border: "1px solid #bee3f8" }}>
                <div style={{ fontWeight: 800, fontSize: 12, color: "#2b6cb0", marginBottom: 6, textTransform: "uppercase" }}>🏦 Hasılat Teslim & Devir (Safe Drop)</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Yarına Devreden Bozuk Para:</span><strong>{money(activeZReport.cashDrawer.retainedFloatMinor ?? 0)}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 13 }}>
                  <span>Teslim Edilen Günlük Hasılat:</span>
                  <strong style={{ color: "#2b6cb0" }}>{money(activeZReport.cashDrawer.droppedRevenueMinor ?? 0)}</strong>
                </div>
              </div>
            )}

            {/* Kupürler */}
            {activeZReport.denominations.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 11.5, color: "#718096", borderTop: "1px dashed #cbd5e0", paddingTop: 6 }}>
                <strong>Kupür Sayım Detayı: </strong>
                {activeZReport.denominations.map(d => `${money(d.denominationMinor)} × ${d.quantity}`).join(" · ")}
              </div>
            )}

            {activeZReport.closeNote && (
              <div style={{ marginTop: 6, fontSize: 12, fontStyle: "italic", color: "#4a5568" }}>
                <strong>Kapanış Notu: </strong> {activeZReport.closeNote}
              </div>
            )}
          </div>

          <footer style={{ marginTop: 16, borderTop: "2px dashed #cbd5e0", paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
            <button
              type="button"
              className="ops-primary"
              disabled={zReportPrinting}
              onClick={() => void printZReport(activeZReport.shiftId)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {zReportPrinting ? "⏳ Yazdırılıyor…" : "🖨️ Fiş Yazdır"}
            </button>
            <button type="button" className="waiter-cancel-custom" onClick={() => setActiveZReport(null)}>
              Kapat
            </button>
          </footer>
        </section>
      )}
    </dialog>
    {/* Siparişi Askıya Al / Beklet Dialogu */}
    <dialog
      ref={parkDialogRef}
      className="waiter-reservation-dialog"
      aria-labelledby="park-order-title"
      onCancel={() => setParkDialogOpen(false)}
      onClose={() => setParkDialogOpen(false)}
    >
      {parkDialogOpen && (
        <form
          className="waiter-custom-modal"
          onSubmit={(e) => {
            e.preventDefault();
            void parkQuickCart(parkLabelInput);
          }}
        >
          <header>
            <div>
              <span className="ops-eyebrow">TEZGÂH & AL-GÖTÜR</span>
              <h2 id="park-order-title">Siparişi Askıya Al / Beklet</h2>
            </div>
            <button type="button" className="waiter-modal-close" onClick={() => setParkDialogOpen(false)} aria-label="Kapat">×</button>
          </header>
          <p className="waiter-action-description">
            Müşteri geçici olarak kasadan ayrıldıysa siparişi beklemeye alabilir ve sıradaki müşteriyi alabilirsiniz.
          </p>
          <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 8, border: "1px solid #e2e8f0", marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>Sepet Özeti: </span>
            <strong style={{ fontSize: 13, color: "#1e293b" }}>{quickCartCount} Ürün · {money(quickTotalMinor)}</strong>
          </div>
          <label className="waiter-note-field">
            Tanıtıcı İsim / Not / Çağrı Cihazı No
            <input
              autoFocus
              type="text"
              maxLength={80}
              value={parkLabelInput}
              onChange={(e) => setParkLabelInput(e.target.value)}
              placeholder={`Örn. Paket #${new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`}
            />
            <small style={{ color: "#64748b", fontSize: 11.5, marginTop: 4, display: "block" }}>
              Örn. "Ahmet Bey", "Paket #14", "Çağrı Cihazı #4"
            </small>
          </label>
          {quickError && <p className="ops-error" role="alert">{quickError}</p>}
          <footer>
            <button type="button" className="waiter-cancel-custom" disabled={quickBusy} onClick={() => setParkDialogOpen(false)}>
              Vazgeç
            </button>
            <button type="submit" className="ops-primary" disabled={quickBusy}>
              {quickBusy ? "Bekletiliyor…" : "⏸️ Askıya Al"}
            </button>
          </footer>
        </form>
      )}
    </dialog>

    {/* Açık Siparişi İptal Etme Dialogu */}
    <dialog
      ref={cancelDialogRef}
      className="waiter-reservation-dialog"
      aria-labelledby="cancel-order-title"
      onCancel={() => setCancellingCheck(null)}
      onClose={() => setCancellingCheck(null)}
    >
      {cancellingCheck && (
        <form
          className="waiter-custom-modal"
          onSubmit={(e) => {
            e.preventDefault();
            void cancelQuickCheck(cancellingCheck.id, cancellingCheck.version, cancelReason, cancelManagerPin);
          }}
        >
          <header>
            <div>
              <span className="ops-eyebrow" style={{ color: "#dc2626" }}>SİPARİŞ İPTALİ</span>
              <h2 id="cancel-order-title">Siparişi İptal Et</h2>
            </div>
            <button type="button" className="waiter-modal-close" disabled={cancellingBusy} onClick={() => setCancellingCheck(null)} aria-label="Kapat">×</button>
          </header>
          <p className="waiter-action-description">
            <strong>{cancellingCheck.label}</strong> siparişi iptal edilecek ve kapatılacaktır. Bu işlem geri alınamaz.
          </p>
          <label className="waiter-note-field">
            İptal Gerekçesi (Zorunlu)
            <input
              autoFocus
              required
              type="text"
              maxLength={200}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Örn. Müşteri sıradan ayrıldı / almaktan vazgeçti"
              disabled={cancellingBusy}
            />
          </label>
          <label className="waiter-note-field">
            Yönetici PIN Onayı <small>(Müdür / Patron PIN kodu, örn. 9999)</small>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="••••"
              value={cancelManagerPin}
              onChange={(e) => setCancelManagerPin(e.target.value)}
              disabled={cancellingBusy}
            />
          </label>
          {quickError && <p className="ops-error" role="alert">{quickError}</p>}
          <footer>
            <button type="button" className="waiter-cancel-custom" disabled={cancellingBusy} onClick={() => setCancellingCheck(null)}>
              Vazgeç
            </button>
            <button
              type="submit"
              className="ops-primary"
              style={{ background: "#dc2626", borderColor: "#b91c1c" }}
              disabled={cancellingBusy || !cancelReason.trim()}
            >
              {cancellingBusy ? "İptal Ediliyor…" : "🗑️ Siparişi İptal Et"}
            </button>
          </footer>
        </form>
      )}
    </dialog>
    {/* Terminal İstasyon Sabitleme / Değiştirme Modalı */}
    {stationModalOpen && (
      <div className="morning-shift-overlay" role="dialog" aria-modal="true" aria-labelledby="station-assign-title">
        <div className="morning-shift-card" style={{ maxWidth: 460 }}>
          <div className="morning-shift-badge">
            🏢 {stationMode === "initial" ? "CİHAZ KURULUMU" : "İSTASYON DEĞİŞTİRME"}
          </div>
          <h2 id="station-assign-title" style={{ fontSize: "1.3rem", margin: "8px 0" }}>
            {stationMode === "initial" ? "Bu Terminal Hangi Kasaya Ait?" : "Kasa Terminalini Değiştir"}
          </h2>
          <p style={{ color: "#94a3b8", fontSize: "0.85rem", lineHeight: 1.4, marginBottom: 16 }}>
            {stationMode === "initial"
              ? "Bu cihaz (All-in-One POS terminali ve nakit çekmecesi) fiziki bir kasaya bağlanmalıdır. Yanlış kasa seçimi gün sonu Z-Raporu ve nakit sayımını etkiler."
              : "Fiziki terminalin bağlı olduğu kasayı değiştirmektesiniz. Bu işlem yetkili yönetici onayı gerektirir."}
          </p>

          {stationMode === "change" && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: "0.85rem", color: "#cbd5e1", marginBottom: 6 }}>
                🔑 Yönetici PIN Kodu:
              </label>
              <input
                type="password"
                maxLength={6}
                inputMode="numeric"
                autoFocus
                placeholder="Yönetici PIN"
                value={stationManagerPin}
                onChange={(e) => {
                  setStationManagerPin(e.target.value);
                  setStationError("");
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid #475569",
                  background: "#1e293b",
                  color: "#fff",
                  fontSize: "1.1rem",
                  letterSpacing: 4,
                  textAlign: "center",
                }}
              />
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: "0.8rem", color: "#94a3b8", fontWeight: 600 }}>BAĞLANACAK KASAYI SEÇİN:</span>
            {(cashOverview?.registers ?? []).map((reg) => (
              <button
                key={reg.id}
                type="button"
                className="ops-primary"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  background: mainRegister?.id === reg.id ? "#1e293b" : "#0f172a",
                  borderColor: mainRegister?.id === reg.id ? "#38bdf8" : "#334155",
                  borderWidth: 2,
                  textAlign: "left",
                  cursor: "pointer",
                }}
                onClick={() => void handleAssignStation(reg.id)}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: "1rem", color: "#f8fafc" }}>
                    {reg.name} ({reg.code})
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                    {reg.responsible ? `Sorumlu: ${reg.responsible}` : "Sorumlu atanmamış"}
                  </div>
                </div>
                {mainRegister?.id === reg.id && (
                  <span style={{ fontSize: "0.75rem", background: "#0284c7", color: "#fff", padding: "2px 8px", borderRadius: 4 }}>
                    Mevcut
                  </span>
                )}
              </button>
            ))}
          </div>

          {stationError && (
            <p className="ops-error" role="alert" style={{ marginBottom: 12 }}>
              {stationError}
            </p>
          )}

          <footer style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            {stationMode === "change" && (
              <button
                type="button"
                className="waiter-cancel-custom"
                onClick={() => {
                  setStationModalOpen(false);
                  setStationError("");
                  setStationManagerPin("");
                }}
              >
                Vazgeç
              </button>
            )}
          </footer>
        </div>
      </div>
    )}
    <PrinterSettingsModal
      open={printerSettingsOpen}
      firmId={firmId}
      branchId={branchId}
      appKind="cashier"
      onClose={() => setPrinterSettingsOpen(false)}
      onSaved={(msg) => setCashNotice(msg)}
    />
    {printToast && (
      <div className="pos-smooth-toast" role="status">
        <span className="toast-icon">{printToast.icon ?? "🧾"}</span>
        <div className="toast-text">
          <strong>{printToast.title}</strong>
          {printToast.subtitle && <small>{printToast.subtitle}</small>}
        </div>
      </div>
    )}
  </main>;
}

export function WaiterApp() {
  const terminalScope = useTerminalScope();
  const { firmId, branchId } = terminalScope;
  const servicePath = `/api/v1/firms/${firmId}/branches/${branchId}/service`;
  const ordersPath = `/api/v1/firms/${firmId}/sales/orders?branchId=${branchId}`;
  const checksPath = `/api/v1/firms/${firmId}/branches/${branchId}/sales/checks`;

  const [waiterSession, setWaiterSession] = useState<PosSession | null>(() => getPosSession("waiter"));

  useEffect(() => {
    const sync = () => setWaiterSession(getPosSession("waiter"));
    window.addEventListener(POS_AUTH_CHANGED_EVENT, sync);
    return () => window.removeEventListener(POS_AUTH_CHANGED_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!waiterSession) return;
    let timer: number;
    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        clearPosSession("waiter");
        setWaiterSession(null);
      }, 10 * 60 * 1000);
    };
    const events = ["mousedown", "mousemove", "keypress", "scroll", "touchstart"];
    events.forEach((name) => window.addEventListener(name, resetTimer));
    resetTimer();
    return () => {
      window.clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, resetTimer));
    };
  }, [waiterSession]);
  const [products, setProducts] = useState<Product[]>([]);
  const [menus, setMenus] = useState<RestaurantMenu[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<Array<{ id: string; name: string; isActive: boolean }>>([]);
  const [catalogView, setCatalogView] = useState<"menus" | "categories">("menus");
  const [selectedMenuId, setSelectedMenuId] = useState("");
  const [tables, setTables] = useState<Table[]>([]);
  const [configuredFloors, setConfiguredFloors] = useState<string[]>([]);
  const [kitchenItems, setKitchenItems] = useState<KitchenStatusItem[]>([]);
  const [kitchenNotice, setKitchenNotice] = useState("");
  const kitchenNoticeTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (kitchenNoticeTimer.current) window.clearTimeout(kitchenNoticeTimer.current);
  }, []);
  const { syncStatus, localReachable, flushing: syncFlushing, triggerFlush: triggerSyncFlush } = useBranchSyncStatus(
    firmId,
    branchId,
    Boolean(waiterSession),
    "pos-single"
  );
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [tableId, setTableId] = useState("");
  const [waiterId, setWaiterId] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);
  const [editingCartId, setEditingCartId] = useState<string | null>(null);
  const [optionSelection, setOptionSelection] = useState<OptionSelection | null>(null);
  const [customNote, setCustomNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [connectionState, setConnectionState] = useState<"checking" | "connected" | "unavailable">("checking");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastOrderId, setLastOrderId] = useState("");
  const [retryOrderId, setRetryOrderId] = useState<string | null>(null);
  const [tableAction, setTableAction] = useState<"transfer" | "merge" | "split" | "discount" | "group" | "ungroup" | null>(null);
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [groupGuestCount, setGroupGuestCount] = useState(2);
  const [targetTableId, setTargetTableId] = useState("");
  const [mergeSourceIds, setMergeSourceIds] = useState<string[]>([]);
  const [openChecks, setOpenChecks] = useState<OpenCheck[]>([]);
  const [splitCheckId, setSplitCheckId] = useState("");
  const [adjustmentCheckId, setAdjustmentCheckId] = useState("");
  const [splitQuantities, setSplitQuantities] = useState<Record<number, number>>({});
  const [operationError, setOperationError] = useState("");
  const [operationSaving, setOperationSaving] = useState(false);
  const [tableActionNotice, setTableActionNotice] = useState("");
  const [detailSyncNotice, setDetailSyncNotice] = useState("");
  const [tableStatusError, setTableStatusError] = useState("");
  const [tableStatusSaving, setTableStatusSaving] = useState(false);
  const [reservationDate, setReservationDate] = useState("");
  const [reservationGuestName, setReservationGuestName] = useState("");
  const [reservationOpen, setReservationOpen] = useState(false);
  const reservationDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = reservationDialog.current;
    if (reservationOpen && dialog && !dialog.open) dialog.showModal();
    if (!reservationOpen && dialog?.open) dialog.close();
  }, [reservationOpen]);
  const [adjustmentTab, setAdjustmentTab] = useState<"discount" | "line">("discount");
  const [discountMode, setDiscountMode] = useState<"percentage" | "fixed">("percentage");
  const [discountValue, setDiscountValue] = useState(10);
  const [discountReason, setDiscountReason] = useState("");
  const [discountReasonNote, setDiscountReasonNote] = useState("");
  const [lineAdjustments, setLineAdjustments] = useState<Record<string, { action: "comp" | "void"; reason: string; quantity: number }>>({});
  const [adjustmentManagerPin, setAdjustmentManagerPin] = useState("");
  const operationRequest = useRef<{ key: string; id: string } | null>(null);
  const reloadSerial = useRef(0);
  const tablesRef = useRef<Table[]>([]);
  const openChecksRef = useRef<OpenCheck[]>([]);
  const kitchenStatusesRef = useRef<Map<string, KitchenStatus> | null>(null);

  function isVersionConflict(cause: unknown) {
    const error = cause as ApiRequestError;
    return error?.status === 409 && ["VERSION_CONFLICT", "STALE_CHECK_VERSION"].includes(error.code ?? "");
  }

  async function refreshAfterConflict(cause: unknown, area: "operation" | "table") {
    operationRequest.current = null;
    await reload();
    if (tableId) {
      try {
        const result = await request<{ items: OpenCheck[] }>(`${checksPath}?tableId=${encodeURIComponent(selectedTable?.id ?? tableId)}`, "pos-single");
        const checks = result.items.filter((check) => check.status === "open");
        openChecksRef.current = checks;
        setOpenChecks(checks);
        setSplitCheckId((current) => checks.some((check) => check.id === current) ? current : checks[0]?.id ?? "");
        setAdjustmentCheckId((current) => checks.some((check) => check.id === current) ? current : checks[0]?.id ?? "");
      } catch { /* Masa özeti yenilendi; adisyon listesi tekrar açıldığında yeniden yüklenir. */ }
    }
    const message = `${cause instanceof Error ? cause.message : "Kayıt başka bir cihazda değişti."} Güncel masa ve adisyon bilgileri yüklendi. Sepetiniz korundu; bilgileri kontrol edip işlemi yeniden deneyin.`;
    setDetailSyncNotice("Başka bir cihazda değişiklik algılandı. Masa ve adisyon bilgileri güncellendi; sepetiniz korundu.");
    if (area === "operation") setOperationError(message);
    else setTableStatusError(message);
  }

  const reload = useCallback(async () => {
    const serial = ++reloadSerial.current;
    try {
      const [tableResult, waiterResult, menuResult, checkResult, ordersResult] = await Promise.all([
        request<{ items: Table[]; floors?: string[] }>(`${servicePath}/tables`, "pos-single"),
        request<{ items: Waiter[] }>(`${servicePath}/waiters`, "pos-single"),
        request<MenuWorkspace>(`/api/v1/firms/${firmId}/branches/${branchId}/catalog/menus`, "pos-single"),
        tableId && (tableAction === "split" || tableAction === "discount")
          ? request<{ items: OpenCheck[] }>(`${checksPath}?tableId=${encodeURIComponent(tableId)}`, "pos-single")
          : Promise.resolve(null),
        tableId ? request<{ items: Order[] }>(ordersPath, "manager-single") : Promise.resolve(null),
      ]);
      if (serial !== reloadSerial.current) return;
      const currentId = tableId;
      const previous = tablesRef.current.find((item) => item.id === currentId);
      const updated = tableResult.items.filter((item) => item.isActive);
      const requested = updated.find((item) => item.id === currentId);
      const latest = updated.find((item) => item.id === (requested?.group?.primaryTableId ?? currentId));
      if (previous && latest && (previous.status !== latest.status
        || previous.assignment?.version !== latest.assignment?.version
        || previous.assignment?.totalMinor !== latest.assignment?.totalMinor)) {
        setDetailSyncNotice("Masa veya açık adisyon başka bir cihazda güncellendi. Son bilgiler yüklendi; sepetiniz korundu.");
      }
      if (checkResult) {
        const latestChecks = checkResult.items.filter((check) => check.status === "open");
        const priorChecks = openChecksRef.current;
        if (latestChecks.some((check) => priorChecks.find((prior) => prior.id === check.id)?.version !== undefined
          && priorChecks.find((prior) => prior.id === check.id)?.version !== check.version)) {
          setDetailSyncNotice("Açık adisyon başka bir cihazda güncellendi. Son bilgiler yüklendi; sepetiniz korundu.");
          setSplitQuantities({});
        }
        openChecksRef.current = latestChecks;
        setOpenChecks(latestChecks);
        setSplitCheckId((current) => latestChecks.some((check) => check.id === current) ? current : latestChecks[0]?.id ?? "");
        setAdjustmentCheckId((current) => latestChecks.some((check) => check.id === current) ? current : latestChecks[0]?.id ?? "");
      }
      if (ordersResult) {
        const groupedTables = latest?.group ? updated.filter((item) => latest.group?.tableIds.includes(item.id)) : latest ? [latest] : [];
        const selectedOrderIds = groupedTables.flatMap((item) => item.assignment?.orderIds ?? (item.assignment ? [item.assignment.orderId] : []));
        const latestItems = ordersResult.items
          .filter((order) => selectedOrderIds.includes(order.id) && order.source === "waiter_web" && order.status === "open")
          .flatMap((order) => (order.kitchenItems ?? order.items).map((item, index) => ({
            id: `${order.id}:${index}`, orderId: order.id, productName: item.productName, quantity: item.quantity,
            note: item.note, status: item.note?.startsWith("Mutfağa iptal bildirimi") ? "cancelled" : item.status ?? "pending",
            statusChangedAt: item.statusChangedAt,
          })));
        const previousStatuses = kitchenStatusesRef.current;
        const justReady = previousStatuses
          ? latestItems.find((item) => item.status === "ready" && previousStatuses.get(item.id) !== "ready")
          : latestItems.find((item) => item.status === "ready");
        if (justReady) {
          const tableName = latest?.group ? latest.group.tableNames.join(" + ") : latest?.name ?? "Masa";
          setKitchenNotice(`${tableName}’in ${justReady.productName} hazır.`);
        }
        kitchenStatusesRef.current = new Map(latestItems.map((item) => [item.id, item.status]));
        setKitchenItems(latestItems);
      }
      tablesRef.current = updated;
      const activeMenus = menuResult.items.filter((menu) => menu.isActive);
      const categoryNames = new Map(menuResult.categories.map((category) => [category.id, category.name]));
      setMenus(activeMenus);
      setCatalogCategories(menuResult.categories.filter((category) => category.isActive));
      setSelectedMenuId((current) => activeMenus.some((menu) => menu.id === current) ? current : activeMenus[0]?.id ?? "");
      setProducts(menuResult.products.map((product) => ({
        ...product, category: { id: product.categoryId, name: categoryNames.get(product.categoryId) ?? "Kategorisiz" },
      })));
      setTables(updated);
      setConfiguredFloors(tableResult.floors ?? []);
      const activeWaiters = waiterResult.items.filter((item) => item.isActive);
      setWaiters(activeWaiters);
      if (waiterSession?.user?.fullName) {
        setWaiterId((current) => {
          if (current && activeWaiters.some(w => w.id === current)) return current;
          const userFull = waiterSession.user.fullName.trim().toLowerCase();
          const match = activeWaiters.find(w => {
            const wName = w.name.trim().toLowerCase();
            return wName === userFull || userFull.includes(wName) || wName.includes(userFull) ||
                   userFull.split(" ")[0] === wName.split(" ")[0];
          });
          return match ? match.id : (activeWaiters[0]?.id ?? "");
        });
      } else if (activeWaiters.length > 0) {
        setWaiterId((current) => current || activeWaiters[0].id);
      }
      setConnectionState("connected");
      setLastUpdated(new Date());
      setError("");
    } catch (cause) {
      if (serial !== reloadSerial.current) return;
      setConnectionState("unavailable");
      setError(cause instanceof Error ? cause.message : "Veriler yüklenemedi.");
    }
    finally { if (serial === reloadSerial.current) setLoading(false); }
  }, [firmId, branchId, servicePath, ordersPath, checksPath, tableAction, tableId, waiterSession?.user?.fullName]);
  useEffect(() => {
    if (!waiterSession) return;
    void reload();
  }, [waiterSession, reload, refreshTick, tableId]);

  // 1. SSE ile anlık masa ve adisyon durumu senkronizasyonu
  useRestaurantRealtime(
    useCallback(
      (evt) => {
        if (evt.type === "kitchen.updated" && evt.data?.status === "ready") {
          const tableLabel = evt.data.tableName ? `${evt.data.tableName} · ` : "";
          const qtyLabel = evt.data.quantity ? `${evt.data.quantity}× ` : "";
          const productLabel = evt.data.productName ?? "Sipariş";
          setKitchenNotice(`🔔 HAZIR: ${tableLabel}${qtyLabel}${productLabel} servise hazır!`);
          if (kitchenNoticeTimer.current) window.clearTimeout(kitchenNoticeTimer.current);
          kitchenNoticeTimer.current = window.setTimeout(() => setKitchenNotice(""), 12000);
          playKitchenChime();
        }
        if (tableStatusSaving || saving || operationSaving) return;
        console.log("⚡ [WaiterApp] Anlık masa/adisyon güncellemesi alındı:", evt.type);
        void reload();
      },
      [tableStatusSaving, saving, operationSaving, reload]
    ),
    Boolean(waiterSession),
    waiterSession?.token
  );

  // 2. Yedek periyodik kontrol
  useEffect(() => {
    if (!waiterSession || tableStatusSaving || saving || operationSaving) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [waiterSession, tableStatusSaving, saving, operationSaving, reload]);

  useEffect(() => {
    if (waiterSession?.user && waiters.length > 0 && !waiterId) {
      const match = waiters.find((w) => w.name.trim().toLowerCase() === waiterSession.user.fullName.trim().toLowerCase());
      if (match) {
        setWaiterId(match.id);
      }
    }
  }, [waiterSession, waiters, waiterId]);

  const requestedTable = tables.find((item) => item.id === tableId);
  const selectedTable = tables.find((item) => item.id === (requestedTable?.group?.primaryTableId ?? tableId));
  const selectedKitchenItems = kitchenItems;
  const waiter = waiters.find((item) => item.id === waiterId);
  const getTableStatus = (item: Table) => {
    const primary = item.group ? tables.find((table) => table.id === item.group?.primaryTableId) ?? item : item;
    return primary.status === "bill_requested" ? "bill_requested"
      : item.status === "reserved" ? "reserved"
        : item.assignment || item.group || item.status === "occupied" ? "occupied" : "idle";
  };
  const isAvailableTable = (item: Table) => getTableStatus(item) === "idle" && !item.assignment && !item.group;
  const transferTargets = tables.filter((table) => table.id !== selectedTable?.id && isAvailableTable(table));
  const groupCandidates = tables.filter((table) => table.id !== selectedTable?.id && isAvailableTable(table));
  const emptyTableCount = tables.filter((item) => getTableStatus(item) === "idle" && !item.assignment && !item.group).length;
  const occupiedTableCount = tables.filter((item) => getTableStatus(item) === "occupied" || Boolean(item.group && getTableStatus(item) !== "reserved" && getTableStatus(item) !== "bill_requested")).length;
  const billRequestedTableCount = tables.filter((item) => getTableStatus(item) === "bill_requested").length;
  const reservedTableCount = tables.filter((item) => getTableStatus(item) === "reserved").length;
  const assignedToOtherWaiter = Boolean(selectedTable?.assignment && waiter && selectedTable.assignment.waiterId !== waiter.id);
  const selectedMenu = menus.find((menu) => menu.id === selectedMenuId);
  const menuSections = selectedMenu?.sections ?? [];
  const selectedMenuProductIds = new Set(menuSections.flatMap((section) => section.productIds));
  const cartRows = useMemo(() => cart.flatMap((line) => {
    const product = products.find((item) => item.id === line.productId);
    return product ? [{ ...product, ...line }] : [];
  }), [products, cart]);
  const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR");
  const activeCategoryIds = new Set(catalogCategories.map((category) => category.id));
  const availableProducts = products.filter((product) => product.isActive && product.status === "published" && product.channels.includes("pos") && product.desiredChannels.includes("pos") && product.price.amountMinor > 0 && activeCategoryIds.has(product.category.id));
  const visibleProducts = catalogView === "categories" ? availableProducts : availableProducts.filter((product) => selectedMenuProductIds.has(product.id));
  const catalogGroups = normalizedSearch
    ? [{ sectionId: "search-results", name: "Arama sonuçları", products: visibleProducts.filter((product) => product.name.toLocaleLowerCase("tr-TR").includes(normalizedSearch)) }]
    : catalogView === "categories"
      ? catalogCategories.map((category) => ({ sectionId: category.id, name: category.name, products: availableProducts.filter((product) => product.category.id === category.id) })).filter((group) => group.products.length > 0)
      : menuSections.map((section) => ({ ...section, products: availableProducts.filter((product) => section.productIds.includes(product.id)) }));
  const total = cartRows.reduce((sum, item) => sum + (item.price.amountMinor + item.options.reduce((delta, option) => delta + option.priceDeltaMinor * option.quantity, 0)) * item.quantity, 0);
  const editingCartLine = cart.find((line) => line.cartId === editingCartId);
  const splitCheck = openChecks.find((check) => check.id === splitCheckId);
  const adjustmentCheck = openChecks.find((check) => check.id === adjustmentCheckId);
  const checkAdjustmentTotals = (selectedTable?.assignment?.adjustments ?? []).reduce((totals, adjustment) => {
    totals[adjustment.action] += adjustment.amountMinor;
    return totals;
  }, { discount: 0, comp: 0, void: 0 });
  const splitLines = splitCheck?.orders.flatMap((order) => order.items) ?? [];
  const splitTotal = splitLines.reduce((sum, line) => sum + (splitQuantities[line.id] ?? 0) * line.unitPriceMinor, 0);
  const tableActionsBlocked = cartRows.length > 0 || saving || operationSaving || tableStatusSaving;
  const reservationMin = new Date(Date.now() + 60_000);
  reservationMin.setMinutes(reservationMin.getMinutes() - reservationMin.getTimezoneOffset());
  const reservationMinValue = reservationMin.toISOString().slice(0, 16);

  function getOperationRequestId(key: string) {
    if (operationRequest.current?.key !== key)
      operationRequest.current = { key, id: createRequestId() };
    return operationRequest.current.id;
  }

  async function updateTableStatus(action: "request-bill" | "cancel-bill-request" | "reservation/cancel") {
    if (!selectedTable || tableStatusSaving) return;
    ++reloadSerial.current;
    setTableStatusSaving(true); setTableStatusError("");
    try {
      const result = await request<{ tableId: string; status: Table["status"]; version: number }>(`${servicePath}/tables/${encodeURIComponent(selectedTable.id)}/${action}`, "pos-single", {
        expectedVersion: selectedTable.version ?? 1,
      });
      ++reloadSerial.current;
      setTables((current) => current.map((table) => table.id === result.tableId ? {
        ...table, status: result.status, version: result.version,
        ...(action === "reservation/cancel" ? { reservedFor: null, reservationGuestName: null } : {}),
      } : table));
      setTableActionNotice(action === "request-bill" ? "Hesap isteği kaydedildi." : action === "cancel-bill-request" ? "Hesap isteği kaldırıldı." : "Rezervasyon kaldırıldı.");
      setReservationDate(""); setRefreshTick((tick) => tick + 1);
    } catch (cause) {
      if (isVersionConflict(cause)) await refreshAfterConflict(cause, "table");
      else setTableStatusError(cause instanceof Error ? cause.message : "Masa durumu güncellenemedi.");
    }
    finally { setTableStatusSaving(false); }
  }

  function openReservation() {
    if (!selectedTable || tableActionsBlocked) return;
    setReservationGuestName(selectedTable.reservationGuestName ?? "");
    const date = selectedTable.reservedFor ? new Date(selectedTable.reservedFor) : null;
    setReservationDate(date ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
    setTableStatusError(""); setReservationOpen(true);
  }

  async function reserveTable() {
    if (!selectedTable || !reservationDate || tableActionsBlocked) return;
    const guestName = reservationGuestName.trim();
    if (!guestName || guestName.length > 120) {
      setTableStatusError("Lütfen ad soyad girin (en fazla 120 karakter)."); return;
    }
    const reservedFor = new Date(reservationDate);
    if (Number.isNaN(reservedFor.getTime()) || reservedFor.getTime() <= Date.now()) {
      setTableStatusError("Rezervasyon için ileri bir tarih ve saat seçin."); return;
    }
    setTableStatusSaving(true); setTableStatusError("");
    try {
      await request(`${servicePath}/tables/${encodeURIComponent(selectedTable.id)}/reservation`, "pos-single", {
        expectedVersion: selectedTable.version ?? 1, reservedFor: reservedFor.toISOString(), guestName,
      });
      setTableActionNotice("Rezervasyon kaydedildi."); setReservationOpen(false); setRefreshTick((tick) => tick + 1);
    } catch (cause) {
      if (isVersionConflict(cause)) await refreshAfterConflict(cause, "table");
      else setTableStatusError(cause instanceof Error ? cause.message : "Masa rezerve edilemedi.");
    }
    finally { setTableStatusSaving(false); }
  }

  function changeCartLine(cartId: string, delta: number) {
    if (saving) return;
    setRetryOrderId(null);
    setCart((current) => current.flatMap((line) => line.cartId !== cartId ? [line] : line.quantity + delta <= 0 ? [] : [{ ...line, quantity: line.quantity + delta }]));
  }
  function openCustomization(product: Product, line?: CartLine) {
    if (saving) return;
    if (product.isOutOfStock) {
      setError(`${product.name} tükendi. Mutfak stoğunda ${product.limitingIngredientName || "hammadde"} bulunmuyor.`);
      return;
    }
    setCustomizingProduct(product); setEditingCartId(line?.cartId ?? null);
    setOptionSelection(null);
    setCustomNote(line?.note ?? "");
  }
  function closeCustomization() {
    setCustomizingProduct(null); setEditingCartId(null);
  }
  function saveCustomizedProduct() {
    if (!customizingProduct || saving || !optionSelection?.valid) return;
    const options = optionSelection.items;
    if (editingCartId) {
      setCart((current) => current.map((line) => line.cartId === editingCartId ? { ...line, note: customNote.trim(), options } : line));
    } else {
      setCart((current) => [...current, { cartId: createRequestId(), productId: customizingProduct.id, quantity: 1, note: customNote.trim(), options }]);
    }
    setRetryOrderId(null); closeCustomization();
  }

  const [printingBill, setPrintingBill] = useState(false);
  const [settlingTable, setSettlingTable] = useState<"NAKIT" | "KART" | null>(null);
  const [testPrinting, setTestPrinting] = useState<string | null>(null);

  async function printBillForTable() {
    if (!selectedTable?.assignment || printingBill) return;
    setPrintingBill(true); setError(""); setNotice("");
    try {
      const res = await request<{ success: boolean; target: string; transportUsed: string }>(
        `/api/v1/firms/${firmId}/branches/${branchId}/service/tables/${encodeURIComponent(selectedTable.id)}/print-bill`,
        "pos-single", { openCashDrawer: false }
      );
      setNotice(`${selectedTable.name} için ara hesap fişi basıldı (${res.transportUsed}).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Hesap fişi yazdırılamadı.");
    } finally {
      setPrintingBill(false);
    }
  }

  async function settleTable(paymentMethod: "NAKIT" | "KART") {
    if (!selectedTable?.assignment || settlingTable) return;
    setSettlingTable(paymentMethod); setError(""); setNotice("");
    try {
      const res = await request<{ success: boolean; tableId: string; paymentMethod: string; transportUsed: string }>(
        `/api/v1/firms/${firmId}/branches/${branchId}/service/tables/${encodeURIComponent(selectedTable.id)}/settle`,
        "pos-single",
        { paymentMethod }
      );
      setNotice(`✅ ${selectedTable.name} hesabı kapatıldı (${paymentMethod === "NAKIT" ? "Nakit" : "Kredi Kartı"}), kasa fişi basıldı (${res.transportUsed}) ve masa boşaltıldı!`);
      // Masayı hemen yerel listede de boşa düşür
      setTables((current) => current.map((table) => table.id === selectedTable.id ? {
        ...table,
        status: "idle",
        assignment: undefined,
        group: undefined,
        reservedFor: null,
        reservationGuestName: null
      } : table));
      setTableId("");
      setCart([]);
      setRetryOrderId(null);
      setKitchenItems([]);
      setRefreshTick((tick) => tick + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Hesap kapatılamadı.");
    } finally {
      setSettlingTable(null);
    }
  }

  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);
  const [reprintingKitchen, setReprintingKitchen] = useState(false);

  async function reprintKitchenTicket() {
    if (!selectedTable || reprintingKitchen) return;
    setReprintingKitchen(true); setError(""); setNotice("");
    try {
      const res = await request<{ success: boolean; transportUsed: string }>(
        `/api/v1/firms/${firmId}/branches/${branchId}/service/tables/${encodeURIComponent(selectedTable.id)}/print-kitchen?isReprint=true`,
        "pos-single",
        {}
      );
      setNotice(`🖨️ Mutfak fişi tekrar yazdırıldı (KOPYA - ${res.transportUsed})!`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mutfak fişi tekrar yazdırılamadı.");
    } finally {
      setReprintingKitchen(false);
    }
  }

  async function triggerTestPrint(target: "kitchen" | "cashier") {
    if (testPrinting) return;
    setTestPrinting(target); setError(""); setNotice("");
    try {
      const res = await request<{ success: boolean; target: string; transportUsed: string }>(
        `/api/v1/firms/${firmId}/branches/${branchId}/printing/test?target=${target}`,
        "pos-single", {}
      );
      setNotice(`${target === "kitchen" ? "Mutfak" : "Kasa"} test fişi başarıyla gönderildi (${res.transportUsed}).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Test fişi gönderilemedi.");
    } finally {
      setTestPrinting(null);
    }
  }

  async function sendOrder() {
    if (!selectedTable || !waiter || cartRows.length === 0 || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const orderId = retryOrderId ?? createRequestId();
      setRetryOrderId(orderId);
      const itemsPayload = cartRows.map((item) => {
        const optionNotes = (item.options ?? []).map((o) => `${o.groupName}: ${o.optionName}`).filter(Boolean).join(", ");
        const combinedNote = [item.note, optionNotes].filter(Boolean).join(" · ");
        return {
          productId: item.id,
          quantity: item.quantity,
          note: combinedNote || null,
          options: null,
        };
      });
      const result = await request<{ order: { id: string }; table: string; waiter: string; autoPrinted?: boolean }>(
        `${servicePath}/tables/${encodeURIComponent(selectedTable.id)}/orders`, "pos-single",
        { orderId, waiterId: waiter.id, items: itemsPayload });
      
      let kitchenPrintNotice = "";
      if (result.autoPrinted) {
        kitchenPrintNotice = " 🖨️ Mutfak fişi yazıcıya aktarıldı!";
      } else {
        try {
          const printRes = await request<{ success: boolean; transportUsed: string }>(
            `/api/v1/firms/${firmId}/branches/${branchId}/sales/orders/${result.order.id}/print-kitchen`, "pos-single", {}
          );
          kitchenPrintNotice = ` 🖨️ Mutfak fişi yazdırıldı (${printRes.transportUsed})!`;
        } catch {
          kitchenPrintNotice = " (Mutfak yazıcısına ulaşılamadı)";
        }
      }

      setCart([]); setRetryOrderId(null); setLastOrderId(result.order.id);
      setNotice(`${result.table} siparişi mutfağa gönderildi.${kitchenPrintNotice}`);
      setRefreshTick((tick) => tick + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sipariş gönderilemedi."); }
    finally { setSaving(false); }
  }

  function openTableAction(action: "transfer" | "merge" | "discount" | "group" | "ungroup") {
    if (!selectedTable || tableActionsBlocked || (!selectedTable.assignment && action !== "group" && action !== "ungroup")) return;
    setOperationError(""); setTableActionNotice(""); setTargetTableId(""); setMergeSourceIds([]);
    setGroupMemberIds([]); setGroupGuestCount(2);
    if (action === "discount") { setAdjustmentTab("discount"); setDiscountMode("percentage"); setDiscountValue(10); setDiscountReason(""); setLineAdjustments({}); }
    setTableAction(action);
  }

  async function submitTableGroup() {
    if (!selectedTable || tableActionsBlocked) return;
    if (tableAction === "group" && (!groupMemberIds.length || !Number.isInteger(groupGuestCount) || groupGuestCount < 1 || groupGuestCount > 999)) return;
    setOperationSaving(true); setOperationError("");
    try {
      if (tableAction === "ungroup" && selectedTable.group) {
        await request(`${servicePath}/table-groups/${selectedTable.group.id}/close`, "pos-single", { expectedVersion: selectedTable.group.version });
        setTableActionNotice("Masa grubu ayrıldı. Açık adisyon ana masada korunuyor.");
      } else if (tableAction === "group") {
        await request(`${servicePath}/table-groups`, "pos-single", {
          requestId: getOperationRequestId(`group:${selectedTable.id}:${groupMemberIds.slice().sort().join(",")}:${groupGuestCount}`),
          primaryTableId: selectedTable.id, memberTableIds: groupMemberIds, guestCount: groupGuestCount,
        });
        setTableActionNotice("Masa grubu oluşturuldu. Tüm siparişler ana masanın adisyonunda toplanır.");
      }
      operationRequest.current = null; setTableAction(null); setRetryOrderId(null); setTableId(selectedTable.id);
      setRefreshTick((tick) => tick + 1);
    } catch (cause) {
      if (isVersionConflict(cause)) await refreshAfterConflict(cause, "operation");
      else setOperationError(cause instanceof Error ? cause.message : "Masa grubu işlemi tamamlanamadı.");
    }
    finally { setOperationSaving(false); }
  }

  async function openSplitAction() {
    if (!selectedTable?.assignment || tableActionsBlocked) return;
    setOperationError(""); setTableActionNotice(""); setTableAction("split"); setOperationSaving(true);
    try {
      const result = await request<{ items: OpenCheck[] }>(`${checksPath}?tableId=${encodeURIComponent(selectedTable.id)}`, "pos-single");
      const checks = result.items.filter((check) => check.status === "open");
      openChecksRef.current = checks;
      setOpenChecks(checks);
      setSplitCheckId(checks[0]?.id ?? "");
      setSplitQuantities({});
      if (checks.length === 0) setOperationError("Bu masada bölünebilecek açık adisyon bulunamadı.");
      else if (checks[0].payments.length > 0) setOperationError("Ödeme girişimi bulunan adisyon bölünemez.");
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : "Adisyon bilgileri alınamadı.");
    } finally { setOperationSaving(false); }
  }

  async function openAdjustmentAction() {
    if (!selectedTable?.assignment || tableActionsBlocked) return;
    setOperationError(""); setTableActionNotice(""); setAdjustmentTab("discount");
    setLineAdjustments({}); setAdjustmentManagerPin(""); setTableAction("discount"); setOperationSaving(true);
    try {
      const result = await request<{ items: OpenCheck[] }>(`${checksPath}?tableId=${encodeURIComponent(selectedTable.id)}`, "pos-single");
      const checks = result.items.filter((check) => check.status === "open");
      openChecksRef.current = checks;
      setOpenChecks(checks); setAdjustmentCheckId(checks[0]?.id ?? "");
      if (!checks.length) setOperationError("İşlem yapılabilecek açık adisyon bulunamadı.");
      else if (checks.some((check) => check.payments.length > 0)) setOperationError("Ödeme girişimi bulunan adisyona indirim veya ikram uygulanamaz.");
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : "Adisyon bilgileri alınamadı.");
    } finally { setOperationSaving(false); }
  }

  async function submitAdjustment() {
    const check = openChecks.find((item) => item.id === adjustmentCheckId);
    if (!selectedTable || !check || operationSaving || check.payments.length > 0) return;
    let action: "discount" | "comp" | "void";
    let valueType: "percentage" | "fixed" | null = null;
    let value: number | null = null;
    let orderLineId: number | null = null;
    let quantity = 0;
    let reason = "";
    if (adjustmentTab === "discount") {
      action = "discount"; valueType = discountMode;
      value = discountMode === "percentage" ? Math.round(discountValue) : Math.round(discountValue * 100);
      reason = discountReason === "other" ? discountReasonNote.trim() : discountReason;
      const amount = Math.round(discountMode === "percentage" ? check.totalMinor * discountValue / 100 : discountValue * 100);
      if (!Number.isFinite(value) || value <= 0 || !reason) { setOperationError("İndirim tutarını ve gerekçesini girin."); return; }
      if (amount <= 0 || amount > check.totalMinor) { setOperationError("İndirim adisyonun kalan tutarını aşamaz."); return; }
    } else {
      const selected = Object.entries(lineAdjustments).find(([, item]) => item.action);
      if (!selected) { setOperationError("İkram veya iptal edilecek bir ürün seçin."); return; }
      const lineId = Number(selected[0]); const choice = selected[1];
      const line = check.orders.flatMap((order) => order.items).find((item) => item.id === lineId);
      if (!line) { setOperationError("Seçilen ürün bu adisyonda bulunamadı. Adisyonu yenileyin."); return; }
      action = choice.action; orderLineId = lineId; quantity = choice.quantity; reason = choice.reason;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > line.quantity || !reason) {
        setOperationError("Ürün adedini ve işlem gerekçesini seçin."); return;
      }
    }
    setOperationSaving(true); setOperationError("");
    try {
      const key = "adjust:" + check.id + ":" + adjustmentTab + ":" + JSON.stringify(lineAdjustments) + ":" + discountMode + ":" + discountValue + ":" + discountReason + ":" + discountReasonNote;
      const requestId = operationRequest.current?.key === key ? operationRequest.current.id : createRequestId();
      operationRequest.current = { key, id: requestId };
      const result = await request<{ adjustment: CheckAdjustment; check: OpenCheck; repeated: boolean }>(
        `${checksPath}/${encodeURIComponent(check.id)}/adjustments`, "pos-single",
        { requestId, expectedVersion: check.version, action, valueType, value, orderLineId, quantity, reason, managerPin: adjustmentManagerPin.trim() || undefined });
      operationRequest.current = null;
      setOpenChecks((current) => current.map((item) => item.id === result.check.id ? result.check : item));
      setTableAction(null); setRefreshTick((tick) => tick + 1);
      const actionLabel = action === "discount" ? "İndirim" : action === "comp" ? "İkram" : "Ürün iptali";
      const approval = result?.adjustment?.approvalMode?.startsWith("manager_pin:") ? `Yönetici Onayı: ${result.adjustment.approvalMode.slice(12)}` : "Geliştirme onayı";
      setTableActionNotice(`${actionLabel} (${money(result.adjustment.amountMinor)}) gerekçesiyle kaydedildi (${approval}).`);
      setAdjustmentManagerPin("");
    } catch (cause) {
      if (isVersionConflict(cause)) await refreshAfterConflict(cause, "operation");
      else setOperationError(cause instanceof Error ? cause.message : "İndirim/ikram kaydedilemedi.");
    }
    finally { setOperationSaving(false); }
  }

  async function submitTransfer() {
    if (!selectedTable?.assignment || !targetTableId || tableActionsBlocked) return;
    setOperationSaving(true); setOperationError("");
    try {
      await request(`${servicePath}/tables/${encodeURIComponent(selectedTable.id)}/transfer`, "pos-single", {
        requestId: getOperationRequestId(`transfer:${selectedTable.id}:${targetTableId}:${selectedTable.assignment.version}`),
        targetTableId, expectedVersion: selectedTable.assignment.version,
      });
      operationRequest.current = null;
      setTableAction(null); setTableId(targetTableId); setRetryOrderId(null);
      setTableActionNotice(`${selectedTable.name} masası başarıyla taşındı.`); setRefreshTick((tick) => tick + 1);
    } catch (cause) {
      if (isVersionConflict(cause)) await refreshAfterConflict(cause, "operation");
      else setOperationError(cause instanceof Error ? cause.message : "Masa taşınamadı.");
    }
    finally { setOperationSaving(false); }
  }

  async function submitMerge() {
    if (!selectedTable?.assignment || mergeSourceIds.length === 0 || tableActionsBlocked) return;
    const selectedSources = tables.filter((table) => mergeSourceIds.includes(table.id) && table.assignment);
    if (selectedSources.length !== mergeSourceIds.length) { setOperationError("Kaynak masalardan biri güncel değil. Masaları yenileyin."); return; }
    setOperationSaving(true); setOperationError("");
    try {
      const expectedVersions = Object.fromEntries([
        [selectedTable.id, selectedTable.assignment.version],
        ...selectedSources.map((table) => [table.id, table.assignment!.version]),
      ]);
      await request(`${servicePath}/tables/${encodeURIComponent(selectedTable.id)}/merge`, "pos-single", {
        requestId: getOperationRequestId(`merge:${selectedTable.id}:${JSON.stringify(expectedVersions)}`),
        sourceTableIds: mergeSourceIds, expectedVersions,
      });
      operationRequest.current = null;
      setTableAction(null); setTableActionNotice(`${mergeSourceIds.length} masa ${selectedTable.name} ile birleştirildi.`);
      setRefreshTick((tick) => tick + 1);
    } catch (cause) {
      if (isVersionConflict(cause)) await refreshAfterConflict(cause, "operation");
      else setOperationError(cause instanceof Error ? cause.message : "Masalar birleştirilemedi.");
    }
    finally { setOperationSaving(false); }
  }

  async function submitSplit() {
    if (!splitCheck || !selectedTable || tableActionsBlocked) return;
    const items = splitLines.map((line) => ({ orderLineId: line.id, quantity: splitQuantities[line.id] ?? 0 })).filter((line) => line.quantity > 0);
    if (splitCheck.payments.length > 0) { setOperationError("Ödeme girişimi bulunan adisyon bölünemez."); return; }
    if (items.length === 0 || splitTotal <= 0 || splitTotal >= splitCheck.totalMinor) {
      setOperationError("Bölünecek ürünleri seçin; kaynak adisyonda en az bir ürün kalmalıdır."); return;
    }
    setOperationSaving(true); setOperationError("");
    try {
      await request(`${checksPath}/${encodeURIComponent(splitCheck.id)}/split`, "pos-single", {
        requestId: getOperationRequestId(`split:${splitCheck.id}:${splitCheck.version}:${JSON.stringify(items)}`),
        expectedVersion: splitCheck.version, items,
      });
      operationRequest.current = null;
      setTableAction(null); setTableActionNotice("Adisyon başarıyla bölündü."); setRefreshTick((tick) => tick + 1);
    } catch (cause) {
      if (isVersionConflict(cause)) await refreshAfterConflict(cause, "operation");
      else setOperationError(cause instanceof Error ? cause.message : "Adisyon bölünemedi.");
    }
    finally { setOperationSaving(false); }
  }

  if (!waiterSession) {
    return (
      <PinPadModal
        title="Garson Tablet Girişi"
        appKind="waiter"
        allowedRoles={["waiter", "cashier", "owner", "manager", "chef"]}
        subtitle="Masalara sipariş girmek için 4 haneli PIN kodunuzu tuşlayın"
        onSuccess={(data) => {
          savePosSession("waiter", data);
          setWaiterSession(data);
          const match = waiters.find((w) => w.name.trim().toLowerCase() === data.user.fullName.trim().toLowerCase());
          if (match) setWaiterId(match.id);
        }}
      />
    );
  }

  return <main className="ops-shell waiter-shell">
    <header className="ops-header">
      <a href={buildPosTerminalHref("/waiter", terminalScope)} className="ops-brand waiter-brand"><img src="/hipos-logo.png" alt="HIPOS" /><span>GARSON</span></a>
      <div className="waiter-header-actions">
        <span style={{ fontSize: "0.85rem", color: "#60a5fa", fontWeight: "600", marginRight: "4px" }}>
          👤 Garson: {waiterSession.user.fullName}
        </span>
        <button
          type="button"
          onClick={() => {
            clearPosSession("waiter");
            setWaiterSession(null);
          }}
          className="waiter-back"
          style={{
            padding: "0.35rem 0.75rem",
            fontSize: "0.8rem",
            background: "#334155",
            borderColor: "#475569",
            color: "#f8fafc",
            fontWeight: 600,
            cursor: "pointer",
            marginRight: "8px",
          }}
          title="Garsonu değiştir veya ekranı kilitle"
        >
          🔒 Garson Değiştir / Kilitle
        </button>
        <button className="waiter-quiet-action" style={{ fontSize: "12px", padding: "4px 8px" }} disabled={Boolean(testPrinting)} onClick={() => void triggerTestPrint("kitchen")}>🖨️ Mutfak Test</button>
        <button className="waiter-quiet-action" style={{ fontSize: "12px", padding: "4px 8px" }} disabled={Boolean(testPrinting)} onClick={() => void triggerTestPrint("cashier")}>🧾 Kasa Test</button>
        <button className="waiter-quiet-action" style={{ fontSize: "12px", padding: "4px 8px" }} onClick={() => setPrinterSettingsOpen(true)}>⚙️ Yazıcı Ayarları</button>
        {selectedTable && <button className="waiter-back" onClick={() => { setTableId(""); setCart([]); setNotice(""); setError(""); setRetryOrderId(null); }}>← Masalara dön</button>}
        <SyncStatusPill
          syncStatus={syncStatus}
          localReachable={localReachable}
          apiOffline={connectionState === "unavailable"}
          apiLoading={connectionState === "checking"}
          flushing={syncFlushing}
          onTrigger={() => void triggerSyncFlush()}
        />
      </div>
    </header>
    {!selectedTable && notice && <p className="ops-success" role="status" style={{ margin: "12px 16px", padding: "10px 14px", borderRadius: "8px", fontWeight: "bold" }}>{notice}</p>}
    {!selectedTable && <><section className="waiter-welcome"><div><span className="ops-eyebrow">GARSON PANELİ / ANA SALON</span><h1>{waiter ? `Hoş geldin, ${waiter.name}` : "Hoş geldin"}</h1><p className="waiter-branch"><svg className="waiter-location-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>Aktif şube: <strong>Merkez</strong></p></div>
      <label className="waiter-select">Garson<select value={waiterId} onChange={(event) => { setWaiterId(event.target.value); setRetryOrderId(null); }}><option value="">Garson seçin</option>{waiters.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    </section>
    <section className="waiter-summary" aria-label="Masa özeti">
      <div><strong>{tables.length}</strong><span>Toplam masa</span></div><div className="empty"><strong>{emptyTableCount}</strong><span>Boş</span></div><div className="occupied"><strong>{occupiedTableCount}</strong><span>Dolu</span></div><div className="bill-requested"><strong>{billRequestedTableCount}</strong><span>Hesap istendi</span></div><div className="reserved"><strong>{reservedTableCount}</strong><span>Rezerve</span></div>
    </section>
    <div className="waiter-section-heading"><h2>Masalar</h2><span>{tables.length} masa</span><button onClick={() => setRefreshTick((tick) => tick + 1)} disabled={loading} aria-label="Masaları yenile">Yenile</button></div>
    {loading && <p className="ops-message">Menü ve masalar yükleniyor…</p>}
    {error && <p className="ops-error" role="alert">{error}</p>}
    {!loading && !error && tables.length === 0 && <p className="ops-message">Gösterilecek aktif masa bulunamadı.</p>}
    {!selectedTable && kitchenNotice && <p className="waiter-kitchen-notice" role="alert">{kitchenNotice}</p>}
    {buildFloorSections(tables, configuredFloors).map((floor) => {
      const floorTables = tables.filter((item) => normalizeFloorName(item.floor) === floor.key);
      if (!floorTables.length) return null;
      return <section className="waiter-floor-section" key={floor.key} aria-label={floor.label}><div className="waiter-floor-heading"><h3>{floor.label}</h3><span>{floorTables.length} masa</span></div><div className="waiter-table-grid">{floorTables.map((item) => {
      const status = getTableStatus(item);
      const visualStatus = status === "bill_requested" ? "bill-requested" : item.group ? "grouped" : status === "reserved" ? "reserved" : status === "occupied" ? "occupied" : "empty";
      const statusLabel = status === "bill_requested" ? "Hesap istendi" : item.group ? "Grupta" : status === "reserved" ? "Rezerve" : status === "occupied" ? "Dolu" : "Boş";
      return <button type="button" className={`waiter-table-card ${visualStatus}`} key={item.id} onClick={() => { setTableId(item.group?.primaryTableId ?? item.id); setCart([]); setNotice(""); setTableActionNotice(""); setDetailSyncNotice(""); setTableStatusError(""); setReservationDate(item.reservedFor ? new Date(new Date(item.reservedFor).getTime() - new Date(item.reservedFor).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : ""); setRetryOrderId(null); }}>
      <svg className="waiter-table-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="6" width="14" height="12" rx="3" /><path d="M9 3h6M9 21h6M2 10v4M22 10v4" /></svg><strong>{item.name}</strong><span className="waiter-table-status">{statusLabel}</span>
      {item.group && <small className="waiter-group-card-label">{item.group.tableIds.length} masa · {item.group.guestCount} kişi<br />Ana masa: {item.group.tableNames[0]}</small>}
      {item.assignment && <><span className="waiter-table-owner">{item.assignment.waiterName ?? "Açık adisyon"}</span><b>{money(item.assignment.totalMinor)}</b></>}
      {status === "reserved" && item.reservedFor && <small className="waiter-reserved-time">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.reservedFor))}</small>}
    </button>;
    })}</div></section>;
    })}</>}
    <dialog ref={reservationDialog} className="waiter-reservation-dialog" aria-labelledby="reservation-title" onCancel={(event) => { if (tableStatusSaving) event.preventDefault(); else setReservationOpen(false); }} onClose={() => setReservationOpen(false)}>
      {reservationOpen && selectedTable && <form className="waiter-custom-modal" onSubmit={(event) => { event.preventDefault(); void reserveTable(); }}>
        <header><div><span className="ops-eyebrow">{selectedTable.name}</span><h2 id="reservation-title">{getTableStatus(selectedTable) === "reserved" ? "Rezervasyonu düzenle" : "Masayı rezerve et"}</h2></div><button type="button" className="waiter-modal-close" aria-label="Rezervasyon penceresini kapat" disabled={tableStatusSaving} onClick={() => setReservationOpen(false)}>×</button></header>
        <label className="waiter-note-field">Ad soyad<input autoFocus required maxLength={120} autoComplete="off" placeholder="Rezervasyon sahibinin adı soyadı" value={reservationGuestName} disabled={tableStatusSaving} onChange={(event) => { setReservationGuestName(event.target.value); setTableStatusError(""); }} /></label>
        <label className="waiter-note-field">Tarih ve saat<input type="datetime-local" required value={reservationDate} min={reservationMinValue} disabled={tableStatusSaving} onChange={(event) => { setReservationDate(event.target.value); setTableStatusError(""); }} /></label>
        {reservationDate && !Number.isNaN(new Date(reservationDate).getTime()) && <p className="waiter-reservation-preview">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "full", timeStyle: "short" }).format(new Date(reservationDate))}</p>}
        {tableStatusError && <p className="ops-error" role="alert">{tableStatusError}</p>}
        <footer><button type="button" className="waiter-cancel-custom" disabled={tableStatusSaving} onClick={() => setReservationOpen(false)}>Vazgeç</button><button type="submit" className="ops-primary" disabled={tableActionsBlocked || !reservationGuestName.trim() || !reservationDate}>{tableStatusSaving ? "Kaydediliyor…" : "Rezervasyonu kaydet"}</button></footer>
      </form>}
    </dialog>
    <PrinterSettingsModal
      open={printerSettingsOpen}
      firmId={firmId}
      branchId={branchId}
      appKind="waiter"
      onClose={() => setPrinterSettingsOpen(false)}
      onSaved={(msg) => setNotice(msg)}
    />
    {selectedTable && <section className="waiter-order-page" aria-live="polite">
      <div className="waiter-order-heading"><div><span className="ops-eyebrow">MASA DETAYI</span><h1>{selectedTable.group ? selectedTable.group.tableNames.join(" + ") : selectedTable.name}</h1>{selectedTable.group && <p className="waiter-group-info">{selectedTable.group.guestCount} kişi · Ana masa: {selectedTable.name} · Ortak adisyon</p>}</div><span className={`waiter-table-status ${getTableStatus(selectedTable) === "bill_requested" ? "bill-requested" : getTableStatus(selectedTable) === "reserved" ? "reserved" : selectedTable.assignment || selectedTable.group ? "occupied" : "empty"}`}>{getTableStatus(selectedTable) === "bill_requested" ? "Hesap istendi" : selectedTable.group ? "Masa grubu" : getTableStatus(selectedTable) === "reserved" ? "Rezerve" : selectedTable.assignment ? "Dolu" : "Boş"}</span></div>
      {notice && <p className="ops-success" role="status" style={{ margin: "10px 0", padding: "10px 14px", borderRadius: "8px", fontWeight: "bold" }}>{notice}{lastOrderId && <small> · Sipariş: {lastOrderId.slice(0, 8)}</small>}</p>}
      {error && <p className="ops-error" role="alert" style={{ margin: "10px 0" }}>{error}</p>}
      {getTableStatus(selectedTable) === "reserved" && !selectedTable.assignment && <section className="waiter-reservation-summary" aria-label="Rezervasyon bilgisi"><div><strong>{selectedTable.reservationGuestName ?? "Masa rezerve"}</strong><span>{selectedTable.reservedFor ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "full", timeStyle: "short" }).format(new Date(selectedTable.reservedFor)) : "Rezervasyon saati belirtilmemiş"}</span></div><div className="waiter-state-actions"><button className="waiter-back" disabled={tableActionsBlocked} onClick={openReservation}>Düzenle</button><button className="waiter-state-danger" disabled={tableActionsBlocked} onClick={() => void updateTableStatus("reservation/cancel")}>{tableStatusSaving ? "Kaydediliyor…" : "Rezervasyonu kaldır"}</button></div></section>}
      {getTableStatus(selectedTable) !== "reserved" && <div className="waiter-context-toolbar">
        <label className="waiter-select waiter-order-waiter">Garson<select value={waiterId} onChange={(event) => { setWaiterId(event.target.value); setRetryOrderId(null); }}><option value="">Garson seçin</option>{waiters.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <div className="waiter-context-actions">
          {getTableStatus(selectedTable) === "idle" && !selectedTable.assignment && !selectedTable.group && <button className="waiter-quiet-action" disabled={tableActionsBlocked} onClick={openReservation}>Rezerve et</button>}
          {selectedTable.assignment && <button className={`waiter-status-action ${getTableStatus(selectedTable) === "bill_requested" ? "active" : ""}`} disabled={tableStatusSaving} onClick={() => void updateTableStatus(getTableStatus(selectedTable) === "bill_requested" ? "cancel-bill-request" : "request-bill")}>{tableStatusSaving ? "Kaydediliyor…" : getTableStatus(selectedTable) === "bill_requested" ? "Hesap isteğini kaldır" : "Hesap istendi"}</button>}
          {selectedTable.assignment && <button className="waiter-status-action" style={{ background: "#2563eb", color: "#fff", borderColor: "#2563eb" }} disabled={printingBill || Boolean(settlingTable)} onClick={() => void printBillForTable()}>{printingBill ? "Basılıyor…" : "🧾 Ara Hesap Fişi"}</button>}
          {selectedTable.assignment && <button className="waiter-status-action" style={{ background: "#d97706", color: "#fff", borderColor: "#d97706" }} disabled={reprintingKitchen || tableActionsBlocked} onClick={() => void reprintKitchenTicket()}>{reprintingKitchen ? "Basılıyor…" : "🔁 Mutfak Fişi Tekrar"}</button>}
          {selectedTable.assignment && <button className="waiter-status-action" style={{ background: "#059669", color: "#fff", borderColor: "#059669" }} disabled={Boolean(settlingTable) || tableActionsBlocked} onClick={() => void settleTable("NAKIT")}>{settlingTable === "NAKIT" ? "Kapatılıyor…" : "💵 Nakit İle Kapat"}</button>}
          {selectedTable.assignment && <button className="waiter-status-action" style={{ background: "#7c3aed", color: "#fff", borderColor: "#7c3aed" }} disabled={Boolean(settlingTable) || tableActionsBlocked} onClick={() => void settleTable("KART")}>{settlingTable === "KART" ? "Kapatılıyor…" : "💳 Kart İle Kapat"}</button>}
          <button className="waiter-quiet-action" disabled={tableActionsBlocked} onClick={() => openTableAction(selectedTable.group ? "ungroup" : "group")}>{selectedTable.group ? "Grubu Ayır" : "Masa Grubu Oluştur"}</button>
        </div>
      </div>}
      {getTableStatus(selectedTable) !== "reserved" && !selectedTable.assignment && cartRows.length > 0 && <p className="waiter-inline-hint">Masa veya rezervasyon işlemleri için önce sepeti boşaltın ya da siparişi gönderin.</p>}
      {tableStatusError && !reservationOpen && <p className="ops-error" role="alert">{tableStatusError}</p>}
      {detailSyncNotice && <p className="ops-message" role="status">{detailSyncNotice}</p>}
      {selectedTable.assignment && <div className="waiter-open-check"><div><strong>Açık adisyon · {selectedTable.assignment.waiterName ?? "Garson atanmamış"}</strong><span>Mevcut sipariş</span></div><b>{money(selectedTable.assignment.totalMinor)}</b>
        {selectedTable.assignment.adjustmentMinor > 0 && <div className="waiter-open-check-breakdown" aria-label="Adisyon tutar dökümü">
          <div><span>İşlemler öncesi ara toplam</span><b>{money(selectedTable.assignment.grossTotalMinor)}</b></div>
          {checkAdjustmentTotals.discount > 0 && <div><span>İndirim</span><b>−{money(checkAdjustmentTotals.discount)}</b></div>}
          {checkAdjustmentTotals.comp > 0 && <div><span>İkram</span><b>−{money(checkAdjustmentTotals.comp)}</b></div>}
          {checkAdjustmentTotals.void > 0 && <div><span>Ürün iptali</span><b>−{money(checkAdjustmentTotals.void)}</b></div>}
        </div>}
        {selectedTable.assignment.items.length > 0 && <ul>{selectedTable.assignment.items.map((line, index) => <li key={`${line.productId}-${index}`}>
          <span><strong className="waiter-line-name">{line.quantity} × {line.productName}</strong>{Boolean(line.note || line.options?.length) && <small className="waiter-line-detail">{[...(line.options ?? []).map((option) => option.optionName), line.note].filter(Boolean).join(" · ")}</small>}</span>
          <b className="waiter-line-price">{money(line.lineTotalMinor)}</b>
        </li>)}</ul>}
      </div>}
      {kitchenNotice && <p className="waiter-kitchen-notice" role="alert">{kitchenNotice}</p>}
      {selectedKitchenItems.length > 0 && <section className="waiter-kitchen-status" aria-label="Mutfak durumu">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
          <h2 style={{ margin: 0 }}>Mutfak Durumu</h2>
          <button
            type="button"
            className="waiter-quiet-action"
            style={{ fontSize: "12px", background: "#fef3c7", borderColor: "#fde68a", color: "#92400e", fontWeight: "bold", padding: "6px 12px", borderRadius: "6px" }}
            disabled={reprintingKitchen || tableActionsBlocked}
            onClick={() => void reprintKitchenTicket()}
            title="Aşçı için mutfak sipariş fişini 'TEKRAR BASIM' ibaresiyle yeniden yazdırır."
          >
            {reprintingKitchen ? "Yazdırılıyor…" : "🖨️ Mutfak Fişini Tekrar Bas"}
          </button>
        </div>
        <ul>{selectedKitchenItems.map((item) => <li key={item.id}>
        <span><strong>{item.quantity} × {item.productName}</strong>{item.note && <small>{item.note}</small>}</span>
        <span className={`waiter-kitchen-state ${item.status}`}>{item.status === "cancelled" ? "İptal bildirildi" : item.status === "pending" ? "Bekliyor" : item.status === "preparing" ? "Hazırlanıyor" : item.status === "ready" ? "Hazır" : "Servise çıktı"}</span>
      </li>)}</ul></section>}
      {selectedTable.assignment && <section className="waiter-table-actions" aria-labelledby="table-actions-title">
        <div className="waiter-actions-heading"><div><span className="ops-eyebrow">AÇIK ADİSYON</span><h2 id="table-actions-title">Masa İşlemleri</h2></div><span>{selectedTable.assignment.items.length} kalem</span></div>
        <div className="waiter-action-grid">
          <button disabled={tableActionsBlocked || Boolean(selectedTable.group)} onClick={() => openTableAction("transfer")}><span aria-hidden="true">⇄</span><strong>Masa Taşı</strong><small>Adisyonu boş masaya aktar</small></button>
          <button disabled={tableActionsBlocked || Boolean(selectedTable.group)} onClick={() => openTableAction("merge")}><span aria-hidden="true">⊕</span><strong>Masa Birleştir</strong><small>Başka masanın hesabını ekle</small></button>
          <button disabled={tableActionsBlocked} onClick={() => void openSplitAction()}><span aria-hidden="true">◫</span><strong>Adisyon Böl</strong><small>Ürünleri ayrı hesaba ayır</small></button>
          <button disabled={tableActionsBlocked} onClick={() => { window.location.href = `/cashier?tableId=${encodeURIComponent(selectedTable.group?.primaryTableId ?? selectedTable.id)}`; }}><span aria-hidden="true">₺</span><strong>Ödeme Al</strong><small>Kasa ekranını aç</small></button>
          <button disabled={tableActionsBlocked} onClick={() => void openAdjustmentAction()}><span aria-hidden="true">％</span><strong>İndirim / İkram</strong><small>Gerekçeli işlem kaydı</small></button>
        </div>
        {cartRows.length > 0 && <p className="waiter-action-hint">Gönderilmemiş sepet varken masa işlemleri kapalıdır. Önce siparişi mutfağa gönderin veya sepeti boşaltın.</p>}
        {operationSaving && !tableAction && <p className="ops-message">Adisyon bilgileri yükleniyor…</p>}
        {operationError && !tableAction && <p className="ops-error" role="alert">{operationError}</p>}
      </section>}
      {tableActionNotice && <p className="ops-success" role="status">{tableActionNotice}</p>}
      {getTableStatus(selectedTable) !== "reserved" && <section className="waiter-bill-summary" aria-label="Adisyon ve yeni sipariş tutarları">
        {selectedTable.assignment && <div><span>Mevcut adisyon</span><strong>{money(selectedTable.assignment.totalMinor)}</strong></div>}
        <div className={`new-order${selectedTable.assignment ? "" : " waiter-order-total-only"}`}><span>{selectedTable.assignment ? "Yeni sipariş" : "Sipariş toplamı"}</span><strong>{money(total)}</strong></div>
      </section>}
      {selectedTable.assignment && <div className="waiter-checkout-bar" style={{ display: "flex", gap: "10px", marginTop: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <button type="button" className="waiter-status-action" style={{ background: "#2563eb", color: "#fff", borderColor: "#2563eb", padding: "10px 16px", borderRadius: "8px", fontWeight: "bold" }} disabled={printingBill || Boolean(settlingTable)} onClick={() => void printBillForTable()}>
          {printingBill ? "Baskı alınıyor…" : "🧾 Ara Hesap Fişi Bas"}
        </button>
        <button type="button" className="waiter-status-action" style={{ background: "#d97706", color: "#fff", borderColor: "#d97706", padding: "10px 16px", borderRadius: "8px", fontWeight: "bold" }} disabled={reprintingKitchen || Boolean(settlingTable) || tableActionsBlocked} onClick={() => void reprintKitchenTicket()}>
          {reprintingKitchen ? "Yazdırılıyor…" : "🖨️ Mutfak Fişini Tekrar Bas"}
        </button>
        <button type="button" className="waiter-status-action" style={{ background: "#059669", color: "#fff", borderColor: "#059669", padding: "10px 16px", borderRadius: "8px", fontWeight: "bold" }} disabled={Boolean(settlingTable) || tableActionsBlocked} onClick={() => void settleTable("NAKIT")}>
          {settlingTable === "NAKIT" ? "Kapatılıyor…" : "💵 Nakit Ödeme & Masayı Kapat"}
        </button>
        <button type="button" className="waiter-status-action" style={{ background: "#7c3aed", color: "#fff", borderColor: "#7c3aed", padding: "10px 16px", borderRadius: "8px", fontWeight: "bold" }} disabled={Boolean(settlingTable) || tableActionsBlocked} onClick={() => void settleTable("KART")}>
          {settlingTable === "KART" ? "Kapatılıyor…" : "💳 Kart Ödeme & Masayı Kapat"}
        </button>
      </div>}
      {getTableStatus(selectedTable) !== "reserved" && !waiter && <p className="ops-message">Sipariş eklemek için önce garson seçin.</p>}
      {assignedToOtherWaiter && <p className="ops-message">Bu masa {selectedTable.assignment?.waiterName ?? "başka bir garsona"} tarafından yönetiliyor. Sipariş eklemek için o garsonu seçin.</p>}
      {getTableStatus(selectedTable) !== "reserved" && waiter && !assignedToOtherWaiter && <>
      <div className="waiter-catalog-heading"><h2 className="waiter-catalog-title">{catalogView === "categories" ? "Kategoriler" : menus.length > 1 ? "Menü seçin" : selectedMenu?.name ?? "Menü"}</h2>
        {catalogView === "menus" && menus.length > 1 && <label className="waiter-menu-select">Aktif menü
          <select aria-label="POS aktif menüsü" value={selectedMenuId} onChange={(event) => {
            setSelectedMenuId(event.target.value); setCategoryId(null); setSearch("");
          }}>{menus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name}</option>)}</select>
        </label>}
      </div>
      <div className="waiter-catalog-views" role="group" aria-label="Ürün görünümü">
        <button type="button" aria-pressed={catalogView === "menus"} onClick={() => { setCatalogView("menus"); setCategoryId(null); setSearch(""); }}>Menüler</button>
        <button type="button" aria-pressed={catalogView === "categories"} onClick={() => { setCatalogView("categories"); setCategoryId(null); setSearch(""); }}>Kategoriler</button>
      </div>
      {!loading && catalogView === "menus" && menuSections.length === 0 && !error && <p className="ops-message">Aktif menü bulunmuyor. Ürünleri Kategoriler görünümünden inceleyebilirsiniz.</p>}
      {!loading && catalogView === "categories" && availableProducts.length === 0 && !error && <p className="ops-message">POS’ta kullanılabilir kategori ürünü bulunmuyor.</p>}
      <label className="waiter-search"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ürün ara…" aria-label="Ürün ara" /></label>
      <div className="waiter-categories" aria-label="Menü bölümleri">{catalogGroups.map((group) => {
        const expanded = Boolean(normalizedSearch) || categoryId === group.sectionId;
        const panelId = `waiter-products-${group.sectionId}`;
        return <section className={`waiter-category${normalizedSearch ? " waiter-category-search" : ""}`} key={group.sectionId}>
          {normalizedSearch ? <h3 className="waiter-products-title">Arama sonuçları · {group.products.length} ürün</h3> : <h3>
            <button className="waiter-category-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => setCategoryId((current) => current === group.sectionId ? null : group.sectionId)}>
              <span>{group.name}</span><small>{group.products.length} ürün</small>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </h3>}
          <div className="waiter-category-panel" id={panelId} hidden={!expanded}>{expanded && (group.products.length === 0
            ? <p className="ops-message">{normalizedSearch ? "Aramanızla eşleşen ürün bulunamadı." : "Bu kategoride ürün bulunamadı."}</p>
            : <section className="ops-product-grid waiter-menu-grid" aria-label={`${group.name} ürünleri`}>{group.products.map((product) => <article className={`ops-product waiter-product ${product.isOutOfStock ? "out-of-stock" : ""}`} key={product.id}>
              <div className="waiter-product-main"><span className="waiter-product-image" aria-hidden="true"><PosProductImage image={product.image} productId={product.id} name={product.name} /></span><div><strong>{product.name}{product.isOutOfStock && <span className="waiter-stock-badge out-of-stock">🚫 Tükendi</span>}{!product.isOutOfStock && product.isCriticalStock && <span className="waiter-stock-badge critical-stock">⚠️ Kritik ({product.availablePortions ?? 0})</span>}</strong><span>{demoDescriptions[product.id] ?? product.category.name}</span></div></div>
              <div className="waiter-product-bottom"><strong>{money(product.price.amountMinor)}</strong>{product.isOutOfStock ? <button className="waiter-add-product out-of-stock" disabled={true} title={`${product.name} tükendi`}>Tükendi</button> : <button className="waiter-add-product" disabled={saving} onClick={() => openCustomization(product)}>＋ <span>Ekle</span></button>}</div>
            </article>)}</section>)}</div>
        </section>;
      })}</div>
      <section className="ops-cart waiter-cart"><div><span>Sepet</span><strong>{money(total)}</strong></div>
        {cartRows.length ? <ul>{cartRows.map((item) => <li key={item.cartId}>
          <span className="waiter-cart-item"><strong className="waiter-line-name">{item.quantity} × {item.name}</strong><small>{[...item.options.map((option) => option.optionName), item.note].filter(Boolean).join(" · ") || "Standart hazırlama"}</small><b className="waiter-line-price">{money(item.quantity * (item.price.amountMinor + item.options.reduce((delta, option) => delta + option.priceDeltaMinor * option.quantity, 0)))}</b></span>
          <div className="waiter-cart-actions">
            <button className="waiter-cart-edit" disabled={saving} aria-label={`${item.name} düzenle`} onClick={() => openCustomization(item, item)}>Düzenle</button>
            <div className="ops-quantity"><button disabled={saving} aria-label={`${item.name} azalt`} onClick={() => changeCartLine(item.cartId, -1)}>−</button><b>{item.quantity}</b><button disabled={saving} aria-label={`${item.name} artır`} onClick={() => changeCartLine(item.cartId, 1)}>+</button></div>
          </div>
        </li>)}</ul> : <p>Menüden ürün ekleyin.</p>}
        <button className="ops-primary" disabled={!waiter || !cartRows.length || saving} onClick={() => void sendOrder()}>{saving ? "Gönderiliyor…" : "Siparişi mutfağa gönder"}</button>
        {error && <p className="ops-error" role="alert">{error}</p>}
      </section></>}
      {customizingProduct && <div className="waiter-modal-backdrop waiter-product-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCustomization(); }}><section className="waiter-custom-modal waiter-product-modal" role="dialog" aria-modal="true" aria-labelledby="customize-title"><header><div><span className="ops-eyebrow">ÜRÜNÜ DÜZENLE</span><h2 id="customize-title">{customizingProduct.name}</h2></div><button className="waiter-modal-close" onClick={closeCustomization} aria-label="Kapat">×</button></header>
        <ProductOptionPicker key={`${customizingProduct.id}:${editingCartId ?? "new"}`} firmId={firmId} branchId={branchId} actor="pos-single" productId={customizingProduct.id} basePriceMinor={customizingProduct.price.amountMinor} initial={editingCartLine?.options ?? []} onChange={setOptionSelection} />
        <label className="waiter-note-field">Ürün notu<textarea value={customNote} onChange={(event) => setCustomNote(event.target.value.slice(0, 500))} placeholder="Örn. sosu ayrı, az tuzlu…" maxLength={500} rows={3} /><small>{customNote.length}/500</small></label><p className="waiter-custom-hint">Seçenekler ve fiyatlar sipariş gönderilirken sunucuda doğrulanır.</p><footer><button className="waiter-cancel-custom" onClick={closeCustomization}>Vazgeç</button><button className="ops-primary" disabled={saving || !optionSelection?.valid} onClick={saveCustomizedProduct}>{editingCartId ? "Değişiklikleri kaydet" : "Sepete ekle"} · {money((optionSelection?.unitPriceMinor ?? customizingProduct.price.amountMinor) * (editingCartLine?.quantity ?? 1))}</button></footer></section></div>}
      {tableAction && <div className="waiter-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !operationSaving) { setTableAction(null); setOperationError(""); } }}><section className="waiter-custom-modal waiter-action-modal" role="dialog" aria-modal="true" aria-labelledby="table-action-title">
        <header><div><span className="ops-eyebrow">{selectedTable.name}</span><h2 id="table-action-title">{tableAction === "transfer" ? "Masa Taşı" : tableAction === "merge" ? "Masa Birleştir" : tableAction === "split" ? "Adisyon Böl" : tableAction === "group" ? "Masa Grubu Oluştur" : tableAction === "ungroup" ? "Grubu Ayır" : "İndirim / İkram"}</h2></div><button className="waiter-modal-close" disabled={operationSaving} onClick={() => { setTableAction(null); setOperationError(""); }} aria-label="Kapat">×</button></header>
        {tableAction === "group" && <>
          <p className="waiter-action-description">Ana masa: <strong>{selectedTable.name}</strong>. Seçilen masalar birlikte kullanımda görünür. Herhangi birinden aynı sipariş ekranı açılır. Ek masaların boş olması gerekir.</p>
          <label className="waiter-note-field">Kişi sayısı<input className="waiter-discount-input" type="number" min="1" max="999" step="1" value={groupGuestCount} onChange={(event) => setGroupGuestCount(Number(event.target.value))} /></label>
          <fieldset className="waiter-action-source-list"><legend>Birlikte kullanılacak boş masalar</legend>{groupCandidates.map((table) => <label key={table.id}><input type="checkbox" checked={groupMemberIds.includes(table.id)} onChange={(event) => setGroupMemberIds((current) => event.target.checked ? [...current, table.id] : current.filter((id) => id !== table.id))} /><span><strong>{table.name}</strong></span></label>)}{groupCandidates.length === 0 && <p className="ops-message">Gruba eklenebilecek boş masa yok.</p>}</fieldset>
          <p className="waiter-action-description">{groupMemberIds.length + 1} masa · {groupGuestCount || 0} kişi · Tek ana adisyon</p>
          <footer><button className="waiter-cancel-custom" disabled={operationSaving} onClick={() => setTableAction(null)}>Vazgeç</button><button className="ops-primary" disabled={operationSaving || !groupMemberIds.length || groupMemberIds.length > 20 || !Number.isInteger(groupGuestCount) || groupGuestCount < 1 || groupGuestCount > 999} onClick={() => void submitTableGroup()}>{operationSaving ? "Oluşturuluyor…" : "Grubu oluştur"}</button></footer>
        </>}
        {tableAction === "ungroup" && selectedTable.group && <>
          <p className="waiter-action-description">{selectedTable.group.tableNames.join(" + ")} grubu ayrılacak. Ek masalar serbest kalacak. Mevcut siparişler ve açık adisyon <strong>{selectedTable.name}</strong> üzerinde korunacak. Bu işlem ödeme almaz veya hesabı kapatmaz.</p>
          <footer><button className="waiter-cancel-custom" disabled={operationSaving} onClick={() => setTableAction(null)}>Vazgeç</button><button className="ops-primary" disabled={operationSaving} onClick={() => void submitTableGroup()}>{operationSaving ? "Ayrılıyor…" : "Grubu ayır"}</button></footer>
        </>}
        {tableAction === "transfer" && <>
          <p className="waiter-action-description">{selectedTable.name} üzerindeki açık adisyon ve siparişler seçilen boş masaya aktarılır.</p>
          <label className="waiter-note-field">Boş hedef masa<select className="waiter-action-select" value={targetTableId} onChange={(event) => setTargetTableId(event.target.value)}><option value="">Masa seçin</option>{transferTargets.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label>
          {transferTargets.length === 0 && <p className="ops-message">Taşımak için boş masa yok.</p>}
          <footer><button className="waiter-cancel-custom" disabled={operationSaving} onClick={() => setTableAction(null)}>Vazgeç</button><button className="ops-primary" disabled={!targetTableId || operationSaving} onClick={() => void submitTransfer()}>{operationSaving ? "Taşınıyor…" : "Masayı taşı"}</button></footer>
        </>}
        {tableAction === "merge" && <>
          <p className="waiter-action-description">{selectedTable.name} hedef masa olarak kalır. Birleştirilecek diğer masaların açık adisyonları bu hesaba eklenir.</p>
          <fieldset className="waiter-action-source-list"><legend>Kaynak masaları seçin</legend>{tables.filter((table) => table.id !== selectedTable.id && table.assignment && !table.group).map((table) => <label key={table.id}><input type="checkbox" checked={mergeSourceIds.includes(table.id)} onChange={(event) => setMergeSourceIds((current) => event.target.checked ? [...current, table.id] : current.filter((id) => id !== table.id))} /><span><strong>{table.name}</strong><small>{money(table.assignment!.totalMinor)} · {table.assignment!.items.length} kalem</small></span></label>)}{tables.filter((table) => table.id !== selectedTable.id && table.assignment && !table.group).length === 0 && <p className="ops-message">Birleştirilecek başka açık masa yok.</p>}</fieldset>
          <footer><button className="waiter-cancel-custom" disabled={operationSaving} onClick={() => setTableAction(null)}>Vazgeç</button><button className="ops-primary" disabled={mergeSourceIds.length === 0 || operationSaving} onClick={() => void submitMerge()}>{operationSaving ? "Birleştiriliyor…" : "Masaları birleştir"}</button></footer>
        </>}
        {tableAction === "split" && <>
          {operationSaving && <p className="ops-message">Açık adisyonlar yükleniyor…</p>}
          {!operationSaving && openChecks.length > 1 && <label className="waiter-note-field">Bölünecek adisyon<select className="waiter-action-select" value={splitCheckId} onChange={(event) => { setSplitCheckId(event.target.value); setSplitQuantities({}); setOperationError(""); }}><option value="">Adisyon seçin</option>{openChecks.map((check, index) => <option key={check.id} value={check.id}>Adisyon {index + 1} · {money(check.totalMinor)}</option>)}</select></label>}
          {splitCheck && <><p className="waiter-action-description">Yeni adisyona aktarılacak miktarları girin. Kaynak adisyonda en az bir ürün kalmalıdır.</p><div className="waiter-split-lines">{splitLines.map((line) => <label key={line.id}><span><strong>{line.productName}</strong><small>Mevcut: {line.quantity} · {money(line.unitPriceMinor)} / adet</small></span><input aria-label={`${line.productName} bölünecek miktar`} type="number" min="0" max={line.quantity} value={splitQuantities[line.id] ?? 0} onChange={(event) => { const quantity = Math.max(0, Math.min(line.quantity, Number(event.target.value) || 0)); setSplitQuantities((current) => ({ ...current, [line.id]: quantity })); setOperationError(""); }} /></label>)}</div><div className="waiter-split-total"><span>Yeni adisyon tutarı</span><strong>{money(splitTotal)}</strong></div>{splitCheck.payments.length > 0 && <p className="ops-error">Ödeme girişimi olan adisyon bölünemez.</p>}</>}
          {openChecks.length === 0 && !operationSaving && <p className="ops-message">Bu masada bölünebilecek açık adisyon bulunamadı.</p>}
          <footer><button className="waiter-cancel-custom" disabled={operationSaving} onClick={() => setTableAction(null)}>Vazgeç</button><button className="ops-primary" disabled={!splitCheck || splitCheck.payments.length > 0 || operationSaving || splitTotal <= 0 || splitTotal >= (splitCheck?.totalMinor ?? 0)} onClick={() => void submitSplit()}>{operationSaving ? "Bölünüyor…" : "Adisyonu böl"}</button></footer>
        </>}
        {tableAction === "discount" && selectedTable.assignment && <>
          <p className="waiter-action-description">İşlem gerekçeyle kaydedilir. Geliştirme ortamında yönetici onayı olmadan uygulanır.</p>
          {openChecks.length > 1 && <label className="waiter-note-field">İşlem yapılacak adisyon<select className="waiter-action-select" value={adjustmentCheckId} onChange={(event) => { setAdjustmentCheckId(event.target.value); setLineAdjustments({}); setOperationError(""); }}><option value="">Adisyon seçin</option>{openChecks.map((check, index) => <option value={check.id} key={check.id}>Adisyon {index + 1} · {money(check.totalMinor)}</option>)}</select></label>}
          <nav className="waiter-adjustment-tabs" aria-label="İndirim ve ikram işlemleri"><button className={adjustmentTab === "discount" ? "active" : ""} onClick={() => { setAdjustmentTab("discount"); setLineAdjustments({}); setOperationError(""); }}>Adisyon indirimi</button><button className={adjustmentTab === "line" ? "active" : ""} onClick={() => { setAdjustmentTab("line"); setLineAdjustments({}); setOperationError(""); }}>Ürün ikramı / iptali</button></nav>
          {operationSaving && openChecks.length === 0 && <p className="ops-message">Açık adisyonlar yükleniyor…</p>}
          {adjustmentCheck && <div className="waiter-adjustment-balance"><span>Hesap</span><strong>{money(adjustmentCheck.totalMinor)}</strong>{adjustmentCheck.adjustmentMinor > 0 && <small>İşlemler öncesi {money(adjustmentCheck.grossTotalMinor)} · uygulanan {money(adjustmentCheck.adjustmentMinor)}</small>}</div>}
          {adjustmentTab === "discount" && <>
            <div className="waiter-discount-mode"><button className={discountMode === "percentage" ? "active" : ""} onClick={() => setDiscountMode("percentage")}>Yüzde</button><button className={discountMode === "fixed" ? "active" : ""} onClick={() => setDiscountMode("fixed")}>Sabit tutar</button></div>
            <label className="waiter-note-field">{discountMode === "percentage" ? "İndirim oranı (%)" : "İndirim tutarı (₺)"}<input className="waiter-discount-input" type="number" min="0.01" max={discountMode === "percentage" ? 100 : (adjustmentCheck?.totalMinor ?? 0) / 100} step={discountMode === "percentage" ? 1 : 0.01} value={discountValue} onChange={(event) => setDiscountValue(Math.max(0, Number(event.target.value) || 0))} /></label>
            <label className="waiter-note-field">İndirim gerekçesi<select className="waiter-action-select" value={discountReason} onChange={(event) => setDiscountReason(event.target.value)}><option value="">Gerekçe seçin</option><option value="Kampanya">Kampanya</option><option value="Hizmet telafisi">Hizmet telafisi</option><option value="İşletme kararı">İşletme kararı</option><option value="other">Diğer</option></select></label>
            {discountReason === "other" && <label className="waiter-note-field">Açıklama<input className="waiter-discount-input" value={discountReasonNote} maxLength={500} onChange={(event) => setDiscountReasonNote(event.target.value)} placeholder="İndirim nedenini yazın" /></label>}
            <div className="waiter-discount-preview"><span>Uygulanacak indirim</span><strong>{money(Math.min(adjustmentCheck?.totalMinor ?? 0, Math.round(discountMode === "percentage" ? (adjustmentCheck?.totalMinor ?? 0) * discountValue / 100 : discountValue * 100)))}</strong></div>
            {adjustmentCheck && <div className="waiter-adjustment-preview"><span>İşlem sonrası hesap</span><strong>{money(Math.max(0, adjustmentCheck.totalMinor - Math.min(adjustmentCheck.totalMinor, Math.round(discountMode === "percentage" ? adjustmentCheck.totalMinor * discountValue / 100 : discountValue * 100))))}</strong></div>}
          </>}
          {adjustmentTab === "line" && <>
            <div className="waiter-adjustment-lines">{(adjustmentCheck?.orders.flatMap((order) => order.items) ?? []).map((line) => {
              const key = String(line.id); const adjustment = lineAdjustments[key];
              return <article key={key}><div><strong>{line.quantity} × {line.productName}</strong><small>{money(line.quantity * line.unitPriceMinor)}</small></div><div className="waiter-adjustment-line-buttons"><button className={adjustment?.action === "comp" ? "active" : ""} onClick={() => setLineAdjustments({ [key]: { action: "comp", reason: adjustment?.reason ?? "", quantity: adjustment?.quantity ?? 1 } })}>İkram</button><button className={adjustment?.action === "void" ? "active danger" : ""} onClick={() => setLineAdjustments({ [key]: { action: "void", reason: adjustment?.reason ?? "", quantity: adjustment?.quantity ?? 1 } })}>İptal</button>{adjustment && <button className="clear" onClick={() => setLineAdjustments({})}>Kaldır</button>}</div>{adjustment && <><label className="waiter-note-field">Adet<input className="waiter-discount-input" aria-label={`${line.productName} adet`} type="number" min="1" max={line.quantity} value={adjustment.quantity} onChange={(event) => setLineAdjustments({ [key]: { ...adjustment, quantity: Math.max(1, Math.min(line.quantity, Number(event.target.value) || 1)) } })} /></label><label className="waiter-note-field">Gerekçe<select className="waiter-action-select" aria-label={`${line.productName} işlem gerekçesi`} value={adjustment.reason} onChange={(event) => setLineAdjustments({ [key]: { ...adjustment, reason: event.target.value } })}><option value="">Gerekçe seçin</option><option value="Müşteri vazgeçti">Müşteri vazgeçti</option><option value="Yanlış sipariş">Yanlış sipariş</option><option value="Kalite / soğuk şikayeti">Kalite / soğuk şikayeti</option><option value="İşletme kararı">İşletme kararı</option></select></label></>}</article>;
            })}</div>
          </>}
          <label className="waiter-note-field">Yönetici PIN Onayı <small>(Müdür / Patron PIN kodu, örn. 9999)</small>
            <input
              className="waiter-discount-input"
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="••••"
              value={adjustmentManagerPin}
              onChange={(event) => setAdjustmentManagerPin(event.target.value)}
              disabled={operationSaving}
            />
          </label>
          <div className="waiter-adjustment-dev-note">İndirim, ikram ve iptal işlemleri için yetkili yönetici onayı gereklidir. Onaylayan yetkili denetim günlüğüne kaydedilir.</div>
          {adjustmentCheck?.payments.length ? <p className="ops-error">Ödeme girişimi olan adisyona indirim veya ikram uygulanamaz.</p> : null}
          <footer><button className="waiter-cancel-custom" disabled={operationSaving} onClick={() => setTableAction(null)}>Vazgeç</button><button className="ops-primary" disabled={operationSaving || !adjustmentCheck || adjustmentCheck.payments.length > 0 || (adjustmentTab === "discount" && (!discountReason || discountReason === "other" && !discountReasonNote.trim())) || (adjustmentTab === "line" && !Object.values(lineAdjustments).some((item) => item.reason && item.quantity > 0))} onClick={() => void submitAdjustment()}>{operationSaving ? "Kaydediliyor…" : "İşlemi uygula"}</button></footer>
        </>}
        {operationError && <p className="ops-error" role="alert">{operationError}</p>}
      </section></div>}
    </section>}
    <footer className="ops-footer">{lastUpdated ? `Son güncelleme ${lastUpdated.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}.` : "Masa bilgileri sunucudan alınır."}</footer>
  </main>;
}

function playKitchenChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.frequency.setValueAtTime(880, now + 0.15);
    gain2.gain.setValueAtTime(0.25, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.55);
  } catch {
    // AudioContext silently ignored if blocked by autoplay policy
  }
}

export function KitchenApp() {
  const terminalScope = useTerminalScope();
  const { firmId, branchId } = terminalScope;
  const [kitchenSession, setKitchenSession] = useState<PosSession | null>(() =>
    getPosSession("kitchen")
  );

  useEffect(() => {
    const sync = () => setKitchenSession(getPosSession("kitchen"));
    window.addEventListener(POS_AUTH_CHANGED_EVENT, sync);
    return () => window.removeEventListener(POS_AUTH_CHANGED_EVENT, sync);
  }, []);

  const [tasks, setTasks] = useState<KitchenTask[]>([]);
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [stationFilter, setStationFilter] = useState("all");
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [savingTaskId, setSavingTaskId] = useState("");
  const { syncStatus, localReachable, flushing: syncFlushing, triggerFlush: triggerSyncFlush } = useBranchSyncStatus(
    firmId,
    branchId,
    Boolean(kitchenSession),
    "pos-single"
  );
  const [kitchenToast, setKitchenToast] = useState<{ title: string; subtitle?: string; icon?: string } | null>(null);
  const kitchenToastTimer = useRef<number | null>(null);

  function showKitchenToast(title: string, subtitle?: string, icon: string = "🖨️") {
    if (kitchenToastTimer.current) window.clearTimeout(kitchenToastTimer.current);
    setKitchenToast({ title, subtitle, icon });
    kitchenToastTimer.current = window.setTimeout(() => {
      setKitchenToast(null);
    }, 2200);
  }

  async function printKitchenOrderDirect(task: KitchenTask) {
    try {
      const res = await request<{ success: boolean; target: string; transportUsed: string }>(
        `/api/v1/firms/${firmId}/branches/${branchId}/sales/orders/${encodeURIComponent(task.orderId)}/print-kitchen?isReprint=true`,
        "manager-single",
        {}
      );
      showKitchenToast("Mutfak Fişi Yazıcıya İletildi", `${task.tableName ?? "Sipariş"} (${res.transportUsed})`, "🖨️");
    } catch (cause) {
      showKitchenToast("Yazıcıya Ulaşılamadı", cause instanceof Error ? cause.message : "Mutfak yazıcısı hatası", "⚠️");
    }
  }
  const load = useCallback(async () => {
    try {
      const [result, stationResult] = await Promise.all([
        request<{ items: KitchenTask[] }>(`/api/v1/firms/${firmId}/branches/${branchId}/kitchen/tasks?status=all`, "manager-single"),
        request<{ items: KitchenStation[] }>(`/api/v1/firms/${firmId}/branches/${branchId}/kitchen/stations`, "manager-single"),
      ]);
      setTasks(result.items); setStations(stationResult.items);
      setError(""); setLastRefresh(new Date());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Mutfak kuyruğu alınamadı."); }
  }, [firmId, branchId]);
  useEffect(() => {
    if (!kitchenSession) return;
    void load();
  }, [kitchenSession, load]);

  // 1. SSE ile anlık sipariş ve mutfak akışı
  useRestaurantRealtime(
    useCallback(
      (evt) => {
        if (
          evt.type === "order.created" ||
          evt.type === "kitchen.updated" ||
          evt.type === "check.cancelled" ||
          evt.type === "check.closed"
        ) {
          console.log("⚡ [KitchenApp] Anlık mutfak siparişi tetiklendi:", evt.type);
          if (evt.type === "order.created") {
            playKitchenChime();
          }
          void load();
        }
      },
      [load]
    ),
    Boolean(kitchenSession),
    kitchenSession?.token
  );

  // 2. Yedek periyodik kontrol
  useEffect(() => {
    if (!kitchenSession) return;
    const timer = window.setInterval(() => { void load(); }, 15000);
    return () => window.clearInterval(timer);
  }, [kitchenSession, load]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);

  type KitchenGroup = {
    key: string;
    orderId: string;
    stationCode: string;
    stationName: string;
    isFood: boolean;
    isDrink: boolean;
    tableName?: string;
    waiterName?: string;
    submittedAt: string;
    tasks: KitchenTask[];
  };

  const isFoodTask = (task: KitchenTask) => task.stationCode === "food" || ["oven", "hot", "cold"].includes(task.stationCode);
  const isDrinkTask = (task: KitchenTask) => task.stationCode === "drink" || task.stationCode === "bar";

  function groupTasks(taskList: KitchenTask[]): KitchenGroup[] {
    const map = new Map<string, KitchenGroup>();
    for (const task of taskList) {
      const isFood = isFoodTask(task);
      const isDrink = isDrinkTask(task);
      const groupStation = isFood ? "food" : isDrink ? "drink" : (task.stationCode || "unassigned");
      const key = `${task.orderId}::${groupStation}`;

      const existing = map.get(key);
      if (existing) {
        existing.tasks.push(task);
        if (new Date(task.submittedAt).getTime() < new Date(existing.submittedAt).getTime()) {
          existing.submittedAt = task.submittedAt;
        }
      } else {
        map.set(key, {
          key,
          orderId: task.orderId,
          stationCode: task.stationCode,
          stationName: isFood ? "🍕 YİYECEK" : isDrink ? "🥤 İÇECEK" : (task.stationName || "DİĞER"),
          isFood,
          isDrink,
          tableName: task.tableName,
          waiterName: task.waiterName,
          submittedAt: task.submittedAt,
          tasks: [task],
        });
      }
    }
    return Array.from(map.values());
  }

  function taskAge(submittedAt: string) {
    const minutes = Math.max(0, Math.floor((now - new Date(submittedAt).getTime()) / 60_000));
    return { minutes, level: minutes >= 20 ? "late" : minutes >= 10 ? "warning" : "normal" };
  }

  async function changeGroupStatus(group: KitchenGroup) {
    const hasSubmitted = group.tasks.some((t) => t.status === "submitted");
    const hasPreparing = group.tasks.some((t) => t.status === "preparing");
    const nextStatus: "preparing" | "ready" | "served" = hasSubmitted ? "preparing" : hasPreparing ? "ready" : "served";

    const targetTasks = group.tasks.filter((t) => {
      if (nextStatus === "preparing") return t.status === "submitted";
      if (nextStatus === "ready") return t.status === "preparing";
      if (nextStatus === "served") return t.status === "ready";
      return false;
    });

    if (targetTasks.length === 0) return;

    setSavingTaskId(group.key);
    setError("");
    try {
      await Promise.all(
        targetTasks.map((t) =>
          request(`/api/v1/firms/${firmId}/branches/${branchId}/kitchen/tasks/${t.id}/status`, "manager-single", {
            requestId: createRequestId(),
            nextStatus,
            expectedVersion: t.version,
          })
        )
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Görev durumları güncellenemedi.");
    } finally {
      setSavingTaskId("");
    }
  }

  const foodTasks = tasks.filter(isFoodTask);
  const drinkTasks = tasks.filter(isDrinkTask);
  const unassignedTasks = tasks.filter((t) => !isFoodTask(t) && !isDrinkTask(t));

  const activeFoodTasks = foodTasks.filter((task) => task.status === "submitted" || task.status === "preparing");
  const activeDrinkTasks = drinkTasks.filter((task) => task.status === "submitted" || task.status === "preparing");
  const activeUnassignedTasks = unassignedTasks.filter((task) => task.status === "submitted" || task.status === "preparing");

  const activeFoodGroups = groupTasks(activeFoodTasks);
  const activeDrinkGroups = groupTasks(activeDrinkTasks);
  const activeUnassignedGroups = groupTasks(activeUnassignedTasks);

  const totalActive = activeFoodGroups.length + activeDrinkGroups.length + activeUnassignedGroups.length;

  const visibleTasks = tasks.filter((task) => stationFilter === "all" || (stationFilter === "food" && isFoodTask(task)) || (stationFilter === "drink" && isDrinkTask(task)) || task.stationCode === stationFilter);
  const activeVisibleTasks = visibleTasks.filter((task) => task.status === "submitted" || task.status === "preparing");
  const activeVisibleGroups = groupTasks(activeVisibleTasks);

  const readyTasks = visibleTasks.filter((task) => task.status === "ready");
  const readyGroups = groupTasks(readyTasks);
  const cancelledTasks = visibleTasks.filter((task) => task.status === "cancelled").slice(-6).reverse();
  const servedTasks = visibleTasks.filter((task) => task.status === "served").slice(-8).reverse();
  const servedGroups = groupTasks(servedTasks);

  function printTicket(task: KitchenTask) {
    const isFood = isFoodTask(task);
    const isDrink = isDrinkTask(task);
    const printItems = tasks.filter((item) => {
      if (item.orderId !== task.orderId || item.status === "cancelled") return false;
      if (isFood) return isFoodTask(item);
      if (isDrink) return isDrinkTask(item);
      return item.stationCode === task.stationCode;
    });
    return <div className="kitchen-print-ticket">
      <div className="kitchen-print-double-rule" />
      <h1>MUTFAK SİPARİŞİ</h1>
      <div className="kitchen-print-double-rule" />
      <div className="kitchen-print-meta">
        <div><b>Masa:</b><span>{task.tableName ?? "—"}</span></div>
        <div><b>Saat:</b><span>{new Date(task.submittedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div>
        <div><b>Garson:</b><span>{task.waiterName ?? "—"}</span></div>
        <div><b>Fiş No:</b><span>#{task.orderId.slice(0, 8).toUpperCase()}</span></div>
      </div>
      <div className="kitchen-print-rule" />
      <div className="kitchen-print-columns"><b>Adet</b><b>Ürün</b><b>Not</b></div>
      <div className="kitchen-print-rule" />
      <div className="kitchen-print-items">{printItems.map((item) => <div className="kitchen-print-item" key={item.id}>
        <strong>{item.quantity}x</strong><span>{item.productName}</span><span>{item.notes ?? "—"}</span>
      </div>)}</div>
      <div className="kitchen-print-double-rule" />
      <p className="kitchen-print-device-line">[BİP SESİ] - [OTOMATİK KAĞIT KESME]</p>
    </div>;
  }

  function ticketCard(group: KitchenGroup, ready = false) {
    const age = taskAge(group.submittedAt);
    const isSaving = savingTaskId === group.key;
    const hasSubmitted = group.tasks.some((t) => t.status === "submitted");
    const hasPreparing = group.tasks.some((t) => t.status === "preparing");
    const isReady = !hasSubmitted && !hasPreparing;
    const statusText = hasSubmitted && !hasPreparing ? "BEKLİYOR" : hasPreparing && !hasSubmitted ? "HAZIRLANIYOR" : hasSubmitted ? "KISMİ HAZIRLIK" : "SERVİSE HAZIR";
    const actionLabel = hasSubmitted ? "Hazırlamaya başla" : hasPreparing ? "Hazır" : "Servis edildi";
    const firstTask = group.tasks[0]!;

    return <article
      className={`kitchen-ticket ${ready || isReady ? "kitchen-ready" : `kitchen-${age.level}`}`}
      key={group.key}
    >
      <div className="kitchen-screen-ticket-content">
        <header>
          <div>
            <span>{group.tableName ?? "MASA SİPARİŞİ"}{group.waiterName ? ` · ${group.waiterName}` : ""}</span>
            <h2>{group.orderId.slice(0, 8).toUpperCase()}</h2>
          </div>
          <time>{new Date(group.submittedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</time>
        </header>
        <div className={`kitchen-station-label ${group.isFood ? "station-food" : group.isDrink ? "station-drink" : ""}`}>
          {group.stationName}
        </div>
        <div className="kitchen-ticket-status">
          <b>{statusText}</b>
          <span>{age.minutes} dk</span>
        </div>
        <ul>
          {group.tasks.map((task) => (
            <li key={task.id}>
              <strong>{task.quantity}×</strong>
              <span>
                {task.productName}
                {task.notes && <small style={{ display: "block", color: "#6b7280", marginTop: "2px" }}>· {task.notes}</small>}
              </span>
            </li>
          ))}
        </ul>
        <div className="kitchen-actions">
          <button
            className="kitchen-status-button"
            disabled={isSaving}
            onClick={() => void changeGroupStatus(group)}
          >
            {isSaving ? "Kaydediliyor…" : actionLabel}
          </button>
          <button className="kitchen-print-button" onClick={() => void printKitchenOrderDirect(firstTask)}>Fiş yazdır</button>
        </div>
      </div>
      <div aria-hidden="true">{printTicket(firstTask)}</div>
    </article>;
  }

  if (!kitchenSession) {
    return (
      <PinPadModal
        title="Mutfak KDS Girişi"
        appKind="kitchen"
        allowedRoles={["chef", "kitchen", "owner", "manager", "waiter"]}
        subtitle="Mutfak ekranını açmak için 4 haneli PIN kodunuzu tuşlayın"
        onSuccess={(data) => {
          savePosSession("kitchen", data);
          setKitchenSession(data);
        }}
      />
    );
  }

  return <main className="ops-shell kitchen-shell">
    <header className="ops-header">
      <a href={buildPosTerminalHref("/kitchen", terminalScope)} className="ops-brand">HIPOS <span>MUTFAK</span></a>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <SyncStatusPill
          syncStatus={syncStatus}
          localReachable={localReachable}
          apiOffline={Boolean(error)}
          flushing={syncFlushing}
          onTrigger={() => void triggerSyncFlush()}
        />
        <a className="ops-link" href={buildPosTerminalHref("/waiter", terminalScope)}>Garson ekranı</a>
        <button
          onClick={() => {
            clearPosSession("kitchen");
            setKitchenSession(null);
          }}
          style={{
            padding: "0.25rem 0.6rem",
            fontSize: "0.75rem",
            borderRadius: "9999px",
            backgroundColor: "rgba(239, 68, 68, 0.15)",
            color: "#ef4444",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            cursor: "pointer"
          }}
        >
          Ekranı Kilitle
        </button>
      </div>
    </header>
    <section className="ops-intro"><span className="ops-eyebrow">SİPARİŞ KUYRUĞU</span><h1>Mutfak fişleri</h1><p>Yeni garson siparişleri yerel sunucudan otomatik olarak yenilenir.</p></section>
    <div className="kitchen-toolbar"><span className={error ? "offline-dot" : "online-dot"} />{error ? "Sunucuya ulaşılamıyor" : `Bağlı · son yenileme ${lastRefresh?.toLocaleTimeString("tr-TR") ?? "—"}`}<button onClick={() => void load()}>Yenile</button></div>
    <nav className="kitchen-filters" aria-label="Mutfak istasyonları">
      <button className={stationFilter === "all" ? "active" : ""} onClick={() => setStationFilter("all")}>İkili Ekran ({totalActive})</button>
      {stations.length > 0 ? (
        stations.map((station) => {
          const isFood = station.code === "food";
          const isDrink = station.code === "drink";
          const count = isFood ? activeFoodGroups.length : isDrink ? activeDrinkGroups.length : groupTasks(tasks.filter((t) => t.stationCode === station.code && (t.status === "submitted" || t.status === "preparing"))).length;
          return (
            <button
              key={station.id}
              className={stationFilter === station.code ? "active" : ""}
              onClick={() => setStationFilter(station.code)}
            >
              {isFood ? "🍕 " : isDrink ? "🥤 " : ""}{station.name} ({count})
            </button>
          );
        })
      ) : (
        <>
          <button className={stationFilter === "food" ? "active" : ""} onClick={() => setStationFilter("food")}>🍕 Yiyecek ({activeFoodGroups.length})</button>
          <button className={stationFilter === "drink" ? "active" : ""} onClick={() => setStationFilter("drink")}>🥤 İçecek ({activeDrinkGroups.length})</button>
        </>
      )}
      {activeUnassignedGroups.length > 0 && <button className={stationFilter === "unassigned" ? "active" : ""} onClick={() => setStationFilter("unassigned")}>Atanmamış ({activeUnassignedGroups.length})</button>}
    </nav>
    {error && <p className="ops-error" role="alert">{error}</p>}
    {stationFilter === "all" ? (
      <div className="kitchen-split-container">
        <section className="kitchen-column kitchen-food-column">
          <header className="kitchen-column-header">
            <div className="kitchen-column-title">
              <span className="kitchen-column-icon">🍕</span>
              <h2>YİYECEK SİPARİŞLERİ</h2>
            </div>
            <span className="kitchen-column-badge">{activeFoodGroups.length}</span>
          </header>
          {activeFoodGroups.length === 0 ? (
            <div className="kitchen-empty kitchen-column-empty">Bekleyen yiyecek siparişi yok.</div>
          ) : (
            <div className="kitchen-grid">{activeFoodGroups.map((group) => ticketCard(group))}</div>
          )}
        </section>

        <section className="kitchen-column kitchen-drink-column">
          <header className="kitchen-column-header">
            <div className="kitchen-column-title">
              <span className="kitchen-column-icon">🥤</span>
              <h2>İÇECEK SİPARİŞLERİ</h2>
            </div>
            <span className="kitchen-column-badge">{activeDrinkGroups.length}</span>
          </header>
          {activeDrinkGroups.length === 0 ? (
            <div className="kitchen-empty kitchen-column-empty">Bekleyen içecek siparişi yok.</div>
          ) : (
            <div className="kitchen-grid">{activeDrinkGroups.map((group) => ticketCard(group))}</div>
          )}
        </section>
      </div>
    ) : (
      <section className="kitchen-column kitchen-column-single">
        <header className="kitchen-column-header">
          <div className="kitchen-column-title">
            <span className="kitchen-column-icon">{stationFilter === "food" ? "🍕" : stationFilter === "drink" ? "🥤" : "📋"}</span>
            <h2>{stationFilter === "food" ? "YİYECEK SİPARİŞLERİ" : stationFilter === "drink" ? "İÇECEK SİPARİŞLERİ" : "ATANMAMIŞ SİPARİŞLER"}</h2>
          </div>
          <span className="kitchen-column-badge">{activeVisibleGroups.length}</span>
        </header>
        {activeVisibleGroups.length === 0 ? (
          <div className="kitchen-empty">Aktif sipariş bulunmuyor.</div>
        ) : (
          <div className="kitchen-grid">{activeVisibleGroups.map((group) => ticketCard(group))}</div>
        )}
      </section>
    )}
    {stationFilter === "all" && activeUnassignedGroups.length > 0 && (
      <section className="kitchen-section">
        <div className="kitchen-section-title"><span>DİĞER / ATANMAMIŞ SİPARİŞLER</span><b>{activeUnassignedGroups.length}</b></div>
        <div className="kitchen-grid">{activeUnassignedGroups.map((group) => ticketCard(group))}</div>
      </section>
    )}
    {readyGroups.length > 0 && <section className="kitchen-section"><div className="kitchen-section-title"><span>SERVİSE HAZIR</span><b>{readyGroups.length}</b></div><div className="kitchen-grid">{readyGroups.map((group) => ticketCard(group, true))}</div></section>}
    {servedGroups.length > 0 && (
      <section className="kitchen-section kitchen-served" style={{ marginTop: "24px", opacity: 0.85 }}>
        <div className="kitchen-section-title"><span>✅ SON SERVİS EDİLENLER (TAMAMLANANLAR)</span><b>{servedGroups.length}</b></div>
        <div className="kitchen-grid">
          {servedGroups.map((group) => (
            <article key={group.key} className="kitchen-ticket kitchen-ticket-served" style={{ borderColor: "#10b981", background: "#f0fdf4" }}>
              <div className="kitchen-screen-ticket-content">
                <header>
                  <div>
                    <span>{group.tableName ?? "MASA SİPARİŞİ"}{group.waiterName ? ` · ${group.waiterName}` : ""}</span>
                    <h2>{group.orderId.slice(0, 8).toUpperCase()}</h2>
                  </div>
                  <time style={{ color: "#059669", fontWeight: "bold" }}>TAMAMLANDI</time>
                </header>
                <div className="kitchen-station-label" style={{ background: "#d1fae5", color: "#065f46" }}>
                  {group.stationName}
                </div>
                <ul>
                  {group.tasks.map((task) => (
                    <li key={task.id}>
                      <strong>{task.quantity}×</strong>
                      <span>{task.productName}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>
    )}
    {cancelledTasks.length > 0 && <section className="kitchen-section kitchen-cancelled"><div className="kitchen-section-title"><span>İPTAL EDİLENLER</span><b>{cancelledTasks.length}</b></div><ul>{cancelledTasks.map((task) => <li key={task.id}><span><strong>{task.quantity}× {task.productName}</strong><small>{task.tableName ?? task.orderId.slice(0, 8).toUpperCase()} · {task.cancellationReason}</small></span><time>{task.cancelledAt ? new Date(task.cancelledAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "—"}</time></li>)}</ul></section>}
    {kitchenToast && (
      <div className="pos-smooth-toast" role="status">
        <span className="toast-icon">{kitchenToast.icon ?? "🖨️"}</span>
        <div className="toast-text">
          <strong>{kitchenToast.title}</strong>
          {kitchenToast.subtitle && <small>{kitchenToast.subtitle}</small>}
        </div>
      </div>
    )}
  </main>;
}

export function mountOperationalApp() {
  getTerminalScope();
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === "/waiter" || path === "/kitchen" || path === "/cashier") {
    try {
      localStorage.setItem("hipos_preferred_app", path.slice(1));
    } catch {}
    createRoot(document.getElementById("root")!).render(path === "/waiter" ? <WaiterApp /> : path === "/cashier" ? <CashierApp /> : <KitchenApp />);
    return true;
  }
  if (path === "") {
    try {
      const preferred = localStorage.getItem("hipos_preferred_app");
      if (preferred === "waiter" || preferred === "cashier" || preferred === "kitchen") {
        window.location.replace(`/${preferred}${window.location.search}`);
        return true;
      }
    } catch {}
  }
  return false;
}
