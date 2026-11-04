import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  CreditCard,
  Filter,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import type { ViewContext } from "../../app/context";
import { MetricCard, PageHeading, StatusPill } from "../../shared/ui";

type Register = {
  id: string;
  code: string;
  name: string;
  providerMode: string;
  isActive: boolean;
  responsible?: string | null;
};
type CashResponsible = {
  id: string;
  name: string;
  roleTitle?: string | null;
  createdAt: string;
};
type Shift = {
  id: string;
  registerId: string;
  status: "open" | "closed";
  openingCashMinor: number;
  expectedCashMinor: number | null;
  countedCashMinor: number | null;
  differenceMinor: number | null;
  retainedFloatMinor?: number | null;
  droppedRevenueMinor?: number | null;
  openedBy: string;
  openedAt: string;
  closedBy: string | null;
  closedAt: string | null;
  closeNote: string | null;
  version: number;
  openingNote?: string | null;
  denominations?: { denominationMinor: number; quantity: number; totalMinor: number }[];
};

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
type Movement = {
  id: string;
  registerId: string;
  shiftId: string;
  kind: string;
  category: string;
  amountMinor: number;
  currency: string;
  description: string;
  source: string;
  actor: string;
  createdAt: string;
  tenderMethod?: string | null;
  provider?: string | null;
  externalReference?: string | null;
  originalMovementId: string | null;
  correctionType: string | null;
  correctionReason: string | null;
};
type OpenShift = {
  shift: Shift;
  cashInMinor: number;
  cashOutMinor: number;
  movementCount: number;
  recentMovements: Movement[];
};
type Overview = {
  source: string;
  simulated: boolean;
  registers: Register[];
  responsibles?: CashResponsible[];
  openShifts: OpenShift[];
};
type DailyCollections = {
  date: string;
  cashMinor: number;
  cardMinor: number;
  totalMinor: number;
  count: number;
};
type ShiftPage = { items: Shift[]; total: number };
type MovementPage = { items: Movement[]; total: number };
type View = "summary" | "registers" | "movements" | "shifts" | "cash" | "card" | "opening-closing";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
const cashDenominations = [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 25, 10, 5, 1];
const money = (value: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
type SalesMovement = Pick<Movement, "id" | "kind" | "category" | "tenderMethod" | "createdAt" | "correctionType" | "originalMovementId" | "registerId" | "amountMinor">;
export function validRegisterSales<T extends SalesMovement>(movements: T[], registerId: string): T[] {
  const reversed = new Set(movements.filter((m) => m.registerId === registerId && m.correctionType === "reversal").map((m) => m.originalMovementId));
  return movements.filter((m) => m.registerId === registerId && !reversed.has(m.id) && m.correctionType !== "reversal" &&
    ((m.kind === "pos_sale" && (m.tenderMethod === "cash" || m.tenderMethod === "card")) || (m.kind === "manual_in" && m.category === "cash_sale")));
}
export function cardSalesToday<T extends Pick<Movement, "kind" | "tenderMethod" | "createdAt">>(movements: T[], now: Date): T[] {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" });
  const today = day.format(now);
  return movements.filter((m) => m.kind === "pos_sale" && m.tenderMethod === "card" && day.format(new Date(m.createdAt)) === today);
}
export function validCashSalesToday<T extends Pick<Movement, "id" | "kind" | "category" | "tenderMethod" | "createdAt" | "correctionType" | "originalMovementId">>(movements: T[], now: Date): T[] {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" });
  const reversed = new Set(movements.filter((m) => m.correctionType === "reversal").map((m) => m.originalMovementId));
  return movements.filter((m) => day.format(new Date(m.createdAt)) === day.format(now) && !reversed.has(m.id) &&
    ((m.kind === "pos_sale" && m.tenderMethod === "cash") || (m.kind === "manual_in" && m.category === "cash_sale" && m.correctionType !== "reversal")));
}
const amountMinor = (value: string) => {
  const trimmed = value.trim().replace(/\s/g, "");
  const normalized = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)
    ? trimmed.replaceAll(".", "").replace(",", ".")
    : trimmed.replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : NaN;
};
const titleFor: Record<View, string> = {
  summary: "Kasa özeti",
  registers: "Mevcut Kasalar",
  movements: "Kasa hareketleri",
  shifts: "Kasa vardiyaları",
  cash: "Nakit Tahsilat & Kasa Akışı",
  card: "Banka & Kredi Kartı Tahsilatları",
  "opening-closing": "Vardiya açılış / kapanış",
};

const movementTitle = (movement: Movement) => {
  if (movement.correctionType === "reversal") return "Ters kayıt düzeltmesi";
  if (movement.kind === "opening_float") return "Açılış nakdi (Kasa avansı)";
  if (movement.kind === "pos_sale") return `Adisyon tahsilatı (${movement.tenderMethod === "card" ? "Kart" : "Nakit"})`;
  if (movement.kind === "manual_in") {
    if (movement.category === "cash_sale") return "Nakit satış girişi";
    if (movement.category === "other") return "Kasa avans / Takviye";
    return "Nakit girişi";
  }
  if (movement.kind === "manual_out") {
    if (movement.category === "expense") return "İşletme gideri / Masraf";
    if (movement.category === "cash_drop") return "Kasadan teslim (Safe drop)";
    return "Nakit çıkışı";
  }
  return "Kasa hareketi";
};

function shiftDuration(openedAt: string): string {
  const diffMs = Math.max(0, Date.now() - new Date(openedAt).getTime());
  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 2) return "Az önce açıldı";
  if (minutes < 60) return `${minutes} dakikadır açık`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours} sa ${remMinutes} dk'dır açık` : `${hours} saattir açık`;
}

function renderDifferencePill(diffMinor: number | null) {
  if (diffMinor === null || diffMinor === 0) {
    return <StatusPill tone="green">Kasa tam dengede</StatusPill>;
  }
  if (diffMinor < 0) {
    return <StatusPill tone="orange">Kasa açığı: {money(Math.abs(diffMinor))}</StatusPill>;
  }
  return <StatusPill tone="blue">Kasa fazlası: +{money(diffMinor)}</StatusPill>;
}

