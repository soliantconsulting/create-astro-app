import type { APIRoute } from "astro";
import { canonicalUrl, indexableRoutes } from "../seo/routes.js";

/**
 * Generated from the same array the pages are, rather than by a crawler plugin.
 *
 * That is the point: a sitemap produced by a separate mechanism drifts from the pages, and the
 * drift is invisible. A legacy client site audited during this starter's design shipped roughly
 * 1,762 crawlable product pages and a sitemap containing exactly one URL. Assertion A14 in
 * scripts/seo-check.ts fails the build when the counts disagree.
 */
export const GET: APIRoute = () => {
    const urls = indexableRoutes()
        .map((route) => {
            const parts = [`        <loc>${canonicalUrl(route.path)}</loc>`];

            if (route.changefreq) {
                parts.push(`        <changefreq>${route.changefreq}</changefreq>`);
            }

            if (route.priority !== undefined) {
                parts.push(`        <priority>${route.priority}</priority>`);
            }

            return `    <url>\n${parts.join("\n")}\n    </url>`;
        })
        .join("\n");

    const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

    return new Response(body, {
        headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
};
