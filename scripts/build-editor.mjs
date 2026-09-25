import { build } from "esbuild";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await build({
  define: {
    "import.meta.env": JSON.stringify(loadEnv("production", root, "VITE_")),
  },
  entryPoints: [root + "src/rich-editor.js"],
  outfile: root + "public/text-editor.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
});
await build({
  define: {
    "import.meta.env": JSON.stringify(loadEnv("production", root, "VITE_")),
  },
  entryPoints: [root + "src/auth-wait.js"],
  outfile: root + "public/auth-wait.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
});
console.log("Built local rich text editor and authentication hand-off");
