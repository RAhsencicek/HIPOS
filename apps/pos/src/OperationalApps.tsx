import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createRequestId } from "./requestId";
import "./operational.css";

const firmId = "11111111-1111-4111-8111-111111111111";
const branchId = "33333333-3333-4333-8333-333333333333";
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
const money = (minor: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(minor / 100);
type ApiProblem = { code?: string; detail?: string; message?: string };
type ApiRequestError = Error & { status?: number; code?: string };
type ProductOption = { groupName: string; optionName: string };
type CartLine = { cartId: string; productId: string; quantity: number; note: string; options: ProductOption[] };
type Product = { id: string; name: string; category: { id: string; name: string }; image: string; status: string; isActive: boolean; channels: string[]; price: { amountMinor: number; currency: string } };
type MenuSection = { sectionId: string; name: string; productIds: string[] };
type Waiter = { id: string; name: string; isActive: boolean };
type TableGroup = { id: string; primaryTableId: string; tableIds: string[]; tableNames: string[]; guestCount: number; version: number; closedAt: string | null };
type CheckAdjustment = { requestId?: string; action: "discount" | "comp" | "void"; valueType?: "percentage" | "fixed" | null; value?: number | null; orderLineId?: number | null; quantity: number; amountMinor: number; reason: string; actor?: string; approvalMode?: string; createdAt?: string };
type Table = { id: string; number: number; name: string; isActive: boolean; status?: "idle" | "occupied" | "bill_requested" | "reserved"; reservedFor?: string | null; reservationGuestName?: string | null; version?: number; group?: TableGroup | null; assignment?: {
  id: string; orderId: string; orderIds?: string[]; waiterId: string | null; waiterName: string | null; totalMinor: number;
  paymentStatus: string; version: number; grossTotalMinor: number; adjustmentMinor: number; adjustments: CheckAdjustment[];
  items: Array<{ productId: string; productName: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; orderLineId: number; note?: string | null; options?: ProductOption[] }>;
} | null };
type OpenCheck = { id: string; status: string; tableId: string | null; version: number; totalMinor: number; grossTotalMinor: number; adjustmentMinor: number; adjustments: CheckAdjustment[]; payments: unknown[]; orders: Array<{ id: string; items: Array<{ id: number; productName: string; quantity: number; unitPriceMinor: number }> }> };
type KitchenStatus = "pending" | "preparing" | "ready" | "served" | "cancelled";
type KitchenStatusItem = { id: string; orderId: string; productName: string; quantity: number; note?: string | null; status: KitchenStatus; statusChangedAt?: string | null };
type Order = { id: string; source: string; status: string; paymentStatus: string; totalMinor: number; createdAt: string; tableName?: string; waiterName?: string; items: Array<{ productName: string; quantity: number; lineTotalMinor?: number; note?: string | null; options?: ProductOption[]; status?: KitchenStatus; statusChangedAt?: string | null }>; kitchenItems?: Array<{ productId: string; productName: string; quantity: number; note?: string | null; options: ProductOption[]; status?: KitchenStatus; statusChangedAt?: string | null }> };
type ActiveTable = { name: string; group?: TableGroup | null; assignment?: { orderId: string; orderIds?: string[]; waiterName: string | null } | null };

async function request<T>(path: string, actor: string, body?: unknown): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    response = await fetch(`${apiBase}${path}`, { method: body ? "POST" : "GET", signal: controller.signal,
      headers: { "X-Demo-Actor": actor, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch {
    if (controller.signal.aborted)
      throw new Error("Sunucu 15 saniyede yanıt vermedi. Sipariş kaydedilmiş olabilir; yeniden deneyin, aynı sipariş kimliği kullanılacak.");
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

const servicePath = `/api/v1/firms/${firmId}/branches/${branchId}/service`;
const ordersPath = `/api/v1/firms/${firmId}/sales/orders?branchId=${branchId}`;
const checksPath = `/api/v1/firms/${firmId}/branches/${branchId}/sales/checks`;
const demoProducts: Product[] = [
  { id: "55555555-5555-4555-8555-555555555502", name: "Tavuklu Sandviç", category: { id: "main", name: "Ana Yemekler" }, image: "🥪", status: "published", isActive: true, channels: ["pos"], price: { amountMinor: 26000, currency: "TRY" } },
  { id: "55555555-5555-4555-8555-555555555501", name: "Margherita Pizza", category: { id: "pizza", name: "Pizzalar" }, image: "🍕", status: "published", isActive: true, channels: ["pos"], price: { amountMinor: 32000, currency: "TRY" } },
  { id: "55555555-5555-4555-8555-555555555506", name: "Karışık Pizza", category: { id: "pizza", name: "Pizzalar" }, image: "🍕", status: "published", isActive: true, channels: ["pos"], price: { amountMinor: 41000, currency: "TRY" } },
  { id: "55555555-5555-4555-8555-555555555504", name: "Filtre Kahve", category: { id: "drinks", name: "İçecekler" }, image: "☕", status: "published", isActive: true, channels: ["pos"], price: { amountMinor: 12000, currency: "TRY" } },
  { id: "55555555-5555-4555-8555-555555555505", name: "Ev Yapımı Limonata", category: { id: "drinks", name: "İçecekler" }, image: "🍋", status: "published", isActive: true, channels: ["pos"], price: { amountMinor: 12500, currency: "TRY" } },
  { id: "55555555-5555-4555-8555-555555555503", name: "San Sebastian Cheesecake", category: { id: "dessert", name: "Tatlılar" }, image: "🍰", status: "published", isActive: true, channels: ["pos"], price: { amountMinor: 22000, currency: "TRY" } },
];
const demoMenuSections: MenuSection[] = ["main", "pizza", "drinks", "dessert"].map((categoryId) => {
  const categoryProducts = demoProducts.filter((product) => product.category.id === categoryId);
  return { sectionId: categoryId, name: categoryProducts[0].category.name, productIds: categoryProducts.map((product) => product.id) };
});
const demoDescriptions: Record<string, string> = {
  "55555555-5555-4555-8555-555555555501": "Domates sosu, mozzarella ve fesleğen.",
  "55555555-5555-4555-8555-555555555502": "Tavuk ve taze sebzeli sandviç.",
  "55555555-5555-4555-8555-555555555503": "Fırınlanmış cheesecake dilimi.",
  "55555555-5555-4555-8555-555555555504": "Taze çekilmiş kahveden hazırlanır.",
  "55555555-5555-4555-8555-555555555505": "Limon ve şekerle hazırlanır.",
  "55555555-5555-4555-8555-555555555506": "Karışık malzemeli, fırından yeni çıkmış pizza.",
};
const demoCustomizations: Record<string, { groupName: string; choices: string[] }[]> = {
  "55555555-5555-4555-8555-555555555501": [{ groupName: "Pişirme tercihi", choices: ["Normal", "Az pişmiş", "İyi pişmiş"] }, { groupName: "Hazırlama", choices: ["Soğansız", "Glutensiz taban"] }],
  "55555555-5555-4555-8555-555555555502": [{ groupName: "Hazırlama", choices: ["Soğansız", "Acısız", "Sosu ayrı"] }],
  "55555555-5555-4555-8555-555555555506": [{ groupName: "Pişirme tercihi", choices: ["Normal", "Az pişmiş", "İyi pişmiş"] }, { groupName: "Hazırlama", choices: ["Soğansız", "Acısız"] }],
};

export function WaiterApp() {
  const [products, setProducts] = useState<Product[]>([]);
  const [menuSections, setMenuSections] = useState<MenuSection[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [kitchenItems, setKitchenItems] = useState<KitchenStatusItem[]>([]);
  const [kitchenNotice, setKitchenNotice] = useState("");
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [tableId, setTableId] = useState("");
  const [waiterId, setWaiterId] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);
  const [editingCartId, setEditingCartId] = useState<string | null>(null);
  const [customOptions, setCustomOptions] = useState<Record<string, string>>({});
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
      const [tableResult, waiterResult, checkResult, ordersResult] = await Promise.all([
        request<{ items: Table[] }>(`${servicePath}/tables`, "pos-single"),
        request<{ items: Waiter[] }>(`${servicePath}/waiters`, "pos-single"),
        tableId && (tableAction === "split" || tableAction === "discount")
          ? request<{ items: OpenCheck[] }>(`${checksPath}?tableId=${encodeURIComponent(tableId)}`, "pos-single")
          : Promise.resolve(null),
        tableId ? request<{ items: Order[] }>(ordersPath, "pos-single") : Promise.resolve(null),
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
      setProducts(demoProducts);
      setMenuSections(demoMenuSections);
      setTables(updated);
      setWaiters(waiterResult.items.filter((item) => item.isActive));
      setConnectionState("connected");
      setLastUpdated(new Date());
      setError("");
    } catch (cause) {
      if (serial !== reloadSerial.current) return;
      setConnectionState("unavailable");
      setError(cause instanceof Error ? cause.message : "Veriler yüklenemedi.");
    }
    finally { if (serial === reloadSerial.current) setLoading(false); }
  }, [tableAction, tableId]);
  useEffect(() => { void reload(); }, [reload, refreshTick, tableId]);
  useEffect(() => {
    if (tableStatusSaving || saving || operationSaving) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [tableStatusSaving, saving, operationSaving, reload]);

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
  const cartRows = useMemo(() => cart.flatMap((line) => {
    const product = products.find((item) => item.id === line.productId);
    return product ? [{ ...product, ...line }] : [];
  }), [products, cart]);
  const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR");
  const catalogGroups = normalizedSearch
    ? [{ sectionId: "search-results", name: "Arama sonuçları", products: products.filter((product) => product.name.toLocaleLowerCase("tr-TR").includes(normalizedSearch)) }]
    : menuSections.map((section) => ({ ...section, products: products.filter((product) => section.productIds.includes(product.id)) }));
  const total = cartRows.reduce((sum, item) => sum + item.price.amountMinor * item.quantity, 0);
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
    setCustomizingProduct(product); setEditingCartId(line?.cartId ?? null);
    setCustomOptions(Object.fromEntries((line?.options ?? []).map((option) => [option.groupName, option.optionName])));
    setCustomNote(line?.note ?? "");
  }
  function closeCustomization() {
    setCustomizingProduct(null); setEditingCartId(null);
  }
  function saveCustomizedProduct() {
    if (!customizingProduct || saving) return;
    const options = Object.entries(customOptions).map(([groupName, optionName]) => ({ groupName, optionName }));
    if (editingCartId) {
      setCart((current) => current.map((line) => line.cartId === editingCartId ? { ...line, note: customNote.trim(), options } : line));
    } else {
      setCart((current) => [...current, { cartId: createRequestId(), productId: customizingProduct.id, quantity: 1, note: customNote.trim(), options }]);
    }
    setRetryOrderId(null); closeCustomization();
  }

  async function sendOrder() {
    if (!selectedTable || !waiter || cartRows.length === 0 || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const orderId = retryOrderId ?? createRequestId();
      setRetryOrderId(orderId);
      const result = await request<{ order: { id: string }; table: string; waiter: string }>(
        `${servicePath}/tables/${encodeURIComponent(selectedTable.id)}/orders`, "pos-single",
        { orderId, waiterId: waiter.id, items: cartRows.map((item) => ({ productId: item.id, quantity: item.quantity, note: item.note || null, options: item.options })) });
      setCart([]); setRetryOrderId(null); setLastOrderId(result.order.id);
      setNotice(`${result.table} siparişi yönetim ekranına gönderildi. Mutfak kuyruğuna eklendi.`);
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
    setLineAdjustments({}); setTableAction("discount"); setOperationSaving(true);
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
        { requestId, expectedVersion: check.version, action, valueType, value, orderLineId, quantity, reason });
      operationRequest.current = null;
      setOpenChecks((current) => current.map((item) => item.id === result.check.id ? result.check : item));
      setTableAction(null); setRefreshTick((tick) => tick + 1);
      const actionLabel = action === "discount" ? "İndirim" : action === "comp" ? "İkram" : "Ürün iptali";
      setTableActionNotice(`${actionLabel} (${money(result.adjustment.amountMinor)}) gerekçesiyle kaydedildi. Geliştirme ortamında yönetici onayı olmadan uygulandı.`);
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

  return <main className="ops-shell waiter-shell">
    <header className="ops-header"><a href="/waiter" className="ops-brand waiter-brand"><img src="/hipos-logo.png" alt="HIPOS" /><span>GARSON</span></a><div className="waiter-header-actions">{selectedTable && <button className="waiter-back" onClick={() => { setTableId(""); setCart([]); setNotice(""); setError(""); setRetryOrderId(null); }}>← Masalara dön</button>}<span className={`waiter-connection ${connectionState}`}><i />{connectionState === "connected" ? "Bağlı" : connectionState === "checking" ? "Bağlanıyor" : "Veri alınamıyor"}</span></div></header>
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
    <section className="waiter-table-grid" aria-label="Masa listesi">{tables.map((item) => {
      const status = getTableStatus(item);
      const visualStatus = status === "bill_requested" ? "bill-requested" : item.group ? "grouped" : status === "reserved" ? "reserved" : status === "occupied" ? "occupied" : "empty";
      const statusLabel = status === "bill_requested" ? "Hesap istendi" : item.group ? "Grupta" : status === "reserved" ? "Rezerve" : status === "occupied" ? "Dolu" : "Boş";
      return <button type="button" className={`waiter-table-card ${visualStatus}`} key={item.id} onClick={() => { setTableId(item.group?.primaryTableId ?? item.id); setCart([]); setNotice(""); setTableActionNotice(""); setDetailSyncNotice(""); setTableStatusError(""); setReservationDate(item.reservedFor ? new Date(new Date(item.reservedFor).getTime() - new Date(item.reservedFor).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : ""); setRetryOrderId(null); }}>
      <svg className="waiter-table-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="6" width="14" height="12" rx="3" /><path d="M9 3h6M9 21h6M2 10v4M22 10v4" /></svg><strong>{item.name}</strong><span className="waiter-table-status">{statusLabel}</span>
      {item.group && <small className="waiter-group-card-label">{item.group.tableIds.length} masa · {item.group.guestCount} kişi<br />Ana masa: {item.group.tableNames[0]}</small>}
      {item.assignment && <><span className="waiter-table-owner">{item.assignment.waiterName ?? "Açık adisyon"}</span><b>{money(item.assignment.totalMinor)}</b></>}
      {status === "reserved" && item.reservedFor && <small className="waiter-reserved-time">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.reservedFor))}</small>}
    </button>;
    })}</section></>}
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
    {selectedTable && <section className="waiter-order-page" aria-live="polite">
      <div className="waiter-order-heading"><div><span className="ops-eyebrow">MASA DETAYI</span><h1>{selectedTable.group ? selectedTable.group.tableNames.join(" + ") : selectedTable.name}</h1>{selectedTable.group && <p className="waiter-group-info">{selectedTable.group.guestCount} kişi · Ana masa: {selectedTable.name} · Ortak adisyon</p>}</div><span className={`waiter-table-status ${getTableStatus(selectedTable) === "bill_requested" ? "bill-requested" : getTableStatus(selectedTable) === "reserved" ? "reserved" : selectedTable.assignment || selectedTable.group ? "occupied" : "empty"}`}>{getTableStatus(selectedTable) === "bill_requested" ? "Hesap istendi" : selectedTable.group ? "Masa grubu" : getTableStatus(selectedTable) === "reserved" ? "Rezerve" : selectedTable.assignment ? "Dolu" : "Boş"}</span></div>
      {getTableStatus(selectedTable) === "reserved" && !selectedTable.assignment && <section className="waiter-reservation-summary" aria-label="Rezervasyon bilgisi"><div><strong>{selectedTable.reservationGuestName ?? "Masa rezerve"}</strong><span>{selectedTable.reservedFor ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "full", timeStyle: "short" }).format(new Date(selectedTable.reservedFor)) : "Rezervasyon saati belirtilmemiş"}</span></div><div className="waiter-state-actions"><button className="waiter-back" disabled={tableActionsBlocked} onClick={openReservation}>Düzenle</button><button className="waiter-state-danger" disabled={tableActionsBlocked} onClick={() => void updateTableStatus("reservation/cancel")}>{tableStatusSaving ? "Kaydediliyor…" : "Rezervasyonu kaldır"}</button></div></section>}
      {getTableStatus(selectedTable) !== "reserved" && <div className="waiter-context-toolbar">
        <label className="waiter-select waiter-order-waiter">Garson<select value={waiterId} onChange={(event) => { setWaiterId(event.target.value); setRetryOrderId(null); }}><option value="">Garson seçin</option>{waiters.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <div className="waiter-context-actions">
          {getTableStatus(selectedTable) === "idle" && !selectedTable.assignment && !selectedTable.group && <button className="waiter-quiet-action" disabled={tableActionsBlocked} onClick={openReservation}>Rezerve et</button>}
          {selectedTable.assignment && <button className={`waiter-status-action ${getTableStatus(selectedTable) === "bill_requested" ? "active" : ""}`} disabled={tableStatusSaving} onClick={() => void updateTableStatus(getTableStatus(selectedTable) === "bill_requested" ? "cancel-bill-request" : "request-bill")}>{tableStatusSaving ? "Kaydediliyor…" : getTableStatus(selectedTable) === "bill_requested" ? "Hesap isteğini kaldır" : "Hesap istendi"}</button>}
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
      {selectedKitchenItems.length > 0 && <section className="waiter-kitchen-status" aria-label="Mutfak durumu"><h2>Mutfak Durumu</h2><ul>{selectedKitchenItems.map((item) => <li key={item.id}>
        <span><strong>{item.quantity} × {item.productName}</strong>{item.note && <small>{item.note}</small>}</span>
        <span className={`waiter-kitchen-state ${item.status}`}>{item.status === "cancelled" ? "İptal bildirildi" : item.status === "pending" ? "Bekliyor" : item.status === "preparing" ? "Hazırlanıyor" : item.status === "ready" ? "Hazır" : "Servise çıktı"}</span>
      </li>)}</ul></section>}
      {selectedTable.assignment && <section className="waiter-table-actions" aria-labelledby="table-actions-title">
        <div className="waiter-actions-heading"><div><span className="ops-eyebrow">AÇIK ADİSYON</span><h2 id="table-actions-title">Masa İşlemleri</h2></div><span>{selectedTable.assignment.items.length} kalem</span></div>
        <div className="waiter-action-grid">
          <button disabled={tableActionsBlocked || Boolean(selectedTable.group)} onClick={() => openTableAction("transfer")}><span aria-hidden="true">⇄</span><strong>Masa Taşı</strong><small>Adisyonu boş masaya aktar</small></button>
          <button disabled={tableActionsBlocked || Boolean(selectedTable.group)} onClick={() => openTableAction("merge")}><span aria-hidden="true">⊕</span><strong>Masa Birleştir</strong><small>Başka masanın hesabını ekle</small></button>
          <button disabled={tableActionsBlocked} onClick={() => void openSplitAction()}><span aria-hidden="true">◫</span><strong>Adisyon Böl</strong><small>Ürünleri ayrı hesaba ayır</small></button>
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
      {getTableStatus(selectedTable) !== "reserved" && !waiter && <p className="ops-message">Sipariş eklemek için önce garson seçin.</p>}
      {assignedToOtherWaiter && <p className="ops-message">Bu masa {selectedTable.assignment?.waiterName ?? "başka bir garsona"} tarafından yönetiliyor. Sipariş eklemek için o garsonu seçin.</p>}
      {!loading && menuSections.length === 0 && !error && <p className="ops-message">Gösterilecek ürün kategorisi bulunamadı.</p>}
      {getTableStatus(selectedTable) !== "reserved" && waiter && !assignedToOtherWaiter && menuSections.length > 0 && <>
      <h2 className="waiter-catalog-title">Menü / Ürün kataloğu</h2>
      <label className="waiter-search"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ürün ara…" aria-label="Ürün ara" /></label>
      <div className="waiter-categories" aria-label="Menü kategorileri">{catalogGroups.map((group) => {
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
            : <section className="ops-product-grid waiter-menu-grid" aria-label={`${group.name} ürünleri`}>{group.products.map((product) => <article className="ops-product waiter-product" key={product.id}>
              <div className="waiter-product-main"><span className="waiter-product-image" aria-hidden="true">{product.image || "🍽️"}</span><div><strong>{product.name}</strong><span>{demoDescriptions[product.id] ?? product.category.name}</span></div></div>
              <div className="waiter-product-bottom"><strong>{money(product.price.amountMinor)}</strong><button className="waiter-add-product" disabled={saving} onClick={() => openCustomization(product)}>＋ <span>Ekle</span></button></div>
            </article>)}</section>)}</div>
        </section>;
      })}</div>
      <section className="ops-cart waiter-cart"><div><span>Sepet</span><strong>{money(total)}</strong></div>
        {cartRows.length ? <ul>{cartRows.map((item) => <li key={item.cartId}>
          <span className="waiter-cart-item"><strong className="waiter-line-name">{item.quantity} × {item.name}</strong><small>{[...item.options.map((option) => option.optionName), item.note].filter(Boolean).join(" · ") || "Standart hazırlama"}</small><b className="waiter-line-price">{money(item.quantity * item.price.amountMinor)}</b></span>
          <div className="waiter-cart-actions">
            <button className="waiter-cart-edit" disabled={saving} aria-label={`${item.name} düzenle`} onClick={() => openCustomization(item, item)}>Düzenle</button>
            <div className="ops-quantity"><button disabled={saving} aria-label={`${item.name} azalt`} onClick={() => changeCartLine(item.cartId, -1)}>−</button><b>{item.quantity}</b><button disabled={saving} aria-label={`${item.name} artır`} onClick={() => changeCartLine(item.cartId, 1)}>+</button></div>
          </div>
        </li>)}</ul> : <p>Menüden ürün ekleyin.</p>}
        <button className="ops-primary" disabled={!waiter || !cartRows.length || saving} onClick={() => void sendOrder()}>{saving ? "Gönderiliyor…" : "Siparişi mutfağa gönder"}</button>
        {error && <p className="ops-error" role="alert">{error}</p>}
        {notice && <p className="ops-success" role="status">{notice}{lastOrderId && <small> Sipariş: {lastOrderId.slice(0, 8)}</small>}</p>}
      </section></>}
      {customizingProduct && <div className="waiter-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCustomization(); }}><section className="waiter-custom-modal" role="dialog" aria-modal="true" aria-labelledby="customize-title"><header><div><span className="ops-eyebrow">ÜRÜNÜ DÜZENLE</span><h2 id="customize-title">{customizingProduct.name}</h2></div><button className="waiter-modal-close" onClick={closeCustomization} aria-label="Kapat">×</button></header>
        {(demoCustomizations[customizingProduct.id] ?? []).map((group) => <fieldset key={group.groupName}><legend>{group.groupName}</legend><div className="waiter-custom-options">{group.choices.map((choice) => <label key={choice}><input type="radio" name={`${customizingProduct.id}-${group.groupName}`} checked={customOptions[group.groupName] === choice} onChange={() => setCustomOptions((current) => ({ ...current, [group.groupName]: choice }))} /><span>{choice}</span></label>)}</div></fieldset>)}
        <label className="waiter-note-field">Ürün notu<textarea value={customNote} onChange={(event) => setCustomNote(event.target.value.slice(0, 500))} placeholder="Örn. sosu ayrı, az tuzlu…" maxLength={500} rows={3} /><small>{customNote.length}/500</small></label><p className="waiter-custom-hint">Seçim ve notlar mutfak fişinde görünür. Bu demo tercihler fiyatı değiştirmez.</p><footer><button className="waiter-cancel-custom" onClick={closeCustomization}>Vazgeç</button><button className="ops-primary" disabled={saving} onClick={saveCustomizedProduct}>{editingCartId ? "Değişiklikleri kaydet" : "Sepete ekle"} · {money(customizingProduct.price.amountMinor * (editingCartLine?.quantity ?? 1))}</button></footer></section></div>}
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
          <div className="waiter-adjustment-dev-note">Development testinde yönetici onayı aranmaz. İşlemi yapan kişi ve gerekçe kaydedilir; diğer ortamlarda yönetici onayı gerekir.</div>
          {adjustmentCheck?.payments.length ? <p className="ops-error">Ödeme girişimi olan adisyona indirim veya ikram uygulanamaz.</p> : null}
          <footer><button className="waiter-cancel-custom" disabled={operationSaving} onClick={() => setTableAction(null)}>Vazgeç</button><button className="ops-primary" disabled={operationSaving || !adjustmentCheck || adjustmentCheck.payments.length > 0 || (adjustmentTab === "discount" && (!discountReason || discountReason === "other" && !discountReasonNote.trim())) || (adjustmentTab === "line" && !Object.values(lineAdjustments).some((item) => item.reason && item.quantity > 0))} onClick={() => void submitAdjustment()}>{operationSaving ? "Kaydediliyor…" : "İşlemi uygula"}</button></footer>
        </>}
        {operationError && <p className="ops-error" role="alert">{operationError}</p>}
      </section></div>}
    </section>}
    <footer className="ops-footer">{lastUpdated ? `Son güncelleme ${lastUpdated.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}.` : "Masa bilgileri sunucudan alınır."}</footer>
  </main>;
}

