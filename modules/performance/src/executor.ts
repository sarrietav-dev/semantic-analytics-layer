import type {
  ModuleExecutionContext,
  ModuleQuery,
  ModuleResult,
  ModuleResultRow,
  SemanticFilter,
} from "@semantic/analytics-core";
import {
  type Database,
  SqlParameters,
  toNullableNumber,
  toNumber,
} from "@semantic/database";

const metricExpressions: Record<string, { expression: string; alias: string }> =
  {
    "performance.avgScore": {
      expression: "AVG(r.score)::double precision",
      alias: "avg_score",
    },
    "performance.completedReviews": {
      expression: "COUNT(*)::integer",
      alias: "completed_reviews",
    },
    "performance.completedEmployees": {
      expression: "COUNT(DISTINCT r.employee_id)::integer",
      alias: "completed_employees",
    },
  };

export function createPerformanceExecutor(database: Database) {
  return async function executePerformance(
    query: ModuleQuery,
    context: ModuleExecutionContext,
  ): Promise<ModuleResult> {
    assertSupportedQuery(query);

    const parameters = new SqlParameters();
    const select: string[] = [];
    const groups: string[] = [];
    const where = [
      `r.company_id = ${parameters.add(context.companyId)}::bigint`,
      "r.status = 'completed'",
    ];
    const needsDepartment =
      query.dimensions.includes("employees.department") ||
      query.filters.some(
        (filter) => filter.dimension === "employees.department",
      );

    if (query.time) {
      const timeExpression = `date_trunc('${query.time.granularity}', r.period)`;
      select.push(`to_char(${timeExpression}, 'YYYY-MM-DD') AS time`);
      groups.push(timeExpression);
      where.push(`r.period >= ${parameters.add(query.time.from)}::date`);
      where.push(
        `r.period < (${parameters.add(query.time.to)}::date + INTERVAL '1 day')`,
      );
    }

    if (query.dimensions.includes("employees.department")) {
      select.push("d.id::text AS department_key");
      select.push("d.name AS department");
      groups.push("d.id");
      groups.push("d.name");
    }

    for (const metricName of query.metrics) {
      const metric = metricExpressions[metricName];
      if (!metric)
        throw new Error(`Unsupported performance metric ${metricName}`);
      select.push(`${metric.expression} AS ${metric.alias}`);
    }

    appendDepartmentFilters(where, query.filters, parameters);

    const joins = [
      "INNER JOIN employees e ON e.id = r.employee_id AND e.company_id = r.company_id",
    ];
    if (needsDepartment) {
      joins.push(
        "INNER JOIN departments d ON d.id = e.department_id AND d.company_id = r.company_id",
      );
    }
    const groupBy = groups.length > 0 ? `GROUP BY ${groups.join(", ")}` : "";
    const orderBy = groups.length > 0 ? `ORDER BY ${groups.join(", ")}` : "";
    const statement = `
      SELECT ${select.join(", ")}
      FROM performance_reviews r
      ${joins.join("\n")}
      WHERE ${where.join(" AND ")}
      ${groupBy}
      ${orderBy}
    `;

    const rows = await database.unsafe<Record<string, unknown>[]>(
      statement,
      parameters.values,
    );

    return { rows: rows.map((row) => mapRow(row, query)) };
  };
}

function mapRow(
  row: Record<string, unknown>,
  query: ModuleQuery,
): ModuleResultRow {
  const result: ModuleResultRow = {
    dimensions: {},
    dimensionKeys: {},
    metrics: {},
  };
  if (query.time) result.time = String(row.time);
  if (query.dimensions.includes("employees.department")) {
    result.dimensions["employees.department"] = String(row.department);
    result.dimensionKeys["employees.department"] = String(row.department_key);
  }

  for (const metricName of query.metrics) {
    const alias = metricExpressions[metricName]?.alias;
    if (!alias) continue;
    result.metrics[metricName] =
      metricName === "performance.avgScore"
        ? toNullableNumber(row[alias])
        : toNumber(row[alias]);
  }
  return result;
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
  if (query.metrics.some((metric) => !metricExpressions[metric])) {
    throw new Error("Performance executor received an unsupported metric");
  }
  if (
    query.dimensions.some((dimension) => dimension !== "employees.department")
  ) {
    throw new Error("Performance executor received an unsupported dimension");
  }
  if (
    query.filters.some((filter) => filter.dimension !== "employees.department")
  ) {
    throw new Error("Performance executor received an unsupported filter");
  }
}
