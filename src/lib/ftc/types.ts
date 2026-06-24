export interface Location {
  city: string | null;
  state: string | null;
  country: string | null;
  venue?: string | null;
}

export interface QuickStat {
  value: number;
  rank: number;
}

export interface QuickStats {
  season: number;
  number: number;
  count: number; // total teams ranked this season
  tot: QuickStat;
  auto: QuickStat;
  dc: QuickStat;
  eg: QuickStat;
}

export interface AwardLite {
  type: string;
  placement: number;
  eventCode: string;
}

export interface TeamEventLite {
  eventCode: string;
  event: {
    name: string;
    code: string;
    start: string;
    type: string;
    location: Location;
  };
}

export interface Team {
  number: number;
  name: string;
  schoolName: string | null;
  sponsors: string[];
  location: Location;
  rookieYear: number;
  website: string | null;
  activeSeasons: number[];
  quickStats: QuickStats | null;
  events: TeamEventLite[];
  awards: AwardLite[];
}

export interface TeamSearchResult {
  number: number;
  name: string;
  location: Location;
}

export interface EventSearchResult {
  code: string;
  season: number;
  name: string;
  start: string;
  type: string;
  location: Location;
}

export interface AllianceSide {
  totalPoints: number | null;
  totalPointsNp: number | null;
}

export interface MatchScores {
  red: AllianceSide | null;
  blue: AllianceSide | null;
}

export interface MatchTeam {
  teamNumber: number;
  alliance: "Red" | "Blue";
  station: string;
  allianceRole: string | null;
  surrogate: boolean;
  onField: boolean;
}

export interface Match {
  matchNum: number;
  tournamentLevel: string; // "Quals" | "DoubleElim" | "Finals" | ...
  series: number;
  hasBeenPlayed: boolean;
  teams: MatchTeam[];
  scores: MatchScores | null;
}

export interface EventTeam {
  teamNumber: number;
  team: {
    name: string;
    quickStats: QuickStats | null;
  };
}

export interface EventDetail {
  code: string;
  season: number;
  name: string;
  start: string;
  end: string;
  type: string;
  remote: boolean;
  ongoing: boolean;
  started: boolean;
  finished: boolean;
  location: Location;
  website: string | null;
  teams: EventTeam[];
  matches: Match[];
}
