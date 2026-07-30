import {
  AnalyticsEngine,
  AnalyticsRegistry,
  type ModuleExecutionContext,
} from "@semantic/analytics-core";
import { createAttendanceModule } from "@semantic/attendance";
import type { Database } from "@semantic/database";
import { createEmployeesModule } from "@semantic/employees";
import { createPerformanceModule } from "@semantic/performance";

export function createAnalyticsEngine(database: Database): AnalyticsEngine {
  const registry = new AnalyticsRegistry()
    .register(createEmployeesModule(database))
    .register(createPerformanceModule(database))
    .register(createAttendanceModule(database));

  return new AnalyticsEngine(registry);
}

export function executionContext(companyId: string): ModuleExecutionContext {
  return { companyId };
}
