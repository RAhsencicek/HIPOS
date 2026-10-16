import { describe, expect, it } from "vitest";
import { sections } from "./catalog";
import { featureStories } from "./featureStories";

const navigationItems = sections.flatMap(section =>
  section.items.map(item => `${section.id}/${item.slug}`),
);

describe("müşteriye yönelik özellik tanıtımları", () => {
  it("her menü başlığı için özel açıklama ve üç fayda içerir", () => {
    for (const route of navigationItems) {
      const story = featureStories[route];
      expect(story, `${route} için tanıtım eksik`).toBeDefined();
      expect(story.headline.length, route).toBeGreaterThan(15);
      expect(story.description.length, route).toBeGreaterThan(65);
      expect(story.benefits, route).toHaveLength(3);
      expect(new Set(story.benefits).size, route).toBe(3);
    }
  });

  it("müşteriye teknik altyapı ve geliştirme aşaması metinleri göstermez", () => {
    for (const [route, story] of Object.entries(featureStories)) {
      const copy = [story.headline, story.description, ...story.benefits].join(" ");
      expect(copy, route).not.toMatch(/PostgreSQL|VITE_|migration|backfill|API|güvenilir veri sunmaz|ürün yol haritasındadır|üretim kimlik doğrulaması/);
    }
  });
});
