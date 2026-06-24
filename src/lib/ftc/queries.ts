import { gql } from "./client";
import { seasonHasSimpleScores } from "../season";
import type {
  Team,
  TeamSearchResult,
  EventSearchResult,
  EventDetail,
} from "./types";

const QUICK_STATS = `
  quickStats(season: $season) {
    season
    number
    count
    tot { value rank }
    auto { value rank }
    dc { value rank }
    eg { value rank }
  }
`;

export async function getSeasonSnapshot(
  season: number,
): Promise<{ activeTeamsCount: number; matchesPlayedCount: number }> {
  const query = `
    query Snapshot($season: Int!) {
      activeTeamsCount(season: $season)
      matchesPlayedCount(season: $season)
    }
  `;
  return gql(query, { season }, 3600);
}

export interface WorldRecord {
  season: number;
  eventCode: string;
  eventName: string;
  eventStart: string;
  alliance: "Red" | "Blue";
  score: number; // no-penalty total
  scoreWithPenalties: number;
  teams: { number: number; name: string }[];
}

export async function getWorldRecord(
  season: number,
): Promise<WorldRecord | null> {
  if (!seasonHasSimpleScores(season)) return null;
  const query = `
    query WR($season: Int!) {
      tradWorldRecord(season: $season) {
        season
        eventCode
        event { name start }
        teams { teamNumber alliance station team { name } }
        scores { ... on MatchScores${season} {
          red { totalPoints totalPointsNp }
          blue { totalPoints totalPointsNp }
        } }
      }
    }
  `;
  const data = await gql<{
    tradWorldRecord: {
      season: number;
      eventCode: string;
      event: { name: string; start: string };
      teams: {
        teamNumber: number;
        alliance: "Red" | "Blue";
        station: string;
        team: { name: string };
      }[];
      scores: {
        red: { totalPoints: number; totalPointsNp: number } | null;
        blue: { totalPoints: number; totalPointsNp: number } | null;
      } | null;
    } | null;
  }>(query, { season }, 3600);

  const m = data.tradWorldRecord;
  if (!m || !m.scores?.red || !m.scores?.blue) return null;
  const alliance: "Red" | "Blue" =
    m.scores.red.totalPointsNp >= m.scores.blue.totalPointsNp ? "Red" : "Blue";
  const side = alliance === "Red" ? m.scores.red : m.scores.blue;
  const teams = m.teams
    .filter((t) => t.alliance === alliance && t.station !== "NotOnField")
    .map((t) => ({ number: t.teamNumber, name: t.team.name }));
  return {
    season: m.season,
    eventCode: m.eventCode,
    eventName: m.event.name,
    eventStart: m.event.start,
    alliance,
    score: side.totalPointsNp,
    scoreWithPenalties: side.totalPoints,
    teams,
  };
}

export async function getTeam(
  number: number,
  season: number,
): Promise<Team | null> {
  const query = `
    query Team($number: Int!, $season: Int!) {
      teamByNumber(number: $number) {
        number
        name
        schoolName
        sponsors
        rookieYear
        website
        activeSeasons
        location { city state country }
        ${QUICK_STATS}
        events(season: $season) {
          eventCode
          event {
            name
            code
            start
            type
            ongoing
            timezone
            location { city state country }
          }
        }
        awards(season: $season) {
          type
          placement
          eventCode
          event { name }
        }
      }
    }
  `;
  const data = await gql<{ teamByNumber: Team | null }>(query, {
    number,
    season,
  });
  return data.teamByNumber;
}

export async function searchTeams(
  searchText: string,
  limit = 12,
): Promise<TeamSearchResult[]> {
  if (!searchText.trim()) return [];
  const query = `
    query Search($searchText: String!, $limit: Int!) {
      teamsSearch(searchText: $searchText, limit: $limit) {
        number
        name
        location { city state country }
      }
    }
  `;
  const data = await gql<{ teamsSearch: TeamSearchResult[] }>(
    query,
    { searchText, limit },
    60,
  );
  return data.teamsSearch ?? [];
}

export async function searchEvents(
  searchText: string,
  season: number,
  limit = 12,
): Promise<EventSearchResult[]> {
  if (!searchText.trim()) return [];
  const query = `
    query SearchEvents($searchText: String!, $season: Int!, $limit: Int!) {
      eventsSearch(searchText: $searchText, season: $season, limit: $limit) {
        code
        season
        name
        start
        type
        location { city state country }
      }
    }
  `;
  const data = await gql<{ eventsSearch: EventSearchResult[] }>(
    query,
    { searchText, season, limit },
    60,
  );
  return data.eventsSearch ?? [];
}

export async function getEvent(
  season: number,
  code: string,
): Promise<EventDetail | null> {
  const scores = seasonHasSimpleScores(season)
    ? `scores { ... on MatchScores${season} {
         red { totalPoints totalPointsNp }
         blue { totalPoints totalPointsNp }
       } }`
    : "";

  // Per-event OPR straight from FTCScout (authoritative; quals-only, no-penalty).
  const eventStats = seasonHasSimpleScores(season)
    ? `stats { ... on TeamEventStats${season} {
         opr { totalPointsNp autoPoints dcPoints }
       } }`
    : "";

  const query = `
    query Event($season: Int!, $code: String!) {
      eventByCode(season: $season, code: $code) {
        code
        season
        name
        start
        end
        type
        remote
        ongoing
        started
        finished
        timezone
        divisionCode
        relatedEvents { code divisionCode type }
        website
        location { city state country }
        teams {
          teamNumber
          team {
            name
            ${QUICK_STATS}
          }
          ${eventStats}
        }
        matches {
          matchNum
          tournamentLevel
          series
          hasBeenPlayed
          scheduledStartTime
          actualStartTime
          postResultTime
          teams { teamNumber alliance station allianceRole surrogate onField }
          ${scores}
        }
      }
    }
  `;
  const data = await gql<{ eventByCode: EventDetail | null }>(query, {
    season,
    code,
  });
  return data.eventByCode;
}

/** Lightweight match list for an event (times + team numbers only) — used for
 *  the team page "next match" lookup, avoiding the full event/quickStats fetch. */
export interface EventMatchLite {
  timezone: string;
  matches: {
    matchNum: number;
    tournamentLevel: string;
    series: number;
    hasBeenPlayed: boolean;
    scheduledStartTime: string | null;
    actualStartTime: string | null;
    teams: { teamNumber: number }[];
  }[];
}

export async function getEventMatches(
  season: number,
  code: string,
): Promise<EventMatchLite | null> {
  const query = `
    query EventMatches($season: Int!, $code: String!) {
      eventByCode(season: $season, code: $code) {
        timezone
        matches {
          matchNum
          tournamentLevel
          series
          hasBeenPlayed
          scheduledStartTime
          actualStartTime
          teams { teamNumber }
        }
      }
    }
  `;
  const data = await gql<{ eventByCode: EventMatchLite | null }>(
    query,
    { season, code },
    30,
  );
  return data.eventByCode;
}
