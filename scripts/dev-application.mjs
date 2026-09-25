import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createApplication } from "../server/index.mjs";

export async function createDevelopmentApplication(options = {}) {
  let vite;
  const app = await createApplication({
    ...options,
    frontendMiddleware: (req, res, next) => vite.middlewares(req, res, next),
  });
  try {
    vite = await createServer({
      root: fileURLToPath(new URL("../", import.meta.url)),
      server: { middlewareMode: true, hmr: { server: app.server } },
      appType: "spa",
    });
    return { ...app, vite };
  } catch (error) {
    app.server.close();
    throw error;
  }
}
