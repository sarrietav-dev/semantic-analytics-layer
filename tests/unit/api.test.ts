import { describe, expect, test } from "bun:test";
import {
  AnalyticsEngine,
  AnalyticsRegistry,
  type AnalyticsModule,
} from "../../packages/analytics-core/src";
import { createApiHandler } from "../../apps/api/src/handler";

describe("HTTP API", () => {
  test("requires the trusted tenant header", async () => {
    const response = await handler()(
      new Request("http://localhost/api/v1/query", {
        method: "POST",
        body: JSON.stringify({ metrics: ["test.count"], dimensions: [] }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "x-company-id is required",
      },
    });
  });

  test("does not accept companyId from the request body", async () => {
    const response = await handler()(
      new Request("http://localhost/api/v1/query", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-company-id": "1",
        },
        body: JSON.stringify({
          metrics: ["test.count"],
          dimensions: [],
          companyId: "2",
        }),
      }),
    );
    const body = (await response.json()) as {
      error: { issues: Array<{ code: string }> };
    };

    expect(response.status).toBe(400);
    expect(body.error.issues.map((issue) => issue.code)).toContain(
      "FORBIDDEN_TENANT_FIELD",
    );
  });

  test("returns public definitions and query results", async () => {
    const api = handler();
    const definitions = await api(
      new Request("http://localhost/api/v1/definitions"),
    );
    const query = await api(
      new Request("http://localhost/api/v1/query", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-company-id": "42",
        },
        body: JSON.stringify({ metrics: ["test.count"], dimensions: [] }),
      }),
    );

    expect(definitions.status).toBe(200);
    expect(JSON.stringify(await definitions.json())).not.toContain("SELECT");
    expect(await query.json()).toEqual({
      columns: [{ name: "test.count", role: "metric", type: "number" }],
      rows: [{ "test.count": 42 }],
    });
  });
});

function handler() {
  const module: AnalyticsModule = {
    id: "test",
    definitions: [
      {
        kind: "metric",
        name: "test.count",
        label: "Count",
        description: "Count",
        type: "number",
        supportedDimensions: [],
        supportedGranularities: ["month"],
        emptyValue: 0,
      },
    ],
    async execute(_query, context) {
      return {
        rows: [
          {
            dimensions: {},
            dimensionKeys: {},
            metrics: { "test.count": Number(context.companyId) },
          },
        ],
      };
    },
  };
  const analytics = new AnalyticsEngine(
    new AnalyticsRegistry().register(module),
  );
  return createApiHandler({
    analytics,
    healthcheck: async () => {},
    onUnexpectedError: () => {},
  });
}
