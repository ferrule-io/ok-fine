import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = "http://127.0.0.1:8080";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/ui/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("../dist/ui", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": backend, "/.well-known": backend, "/ui/config.json": backend },
  },
});