export function KitchenApp() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const load = useCallback(async () => {
    try {
      const [result, tableResult] = await Promise.all([
        request<{ items: Order[] }>(ordersPath, "manager-single"),
        request<{ items: ActiveTable[] }>(`${servicePath}/tables`, "manager-single"),
      ]);
      const tableByOrder = new Map(tableResult.items.flatMap((table) => {
        const assignment = table.assignment;
        return assignment ? (assignment.orderIds ?? [assignment.orderId]).map((orderId) =>
          [orderId, { tableName: table.group ? table.group.tableNames.join(" + ") : table.name, waiterName: assignment.waiterName ?? undefined }] as const) : [];
      }));
      setOrders(result.items.filter((order) => order.source === "waiter_web" && order.status === "open")
        .map((order) => ({ ...order, items: order.kitchenItems ?? order.items, ...tableByOrder.get(order.id) })));
      setError(""); setLastRefresh(new Date());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Mutfak kuyruğu alınamadı."); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => { void load(); }, 3000); return () => window.clearInterval(timer); }, [load]);
  return <main className="ops-shell kitchen-shell">
    <header className="ops-header"><a href="/kitchen" className="ops-brand">HIPOS <span>MUTFAK</span></a><a className="ops-link" href="/waiter">Garson ekranı</a></header>
    <section className="ops-intro"><span className="ops-eyebrow">SİPARİŞ KUYRUĞU</span><h1>Mutfak fişleri</h1><p>Yeni garson siparişleri yerel sunucudan otomatik olarak yenilenir.</p></section>
    <div className="kitchen-toolbar"><span className={error ? "offline-dot" : "online-dot"} />{error ? "Sunucuya ulaşılamıyor" : `Bağlı · son yenileme ${lastRefresh?.toLocaleTimeString("tr-TR") ?? "—"}`}<button onClick={() => void load()}>Yenile</button></div>
    {error && <p className="ops-error" role="alert">{error}</p>}
    {orders.length === 0 && !error && <div className="kitchen-empty">Yeni sipariş bekleniyor.</div>}
    <section className="kitchen-grid">{orders.map((order) => <article className={`kitchen-ticket ${selected?.id === order.id ? "print-target" : ""}`} key={order.id}>
      <header><div><span>{order.tableName ?? "MASA SİPARİŞİ"}{order.waiterName ? ` · ${order.waiterName}` : ""}</span><h2>{order.id.slice(0, 8).toUpperCase()}</h2></div><time>{new Date(order.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</time></header>
      <ul>{order.items.map((item, index) => <li key={`${item.productName}-${index}`}><strong>{item.quantity}×</strong><span>{item.productName}{(item.options?.length || item.note) && <small className="kitchen-line-detail">{[...(item.options ?? []).map((option) => option.optionName), item.note].filter(Boolean).join(" · ")}</small>}</span></li>)}</ul>
      <footer><span>{order.items.reduce((sum, item) => sum + item.quantity, 0)} ürün</span><button onClick={() => { setSelected(order); window.setTimeout(() => window.print(), 50); }}>Mutfak fişi yazdır</button></footer>
    </article>)}</section>
    <p className="ops-footer">Yazdır düğmesi cihazın tarayıcı baskı penceresini açar. Gerçek otomatik yazdırma için mutfak yazıcısının modeli ve sürücüsü ayrıca gerekir.</p>
  </main>;
}

export function mountOperationalApp() {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path !== "/waiter" && path !== "/kitchen") return false;
  createRoot(document.getElementById("root")!).render(path === "/waiter" ? <WaiterApp /> : <KitchenApp />);
  return true;
}
