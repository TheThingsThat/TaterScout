import type { MetadataRoute } from "next";

/** Public stats pages are the point of the site, so let crawlers in — but keep
 *  them out of the scouting app (private, auth-gated) and the API routes, which
 *  cost credentialed FIRST calls per request. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/scout", "/scout/", "/api/"],
    },
    sitemap: "https://taterscout.org/sitemap.xml",
  };
}
