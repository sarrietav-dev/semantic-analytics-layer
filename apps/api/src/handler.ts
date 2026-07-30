import { AnalyticsError, type AnalyticsEngine } from "@semantic/analytics-core";
import { executionContext } from "./application";

interface ApiDependencies {
  analytics: AnalyticsEngine;
  healthcheck: () => Promise<void>;
  onUnexpectedError?: (error: unknown) => void;
}

export function createApiHandler({
  analytics,
  healthcheck,
  onUnexpectedError = console.error,
}: ApiDependencies): (request: Request) => Promise<Response> {
  return async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      try {
        await healthcheck();
        return json({ status: "ok" });
      } catch (error) {
        onUnexpectedError(error);
        return json(
          { error: { code: "UNHEALTHY", message: "Database is unavailable" } },
          503,
        );
      }
    }

    if (pathname === "/api/v1/definitions") {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      return json(analytics.definitions());
    }

    if (pathname === "/api/v1/query") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);

      const tenant = readTenant(request);
      if (tenant instanceof Response) return tenant;

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json(
          {
            error: {
              code: "MALFORMED_JSON",
              message: "The request body must contain valid JSON",
            },
          },
          400,
        );
      }

      try {
        return json(await analytics.query(body, executionContext(tenant)));
      } catch (error) {
        if (error instanceof AnalyticsError) {
          const details: {
            code: string;
            message: string;
            issues?: typeof error.issues;
          } = { code: error.code, message: error.message };
          if (error.issues.length > 0) details.issues = error.issues;
          return json({ error: details }, error.status);
        }

        onUnexpectedError(error);
        return json(
          {
            error: {
              code: "INTERNAL_ERROR",
              message: "The analytics query could not be executed",
            },
          },
          500,
        );
      }
    }

    return json(
      { error: { code: "NOT_FOUND", message: "Route not found" } },
      404,
    );
  };
}

function readTenant(request: Request): string | Response {
  const value = request.headers.get("x-company-id");
  if (!value) {
    return json(
      {
        error: {
          code: "UNAUTHENTICATED",
          message: "x-company-id is required",
        },
      },
      401,
    );
  }

  if (!/^[1-9]\d*$/.test(value)) {
    return invalidTenant();
  }

  try {
    if (BigInt(value) > 9_223_372_036_854_775_807n) return invalidTenant();
  } catch {
    return invalidTenant();
  }

  return value;
}

function invalidTenant(): Response {
  return json(
    {
      error: {
        code: "INVALID_TENANT",
        message: "x-company-id must be a positive PostgreSQL BIGINT",
      },
    },
    401,
  );
}

function methodNotAllowed(methods: string[]): Response {
  return json(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
      },
    },
    405,
    { Allow: methods.join(", ") },
  );
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, headers ? { status, headers } : { status });
}
