import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createRequestId } from "./requestId";
import { ProductOptionPicker, type SelectedOption, type OptionSelection } from "./ProductOptionPicker";
import "./operational.css";

const firmId = "11111111-1111-4111-8111-111111111111";
const branchId = "33333333-3333-4333-8333-333333333333";
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
const money = (minor: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(minor / 100);
type ApiProblem = { code?: string; detail?: string; message?: string };
type ApiRequestError = Error & { status?: number; code?: string };
type ProductOption = { groupName: string; optionName: string };
type CartLine = { cartId: string; productId: string; quantity: number; note: string; options: SelectedOption[] };
type Product = { id: string; name: string; sku?: string; category: { id: string; name: string }; image: string; status: string; isActive: boolean; channels: string[]; price: { amountMinor: number; currency: string } };
type MenuSection = { sectionId: string; name: string; productIds: string[] };
type RestaurantMenu = { id: string; name: string; isActive: boolean; sections: MenuSection[] };
type MenuWorkspace = { items: RestaurantMenu[]; categories: Array<{ id: string; name: string; isActive: boolean }>;
  products: Array<{ id: string; name: string; sku?: string; categoryId: string; status: string; isActive: boolean; channels: string[]; image: string; price: { amountMinor: number; currency: string } }> };
type Waiter = { id: string; name: string; isActive: boolean };
type TableGroup = { id: string; primaryTableId: string; tableIds: string[]; tableNames: string[]; guestCount: number; version: number; closedAt: string | null };
type CheckAdjustment = { requestId?: string; action: "discount" | "comp" | "void"; valueType?: "percentage" | "fixed" | null; value?: number | null; orderLineId?: number | null; quantity: number; amountMinor: number; reason: string; actor?: string; approvalMode?: string; createdAt?: string };
type Table = { id: string; number: number; name: string; isActive: boolean; floor?: "lower" | "upper" | null; status?: "idle" | "occupied" | "bill_requested" | "reserved"; reservedFor?: string | null; reservationGuestName?: string | null; version?: number; group?: TableGroup | null; assignment?: {
  id: string; orderId: string; orderIds?: string[]; waiterId: string | null; waiterName: string | null; totalMinor: number;
  paymentStatus: string; version: number; grossTotalMinor: number; adjustmentMinor: number; adjustments: CheckAdjustment[];
  items: Array<{ productId: string; productName: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; orderLineId: number; note?: string | null; options?: ProductOption[] }>;
} | null };
type OpenCheck = { id: string; status: string; tableId?: string | null; version: number; totalMinor: number; grossTotalMinor: number; adjustmentMinor: number; adjustments: CheckAdjustment[]; payments: unknown[]; orders: Array<{ id: string; items: Array<{ id: number; productName: string; quantity: number; unitPriceMinor: number }> }> };
type KitchenStatus = "pending" | "preparing" | "ready" | "served" | "cancelled";
type KitchenStatusItem = { id: string; orderId: string; productName: string; quantity: number; note?: string | null; status: KitchenStatus; statusChangedAt?: string | null };
type Order = { id: string; source: string; status: string; paymentStatus: string; totalMinor: number; createdAt: string; tableName?: string; waiterName?: string; items: Array<{ productName: string; quantity: number; lineTotalMinor?: number; note?: string | null; options?: ProductOption[]; status?: KitchenStatus; statusChangedAt?: string | null }>; kitchenItems?: Array<{ productId: string; productName: string; quantity: number; note?: string | null; options: ProductOption[]; status?: KitchenStatus; statusChangedAt?: string | null }> };
type ActiveTable = { name: string; group?: TableGroup | null; assignment?: { orderId: string; orderIds?: string[]; waiterName: string | null } | null };

function PosProductImage({ image, productId, name }: { image: string; productId: string; name: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!image.startsWith("upload:")) return;
    const controller = new AbortController(); let objectUrl = ""; setUrl("");
    const path = `/api/v1/firms/${firmId}/branches/${branchId}/catalog/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.slice(7))}`;
    void fetch(`${apiBase}${path}`, { headers: { "X-Demo-Actor": "pos-single" }, signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("image unavailable"); return response.blob(); })
      .then(blob => { if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } })
      .catch(() => {});
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image, productId]);
  if (!image.startsWith("upload:")) return <>{image || "🍽️"}</>;
  return url ? <img src={url} alt={name} /> : <span aria-label="Görsel yüklenemedi">🍽️</span>;
}

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
const demoDescriptions: Record<string, string> = {
  "55555555-5555-4555-8555-555555555501": "Domates sosu, mozzarella ve fesleğen.",
  "55555555-5555-4555-8555-555555555502": "Tavuk ve taze sebzeli sandviç.",
  "55555555-5555-4555-8555-555555555503": "Fırınlanmış cheesecake dilimi.",
  "55555555-5555-4555-8555-555555555504": "Taze çekilmiş kahveden hazırlanır.",
  "55555555-5555-4555-8555-555555555505": "Limon ve şekerle hazırlanır.",
  "55555555-5555-4555-8555-555555555506": "Karışık malzemeli, fırından yeni çıkmış pizza.",
};

type CashOverview = { registers: Array<{ id: string; name: string; code: string }>; openShifts: Array<{ shift: { id: string; version: number; registerId: string; openedBy: string; openedAt: string; expectedCashMinor: number | null } }> };

type CashierCustomer = { id: string; name: string; phone: string | null; isActive: boolean; customerBalanceMinor: number };
type CashierCheck = Omit<OpenCheck, "orders" | "payments"> & { createdAt: string; paymentStatus: "unpaid" | "partially_paid" | "paid" | "pending" | "unknown"; payments: Array<{ id: string; amountMinor: number; method: string; status: string; createdAt: string }>; paidMinor: number; remainingMinor: number; orders: Array<{ id: string; version: number; remainingMinor: number; items: Array<{ id: number; productName: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; note?: string | null; options?: ProductOption[] }> }> };
type AccountReceipt = { check: CashierCheck; location: string; printedAt: string };
type QuickCreate = { requestId: string; firstOrderId: string; items: Array<{ productId: string; quantity: number; options: Array<{ groupId: string; optionId: string; quantity: number }> }>; customerId: null; tableId: null; waiterId: null };
const quickRequestKey = `hipos.quick-create.${firmId}.${branchId}`;

