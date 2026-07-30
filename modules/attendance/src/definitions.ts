import type { MetricDefinition } from "@semantic/analytics-core";

export const attendanceDefinitions: MetricDefinition[] = [
  {
    kind: "metric",
    name: "attendance.rate",
    label: "Tasa de asistencia",
    description:
      "Porcentaje de registros de asistencia marcados como presentes.",
    type: "number",
    supportedDimensions: ["employees.department"],
    supportedGranularities: ["month", "quarter", "year"],
    emptyValue: null,
  },
];
