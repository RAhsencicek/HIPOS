import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, ".", "HIPOS_DEV_API_TARGET").HIPOS_DEV_API_TARGET;
  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0", port: 5176,
      ...(target ? { proxy: { "/api": target } } : {}),
    },
  };
});
