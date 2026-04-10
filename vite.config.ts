import { createHash } from "node:crypto";
import { defineConfig } from "vite";

const buildHash = createHash("sha1")
  .update(`${Date.now()}-${Math.random()}`)
  .digest("hex")
  .slice(0, 10);

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/OrbinexSimulation/" : "/",
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash),
  },
  server: {
    port: 5176,
  },
  build: {
    manifest: true,
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
}));
