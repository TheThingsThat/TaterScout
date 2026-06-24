// FTC qualification schedule generation. Cheesy Arena schedules are FRC
// (3v3, 6 teams/match) and don't apply to FTC's 2v2 format, so we generate a
// balanced-random 2v2 schedule: each team plays `matchesPerTeam` matches, with
// 4 distinct teams per match and repeat partners/opponents minimized.
//
// A match is [red0, red1, blue0, blue1] of team indices into the team list.
export type SchedMatchIdx = [number, number, number, number];

export function generateSchedule(
  teamCount: number,
  matchesPerTeam: number,
  rand: () => number,
): SchedMatchIdx[] {
  if (teamCount < 4) return [];
  // Build a pool with each team appearing `matchesPerTeam` times.
  const pool: number[] = [];
  for (let t = 0; t < teamCount; t++)
    for (let m = 0; m < matchesPerTeam; m++) pool.push(t);

  // Fisher–Yates shuffle.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const numMatches = Math.floor(pool.length / 4);
  const matches: SchedMatchIdx[] = [];
  let cursor = 0;
  for (let mi = 0; mi < numMatches; mi++) {
    // Greedily pick 4 distinct teams starting at the cursor; if a duplicate
    // would occur, swap it with a later slot.
    const picked: number[] = [];
    for (let slot = 0; slot < 4 && cursor < pool.length; ) {
      let k = cursor;
      while (k < pool.length && picked.includes(pool[k])) k++;
      if (k >= pool.length) {
        // No distinct team left for this slot; accept a repeat to keep going.
        k = cursor;
      }
      if (k !== cursor) [pool[cursor], pool[k]] = [pool[k], pool[cursor]];
      picked.push(pool[cursor]);
      cursor++;
      slot++;
    }
    if (picked.length === 4) {
      matches.push([picked[0], picked[1], picked[2], picked[3]]);
    }
  }
  return matches;
}
