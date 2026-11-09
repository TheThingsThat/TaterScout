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
  opts: { year?: boolean; local?: boolean } = {},
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
    // `local`: the runtime's zone, which in the browser is the viewer's.
    timeZone: opts.local ? undefined : "UTC",
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

/** "just now", "12 min ago", "3 h ago", "2 days ago"; "in 4 min" for a future time. */
export function formatAgo(ms: number, now: number): string {
  const d = now - ms;
  const abs = Math.abs(d);
  const min = Math.round(abs / 60_000);
  const text =
    abs < 60_000
      ? null
      : min < 60
        ? `${min} min`
        : abs < 48 * 3_600_000
          ? `${Math.round(abs / 3_600_000)} h`
          : `${Math.round(abs / 86_400_000)} days`;
  if (!text) return d >= 0 ? "just now" : "in under a minute";
  return d >= 0 ? `${text} ago` : `in ${text}`;
}

export function locationStr(
  loc: { city?: string | null; state?: string | null; country?: string | null } | null | undefined,
): string {
  if (!loc) return "—";
  return [loc.city, loc.state, loc.country].filter(Boolean).join(", ") || "—";
}
