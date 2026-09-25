import { createDevelopmentApplication } from "./dev-application.mjs";
import { listenConfig } from "../server/deployment.mjs";
import { spawnSync } from "node:child_process";
const build = spawnSync(process.execPath, ["scripts/build-editor.mjs"], {
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status || 1);
const app = await createDevelopmentApplication();
const { port, host } = listenConfig(app.config, process.argv.slice(2));
app.server.listen(port, host, () =>
  console.log(`CodeWith Vue development: http://${host}:${port}`),
);
async function stop() {
  await app.vite.close();
  app.server.close(async () => {
    await app.closed;
    process.exit(0);
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
