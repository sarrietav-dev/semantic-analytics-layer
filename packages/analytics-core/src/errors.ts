export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export class AnalyticsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = "AnalyticsError";
  }
}

export class InvalidQueryError extends AnalyticsError {
  constructor(issues: ValidationIssue[]) {
    super("INVALID_QUERY", "The analytics query is invalid", 400, issues);
    this.name = "InvalidQueryError";
  }
}

export class InvalidRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRegistrationError";
  }
}

export class QueryTooLargeError extends AnalyticsError {
  constructor(message: string) {
    super("QUERY_TOO_LARGE", message, 400);
    this.name = "QueryTooLargeError";
  }
}

export class InvalidModuleResultError extends Error {
  constructor(moduleId: string, message: string) {
    super(`Module ${moduleId} returned an invalid result: ${message}`);
    this.name = "InvalidModuleResultError";
  }
}
