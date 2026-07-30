import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAnalyticsEngine } from "../../apps/api/src/application";
import { createDatabase, type Database } from "../../packages/database/src";
import type {
  AnalyticsEngine,
  QueryResponse,
  ResponseRow,
} from "../../packages/analytics-core/src";

let database: Database;
let analytics: AnalyticsEngine;

beforeAll(async () => {
  database = createDatabase();
  await database`SELECT 1`;
  analytics = createAnalyticsEngine(database);
});

afterAll(async () => {
  await database.close();
});

describe("delegated PostgreSQL analytics", () => {
  test("returns average performance score by department over a year", async () => {
    const result = await query({
      metrics: ["performance.avgScore"],
      dimensions: ["employees.department"],
      time: { granularity: "year", from: "2025-01-01", to: "2025-12-31" },
    });

    expect(
      row(result, "2025-01-01", "Engineering")["performance.avgScore"],
    ).toBe(80);
    expect(row(result, "2025-01-01", "Sales")["performance.avgScore"]).toBe(98);
    expect(
      row(result, "2025-01-01", "Empty Department")["performance.avgScore"],
    ).toBeNull();
  });

  test("counts distinct employees completing reviews each quarter", async () => {
    const result = await query({
      metrics: ["performance.completedEmployees"],
      dimensions: ["employees.department"],
      time: {
        granularity: "quarter",
        from: "2025-01-01",
        to: "2025-12-31",
      },
    });

    expect(
      row(result, "2025-01-01", "Engineering")[
        "performance.completedEmployees"
      ],
    ).toBe(1);
    expect(
      row(result, "2025-07-01", "Engineering")[
        "performance.completedEmployees"
      ],
    ).toBe(0);
    expect(
      row(result, "2025-10-01", "Sales")["performance.completedEmployees"],
    ).toBe(1);
  });

  test("calculates attendance rate by department for three months", async () => {
    const result = await query({
      metrics: ["attendance.rate"],
      dimensions: ["employees.department"],
      time: { granularity: "month", from: "2025-04-01", to: "2025-06-30" },
    });

    expect(
      row(result, "2025-04-01", "Engineering")["attendance.rate"],
    ).toBeCloseTo(66.6667, 4);
    expect(row(result, "2025-05-01", "Sales")["attendance.rate"]).toBe(50);
    expect(row(result, "2025-06-01", "Engineering")["attendance.rate"]).toBe(
      100,
    );
    expect(row(result, "2025-04-01", "Sales")["attendance.rate"]).toBeNull();
  });

  test("returns the supported active employee snapshot month by month", async () => {
    const result = await query({
      metrics: ["employees.activeCount"],
      dimensions: ["employees.department"],
      time: { granularity: "month", from: "2025-01-01", to: "2025-03-31" },
    });

    expect(
      row(result, "2025-01-01", "Engineering")["employees.activeCount"],
    ).toBe(2);
    expect(row(result, "2025-01-01", "Sales")["employees.activeCount"]).toBe(0);
    expect(row(result, "2025-02-01", "Sales")["employees.activeCount"]).toBe(1);
  });

  test("implements the required 2025 department and quarter query", async () => {
    const result = await query({
      metrics: ["performance.avgScore", "performance.completedReviews"],
      dimensions: ["employees.department"],
      time: {
        granularity: "quarter",
        from: "2025-01-01",
        to: "2025-12-31",
      },
    });

    expect(result.rows).toHaveLength(12);
    expect(row(result, "2025-01-01", "Engineering")).toMatchObject({
      "performance.avgScore": 85,
      "performance.completedReviews": 2,
    });
    expect(row(result, "2025-07-01", "Engineering")).toMatchObject({
      "performance.avgScore": null,
      "performance.completedReviews": 0,
    });
  });

  test("isolates every delegated query to the trusted company", async () => {
    const result = await analytics.query(
      {
        metrics: [
          "performance.avgScore",
          "attendance.rate",
          "employees.activeCount",
        ],
        dimensions: ["employees.department"],
        time: {
          granularity: "year",
          from: "2025-01-01",
          to: "2025-12-31",
        },
      },
      { companyId: "2" },
    );

    expect(result.rows).toEqual([
      {
        time: "2025-01-01",
        "employees.department": "Engineering",
        "performance.avgScore": 1,
        "attendance.rate": 0,
        "employees.activeCount": 1,
      },
    ]);
  });

  test("executes different sources separately and merges public keys", async () => {
    const result = await query({
      metrics: ["performance.avgScore", "attendance.rate"],
      dimensions: ["employees.department"],
      time: { granularity: "month", from: "2025-04-01", to: "2025-06-30" },
    });

    expect(row(result, "2025-04-01", "Engineering")).toMatchObject({
      "performance.avgScore": null,
      "attendance.rate": expect.closeTo(66.6667, 4),
    });
    expect(row(result, "2025-05-01", "Engineering")).toMatchObject({
      "performance.avgScore": 70,
      "attendance.rate": null,
    });
    expect(row(result, "2025-05-01", "Sales")).toMatchObject({
      "performance.avgScore": null,
      "attendance.rate": 50,
    });
  });

  test("applies department filters to facts and the generated spine", async () => {
    const result = await query({
      metrics: ["performance.completedReviews"],
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
          value: ["Sales"],
        },
      ],
    });

    expect(result.rows).toHaveLength(4);
    expect(
      result.rows.every((item) => item["employees.department"] === "Sales"),
    ).toBe(true);
  });

  test("supports totals without time or dimensions and rejects inconsistent fact tenants", async () => {
    const result = await query({
      metrics: [
        "performance.avgScore",
        "attendance.rate",
        "employees.activeCount",
      ],
      dimensions: [],
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.["performance.avgScore"]).toBeCloseTo(79.6, 4);
    expect(result.rows[0]?.["attendance.rate"]).toBeCloseTo(66.6667, 4);
    expect(result.rows[0]?.["employees.activeCount"]).toBe(4);

    const otherTenant = await analytics.query(
      {
        metrics: [
          "performance.avgScore",
          "attendance.rate",
          "employees.activeCount",
        ],
        dimensions: [],
      },
      { companyId: "2" },
    );
    expect(otherTenant.rows).toEqual([
      {
        "performance.avgScore": 1,
        "attendance.rate": 0,
        "employees.activeCount": 1,
      },
    ]);
  });

  test("treats the public to date as inclusive inside a partial bucket", async () => {
    const result = await query({
      metrics: ["performance.completedReviews"],
      dimensions: ["employees.department"],
      time: { granularity: "month", from: "2025-05-30", to: "2025-05-30" },
    });

    expect(
      row(result, "2025-05-01", "Engineering")["performance.completedReviews"],
    ).toBe(1);
  });
});

async function query(input: unknown): Promise<QueryResponse> {
  return analytics.query(input, { companyId: "1" });
}

function row(
  result: QueryResponse,
  time: string,
  department: string,
): ResponseRow {
  const found = result.rows.find(
    (candidate) =>
      candidate.time === time &&
      candidate["employees.department"] === department,
  );
  if (!found) throw new Error(`Missing row for ${time} / ${department}`);
  return found;
}
