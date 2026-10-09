import type { APIRoute } from "astro";

/**
 * Only the production build may be crawled. Staging serves the same pages on another host, and an
 * indexed staging copy competes with the real site in search results.
 */
export const GET: APIRoute = ({ site, url }) => {
    const body =
        import.meta.env.PUBLIC_ALLOW_INDEXING === "true"
            ? `User-agent: *\nAllow: /\n\nSitemap: ${new URL("/sitemap.xml", site ?? url).href}\n`
            : "User-agent: *\nDisallow: /\n";

    return new Response(body, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
};
