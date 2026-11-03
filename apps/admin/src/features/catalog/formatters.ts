import type { Money, SalesChannel } from "./contracts";

export function formatCatalogMoney(money: Money): string {
  if (!Number.isSafeInteger(money.amountMinor)) return "—";
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(money.amountMinor / 100);
}

export function parseCatalogPrice(input: string): number | null {
  const match = /^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(",", "."));
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return amount > 0 && amount <= 1_000_000_000 ? amount : null;
}

export const channelLabels: Record<SalesChannel, string> = {
  pos: "POS",
  qr: "QR",
  delivery: "Paket",
};
