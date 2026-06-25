import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/sessions": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
});