export function CashierApp() {
  const [tables, setTables] = useState<Table[]>([]);
  const [cashOverview, setCashOverview] = useState<CashOverview | null>(null);
  const [cashError, setCashError] = useState("");
  const [cashLoading, setCashLoading] = useState(true);
  const [cashDialog, setCashDialog] = useState<{ mode: "open" | "close"; registerId: string; shiftId?: string; version?: number; expected?: number } | null>(null);
  const [cashAmount, setCashAmount] = useState("");
  const [cashDenominations, setCashDenominations] = useState<Record<number, number>>({});
  const [cashNote, setCashNote] = useState("");
  const [cashBusy, setCashBusy] = useState(false);
  const [cashActionError, setCashActionError] = useState("");
  const [cashNotice, setCashNotice] = useState("");
  const [cashRefresh, setCashRefresh] = useState(0);
  const [morningAmount, setMorningAmount] = useState("1000");
  const [morningNote, setMorningNote] = useState("");
  const [morningError, setMorningError] = useState("");
  const [morningDismissed, setMorningDismissed] = useState(false);

  const mainRegister = cashOverview?.registers[0];
  const activeShift = mainRegister ? cashOverview?.openShifts.find((item) => item.shift.registerId === mainRegister.id)?.shift : undefined;
  const isShiftOpen = Boolean(activeShift);
  const showMorningScreen = !cashLoading && Boolean(mainRegister) && !isShiftOpen && !morningDismissed;

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
    const normalized = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(input) ? input.replaceAll(".", "").replace(",", ".") : input.replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) { setMorningError("Geçerli bir TL tutarı girin."); return; }
    const minor = Math.round(Number(normalized) * 100);
    if (!Number.isSafeInteger(minor) || minor < 0 || minor > 999999999999) { setMorningError("Geçerli bir TL tutarı girin."); return; }

    setCashBusy(true);
    setMorningError("");
    const reqId = createRequestId();
    try {
      await request(`/api/v1/firms/${firmId}/branches/${branchId}/cash/shifts`, "pos-single", {
        requestId: reqId,
        registerId: mainRegister.id,
        openingCashMinor: minor,
        note: noteStr?.trim() || null,
      });
      setMorningDismissed(false);
      setCashNotice(`☀️ Günaydın! Vardiya ${money(minor)} başlangıç avansı ile başarıyla açıldı.`);
      setCashRefresh((v) => v + 1);
    } catch (cause) {
      setMorningError(cause instanceof Error ? cause.message : "Vardiya açılamadı.");
    } finally {
      setCashBusy(false);
    }
  }

  function handleMorningKeypad(key: string) {
    setMorningError("");
    if (key === "⌫") {
      setMorningAmount((prev) => (prev.length > 1 ? prev.slice(0, -1) : "0"));
    } else if (key === "C") {
      setMorningAmount("0");
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
  const [selectedId, setSelectedId] = useState("");
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
  const [accountReceipt, setAccountReceipt] = useState<AccountReceipt | null>(null);
  const [lastCompletedReceipt, setLastCompletedReceipt] = useState<AccountReceipt | null>(null);
  function printAccountReceipt(receipt: AccountReceipt) {
    flushSync(() => setAccountReceipt({ ...receipt, printedAt: new Date().toISOString() }));
    window.print();
  }
  const [unfinishedChecks, setUnfinishedChecks] = useState<CashierCheck[]>([]);
  const [unfinishedError, setUnfinishedError] = useState("");
  const [pendingQuick, setPendingQuick] = useState<QuickCreate | null>(() => { try { const value = localStorage.getItem(quickRequestKey); return value ? JSON.parse(value) as QuickCreate : null; } catch { return null; } });
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [catalogCategories, setCatalogCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedQuickCat, setSelectedQuickCat] = useState("all");
  const [quickSearch, setQuickSearch] = useState("");
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

  useEffect(() => {
    let live = true;
    request<MenuWorkspace>(`/api/v1/firms/${firmId}/branches/${branchId}/catalog/menus`, "pos-single")
      .then((menuResult) => {
        if (!live) return;
        const activeCategories = menuResult.categories.filter(category => category.isActive);
        const categoryNames = new Map(activeCategories.map((c) => [c.id, c.name]));
        setCatalogCategories(activeCategories);
        setCatalogProducts(menuResult.products.filter(p => p.status === "published" && p.isActive && p.channels.includes("pos") && p.price.amountMinor > 0 && categoryNames.has(p.categoryId)).map((p) => ({
          ...p, category: { id: p.categoryId, name: categoryNames.get(p.categoryId) ?? "Kategorisiz" },
        })));
        setCatalogError("");
      })
      .catch(cause => { if (live) { setCatalogProducts([]); setCatalogError(cause instanceof Error ? cause.message : "Ürünler yüklenemedi."); } });
    return () => { live = false; };
  }, [catalogRevision]);

  const quickTotalMinor = quickCart.reduce((sum, item) => sum + item.quantity * (item.product.price.amountMinor + item.options.reduce((delta, option) => delta + option.priceDeltaMinor * option.quantity, 0)), 0);
  const quickCartCount = quickCart.reduce((sum, item) => sum + item.quantity, 0);

  async function loadUnfinishedChecks() {
    try { const result = await request<{ items: CashierCheck[] }>(`${checksPath}?unassignedOpen=true`, "pos-single"); setUnfinishedChecks(result.items.filter(check => check.status === "open" && check.tableId == null)); setUnfinishedError(""); }
    catch (cause) { setUnfinishedError(cause instanceof Error ? cause.message : "Açık satışlar yüklenemedi."); }
  }
  useEffect(() => { if (cashierMode === "quick" && quickStep === "menu") void loadUnfinishedChecks(); }, [cashierMode, quickStep]);
  async function resumeQuickCheck(checkId: string) {
    setQuickBusy(true); setQuickError("");
    try { const check = await request<CashierCheck>(`${checksPath}/${encodeURIComponent(checkId)}`, "pos-single"); if (check.status !== "open" || check.tableId != null) { await loadUnfinishedChecks(); setQuickError("Bu satış artık açık değil."); return; } setQuickActiveCheck(check); setQuickStep("payment"); }
    catch (cause) { setQuickError(cause instanceof Error ? cause.message : "Satış yüklenemedi."); }
    finally { setQuickBusy(false); }
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
      const items = quickCart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
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

      if (createdCheck.status !== "open") { setQuickCart([]); setQuickNotice("Önceki satış tamamlanmış. Yeni satış başlatabilirsiniz."); return; }

      setQuickActiveCheck(createdCheck);
      setQuickStep("payment");
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

  const reload = useCallback(async () => {
    const current = ++serial.current;
    try {
      const result = await request<{ items: Table[] }>(`${servicePath}/tables`, "pos-single");
      const active = result.items.filter((table) => table.isActive);
      const primaryIds = [...new Set(active.filter((table) => table.assignment || table.group || table.status === "occupied" || table.status === "bill_requested").map((table) => table.group?.primaryTableId ?? table.id))];
      const responses = await Promise.all(primaryIds.map(async (id) => {
        const response = await request<{ items: CashierCheck[] }>(`${checksPath}?tableId=${encodeURIComponent(id)}`, "pos-single");
        return [id, response.items.filter((check) => check.status === "open")] as const;
      }));
      if (current !== serial.current) return;
      setTables(active); setChecks(Object.fromEntries(responses)); setUpdated(new Date()); setError("");
    } catch (cause) {
      if (current === serial.current) setError(cause instanceof Error ? cause.message : "Masa ve adisyon bilgileri alınamadı.");
    } finally { if (current === serial.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void reload(); }, 5000);
    return () => { window.clearInterval(timer); serial.current++; };
  }, [reload]);

  useEffect(() => {
    let active = true;
    let running = false;
    async function loadCash() {
      if (running) return;
      running = true;
      try {
        const overview = await request<CashOverview>(`/api/v1/firms/${firmId}/branches/${branchId}/cash/overview`, "pos-single");
        if (active) { setCashOverview(overview); setCashError(""); }
      } catch (cause) {
        if (active) setCashError(cause instanceof Error ? cause.message : "Kasa bilgileri alınamadı.");
      } finally { running = false; if (active) setCashLoading(false); }
    }
    void loadCash();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadCash(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [cashRefresh]);

  async function submitCashShift(event: React.FormEvent) {
    event.preventDefault();
    if (!cashDialog || cashBusy) return;
    const input = cashAmount.trim().replace(/\s/g, "");
    const normalized = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(input) ? input.replaceAll(".", "").replace(",", ".") : input.replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) { setCashActionError("Geçerli bir TL tutarı girin."); return; }
    const minor = Math.round(Number(normalized) * 100);
    if (!Number.isSafeInteger(minor) || minor > 999999999999) { setCashActionError("Geçerli bir TL tutarı girin."); return; }
    const note = cashNote.trim();
    if (cashDialog.mode === "close" && cashDialog.expected != null && minor !== cashDialog.expected && !note) { setCashActionError("Sayılan tutar farklıysa fark açıklaması yazın."); return; }
    const key = JSON.stringify([cashDialog, minor, note]);
    if (cashRequestId.current?.key !== key) cashRequestId.current = { key, id: createRequestId() };
    const base = `/api/v1/firms/${firmId}/branches/${branchId}/cash`;
    const path = cashDialog.mode === "open" ? `${base}/shifts` : `${base}/shifts/${encodeURIComponent(cashDialog.shiftId!)}/close`;
    const body = cashDialog.mode === "open" ? { requestId: cashRequestId.current.id, registerId: cashDialog.registerId, openingCashMinor: minor } : { requestId: cashRequestId.current.id, expectedVersion: cashDialog.version, countedCashMinor: minor, note: note || null };
    setCashBusy(true); setCashActionError("");
    try {
      await request(path, "pos-single", body);
      cashRequestId.current = null; setCashDialog(null); setCashNotice(cashDialog.mode === "open" ? "Vardiya açıldı." : "Vardiya kapatıldı."); setCashRefresh((value) => value + 1); if (cashDialog.mode === "close") { setMorningDismissed(false); }
    } catch (cause) { setCashActionError(cause instanceof Error ? cause.message : "Vardiya işlemi tamamlanamadı."); }
    finally { setCashBusy(false); }
  }

  const selected = tables.find((table) => table.id === selectedId);
  const statusOf = (table: Table) => {
    const primary = tables.find((item) => item.id === (table.group?.primaryTableId ?? table.id)) ?? table;
    return primary.status === "bill_requested" ? "bill_requested" : table.status === "reserved" ? "reserved" : table.assignment || table.group || table.status === "occupied" ? "occupied" : "idle";
  };
  const isQuickPayment = cashierMode === "quick" && quickStep === "payment";
  const selectedChecks = isQuickPayment ? (quickActiveCheck ? [quickActiveCheck] : []) : (checks[selectedId] ?? []);
  const activeCheck = isQuickPayment ? quickActiveCheck : (selectedChecks.find((check) => check.id === selectedCheckId) ?? selectedChecks[0]);
  const tableTotal = selectedChecks.reduce((sum, check) => sum + check.totalMinor, 0);
  const tableRemaining = selectedChecks.reduce((sum, check) => sum + check.remainingMinor, 0);
  const paymentLabel = (status: CashierCheck["paymentStatus"]) => ({ unpaid: "Açık", partially_paid: "Kısmi ödeme (test)", paid: "Ödendi (test)", pending: "Ödeme bekliyor (test)", unknown: "Ödeme belirsiz (test)" }[status] ?? "Durum bilinmiyor");
  useEffect(() => {
    if (isQuickPayment && activeCheck) {
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
  }, [activeCheck?.id, isQuickPayment]);
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
  // Demo tahsilat: mevcut ödeme simülatörünü kullanır; gerçek para/kasa hareketi oluşturmaz.
  const isZeroBalance = Boolean(activeCheck && activeCheck.remainingMinor <= 0);
  const demoPayable = paymentMethod === "cash" || paymentMethod === "card";
  const payBlocker = !activeCheck ? "Açık adisyon seçin." : isZeroBalance ? "" : !paymentMethod ? "Ödeme yöntemi seçin." : !demoPayable ? "Bu yöntem demo tahsilatta desteklenmiyor (yalnız nakit ve kart)." : amountMinor <= 0 ? "Tutar girin." : "";
  async function submitPayment() {
    if (!activeCheck || !paymentMethod || !demoPayable || payBusy || payBlocker || error) return;
    if (!isShiftOpen) {
      setMorningDismissed(false);
      setPayError("Tahsilat yapabilmek için önce sabah kasa açılışını tamamlamalısınız.");
      return;
    }
    const method = paymentMethod;
    let left = Math.min(amountMinor, activeCheck.remainingMinor);
    const parts: Array<{ orderId: string; version: number; amountMinor: number }> = [];
    for (const order of activeCheck.orders) {
      if (left <= 0) break;
      const part = Math.min(left, order.remainingMinor);
      if (part > 0) { parts.push({ orderId: order.id, version: order.version, amountMinor: part }); left -= part; }
    }
    if (!parts.length || left > 0) { setPayError("Tutar siparişlere dağıtılamadı. Ekranı yenileyip tekrar deneyin."); return; }
    const key = JSON.stringify([activeCheck.id, method, parts]);
    if (payRequest.current?.key !== key) payRequest.current = { key, ids: parts.map(() => createRequestId()) };
    setPayBusy(true); setPayError("");
    try {
      let latestCheck: CashierCheck = activeCheck;
      for (const [index, part] of parts.entries()) {
        const res = await request<{ attempt: unknown; check: CashierCheck }>(`${checksPath}/${encodeURIComponent(activeCheck.id)}/payment-attempts`, "pos-single", {
          orderId: part.orderId, attemptId: payRequest.current.ids[index], amountMinor: part.amountMinor, method,
          simulatedOutcome: "succeeded", expectedOrderVersion: part.version,
        });
        latestCheck = res.check;
      }
      payRequest.current = null; setAmountInput("0"); setPaymentMethod(null); setPaymentSubMethod("");
      if (latestCheck.status === "closed" || latestCheck.remainingMinor <= 0) {
        const receipt = { check: latestCheck, location: isQuickPayment ? "Hızlı satış" : selected?.name ?? "Masa", printedAt: new Date().toISOString() };
        setLastCompletedReceipt(receipt);
        printAccountReceipt(receipt);
      }
      if (isQuickPayment) {
        if (latestCheck.remainingMinor <= 0 || latestCheck.status === "closed") {
          setQuickSuccess({
            changeMinor: method === "cash" && amountMinor > activeCheck.remainingMinor ? amountMinor - activeCheck.remainingMinor : 0,
            paidMinor: latestCheck.totalMinor,
            totalMinor: latestCheck.totalMinor,
            method: method === "cash" ? "Nakit" : "Kredi Kartı",
            payments: latestCheck.payments,
          });
          setQuickActiveCheck(null);
          setQuickCart([]);
          setQuickStep("menu");
          setSplitNotice(`Test satışı tamamlandı: ${money(latestCheck.totalMinor)} simüle edildi.`);
        } else {
          setQuickActiveCheck(latestCheck);
          setAmountInput(`${Math.floor(latestCheck.remainingMinor / 100)},${String(latestCheck.remainingMinor % 100).padStart(2, "0")}`);
          setSplitNotice(`Kısmi tahsilat kaydedildi: ${money(Math.min(amountMinor, activeCheck.remainingMinor))} (${method === "cash" ? "Nakit" : "Kart"}). Kalan tutar: ${money(latestCheck.remainingMinor)}.`);
        }
      } else {
        setSplitNotice(`Demo tahsilat kaydedildi: ${money(Math.min(amountMinor, activeCheck.remainingMinor))} (${method === "cash" ? "Nakit" : "Kart"}). Gerçek tahsilat ve kasa hareketi oluşmadı.`);
      }
      await reload();
    } catch (cause) {
      const failure = cause as ApiRequestError;
      if (failure.status === 409 && ["VERSION_CONFLICT", "PAYMENT_ID_CONFLICT"].includes(failure.code ?? "")) { payRequest.current = null; await reload(); setPayError("Adisyon başka bir işlemle değişti; güncel bilgiler yüklendi, tutarı kontrol edip tekrar deneyin."); }
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
        await reload();
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
    setCashierAction(action); setActionTarget(""); setActionSources([]); setActionReason(""); setActionValue(""); setActionLine(""); setActionQuantity(1); setActionError(""); setSplitNotice("");
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
      if (!actionReason.trim()) { setActionError("Gerekçe zorunludur."); return; }
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
      body = { expectedVersion: activeCheck.version, action: cashierAction, valueType: cashierAction === "discount" ? actionValueType : null, value, orderLineId: lineId, quantity, reason: actionReason.trim() };
    }
    const key = JSON.stringify([path, body]);
    if (actionRequest.current?.key !== key) actionRequest.current = { key, id: createRequestId() };
    setActionBusy(true); setActionError("");
    try {
      await request(path, "pos-single", { ...body, requestId: actionRequest.current.id });
      actionRequest.current = null; setCashierAction(null);
      if (cashierAction === "transfer") { setSelectedId(actionTarget); setSelectedCheckId(""); }
      setSplitNotice(cashierAction === "transfer" ? "Masa taşındı." : cashierAction === "merge" ? "Masalar birleştirildi." : "İşlem kaydedildi. Geliştirme ortamında yönetici onayı alınmadı.");
      await reload();
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
      setSplitCheck(null); setSplitNotice("Adisyon bölündü. Yeni adisyon aynı masada görüntüleniyor.");
      await reload();
    } catch (cause) {
      const failure = cause as ApiRequestError;
      if (failure.status === 409 && ["STALE_CHECK_VERSION", "VERSION_CONFLICT"].includes(failure.code ?? "")) {
        splitRequest.current = null; setSplitCheck(null); await reload();
        setSplitNotice("Adisyon başka bir işlemle değişti. Güncel bilgileri kontrol edip bölme işlemini yeniden başlatın.");
      } else setSplitError(cause instanceof Error ? cause.message : "Adisyon bölünemedi.");
    } finally { setSplitting(false); }
  }
  const filteredQuickProducts = catalogProducts.filter((product) => {
    const matchesCat = selectedQuickCat === "all" || product.category.id === selectedQuickCat;
    const query = quickSearch.trim().toLocaleLowerCase("tr-TR");
    const matchesSearch = !query || product.name.toLocaleLowerCase("tr-TR").includes(query) || (product.sku ?? "").toLocaleLowerCase("tr-TR").includes(query);
    return (Boolean(query) || matchesCat) && matchesSearch;
  });

  return <main className={`ops-shell waiter-shell cashier-shell${selected || cashierMode === "quick" ? " cashier-detail-shell" : " cashier-table-overview"}`}>
    <header className="ops-header">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <a href="/cashier" className="ops-brand waiter-brand"><img src="/hipos-logo.png" alt="HIPOS" /><span>KASA</span></a>
        <nav className="cashier-mode-nav" aria-label="Kasa Görünümü">
          <button type="button" className={`cashier-mode-tab ${cashierMode === "tables" ? "active" : ""}`} onClick={() => { setCashierMode("tables"); setSelectedId(""); }}>🍽️ Masalar & Salon</button>
          <button type="button" className={`cashier-mode-tab ${cashierMode === "quick" ? "active" : ""}`} onClick={() => { setCashierMode("quick"); setSelectedId(""); }}>⚡ Hızlı Satış (Gel-Al)</button>
        </nav>
      </div>
      <div className="waiter-header-actions">
        {lastCompletedReceipt && <button type="button" className="waiter-back" onClick={() => printAccountReceipt(lastCompletedReceipt)}>Son hesap fişi</button>}
        {activeShift && mainRegister && <button type="button" className="waiter-back" disabled={cashBusy || cashLoading || Boolean(cashError)} onClick={() => { setCashAmount(""); setCashDenominations({}); setCashNote(""); setCashActionError(""); setCashNotice(""); setCashDialog({ mode: "close", registerId: mainRegister.id, shiftId: activeShift.id, version: activeShift.version, expected: activeShift.expectedCashMinor ?? undefined }); }}>Vardiyayı kapat</button>}
        {selected && cashierMode === "tables" && <button className="waiter-back" onClick={() => setSelectedId("")}>← Masalara dön</button>}
        {isQuickPayment && (
          <button
            type="button"
            className="waiter-back"
            onClick={() => {
              setQuickActiveCheck(null);
              setQuickCart([]);
              setQuickStep("menu");
              setQuickNotice("Satış açık bırakıldı. Açık masasız adisyonlar listesinden devam edebilirsiniz.");
            }}
          >
            ← Menüye Dön
          </button>
        )}
        <span className={`waiter-connection ${error ? "unavailable" : loading ? "checking" : "connected"}`}><i />{error ? "Veri alınamıyor" : loading ? "Bağlanıyor" : "Bağlı"}</span>
      </div>
    </header>
    {cashError && <p className="ops-error" role="alert">Kasa bilgileri alınamadı. {cashOverview ? "Son bilgiler güncel olmayabilir." : ""}</p>}
    {cashNotice && <p role="status">{cashNotice}</p>}
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
              <span>🏢 <b>{mainRegister.name}</b> ({mainRegister.code || "KAD-01"})</span>
              <span>👤 <b>Kasiyer (Kasa 1)</b></span>
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
                      placeholder="0"
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
                      setMorningAmount("0");
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
              onClick={() => void handleOpenMorningShift(morningAmount, morningNote)}
            >
              {cashBusy ? "Kasayı Açıyor…" : "☀️ Kasayı Aç ve Güne Başla"}
            </button>
          </div>
        </div>
      </div>}
    <dialog ref={cashDialogRef} className="waiter-reservation-dialog" onCancel={(event) => { if (cashBusy) event.preventDefault(); else setCashDialog(null); }} onClose={() => setCashDialog(null)}>
      {cashDialog && <form className="waiter-custom-modal" onSubmit={(event) => void submitCashShift(event)}><header><h2>{cashDialog.mode === "open" ? "Vardiyayı aç" : "Vardiyayı kapat"}</h2></header>
      {cashDialog.mode === "close" && <><p>Açık masa adisyonları: {Object.values(checks).reduce((sum, entries) => sum + entries.length, 0)}. Açık adisyonları kapatmadan vardiyayı kapatabilirsiniz.</p><fieldset className="cash-count-grid"><legend>Kupür sayımı (isteğe bağlı)</legend>{[20000, 10000, 5000, 2000, 1000, 500, 100, 50, 25, 10, 5, 1].map(denomination => <label key={denomination}>{money(denomination)}<input type="number" min="0" step="1" inputMode="numeric" value={cashDenominations[denomination] ?? ""} disabled={cashBusy} onChange={event => { const value = Math.max(0, Math.min(1000000, Math.floor(Number(event.target.value) || 0))); const next = { ...cashDenominations, [denomination]: value }; setCashDenominations(next); const total = Object.entries(next).reduce((sum, [unit, count]) => sum + Number(unit) * count, 0); setCashAmount(`${Math.floor(total / 100)},${String(total % 100).padStart(2, "0")}`); }} /></label>)}</fieldset><p>Beklenen nakit: {cashDialog.expected === undefined ? "—" : money(cashDialog.expected)}</p></>}
      <label className="waiter-note-field">{cashDialog.mode === "open" ? "Başlangıç nakdi (TL)" : "Kasada sayılan (TL)"}<input inputMode="decimal" autoFocus value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} placeholder="Örn. 1.000,00" disabled={cashBusy} /></label>
      {cashDialog.mode === "close" && <label className="waiter-note-field">Fark açıklaması (fark varsa zorunlu)<textarea rows={3} maxLength={500} value={cashNote} onChange={(event) => setCashNote(event.target.value)} disabled={cashBusy} /></label>}
      <p className="cashier-shift-demo">Geliştirme ortamı: kasiyer oturumu henüz bağlı değil.</p>{cashActionError && <p className="ops-error" role="alert">{cashActionError}</p>}
      <footer><button type="button" className="waiter-cancel-custom" disabled={cashBusy} onClick={() => setCashDialog(null)}>Vazgeç</button><button type="submit" className="ops-primary" disabled={cashBusy}>{cashBusy ? "Kaydediliyor…" : cashDialog.mode === "open" ? "Vardiyayı aç" : "Say ve vardiyayı kapat"}</button></footer></form>}
    </dialog>
    {error && <p className="ops-error" role="alert">{error}{updated && " Gösterilen bilgiler son başarılı güncellemeye aittir."}</p>}
    {loading && <p className="ops-message">Masalar ve adisyonlar yükleniyor…</p>}
    {!selected && cashierMode === "tables" && <>
      <div className="waiter-section-heading"><h2>Masalar</h2><span>{tables.length} masa</span><div style={{ display: "flex", gap: 8 }}><button type="button" onClick={() => { if (!isShiftOpen) { setMorningDismissed(false); } else { setCashierMode("quick"); } }} style={{ background: "#2b7a4b", color: "#fff", borderColor: "#2b7a4b", borderRadius: 8, padding: "6px 12px", fontWeight: 700, cursor: "pointer" }}>⚡ Hızlı Satış Aç</button><button onClick={() => void reload()}>Yenile</button></div></div>
      {!loading && !error && tables.length === 0 && <p className="ops-message">Gösterilecek aktif masa bulunamadı.</p>}
      {([{ key: "lower", label: "Alt kat" }, { key: "upper", label: "Üst kat" }, { key: "unassigned", label: "Katı belirlenmemiş masalar" }] as const).map((floor) => {
        const floorTables = tables.filter((table) => (table.floor ?? "unassigned") === floor.key);
        if (!floorTables.length) return null;
        return <section className="waiter-floor-section" key={floor.key} aria-label={floor.label}><div className="waiter-floor-heading"><h3>{floor.label}</h3><span>{floorTables.length} masa</span></div><div className="waiter-table-grid">{floorTables.map((table) => {
        const status = statusOf(table);
        const visual = status === "bill_requested" ? "bill-requested" : table.group ? "grouped" : status === "reserved" ? "reserved" : status === "occupied" ? "occupied" : "empty";
        const label = status === "bill_requested" ? "Hesap istendi" : table.group ? "Grupta" : status === "reserved" ? "Rezerve" : status === "occupied" ? "Dolu" : "Boş";
        const primaryId = table.group?.primaryTableId ?? table.id;
        const tableChecks = checks[primaryId] ?? [];
        return <button type="button" key={table.id} className={`waiter-table-card ${visual}`} onClick={() => setSelectedId(primaryId)}><svg className="waiter-table-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="6" width="14" height="12" rx="3" /><path d="M9 3h6M9 21h6M2 10v4M22 10v4" /></svg><strong>{table.name}</strong><span className="waiter-table-status">{label}</span>{table.group && <small className="waiter-group-card-label">Ana masa: {table.group.tableNames[0]}</small>}{tableChecks.length > 0 && <><span className="waiter-table-owner">{tableChecks.length} açık adisyon{table.group ? " · ortak" : ""}</span><b>{money(tableChecks.reduce((sum, check) => sum + check.totalMinor, 0))}</b></>}</button>;
      })}</div></section>;
      })}</>}
    {cashierMode === "quick" && quickStep === "menu" && <section className="cashier-quick-section" aria-label="Hızlı Satış Menü Ekranı">
      <div className="cashier-quick-menu-header">
        <div className="cashier-quick-search-bar">
          <input
            type="search"
            placeholder="🔍 Barkod okutun veya ürün adı arayın…"
            value={quickSearch}
            onChange={(e) => setQuickSearch(e.target.value)}
            onKeyDown={(e) => {
              const exactCode = catalogProducts.filter(product => product.sku && product.sku.toLocaleLowerCase("tr-TR") === quickSearch.trim().toLocaleLowerCase("tr-TR"));
              const match = exactCode.length === 1 ? exactCode[0] : filteredQuickProducts.length === 1 ? filteredQuickProducts[0] : null;
              if (e.key === "Enter" && match && !pendingQuick) {
                setQuickOptionSelection(null); setQuickOptionProduct(match);
                setQuickSearch("");
              }
            }}
          />
        </div>
        <div className="cashier-quick-header-actions">
          {quickCart.length > 0 && (
            <button
              type="button"
              className="cashier-quick-clear-btn"
              disabled={Boolean(pendingQuick)}
              onClick={() => setQuickCart([])}
            >
              🗑️ Sepeti Temizle
            </button>
          )}
          <button
            type="button"
            className={`cashier-quick-enter-cart-btn ${quickCart.length > 0 ? "active" : "disabled"}`}
            disabled={(!pendingQuick && quickCart.length === 0) || quickBusy}
            onClick={() => void proceedToPayment()}
          >
            {quickBusy ? "Adisyon Açılıyor…" : pendingQuick ? "Önceki isteği tekrar dene" : quickCart.length > 0 ? `🛒 Sepete Gir (${quickCartCount} Ürün · ${money(quickTotalMinor)}) →` : "🛒 Sepete Gir (Sepet Boş)"}
          </button>
        </div>
      </div>

      {quickSuccess && <div className="cashier-quick-success-banner" role="status">
        <strong>Test satışı tamamlandı · Gerçek tahsilat yapılmadı</strong>
        <span>Toplam Tutar: {money(quickSuccess.totalMinor)}</span>
        {quickSuccess.payments && quickSuccess.payments.length > 1 ? (
          <div className="cashier-quick-split-tags">
            <span>Parçalı Tahsilat ({quickSuccess.payments.length} Ödeme):</span>
            {quickSuccess.payments.map((p, idx) => (
              <span key={p.id || idx} className="cashier-quick-split-tag">
                {idx + 1}. {p.method === "cash" ? "💵 Nakit" : "💳 Kart"}: {money(p.amountMinor)}
              </span>
            ))}
          </div>
        ) : (
          <span>Ödeme Yöntemi: {quickSuccess.method}</span>
        )}
        {quickSuccess.changeMinor > 0 && <span className="change-alert">💵 Verilecek Para Üstü: {money(quickSuccess.changeMinor)}</span>}
      </div>}
      {quickNotice && <p className="ops-success" role="status" style={{ margin: "0 0 10px" }}>{quickNotice}</p>}
      {quickError && <p className="ops-error" role="alert">{quickError}</p>}
      {catalogError && <p className="ops-error" role="alert">Ürünler yüklenemedi: {catalogError} <button type="button" onClick={() => setCatalogRevision(value => value + 1)}>Tekrar dene</button></p>}
      {pendingQuick && <p className="ops-error" role="status">Önceki satış isteğinin sonucu kesinleşmedi. Yeni satışa başlamadan aynı isteği tekrar deneyin.</p>}
      {unfinishedError && <p className="ops-error" role="alert">Açık satışlar alınamadı: {unfinishedError} <button type="button" onClick={() => void loadUnfinishedChecks()}>Tekrar dene</button></p>}
      {unfinishedChecks.length > 0 && <section className="quick-cart-compact" aria-label="Açık masasız adisyonlar"><header><h2>Açık masasız adisyonlar <span>{unfinishedChecks.length} kayıt</span></h2></header><div className="quick-cart-compact-list">{unfinishedChecks.map(check => <div className="quick-cart-compact-row" key={check.id}><div className="quick-cart-compact-info"><strong>{new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(check.createdAt))} · {check.orders.flatMap(order => order.items).map(item => `${item.quantity} × ${item.productName}`).join(", ")}</strong><span>Kalan: {money(check.remainingMinor)}{check.paidMinor > 0 ? ` · Simüle ödeme: ${money(check.paidMinor)}` : ""}</span></div><button type="button" className="waiter-back" disabled={quickBusy || Boolean(pendingQuick)} onClick={() => void resumeQuickCheck(check.id)}>Devam et</button></div>)}</div><small>Bu liste şubedeki açık masasız adisyonları gösterir.</small></section>}

      <div className="cashier-quick-catalog-full">
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

        <div className="cashier-quick-products-grid">
          {filteredQuickProducts.length === 0 ? (
            <p className="ops-message" style={{ gridColumn: "1 / -1" }}>Eşleşen ürün bulunamadı.</p>
          ) : (
            filteredQuickProducts.map((product) => {
              const inCart = quickCart.find((item) => item.product.id === product.id);
              return (
                <div
                  key={product.id}
                  className={`cashier-quick-product-card ${inCart ? "has-cart" : ""}`}
                  onClick={() => { if (!pendingQuick) { setQuickOptionSelection(null); setQuickOptionProduct(product); } }}
                >
                  <div className="cashier-quick-product-top">
                    {product.image.startsWith("upload:") && <span className="cashier-quick-product-image"><PosProductImage image={product.image} productId={product.id} name={product.name} /></span>}
                    <span className="cashier-quick-product-name">{product.name}</span>
                    {inCart && <span>Sepette</span>}
                  </div>
                  <strong className="cashier-quick-product-price">{money(product.price.amountMinor)}</strong>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>}
    {cashierMode === "quick" && quickStep === "menu" && quickCart.length > 0 && <section className="quick-cart-compact" aria-label="Hızlı satış sepeti">
      <header><h2>Sepet <span>{quickCartCount} ürün</span></h2><strong>Toplam {money(quickTotalMinor)}</strong></header>
      <div className="quick-cart-compact-list">{quickCart.map(item => <div className="quick-cart-compact-row" key={item.id}>
        <div className="quick-cart-compact-info"><strong>{item.product.name}</strong>{item.options.length > 0 && <small>{item.options.map(option => `${option.optionName}${option.quantity > 1 ? ` × ${option.quantity}` : ""}`).join(", ")}</small>}<span>{money((item.product.price.amountMinor + item.options.reduce((sum, option) => sum + option.priceDeltaMinor * option.quantity, 0)) * item.quantity)}</span></div>
        <div className="quick-cart-compact-qty"><button type="button" disabled={Boolean(pendingQuick)} onClick={() => updateQuickCartQty(item.id, -1)} aria-label={`${item.product.name} azalt`}>−</button><b>{item.quantity}</b><button type="button" disabled={Boolean(pendingQuick)} onClick={() => updateQuickCartQty(item.id, 1)} aria-label={`${item.product.name} artır`}>+</button></div>
      </div>)}</div>
    </section>}
    {quickOptionProduct && <div className="waiter-modal-backdrop" role="dialog" aria-modal="true" aria-label={`${quickOptionProduct.name} seçenekleri`}><div className="waiter-custom-modal"><header><h2>{quickOptionProduct.name}</h2><button type="button" className="waiter-modal-close" onClick={() => setQuickOptionProduct(null)} aria-label="Kapat">×</button></header><ProductOptionPicker key={quickOptionProduct.id} firmId={firmId} branchId={branchId} actor="pos-single" productId={quickOptionProduct.id} basePriceMinor={quickOptionProduct.price.amountMinor} onChange={setQuickOptionSelection} /><p>Birim fiyat: {money(quickOptionSelection?.unitPriceMinor ?? quickOptionProduct.price.amountMinor)}</p><footer><button type="button" className="waiter-cancel-custom" onClick={() => setQuickOptionProduct(null)}>Vazgeç</button><button type="button" className="ops-primary" disabled={!quickOptionSelection?.valid} onClick={() => { if (quickOptionSelection?.valid) addToQuickCart(quickOptionProduct, quickOptionSelection.items); setQuickOptionProduct(null); }}>Sepete ekle</button></footer></div></div>}
    {((selected && cashierMode === "tables") || (isQuickPayment && activeCheck)) && <section className="cashier-details" aria-label={isQuickPayment ? "Hızlı satış ve tahsilat detayı" : "Masa ve adisyon detayı"}>
      {splitNotice && <p className="ops-success" role="status">{splitNotice}</p>}
      {selected?.group && <p className="cashier-group-note">Ortak masa grubu: {selected.group.tableNames.join(" + ")} · Ana masa: {selected.name}</p>}
      <div className="cashier-detail-grid">
        <article className="cashier-detail-panel cashier-bill">
          <header className="cashier-bill-header">
            {!isQuickPayment && <span className="cashier-table-number"><small>MASA</small>{selected?.number}</span>}
            <div>
              <h1>{isQuickPayment ? "Hızlı Satış (Gel-Al)" : selected?.name}</h1>
              <span>{activeCheck ? (isQuickPayment ? "1 açık adisyon" : `${selectedChecks.length} açık adisyon`) : "Açık adisyon yok"}</span>
              <span className="cashier-table-meta">{isQuickPayment ? "Kasa: Hızlı Satış Terminali" : `Garson: ${selected?.assignment?.waiterName ?? "Atanmamış"}`}{activeCheck?.createdAt ? ` · Adisyon açılışı: ${new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(activeCheck.createdAt))}` : ""}</span>
            </div>
            <span className="cashier-open-badge">{isQuickPayment ? (activeCheck?.paymentStatus === "partially_paid" ? "Kısmi Ödeme" : "Açık Adisyon") : selected?.status === "bill_requested" ? "Hesap istendi" : activeCheck ? "Açık adisyon" : "Boş"}</span>
          </header>
          {activeCheck && <div className="cashier-balance"><span><strong>KALAN TUTAR</strong><small>{activeCheck.paidMinor > 0 ? "Simüle ödeme düşülmüştür" : "Adisyon bakiyesi"}</small></span><b>{money(activeCheck.remainingMinor)}</b></div>}
          {!isQuickPayment && selectedChecks.length > 0 && <section className="cashier-check-list" aria-label="Masanın açık adisyonları"><div className="cashier-check-list-heading"><strong>MASA ADİSYONLARI</strong><span>{selectedChecks.length} açık</span></div><div className="cashier-table-total"><span>Masa toplamı <small>Açık adisyonların toplamı</small></span><strong>{money(tableTotal)}</strong></div><div className="cashier-table-remaining"><span>Kalan toplam <small>Simüle ödemeler düşülür</small></span><strong>{money(tableRemaining)}</strong></div><div className="cashier-check-list-items">{selectedChecks.map((check, index) => <button type="button" className={`cashier-check-option${activeCheck?.id === check.id ? " selected" : ""}`} key={check.id} aria-pressed={activeCheck?.id === check.id} onClick={() => setSelectedCheckId(check.id)}><span><strong>Adisyon {index + 1}</strong><small className={`cashier-payment-status ${check.paymentStatus}`}>{paymentLabel(check.paymentStatus)}</small></span><b>{money(check.totalMinor)}</b></button>)}</div></section>}

          <div className="cashier-bill-items">{activeCheck ? activeCheck.orders.flatMap((order) => order.items.map((line) => <div className="cashier-bill-line" key={`${order.id}:${line.id}`}><span className="cashier-quantity">{line.quantity}×</span><div><strong>{line.productName}</strong><small>{line.quantity} × {money(line.unitPriceMinor)}</small>{Boolean(line.note || line.options?.length) && <small>{[...(line.options ?? []).map((option) => option.optionName), line.note].filter(Boolean).join(" · ")}</small>}</div><b>{money(line.lineTotalMinor)}</b></div>)) : <p className="cashier-empty">Bu masada açık adisyon bulunmuyor.</p>}</div>
          {activeCheck && <footer className="cashier-bill-footer"><div><span>Ara toplam</span><b>{money(activeCheck.grossTotalMinor)}</b></div>{activeCheck.adjustmentMinor > 0 && <div><span>İndirim / düzeltmeler</span><b>−{money(activeCheck.adjustmentMinor)}</b></div>}{activeCheck.adjustments.length > 0 && <section className="cashier-adjustments"><strong>İşlem detayları</strong>{activeCheck.adjustments.map((adjustment, index) => <div key={adjustment.requestId ?? index}><span>{adjustment.action === "discount" ? "İndirim" : adjustment.action === "comp" ? "İkram" : "Ürün iptali"} · −{money(adjustment.amountMinor)}</span><small>Gerekçe: {adjustment.reason}</small><small>İşlemi yapan: {adjustment.actor ?? "Bilinmiyor"}</small><small>{adjustment.approvalMode === "development_bypass" ? "Yönetici onayı alınmadı (geliştirme)" : "Yönetici onayı bilgisi yok"}</small></div>)}</section>}<div><span>Toplam adisyon tutarı</span><b>{money(activeCheck.totalMinor)}</b></div>{activeCheck.paidMinor > 0 && <div className="cashier-simulated"><span>Simüle ödeme</span><b>{money(activeCheck.paidMinor)}</b></div>}</footer>}
          {activeCheck?.payments.length ? <p className="cashier-action-warning">Ödeme girişimi olan adisyon bölünemez veya indirim/ikram işlemine alınamaz.</p> : null}
          <div className="cashier-bill-actions cashier-action-grid">
            <button className="cashier-split-button" disabled={!isQuickPayment ? (!activeCheck || Boolean(error)) : true} onClick={() => { if (!isQuickPayment && activeCheck) { setSplitCheck(activeCheck); setSplitQuantities({}); setSplitError(""); setSplitNotice(""); } }}>Adisyonu böl</button>
            <button className="cashier-split-button" disabled={!isQuickPayment ? (!selected?.assignment || Boolean(selected?.group) || Boolean(error)) : true} onClick={() => showCashierAction("transfer")}>Masayı taşı</button>
            <button className="cashier-split-button" disabled={!isQuickPayment ? (!selected?.assignment || Boolean(selected?.group) || Boolean(error)) : true} onClick={() => showCashierAction("merge")}>Masaları birleştir</button>
            <button className="cashier-split-button" disabled={!activeCheck || Boolean(error)} onClick={() => showCashierAction("discount")}>İndirim uygula</button>
            <button className="cashier-split-button" disabled={!activeCheck || Boolean(error)} onClick={() => showCashierAction("comp")}>İkram</button>
            <button className="cashier-split-button" disabled={!activeCheck || Boolean(error)} onClick={() => showCashierAction("void")}>Ürün iptali</button>
            <button className="cashier-split-button" disabled={loading} onClick={() => void reload()}>Yenile</button>
          </div>
        </article>
        <article className="cashier-detail-panel cashier-methods"><div className="cashier-panel-heading"><h2>ÖDEME YÖNTEMİ</h2><span>Seçim önizlemesi</span></div><p className="cashier-preview-note">Yöntem seçimi yapılabilir; gerçek tahsilat henüz bağlı değildir.</p><div className="cashier-method-list">{([
          { key: "cash", icon: "₺", name: "Nakit Ödeme", detail: "Nakit tahsilat" },
          { key: "card", icon: "▣", name: "Kredi Kartı / POS", detail: "Banka terminali seçin" },
          { key: "meal", icon: "♜", name: "Yemek Kartı", detail: "Yemek kartı seçin" },
          { key: "cari", icon: "♙", name: "Cariye Yaz (Veresiye)", detail: customerSelected ? customerSelected.name : "Müşteri arayın" },
          { key: "transfer", icon: "⇄", name: "Banka Havalesi / EFT", detail: "Banka hesabı bağlantısı bekleniyor" },
        ] as const).map((method) => <div className={`cashier-method-group ${paymentMethod === method.key ? "selected" : ""}`} key={method.key}><button type="button" className="cashier-method-button" disabled={!activeCheck} aria-pressed={paymentMethod === method.key} onClick={() => { setPaymentMethod(method.key); setPaymentSubMethod(""); if (method.key === "cari") { setCustomerSearch(""); setCustomerOpen(true); } }}><span className="cashier-method-icon">{method.icon}</span><span className="cashier-method-text"><strong>{method.name}</strong><small>{method.detail}</small></span><span className="cashier-method-arrow">›</span></button>{paymentMethod === method.key && (method.key === "card" || method.key === "meal") && <div className="cashier-submethods" aria-label={method.key === "card" ? "Banka POS seçimi" : "Yemek kartı seçimi"}>{(method.key === "card" ? ["Ziraat POS", "VakıfBank POS", "Garanti POS"] : ["Sodexo", "Multinet", "Ticket", "Setcard", "Metropol"]).map((name) => <button type="button" className={paymentSubMethod === name ? "selected" : ""} aria-pressed={paymentSubMethod === name} key={name} onClick={() => setPaymentSubMethod(name)}>{name}</button>)}</div>}</div>)}</div><div className="cashier-payment-history"><div className="cashier-panel-heading"><h2>SİMÜLE ÖDEME GEÇMİŞİ</h2><span>{activeCheck?.payments.length ?? 0} işlem</span></div>{activeCheck?.payments.length ? activeCheck.payments.map((payment) => <div className="cashier-payment-row" key={payment.id}><strong>{money(payment.amountMinor)} · {payment.method === "cash" ? "Nakit" : payment.method === "card" ? "Kart" : payment.method}</strong><small>{payment.createdAt ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(payment.createdAt)) : "Saat bilgisi yok"} · Simülasyon · {payment.status}</small><small>Kasiyer bilgisi bu yanıtta bulunmuyor.</small><button type="button" disabled title="Gerçek ödeme iptali henüz bağlı değil">İptal et</button></div>) : <p>Bu adisyonda simüle ödeme kaydı yok.</p>}</div></article>
        <article className="cashier-detail-panel cashier-keypad-panel"><div className="cashier-amount"><span>{paymentMethod === "cash" ? "ALINAN NAKİT · ÖNİZLEME" : "GİRİLEN TUTAR"}</span><strong aria-live="polite">{activeCheck ? money(amountMinor) : "—"}</strong><small>{activeCheck ? `Adisyonda kalan: ${money(activeCheck.remainingMinor)}` : "Tutar girmek için açık adisyon seçin"}</small></div>{paymentMethod === "cash" && activeCheck && <div className="cashier-change" aria-live="polite"><span>PARA ÜSTÜ <small>Önizleme · tahsilat kaydedilmez</small></span><strong>{money(Math.max(0, amountMinor - activeCheck.remainingMinor))}</strong></div>}<div className="cashier-quick-amounts" aria-label="Hızlı tutarlar">{[{ label: "TAM KALAN", minor: activeCheck?.remainingMinor ?? 0 }, { label: "100 ₺", minor: 10000 }, { label: "200 ₺", minor: 20000 }, { label: "500 ₺", minor: 50000 }, { label: "1.000 ₺", minor: 100000 }].map((item) => <button type="button" disabled={!activeCheck} key={item.label} onClick={() => setAmountInput(`${Math.floor(item.minor / 100)},${String(item.minor % 100).padStart(2, "0")}`)}>{item.label}</button>)}<button type="button" className="cashier-clear-amount" disabled={!activeCheck} onClick={() => enterAmountKey("C")}>Temizle</button></div><div className="cashier-keypad" aria-label="Tutar tuş takımı">{["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"].map((key) => <button type="button" disabled={!activeCheck} key={key} aria-label={key === "C" ? "Tutarı temizle" : key === "⌫" ? "Son karakteri sil" : key === "," ? "Kuruş için virgül" : key} onClick={() => enterAmountKey(key)}>{key}</button>)}</div><button className="cashier-complete" disabled={Boolean(payBlocker) || payBusy || Boolean(error)} onClick={() => { if (isZeroBalance) void closeZeroCheck(); else void submitPayment(); }}>{payBusy ? (isZeroBalance ? "Kapatılıyor…" : "Kaydediliyor…") : isZeroBalance ? "Adisyonu Kapat (0,00 ₺)" : "Tahsilatı tamamla"}</button>{payError && <p className="ops-error" role="alert">{payError}</p>}<p className="cashier-disabled-hint">{isZeroBalance ? "Ödenecek tutar bulunmuyor. Adisyonu kapatıp masayı boşaltmak için butona tıklayın." : (payBlocker || (paymentMethod === "card" && activeCheck && amountMinor > activeCheck.remainingMinor ? `Kart çekimi kalan tutar kadar yapılır: ${money(activeCheck.remainingMinor)}.` : "Demo tahsilat: ödeme simülatörüne kaydedilir; gerçek tahsilat ve kasa hareketi oluşmaz."))}</p></article>
      </div><div className="cashier-detail-footer"><span>Geliştirme ekranı · Gerçek tahsilat yapılmaz</span><button type="button" disabled={!activeCheck || Boolean(error)} onClick={() => { if (activeCheck) printAccountReceipt({ check: activeCheck, location: isQuickPayment ? "Hızlı satış" : selected?.name ?? "Masa", printedAt: new Date().toISOString() }); }}>Hesap fişi yazdır</button><button disabled={!activeCheck || activeCheck.totalMinor > 0 || payBusy || Boolean(error)} title={activeCheck && activeCheck.totalMinor > 0 ? "Önce tahsilatı tamamlayın" : undefined} onClick={() => void closeZeroCheck()}>{payBusy ? "Kaydediliyor…" : "Adisyonu kapat"}</button></div>
    </section>}
    {accountReceipt && <section className="account-receipt print-target" aria-label="Yazdırılacak hesap fişi"><header><strong>HESAP FİŞİ</strong><span>MALİ DEĞERİ YOKTUR</span></header><p>{accountReceipt.location}<br />Adisyon: {accountReceipt.check.id}<br />Tarih: {new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(accountReceipt.printedAt))}</p><div className="account-receipt-items">{accountReceipt.check.orders.flatMap(order => order.items.map(line => <div className="account-receipt-line" key={`${order.id}:${line.id}`}><span><strong>{line.productName}</strong><small>{line.quantity} × {money(line.unitPriceMinor)}</small>{Boolean(line.options?.length || line.note) && <small>{[...(line.options ?? []).map(option => option.optionName), line.note].filter(Boolean).join(" · ")}</small>}</span><b>{money(line.lineTotalMinor)}</b></div>))}</div><div className="account-receipt-totals"><div><span>Ara toplam</span><b>{money(accountReceipt.check.grossTotalMinor)}</b></div>{accountReceipt.check.adjustmentMinor > 0 && <div><span>İndirim / düzeltme</span><b>−{money(accountReceipt.check.adjustmentMinor)}</b></div>}<div><span>Toplam</span><b>{money(accountReceipt.check.totalMinor)}</b></div>{accountReceipt.check.paidMinor > 0 && <div><span>Simüle ödeme</span><b>{money(accountReceipt.check.paidMinor)}</b></div>}<div><strong>Kalan tutar</strong><b>{money(accountReceipt.check.remainingMinor)}</b></div></div><p className="account-receipt-disclaimer">Bu belge mali fiş değildir. Test ödemeleri gerçek tahsilat değildir.</p></section>}
    <dialog ref={customerDialog} className="waiter-reservation-dialog" aria-labelledby="cashier-customer-title" onCancel={() => setCustomerOpen(false)} onClose={() => setCustomerOpen(false)}>
      {customerOpen && <section className="waiter-custom-modal"><header><div><span className="ops-eyebrow">CARİYE YAZ · ÖNİZLEME</span><h2 id="cashier-customer-title">Müşteri ara</h2></div><button type="button" className="waiter-modal-close" onClick={() => setCustomerOpen(false)} aria-label="Kapat">×</button></header><label className="waiter-note-field">Ad veya telefon<input autoFocus type="search" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Müşteri adı veya telefonu" /></label><p className="cashier-preview-note">Cari limit kontrolü ve hesaba yazma henüz bağlı değildir.</p>{customerLoading && <p className="ops-message">Müşteriler yükleniyor…</p>}{customerError && <p className="ops-error" role="alert">{customerError}</p>}
      {!customerLoading && !customerError && <div className="cashier-customer-list">{customers.filter((customer) => { const query = customerSearch.trim().toLocaleLowerCase("tr-TR"); const digits = query.replace(/\D/g, ""); return !query || customer.name.toLocaleLowerCase("tr-TR").includes(query) || (digits.length > 0 && (customer.phone ?? "").replace(/\D/g, "").includes(digits)); }).map((customer) => <button type="button" key={customer.id} onClick={() => { setCustomerSelected(customer); setCustomerOpen(false); }}><span><strong>{customer.name}</strong><small>{customer.phone ?? "Telefon yok"}</small></span><span><strong>{customer.customerBalanceMinor > 0 ? "Borç" : customer.customerBalanceMinor < 0 ? "Alacak" : "Bakiye"}: {money(Math.abs(customer.customerBalanceMinor))}</strong><small>Limit bilgisi yok</small></span></button>)}{customers.filter((customer) => { const query = customerSearch.trim().toLocaleLowerCase("tr-TR"); const digits = query.replace(/\D/g, ""); return !query || customer.name.toLocaleLowerCase("tr-TR").includes(query) || (digits.length > 0 && (customer.phone ?? "").replace(/\D/g, "").includes(digits)); }).length === 0 && <p className="ops-message">Eşleşen aktif müşteri bulunamadı.</p>}</div>}<footer><button type="button" className="waiter-cancel-custom" onClick={() => setCustomerOpen(false)}>Kapat</button></footer></section>}
    </dialog>
    <dialog ref={actionDialog} className="waiter-reservation-dialog" aria-labelledby="cashier-action-title" onCancel={(event) => { if (actionBusy) event.preventDefault(); else setCashierAction(null); }} onClose={() => setCashierAction(null)}>
      {cashierAction && <form className="waiter-custom-modal" onSubmit={(event) => void submitCashierAction(event)}><header><div><span className="ops-eyebrow">{selected?.name}</span><h2 id="cashier-action-title">{cashierAction === "transfer" ? "Masayı taşı" : cashierAction === "merge" ? "Masaları birleştir" : cashierAction === "discount" ? "İndirim uygula" : cashierAction === "comp" ? "Ürün ikramı" : "Ürün iptali"}</h2></div><button type="button" className="waiter-modal-close" disabled={actionBusy} onClick={() => setCashierAction(null)} aria-label="Kapat">×</button></header>
      {cashierAction === "transfer" && <><p className="waiter-action-description">Masanın açık hesapları seçilen boş masaya taşınır.</p><label className="waiter-note-field">Boş hedef masa<select value={actionTarget} onChange={(event) => setActionTarget(event.target.value)} disabled={actionBusy}><option value="">Masa seçin</option>{transferOptions.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label></>}
      {cashierAction === "merge" && <><p className="waiter-action-description">Seçilen masaların hesapları bu masada birleştirilir. Ödeme girişimi veya indirim/ikram olan hesaplar birleştirilemez.</p><fieldset className="waiter-action-source-list"><legend>Birleştirilecek masalar</legend>{mergeOptions.map((table) => <label key={table.id}><input type="checkbox" disabled={actionBusy} checked={actionSources.includes(table.id)} onChange={(event) => setActionSources((current) => event.target.checked ? [...current, table.id] : current.filter((id) => id !== table.id))} /><span><strong>{table.name}</strong><small>{money(table.assignment!.totalMinor)}</small></span></label>)}{mergeOptions.length === 0 && <p>Birleştirilecek açık masa bulunmuyor.</p>}</fieldset></>}
      {(cashierAction === "discount" || cashierAction === "comp" || cashierAction === "void") && <><p className="waiter-adjustment-dev-note">Geliştirme ortamında yönetici onayı alınmadan uygulanır. Gerçek yönetici onayı henüz bağlı değildir.</p>{activeCheck?.payments.length ? <p className="ops-error">Ödeme girişimi olan adisyona bu işlem uygulanamaz.</p> : null}{cashierAction === "discount" ? <><label className="waiter-note-field">İndirim türü<select value={actionValueType} onChange={(event) => setActionValueType(event.target.value as "percentage" | "fixed")} disabled={actionBusy}><option value="percentage">Yüzde</option><option value="fixed">Sabit tutar (TL)</option></select></label><label className="waiter-note-field">{actionValueType === "percentage" ? "İndirim oranı (%)" : "İndirim tutarı (TL)"}<input inputMode="decimal" value={actionValue} onChange={(event) => setActionValue(event.target.value)} disabled={actionBusy} /></label></> : <><label className="waiter-note-field">Ürün<select value={actionLine} onChange={(event) => { setActionLine(event.target.value); setActionQuantity(1); }} disabled={actionBusy}><option value="">Ürün seçin</option>{cashierActionLines.map((line) => <option key={line.id} value={line.id}>{line.quantity} × {line.productName}</option>)}</select></label><label className="waiter-note-field">Adet<input type="number" min="1" step="1" max={cashierActionLines.find((line) => String(line.id) === actionLine)?.quantity ?? 1} value={actionQuantity} onChange={(event) => setActionQuantity(Number(event.target.value))} disabled={actionBusy} /></label></>}<label className="waiter-note-field">Gerekçe<input required maxLength={500} value={actionReason} onChange={(event) => setActionReason(event.target.value)} disabled={actionBusy} /></label></>}
      {actionError && <p className="ops-error" role="alert">{actionError}</p>}<footer><button type="button" className="waiter-cancel-custom" disabled={actionBusy} onClick={() => setCashierAction(null)}>Vazgeç</button><button type="submit" className="ops-primary" disabled={actionBusy || Boolean((cashierAction === "discount" || cashierAction === "comp" || cashierAction === "void") && activeCheck?.payments.length)}>{actionBusy ? "Kaydediliyor…" : "İşlemi uygula"}</button></footer></form>}
    </dialog>
    <dialog ref={splitDialog} className="waiter-reservation-dialog" aria-labelledby="cashier-split-title" onCancel={(event) => { if (splitting) event.preventDefault(); else setSplitCheck(null); }} onClose={() => setSplitCheck(null)}>
      {splitCheck && <div className="waiter-custom-modal"><header><div><span className="ops-eyebrow">{selected?.name}</span><h2 id="cashier-split-title">Adisyonu böl</h2></div><button className="waiter-modal-close" disabled={splitting} onClick={() => setSplitCheck(null)} aria-label="Kapat">×</button></header>
        <p className="waiter-action-description">Yeni adisyona aktarılacak ürün miktarlarını seçin. Kaynak adisyonda en az bir ürün kalmalıdır.</p>
        <div className="waiter-split-lines">{splitLines.map((line) => <label key={line.id}><span><strong>{line.productName}</strong><small>Mevcut: {line.quantity} · {money(line.unitPriceMinor)} / adet</small>{Boolean(line.note || line.options?.length) && <small>{[...(line.options ?? []).map((option) => option.optionName), line.note].filter(Boolean).join(" · ")}</small>}</span><input aria-label={`${line.productName} bölünecek miktar`} type="number" min="0" max={line.quantity} step="1" disabled={splitting} value={splitQuantities[line.id] ?? 0} onChange={(event) => { const quantity = Math.max(0, Math.min(line.quantity, Math.floor(Number(event.target.value) || 0))); setSplitQuantities((current) => ({ ...current, [line.id]: quantity })); setSplitError(""); }} /></label>)}</div>
        <div className="waiter-split-total"><span>Yeni adisyon tutarı</span><strong>{money(splitTotal)}</strong></div>
        {splitCheck.payments.length > 0 && <p className="ops-error">Ödeme girişimi olan adisyon bölünemez.</p>}
        {splitCheck.adjustments.length > 0 && <p className="ops-error">İndirim, ikram veya iptal işlemi olan adisyon bölünemez.</p>}
        {splitError && <p className="ops-error" role="alert">{splitError}</p>}
        <footer><button className="waiter-cancel-custom" disabled={splitting} onClick={() => setSplitCheck(null)}>Vazgeç</button><button className="ops-primary" disabled={splitting || splitCheck.payments.length > 0 || splitCheck.adjustments.length > 0 || splitTotal <= 0 || splitTotal >= splitCheck.totalMinor} onClick={() => void submitCashierSplit()}>{splitting ? "Bölünüyor…" : "Adisyonu böl"}</button></footer>
      </div>}
    </dialog>
  </main>;
}

export function WaiterApp() {
  const [products, setProducts] = useState<Product[]>([]);
  const [menus, setMenus] = useState<RestaurantMenu[]>([]);
  const [selectedMenuId, setSelectedMenuId] = useState("");
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
        request<{ items: Table[] }>(`${servicePath}/tables`, "pos-single"),
        request<{ items: Waiter[] }>(`${servicePath}/waiters`, "pos-single"),
        request<MenuWorkspace>(`/api/v1/firms/${firmId}/branches/${branchId}/catalog/menus`, "pos-single"),
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
      const activeMenus = menuResult.items.filter((menu) => menu.isActive);
      const categoryNames = new Map(menuResult.categories.map((category) => [category.id, category.name]));
      setMenus(activeMenus);
      setSelectedMenuId((current) => activeMenus.some((menu) => menu.id === current) ? current : activeMenus[0]?.id ?? "");
      setProducts(menuResult.products.map((product) => ({
        ...product, category: { id: product.categoryId, name: categoryNames.get(product.categoryId) ?? "Kategorisiz" },
      })));
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
  const selectedMenu = menus.find((menu) => menu.id === selectedMenuId);
  const menuSections = selectedMenu?.sections ?? [];
  const selectedMenuProductIds = new Set(menuSections.flatMap((section) => section.productIds));
  const cartRows = useMemo(() => cart.flatMap((line) => {
    const product = products.find((item) => item.id === line.productId);
    return product ? [{ ...product, ...line }] : [];
  }), [products, cart]);
  const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR");
  const catalogGroups = normalizedSearch
    ? [{ sectionId: "search-results", name: "Arama sonuçları", products: products.filter((product) => selectedMenuProductIds.has(product.id) && product.isActive && product.status === "published" && product.channels.includes("pos") && product.name.toLocaleLowerCase("tr-TR").includes(normalizedSearch)) }]
    : menuSections.map((section) => ({ ...section, products: products.filter((product) => section.productIds.includes(product.id) && product.isActive && product.status === "published" && product.channels.includes("pos")) }));
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

  async function sendOrder() {
    if (!selectedTable || !waiter || cartRows.length === 0 || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const orderId = retryOrderId ?? createRequestId();
      setRetryOrderId(orderId);
      const result = await request<{ order: { id: string }; table: string; waiter: string }>(
        `${servicePath}/tables/${encodeURIComponent(selectedTable.id)}/orders`, "pos-single",
        { orderId, waiterId: waiter.id, items: cartRows.map((item) => ({ productId: item.id, quantity: item.quantity, note: item.note || null, options: item.options.map(option => ({ groupId: option.groupId, optionId: option.optionId, quantity: option.quantity })) })) });
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
    {([ { key: "lower", label: "Alt kat" }, { key: "upper", label: "Üst kat" }, { key: "unassigned", label: "Katı belirlenmemiş masalar" } ] as const).map((floor) => {
      const floorTables = tables.filter((item) => (item.floor ?? "unassigned") === floor.key);
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
      {!loading && menuSections.length === 0 && !error && <p className="ops-message">Bu şubede POS’ta kullanılabilir aktif menü bulunmuyor.</p>}
      {getTableStatus(selectedTable) !== "reserved" && waiter && !assignedToOtherWaiter && menuSections.length > 0 && <>
      <div className="waiter-catalog-heading"><h2 className="waiter-catalog-title">{menus.length > 1 ? "Menü seçin" : selectedMenu?.name ?? "Menü"}</h2>
        {menus.length > 1 && <label className="waiter-menu-select">Aktif menü
          <select aria-label="POS aktif menüsü" value={selectedMenuId} onChange={(event) => {
            setSelectedMenuId(event.target.value); setCategoryId(null); setSearch("");
          }}>{menus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name}</option>)}</select>
        </label>}
      </div>
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
            : <section className="ops-product-grid waiter-menu-grid" aria-label={`${group.name} ürünleri`}>{group.products.map((product) => <article className="ops-product waiter-product" key={product.id}>
              <div className="waiter-product-main"><span className="waiter-product-image" aria-hidden="true"><PosProductImage image={product.image} productId={product.id} name={product.name} /></span><div><strong>{product.name}</strong><span>{demoDescriptions[product.id] ?? product.category.name}</span></div></div>
              <div className="waiter-product-bottom"><strong>{money(product.price.amountMinor)}</strong><button className="waiter-add-product" disabled={saving} onClick={() => openCustomization(product)}>＋ <span>Ekle</span></button></div>
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
        {notice && <p className="ops-success" role="status">{notice}{lastOrderId && <small> Sipariş: {lastOrderId.slice(0, 8)}</small>}</p>}
      </section></>}
      {customizingProduct && <div className="waiter-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCustomization(); }}><section className="waiter-custom-modal" role="dialog" aria-modal="true" aria-labelledby="customize-title"><header><div><span className="ops-eyebrow">ÜRÜNÜ DÜZENLE</span><h2 id="customize-title">{customizingProduct.name}</h2></div><button className="waiter-modal-close" onClick={closeCustomization} aria-label="Kapat">×</button></header>
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
  if (path !== "/waiter" && path !== "/kitchen" && path !== "/cashier") return false;
  createRoot(document.getElementById("root")!).render(path === "/waiter" ? <WaiterApp /> : path === "/cashier" ? <CashierApp /> : <KitchenApp />);
  return true;
}
