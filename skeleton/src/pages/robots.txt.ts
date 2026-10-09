import type { APIRoute } from "astro";
import { SITE_URL } from "../seo/routes.js";

export const GET: APIRoute = () => {
    const body = `User-agent: *
Allow: /

Sitemap: ${new URL("/sitemap.xml", SITE_URL).href}
`;

    return new Response(body, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
};
