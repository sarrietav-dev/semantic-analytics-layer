import type { AnalyticsModule } from "@semantic/analytics-core";
import type { Database } from "@semantic/database";
import { performanceDefinitions } from "./definitions";
import { createPerformanceExecutor } from "./executor";

export { performanceDefinitions } from "./definitions";

export function createPerformanceModule(database: Database): AnalyticsModule {
  return {
    id: "performance",
    definitions: performanceDefinitions,
    execute: createPerformanceExecutor(database),
  };
}
