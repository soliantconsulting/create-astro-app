#!/usr/bin/env tsx
/**
 * Build-breaking assertions over dist/.
 *
 * Every check here exists because the failure it catches is invisible to a screenshot, a
 * typecheck and a code review. A duplicate title, a sitemap that lists one URL while the site has
 * hundreds, a class that compiles to no rule, a button that never leaves full width: all of them
 * ship green and are found later by someone else.
 *
 * Run automatically as part of `pnpm build`, so a failure aborts the build before the CDK bundling
 * step can pick the output up.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { indexableRoutes, routes, SITE_URL } from "../src/seo/routes.js";

const DIST = new URL("../dist/", import.meta.url).pathname;
const PAGES_SRC = new URL("../src/pages/", import.meta.url).pathname;
const CSS_BUDGET_BYTES = 70_000;
/*
 * Markers a developer is meant to replace, not plausible real copy.
 *
 * Keep this list to unambiguous leftovers. A scaffolded project must build green on its first
 * pipeline run, because that run is what proves the deployment works, so the scaffold ships real
 * sentences rather than text that trips this check.
 */
const PLACEHOLDER_FRAGMENTS = ["Replace this", "Lorem ipsum", "TODO", "CHANGE-ME"];

type Failure = { assertion: string; detail: string };

const failures: Failure[] = [];
const fail = (assertion: string, detail: string): void => {
    failures.push({ assertion, detail });
};

const walk = (dir: string, predicate: (path: string) => boolean): string[] => {
    const found: string[] = [];

    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);

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

const htmlFiles = walk(DIST, (path) => path.endsWith(".html"));
const cssFiles = walk(DIST, (path) => path.endsWith(".css"));

if (htmlFiles.length === 0) {
    fail("A0 build output", "dist/ contains no HTML files. The build produced nothing to check.");
}

const pageOf = (file: string): string => `/${relative(DIST, file).split(sep).join("/")}`;

const textBetween = (html: string, pattern: RegExp): string | null => {
    const match = html.match(pattern);
    return match ? match[1].trim() : null;
};

const titles = new Map<string, string[]>();
const descriptions = new Map<string, string[]>();

for (const file of htmlFiles) {
    const page = pageOf(file);
    const html = readFileSync(file, "utf-8");
    const is404 = page === "/404.html";

    const title = textBetween(html, /<title>([\s\S]*?)<\/title>/i);
    const description = textBetween(html, /<meta\s+name="description"\s+content="([^"]*)"/i);
    const canonical = textBetween(html, /<link\s+rel="canonical"\s+href="([^"]*)"/i);
    const noindex = /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html);

    // A1 every page has a title
    if (!title) {
        fail("A1 title present", `${page} has no <title>.`);
    } else {
        titles.set(title, [...(titles.get(title) ?? []), page]);
    }

    // A2 no scaffold marker survived into a build, in either the title or the description
    for (const [field, value] of [
        ["title", title],
        ["description", description],
    ] as const) {
        if (!value) {
            continue;
        }

        for (const fragment of PLACEHOLDER_FRAGMENTS) {
            if (value.includes(fragment)) {
                fail(
                    "A2 no placeholder copy",
                    `${page} ${field} still contains the scaffold marker "${fragment}": "${value}".`,
                );
            }
        }
    }

    if (is404) {
        // A6 the 404 page is real, styled and noindexed. Its existence is what lets the
        // distribution return a true 404 instead of rewriting to the homepage at HTTP 200.
        if (!/<h1[^>]*>/i.test(html)) {
            fail("A6 real 404 page", "404.html has no <h1>.");
        }

        if (!noindex) {
            fail("A6 real 404 page", "404.html is missing a noindex robots meta tag.");
        }

        continue;
    }

    // A3 every indexable page has a description
    if (!description) {
        fail("A3 description present", `${page} has no meta description.`);
    } else {
        descriptions.set(description, [...(descriptions.get(description) ?? []), page]);
    }

    // A4 self-referential canonical
    if (!canonical) {
        fail("A4 canonical present", `${page} has no canonical link.`);
    } else if (!canonical.startsWith(SITE_URL)) {
        fail(
            "A4 canonical present",
            `${page} canonical "${canonical}" does not point at the configured site origin.`,
        );
    }

    // A7 the page renders its own heading without JavaScript
    if (!/<h1[^>]*>[\s\S]*?\S[\s\S]*?<\/h1>/i.test(html)) {
        fail(
            "A7 heading without JS",
            `${page} has no non-empty <h1> in its static HTML. If the heading needs JavaScript to appear, a crawler never sees it.`,
        );
    }
}

// A1b titles are unique
for (const [title, pages] of titles) {
    if (pages.length > 1) {
        fail("A1b unique titles", `${pages.length} pages share the title "${title}": ${pages.join(", ")}.`);
    }
}

