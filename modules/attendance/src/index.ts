import type { AnalyticsModule } from "@semantic/analytics-core";
import type { Database } from "@semantic/database";
import { attendanceDefinitions } from "./definitions";
import { createAttendanceExecutor } from "./executor";

export { attendanceDefinitions } from "./definitions";

export function createAttendanceModule(database: Database): AnalyticsModule {
  return {
    id: "attendance",
    definitions: attendanceDefinitions,
    execute: createAttendanceExecutor(database),
  };
}
