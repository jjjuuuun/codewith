import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
export default defineConfig(({ command }) => ({
  plugins: [
    vue({ template: { transformAssetUrls: { includeAbsolute: false } } }),
    {
      name: "codewith-editor-entry",
      resolveId(id) {
        if (id !== "@codewith/editor") return;
        return command === "serve"
          ? fileURLToPath(new URL("./src/rich-editor.js", import.meta.url))
          : { id: "/text-editor.js", external: true };
      },
    },
  ],
  build: {
    outDir: "dist",
    target: "es2022",
    rollupOptions: { external: ["/text-editor.js"] },
  },
  server: {
    host: "127.0.0.1",
    fs: { deny: [".env", ".env.*", "**/.codewith/**", "**/.git/**"] },
  },
}));
