import { InvalidQueryError, type ValidationIssue } from "./errors";
import { AnalyticsRegistry } from "./registry";
import { bucketStarts, isIsoDate } from "./time";
import {
  granularities,
  type Granularity,
  type SemanticFilter,
  type SemanticQuery,
  type TimeSelection,
} from "./types";

const topLevelFields = new Set(["metrics", "dimensions", "time", "filters"]);
const timeFields = new Set(["granularity", "from", "to"]);
const filterFields = new Set(["dimension", "operator", "value"]);
const maxTimeBuckets = 120;
const maxFilterValues = 100;
const maxFilters = 20;
const maxTotalFilterValues = 500;

export function validateQuery(
  input: unknown,
  registry: AnalyticsRegistry,
): SemanticQuery {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    throw new InvalidQueryError([
      issue("$", "INVALID_TYPE", "The request body must be an object"),
    ]);
  }

  findCompanyId(input, "$", issues);
  rejectUnknownFields(input, topLevelFields, "$", issues);

  const metrics = readStringArray(input.metrics, "metrics", false, issues);
  const dimensions = readStringArray(
    input.dimensions,
    "dimensions",
    true,
    issues,
  );
  const time = readTime(input.time, issues);
  const filters = readFilters(input.filters, issues);

  rejectDuplicates(metrics, "metrics", issues);
  rejectDuplicates(dimensions, "dimensions", issues);
  rejectDuplicateFilters(filters, issues);

  for (const [index, metricName] of metrics.entries()) {
    if (!registry.getMetric(metricName)) {
      issues.push(
        issue(
          `metrics[${index}]`,
          "UNKNOWN_METRIC",
          `Unknown metric: ${metricName}`,
        ),
      );
    }
  }

  for (const [index, dimensionName] of dimensions.entries()) {
    if (!registry.getDimension(dimensionName)) {
      issues.push(
        issue(
          `dimensions[${index}]`,
          "UNKNOWN_DIMENSION",
          `Unknown dimension: ${dimensionName}`,
        ),
      );
    }
  }

  for (const [index, filter] of filters.entries()) {
    const registered = registry.getDimension(filter.dimension);
    if (!registered) {
      issues.push(
        issue(
          `filters[${index}].dimension`,
          "UNKNOWN_DIMENSION",
          `Unknown dimension: ${filter.dimension}`,
        ),
      );
      continue;
    }

    if (!registered.definition.filterOperators.includes(filter.operator)) {
      issues.push(
        issue(
          `filters[${index}].operator`,
          "UNSUPPORTED_OPERATOR",
          `${filter.operator} is not supported by ${filter.dimension}`,
        ),
      );
    }
  }

  const requiredDimensions = new Set([
    ...dimensions,
    ...filters.map((filter) => filter.dimension),
  ]);

  for (const [index, metricName] of metrics.entries()) {
    const registered = registry.getMetric(metricName);
    if (!registered) continue;

    for (const dimension of requiredDimensions) {
      if (!registered.definition.supportedDimensions.includes(dimension)) {
        issues.push(
          issue(
            `metrics[${index}]`,
            "INCOMPATIBLE_DIMENSION",
            `${metricName} does not support ${dimension}`,
          ),
        );
      }
    }

    if (
      time &&
      !registered.definition.supportedGranularities.includes(time.granularity)
    ) {
      issues.push(
        issue(
          `metrics[${index}]`,
          "UNSUPPORTED_GRANULARITY",
          `${metricName} does not support ${time.granularity}`,
        ),
      );
    }
  }

  if (issues.length > 0) throw new InvalidQueryError(issues);

  const query: SemanticQuery = { metrics, dimensions, filters };
  if (time) query.time = time;
  return query;
}

function readStringArray(
  value: unknown,
  path: string,
  allowEmpty: boolean,
  issues: ValidationIssue[],
): string[] {
  if (!Array.isArray(value)) {
    issues.push(issue(path, "REQUIRED", `${path} must be an array`));
    return [];
  }

  if (!allowEmpty && value.length === 0) {
    issues.push(issue(path, "EMPTY_ARRAY", `${path} must not be empty`));
  }

  const strings: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.length === 0) {
      issues.push(
        issue(
          `${path}[${index}]`,
          "INVALID_TYPE",
          "Expected a nonempty string",
        ),
      );
    } else {
      strings.push(item);
    }
  }
  return strings;
}

