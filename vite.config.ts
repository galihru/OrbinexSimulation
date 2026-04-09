import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/OrbinexSimulation/" : "/",
  server: {
    port: 5176,
  },
}));
