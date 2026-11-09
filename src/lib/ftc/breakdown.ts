// Per-match score breakdown from FIRST's /scores rows. Field names are game-specific,
// so a season only gets a breakdown once it has a definition here.
import type { MatchBreakdown } from "./types";

/** One alliance's /scores row. Everything besides these keys is game-specific. */
export type ScoreRow = { alliance: "Red" | "Blue"; totalPoints: number } & Record<string, unknown>;

interface LineDef {
  label: string;
  points: string; // field holding the line's points
  count?: { field: string; noun: string };
}

interface SeasonDef {
  auto: LineDef[];
  teleop: LineDef[];
  rp: { field: string; label: string; short: string }[]; // short: written in the RP circle
}

const SEASONS: Record<number, SeasonDef> = {
  2026: {
    auto: [
      { label: "Leave", points: "autoLeavePoints" },
      { label: "Park", points: "autoParkPoints" },
      { label: "Hive", points: "autoHivePoints", count: { field: "autoHiveTips", noun: "tip" } },
    ],
    teleop: [
      { label: "Hive", points: "teleopHivePoints", count: { field: "teleopHiveTips", noun: "tip" } },
      { label: "Flowers", points: "teleopFlowerPoints" },
      { label: "Garden", points: "teleopGardenPoints" },
      { label: "Park", points: "teleopParkPoints" },
    ],
    rp: [
      { field: "swarmRP", label: "Swarm", short: "S" },
      { field: "pollinator1RP", label: "Pollinator 1", short: "P1" },
      { field: "pollinator2RP", label: "Pollinator 2", short: "P2" },
    ],
  },
  2025: {
    auto: [
      { label: "Leave", points: "autoLeavePoints" },
      { label: "Artifacts", points: "autoArtifactPoints" },
      { label: "Pattern", points: "autoPatternPoints" },
    ],
    teleop: [
      { label: "Artifacts", points: "teleopArtifactPoints" },
      { label: "Depot", points: "teleopDepotPoints" },
      { label: "Pattern", points: "teleopPatternPoints" },
      { label: "Base", points: "teleopBasePoints" },
    ],
    rp: [
      { field: "movementRP", label: "Movement", short: "M" },
      { field: "goalRP", label: "Goal", short: "G" },
      { field: "patternRP", label: "Pattern", short: "P" },
    ],
  },
};

const WIN_RP = 3;
const TIE_RP = 1;

const num = (row: ScoreRow, field: string): number => {
  const v = row[field];
  return typeof v === "number" ? v : 0;
};

function line(def: LineDef, red: ScoreRow, blue: ScoreRow) {
  const note = (row: ScoreRow) => {
    if (!def.count) return null;
    const n = num(row, def.count.field);
    return n > 0 ? `${n} ${def.count.noun}${n === 1 ? "" : "s"}` : null;
  };
  return {
    label: def.label,
    red: num(red, def.points),
    blue: num(blue, def.points),
    redNote: note(red),
    blueNote: note(blue),
  };
}

/**
 * Null when the season has no definition, or when the row doesn't add up to the
 * final score. FIRST serves all-zero rows until a new game's score model ships, and
 * /scores can lag the match row, so a mismatch means this row can't be trusted yet.
 */
export function buildBreakdown(
  season: number,
  quals: boolean,
  red: ScoreRow | undefined,
  blue: ScoreRow | undefined,
  redFinal: number | null,
  blueFinal: number | null,
): MatchBreakdown | null {
  const def = SEASONS[season];
  if (!def || !red || !blue || redFinal == null || blueFinal == null) return null;
  if (red.totalPoints !== redFinal || blue.totalPoints !== blueFinal) return null;

  const fouls = (row: ScoreRow) => `${num(row, "majorFouls")} / ${num(row, "minorFouls")}`;
  const matchRp = (mine: number, theirs: number) =>
    mine > theirs ? WIN_RP : mine === theirs ? TIE_RP : 0;
  const rp = quals
    ? def.rp.map((c) => ({ label: c.label, short: c.short, red: red[c.field] === true, blue: blue[c.field] === true }))
    : [];

  return {
    autoRed: num(red, "autoPoints"),
    autoBlue: num(blue, "autoPoints"),
    auto: def.auto.map((d) => line(d, red, blue)),
    teleopRed: num(red, "teleopPoints"),
    teleopBlue: num(blue, "teleopPoints"),
    teleop: def.teleop.map((d) => line(d, red, blue)),
    // What each side committed is credited to the other.
    foulPointsRed: num(blue, "foulPointsCommitted"),
    foulPointsBlue: num(red, "foulPointsCommitted"),
    foulsRed: fouls(red),
    foulsBlue: fouls(blue),
    rp,
    rpTotalRed: matchRp(redFinal, blueFinal) + rp.filter((c) => c.red).length,
    rpTotalBlue: matchRp(blueFinal, redFinal) + rp.filter((c) => c.blue).length,
  };
}
