import { InvalidModuleResultError, QueryTooLargeError } from "./errors";
import { AnalyticsRegistry } from "./registry";
import { bucketStarts } from "./time";
import type {
  AnalyticsModule,
  DefinitionsResponse,
  DimensionMember,
  ModuleExecutionContext,
  ModuleQuery,
  ModuleResult,
  ModuleResultRow,
  QueryResponse,
  ResponseColumn,
  ResponseRow,
  SemanticQuery,
} from "./types";
import { validateQuery } from "./validation";

interface ModuleExecution {
  module: AnalyticsModule;
  metricNames: string[];
  result: ModuleResult;
}

interface ResultKey {
  time?: string;
  dimensions: Record<string, string>;
  dimensionKeys: Record<string, string>;
}

const maxDimensionMembers = 10_000;
const maxResultRows = 100_000;

export class AnalyticsEngine {
  constructor(private readonly registry: AnalyticsRegistry) {
    registry.assertValid();
  }

  definitions(): DefinitionsResponse {
    return { definitions: this.registry.publicDefinitions() };
  }

  async query(
    input: unknown,
    context: ModuleExecutionContext,
  ): Promise<QueryResponse> {
    const query = validateQuery(input, this.registry);
    const executions = await this.executeModules(query, context);
    const keys = query.time
      ? await this.buildTimeSpine(query, context)
      : this.keysFromResults(query, executions);
    if (query.time) this.assertResultsBelongToSpine(query, keys, executions);

    return {
      columns: this.columns(query),
      rows: this.mergeRows(query, keys, executions),
    };
  }

  private async executeModules(
    query: SemanticQuery,
    context: ModuleExecutionContext,
  ): Promise<ModuleExecution[]> {
    const metricsByModule = new Map<string, string[]>();

    for (const metricName of query.metrics) {
      const registered = this.registry.getMetric(metricName);
      if (!registered) continue;
      const metrics = metricsByModule.get(registered.module.id) ?? [];
      metrics.push(metricName);
      metricsByModule.set(registered.module.id, metrics);
    }

    return Promise.all(
      [...metricsByModule.entries()].map(async ([moduleId, metricNames]) => {
        const module = this.registry.getModule(moduleId);
        if (!module)
          throw new Error(`Registered module ${moduleId} was not found`);

        const moduleQuery: ModuleQuery = {
          metrics: metricNames,
          dimensions: [...query.dimensions],
          filters: [...query.filters],
        };
        if (query.time) moduleQuery.time = { ...query.time };

        const result = await module.execute(moduleQuery, context);
        this.validateModuleResult(module, moduleQuery, result);
        return { module, metricNames, result };
      }),
    );
  }

  private async buildTimeSpine(
    query: SemanticQuery,
    context: ModuleExecutionContext,
  ): Promise<ResultKey[]> {
    if (!query.time) return [];

    const membersByDimension = await Promise.all(
      query.dimensions.map(async (dimensionName) => {
        const registered = this.registry.getDimension(dimensionName);
        const resolver = registered?.module.resolveDimensionMembers;
        if (!registered || !resolver) {
          throw new Error(`No member resolver for ${dimensionName}`);
        }

        const filters = query.filters.filter(
          (filter) => filter.dimension === dimensionName,
        );
        const members = await resolver.call(
          registered.module,
          { dimension: dimensionName, filters },
          context,
        );
        this.validateMembers(registered.module.id, dimensionName, members);
        const uniqueMembers = [
          ...new Map(members.map((member) => [member.key, member])).values(),
        ].sort(
          (left, right) =>
            left.value.localeCompare(right.value) ||
            left.key.localeCompare(right.key),
        );
        if (uniqueMembers.length > maxDimensionMembers) {
          throw new QueryTooLargeError(
            `${dimensionName} returned more than ${maxDimensionMembers} members`,
          );
        }
        return uniqueMembers;
      }),
    );

    const periods = bucketStarts(
      query.time.from,
      query.time.to,
      query.time.granularity,
    );
    const combinationCount = membersByDimension.reduce(
      (total, members) => total * members.length,
      1,
    );
    const rowCount = combinationCount * periods.length;
    if (rowCount > maxResultRows) {
      throw new QueryTooLargeError(
        `The requested time and dimensions would generate ${rowCount} rows; the limit is ${maxResultRows}`,
      );
    }
    const dimensionCombinations = cartesianDimensions(
      query.dimensions,
      membersByDimension,
    );

    const keys: ResultKey[] = [];
    for (const time of periods) {
      for (const combination of dimensionCombinations) {
        keys.push({ time, ...combination });
      }
    }
    return keys;
  }

  private keysFromResults(
    query: SemanticQuery,
    executions: ModuleExecution[],
  ): ResultKey[] {
    const keys = new Map<string, ResultKey>();

    for (const execution of executions) {
      for (const row of execution.result.rows) {
        const resultKey: ResultKey = {
          dimensions: row.dimensions,
          dimensionKeys: row.dimensionKeys,
        };
        keys.set(serializeKey(query, resultKey), resultKey);
      }
    }

    if (keys.size === 0 && query.dimensions.length === 0) {
      return [{ dimensions: {}, dimensionKeys: {} }];
    }

    return [...keys.values()].sort((left, right) =>
      serializeKey(query, left).localeCompare(serializeKey(query, right)),
    );
  }

