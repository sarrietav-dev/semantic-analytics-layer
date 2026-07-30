import type { AnalyticsModule } from "@semantic/analytics-core";
import type { Database } from "@semantic/database";
import { employeeDefinitions } from "./definitions";
import { createDepartmentResolver, createEmployeeExecutor } from "./executor";

export { employeeDefinitions } from "./definitions";

export function createEmployeesModule(database: Database): AnalyticsModule {
  return {
    id: "employees",
    definitions: employeeDefinitions,
    execute: createEmployeeExecutor(database),
    resolveDimensionMembers: createDepartmentResolver(database),
  };
}
