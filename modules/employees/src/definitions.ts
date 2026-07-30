import type {
  DimensionDefinition,
  MetricDefinition,
} from "@semantic/analytics-core";

export const employeeDefinitions: Array<
  MetricDefinition | DimensionDefinition
> = [
  {
    kind: "metric",
    name: "employees.activeCount",
    label: "Empleados activos",
    description:
      "Empleados actualmente activos contratados antes del cierre del período.",
    type: "number",
    supportedDimensions: ["employees.department"],
    supportedGranularities: ["month", "quarter", "year"],
    emptyValue: 0,
  },
  {
    kind: "dimension",
    name: "employees.department",
    label: "Departamento",
    description: "Nombre público del departamento del empleado.",
    type: "string",
    filterOperators: ["eq", "in"],
  },
];
