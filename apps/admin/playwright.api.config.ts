import { defineConfig } from "@playwright/test";

const uiPort = Number(process.env.HIPOS_TEST_UI_PORT ?? "5174");

export default defineConfig({
  testDir: "./tests/api-e2e",
  use: {
    baseURL: `http://127.0.0.1:${uiPort}`,
    browserName: "chromium",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "ASPNETCORE_ENVIRONMENT=Development dotnet run --project ../api/Hipos.Api/Hipos.Api.csproj --no-launch-profile --urls http://127.0.0.1:5181",
      url: "http://127.0.0.1:5181/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `VITE_FEATURE_PROVIDER=http VITE_API_BASE_URL=http://127.0.0.1:5181 npm run dev -- --port ${uiPort} --strictPort`,
      url: `http://127.0.0.1:${uiPort}/admin`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