function readTime(
  value: unknown,
  issues: ValidationIssue[],
): TimeSelection | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push(issue("time", "INVALID_TYPE", "time must be an object"));
    return undefined;
  }

  rejectUnknownFields(value, timeFields, "time", issues);

  const granularity = value.granularity;
  const from = value.from;
  const to = value.to;

  if (
    typeof granularity !== "string" ||
    !granularities.includes(granularity as Granularity)
  ) {
    issues.push(
      issue(
        "time.granularity",
        "INVALID_GRANULARITY",
        "granularity must be month, quarter, or year",
      ),
    );
  }

  if (typeof from !== "string" || !isIsoDate(from)) {
    issues.push(issue("time.from", "INVALID_DATE", "from must use YYYY-MM-DD"));
  }

  if (typeof to !== "string" || !isIsoDate(to)) {
    issues.push(issue("time.to", "INVALID_DATE", "to must use YYYY-MM-DD"));
  }

  if (
    typeof from === "string" &&
    typeof to === "string" &&
    isIsoDate(from) &&
    isIsoDate(to) &&
    from > to
  ) {
    issues.push(
      issue(
        "time",
        "INVALID_RANGE",
        "from must be earlier than or equal to to",
      ),
    );
  }

  if (
    typeof granularity === "string" &&
    granularities.includes(granularity as Granularity) &&
    typeof from === "string" &&
    isIsoDate(from) &&
    typeof to === "string" &&
    isIsoDate(to) &&
    from <= to &&
    bucketStarts(from, to, granularity as Granularity).length > maxTimeBuckets
  ) {
    issues.push(
      issue(
        "time",
        "RANGE_TOO_LARGE",
        `A query may contain at most ${maxTimeBuckets} time buckets`,
      ),
    );
  }

  if (
    typeof granularity !== "string" ||
    !granularities.includes(granularity as Granularity) ||
    typeof from !== "string" ||
    !isIsoDate(from) ||
    typeof to !== "string" ||
    !isIsoDate(to)
  ) {
    return undefined;
  }

  return { granularity: granularity as Granularity, from, to };
}

function readFilters(
  value: unknown,
  issues: ValidationIssue[],
): SemanticFilter[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(issue("filters", "INVALID_TYPE", "filters must be an array"));
    return [];
  }

  const filters: SemanticFilter[] = [];
  let totalFilterValues = 0;

  if (value.length > maxFilters) {
    issues.push(
      issue(
        "filters",
        "TOO_MANY_FILTERS",
        `A query may contain at most ${maxFilters} filters`,
      ),
    );
  }

  for (const [index, candidate] of value.slice(0, maxFilters).entries()) {
    const path = `filters[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(issue(path, "INVALID_TYPE", "A filter must be an object"));
      continue;
    }

    rejectUnknownFields(candidate, filterFields, path, issues);
    const { dimension, operator, value: filterValue } = candidate;

    if (typeof dimension !== "string" || dimension.length === 0) {
      issues.push(
        issue(
          `${path}.dimension`,
          "INVALID_TYPE",
          "dimension must be a string",
        ),
      );
      continue;
    }

    if (operator === "eq") {
      if (typeof filterValue !== "string") {
        issues.push(
          issue(`${path}.value`, "INVALID_TYPE", "eq requires a string value"),
        );
      } else {
        totalFilterValues += 1;
        filters.push({ dimension, operator, value: filterValue });
      }
      continue;
    }

    if (operator === "in") {
      if (
        !Array.isArray(filterValue) ||
        filterValue.length === 0 ||
        filterValue.some((item) => typeof item !== "string")
      ) {
        issues.push(
          issue(
            `${path}.value`,
            "INVALID_TYPE",
            "in requires a nonempty string array",
          ),
        );
      } else {
        totalFilterValues += filterValue.length;
        if (filterValue.length > maxFilterValues) {
          issues.push(
            issue(
              `${path}.value`,
              "FILTER_TOO_LARGE",
              `in accepts at most ${maxFilterValues} values`,
            ),
          );
        }
        filters.push({
          dimension,
          operator,
          value: filterValue as string[],
        });
      }
      continue;
    }

    issues.push(
      issue(
        `${path}.operator`,
        "INVALID_OPERATOR",
        "operator must be eq or in",
      ),
    );
  }

  if (totalFilterValues > maxTotalFilterValues) {
    issues.push(
      issue(
        "filters",
        "FILTER_VALUES_TOO_LARGE",
        `A query may contain at most ${maxTotalFilterValues} filter values`,
      ),
    );
  }

  return filters;
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  issues: ValidationIssue[],
): void {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      issues.push(
        issue(
          path === "$" ? field : `${path}.${field}`,
          "UNKNOWN_FIELD",
          `Unknown field: ${field}`,
        ),
      );
    }
  }
}

function findCompanyId(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findCompanyId(item, `${path}[${index}]`, issues),
    );
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = path === "$" ? key : `${path}.${key}`;
    if (key.toLowerCase() === "companyid") {
      issues.push(
        issue(
          childPath,
          "FORBIDDEN_TENANT_FIELD",
          "companyId comes from authentication and cannot be provided",
        ),
      );
    }
    findCompanyId(child, childPath, issues);
  }
}

function rejectDuplicates(
  values: string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      issues.push(
        issue(
          `${path}[${index}]`,
          "DUPLICATE_VALUE",
          `Duplicate value: ${value}`,
        ),
      );
    }
    seen.add(value);
  });
}

function rejectDuplicateFilters(
  filters: SemanticFilter[],
  issues: ValidationIssue[],
): void {
  const seen = new Set<string>();
  filters.forEach((filter, index) => {
    if (seen.has(filter.dimension)) {
      issues.push(
        issue(
          `filters[${index}].dimension`,
          "DUPLICATE_FILTER",
          `Only one filter is allowed for ${filter.dimension}`,
        ),
      );
    }
    seen.add(filter.dimension);
  });
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