  private mergeRows(
    query: SemanticQuery,
    keys: ResultKey[],
    executions: ModuleExecution[],
  ): ResponseRow[] {
    const sourceRows = new Map<string, Map<string, ModuleResultRow>>();

    for (const execution of executions) {
      const rows = new Map<string, ModuleResultRow>();
      for (const row of execution.result.rows) {
        const key = serializeKey(query, row);
        if (rows.has(key)) {
          throw new InvalidModuleResultError(
            execution.module.id,
            `duplicate row for ${key}`,
          );
        }
        rows.set(key, row);
      }
      sourceRows.set(execution.module.id, rows);
    }

    return keys.map((key) => {
      const output: ResponseRow = {};
      if (query.time && key.time) output.time = key.time;
      for (const dimension of query.dimensions) {
        output[dimension] = key.dimensions[dimension] ?? "";
      }

      for (const metricName of query.metrics) {
        const registered = this.registry.getMetric(metricName);
        if (!registered) continue;
        const row = sourceRows
          .get(registered.module.id)
          ?.get(serializeKey(query, key));
        output[metricName] =
          row && Object.hasOwn(row.metrics, metricName)
            ? (row.metrics[metricName] ?? null)
            : registered.definition.emptyValue;
      }
      return output;
    });
  }

  private columns(query: SemanticQuery): ResponseColumn[] {
    const columns: ResponseColumn[] = [];
    if (query.time) columns.push({ name: "time", role: "time", type: "date" });

    for (const dimensionName of query.dimensions) {
      columns.push({ name: dimensionName, role: "dimension", type: "string" });
    }

    for (const metricName of query.metrics) {
      columns.push({ name: metricName, role: "metric", type: "number" });
    }
    return columns;
  }

  private validateModuleResult(
    module: AnalyticsModule,
    query: ModuleQuery,
    result: ModuleResult,
  ): void {
    if (!result || !Array.isArray(result.rows)) {
      throw new InvalidModuleResultError(module.id, "rows must be an array");
    }
    if (result.rows.length > maxResultRows) {
      throw new InvalidModuleResultError(
        module.id,
        `returned more than ${maxResultRows} rows`,
      );
    }

    for (const row of result.rows) {
      if (query.time && typeof row.time !== "string") {
        throw new InvalidModuleResultError(module.id, "time is required");
      }
      if (!row.dimensions || !row.dimensionKeys || !row.metrics) {
        throw new InvalidModuleResultError(
          module.id,
          "dimensions, dimensionKeys, and metrics are required",
        );
      }
      for (const dimension of query.dimensions) {
        if (
          typeof row.dimensions[dimension] !== "string" ||
          typeof row.dimensionKeys[dimension] !== "string"
        ) {
          throw new InvalidModuleResultError(
            module.id,
            `missing dimension value or key for ${dimension}`,
          );
        }
      }
      for (const metric of query.metrics) {
        const value = row.metrics[metric];
        if (
          value !== null &&
          (typeof value !== "number" || !Number.isFinite(value))
        ) {
          throw new InvalidModuleResultError(
            module.id,
            `metric ${metric} must be a number or null`,
          );
        }
      }
    }
  }

  private assertResultsBelongToSpine(
    query: SemanticQuery,
    keys: ResultKey[],
    executions: ModuleExecution[],
  ): void {
    const allowed = new Set(keys.map((key) => serializeKey(query, key)));
    for (const execution of executions) {
      for (const row of execution.result.rows) {
        const key = serializeKey(query, row);
        if (!allowed.has(key)) {
          throw new InvalidModuleResultError(
            execution.module.id,
            `row key ${key} is outside the requested canonical spine`,
          );
        }
      }
    }
  }

  private validateMembers(
    moduleId: string,
    dimension: string,
    members: DimensionMember[],
  ): void {
    if (!Array.isArray(members)) {
      throw new InvalidModuleResultError(moduleId, "members must be an array");
    }
    for (const member of members) {
      if (
        member.dimension !== dimension ||
        typeof member.key !== "string" ||
        member.key.length === 0 ||
        typeof member.value !== "string"
      ) {
        throw new InvalidModuleResultError(
          moduleId,
          `invalid member for ${dimension}`,
        );
      }
    }
  }
}

function serializeKey(query: SemanticQuery, key: ResultKey): string {
  return JSON.stringify([
    query.time ? key.time : null,
    ...query.dimensions.map((dimension) => key.dimensionKeys[dimension]),
  ]);
}

function cartesianDimensions(
  dimensions: string[],
  membersByDimension: DimensionMember[][],
): Array<Pick<ResultKey, "dimensions" | "dimensionKeys">> {
  if (dimensions.length === 0) {
    return [{ dimensions: {}, dimensionKeys: {} }];
  }

  let combinations: Array<Pick<ResultKey, "dimensions" | "dimensionKeys">> = [
    { dimensions: {}, dimensionKeys: {} },
  ];
  dimensions.forEach((dimension, index) => {
    const members = membersByDimension[index] ?? [];
    combinations = combinations.flatMap((combination) =>
      members.map((member) => ({
        dimensions: {
          ...combination.dimensions,
          [dimension]: member.value,
        },
        dimensionKeys: {
          ...combination.dimensionKeys,
          [dimension]: member.key,
        },
      })),
    );
  });
  return combinations;
}
