import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  root: "frontend",
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "frontend", "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Keep 5173 as the preferred port, but fall back when another dev server
    // is already using it instead of failing startup.
    strictPort: false,
  },
});
