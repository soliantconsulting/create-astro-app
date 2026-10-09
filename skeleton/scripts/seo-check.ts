#!/usr/bin/env tsx
/**
 * Build-breaking assertions over dist/.
 *
 * Each check catches a failure that is invisible to a screenshot, a typecheck and a code review: a
 * duplicate title, a sitemap that disagrees with the pages, a staging copy open to crawlers. Runs
 * as part of `pnpm build`, so a failure stops the deployment before anything reaches the bucket.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { indexableRoutes, routes } from "../src/seo/routes.js";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const SITE_URL = process.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
const ALLOW_INDEXING = process.env.PUBLIC_ALLOW_INDEXING === "true";
const CSS_BUDGET_BYTES = 70_000;
const TOKENS_FILE = join(SRC, "theme", "tokens.ts");

// Markers a developer is meant to replace. Kept to unambiguous leftovers so the scaffold itself
// builds green on its first pipeline run.
const PLACEHOLDER_FRAGMENTS = ["Replace this", "Lorem ipsum", "TODO", "CHANGE-ME"];

type Failure = {
    assertion: string;
    detail: string;
};

const failures: Failure[] = [];

const fail = (assertion: string, detail: string): void => {
    failures.push({ assertion, detail });
};

const walk = (directory: string, predicate: (path: string) => boolean): string[] => {
    const found: string[] = [];

    for (const entry of readdirSync(directory)) {
        const full = join(directory, entry);

        if (statSync(full).isDirectory()) {
            found.push(...walk(full, predicate));
            continue;
        }

        if (predicate(full)) {
            found.push(full);
        }
    }

    return found;
};

const textBetween = (html: string, pattern: RegExp): string | null => {
    const match = html.match(pattern);
    return match ? match[1].trim() : null;
};

const pageOf = (file: string): string => `/${relative(DIST, file).split(sep).join("/")}`;

const htmlFiles = walk(DIST, (path) => path.endsWith(".html"));
const cssFiles = walk(DIST, (path) => path.endsWith(".css"));

if (htmlFiles.length === 0) {
    fail("A0 build output", "dist/ contains no HTML files. The build produced nothing to check.");
}

const titles = new Map<string, string[]>();
const descriptions = new Map<string, string[]>();

for (const file of htmlFiles) {
    const page = pageOf(file);
    const html = readFileSync(file, "utf-8");
    const title = textBetween(html, /<title>([\s\S]*?)<\/title>/i);
    const description = textBetween(html, /<meta\s+name="description"\s+content="([^"]*)"/i);
    const canonical = textBetween(html, /<link\s+rel="canonical"\s+href="([^"]*)"/i);
    const noindex = /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html);

    // A1 every page has a title
    if (title === null || title === "") {
        fail("A1 title present", `${page} has no <title>.`);
    } else {
        titles.set(title, [...(titles.get(title) ?? []), page]);
    }

    // A2 no scaffold marker survived into a title or description
    for (const [field, value] of [
        ["title", title],
        ["description", description],
    ] as const) {
        for (const fragment of PLACEHOLDER_FRAGMENTS) {
            if (value?.includes(fragment)) {
                fail("A2 no placeholder copy", `${page} ${field} still contains "${fragment}".`);
            }
        }
    }

    // A2b no unset environment value reached the page, in links and attributes as well as text
    if (html.includes("CHANGE-ME")) {
        fail(
            "A2b no unset configuration",
            `${page} contains "CHANGE-ME": a value in cdk/src/env-*.ts was never filled in.`,
        );
    }

    // A6 the 404 page is real and noindexed; it is what lets CloudFront answer a true 404
    if (page === "/404.html") {
        if (!/<h1[^>]*>/i.test(html)) {
            fail("A6 real 404 page", "404.html has no <h1>.");
        }

        if (!noindex) {
            fail("A6 real 404 page", "404.html is missing a noindex robots meta tag.");
        }

        continue;
    }

    // A3 every page has a description
    if (description === null || description === "") {
        fail("A3 description present", `${page} has no meta description.`);
    } else {
        descriptions.set(description, [...(descriptions.get(description) ?? []), page]);
    }

    // A4 a self-referential canonical on the configured origin
    if (canonical === null) {
        fail("A4 canonical present", `${page} has no canonical link.`);
    } else if (!canonical.startsWith(SITE_URL)) {
        fail("A4 canonical present", `${page} canonical "${canonical}" is not on ${SITE_URL}.`);
    }

    // A7 the heading is in the static HTML, so a crawler sees it without running JavaScript
    if (!/<h1[^>]*>[\s\S]*?\S[\s\S]*?<\/h1>/i.test(html)) {
        fail("A7 heading without JS", `${page} has no non-empty <h1> in its static HTML.`);
    }
}

// A1b titles are unique
for (const [title, pages] of titles) {
    if (pages.length > 1) {
        fail(
            "A1b unique titles",
            `${pages.length} pages share the title "${title}": ${pages.join(", ")}.`,
        );
    }
}

// A3b descriptions are unique
for (const [description, pages] of descriptions) {
    if (pages.length > 1) {
        fail(
            "A3b unique descriptions",
            `${pages.length} pages share the description "${description}": ${pages.join(", ")}.`,
        );
    }
}

// A14 the sitemap lists exactly the indexable routes
const readDistFile = (name: string): string | null => {
    try {
        return readFileSync(join(DIST, name), "utf-8");
    } catch {
        return null;
    }
};

const sitemap = readDistFile("sitemap.xml");

if (sitemap === null) {
    fail("A14 sitemap completeness", "dist/sitemap.xml was not generated.");
} else {
    const locCount = (sitemap.match(/<loc>/g) ?? []).length;

    if (locCount !== indexableRoutes().length) {
        fail(
            "A14 sitemap completeness",
            `sitemap.xml lists ${locCount} URLs but the registry has ${indexableRoutes().length} indexable routes.`,
        );
    }
}

// A15 the registry and the built pages agree in both directions. A registered route with no page
// puts a 404 in the sitemap; a page with no route has no title, description or sitemap entry.
const builtPaths = new Set(
    htmlFiles
        .map(pageOf)
        .filter((page) => page !== "/404.html")
        .map((page) => (page === "/index.html" ? "/" : page.replace(/index\.html$/, ""))),
);

for (const route of indexableRoutes()) {
    if (!builtPaths.has(route.path)) {
        fail(
            "A15 registry matches build",
            `Route "${route.path}" is registered but was not built.`,
        );
    }
}

for (const path of builtPaths) {
    if (!routes.some((route) => route.path === path)) {
        fail(
            "A15 registry matches build",
            `Page "${path}" was built but is not registered in src/seo/routes.ts.`,
        );
    }
}

// A21 every legacy redirect lands on a page that exists, in one hop, without hiding a real page.
// A redirect into a 404 throws away the ranking the old URL had, which is why the map exists.
const redirects: Record<string, string> = JSON.parse(
    readFileSync(new URL("../src/seo/redirects.json", import.meta.url), "utf-8"),
);
const redirectSources = new Set(Object.keys(redirects).map((from) => from.toLowerCase()));

for (const [from, to] of Object.entries(redirects)) {
    if (!from.startsWith("/")) {
        fail("A21 redirects", `Redirect source "${from}" must be a path starting with "/".`);
    }

    // The CloudFront function looks up the request path, which never carries the query string.
    if (/[?#]/.test(from)) {
        fail(
            "A21 redirects",
            `Redirect source "${from}" has a query string or fragment, so it can never match. Use the path alone.`,
        );
    }

    // CloudFront matches redirect sources case-insensitively, so compare the same way.
    if ([...builtPaths].some((path) => path.toLowerCase() === from.toLowerCase())) {
        fail("A21 redirects", `Redirect from "${from}" would hide the page built at that path.`);
    }

    if (!to.startsWith("/")) {
        continue;
    }

    const targetPath = to.split(/[?#]/)[0];

    if (redirectSources.has(targetPath.toLowerCase())) {
        fail("A21 redirects", `Redirect "${from}" -> "${to}" chains into another redirect.`);
    }

    if (!builtPaths.has(targetPath)) {
        fail("A21 redirects", `Redirect "${from}" -> "${to}" points at a page that was not built.`);
    }
}

// A16 robots.txt matches the environment: only production may be crawled
const robots = readDistFile("robots.txt") ?? "";
const disallowsAll = /^Disallow:\s*\/\s*$/m.test(robots);

if (ALLOW_INDEXING === disallowsAll) {
    fail(
        "A16 robots matches environment",
        ALLOW_INDEXING
            ? "robots.txt blocks crawlers in a build that allows indexing."
            : "robots.txt allows crawlers in a build that is not production.",
    );
}

// A19 CSS weight budget per page: inline <style> blocks plus linked stylesheets, so the budget
// still holds when Astro inlines the CSS (build.inlineStylesheets).
const cssFileSizes = new Map(cssFiles.map((file) => [pageOf(file), statSync(file).size]));

const pageCssBytes = (html: string): number => {
    const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].reduce(
        (total, match) => total + Buffer.byteLength(match[1], "utf-8"),
        0,
    );
    const linked = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].reduce(
        (total, match) => total + (cssFileSizes.get(match[1]) ?? 0),
        0,
    );

    return inline + linked;
};

let largestCssPage = { page: "", bytes: 0 };

for (const file of htmlFiles) {
    const bytes = pageCssBytes(readFileSync(file, "utf-8"));

    if (bytes > largestCssPage.bytes) {
        largestCssPage = { page: pageOf(file), bytes };
    }
}

if (largestCssPage.bytes > CSS_BUDGET_BYTES) {
    fail(
        "A19 CSS budget",
        `${largestCssPage.page} carries ${largestCssPage.bytes} bytes of CSS, over the ${CSS_BUDGET_BYTES} byte budget. Raise it deliberately or find what pulled it up.`,
    );
}

// A22 every internal link resolves to a built page or file, so renaming a route cannot leave a
// link behind that answers 404.
const distFiles = new Set(walk(DIST, () => true).map(pageOf));

for (const file of htmlFiles) {
    const html = readFileSync(file, "utf-8");

    for (const match of html.matchAll(/\shref="(\/(?!\/)[^"]*)"/g)) {
        const target = match[1].split(/[?#]/)[0];

        // The viewer-request function serves /about as /about/index.html, so both forms work.
        if (!(builtPaths.has(target) || builtPaths.has(`${target}/`) || distFiles.has(target))) {
            fail(
                "A22 internal links resolve",
                `${pageOf(file)} links to "${match[1]}", which is neither a built page nor a file in dist/.`,
            );
        }
    }
}

// A20 colors come from src/theme/tokens.ts, so a palette change is one edit
const colorLiteral = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

const styleSources = (file: string, source: string): string[] =>
    file.endsWith(".css")
        ? [source]
        : [
              ...[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]),
              ...[...source.matchAll(/\sstyle="([^"]*)"/g)].map((match) => match[1]),
          ];

for (const file of walk(SRC, (path) => /\.(astro|css)$/.test(path) && path !== TOKENS_FILE)) {
    const source = readFileSync(file, "utf-8");

    if (styleSources(file, source).some((style) => colorLiteral.test(style))) {
        fail(
            "A20 colors from tokens",
            `${relative(SRC, file)} uses a color literal. Add the color to src/theme/tokens.ts and use its custom property.`,
        );
    }
}

if (failures.length > 0) {
    console.error(`\nseo-check failed with ${failures.length} problem(s):\n`);

    for (const failure of failures) {
        console.error(`  [${failure.assertion}] ${failure.detail}`);
    }

    console.error("");
    process.exit(1);
}

console.info(
    `seo-check passed: ${htmlFiles.length} page(s), largest page CSS ${largestCssPage.bytes} bytes, ${indexableRoutes().length} indexable route(s).`,
);
