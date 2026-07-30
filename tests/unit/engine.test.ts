import { describe, expect, test } from "bun:test";
import {
  AnalyticsEngine,
  AnalyticsRegistry,
  type AnalyticsModule,
  type ModuleExecutionContext,
} from "../../packages/analytics-core/src";

describe("analytics orchestration", () => {
  test("delegates execution, fills gaps, and merges canonical module rows", async () => {
    const receivedContexts: ModuleExecutionContext[] = [];
    const engine = createEngine(receivedContexts);

    const result = await engine.query(
      {
        metrics: ["performance.avgScore", "attendance.rate"],
        dimensions: ["employees.department"],
        time: {
          granularity: "month",
          from: "2025-01-01",
          to: "2025-02-28",
        },
      },
      { companyId: "77" },
    );

    expect(receivedContexts).toEqual([
      { companyId: "77" },
      { companyId: "77" },
    ]);
    expect(result.rows).toHaveLength(4);
    expect(result.rows).toContainEqual({
      time: "2025-01-01",
      "employees.department": "Engineering",
      "performance.avgScore": 90,
      "attendance.rate": null,
    });
    expect(result.rows).toContainEqual({
      time: "2025-02-01",
      "employees.department": "Sales",
      "performance.avgScore": null,
      "attendance.rate": 50,
    });
  });

  test("public definitions contain no schema or SQL metadata", () => {
    const definitions = createEngine([]).definitions();
    const serialized = JSON.stringify(definitions);

    expect(serialized).toContain("performance.avgScore");
    expect(serialized).not.toContain("performance_reviews");
    expect(serialized).not.toContain("company_id");
    expect(serialized).not.toContain("SELECT");
  });

  test("rejects non-finite metrics from a module", async () => {
    const invalidModule: AnalyticsModule = {
      id: "invalid",
      definitions: [
        {
          kind: "metric",
          name: "invalid.value",
          label: "Invalid",
          description: "Invalid",
          type: "number",
          supportedDimensions: [],
          supportedGranularities: ["month"],
          emptyValue: null,
        },
      ],
      async execute() {
        return {
          rows: [
            {
              dimensions: {},
              dimensionKeys: {},
              metrics: { "invalid.value": Number.NaN },
            },
          ],
        };
      },
    };
    const engine = new AnalyticsEngine(
      new AnalyticsRegistry().register(invalidModule),
    );

    expect(
      engine.query(
        { metrics: ["invalid.value"], dimensions: [] },
        { companyId: "1" },
      ),
    ).rejects.toThrow("must be a number or null");
  });

  test("rejects module rows outside the canonical time spine", async () => {
    const employees: AnalyticsModule = {
      id: "employees",
      definitions: [
        {
          kind: "dimension",
          name: "employees.department",
          label: "Department",
          description: "Department",
          type: "string",
          filterOperators: ["eq"],
        },
      ],
      async execute() {
        return { rows: [] };
      },
      async resolveDimensionMembers() {
        return [
          {
            dimension: "employees.department",
            key: "10",
            value: "Engineering",
          },
        ];
      },
    };
    const invalidModule: AnalyticsModule = {
      id: "invalid",
      definitions: [metric("invalid.value", null)],
      async execute() {
        return {
          rows: [
            {
              time: "2025-02-01",
              dimensions: { "employees.department": "Unknown" },
              dimensionKeys: { "employees.department": "999" },
              metrics: { "invalid.value": 1 },
            },
          ],
        };
      },
    };
    const engine = new AnalyticsEngine(
      new AnalyticsRegistry().register(employees).register(invalidModule),
    );

    expect(
      engine.query(
        {
          metrics: ["invalid.value"],
          dimensions: ["employees.department"],
          time: {
            granularity: "month",
            from: "2025-01-01",
            to: "2025-01-31",
          },
        },
        { companyId: "1" },
      ),
    ).rejects.toThrow("outside the requested canonical spine");
  });
});

function createEngine(
  receivedContexts: ModuleExecutionContext[],
): AnalyticsEngine {
  const employees: AnalyticsModule = {
    id: "employees",
    definitions: [
      {
        kind: "dimension",
        name: "employees.department",
        label: "Department",
        description: "Department",
        type: "string",
        filterOperators: ["eq", "in"],
      },
    ],
    async execute() {
      return { rows: [] };
    },
    async resolveDimensionMembers() {
      return [
        {
          dimension: "employees.department",
          key: "10",
          value: "Engineering",
        },
        { dimension: "employees.department", key: "11", value: "Sales" },
      ];
    },
  };

  const performance: AnalyticsModule = {
    id: "performance",
    definitions: [metric("performance.avgScore", null)],
    async execute(_query, context) {
      receivedContexts.push(context);
      return {
        rows: [
          {
            time: "2025-01-01",
            dimensions: { "employees.department": "Previous Engineering Name" },
            dimensionKeys: { "employees.department": "10" },
            metrics: { "performance.avgScore": 90 },
          },
        ],
      };
    },
  };

  const attendance: AnalyticsModule = {
    id: "attendance",
    definitions: [metric("attendance.rate", null)],
    async execute(_query, context) {
      receivedContexts.push(context);
      return {
        rows: [
          {
            time: "2025-02-01",
            dimensions: { "employees.department": "Sales" },
            dimensionKeys: { "employees.department": "11" },
            metrics: { "attendance.rate": 50 },
          },
        ],
      };
    },
  };

  return new AnalyticsEngine(
    new AnalyticsRegistry()
      .register(employees)
      .register(performance)
      .register(attendance),
  );
}

function metric(name: string, emptyValue: number | null) {
  return {
    kind: "metric" as const,
    name,
    label: name,
    description: name,
    type: "number" as const,
    supportedDimensions: ["employees.department"],
    supportedGranularities: ["month" as const],
    emptyValue,
    sql: "SELECT private_schema",
  };
}
