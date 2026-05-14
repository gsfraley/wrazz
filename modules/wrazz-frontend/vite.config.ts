import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "wrazz-editor": fileURLToPath(
        new URL("../wrazz-editor/src/index.ts", import.meta.url)
      ),
    },
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