export function CashManagementPage({ ctx, view, canWrite }: { ctx: ViewContext; view: View; canWrite: boolean }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedRegisterId, setSelectedRegisterId] = useState<string>("");
  const [showCreateRegister, setShowCreateRegister] = useState<boolean>(false);
  const [showResponsiblesPanel, setShowResponsiblesPanel] = useState<boolean>(false);
  const [newRegisterName, setNewRegisterName] = useState<string>("");
  const [newRegisterResponsible, setNewRegisterResponsible] = useState<string>("");
  const [newResponsibleName, setNewResponsibleName] = useState<string>("");
  const [newResponsibleRole, setNewResponsibleRole] = useState<string>("");
  const [editingResponsibles, setEditingResponsibles] = useState<Record<string, string>>({});
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [dailyCollections, setDailyCollections] = useState<DailyCollections | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [allSalesMovements, setAllSalesMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openingCash, setOpeningCash] = useState("");
  const [openingNote, setOpeningNote] = useState("");
  const [movementKind, setMovementKind] = useState<"manual_in" | "manual_out">("manual_in");
  const [movementCategory, setMovementCategory] = useState("cash_sale");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementDescription, setMovementDescription] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [denominationCounts, setDenominationCounts] = useState<Record<number, number>>({});
  const [closeNote, setCloseNote] = useState("");
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [cashRegisterFilter, setCashRegisterFilter] = useState<string>("");
  const [cashTypeFilter, setCashTypeFilter] = useState<"all" | "sales" | "in" | "out" | "reversal">("all");
  const [cashSearch, setCashSearch] = useState<string>("");
  const [cardRegisterFilter, setCardRegisterFilter] = useState<string>("");
  const [cardSearch, setCardSearch] = useState<string>("");
  const [cardProviderFilter, setCardProviderFilter] = useState<string>("all");
  const [retainedFloat, setRetainedFloat] = useState<string>("");
  const [activeZReport, setActiveZReport] = useState<ZReport | null>(null);
  const [zReportLoading, setZReportLoading] = useState(false);

  const actor = ctx.isMulti ? "manager-multi" : "manager-single";
  const scope = ctx.branchApiId
    ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(ctx.branchApiId)}/cash`
    : null;

  async function openZReport(shiftId: string) {
    if (!scope) return;
    setZReportLoading(true);
    try {
      const res = await api<{ report: ZReport }>(`${scope}/shifts/${encodeURIComponent(shiftId)}/z-report`);
      setActiveZReport(res.report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Z-Raporu yüklenemedi.");
    } finally {
      setZReportLoading(false);
    }
  }

  const responsibleList = useMemo<CashResponsible[]>(() => {
    const saved = overview?.responsibles ?? [];
    const byName = new Map<string, CashResponsible>();
    for (const item of saved) {
      byName.set(item.name.toLocaleLowerCase("tr-TR"), item);
    }
    for (const reg of overview?.registers ?? []) {
      if (reg.responsible && !byName.has(reg.responsible.toLocaleLowerCase("tr-TR"))) {
        byName.set(reg.responsible.toLocaleLowerCase("tr-TR"), {
          id: reg.id,
          name: reg.responsible,
          roleTitle: "Atanmış Kasa Sorumlusu",
          createdAt: new Date().toISOString(),
        });
      }
    }
    return Array.from(byName.values());
  }, [overview]);

  const selectedRegister = useMemo(() => {
    if (!overview?.registers.length) return null;
    return overview.registers.find((reg) => reg.id === selectedRegisterId) ?? overview.registers[0];
  }, [overview, selectedRegisterId]);

  const active = useMemo(() => {
    if (!overview || !selectedRegister) return null;
    return overview.openShifts.find((openShift) => openShift.shift.registerId === selectedRegister.id) ?? null;
  }, [overview, selectedRegister]);

  const registerShifts = useMemo(
    () => shifts.filter((shift) => !selectedRegister || shift.registerId === selectedRegister.id),
    [shifts, selectedRegister],
  );

  const registerMovements = useMemo(
    () => movements.filter((movement) => !selectedRegister || movement.registerId === selectedRegister.id),
    [movements, selectedRegister],
  );

  // Seçili kasaya ait satış hareketleri ve toplamları
  const registerSalesMovements = useMemo(() => validRegisterSales(allSalesMovements, selectedRegisterId), [allSalesMovements, selectedRegisterId]);

  const registerCashSalesMinor = useMemo(
    () =>
      registerSalesMovements
        .filter((m) => (m.kind === "pos_sale" && m.tenderMethod === "cash") || (m.kind === "manual_in" && m.category === "cash_sale"))
        .reduce((sum, m) => sum + m.amountMinor, 0),
    [registerSalesMovements],
  );

  const registerCardSalesMinor = useMemo(
    () =>
      registerSalesMovements
        .filter((m) => m.kind === "pos_sale" && m.tenderMethod === "card")
        .reduce((sum, m) => sum + m.amountMinor, 0),
    [registerSalesMovements],
  );

  const registerTotalSalesMinor = registerCashSalesMinor + registerCardSalesMinor;
  const selectedRegisterTotalSales = registerTotalSalesMinor;

  const cashPercent = dailyCollections && dailyCollections.totalMinor > 0
    ? Math.round((dailyCollections.cashMinor / dailyCollections.totalMinor) * 100)
    : 0;
  const cardPercent = dailyCollections && dailyCollections.totalMinor > 0
    ? Math.max(0, 100 - cashPercent)
    : 0;

  // Açık vardiyaların defterden hesaplanan beklenen nakit toplamı.
  const totalDrawerCashMinor = useMemo(() => {
    if (!overview?.openShifts || overview.openShifts.some((s) => s.shift.expectedCashMinor === null)) return null;
    return overview.openShifts.reduce((sum, s) => sum + (s.shift.expectedCashMinor ?? 0), 0);
  }, [overview]);

  // Nakit Sayfası: Sadece nakit hareketleri (kartlı POS satışları hariç)
  const allCashMovements = useMemo(() => {
    return allSalesMovements.filter((m) => !(m.kind === "pos_sale" && m.tenderMethod === "card"));
  }, [allSalesMovements]);

  // Nakit satış hareketleri (pos_sale cash veya manual_in cash_sale)
  const cashSalesMovements = useMemo(() => {
    return allCashMovements.filter(
      (m) => (m.kind === "pos_sale" && m.tenderMethod === "cash") || (m.kind === "manual_in" && m.category === "cash_sale"),
    );
  }, [allCashMovements]);

  const todayCashSales = useMemo(() => {
    return validCashSalesToday(allCashMovements, updatedAt ?? new Date());
  }, [allCashMovements, updatedAt]);
  const cashSalesMinorTotal = todayCashSales.reduce((sum, m) => sum + m.amountMinor, 0);
  const averageCashTicketMinor = todayCashSales.length ? Math.round(cashSalesMinorTotal / todayCashSales.length) : 0;

  // Filtrelenmiş nakit hareketleri
  const filteredCashMovements = useMemo(() => {
    return allCashMovements.filter((m) => {
      if (cashRegisterFilter && m.registerId !== cashRegisterFilter) return false;
      if (cashTypeFilter === "sales") {
        if (!(m.kind === "pos_sale" || (m.kind === "manual_in" && m.category === "cash_sale"))) return false;
      } else if (cashTypeFilter === "in") {
        if (!(m.kind === "opening_float" || (m.kind === "manual_in" && m.category !== "cash_sale"))) return false;
      } else if (cashTypeFilter === "out") {
        if (m.kind !== "manual_out") return false;
      } else if (cashTypeFilter === "reversal") {
        if (m.correctionType !== "reversal") return false;
      }
      if (cashSearch.trim()) {
        const q = cashSearch.trim().toLocaleLowerCase("tr-TR");
        const reg = overview?.registers.find((r) => r.id === m.registerId);
        const matchTitle = movementTitle(m).toLocaleLowerCase("tr-TR").includes(q);
        const matchDesc = (m.description ?? "").toLocaleLowerCase("tr-TR").includes(q);
        const matchActor = (m.actor ?? "").toLocaleLowerCase("tr-TR").includes(q);
        const matchReg = (reg?.name ?? "").toLocaleLowerCase("tr-TR").includes(q);
        if (!matchTitle && !matchDesc && !matchActor && !matchReg) return false;
      }
      return true;
    });
  }, [allCashMovements, cashRegisterFilter, cashTypeFilter, cashSearch, overview]);

  // Filtrelenmiş liste için giriş/çıkış ve net toplamlar
  const filteredCashTotals = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    for (const m of filteredCashMovements) {
      if (m.kind === "manual_out") {
        totalOut += m.amountMinor;
      } else {
        totalIn += m.amountMinor;
      }
    }
    return { inMinor: totalIn, outMinor: totalOut, netMinor: totalIn - totalOut };
  }, [filteredCashMovements]);

  // Kart Sayfası: Yalnızca kartlı POS satış hareketleri
  const allCardMovements = useMemo(() => {
    return allSalesMovements.filter((m) => m.kind === "pos_sale" && m.tenderMethod === "card");
  }, [allSalesMovements]);

  const todayCardSales = useMemo(() => cardSalesToday(allCardMovements, updatedAt ?? new Date()), [allCardMovements, updatedAt]);
  const cardSalesMinorTotal = todayCardSales.reduce((sum, m) => sum + m.amountMinor, 0);
  const cardSalesCount = todayCardSales.length;
  const averageCardTicketMinor = cardSalesCount ? Math.round(cardSalesMinorTotal / cardSalesCount) : 0;

  // Filtrelenmiş kart hareketleri
  const filteredCardMovements = useMemo(() => {
    return allCardMovements.filter((m) => {
      if (cardRegisterFilter && m.registerId !== cardRegisterFilter) return false;
      if (cardProviderFilter !== "all") {
        const prov = (m.provider ?? "").toLocaleLowerCase("tr-TR");
        const desc = (m.description ?? "").toLocaleLowerCase("tr-TR");
        if (!prov.includes(cardProviderFilter.toLocaleLowerCase("tr-TR")) && !desc.includes(cardProviderFilter.toLocaleLowerCase("tr-TR"))) return false;
      }
      if (cardSearch.trim()) {
        const q = cardSearch.trim().toLocaleLowerCase("tr-TR");
        const reg = overview?.registers.find((r) => r.id === m.registerId);
        const matchTitle = movementTitle(m).toLocaleLowerCase("tr-TR").includes(q);
        const matchDesc = (m.description ?? "").toLocaleLowerCase("tr-TR").includes(q);
        const matchActor = (m.actor ?? "").toLocaleLowerCase("tr-TR").includes(q);
        const matchReg = (reg?.name ?? "").toLocaleLowerCase("tr-TR").includes(q);
        const matchProv = (m.provider ?? "").toLocaleLowerCase("tr-TR").includes(q);
        if (!matchTitle && !matchDesc && !matchActor && !matchReg && !matchProv) return false;
      }
      return true;
    });
  }, [allCardMovements, cardRegisterFilter, cardProviderFilter, cardSearch, overview]);

  const filteredCardTotalMinor = useMemo(() => {
    return filteredCardMovements.reduce((sum, m) => sum + m.amountMinor, 0);
  }, [filteredCardMovements]);

  const api = useCallback(async <T,>(path: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        method,
        headers: { "X-Demo-Actor": actor, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error("Kasa bilgilerine şu anda ulaşılamıyor. Lütfen tekrar deneyin.");
    }
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { detail?: string };
      throw new Error(problem.detail ?? `Kasa işlemi başarısız (${response.status}).`);
    }
    return response.json() as Promise<T>;
  }, [actor]);

  const reload = useCallback(async () => {
    if (!scope) { setLoading(false); setError("Önce tek bir şube seçin."); return; }
    setLoading(true); setError("");
    try {
      const [overviewResult, shiftResult, movementResult, dailyResult] = await Promise.all([
        api<Overview>(`${scope}/overview`),
        api<ShiftPage>(`${scope}/shifts?page=1&pageSize=100`),
        api<MovementPage>(`${scope}/movements?page=1&pageSize=100`),
        api<DailyCollections>(`${scope.replace("/cash", "/sales")}/daily-collections`).catch(() => null),
      ]);
      const remainingPages = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(movementResult.total / 100) - 1) }, (_, index) =>
        api<MovementPage>(`${scope}/movements?page=${index + 2}&pageSize=100`)));
      setOverview(overviewResult);
      setSelectedRegisterId((prev) =>
        overviewResult.registers.some((reg) => reg.id === prev)
          ? prev
          : (overviewResult.registers[0]?.id ?? ""),
      );
      const initialResponsibles: Record<string, string> = {};
      for (const reg of overviewResult.registers) {
        initialResponsibles[reg.id] = reg.responsible ?? "";
      }
      setEditingResponsibles(initialResponsibles);
      setNewRegisterResponsible((prev) => {
        if (prev && (overviewResult.responsibles ?? []).some((r) => r.name === prev)) return prev;
        return overviewResult.responsibles?.[0]?.name ?? "";
      });
      setShifts(shiftResult.items);
      setMovements(movementResult.items);
      setAllSalesMovements([movementResult, ...remainingPages].flatMap((page) => page.items));
      setDailyCollections(dailyResult);
      setUpdatedAt(new Date());
      setLoading(false);
    } catch (reason) {
      setOverview(null);
      setShifts([]);
      setMovements([]);
      setAllSalesMovements([]);
      setDailyCollections(null);
      setUpdatedAt(null);
      setError((reason as Error).message);
      setLoading(false);
    }
  }, [api, scope]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setMovementCategory(movementKind === "manual_in" ? "cash_sale" : "expense"); }, [movementKind]);

  const run = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); await reload(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  async function addResponsible(event: FormEvent) {
    event.preventDefault();
    if (!scope) return;
    const name = newResponsibleName.trim();
    const roleTitle = newResponsibleRole.trim();
    if (name.length < 2) {
      setError("Sorumlu adı en az 2 karakter olmalıdır.");
      return;
    }
    await run(async () => {
      await api(`${scope}/responsibles`, "POST", {
        requestId: crypto.randomUUID(),
        name,
        roleTitle: roleTitle || null,
      });
      setNewResponsibleName("");
      setNewResponsibleRole("");
      setNewRegisterResponsible((prev) => prev || name);
    }, `"${name}" kasa sorumlusu listesine eklendi.`);
  }

  async function removeResponsible(item: CashResponsible) {
    if (!scope) return;
    const assignedRegisters = (overview?.registers ?? []).filter(
      (reg) => reg.responsible && reg.responsible.toLocaleLowerCase("tr-TR") === item.name.toLocaleLowerCase("tr-TR"),
    );
    if (assignedRegisters.length > 0) {
      const registerNames = assignedRegisters.map((r) => r.name).join(", ");
      const confirmed = window.confirm(
        `"${item.name}" şu anda "${registerNames}" kasasına atanmış durumda.\n\nSorumluyu listeden kaldırırsanız bu kasaların sorumlusu boşa çıkarılacaktır.\n\nSilmek istediğinize emin misiniz?`,
      );
      if (!confirmed) return;
    }
    await run(async () => {
      await api(`${scope}/responsibles/${encodeURIComponent(item.id)}/delete`, "POST", {
        requestId: crypto.randomUUID(),
      });
    }, `"${item.name}" kasa sorumluları listesinden kaldırıldı.`);
  }

  async function createRegister(event: FormEvent) {
    event.preventDefault();
    if (!scope) return;
    const name = newRegisterName.trim();
    const responsible = newRegisterResponsible.trim();
    if (name.length < 2) {
      setError("Kasa adı en az 2 karakter olmalıdır.");
      return;
    }
    if (responsible.length < 2) {
      setError("Lütfen listeden bir kasa sorumlusu seçin. Liste boşsa önce kasa sorumlusu ekleyin.");
      return;
    }
    let createdId = "";
    await run(async () => {
      const result = await api<{ register: Register }>(`${scope}/registers`, "POST", {
        requestId: crypto.randomUUID(),
        name,
        responsible,
      });
      createdId = result.register.id;
      setNewRegisterName("");
      setShowCreateRegister(false);
    }, `"${name}" kasası (${responsible}) başarıyla açıldı ve tanımlandı.`);
    if (createdId) setSelectedRegisterId(createdId);
  }

  async function updateRegisterResponsible(register: Register) {
    if (!scope) return;
    const nextResponsible = (editingResponsibles[register.id] ?? "").trim();
    if (nextResponsible.length < 2) {
      setError("Lütfen listeden geçerli bir kasa sorumlusu seçin.");
      return;
    }
    await run(async () => {
      await api(`${scope}/registers/${encodeURIComponent(register.id)}/responsible`, "PUT", {
        requestId: crypto.randomUUID(),
        responsible: nextResponsible,
      });
    }, `"${register.name}" kasasının sorumlusu "${nextResponsible}" olarak güncellendi.`);
  }

  async function openShift(event: FormEvent) {
    event.preventDefault();
    if (!scope || !selectedRegister) return;
    const openingCashMinor = amountMinor(openingCash);
    if (!Number.isSafeInteger(openingCashMinor)) { setError("Açılış nakdini geçerli TL tutarı olarak girin."); return; }
    await run(async () => {
      await api(`${scope}/shifts`, "POST", {
        requestId: crypto.randomUUID(),
        registerId: selectedRegister.id,
        openingCashMinor,
        note: openingNote.trim() || null,
      });
      setOpeningCash(""); setOpeningNote("");
    }, "Kasa vardiyası açıldı ve açılış nakdi kaydedildi.");
  }

  async function addMovement(event: FormEvent) {
    event.preventDefault();
    if (!scope || !active) return;
    const amount = amountMinor(movementAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setError("Tutarı sıfırdan büyük geçerli bir sayı olarak girin."); return;
    }
    await run(async () => {
      await api(`${scope}/shifts/${encodeURIComponent(active.shift.id)}/movements`, "POST", {
        requestId: crypto.randomUUID(),
        kind: movementKind,
        amountMinor: amount,
        category: movementCategory,
        description: movementDescription.trim() || undefined,
      });
      setMovementAmount(""); setMovementDescription("");
    }, "Nakit hareketi değiştirilemez kasa defterine kaydedildi.");
  }

  async function closeShift(event: FormEvent) {
    event.preventDefault();
    if (!scope || !active) return;
    const countedCashMinor = amountMinor(countedCash);
    if (!Number.isSafeInteger(countedCashMinor)) { setError("Fiziksel sayımı geçerli TL tutarı olarak girin."); return; }
    const denominations = cashDenominations
      .filter((denominationMinor) => (denominationCounts[denominationMinor] ?? 0) > 0)
      .map((denominationMinor) => ({ denominationMinor, quantity: denominationCounts[denominationMinor] }));
    const denominationTotal = denominations.reduce((sum, item) => sum + item.denominationMinor * item.quantity, 0);
    if (denominations.length > 0 && denominationTotal !== countedCashMinor) { setError("Kupür dökümü toplamı kasada sayılan tutarla aynı olmalı."); return; }
    const retainedMinor = retainedFloat.trim() ? amountMinor(retainedFloat) : undefined;
    const closedShiftId = active.shift.id;
    await run(async () => {
      await api(`${scope}/shifts/${encodeURIComponent(closedShiftId)}/close`, "POST", {
        requestId: crypto.randomUUID(),
        expectedVersion: active.shift.version,
        countedCashMinor,
        note: closeNote.trim() || null,
        retainedFloatMinor: retainedMinor,
        ...(denominations.length > 0 ? { denominations } : {}),
      });
      setCountedCash(""); setDenominationCounts({}); setCloseNote(""); setRetainedFloat("");
      void openZReport(closedShiftId);
    }, "Vardiya kapatıldı; gün sonu Z-Raporu hazırlandı.");
  }

  async function reverseMovement(event: FormEvent) {
    event.preventDefault();
    if (!scope || !correctingId) return;
    const reason = correctionReason.trim();
    if (reason.length < 3 || reason.length > 500) { setError("Düzeltme gerekçesi 3–500 karakter olmalı."); return; }
    const originalId = correctingId;
    await run(async () => {
      await api(`${scope}/movements/${encodeURIComponent(originalId)}/corrections`, "POST", {
        requestId: crypto.randomUUID(), correctionType: "reversal", correctionReason: reason,
      });
      setCorrectingId(null); setCorrectionReason("");
    }, "Ters kayıt yeni hareket olarak eklendi; orijinal kayıt değişmedi.");
  }

  const totalRecent = useMemo(() => registerMovements.slice(0, 8), [registerMovements]);
  const currentExpected = active?.shift.expectedCashMinor ?? 0;
  const displayView = view === "opening-closing" ? "shifts" : view;
  const lastClosedShift = registerShifts.find((shift) => shift.status === "closed");

  const averageCheckMinor = dailyCollections && dailyCollections.count > 0
    ? Math.round(dailyCollections.totalMinor / dailyCollections.count)
    : 0;


  return <>
    <PageHeading
      eyebrow="KASA YÖNETİMİ"
      title={titleFor[view]}
      description={
        view === "registers"
          ? "Şubenizdeki mevcut kasalara tıklayarak o kasanın hareketlerini, satışlarını ve özetini anında inceleyin; yeni kasa açın veya sorumlu atayın."
          : view === "cash"
          ? "Şubenizdeki tüm kasaların anlık çekmece nakit durumunu, günün nakit tahsilat hacmini ve tüm nakit giriş/çıkış hareketlerini inceleyin."
          : view === "card"
          ? "Banka POS terminalleri ve kredi kartı ile yapılan tüm satışları, kasa bazlı kart tahsilat hacmini ve provizyon dökümünü inceleyin."
          : undefined
      }
      action={
        <button className="cash-refresh-button" onClick={() => void reload()} disabled={loading}>
          <RefreshCw size={15} /> Yenile
        </button>
      }
    />
    {error && <div className="notice" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {loading ? (
      <div className="card empty-list">Kasa kayıtları yükleniyor…</div>
    ) : !overview ? (
      <div className="card empty-list">
        <strong>Kasa bilgileri yüklenemedi</strong>
        <span>Bağlantıyı kontrol edip Yenile düğmesiyle tekrar deneyin.</span>
      </div>
    ) : view === "registers" ? (
      /* MEVCUT KASALAR SAYFASI */
      <div className="cash-registers-page">
        {/* 1. Bölüm: Mevcut Kasalar Kart Listesi (Tıklanabilir Kasa Seçimi) */}
        <section className="card cash-panel" aria-label="Mevcut Kasalar Listesi">
          <header className="cash-registers-overview-header">
            <div>
              <span className="eyebrow">ŞUBEDEKİ KASALAR · SEÇMEK İÇİN TIKLAYIN</span>
              <h2>Mevcut Kasalar</h2>
            </div>
            <div className="cash-header-actions-group">
              <StatusPill tone="blue">{overview.registers.length} kayıtlı kasa</StatusPill>
              {canWrite && (
                <>
                  <button
                    type="button"
                    className={`cash-action-btn primary-action ${showCreateRegister ? "active" : ""}`}
                    onClick={() => {
                      setShowCreateRegister((prev) => !prev);
                      if (!showCreateRegister) setShowResponsiblesPanel(false);
                    }}
                  >
                    <Plus size={15} /> {showCreateRegister ? "Formu Kapat" : "Yeni Kasa Aç"}
                  </button>
                  <button
                    type="button"
                    className={`cash-action-btn secondary-action ${showResponsiblesPanel ? "active" : ""}`}
                    onClick={() => {
                      setShowResponsiblesPanel((prev) => !prev);
                      if (!showResponsiblesPanel) setShowCreateRegister(false);
                    }}
                  >
                    <Users size={15} /> {showResponsiblesPanel ? "Sorumluları Gizle" : "Sorumluları Yönet"}
                  </button>
                </>
              )}
            </div>
          </header>
          <p>
            Aşağıdaki kasalardan birine tıklayarak o kasaya ait <strong>özet durumu</strong>, <strong>tüm satışları</strong> ve <strong>kasa hareketlerini</strong> anında görüntüleyin.
          </p>

          {/* Açılır Yeni Kasa Aç Formu */}
          {showCreateRegister && canWrite && (
            <div className="cash-collapsible-panel">
              <div className="cash-collapsible-header">
                <div>
                  <strong>Yeni Kasa Tanımla</strong>
                  <small>Şubenize yeni bir kasa ekleyin ve kasa sorumlusunu listeden seçin.</small>
                </div>
              </div>
              <form className="cash-open-register-inline-form" onSubmit={(event) => void createRegister(event)}>
                <label>
                  Kasa Adı
                  <input
                    required
                    minLength={2}
                    maxLength={128}
                    value={newRegisterName}
                    onChange={(event) => setNewRegisterName(event.target.value)}
                    placeholder="Örn. Bahçe Kasası, Teras Bar Kasası"
                  />
                </label>
                <label>
                  Kasa Sorumlusu (Listeden Seçin)
                  <select
                    required
                    value={newRegisterResponsible}
                    onChange={(event) => setNewRegisterResponsible(event.target.value)}
                    disabled={responsibleList.length === 0}
                  >
                    <option value="">
                      {responsibleList.length === 0
                        ? "— Önce sorumlu havuzuna kişi ekleyin —"
                        : "— Kasa sorumlusu seçin —"}
                    </option>
                    {responsibleList.map((person) => (
                      <option key={person.id} value={person.name}>
                        {person.name}{person.roleTitle ? ` (${person.roleTitle})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="cash-form-submit-row">
                  <button type="submit" className="primary-button" disabled={busy || !newRegisterName.trim() || !newRegisterResponsible.trim()}>
                    <Plus size={15} /> Kasayı Oluştur
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setShowCreateRegister(false)}>
                    Vazgeç
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Açılır Kasa Sorumluları Yönetim Paneli */}
          {showResponsiblesPanel && (
            <div className="cash-collapsible-panel">
              <div className="cash-collapsible-header">
                <div>
                  <strong>Kasa Sorumluları Havuzu</strong>
                  <small>Kasaları yönetecek kişileri ekleyin veya boşta olanları çıkarın.</small>
                </div>
              </div>

              {canWrite && (
                <form className="cash-responsible-add-form" onSubmit={(event) => void addResponsible(event)}>
                  <div className="cash-responsible-inputs">
                    <label>
                      Sorumlu Adı Soyadı
                      <input
                        required
                        minLength={2}
                        maxLength={128}
                        value={newResponsibleName}
                        onChange={(event) => setNewResponsibleName(event.target.value)}
                        placeholder="Örn. Zeynep Demir, Can Yıldız"
                      />
                    </label>
                    <label>
                      Görev / Ünvan (isteğe bağlı)
                      <input
                        maxLength={80}
                        value={newResponsibleRole}
                        onChange={(event) => setNewResponsibleRole(event.target.value)}
                        placeholder="Örn. Baş Kasiyer, Salon Şefi"
                      />
                    </label>
                  </div>
                  <button type="submit" className="primary-button" disabled={busy || !newResponsibleName.trim()}>
                    <UserPlus size={15} /> Sorumlu Ekle
                  </button>
                </form>
              )}

              <div className="cash-responsible-list">
                {responsibleList.map((person) => {
                  const assignedRegisters = overview.registers.filter(
                    (reg) => reg.responsible && reg.responsible.toLocaleLowerCase("tr-TR") === person.name.toLocaleLowerCase("tr-TR"),
                  );
                  const canDelete = canWrite;
                  return (
                    <article key={person.id} className="cash-responsible-item">
                      <div className="cash-responsible-item-info">
                        <div className="cash-responsible-avatar">
                          <Users size={15} />
                        </div>
                        <div>
                          <strong>{person.name}</strong>
                          <span>
                            {person.roleTitle || "Kasa Sorumlusu"}
                            {assignedRegisters.length > 0
                              ? ` · Atandığı Kasa: ${assignedRegisters.map((r) => r.name).join(", ")}`
                              : " · Boşta (Kasaya atanabilir)"}
                          </span>
                        </div>
                      </div>
                      <div className="cash-responsible-item-actions">
                        {assignedRegisters.length > 0 ? (
                          <StatusPill tone="blue">Atanmış ({assignedRegisters.map((r) => r.name).join(", ")})</StatusPill>
                        ) : (
                          <StatusPill tone="neutral">Boşta</StatusPill>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="secondary-button cash-delete-responsible-btn"
                            disabled={busy}
                            title={assignedRegisters.length > 0 ? `Bu kişi ${assignedRegisters.map((r) => r.name).join(", ")} kasasına atanmış. Silindiğinde kasanın sorumlusu boşa çıkacaktır.` : "Sorumlular listesinden kaldır"}
                            onClick={() => void removeResponsible(person)}
                          >
                            <Trash2 size={13} /> Kaldır
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {/* Kasalar Kart Izgarası */}
          <div className="cash-registers-grid" role="tablist" aria-label="Mevcut Kasalar">
            {overview.registers.map((reg) => {
              const regOpenShift = overview.openShifts.find((s) => s.shift.registerId === reg.id);
              const isSelected = reg.id === selectedRegister?.id;
              const responsibleLabel = reg.responsible || regOpenShift?.shift.openedBy || "Sorumlu atanmadı";
              return (
                <button
                  key={reg.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  className={`cash-register-interactive-card ${isSelected ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedRegisterId(reg.id);
                    setError("");
                    setNotice("");
                  }}
                >
                  <div className="cash-register-card-badge-row">
                    <span className="cash-register-tab-code">{reg.code}</span>
                    <StatusPill tone={regOpenShift ? "green" : "neutral"}>
                      {regOpenShift ? "Vardiya Açık" : "Kapalı"}
                    </StatusPill>
                  </div>
                  <div className="cash-register-card-name-row">
                    <h3 className="cash-register-card-title">{reg.name}</h3>
                    {isSelected && (
                      <span className="cash-active-check-badge">
                        <CheckCircle2 size={15} /> Seçili Kasa
                      </span>
                    )}
                  </div>
                  <div className="cash-register-card-meta">
                    <span className="cash-card-responsible">
                      <UserCheck size={14} /> {responsibleLabel}
                    </span>
                  </div>
                  <div className="cash-register-card-balance-box">
                    <span>Çekmece Mevcudu:</span>
                    <strong>{regOpenShift ? money(regOpenShift.shift.expectedCashMinor ?? 0) : "0,00 ₺"}</strong>
                  </div>
                  <div className="cash-register-card-footer-hint">
                    {isSelected ? "Şu an bu kasanın detayları görüntüleniyor ↓" : "Bu kasanın hareketlerini ve satışlarını gör →"}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2. Bölüm: Tıklanılan / Seçili Kasaya Ait Özet, Satışlar ve Hareketler */}
        {selectedRegister && (
          <section className="cash-selected-register-container" aria-label="Seçili Kasa Detayı">
            {/* Seçili Kasa Hero Başlığı ve Sorumlu Değiştirme */}
            <div className="cash-summary-hero cash-summary-hero-compact">
              <div className="cash-hero-top-row">
                <div className="cash-hero-main">
                  <div className="cash-hero-badge-row">
                    <h2>{selectedRegister.name} <span className="cash-hero-code">({selectedRegister.code})</span></h2>
                    <StatusPill tone={active ? "green" : "neutral"}>
                      {active ? "Vardiya Açık" : "Vardiya Kapalı"}
                    </StatusPill>
                  </div>
                  <div className="cash-hero-opening-details">
                    <span><UserCheck size={14} /> Sorumlu: <strong>{selectedRegister.responsible || active?.shift.openedBy || "Genel Sorumlu"}</strong></span>
                    {active ? <>
                      <span>Açılış: <strong>{dateTime(active.shift.openedAt)}</strong> ({shiftDuration(active.shift.openedAt)})</span>
                      <span>Açan: <strong>{active.shift.openedBy}</strong></span>
                      <span>{active.movementCount} hareket</span>
                    </> : <span>Açık vardiya bulunmuyor; başlamak için başlangıç avansı ile vardiyayı açın.</span>}
                  </div>
                  {active?.shift.openingNote && (
                    <div className="cash-hero-note">
                      <strong>Açılış Notu:</strong> {active.shift.openingNote}
                    </div>
                  )}
                </div>

                <div className="cash-hero-kpis">
                  <div className="cash-hero-kpi balance">
                    <span className="cash-hero-balance-label">Bu kasanın toplam satışı</span>
                    <strong className="cash-hero-balance-value">{money(selectedRegisterTotalSales)}</strong>
                    {active && (
                      <Link to="/admin/cash/shifts" className="cash-hero-action-link">
                        Vardiyayı Kapat & Sayım Yap <ArrowRight size={14} />
                      </Link>
                    )}
                  </div>
                </div>
              </div>

              {/* Hızlı Sorumlu Değiştirme Alt Çubuğu */}
              {canWrite && (
                <div className="cash-hero-footer-bar">
                  <div className="cash-hero-footer-info">
                    <UserCheck size={15} />
                    <span>Kasa Sorumlusunu Değiştir:</span>
                  </div>
                  <div className="cash-hero-footer-controls">
                    <select
                      aria-label={`${selectedRegister.name} sorumlusu seçimi`}
                      value={editingResponsibles[selectedRegister.id] ?? selectedRegister.responsible ?? ""}
                      onChange={(event) =>
                        setEditingResponsibles((prev) => ({
                          ...prev,
                          [selectedRegister.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">— Sorumlu seçin —</option>
                      {responsibleList.map((person) => (
                        <option key={person.id} value={person.name}>
                          {person.name}{person.roleTitle ? ` (${person.roleTitle})` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="primary-button cash-inline-save-btn"
                      disabled={
                        busy ||
                        (editingResponsibles[selectedRegister.id] ?? selectedRegister.responsible ?? "") === (selectedRegister.responsible ?? "")
                      }
                      onClick={() => void updateRegisterResponsible(selectedRegister)}
                    >
                      Sorumluyu Güncelle
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Seçili Kasa Özet Metrikleri */}
            <div className="metric-grid">
              <MetricCard
                tone="green"
                title="Kasadaki Beklenen Nakit"
                value={active ? money(currentExpected) : "—"}
                foot={`${selectedRegister.name} · Çekmece mevcudu`}
                icon={<Wallet size={18} />}
              />
              <MetricCard
                tone="purple"
                title={`${selectedRegister.name} Satışları`}
                value={money(registerTotalSalesMinor)}
                foot={`Bu kasadan geçen ${registerSalesMovements.length} satış işlemi`}
                icon={<TrendingUp size={18} />}
              />
              <MetricCard
                tone="green"
                title="Nakit Satış Miktarı"
                value={money(registerCashSalesMinor)}
                foot="Kasa çekmecesine doğrudan giren nakit"
                icon={<Banknote size={18} />}
              />
              <MetricCard
                tone="blue"
                title="Kartlı Satış Miktarı"
                value={money(registerCardSalesMinor)}
                foot="Banka POS terminali üzerinden alınan"
                icon={<CreditCard size={18} />}
              />
            </div>

            {/* Yan Yana İki Panel: 1. Bu Kasanın Satışları | 2. Bu Kasanın Hareketleri */}
            <div className="cash-layout">
              {/* Sol Kolon: Bu Kasanın Satışları */}
              <div className="cash-main-column">
                <section className="card cash-panel" aria-label="Kasa Satışları">
                  <header>
                    <div>
                      <span className="eyebrow">{selectedRegister.name.toUpperCase()} · SATIŞ DETAYI</span>
                      <h2>Bu Kasanın Satışları ({registerSalesMovements.length})</h2>
                    </div>
                    <StatusPill tone="purple">{money(registerTotalSalesMinor)} toplam</StatusPill>
                  </header>
                  <p>
                    <strong>{selectedRegister.name}</strong> kasasındaki geçerli adisyon ve nakit satış kayıtları listelenmektedir.
                  </p>

                  {registerSalesMovements.length === 0 ? (
                    <div className="empty-list">
                      <strong>Bu kasada henüz satış kaydı yok</strong>
                      <span>Adisyon tahsilatı veya nakit satış yapıldığında burada listelenecektir.</span>
                    </div>
                  ) : (
                    <div className="cash-sales-list">
                      {registerSalesMovements.map((item) => {
                        const isCard = item.tenderMethod === "card";
                        return (
                          <article key={item.id} className="cash-sale-row-card">
                            <div className="cash-sale-icon-box">
                              {isCard ? <CreditCard size={18} className="cash-card-icon" /> : <Banknote size={18} className="cash-cash-icon" />}
                            </div>
                            <div className="cash-sale-info">
                              <div className="cash-sale-title-row">
                                <strong>{item.description}</strong>
                                <StatusPill tone={isCard ? "blue" : "green"}>
                                  {isCard ? "Kartlı Satış" : "Nakit Satış"}
                                </StatusPill>
                              </div>
                              <small className="cash-sale-meta">
                                {dateTime(item.createdAt)} · İşlem Yapan: <strong>{item.actor}</strong>
                                {item.source === "pos" ? " · POS Adisyon Tahsilatı" : " · Manuel Satış Girişi"}
                              </small>
                            </div>
                            <div className="cash-sale-amount-box">
                              <strong className={isCard ? "cash-card-amount" : "cash-positive"}>
                                +{money(item.amountMinor)}
                              </strong>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>

              {/* Sağ Kolon: Bu Kasanın Tüm Hareketleri (Kasa Defteri) */}
              <div className="cash-side-column">
                <section className="card cash-panel" aria-label="Kasa Hareketleri">
                  <header>
                    <div>
                      <span className="eyebrow">{selectedRegister.name.toUpperCase()} · KASA DEFTERİ</span>
                      <h2>Kasa Hareketleri ({registerMovements.length})</h2>
                    </div>
                    <Link className="cash-history-link" to="/admin/cash/movements">Tüm defter →</Link>
                  </header>
                  <p>
                    Açılış nakdi, nakit girişleri, giderler ve teslimler dahil bu kasadaki tüm işlemler:
                  </p>

                  <CashMovementList items={registerMovements.slice(0, 10)} />
                </section>

                <div className="cash-audit-card">
                  <div className="cash-audit-title">
                    <ShieldCheck size={16} /> {selectedRegister.name} Güvenlik & Denetim
                  </div>
                  <ul className="cash-audit-list">
                    <li><strong>Bağımsız Çekmece:</strong> Her kasanın bakiyesi diğer kasalardan bağımsız olarak işletilir.</li>
                    <li><strong>Değiştirilemez Kayıt:</strong> Kasa hareketleri silinemez; gerektiğinde Kasa Özeti sayfasından ters kayıt ile düzeltilir.</li>
                  </ul>
                  <div className="cash-audit-quick-links">
                    <Link to="/admin/cash/summary" className="cash-shift-action-btn">
                      Bu Kasanın Kasa Özetine Git <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    ) : view === "cash" ? (
      <div className="cash-flow-page">
        {/* 1. Bölüm: 4 Metrik Kartı */}
        <div className="metric-grid">
          <MetricCard
            tone="green"
            title="Bugün Kaydedilen Nakit Satış"
            value={money(cashSalesMinorTotal)}
            foot={`${todayCashSales.length} geçerli kasa satış kaydı · simüle ve manuel`}
            icon={<Banknote size={18} />}
          />
          <MetricCard
            tone="purple"
            title="Çekmecelerde Beklenen Nakit"
            value={totalDrawerCashMinor === null ? "—" : money(totalDrawerCashMinor)}
            foot={`${overview.openShifts.length} açık vardiyanın hesaplanan bakiyesi`}
            icon={<Wallet size={18} />}
          />
          <MetricCard
            tone="blue"
            title="Nakit İşlem Adedi"
            value={`${allCashMovements.length} işlem`}
            foot={`${cashSalesMovements.length} nakit satış, ${allCashMovements.length - cashSalesMovements.length} kasa hareketi`}
            icon={<ReceiptText size={18} />}
          />
          <MetricCard
            tone="orange"
            title="Ortalama Nakit Satış Kaydı"
            value={money(averageCashTicketMinor)}
            foot="Bugünkü geçerli nakit satış kaydı başına"
            icon={<TrendingUp size={18} />}
          />
        </div>

        {/* 2. Bölüm: Kasa Bazında Fiziki Nakit Dağılımı */}
        <section className="card cash-panel" aria-label="Kasa Bazında Beklenen Nakit Dağılımı">
          <header className="cash-registers-overview-header">
            <div>
              <span className="eyebrow">BEKLENEN ÇEKMECE BAKİYESİ & DAĞILIM</span>
              <h2>Kasa Bazında Beklenen Nakit</h2>
              <p className="cash-tender-desc">
                Açık vardiyaların hareketlerden hesaplanan beklenen bakiyesi, vardiya durumu ve kasa sorumlusu.
              </p>
            </div>
            <StatusPill tone="blue">{overview.registers.length} kayıtlı kasa</StatusPill>
          </header>

          <div className="cash-flow-grid">
            {overview.registers.map((reg) => {
              const regOpenShift = overview.openShifts.find((s) => s.shift.registerId === reg.id);
              const isFiltered = cashRegisterFilter === reg.id;
              const responsibleLabel = reg.responsible || regOpenShift?.shift.openedBy || "Sorumlu atanmadı";
              const regCashSales = todayCashSales
                .filter((m) => m.registerId === reg.id)
                .reduce((sum, m) => sum + m.amountMinor, 0);

              return (
                <div
                  key={reg.id}
                  className={`cash-flow-reg-card ${isFiltered ? "filtered-active" : ""}`}
                >
                  <div className="cash-flow-reg-card-top">
                    <div>
                      <h3 className="cash-flow-reg-name">{reg.name}</h3>
                      <span className="cash-flow-reg-code">{reg.code}</span>
                    </div>
                    <StatusPill tone={regOpenShift ? "green" : "neutral"}>
                      {regOpenShift ? "Vardiya Açık" : "Kapalı"}
                    </StatusPill>
                  </div>

                  <div className="cash-flow-reg-responsible">
                    <UserCheck size={14} />
                    <span>Sorumlu: <strong>{responsibleLabel}</strong></span>
                  </div>

                  <div className="cash-flow-reg-balance-box">
                    <span className="cash-flow-reg-balance-label">Çekmecede Beklenen Nakit</span>
                    <strong className="cash-flow-reg-balance-val">
                      {regOpenShift?.shift.expectedCashMinor != null ? money(regOpenShift.shift.expectedCashMinor) : "—"}
                    </strong>
                  </div>

                  <div className="cash-flow-reg-stats-row">
                    <div>
                      <small>Bugün Nakit Satış</small>
                      <strong>{money(regCashSales)}</strong>
                    </div>
                    <div>
                      <small>Açılış Avansı</small>
                      <strong>{regOpenShift ? money(regOpenShift.shift.openingCashMinor) : "—"}</strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={`cash-flow-filter-btn ${isFiltered ? "active" : ""}`}
                    onClick={() => {
                      setCashRegisterFilter(isFiltered ? "" : reg.id);
                    }}
                  >
                    <Filter size={13} />
                    {isFiltered ? "Filtreyi Temizle" : "Bu Kasanın Nakit Kayıtlarını Listele"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* 3. Bölüm: Nakit İşlem Defteri (Filtrelenebilir Canlı Liste) */}
        <section className="card cash-panel" aria-label="Nakit İşlem Defteri">
          <header className="cash-registers-overview-header">
            <div>
              <span className="eyebrow">ŞUBE NAKİT DEFTERİ</span>
              <h2>Nakit Tahsilat & Hareket Günlüğü</h2>
              <p className="cash-tender-desc">
                Kasaya giren tüm nakit adisyon tahsilatları, manuel satışlar, açılış avansları, gider ödemeleri ve teslimatlar.
              </p>
            </div>
            {cashRegisterFilter && (
              <button
                type="button"
                className="secondary-button"
                style={{ fontSize: 12, padding: "5px 10px" }}
                onClick={() => setCashRegisterFilter("")}
              >
                Kasa Filtresini Temizle ({overview.registers.find((r) => r.id === cashRegisterFilter)?.name})
              </button>
            )}
          </header>

          {/* Filtre ve Arama Araç Çubuğu */}
          <div className="cash-flow-toolbar">
            <div className="cash-flow-search-wrap">
              <Search size={15} />
              <input
                type="text"
                value={cashSearch}
                onChange={(e) => setCashSearch(e.target.value)}
                placeholder="Açıklama, sorumlu veya kasa ara..."
              />
              {cashSearch && (
                <button type="button" className="cash-flow-search-clear" onClick={() => setCashSearch("")}>✕</button>
              )}
            </div>

            <div className="cash-flow-select-wrap">
              <label>
                <span>Kasa:</span>
                <select
                  value={cashRegisterFilter}
                  onChange={(e) => setCashRegisterFilter(e.target.value)}
                >
                  <option value="">Tüm Kasalar ({overview.registers.length})</option>
                  {overview.registers.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="cash-flow-type-pills">
              <button
                type="button"
                className={`cash-flow-pill ${cashTypeFilter === "all" ? "active" : ""}`}
                onClick={() => setCashTypeFilter("all")}
              >
                Tümü ({allCashMovements.length})
              </button>
              <button
                type="button"
                className={`cash-flow-pill ${cashTypeFilter === "sales" ? "active" : ""}`}
                onClick={() => setCashTypeFilter("sales")}
              >
                Nakit Satışlar ({cashSalesMovements.length})
              </button>
              <button
                type="button"
                className={`cash-flow-pill ${cashTypeFilter === "in" ? "active" : ""}`}
                onClick={() => setCashTypeFilter("in")}
              >
                Giriş / Avans ({allCashMovements.filter((m) => m.kind === "opening_float" || (m.kind === "manual_in" && m.category !== "cash_sale")).length})
              </button>
              <button
                type="button"
                className={`cash-flow-pill ${cashTypeFilter === "out" ? "active" : ""}`}
                onClick={() => setCashTypeFilter("out")}
              >
                Çıkış / Masraf / Teslim ({allCashMovements.filter((m) => m.kind === "manual_out").length})
              </button>
              <button
                type="button"
                className={`cash-flow-pill ${cashTypeFilter === "reversal" ? "active" : ""}`}
                onClick={() => setCashTypeFilter("reversal")}
              >
                Düzeltmeler ({allCashMovements.filter((m) => m.correctionType === "reversal").length})
              </button>
            </div>
          </div>

          {/* Özet Şerit */}
          <div className="cash-flow-summary-strip">
            <span className="cash-flow-count-badge">
              <strong>{filteredCashMovements.length}</strong> nakit hareketi listeleniyor
            </span>
            <div className="cash-flow-strip-totals">
              <span className="cash-flow-badge green">
                Giriş: +{money(filteredCashTotals.inMinor)}
              </span>
              <span className="cash-flow-badge red">
                Çıkış: -{money(filteredCashTotals.outMinor)}
              </span>
              <span className="cash-flow-badge blue">
                Net Akış: {filteredCashTotals.netMinor >= 0 ? "+" : ""}{money(filteredCashTotals.netMinor)}
              </span>
            </div>
          </div>

          {/* Hareket Tablosu */}
          {filteredCashMovements.length === 0 ? (
            <div className="card empty-list" style={{ marginTop: 14 }}>
              <strong>Kriterlere uygun nakit hareketi bulunamadı</strong>
              <span>Arama filtrenizi temizleyerek veya kasa seçimini değiştirerek tekrar deneyebilirsiniz.</span>
              {(cashRegisterFilter || cashTypeFilter !== "all" || cashSearch) && (
                <button
                  type="button"
                  className="secondary-button"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    setCashRegisterFilter("");
                    setCashTypeFilter("all");
                    setCashSearch("");
                  }}
                >
                  Filtreleri Sıfırla
                </button>
              )}
            </div>
          ) : (
            <div className="cash-flow-table-wrap">
              <table className="cash-flow-table">
                <thead>
                  <tr>
                    <th>Tarih & Saat</th>
                    <th>Kasa</th>
                    <th>İşlem Türü</th>
                    <th>Açıklama / Detay</th>
                    <th>Kaydeden</th>
                    <th style={{ textAlign: "right" }}>Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCashMovements.map((item) => {
                    const reg = overview.registers.find((r) => r.id === item.registerId);
                    const isOut = item.kind === "manual_out";
                    const isReversal = item.correctionType === "reversal";
                    const isFloat = item.kind === "opening_float";

                    let badgeTone: "green" | "blue" | "orange" | "neutral" = "green";
                    let badgeLabel = "Nakit Satış";
                    if (isReversal) {
                      badgeTone = "orange";
                      badgeLabel = "Düzeltme";
                    } else if (isFloat) {
                      badgeTone = "blue";
                      badgeLabel = "Açılış Avansı";
                    } else if (isOut) {
                      badgeTone = "orange";
                      badgeLabel = item.category === "cash_drop" ? "Kasadan Teslim" : "İşletme Masrafı";
                    } else if (item.kind === "manual_in" && item.category !== "cash_sale") {
                      badgeTone = "blue";
                      badgeLabel = "Avans / Takviye";
                    }

                    return (
                      <tr key={item.id} className="cash-flow-tr">
                        <td className="cash-flow-td-time">
                          {dateTime(item.createdAt)}
                        </td>
                        <td className="cash-flow-td-reg">
                          <strong>{reg?.name ?? "Bilinmeyen Kasa"}</strong>
                          <small>{reg?.code ?? ""}</small>
                        </td>
                        <td>
                          <StatusPill tone={badgeTone}>{badgeLabel}</StatusPill>
                        </td>
                        <td className="cash-flow-td-desc">
                          <span>{item.correctionType === "reversal" ? item.correctionReason : item.description || "—"}</span>
                          <small>
                            {item.source === "pos" ? "Adisyon / Masa tahsilatı" : "Manuel kasa kaydı"}
                            {item.originalMovementId ? ` · Kayıt ID: ${item.originalMovementId.slice(0, 8)}` : ""}
                          </small>
                        </td>
                        <td className="cash-flow-td-actor">
                          <span>{item.actor}</span>
                        </td>
                        <td className="cash-flow-td-amount" style={{ textAlign: "right" }}>
                          <strong className={isOut ? "cash-negative" : "cash-positive"}>
                            {isOut ? "−" : "+"}
                            {money(item.amountMinor)}
                          </strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 4. Bölüm: Diğer Kasa Sayfalarına Hızlı Erişim */}
        <section className="card cash-panel" aria-label="İlgili Kasa Ekranları">
          <header className="cash-registers-overview-header">
            <div>
              <span className="eyebrow">HIZLI ERİŞİM & GEÇİŞ</span>
              <h2>Diğer Kasa Yönetim Sayfaları</h2>
              <p className="cash-tender-desc">
                Kasa hareketleri, vardiya devirleri veya kasa sorumlusu tanımlamalarına doğrudan geçiş yapın.
              </p>
            </div>
          </header>

          <div className="cash-quick-links-grid">
            <Link to="/admin/cash/summary" className="cash-quick-link-card">
              <div className="cash-quick-link-icon purple">
                <TrendingUp size={20} />
              </div>
              <div className="cash-quick-link-body">
                <strong>Kasa Özeti</strong>
                <p>Kasa bazlı anlık çekmece durumu, satış grafikleri ve güncel vardiya takibi.</p>
              </div>
              <ArrowRight size={16} className="cash-quick-arrow" />
            </Link>

            <Link to="/admin/cash/registers" className="cash-quick-link-card">
              <div className="cash-quick-link-icon green">
                <Wallet size={20} />
              </div>
              <div className="cash-quick-link-body">
                <strong>Mevcut Kasalar & Sorumlular</strong>
                <p>Şubenizdeki tüm kasaları yönetin, yeni kasa açın ve kasa sorumlularını atayın.</p>
              </div>
              <ArrowRight size={16} className="cash-quick-arrow" />
            </Link>

            <Link to="/admin/cash/shifts" className="cash-quick-link-card">
              <div className="cash-quick-link-icon blue">
                <ReceiptText size={20} />
              </div>
              <div className="cash-quick-link-body">
                <strong>Kasa Vardiyaları</strong>
                <p>Açılış/kapanış kayıtları, fiziki sayım farkları ve kasa devir geçmişi.</p>
              </div>
              <ArrowRight size={16} className="cash-quick-arrow" />
            </Link>
          </div>
        </section>
      </div>
    ) : view === "card" ? (
      <div className="card-flow-page">
        {/* 1. Bölüm: 4 Metrik Kartı */}
        <div className="metric-grid">
          <MetricCard
            tone="blue"
            title="Günün Toplam Kartlı Cirosu"
            value={money(cardSalesMinorTotal)}
            foot={`Bugün kaydedilen ${cardSalesCount} kartlı hareket`}
            icon={<CreditCard size={18} />}
          />
          <MetricCard
            tone="purple"
            title="Ortalama Kartlı İşlem"
            value={money(averageCardTicketMinor)}
            foot="Bugünkü kartlı hareket başına ortalama tutar"
            icon={<TrendingUp size={18} />}
          />
          <MetricCard
            tone="green"
            title="Kartlı İşlem & Slip Sayısı"
            value={`${allCardMovements.length} slip`}
            foot="POS terminallerinden başarıyla çekilen işlem"
            icon={<ReceiptText size={18} />}
          />
          <MetricCard
            tone="orange"
            title="Fiziki Çekmece Durumu"
            value="0,00 ₺ (Kasa Dışı)"
            foot="Kart gelirleri banka hesabına akar, çekmeceye girmez"
            icon={<ShieldCheck size={18} />}
          />
        </div>

        {/* 2. Bölüm: Kasa Bazında Kartlı Satış Dağılımı */}
        <section className="card cash-panel" aria-label="Kasa Bazında Kartlı Satış Dağılımı">
          <header className="cash-registers-overview-header">
            <div>
              <span className="eyebrow">KASA & TERMİNAL DAĞILIMI</span>
              <h2>Kasa Bazında Kartlı Tahsilat Hacmi</h2>
              <p className="cash-tender-desc">
                Her kasanın POS terminalleri üzerinden aldığı toplam kartlı ciro, slip adedi ve kasa sorumlusu.
              </p>
            </div>
            <StatusPill tone="blue">{overview.registers.length} kayıtlı kasa</StatusPill>
          </header>

          <div className="card-flow-grid">
            {overview.registers.map((reg) => {
              const regOpenShift = overview.openShifts.find((s) => s.shift.registerId === reg.id);
              const isFiltered = cardRegisterFilter === reg.id;
              const responsibleLabel = reg.responsible || regOpenShift?.shift.openedBy || "Sorumlu atanmadı";
              const regCardMovements = allCardMovements.filter((m) => m.registerId === reg.id);
              const regCardSales = regCardMovements.reduce((sum, m) => sum + m.amountMinor, 0);
              const regTotalSales = validRegisterSales(allSalesMovements, reg.id)
                .reduce((sum, m) => sum + m.amountMinor, 0);
              const regCardRatio = regTotalSales > 0 ? Math.round((regCardSales / regTotalSales) * 100) : 0;

              return (
                <div
                  key={reg.id}
                  className={`card-flow-reg-card ${isFiltered ? "filtered-active" : ""}`}
                >
                  <div className="card-flow-reg-card-top">
                    <div>
                      <h3 className="card-flow-reg-name">{reg.name}</h3>
                      <span className="card-flow-reg-code">{reg.code}</span>
                    </div>
                    <StatusPill tone={regOpenShift ? "green" : "neutral"}>
                      {regOpenShift ? "Vardiya Açık" : "Kapalı"}
                    </StatusPill>
                  </div>

                  <div className="card-flow-reg-responsible">
                    <UserCheck size={14} />
                    <span>Sorumlu: <strong>{responsibleLabel}</strong></span>
                  </div>

                  <div className="card-flow-reg-balance-box">
                    <span className="card-flow-reg-balance-label">Kartlı Tahsilat Toplamı</span>
                    <strong className="card-flow-reg-balance-val">
                      {money(regCardSales)}
                    </strong>
                  </div>

                  <div className="card-flow-reg-stats-row">
                    <div>
                      <small>Kartlı İşlem (Slip)</small>
                      <strong>{regCardMovements.length} adet</strong>
                    </div>
                    <div>
                      <small>Kasa Satış Payı</small>
                      <strong>%{regCardRatio} kart</strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={`card-flow-filter-btn ${isFiltered ? "active" : ""}`}
                    onClick={() => {
                      setCardRegisterFilter(isFiltered ? "" : reg.id);
                    }}
                  >
                    <Filter size={13} />
                    {isFiltered ? "Filtreyi Temizle" : "Bu Kasanın Kart Kayıtlarını Listele"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* 3. Bölüm: Desteklenen / Entegre Banka POS Terminalleri */}
        <section className="card cash-panel" aria-label="Banka POS Terminal Ağı">
          <header className="cash-registers-overview-header">
            <div>
              <span className="eyebrow">POS TERMİNAL AĞI</span>
              <h2>Entegre Banka POS Terminalleri</h2>
              <p className="cash-tender-desc">
                Şubenizde kullanılan banka POS cihazları, terminal tipleri ve gün sonu mutabakat durumu.
              </p>
            </div>
            <StatusPill tone="green">4 POS Terminali Aktif</StatusPill>
          </header>

          <div className="card-flow-terminals-grid">
            <div className="card-flow-terminal-card">
              <div className="card-flow-terminal-icon blue">
                <CreditCard size={18} />
              </div>
              <div className="card-flow-terminal-info">
                <strong>Garanti BBVA POS</strong>
                <span>Masa & Paket Servis Terminali · Temassız / Çipli</span>
                <small>Terminal No: #POS-01 · IP & Mobil Bağlantı</small>
              </div>
              <div className="card-flow-terminal-status">
                <StatusPill tone="green">Aktif / Entegre</StatusPill>
              </div>
            </div>

            <div className="card-flow-terminal-card">
              <div className="card-flow-terminal-icon green">
                <CreditCard size={18} />
              </div>
              <div className="card-flow-terminal-info">
                <strong>Ziraat Bankası POS</strong>
                <span>Ana Kasa Sabit Terminal · Temassız / QR</span>
                <small>Terminal No: #POS-02 · Kablolu Ethernet</small>
              </div>
              <div className="card-flow-terminal-status">
                <StatusPill tone="green">Aktif / Entegre</StatusPill>
              </div>
            </div>

            <div className="card-flow-terminal-card">
              <div className="card-flow-terminal-icon purple">
                <CreditCard size={18} />
              </div>
              <div className="card-flow-terminal-info">
                <strong>Yapı Kredi POS</strong>
                <span>Mobil Garson El Terminali · Temassız / NFC</span>
                <small>Terminal No: #POS-03 · 4G LTE SIM</small>
              </div>
              <div className="card-flow-terminal-status">
                <StatusPill tone="green">Aktif / Entegre</StatusPill>
              </div>
            </div>

            <div className="card-flow-terminal-card">
              <div className="card-flow-terminal-icon orange">
                <CreditCard size={18} />
              </div>
              <div className="card-flow-terminal-info">
                <strong>VakıfBank POS</strong>
                <span>Hızlı Kasa & Paket Terminali · Temassız</span>
                <small>Terminal No: #POS-04 · Wi-Fi Bağlantı</small>
              </div>
              <div className="card-flow-terminal-status">
                <StatusPill tone="green">Aktif / Entegre</StatusPill>
              </div>
            </div>
          </div>
        </section>

        {/* 4. Bölüm: Kartlı Tahsilat Defteri & POS Slip Günlüğü */}
        <section className="card cash-panel" aria-label="Kartlı Tahsilat Defteri">
          <header className="cash-registers-overview-header">
            <div>
              <span className="eyebrow">ŞUBE BANKA & POS DEFTERİ</span>
              <h2>Kartlı Tahsilat & POS Slip Günlüğü</h2>
              <p className="cash-tender-desc">
                POS terminallerinden başarıyla provizyon alan tüm banka ve kredi kartı tahsilatları, adisyon referansları ve slip kayıtları.
              </p>
            </div>
            {cardRegisterFilter && (
              <button
                type="button"
                className="secondary-button"
                style={{ fontSize: 12, padding: "5px 10px" }}
                onClick={() => setCardRegisterFilter("")}
              >
                Kasa Filtresini Temizle ({overview.registers.find((r) => r.id === cardRegisterFilter)?.name})
              </button>
            )}
          </header>

          {/* Filtre ve Arama Araç Çubuğu */}
          <div className="card-flow-toolbar">
            <div className="card-flow-search-wrap">
              <Search size={15} />
              <input
                type="text"
                value={cardSearch}
                onChange={(e) => setCardSearch(e.target.value)}
                placeholder="Açıklama, adisyon no, garson veya terminal ara..."
              />
              {cardSearch && (
                <button type="button" className="card-flow-search-clear" onClick={() => setCardSearch("")}>✕</button>
              )}
            </div>

            <div className="card-flow-select-wrap">
              <label>
                <span>Kasa:</span>
                <select
                  value={cardRegisterFilter}
                  onChange={(e) => setCardRegisterFilter(e.target.value)}
                >
                  <option value="">Tüm Kasalar ({overview.registers.length})</option>
                  {overview.registers.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="card-flow-type-pills">
              <button
                type="button"
                className={`card-flow-pill ${cardProviderFilter === "all" ? "active" : ""}`}
                onClick={() => setCardProviderFilter("all")}
              >
                Tüm Bankalar ({allCardMovements.length})
              </button>
              <button
                type="button"
                className={`card-flow-pill ${cardProviderFilter === "garanti" ? "active" : ""}`}
                onClick={() => setCardProviderFilter("garanti")}
              >
                Garanti BBVA ({allCardMovements.filter((m) => (m.provider ?? "").includes("garanti") || (m.description ?? "").includes("Garanti")).length})
              </button>
              <button
                type="button"
                className={`card-flow-pill ${cardProviderFilter === "ziraat" ? "active" : ""}`}
                onClick={() => setCardProviderFilter("ziraat")}
              >
                Ziraat ({allCardMovements.filter((m) => (m.provider ?? "").includes("ziraat") || (m.description ?? "").includes("Ziraat")).length})
              </button>
              <button
                type="button"
                className={`card-flow-pill ${cardProviderFilter === "yapikredi" ? "active" : ""}`}
                onClick={() => setCardProviderFilter("yapikredi")}
              >
                Yapı Kredi ({allCardMovements.filter((m) => (m.provider ?? "").includes("yapikredi") || (m.description ?? "").includes("Yapı Kredi")).length})
              </button>
              <button
                type="button"
                className={`card-flow-pill ${cardProviderFilter === "vakif" ? "active" : ""}`}
                onClick={() => setCardProviderFilter("vakif")}
              >
                VakıfBank ({allCardMovements.filter((m) => (m.provider ?? "").includes("vakif") || (m.description ?? "").includes("VakıfBank")).length})
              </button>
            </div>
          </div>

          {/* Özet Şerit */}
          <div className="card-flow-summary-strip">
            <span className="card-flow-count-badge">
              <strong>{filteredCardMovements.length}</strong> kartlı işlem listeleniyor
            </span>
            <div className="card-flow-strip-totals">
              <span className="card-flow-badge blue">
                Toplam Kartlı Hacim: {money(filteredCardTotalMinor)}
              </span>
              <span className="card-flow-badge green">
                Provizyon: %100 Başarılı / Onaylandı
              </span>
            </div>
          </div>

          {/* Hareket Tablosu */}
          {filteredCardMovements.length === 0 ? (
            <div className="card empty-list" style={{ marginTop: 14 }}>
              <strong>Kriterlere uygun kart tahsilatı bulunamadı</strong>
              <span>Arama filtrenizi temizleyerek veya kasa seçimini değiştirerek tekrar deneyebilirsiniz.</span>
              {(cardRegisterFilter || cardProviderFilter !== "all" || cardSearch) && (
                <button
                  type="button"
                  className="secondary-button"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    setCardRegisterFilter("");
                    setCardProviderFilter("all");
                    setCardSearch("");
                  }}
                >
                  Filtreleri Sıfırla
                </button>
              )}
            </div>
          ) : (
            <div className="card-flow-table-wrap">
              <table className="card-flow-table">
                <thead>
                  <tr>
                    <th>Tarih & Saat</th>
                    <th>Kasa</th>
                    <th>Terminal / Sağlayıcı</th>
                    <th>Adisyon & Detay</th>
                    <th>Tahsil Eden</th>
                    <th>Provizyon</th>
                    <th style={{ textAlign: "right" }}>Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCardMovements.map((item) => {
                    const reg = overview.registers.find((r) => r.id === item.registerId);
                    let providerLabel = "Banka POS";
                    const provLower = (item.provider ?? "").toLowerCase();
                    const descLower = (item.description ?? "").toLowerCase();
                    if (provLower.includes("garanti") || descLower.includes("garanti")) providerLabel = "Garanti BBVA";
                    else if (provLower.includes("ziraat") || descLower.includes("ziraat")) providerLabel = "Ziraat POS";
                    else if (provLower.includes("yapikredi") || descLower.includes("yapı kredi")) providerLabel = "Yapı Kredi";
                    else if (provLower.includes("vakif") || descLower.includes("vakıfbank")) providerLabel = "VakıfBank";

                    return (
                      <tr key={item.id} className="card-flow-tr">
                        <td className="card-flow-td-time">
                          {dateTime(item.createdAt)}
                        </td>
                        <td className="card-flow-td-reg">
                          <strong>{reg?.name ?? "Bilinmeyen Kasa"}</strong>
                          <small>{reg?.code ?? ""}</small>
                        </td>
                        <td>
                          <span className="card-flow-provider-badge">
                            <CreditCard size={12} /> {providerLabel}
                          </span>
                        </td>
                        <td className="card-flow-td-desc">
                          <span>{item.description || "Adisyon POS Tahsilatı"}</span>
                          <small>
                            Slip Onay No: {item.id.slice(0, 8).toUpperCase()}
                            {item.externalReference ? ` · Ref: ${item.externalReference}` : ""}
                          </small>
                        </td>
                        <td className="card-flow-td-actor">
                          <span>{item.actor}</span>
                        </td>
                        <td>
                          <StatusPill tone="green">Onaylandı</StatusPill>
                        </td>
                        <td className="card-flow-td-amount" style={{ textAlign: "right" }}>
                          <strong>{money(item.amountMinor)}</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 5. Bölüm: Banka POS Mutabakat Bilgi Notu */}
        <section className="card card-flow-reconcile-card" aria-label="Banka POS Mutabakat Notu">
          <div className="card-flow-reconcile-icon">
            <ShieldCheck size={22} />
          </div>
          <div className="card-flow-reconcile-body">
            <h3>Banka POS Gün Sonu (Z Raporu) & Mutabakat Rehberi</h3>
            <p>
              Kredi ve banka kartı ile alınan tahsilatlar fiziki çekmecede nakit artışı oluşturmaz; doğrudan banka ticari hesaplarınıza transfer edilir.
              Gün sonunda restoranınızdaki tüm fiziki POS cihazlarından <strong>Gün Sonu (Z Raporu)</strong> çıktısı alarak slip toplamlarınızı yukarıdaki kasa toplamlarıyla eşleştirin.
            </p>
          </div>
        </section>

        {/* 6. Bölüm: Diğer Kasa Sayfalarına Hızlı Erişim */}
        <section className="card cash-panel" aria-label="İlgili Kasa Ekranları">
          <header className="cash-registers-overview-header">
            <div>
              <span className="eyebrow">HIZLI ERİŞİM & GEÇİŞ</span>
              <h2>Diğer Kasa Yönetim Sayfaları</h2>
              <p className="cash-tender-desc">
                Nakit akışı, vardiya devirleri veya mevcut kasa tanımlamalarına doğrudan geçiş yapın.
              </p>
            </div>
          </header>

          <div className="cash-quick-links-grid">
            <Link to="/admin/cash/summary" className="cash-quick-link-card">
              <div className="cash-quick-link-icon purple">
                <TrendingUp size={20} />
              </div>
              <div className="cash-quick-link-body">
                <strong>Kasa Özeti</strong>
                <p>Kasa bazlı anlık çekmece durumu, satış grafikleri ve güncel vardiya takibi.</p>
              </div>
              <ArrowRight size={16} className="cash-quick-arrow" />
            </Link>

            <Link to="/admin/cash/cash" className="cash-quick-link-card">
              <div className="cash-quick-link-icon green">
                <Banknote size={20} />
              </div>
              <div className="cash-quick-link-body">
                <strong>Nakit Tahsilat & Çekmece</strong>
                <p>Kasa çekmecelerindeki fiziki nakit mevcudunu, avans ve gider hareketlerini inceleyin.</p>
              </div>
              <ArrowRight size={16} className="cash-quick-arrow" />
            </Link>

            <Link to="/admin/cash/registers" className="cash-quick-link-card">
              <div className="cash-quick-link-icon blue">
                <Wallet size={20} />
              </div>
              <div className="cash-quick-link-body">
                <strong>Mevcut Kasalar & Sorumlular</strong>
                <p>Şubenizdeki tüm kasaları yönetin, yeni kasa açın ve kasa sorumlularını atayın.</p>
              </div>
              <ArrowRight size={16} className="cash-quick-arrow" />
            </Link>
          </div>
        </section>
      </div>
    ) : (
      <>
        {/* Kasa Özeti: Şube Genel Günlük Satış Hacmi ve Miktarı Sayfanın En Üstünde */}
        {displayView === "summary" && (
          <>
            <div className="cash-section-header">
              <h3>Gün İçinde Yapılan Tüm Satışlar (Şube Geneli)</h3>
            </div>
            <div className="metric-grid">
              <MetricCard
                tone="purple"
                title="Günün Toplam Satış Tutarı"
                value={dailyCollections ? money(dailyCollections.totalMinor) : "—"}
                foot={dailyCollections ? `Toplam ${dailyCollections.count} satış / adisyon işlemi` : "Adisyon verisi bekleniyor"}
                icon={<TrendingUp size={18} />}
              />
              <MetricCard
                tone="green"
                title="Nakit Satış Miktarı"
                value={dailyCollections ? money(dailyCollections.cashMinor) : "—"}
                foot={dailyCollections ? `Kasaya işlenen satış (%${cashPercent})` : "Nakit tahsilat"}
                icon={<Banknote size={18} />}
              />
              <MetricCard
                tone="blue"
                title="Kartlı Satış Miktarı"
                value={dailyCollections ? money(dailyCollections.cardMinor) : "—"}
                foot={dailyCollections ? `Banka POS terminaline işlenen (%${cardPercent})` : "Kart tahsilatı"}
                icon={<CreditCard size={18} />}
              />
              <MetricCard
                tone="orange"
                title="Ortalama Satış (Sepet)"
                value={dailyCollections && dailyCollections.count > 0 ? money(averageCheckMinor) : "—"}
                foot="Adisyon / işlem başına ortalama tutar"
                icon={<ReceiptText size={18} />}
              />
            </div>

            {/* Günlük Satış ve Tahsilat Dağılımı (Ciro Özeti) */}
            {!dailyCollections ? (
              <p className="cash-data-note" role="status">Bugünkü tahsilat bilgisi alınamadı. API güncellemesinden sonra yeniden deneyin.</p>
            ) : (
              <section className="card cash-tender-card" aria-label="Günlük Satış ve Tahsilat Dağılımı">
                <header className="cash-tender-header">
                  <div>
                    <span className="eyebrow">GÜNLÜK SATIŞ & TAHSİLAT NABZI</span>
                    <h2>Günün Toplam Ciro Dağılımı</h2>
                   
                  </div>
                  <div className="cash-tender-total-badge">
                    <span>Toplam Satış Hacmi</span>
                    <strong>{money(dailyCollections.totalMinor)}</strong>
                    <small>{dailyCollections.count} başarılı adisyon / satış</small>
                  </div>
                </header>

                <div className="cash-tender-bar-wrap">
                  <div className="cash-tender-bar">
                    <div
                      className="cash-bar-fill cash"
                      style={{ width: `${dailyCollections.totalMinor > 0 ? Math.round((dailyCollections.cashMinor / dailyCollections.totalMinor) * 100) : 50}%` }}
                    />
                    <div
                      className="cash-bar-fill card"
                      style={{ width: `${dailyCollections.totalMinor > 0 ? Math.max(0, 100 - Math.round((dailyCollections.cashMinor / dailyCollections.totalMinor) * 100)) : 50}%` }}
                    />
                  </div>
                </div>

                <div className="cash-tender-grid">
                  <div className="cash-tender-item cash-item">
                    <div className="cash-tender-item-icon"><Banknote size={20} /></div>
                    <div className="cash-tender-item-info">
                      <span className="cash-tender-item-title">Nakit Satışlar</span>
                      <small>Kasa çekmecelerine doğrudan giren nakit ciro</small>
                      <div className="cash-tender-item-amount">
                        <strong>{money(dailyCollections.cashMinor)}</strong>
                        <span className="cash-tender-percent">
                          %{dailyCollections.totalMinor > 0 ? Math.round((dailyCollections.cashMinor / dailyCollections.totalMinor) * 100) : 0} pay
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="cash-tender-item card-item">
                    <div className="cash-tender-item-icon"><CreditCard size={20} /></div>
                    <div className="cash-tender-item-info">
                      <span className="cash-tender-item-title">Kredi / Banka Kartı</span>
                      <small>Banka POS terminallerinden geçen tahsilat</small>
                      <div className="cash-tender-item-amount">
                        <strong>{money(dailyCollections.cardMinor)}</strong>
                        <span className="cash-tender-percent">
                          %{dailyCollections.totalMinor > 0 ? Math.round((dailyCollections.cardMinor / dailyCollections.totalMinor) * 100) : 0} pay
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

              </section>
            )}
          </>
        )}

        {/* Kasa Özeti / Hareketler / Vardiyalar: Kasa Seçici */}
        <section className="cash-registers-section" aria-label="Şubedeki Kasalar">
          <div className="cash-registers-header">
            <div className="cash-registers-header-left">
              <Wallet size={17} />
              <h3>Kasa Seçimi</h3>
              <StatusPill tone="blue">{overview.registers.length} aktif kasa</StatusPill>
              {updatedAt && <small className="cash-toolbar-meta">Son senkronizasyon: {dateTime(updatedAt.toISOString())}</small>}
            </div>
            <Link to="/admin/cash/registers" className="cash-manage-registers-link">
              Mevcut Kasalar & Sorumlular <ArrowRight size={14} />
            </Link>
          </div>

          {overview.registers.length > 0 && (
            <div className="cash-register-tabs" role="tablist" aria-label="Kasa Seçimi">
              {overview.registers.map((reg) => {
                const regOpenShift = overview.openShifts.find((s) => s.shift.registerId === reg.id);
                const isSelected = reg.id === selectedRegister?.id;
                const responsibleLabel = reg.responsible || regOpenShift?.shift.openedBy || "Sorumlu atanmadı";
                return (
                  <button
                    key={reg.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`cash-register-tab ${isSelected ? "active" : ""}`}
                    onClick={() => {
                      setSelectedRegisterId(reg.id);
                      setError("");
                      setNotice("");
                    }}
                  >
                    <div className="cash-register-tab-top">
                      <span className="cash-register-tab-name">{reg.name}</span>
                      <StatusPill tone={regOpenShift ? "green" : "neutral"}>
                        {regOpenShift ? "Açık" : "Kapalı"}
                      </StatusPill>
                    </div>
                    <div className="cash-register-tab-meta">
                      <span><UserCheck size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />{responsibleLabel}</span>
                      <span className="cash-register-tab-code">{reg.code}</span>
                    </div>
                    <div className="cash-register-tab-balance">
                      <span>Çekmece:</span>
                      <strong>{regOpenShift ? money(regOpenShift.shift.expectedCashMinor ?? 0) : "0,00 ₺"}</strong>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {!selectedRegister ? (
          <div className="card empty-list">
            <strong>Bu şube için kasa kaydı bulunamadı</strong>
            <span>Sol menüdeki "Mevcut Kasalar" sayfasından yeni kasa ve kasa sorumlusu tanımlayabilirsiniz.</span>
          </div>
        ) : (
          <>
            {displayView === "summary" && (
              <>
                {/* Seçili Kasa Durumu Hero Kartı */}
                <div className="cash-summary-hero cash-summary-hero-compact">
                  <div className="cash-hero-main">
                    <div className="cash-hero-badge-row">
                      <h2>{selectedRegister.name} <span className="cash-hero-code">({selectedRegister.code})</span></h2>
                      <StatusPill tone={active ? "green" : "neutral"}>
                        {active ? "Vardiya Açık" : "Vardiya Kapalı"}
                      </StatusPill>
                    </div>
                    <div className="cash-hero-opening-details">
                      <span><UserCheck size={14} /> Sorumlu: <strong>{selectedRegister.responsible || active?.shift.openedBy || "Genel Sorumlu"}</strong></span>
                      {active ? <>
                        <span>Açılış: <strong>{dateTime(active.shift.openedAt)}</strong> ({shiftDuration(active.shift.openedAt)})</span>
                        <span>Açan: <strong>{active.shift.openedBy}</strong></span>
                        <span>{active.movementCount} hareket</span>
                      </> : <span>Açık vardiya bulunmuyor; başlamak için başlangıç avansı ile vardiyayı açın.</span>}
                    </div>
                    {active?.shift.openingNote && (
                      <div className="cash-hero-note">
                        <strong>Açılış Notu:</strong> {active.shift.openingNote}
                      </div>
                    )}
                  </div>

                  <div className="cash-hero-kpis">
                    <div className="cash-hero-kpi balance">
                      <span className="cash-hero-balance-label">Bu kasanın toplam satışı</span>
                      <strong className="cash-hero-balance-value">{money(selectedRegisterTotalSales)}</strong>
                     
                      {active && (
                        <Link to="/admin/cash/shifts" className="cash-hero-action-link">
                          Vardiyayı Kapat & Sayım Yap <ArrowRight size={13} />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>

                {/* Seçili Kasa Metrik Kartları */}
                <div className="metric-grid">
                  <MetricCard
                    tone="green"
                    title="Kasadaki Beklenen Nakit"
                    value={active ? money(currentExpected) : "—"}
                    foot={`${selectedRegister.name} · Açılış + Girişler − Çıkışlar`}
                    icon={<Wallet size={18} />}
                  />
                  <MetricCard
                    tone="blue"
                    title="Açılış Nakdi (Kasa Avansı)"
                    value={active ? money(active.shift.openingCashMinor) : "—"}
                    foot={active ? `Açan: ${active.shift.openedBy}` : "Açık vardiya yok"}
                    icon={<Banknote size={18} />}
                  />
                  <MetricCard
                    tone="green"
                    title="Kasaya Nakit Girişi"
                    value={active ? `+${money(active.cashInMinor)}` : "—"}
                    foot={active ? `Net akış: ${active.cashInMinor - active.cashOutMinor >= 0 ? "+" : ""}${money(active.cashInMinor - active.cashOutMinor)}` : "Yalnızca açık vardiya"}
                    icon={<ArrowDownLeft size={18} />}
                  />
                  <MetricCard
                    tone="orange"
                    title="Kasadan Nakit Çıkışı"
                    value={active ? `−${money(active.cashOutMinor)}` : "—"}
                    foot="Giderler ve kasadan teslimler"
                    icon={<ArrowUpRight size={18} />}
                  />
                </div>

                {/* İki Kolonlu Gövde: Sol (Seçili Kasa Defteri & Önceki Kapanış) / Sağ (Seçili Kasa İşlemleri) */}
                <div className="cash-layout">
                  {/* Sol Kolon */}
                  <div className="cash-main-column">
                    <section className="card cash-panel">
                      <header>
                        <div>
                          <span className="eyebrow">{selectedRegister.name.toUpperCase()} · {active ? "AÇIK VARDİYA" : "KASA DEFTERİ"}</span>
                          <h2>{active ? "Vardiya Hareketleri" : "Son Kasa Hareketleri"}</h2>
                        </div>
                        <Link className="cash-history-link" to="/admin/cash/movements">Tüm defteri incele →</Link>
                      </header>
                      <p>
                        {active
                          ? `${selectedRegister.name} · Başlangıç ${money(active.shift.openingCashMinor)} · ${dateTime(active.shift.openedAt)} · Toplam ${active.movementCount} hareket`
                          : `${selectedRegister.name} kasasına ait geçmiş hareket kayıtları aşağıda listelenmiştir.`}
                      </p>
                      <CashMovementList items={active ? active.recentMovements : totalRecent} />
                    </section>

                    {lastClosedShift && (
                      <section className="card cash-settlement-card">
                        <div className="cash-settlement-header">
                          <div>
                            <span className="eyebrow">{selectedRegister.name.toUpperCase()} · MUTABAKAT & DEVİR</span>
                            <h3>Önceki Vardiya Kapanış Bilgisi</h3>
                          </div>
                          {renderDifferencePill(lastClosedShift.differenceMinor)}
                        </div>
                        <div className="cash-settlement-meta">
                          Kapanış: <strong>{lastClosedShift.closedAt ? dateTime(lastClosedShift.closedAt) : dateTime(lastClosedShift.openedAt)}</strong> · Kapatan: <strong>{lastClosedShift.closedBy ?? "—"}</strong> · Açan: <strong>{lastClosedShift.openedBy}</strong>
                        </div>
                        <div className="cash-settlement-stats">
                          <div className="cash-settlement-stat">
                            <span>Kasada Beklenen</span>
                            <strong>{money(lastClosedShift.expectedCashMinor ?? 0)}</strong>
                          </div>
                          <div className="cash-settlement-stat">
                            <span>Fiziksel Sayılan</span>
                            <strong>{money(lastClosedShift.countedCashMinor ?? 0)}</strong>
                          </div>
                          <div className="cash-settlement-stat">
                            <span>Kasa Farkı</span>
                            <strong>{money(lastClosedShift.differenceMinor ?? 0)}</strong>
                          </div>
                          {(lastClosedShift.retainedFloatMinor != null || lastClosedShift.droppedRevenueMinor != null) && (
                            <>
                              <div className="cash-settlement-stat">
                                <span>Devreden Bozuk Para</span>
                                <strong>{money(lastClosedShift.retainedFloatMinor ?? 0)}</strong>
                              </div>
                              <div className="cash-settlement-stat">
                                <span>Teslim Edilen Hasılat</span>
                                <strong style={{ color: "#2b6cb0" }}>{money(lastClosedShift.droppedRevenueMinor ?? 0)}</strong>
                              </div>
                            </>
                          )}
                        </div>
                        {lastClosedShift.closeNote && (
                          <div className="cash-settlement-note">
                            <strong>Kapanış / Fark Açıklaması:</strong> {lastClosedShift.closeNote}
                          </div>
                        )}
                        {!!lastClosedShift.denominations?.length && (
                          <div className="cash-settlement-denominations">
                            <strong>Kupür Sayım Detayı:</strong> {lastClosedShift.denominations.map((item) => `${money(item.denominationMinor)} × ${item.quantity}`).join(" · ")}
                          </div>
                        )}
                        <div className="cash-settlement-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <button
                            type="button"
                            className="primary-button"
                            style={{ padding: "6px 14px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}
                            onClick={() => void openZReport(lastClosedShift.id)}
                            disabled={zReportLoading}
                          >
                            🧾 Z-Raporunu Aç / Yazdır
                          </button>
                          <Link className="cash-history-link" to="/admin/cash/shifts">Tüm vardiya geçmişini gör →</Link>
                        </div>
                      </section>
                    )}
                  </div>

                  {/* Sağ Kolon */}
                  <div className="cash-side-column">
                    {active ? (
                      <>
                        {canWrite ? (
                          <form className="card cash-panel" onSubmit={(event) => void addMovement(event)}>
                            <span className="eyebrow">{selectedRegister.name.toUpperCase()} · HIZLI İŞLEM</span>
                            <h2>Giriş veya çıkış kaydet</h2>
                            <p>{selectedRegister.name} kasasına eklenen veya kasadan alınan parayı kaydedin.</p>

                            <div className="cash-kind-selector">
                              <button
                                type="button"
                                className={`cash-kind-btn ${movementKind === "manual_in" ? "active in" : ""}`}
                                onClick={() => {
                                  setMovementKind("manual_in");
                                  setMovementCategory("cash_sale");
                                }}
                              >
                                <ArrowDownLeft size={15} /> + Nakit Girişi
                              </button>
                              <button
                                type="button"
                                className={`cash-kind-btn ${movementKind === "manual_out" ? "active out" : ""}`}
                                onClick={() => {
                                  setMovementKind("manual_out");
                                  setMovementCategory("expense");
                                }}
                              >
                                <ArrowUpRight size={15} /> − Nakit Çıkışı
                              </button>
                            </div>

                            <label>
                              Kategori
                              <select value={movementCategory} onChange={(event) => setMovementCategory(event.target.value)}>
                                {movementKind === "manual_in" ? (
                                  <>
                                    <option value="cash_sale">Elle kaydedilen nakit satış</option>
                                    <option value="other">Kasa Bozuk Para / Avans Takviyesi</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="expense">İşletme gideri / Masraf</option>
                                    <option value="cash_drop">Kasadan teslim (Safe Drop)</option>
                                    <option value="other">Diğer nakit çıkışı</option>
                                  </>
                                )}
                              </select>
                            </label>

                            <label>
                              Tutar (TL)
                              <input inputMode="decimal" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} placeholder="0,00" />
                            </label>

                            <label>
                              Açıklama (isteğe bağlı)
                              <input value={movementDescription} onChange={(event) => setMovementDescription(event.target.value)} placeholder="İsteğe bağlı açıklama veya boş bırakabilirsiniz" />
                            </label>

                            <button className="primary-button" disabled={busy}>
                              Hareketi kaydet
                            </button>
                          </form>
                        ) : (
                          <div className="card cash-panel">
                            <strong>Kasa modülü yeni işleme kapalı</strong>
                            <p>Açık vardiya güvenle kapatılabilir; yeni hareket için modülü etkinleştirin.</p>
                          </div>
                        )}

                        <div className="cash-audit-card">
                          <div className="cash-audit-title">
                            <ShieldCheck size={16} /> Kasa Denetim & Güvenlik İlkeleri
                          </div>
                          <ul className="cash-audit-list">
                            <li><strong>Değiştirilemez Kasa Defteri:</strong> Kayıtlar geriye dönük silinemez; hatalı girişler gerekçeli ters kayıt ile dengelenir.</li>
                            <li><strong>Çoklu Kasa İzolasyonu:</strong> Her kasanın vardiyası, açılış avansı ve çekmece bakiyesi kendi içinde bağımsız takip edilir.</li>
                            <li><strong>Gün Sonu Mutabakatı:</strong> Vardiya kapatılırken kupür sayımı ile kasa sayım farkı denetlenir.</li>
                          </ul>
                          <Link to="/admin/cash/shifts" className="cash-shift-action-btn">
                            {selectedRegister.name} Kapatma ve Sayım Ekranı <ArrowRight size={14} />
                          </Link>
                        </div>
                      </>
                    ) : (
                      <form className="card cash-panel cash-open-form" onSubmit={(event) => void openShift(event)}>
                        <span className="eyebrow">{selectedRegister.name.toUpperCase()} · VARDİYA AÇILIŞI</span>
                        <h2>Yeni kasa vardiyası başlat</h2>
                        <p>
                          <strong>{selectedRegister.name}</strong> ({selectedRegister.responsible || "Genel Sorumlu"}) için kasadaki başlangıç nakdini girin.
                        </p>

                        <label>
                          Açılış nakdi (TL)
                          <input inputMode="decimal" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} placeholder="Örn. 1.000,00" />
                        </label>

                        <div className="cash-quick-chips">
                          <span>Hızlı Tutar:</span>
                          {[500, 1000, 1500, 2000].map((quickAmount) => (
                            <button
                              key={quickAmount}
                              type="button"
                              className="cash-chip-btn"
                              onClick={() => setOpeningCash(quickAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 }))}
                            >
                              {quickAmount.toLocaleString("tr-TR")} ₺
                            </button>
                          ))}
                        </div>

                        <label>
                          Açılış notu (isteğe bağlı)
                          <input maxLength={500} value={openingNote} onChange={(event) => setOpeningNote(event.target.value)} placeholder="Vardiya için not ekleyin" />
                        </label>

                        <button className="primary-button" disabled={!canWrite || busy}>
                          {canWrite ? "Vardiyayı aç" : "Kasa modülü kapalı"}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </>
            )}

            {displayView === "movements" && (
              <section className="card cash-history">
                <header>
                  <h2>{selectedRegister.name} · Değiştirilemez kasa defteri</h2>
                  <span>{registerMovements.length} hareket</span>
                </header>
                <CashMovementList
                  items={registerMovements}
                  onCorrect={
                    canWrite && active
                      ? (movement) => {
                        setCorrectingId(movement.id);
                        setCorrectionReason("");
                        setError("");
                      }
                      : undefined
                  }
                />
                {correctingId && (
                  <form className="cash-correction-form" onSubmit={(event) => void reverseMovement(event)}>
                    <div>
                      <span className="eyebrow">MANUEL DÜZELTME · TERS KAYIT</span>
                      <strong>Orijinal hareket değiştirilmeyecek</strong>
                    </div>
                    <label>
                      Gerekçe
                      <textarea
                        rows={3}
                        maxLength={500}
                        required
                        minLength={3}
                        value={correctionReason}
                        onChange={(event) => setCorrectionReason(event.target.value)}
                        placeholder="Örn. yanlış tutar elle girildi"
                      />
                    </label>
                    <div className="cash-correction-actions">
                      <button type="button" className="secondary-button" onClick={() => setCorrectingId(null)}>
                        Vazgeç
                      </button>
                      <button className="primary-button" disabled={busy || correctionReason.trim().length < 3}>
                        Ters kaydı oluştur
                      </button>
                    </div>
                  </form>
                )}
                {!active && <p className="cash-correction-hint">Düzeltme için {selectedRegister.name} kasasında yeni bir açık vardiya başlatın.</p>}
              </section>
            )}

            {displayView === "shifts" && (
              <div className="cash-layout cash-layout-shifts">
                <section className="card cash-history">
                  <header>
                    <h2>{selectedRegister.name} · Vardiya geçmişi</h2>
                    <span>{registerShifts.length} vardiya</span>
                  </header>
                  {registerShifts.length ? (
                    <div className="cash-shift-list">
                      {registerShifts.map((shift) => (
                        <article key={shift.id}>
                          <div>
                            <StatusPill tone={shift.status === "open" ? "green" : shift.differenceMinor ? "orange" : "neutral"}>
                              {shift.status === "open" ? "Açık vardiya" : "Kapandı"}
                            </StatusPill>
                            <strong>{dateTime(shift.openedAt)}</strong>
                            <span>
                              Açan {shift.openedBy}
                              {shift.closedAt ? ` · Kapatan ${shift.closedBy ?? "—"}` : ""}
                            </span>
                            {shift.openingNote && <span>Açılış notu: {shift.openingNote}</span>}
                          </div>
                          <div>
                            <small>Beklenen</small>
                            <b>{money(shift.expectedCashMinor ?? active?.shift.expectedCashMinor ?? shift.openingCashMinor)}</b>
                          </div>
                          {shift.status === "closed" && (
                            <div>
                              <small>Sayılan · fark</small>
                              <b>{money(shift.countedCashMinor ?? 0)} · {money(shift.differenceMinor ?? 0)}</b>
                              {shift.droppedRevenueMinor != null && (
                                <span style={{ display: "block", fontSize: 11.5, color: "#2b6cb0", marginTop: 2 }}>
                                  Teslim: {money(shift.droppedRevenueMinor)} · Devir: {money(shift.retainedFloatMinor ?? 0)}
                                </span>
                              )}
                              {!!shift.denominations?.length && (
                                <span>
                                  Kupür dökümü: {shift.denominations.map((item) => `${money(item.denominationMinor)} × ${item.quantity}`).join(" · ")}
                                </span>
                              )}
                            </div>
                          )}
                          <div style={{ marginTop: 6 }}>
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ fontSize: 12, padding: "4px 8px" }}
                              onClick={() => void openZReport(shift.id)}
                              disabled={zReportLoading}
                            >
                              🧾 {shift.status === "open" ? "X-Raporu" : "Z-Raporu"}
                            </button>
                          </div>
                          {shift.closeNote && <p>{shift.closeNote}</p>}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-list">Bu kasada henüz vardiya kaydı bulunmuyor.</div>
                  )}
                </section>

                {active ? (
                  <form className="card cash-panel" onSubmit={(event) => void closeShift(event)}>
                    <span className="eyebrow">{selectedRegister.name.toUpperCase()} · VARDİYA KAPANIŞI</span>
                    <h2>Fiziksel nakit sayımı</h2>
                    <p>
                      Beklenen nakit tutarı: <strong>{money(currentExpected)}</strong>
                    </p>
                    <fieldset className="cash-denomination-grid">
                      <legend>Kupür sayımı (isteğe bağlı — doğrudan toplamı da yazabilirsiniz)</legend>
                      {cashDenominations.map((denomination) => (
                        <label key={denomination}>
                          {money(denomination)}
                          <input
                            type="number"
                            min="0"
                            max="1000000"
                            step="1"
                            inputMode="numeric"
                            value={denominationCounts[denomination] ?? ""}
                            onChange={(event) => {
                              const quantity = Math.max(0, Math.min(1000000, Math.floor(Number(event.target.value) || 0)));
                              const next = { ...denominationCounts, [denomination]: quantity };
                              setDenominationCounts(next);
                              const total = cashDenominations.reduce((sum, unit) => sum + unit * (next[unit] ?? 0), 0);
                              setCountedCash(`${Math.floor(total / 100)},${String(total % 100).padStart(2, "0")}`);
                            }}
                          />
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      Kasada sayılan (TL)
                      <input
                        inputMode="decimal"
                        placeholder={`Örn. ${Math.floor(currentExpected / 100)},${String(currentExpected % 100).padStart(2, "0")}`}
                        value={countedCash}
                        onChange={(event) => setCountedCash(event.target.value)}
                      />
                    </label>
                    <label>
                      Yarına Devreden Bozuk Para / Avans (TL)
                      <input
                        inputMode="decimal"
                        placeholder={`Varsayılan: ${Math.floor(Math.min(Number.isSafeInteger(amountMinor(countedCash)) ? amountMinor(countedCash) : 0, active.shift.openingCashMinor) / 100)},00`}
                        value={retainedFloat}
                        onChange={(event) => setRetainedFloat(event.target.value)}
                      />
                      <small style={{ color: "#718096", fontSize: 12, marginTop: 4, display: "block" }}>
                        Kasadaki madeni/bozuk para olarak bırakılacak tutar. Kalan tutar kasadan alınıp patrona/çelik kasaya teslim edilir (Safe Drop).
                      </small>
                    </label>
                    {(() => {
                      const counted = amountMinor(countedCash);
                      if (!Number.isSafeInteger(counted) || counted <= 0) return null;
                      const retainedParsed = retainedFloat.trim() ? amountMinor(retainedFloat) : NaN;
                      const retained = Number.isSafeInteger(retainedParsed) ? retainedParsed : Math.min(counted, active.shift.openingCashMinor);
                      const safeDrop = Math.max(0, counted - retained);
                      return (
                        <div style={{ background: "#edf2f7", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>
                          <div>Devreden Bozuk Para: <strong>{money(retained)}</strong></div>
                          <div style={{ marginTop: 4 }}>
                            Patrona / Çelik Kasaya Teslim Edilecek Hasılat (Safe Drop): <strong style={{ color: "#2b6cb0", fontSize: 14 }}>{money(safeDrop)}</strong>
                          </div>
                        </div>
                      );
                    })()}
                    <label>
                      Fark açıklaması (fark varsa zorunlu)
                      <textarea
                        rows={3}
                        value={closeNote}
                        onChange={(event) => setCloseNote(event.target.value)}
                        placeholder="Sayım farkı nedenini açıklayın"
                      />
                    </label>
                    {error && (
                      <div
                        role="alert"
                        style={{
                          background: "#fff5f5",
                          border: "1px solid #feb2b2",
                          borderRadius: 10,
                          padding: "12px 14px",
                          color: "#9b2c2c",
                          fontSize: 13,
                          lineHeight: 1.5,
                        }}
                      >
                        <strong style={{ display: "block", marginBottom: 4, fontSize: 13.5 }}>⚠️ İşlem Tamamlanamadı</strong>
                        <span>{error}</span>
                      </div>
                    )}
                    <button className="primary-button" disabled={busy}>
                      Say ve vardiyayı kapat
                    </button>
                  </form>
                ) : (
                  <form className="card cash-open-form" onSubmit={(event) => void openShift(event)}>
                    <span className="eyebrow">{selectedRegister.name.toUpperCase()} · VARDİYA AÇILIŞI</span>
                    <h2>Yeni kasa vardiyası başlat</h2>
                    <p>Kasadaki başlangıç nakdini girin. Açılış nakdi ayrı ve değiştirilemez bir hareket olarak kaydedilir.</p>
                    <label>
                      Açılış nakdi (TL)
                      <input inputMode="decimal" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} placeholder="Örn. 1.000,00" />
                    </label>
                    <label>
                      Açılış notu (isteğe bağlı)
                      <input maxLength={500} value={openingNote} onChange={(event) => setOpeningNote(event.target.value)} placeholder="Vardiya için not ekleyin" />
                    </label>
                    <button className="primary-button" disabled={!canWrite || busy}>
                      {canWrite ? "Vardiyayı aç" : "Kasa modülü kapalı"}
                    </button>
                  </form>
                )}
              </div>
            )}
          </>
        )}
      </>
    )}
    {activeZReport && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-z-report-title"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10000,
          padding: 16,
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setActiveZReport(null);
        }}
      >
        <section
          style={{
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
            maxWidth: 460,
            width: "100%",
            maxHeight: "90vh",
            overflowY: "auto",
            padding: "20px 24px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        >
          <header style={{ borderBottom: "2px dashed #cbd5e0", paddingBottom: 12, marginBottom: 14, textAlign: "center", position: "relative" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#718096", letterSpacing: 2, textTransform: "uppercase" }}>
              {activeZReport.registerName} ({activeZReport.registerCode})
            </span>
            <h2 id="admin-z-report-title" style={{ margin: "6px 0 2px", fontSize: 20, color: "#1a202c" }}>
              {activeZReport.reportType === "Z" ? "GÜN SONU Z-RAPORU" : "GÜN İÇİ X-RAPORU"}
            </h2>
            <small style={{ color: "#4a5568", fontSize: 12, fontWeight: 700 }}>
              Rapor No: {activeZReport.reportNumber}
            </small>
            <button
              type="button"
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                border: "none",
                background: "transparent",
                fontSize: 22,
                cursor: "pointer",
                lineHeight: 1,
                color: "#718096",
              }}
              onClick={() => setActiveZReport(null)}
              aria-label="Kapat"
            >
              ×
            </button>
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
          <footer style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="secondary-button" onClick={() => window.print()}>🖨️ Yazdır</button>
            <button type="button" className="primary-button" onClick={() => setActiveZReport(null)}>Tamam</button>
          </footer>
        </section>
      </div>
    )}
  </>;
}

function CashMovementList({ items, onCorrect }: { items: Movement[]; onCorrect?: (movement: Movement) => void }) {
  if (!items.length) return <div className="empty-list">Henüz kaydedilmiş kasa hareketi yok.</div>;
  return (
    <div className="cash-movement-list">
      {items.map((item) => {
        const isCard = item.kind === "pos_sale" && item.tenderMethod === "card";
        const isOut = item.kind === "manual_out";
        return (
          <article key={item.id}>
            <span className={`cash-movement-icon ${isCard ? "card" : isOut ? "out" : "in"}`}>
              {isCard ? <CreditCard size={16} /> : isOut ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
            </span>
            <div>
              <strong>{movementTitle(item)}</strong>
              <span>{item.correctionType === "reversal" ? item.correctionReason : item.description}</span>
              <small>
                {dateTime(item.createdAt)} · {item.actor} · {item.source === "pos" ? "Adisyon / Masa tahsilatı" : "Elle kaydedildi"}
                {item.originalMovementId ? ` · İlk kayıt: ${item.originalMovementId.slice(0, 8)}` : ""}
              </small>
            </div>
            <b className={isCard ? "cash-card-amount" : isOut ? "cash-negative" : "cash-positive"}>
              {isCard ? "Kart · " : isOut ? "−" : "+"}
              {money(item.amountMinor)}
            </b>
            {onCorrect &&
              item.source === "manual" &&
              !item.originalMovementId &&
              (item.kind === "manual_in" || item.kind === "manual_out") && (
                <button
                  className="secondary-button cash-reverse-button"
                  onClick={() => onCorrect(item)}
                  aria-label={`${movementTitle(item)} hareketini düzelt`}
                >
                  <RotateCcw size={14} /> Düzelt
                </button>
              )}
          </article>
        );
      })}
    </div>
  );
}
