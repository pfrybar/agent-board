import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
if (!config.supervisorPassword) {
  console.warn("SUPERVISOR_PASSWORD is not set, so web UI sign-in is disabled.");
}

const app = await buildApp(config);
await app.listen({ port: config.port, host: config.host });
console.log(`Agent Board listening on http://${config.host}:${config.port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
