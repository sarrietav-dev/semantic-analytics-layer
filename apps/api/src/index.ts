import { createDatabase } from "@semantic/database";
import { createAnalyticsEngine } from "./application";
import { createServer } from "./server";

const database = createDatabase();
const analytics = createAnalyticsEngine(database);
const configuredPort = Number(process.env.PORT ?? "3000");

if (
  !Number.isInteger(configuredPort) ||
  configuredPort < 1 ||
  configuredPort > 65_535
) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const server = createServer({
  analytics,
  port: configuredPort,
  healthcheck: async () => {
    await database`SELECT 1`;
  },
});

console.log(`Semantic analytics API listening on ${server.url}`);

async function shutdown(): Promise<void> {
  await server.stop();
  await database.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
