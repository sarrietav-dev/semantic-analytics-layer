import { SQL } from "bun";

export type Database = SQL;

export function createDatabase(
  connectionString = process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:54329/analytics",
): Database {
  return new SQL(connectionString, { max: 10 });
}

export class SqlParameters {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export function toNumber(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(
      `Expected a finite database number, received ${String(value)}`,
    );
  }
  return number;
}

export function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}
