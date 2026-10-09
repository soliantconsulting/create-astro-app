import type { APIRoute } from "astro";
import { canonicalUrl, indexableRoutes } from "../seo/routes.js";

/**
 * Built from the same registry as the pages rather than by a crawler plugin, so the two cannot
 * drift. Assertion A14 in scripts/seo-check.ts fails the build when the counts disagree.
 */
export const GET: APIRoute = ({ site, url }) => {
    const origin = site ?? url;
    const entries = indexableRoutes()
        .map((route) => {
            const parts = [`        <loc>${canonicalUrl(route.path, origin)}</loc>`];

            if (route.changefreq !== undefined) {
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
${entries}
</urlset>
`;

    return new Response(body, {
        headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
};
