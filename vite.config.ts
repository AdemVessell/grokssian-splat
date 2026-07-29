import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// GitHub Pages project site: https://ademvessell.github.io/grokssian-splat/
// Production host (grok.me / Vercel) and local dev use root base.
const base = process.env.GITHUB_PAGES === "true" ? "/grokssian-splat/" : "/";

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: { host: "0.0.0.0", port: 8080, strictPort: true },
  preview: { host: "0.0.0.0", port: 8080, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
});
