import type { Match } from "./types";

/**
 * FTCScout doesn't expose playoff alliance seeds, so derive them.
 *  - Teams that share a side in any playoff match belong to the same alliance
 *    (union-find clusters them, robust to the captain sitting some matches).
 *  - Alliance numbers come from the captains ordered by qualification rank
 *    (alliance 1 = top-seeded captain, …).
 * Returns a map of team number → alliance number for all playoff participants.
 */
export function deriveAllianceNumbers(
  matches: Match[],
  rankOf: Map<number, number>,
): Map<number, number> {
  const parent = new Map<number, number>();
  const ensure = (x: number) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const find = (x: number): number => {
    ensure(x);
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const union = (a: number, b: number) => parent.set(find(a), find(b));

  const captains = new Set<number>();
  for (const m of matches) {
    if (m.tournamentLevel === "Quals") continue;
    for (const side of ["Red", "Blue"] as const) {
      const teams = m.teams.filter((t) => t.alliance === side).map((t) => t.teamNumber);
      teams.forEach((t) => ensure(t));
      for (let i = 1; i < teams.length; i++) union(teams[0], teams[i]);
    }
    for (const t of m.teams) if (t.allianceRole === "Captain") captains.add(t.teamNumber);
  }
  if (captains.size === 0) return new Map();

  // Captains → alliance number (sorted by quals rank ascending).
  const captainList = [...captains].sort(
    (a, b) => (rankOf.get(a) ?? Infinity) - (rankOf.get(b) ?? Infinity),
  );
  const numByCaptain = new Map<number, number>();
  captainList.forEach((c, i) => numByCaptain.set(c, i + 1));

  // Cluster root → its captain's alliance number.
  const numByRoot = new Map<number, number>();
  for (const c of captains) numByRoot.set(find(c), numByCaptain.get(c)!);

  const out = new Map<number, number>();
  for (const t of parent.keys()) {
    const n = numByRoot.get(find(t));
    if (n != null) out.set(t, n);
  }
  return out;
}
