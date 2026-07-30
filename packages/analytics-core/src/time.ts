import type { Granularity } from "./types";

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const match = datePattern.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function bucketStarts(
  from: string,
  to: string,
  granularity: Granularity,
): string[] {
  const start = parseDate(from);
  const end = parseDate(to);
  floorToBucket(start, granularity);

  const buckets: string[] = [];
  while (start <= end) {
    buckets.push(formatDate(start));
    addBucket(start, granularity);
  }

  return buckets;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

function floorToBucket(date: Date, granularity: Granularity): void {
  date.setUTCDate(1);

  if (granularity === "quarter") {
    date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3);
  } else if (granularity === "year") {
    date.setUTCMonth(0);
  }
}

function addBucket(date: Date, granularity: Granularity): void {
  const months =
    granularity === "month" ? 1 : granularity === "quarter" ? 3 : 12;
  date.setUTCMonth(date.getUTCMonth() + months);
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
