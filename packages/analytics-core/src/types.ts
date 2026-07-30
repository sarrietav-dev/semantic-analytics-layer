export const granularities = ["month", "quarter", "year"] as const;

export type Granularity = (typeof granularities)[number];
export type FilterOperator = "eq" | "in";

export interface TimeSelection {
  granularity: Granularity;
  from: string;
  to: string;
}

export type SemanticFilter =
  | { dimension: string; operator: "eq"; value: string }
  | { dimension: string; operator: "in"; value: string[] };

export interface SemanticQuery {
  metrics: string[];
  dimensions: string[];
  time?: TimeSelection;
  filters: SemanticFilter[];
}

export interface MetricDefinition {
  kind: "metric";
  name: string;
  label: string;
  description: string;
  type: "number";
  supportedDimensions: string[];
  supportedGranularities: Granularity[];
  emptyValue: number | null;
}

export interface DimensionDefinition {
  kind: "dimension";
  name: string;
  label: string;
  description: string;
  type: "string";
  filterOperators: FilterOperator[];
}

export type PublicDefinition = MetricDefinition | DimensionDefinition;

export interface ModuleExecutionContext {
  companyId: string;
}

export interface ModuleQuery extends SemanticQuery {}

export interface ModuleResultRow {
  time?: string;
  dimensions: Record<string, string>;
  dimensionKeys: Record<string, string>;
  metrics: Record<string, number | null>;
}

export interface ModuleResult {
  rows: ModuleResultRow[];
}

export interface DimensionMembersRequest {
  dimension: string;
  filters: SemanticFilter[];
}

export interface DimensionMember {
  dimension: string;
  key: string;
  value: string;
}

export interface AnalyticsModule {
  id: string;
  definitions: PublicDefinition[];
  execute(
    query: ModuleQuery,
    context: ModuleExecutionContext,
  ): Promise<ModuleResult>;
  resolveDimensionMembers?(
    request: DimensionMembersRequest,
    context: ModuleExecutionContext,
  ): Promise<DimensionMember[]>;
}

export interface ResponseColumn {
  name: string;
  role: "time" | "dimension" | "metric";
  type: "date" | "string" | "number";
}

export type ResponseRow = Record<string, string | number | null>;

export interface QueryResponse {
  columns: ResponseColumn[];
  rows: ResponseRow[];
}

export type PublicDefinitionView = PublicDefinition & { owner: string };

export interface DefinitionsResponse {
  definitions: PublicDefinitionView[];
}
