import type { MetadataRoute } from "next";
import { pastSeasons } from "@/lib/season";

// Bulk crawlers for AI training and answers. Each full walk of the site spends
// real database quota and brings no visitors.
const AI_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "PerplexityBot",
  "Bytespider",
  "Amazonbot",
  "meta-externalagent",
  "cohere-ai",
];

/** Public stats pages are the point of the site, so let crawlers in — but keep
 *  them out of the scouting app (private, auth-gated), the API routes (which cost
 *  credentialed FIRST calls per request), the thousands of sorted, filtered and
 *  paged /rankings and /events URLs, and past seasons. Only polite bots honor this; the rest need
 *  Vercel's firewall. Don't block `?season=*`: it also matches current-season links. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/scout",
          "/scout/",
          "/api/",
          "/rankings?",
          "/events?",
          ...pastSeasons().flatMap((s) => [`/events/${s}/`, `/teams/*?season=${s}`]),
        ],
      },
      { userAgent: AI_BOTS, disallow: "/" },
    ],
    sitemap: "https://taterscout.org/sitemap.xml",
  };
}
