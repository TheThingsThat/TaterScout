import { ordinal } from "../format";

const EVENT_TYPE_LABEL: Record<string, string> = {
  Scrimmage: "Scrimmage",
  LeagueMeet: "League Meet",
  Qualifier: "Qualifier",
  LeagueTournament: "League Tournament",
  Championship: "Championship",
  FIRSTChampionship: "FIRST Championship",
  SuperQualifier: "Super Qualifier",
  InnovationChallenge: "Innovation Challenge",
  OffSeason: "Off-Season",
  Kickoff: "Kickoff",
  Workshop: "Workshop",
  DemoExhibition: "Demo / Exhibition",
  Other: "Event",
  Premier: "Premier",
};

/** FIRST gives a spaced `typeName` ("FIRST Championship", "League Meet"); the
 *  label/weight maps below key on the compact PascalCase form. Strip separators
 *  so "FIRST Championship" → "FIRSTChampionship", "League Meet" → "LeagueMeet". */
export function normalizeEventType(typeName: string | null | undefined): string {
  if (!typeName) return "Other";
  const key = typeName.replace(/[^a-zA-Z0-9]/g, "");
  return key || "Other";
}

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABEL[type] ?? type;
}

/** FIRST's raw tournamentLevel → our two-level shape. */
export const levelOf = (tournamentLevel: string): "Quals" | "Playoff" =>
  tournamentLevel === "QUALIFICATION" ? "Quals" : "Playoff";

export function tournamentLevelLabel(level: string): string {
  switch (level) {
    case "Quals":
      return "Qualification";
    case "DoubleElim":
      return "Playoffs";
    case "Finals":
      return "Finals";
    case "Semis":
      return "Semifinals";
    default:
      return level;
  }
}

/** Display label for an award (mapAward's {type, placement}):
 *  - alliance results → "Winning Alliance" / "Finalist Alliance" (no numbering,
 *    and no division/finals distinction — a win is a win)
 *  - judged awards → short name + placement, e.g. "Inspire 1st", "Innovate 2nd" */
export function formatAward(type: string, placement: number): string {
  if (type === "Winner") return "Winning Alliance";
  if (type === "Finalist") return "Finalist Alliance";
  const short = type
    .replace(/\s*sponsored by.*$/i, "")
    .replace(/\s*Award\b/i, "")
    .trim();
  return placement > 0 ? `${short} ${ordinal(placement)}` : short;
}
