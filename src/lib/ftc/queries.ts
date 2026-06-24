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
          event { name code start type location { city state country } }
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
        website
        location { city state country }
        teams {
          teamNumber
          team {
            name
            ${QUICK_STATS}
          }
        }
        matches {
          matchNum
          tournamentLevel
          series
          hasBeenPlayed
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
