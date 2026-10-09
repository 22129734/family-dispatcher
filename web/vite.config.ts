import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Версия приложения — дата и время сборки (по ней поддержка понимает, что у человека)
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  server: {
    host: true,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
