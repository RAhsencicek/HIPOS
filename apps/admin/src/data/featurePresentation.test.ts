import { describe, expect, it } from "vitest";
import { featurePresentation, isFutureSidebarItem } from "./featurePresentation";

const mockSources = {
  catalogSource: "mock" as const,
  featureSource: "mock" as const,
  cashSource: "mock" as const,
};

describe("alt ekran durum sözleşmesi", () => {
  it("kasa alt ekranlarını HTTP sağlayıcıyla çalışıyor olarak gösterir", () => {
    for (const item of ["summary", "movements", "shifts", "opening-closing"]) {
      const presentation = featurePresentation("cash", item, {
        ...mockSources,
        cashSource: "http",
      });

      expect(presentation.stage).toBe("working");
      expect(presentation.label).toBe("Çalışıyor");
      expect(presentation.description).not.toMatch(/PostgreSQL|API|VITE_/);
    }
  });

  it("kasa sağlayıcısı mock ise hazır olmayan alt ekranı gelecek planı olarak ayırır", () => {
    const presentation = featurePresentation("cash", "movements", mockSources);

    expect(presentation.stage).toBe("future");
    expect(presentation.label).toBe("Çok yakında");
  });

  it("yan menüde etkin kasa ekranlarını kırmızı gelecek rengi dışında tutar", () => {
    const httpSources = { ...mockSources, cashSource: "http" as const };

    expect(isFutureSidebarItem("cash", "movements", httpSources)).toBe(false);
    expect(isFutureSidebarItem("cash", "summary", httpSources)).toBe(false);
    expect(isFutureSidebarItem("cash", "refunds", httpSources)).toBe(true);
    expect(isFutureSidebarItem("cash", "movements", mockSources)).toBe(true);
  });

  it("gider ekranlarını yalnız PostgreSQL sağlayıcısı bağlıyken çalışıyor gösterir", () => {
    for (const item of ["expenses", "expense-categories"]) {
      const presentation = featurePresentation("finance", item, {
        ...mockSources,
        expenseSource: "http",
      });
      expect(presentation.stage).toBe("working");
      expect(presentation.description).not.toMatch(/PostgreSQL|API|VITE_/);
      expect(isFutureSidebarItem("finance", item, { ...mockSources, expenseSource: "http" })).toBe(false);
      expect(isFutureSidebarItem("finance", item, mockSources)).toBe(true);
    }
  });
});
