import { createServer, type IncomingMessage } from "node:http";
import { Temporal } from "temporal-polyfill";
import { contactForms } from "../src/forms/contact-forms.js";
import { siteName } from "../src/site.js";
import { renderEmail } from "./contact-form/email.js";
import { createIntakeHandler } from "./contact-form/intake.js";
import { verifyRecaptcha } from "./contact-form/recaptcha.js";

/*
 * Runs the contact form intake locally: `pnpm dev:contact` next to `pnpm dev`, which proxies /api
 * here (see astro.config.mjs). Queued emails are printed instead of sent.
 *
 * Set RECAPTCHA_SECRET_KEY and PUBLIC_RECAPTCHA_SITE_KEY to exercise reCAPTCHA locally; the key
 * must list "localhost" as an allowed domain.
 */

const PORT = 4399;
const secret = process.env.RECAPTCHA_SECRET_KEY ?? "";

const handler = createIntakeHandler({
    forms: contactForms,
    verifyRecaptcha: (token, action) =>
        verifyRecaptcha({
            secret: secret === "" ? null : secret,
            token,
            expectedAction: action,
            allowedHostnames: ["localhost"],
            minScore: 0.5,
        }),
    enqueue: async (message) => {
        const email = renderEmail(message, {
            siteName,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        console.info(
            `\n--- Email that would be sent ---\nSubject: ${email.subject}\n\n${email.text}\n`,
        );
    },
    quarantine: async (submission) => {
        console.warn("\n--- Submission quarantined ---\n", submission);
    },
    now: () => Temporal.Now.instant(),
    report: (error, level) => {
        console.error(`Reported (${level}):`, error);
    },
});

const readBody = async (request: IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString("utf8");
};

const headerValues = (request: IncomingMessage): Record<string, string> => {
    const headers: Record<string, string> = {};

    for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === "string") {
            headers[name] = value;
        }
    }

    return headers;
};

createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/api/contact") {
        response.writeHead(404).end();
        return;
    }

    readBody(request)
        .then((body) => handler({ body, headers: headerValues(request), isBase64Encoded: false }))
        .then((result) => {
            const headers = Object.entries(result.headers ?? {}).map(
                ([name, value]): [string, string] => [name, String(value)],
            );
            response
                .writeHead(result.statusCode ?? 200, Object.fromEntries(headers))
                .end(result.body);
        })
        .catch((error: unknown) => {
            console.error(error);
            response.writeHead(500).end();
        });
}).listen(PORT, () => {
    console.info(`Contact form intake listening on http://localhost:${PORT}/api/contact`);
});
