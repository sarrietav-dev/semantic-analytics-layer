import { describe, expect, test } from "bun:test";
import {
  AnalyticsRegistry,
  InvalidQueryError,
  validateQuery,
  type AnalyticsModule,
} from "../../packages/analytics-core/src";

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
    return [];
  },
};

const performance: AnalyticsModule = {
  id: "performance",
  definitions: [
    {
      kind: "metric",
      name: "performance.avgScore",
      label: "Average score",
      description: "Average score",
      type: "number",
      supportedDimensions: ["employees.department"],
      supportedGranularities: ["quarter", "year"],
      emptyValue: null,
    },
  ],
  async execute() {
    return { rows: [] };
  },
};

function registry(): AnalyticsRegistry {
  return new AnalyticsRegistry().register(employees).register(performance);
}

describe("query validation", () => {
  test("accepts the public declarative contract", () => {
    expect(
      validateQuery(
        {
          metrics: ["performance.avgScore"],
          dimensions: ["employees.department"],
          time: {
            granularity: "quarter",
            from: "2025-01-01",
            to: "2025-12-31",
          },
          filters: [
            {
              dimension: "employees.department",
              operator: "in",
              value: ["Engineering"],
            },
          ],
        },
        registry(),
      ),
    ).toEqual({
      metrics: ["performance.avgScore"],
      dimensions: ["employees.department"],
      time: {
        granularity: "quarter",
        from: "2025-01-01",
        to: "2025-12-31",
      },
      filters: [
        {
          dimension: "employees.department",
          operator: "in",
          value: ["Engineering"],
        },
      ],
    });
  });

  test("rejects tenant identity anywhere in the consumer body", () => {
    expectIssues(
      {
        metrics: ["performance.avgScore"],
        dimensions: [],
        filters: [{ companyId: 2 }],
      },
      "FORBIDDEN_TENANT_FIELD",
    );
  });

  test("reports unknown definitions and invalid dates as structured issues", () => {
    const error = captureError({
      metrics: ["performance.missing"],
      dimensions: ["employees.missing"],
      time: {
        granularity: "month",
        from: "2025-02-30",
        to: "2025-01-01",
      },
    });

    expect(error.issues.map((issue) => issue.code)).toContain("UNKNOWN_METRIC");
    expect(error.issues.map((issue) => issue.code)).toContain(
      "UNKNOWN_DIMENSION",
    );
    expect(error.issues.map((issue) => issue.code)).toContain("INVALID_DATE");
  });

  test("requires metrics while allowing an empty dimensions array", () => {
    expect(
      validateQuery(
        {
          metrics: ["performance.avgScore"],
          dimensions: [],
        },
        registry(),
      ),
    ).toEqual({
      metrics: ["performance.avgScore"],
      dimensions: [],
      filters: [],
    });

    expectIssues({ metrics: [], dimensions: [] }, "EMPTY_ARRAY");
  });

  test("rejects unsupported granularities and duplicate metrics", () => {
    const error = captureError({
      metrics: ["performance.avgScore", "performance.avgScore"],
      dimensions: [],
      time: {
        granularity: "month",
        from: "2025-01-01",
        to: "2025-02-01",
      },
    });

    expect(error.issues.map((issue) => issue.code)).toContain(
      "DUPLICATE_VALUE",
    );
    expect(error.issues.map((issue) => issue.code)).toContain(
      "UNSUPPORTED_GRANULARITY",
    );
  });

  test("bounds time buckets and in-filter values", () => {
    expectIssues(
      {
        metrics: ["performance.avgScore"],
        dimensions: [],
        time: {
          granularity: "year",
          from: "1900-01-01",
          to: "2020-12-31",
        },
      },
      "RANGE_TOO_LARGE",
    );

    expectIssues(
      {
        metrics: ["performance.avgScore"],
        dimensions: [],
        filters: [
          {
            dimension: "employees.department",
            operator: "in",
            value: Array.from({ length: 101 }, (_, index) => `D${index}`),
          },
        ],
      },
      "FILTER_TOO_LARGE",
    );

    expectIssues(
      {
        metrics: ["performance.avgScore"],
        dimensions: [],
        filters: Array.from({ length: 21 }, () => ({
          dimension: "employees.department",
          operator: "eq",
          value: "Engineering",
        })),
      },
      "TOO_MANY_FILTERS",
    );
  });
});

function captureError(input: unknown): InvalidQueryError {
  try {
    validateQuery(input, registry());
  } catch (error) {
    if (error instanceof InvalidQueryError) return error;
    throw error;
  }
  throw new Error("Expected validation to fail");
}

function expectIssues(input: unknown, code: string): void {
  expect(captureError(input).issues.map((issue) => issue.code)).toContain(code);
}
