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

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABEL[type] ?? type;
}

/** Higher = more prestigious; used to sort a team's event list. */
export function eventTypeWeight(type: string): number {
  const order = [
    "FIRSTChampionship",
    "Championship",
    "SuperQualifier",
    "Qualifier",
    "LeagueTournament",
    "LeagueMeet",
    "Premier",
    "Scrimmage",
    "OffSeason",
    "Other",
  ];
  const i = order.indexOf(type);
  return i === -1 ? order.length : i;
}

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

export function awardLabel(type: string): string {
  // Award enum values are PascalCase — turn into spaced words.
  return type.replace(/([a-z])([A-Z])/g, "$1 $2");
}
