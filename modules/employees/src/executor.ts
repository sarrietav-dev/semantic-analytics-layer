import type {
  DimensionMember,
  DimensionMembersRequest,
  ModuleExecutionContext,
  ModuleQuery,
  ModuleResult,
  ModuleResultRow,
  SemanticFilter,
} from "@semantic/analytics-core";
import { type Database, SqlParameters, toNumber } from "@semantic/database";

const intervals = {
  month: "1 month",
  quarter: "3 months",
  year: "1 year",
} as const;

export function createEmployeeExecutor(database: Database) {
  return async function executeEmployees(
    query: ModuleQuery,
    context: ModuleExecutionContext,
  ): Promise<ModuleResult> {
    assertSupportedQuery(query);
    return query.time
      ? executeTimeQuery(database, query, context)
      : executeCurrentQuery(database, query, context);
  };
}

export function createDepartmentResolver(database: Database) {
  return async function resolveDepartmentMembers(
    request: DimensionMembersRequest,
    context: ModuleExecutionContext,
  ): Promise<DimensionMember[]> {
    if (request.dimension !== "employees.department") {
      throw new Error(`Unsupported employee dimension ${request.dimension}`);
    }

    const parameters = new SqlParameters();
    const where = [
      `d.company_id = ${parameters.add(context.companyId)}::bigint`,
    ];
    appendDepartmentFilters(where, request.filters, parameters);
    const rows = await database.unsafe<Array<{ key: string; value: string }>>(
      `
        SELECT d.id::text AS key, d.name AS value
        FROM departments d
        WHERE ${where.join(" AND ")}
        ORDER BY d.name, d.id
      `,
      parameters.values,
    );

    return rows.map((row) => ({
      dimension: "employees.department",
      key: String(row.key),
      value: String(row.value),
    }));
  };
}

async function executeTimeQuery(
  database: Database,
  query: ModuleQuery,
  context: ModuleExecutionContext,
): Promise<ModuleResult> {
  if (!query.time) throw new Error("Time selection is required");

  const parameters = new SqlParameters();
  const company = parameters.add(context.companyId);
  const from = parameters.add(query.time.from);
  const to = parameters.add(query.time.to);
  const interval = intervals[query.time.granularity];
  const select = ["to_char(p.period, 'YYYY-MM-DD') AS time"];
  const groups = ["p.period"];
  const where: string[] = [];

  if (query.dimensions.includes("employees.department")) {
    select.push("d.id::text AS department_key");
    select.push("d.name AS department");
    groups.push("d.id");
    groups.push("d.name");
  }
  select.push("COUNT(e.id)::integer AS active_count");
  appendDepartmentFilters(where, query.filters, parameters);

  const statement = `
    WITH periods AS (
      SELECT generate_series(
        date_trunc('${query.time.granularity}', ${from}::date),
        date_trunc('${query.time.granularity}', ${to}::date),
        INTERVAL '${interval}'
      )::date AS period
    )
    SELECT ${select.join(", ")}
    FROM periods p
    INNER JOIN employees e
      ON e.company_id = ${company}::bigint
      AND e.active = TRUE
      AND e.hire_date < LEAST(
        p.period + INTERVAL '${interval}',
        ${to}::date + INTERVAL '1 day'
      )
    ${needsDepartment(query) ? "INNER JOIN departments d ON d.id = e.department_id AND d.company_id = e.company_id" : ""}
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY ${groups.join(", ")}
    ORDER BY ${groups.join(", ")}
  `;

  const rows = await database.unsafe<Record<string, unknown>[]>(
    statement,
    parameters.values,
  );
  return { rows: rows.map((row) => mapRow(row, query)) };
}

async function executeCurrentQuery(
  database: Database,
  query: ModuleQuery,
  context: ModuleExecutionContext,
): Promise<ModuleResult> {
  const parameters = new SqlParameters();
  const select: string[] = [];
  const groups: string[] = [];
  const where = [
    `e.company_id = ${parameters.add(context.companyId)}::bigint`,
    "e.active = TRUE",
  ];

  if (query.dimensions.includes("employees.department")) {
    select.push("d.id::text AS department_key");
    select.push("d.name AS department");
    groups.push("d.id");
    groups.push("d.name");
  }
  select.push("COUNT(e.id)::integer AS active_count");
  appendDepartmentFilters(where, query.filters, parameters);

  const statement = `
    SELECT ${select.join(", ")}
    FROM employees e
    ${needsDepartment(query) ? "INNER JOIN departments d ON d.id = e.department_id AND d.company_id = e.company_id" : ""}
    WHERE ${where.join(" AND ")}
    ${groups.length > 0 ? `GROUP BY ${groups.join(", ")}` : ""}
    ${groups.length > 0 ? `ORDER BY ${groups.join(", ")}` : ""}
  `;
  const rows = await database.unsafe<Record<string, unknown>[]>(
    statement,
    parameters.values,
  );
  return { rows: rows.map((row) => mapRow(row, query)) };
}

function mapRow(
  row: Record<string, unknown>,
  query: ModuleQuery,
): ModuleResultRow {
  const result: ModuleResultRow = {
    dimensions: {},
    dimensionKeys: {},
    metrics: { "employees.activeCount": toNumber(row.active_count) },
  };
  if (query.time) result.time = String(row.time);
  if (query.dimensions.includes("employees.department")) {
    result.dimensions["employees.department"] = String(row.department);
    result.dimensionKeys["employees.department"] = String(row.department_key);
  }
  return result;
}

function needsDepartment(query: ModuleQuery): boolean {
  return (
    query.dimensions.includes("employees.department") ||
    query.filters.some((filter) => filter.dimension === "employees.department")
  );
}

function appendDepartmentFilters(
  where: string[],
  filters: SemanticFilter[],
  parameters: SqlParameters,
): void {
  for (const filter of filters) {
    if (filter.dimension !== "employees.department") continue;
    if (filter.operator === "eq") {
      where.push(`d.name = ${parameters.add(filter.value)}`);
    } else {
      const placeholders = filter.value.map((value) => parameters.add(value));
      where.push(`d.name IN (${placeholders.join(", ")})`);
    }
  }
}

function assertSupportedQuery(query: ModuleQuery): void {
  if (
    query.metrics.length !== 1 ||
    query.metrics[0] !== "employees.activeCount" ||
    query.dimensions.some(
      (dimension) => dimension !== "employees.department",
    ) ||
    query.filters.some((filter) => filter.dimension !== "employees.department")
  ) {
    throw new Error("Employees executor received an unsupported query");
  }
}
