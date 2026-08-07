export function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function ordinal(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function rankPercentile(rank: number, count: number): number {
  if (!count) return 0;
  return Math.max(0, Math.min(100, (1 - (rank - 1) / count) * 100));
}

export function formatDate(
  value: string | number | null | undefined,
  opts: { year?: boolean } = {},
): string {
  if (value === null || value === undefined || value === "") return "—";
  // Dates from the API are plain YYYY-MM-DD — keep them in UTC to avoid TZ drift.
  const d =
    typeof value === "number"
      ? new Date(value)
      : new Date(value.length === 10 ? value + "T00:00:00Z" : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(opts.year === false ? {} : { year: "numeric" as const }),
    timeZone: "UTC",
  });
}

/** Clock time like "3:45 PM". With no `timezone` it uses the runtime's zone —
 *  in the browser that's the VIEWER's local time (the site-wide convention for
 *  match times; see components/LocalClock for server-rendered pages). */
export function formatClock(
  value: string | number | null | undefined,
  timezone?: string,
): string {
  if (value === null || value === undefined) return "—";
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (Number.isNaN(ms)) return "—";
  try {
    return new Date(ms).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone || undefined,
    });
  } catch {
    return new Date(ms).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
}

export function locationStr(
  loc: { city?: string | null; state?: string | null; country?: string | null } | null | undefined,
): string {
  if (!loc) return "—";
  return [loc.city, loc.state, loc.country].filter(Boolean).join(", ") || "—";
}
