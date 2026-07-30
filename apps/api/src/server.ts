import type { AnalyticsEngine } from "@semantic/analytics-core";
import { createApiHandler } from "./handler";

interface ServerOptions {
  analytics: AnalyticsEngine;
  healthcheck: () => Promise<void>;
  port?: number;
}

export function createServer(options: ServerOptions): Bun.Server<undefined> {
  return Bun.serve({
    port: options.port ?? 3000,
    fetch: createApiHandler(options),
  });
}
