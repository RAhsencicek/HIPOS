import { describe, expect, it } from "vitest";
import { featureCatalogVersion, featureDefinitions } from "./featureDefinitions";

describe("paylaşılan modül sözleşmesi", () => {
  it("sürümü, tekil anahtarları ve geçerli bağımlılıkları korur", () => {
    expect(featureCatalogVersion).toBe(5);
    const keys = featureDefinitions.map((definition) => definition.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);

    const byKey = new Map(featureDefinitions.map((definition) => [definition.key, definition]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (key: string) => {
      if (visited.has(key)) return;
      expect(visiting.has(key), `Döngüsel bağımlılık: ${key}`).toBe(false);
      visiting.add(key);
      for (const dependency of byKey.get(key)!.dependencies) {
        expect(byKey.has(dependency), `Bilinmeyen bağımlılık: ${dependency}`).toBe(true);
        expect(dependency).not.toBe(key);
        visit(dependency);
      }
      visiting.delete(key);
      visited.add(key);
    };

    for (const definition of featureDefinitions) {
      expect(definition.scopeType).toBe("branch");
      expect(["real", "backend_preview", "prototype", "planned"]).toContain(definition.availability);
      visit(definition.key);
    }
  });
});
