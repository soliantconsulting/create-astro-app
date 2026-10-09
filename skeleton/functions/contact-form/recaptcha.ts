import { z } from "zod";

export type RecaptchaVerdict =
    | { kind: "pass"; score: number }
    | { kind: "reject"; reason: string }
    | { kind: "missing-token" }
    | { kind: "unavailable"; reason: string }
    | { kind: "unconfigured" };

export type RecaptchaCheck = {
    secret: string | null;
    token: string;
    expectedAction: string;
    allowedHostnames: string[];
    minScore: number;
};

const SITEVERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const TIMEOUT_MILLISECONDS = 3000;

// Codes that mean our request or our secret is wrong, not that the visitor is a bot.
const verifierFaultCodes = new Set(["missing-input-secret", "invalid-input-secret", "bad-request"]);

const siteverifyResponseSchema = z.object({
    success: z.boolean(),
    score: z.number().optional(),
    action: z.string().optional(),
    hostname: z.string().optional(),
    "error-codes": z.array(z.string()).optional(),
});

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");

/**
 * Checks a reCAPTCHA v3 token: success, action, hostname and score must all hold.
 *
 * Without the action check a token minted for any other form on the site is accepted; without the
 * hostname check a token minted on any domain registered to the same key is. A failed check is a
 * "reject". A check that could not be made at all (Google unreachable, our secret wrong) is
 * "unavailable", which the caller treats differently.
 */
export const verifyRecaptcha = async (
    check: RecaptchaCheck,
    fetchImplementation: typeof fetch = fetch,
): Promise<RecaptchaVerdict> => {
    if (check.secret === null) {
        return { kind: "unconfigured" };
    }

    if (check.token === "") {
        return { kind: "missing-token" };
    }

    let response: Response;

    try {
        response = await fetchImplementation(SITEVERIFY_URL, {
            method: "POST",
            body: new URLSearchParams({ secret: check.secret, response: check.token }),
            signal: AbortSignal.timeout(TIMEOUT_MILLISECONDS),
        });
    } catch (error) {
        return { kind: "unavailable", reason: errorName(error) };
    }

    if (!response.ok) {
        return { kind: "unavailable", reason: `siteverify answered HTTP ${response.status}` };
    }

    const parsed = siteverifyResponseSchema.safeParse(await response.json().catch(() => null));

    if (!parsed.success) {
        return { kind: "unavailable", reason: "siteverify returned an unexpected body" };
    }

    const result = parsed.data;
    const errorCodes = result["error-codes"] ?? [];

    if (errorCodes.some((code) => verifierFaultCodes.has(code))) {
        return { kind: "unavailable", reason: `siteverify rejected our request: ${errorCodes}` };
    }

    if (!result.success) {
        return { kind: "reject", reason: `token rejected: ${errorCodes.join(", ")}` };
    }

    if (result.action !== check.expectedAction) {
        return {
            kind: "reject",
            reason: `action "${result.action}" is not "${check.expectedAction}"`,
        };
    }

    if (result.hostname === undefined || !check.allowedHostnames.includes(result.hostname)) {
        return { kind: "reject", reason: `hostname "${result.hostname}" is not allowed` };
    }

    const score = result.score ?? 0;

    if (score < check.minScore) {
        return { kind: "reject", reason: `score ${score} is below ${check.minScore}` };
    }

    return { kind: "pass", score };
};
