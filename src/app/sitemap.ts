import type { MetadataRoute } from "next";
import { CURRENT_SEASON } from "@/lib/season";
import { queryRankings } from "@/lib/rankings";

const SITE_URL = "https://taterscout.org";

/** Static routes plus the top-ranked teams. Deliberately NOT every team/event:
 *  a sitemap listing thousands of URLs would invite crawlers to fan out across
 *  pages that each cost live FIRST API calls. Convex being down just yields the
 *  static entries rather than failing the build. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/rankings`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];

  try {
    const { rows } = await queryRankings(CURRENT_SEASON, {
      sort: "epa",
      dir: "desc",
      region: null,
      page: 1,
      pageSize: 100,
    });
    return [
      ...staticRoutes,
      ...rows.map((t) => ({
        url: `${SITE_URL}/teams/${t.number}`,
        lastModified: now,
        changeFrequency: "daily" as const,
        priority: 0.6,
      })),
    ];
  } catch {
    return staticRoutes;
  }
}
