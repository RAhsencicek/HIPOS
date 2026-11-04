import { describe, expect, it } from "vitest";
import { cardSalesToday, validCashSalesToday, validRegisterSales } from "./CashManagementPage";

describe("günlük kasa nakit satışları", () => {
  it("İstanbul gününü, ödeme türünü ve ters kayıtları dikkate alır", () => {
    const base = { kind: "manual_in", category: "cash_sale", tenderMethod: null, correctionType: null, originalMovementId: null, createdAt: "2026-11-02T21:30:00Z" };
    const movements = [
      { ...base, id: "valid" },
      { ...base, id: "yesterday", createdAt: "2026-11-02T20:59:00Z" },
      { ...base, id: "reversed" },
      { ...base, id: "reversal", kind: "manual_out", correctionType: "reversal", originalMovementId: "reversed" },
      { ...base, id: "card", kind: "pos_sale", tenderMethod: "card" },
      { ...base, id: "cash", kind: "pos_sale", tenderMethod: "cash" },
    ];
    expect(validCashSalesToday(movements, new Date("2026-11-03T12:00:00Z")).map((m) => m.id)).toEqual(["valid", "cash"]);
  });
});

describe("kasa satış toplamları", () => {
  const base = { registerId: "a", kind: "pos_sale", category: "cash_sale", tenderMethod: "card", correctionType: null as string | null, originalMovementId: null as string | null, createdAt: "2026-11-02T21:30:00Z", amountMinor: 100 };
  it("günlük kart toplamında İstanbul günü dışındaki ve nakit işlemleri dışlar", () => {
    const items = [{ ...base, id: "today" }, { ...base, id: "yesterday", createdAt: "2026-11-02T20:59:00Z" }, { ...base, id: "cash", tenderMethod: "cash" }];
    expect(cardSalesToday(items, new Date("2026-11-03T12:00:00Z")).map((m) => m.id)).toEqual(["today"]);
  });
  it("100 hareketten eski satışları içerir, ters kayıtları ve diğer kasaları dışlar", () => {
    const items = Array.from({ length: 105 }, (_, i) => ({ ...base, id: String(i) }));
    items.push({ ...base, id: "cash", kind: "manual_in", tenderMethod: "cash", amountMinor: 500 });
    items.push({ ...base, id: "reverse", kind: "manual_out", correctionType: "reversal", originalMovementId: "cash", amountMinor: 500 });
    items.push({ ...base, id: "other", registerId: "b", amountMinor: 900 });
    const sales = validRegisterSales(items, "a");
    expect(sales).toHaveLength(105);
    expect(sales.reduce((sum, m) => sum + m.amountMinor, 0)).toBe(10500);
  });
});
