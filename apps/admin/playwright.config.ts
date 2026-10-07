import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:5175",
    browserName: "chromium",
    trace: "on-first-retry",
  },
  webServer: {
    command: "VITE_FEATURE_PROVIDER=mock VITE_CATALOG_PROVIDER=mock npm run dev -- --port 5175 --strictPort",
    url: "http://127.0.0.1:5175/admin",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
