import type { MetricDefinition } from "@semantic/analytics-core";

const shared = {
  kind: "metric" as const,
  type: "number" as const,
  supportedDimensions: ["employees.department"],
  supportedGranularities: ["month", "quarter", "year"] as const,
};

export const performanceDefinitions: MetricDefinition[] = [
  {
    ...shared,
    supportedGranularities: [...shared.supportedGranularities],
    name: "performance.avgScore",
    label: "Score promedio de desempeño",
    description: "Score promedio de evaluaciones completadas.",
    emptyValue: null,
  },
  {
    ...shared,
    supportedGranularities: [...shared.supportedGranularities],
    name: "performance.completedReviews",
    label: "Evaluaciones completadas",
    description: "Cantidad de registros de evaluaciones completadas.",
    emptyValue: 0,
  },
  {
    ...shared,
    supportedGranularities: [...shared.supportedGranularities],
    name: "performance.completedEmployees",
    label: "Empleados con evaluación completada",
    description: "Empleados distintos con al menos una evaluación completada.",
    emptyValue: 0,
  },
];
