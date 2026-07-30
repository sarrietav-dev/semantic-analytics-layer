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
} from "@semantic/database";

export function createAttendanceExecutor(database: Database) {
  return async function executeAttendance(
    query: ModuleQuery,
    context: ModuleExecutionContext,
  ): Promise<ModuleResult> {
    assertSupportedQuery(query);

    const parameters = new SqlParameters();
    const select: string[] = [];
    const groups: string[] = [];
    const where = [
      `a.company_id = ${parameters.add(context.companyId)}::bigint`,
    ];
    const needsDepartment =
      query.dimensions.includes("employees.department") ||
      query.filters.some(
        (filter) => filter.dimension === "employees.department",
      );

    if (query.time) {
      const timeExpression = `date_trunc('${query.time.granularity}', a.date)`;
      select.push(`to_char(${timeExpression}, 'YYYY-MM-DD') AS time`);
      groups.push(timeExpression);
      where.push(`a.date >= ${parameters.add(query.time.from)}::date`);
      where.push(
        `a.date < (${parameters.add(query.time.to)}::date + INTERVAL '1 day')`,
      );
    }

    if (query.dimensions.includes("employees.department")) {
      select.push("d.id::text AS department_key");
      select.push("d.name AS department");
      groups.push("d.id");
      groups.push("d.name");
    }

    select.push(
      "(AVG(CASE WHEN a.present THEN 1.0 ELSE 0.0 END) * 100)::double precision AS attendance_rate",
    );
    appendDepartmentFilters(where, query.filters, parameters);

    const joins = [
      "INNER JOIN employees e ON e.id = a.employee_id AND e.company_id = a.company_id",
    ];
    if (needsDepartment) {
      joins.push(
        "INNER JOIN departments d ON d.id = e.department_id AND d.company_id = a.company_id",
      );
    }
    const groupBy = groups.length > 0 ? `GROUP BY ${groups.join(", ")}` : "";
    const orderBy = groups.length > 0 ? `ORDER BY ${groups.join(", ")}` : "";
    const statement = `
      SELECT ${select.join(", ")}
      FROM attendance a
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
    metrics: { "attendance.rate": toNullableNumber(row.attendance_rate) },
  };
  if (query.time) result.time = String(row.time);
  if (query.dimensions.includes("employees.department")) {
    result.dimensions["employees.department"] = String(row.department);
    result.dimensionKeys["employees.department"] = String(row.department_key);
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
  if (
    query.metrics.length !== 1 ||
    query.metrics[0] !== "attendance.rate" ||
    query.dimensions.some(
      (dimension) => dimension !== "employees.department",
    ) ||
    query.filters.some((filter) => filter.dimension !== "employees.department")
  ) {
    throw new Error("Attendance executor received an unsupported query");
  }
}