// A3b descriptions are unique
for (const [description, pages] of descriptions) {
    if (pages.length > 1) {
        fail(
            "A3b unique descriptions",
            `${pages.length} pages share the meta description "${description}": ${pages.join(", ")}.`,
        );
    }
}

// A14 the sitemap agrees with the registry
const sitemapPath = join(DIST, "sitemap.xml");
try {
    const sitemap = readFileSync(sitemapPath, "utf-8");
    const locCount = (sitemap.match(/<loc>/g) ?? []).length;
    const expected = indexableRoutes().length;

    if (locCount !== expected) {
        fail(
            "A14 sitemap completeness",
            `sitemap.xml lists ${locCount} URLs but the registry has ${expected} indexable routes.`,
        );
    }
} catch {
    fail("A14 sitemap completeness", "dist/sitemap.xml was not generated.");
}

/*
 * A15 the registry and the built pages agree, in both directions.
 *
 * A route registered but never built puts a URL in the sitemap that answers 404. A page built but
 * never registered has no title, no description and no sitemap entry. Both fail silently: the
 * build is green, the sitemap looks populated, and the problem surfaces weeks later in Search
 * Console.
 */
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
            `Route "${route.path}" is registered and indexable but no page was built for it. It would appear in the sitemap and answer 404.`,
        );
    }
}

for (const path of builtPaths) {
    if (!routes.some((route) => route.path === path)) {
        fail(
            "A15 registry matches build",
            `Page "${path}" was built but is not registered in src/seo/routes.ts, so it has no title, description or sitemap entry.`,
        );
    }
}

// A19 CSS weight budget
const cssBytes = cssFiles.reduce((total, file) => total + statSync(file).size, 0);

if (cssBytes > CSS_BUDGET_BYTES) {
    fail(
        "A19 CSS budget",
        `Emitted CSS is ${cssBytes} bytes, over the ${CSS_BUDGET_BYTES} byte budget. Raise the budget deliberately or find what pulled it up.`,
    );
}

// A17 no phantom utilities. The closed palette in global.css means an off-token class produces no
// rule at all rather than an error, so the page silently renders unstyled.
const cssText = cssFiles.map((file) => readFileSync(file, "utf-8")).join("\n");
const escapeForSelector = (token: string): string => token.replace(/[.:/[\]%(),!#*]/g, "\\$&");
const IGNORED_CLASS_PREFIXES = ["sr-only", "not-sr-only", "astro-"];
const seenTokens = new Set<string>();

for (const file of htmlFiles) {
    const html = readFileSync(file, "utf-8");

    for (const match of html.matchAll(/\sclass="([^"]*)"/g)) {
        for (const token of match[1].split(/\s+/).filter(Boolean)) {
            if (seenTokens.has(token)) {
                continue;
            }

            seenTokens.add(token);

            if (IGNORED_CLASS_PREFIXES.some((prefix) => token.startsWith(prefix))) {
                continue;
            }

            if (!cssText.includes(`.${escapeForSelector(token)}`)) {
                fail(
                    "A17 no phantom utilities",
                    `Class "${token}" (first seen in ${pageOf(file)}) has no matching rule in the emitted CSS. Either it is a typo, or it is off the closed palette in global.css.`,
                );
            }
        }
    }
}

// A18 a full-width button must return to auto width above the phone breakpoint
for (const file of htmlFiles) {
    const html = readFileSync(file, "utf-8");

    for (const match of html.matchAll(/<a\s[^>]*class="([^"]*)"[^>]*>/g)) {
        const classes = match[1].split(/\s+/);

        if (classes.includes("inline-flex") && classes.includes("w-full")) {
            if (!classes.some((token) => token.endsWith(":w-auto"))) {
                fail(
                    "A18 button stacking",
                    `${pageOf(file)} has a full-width button that never returns to auto width at a larger breakpoint. Buttons stack block-level on phones and sit inline above that.`,
                );
            }
        }
    }
}

// A20 arbitrary values are confined to components and the stylesheet
const pageSources = walk(PAGES_SRC, (path) => path.endsWith(".astro"));

for (const file of pageSources) {
    const source = readFileSync(file, "utf-8");

    for (const match of source.matchAll(/class="([^"]*)"/g)) {
        for (const token of match[1].split(/\s+/).filter(Boolean)) {
            if (/\[[^\]]+\]/.test(token)) {
                fail(
                    "A20 no arbitrary values in pages",
                    `${relative(PAGES_SRC, file)} uses the arbitrary value "${token}". Arbitrary values belong in src/components or in the @theme block of global.css, so a one-off measurement is defined once for the whole site rather than typed into a template.`,
                );
            }
        }
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
    `seo-check passed: ${htmlFiles.length} page(s), ${cssBytes} bytes of CSS, ${indexableRoutes().length} indexable route(s).`,
);
