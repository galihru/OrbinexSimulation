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
    target: "es2020",
    minify: "terser",
    cssMinify: true,
    cssCodeSplit: true,
    terserOptions: {
      compress: {
        passes: 3,
        drop_console: true,
        drop_debugger: true,
        toplevel: true,
      },
      mangle: {
        toplevel: true,
      },
      format: {
        comments: false,
        ascii_only: true,
      },
    },
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
}));
