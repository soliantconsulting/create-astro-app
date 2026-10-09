import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { Temporal } from "temporal-polyfill";
import { match } from "ts-pattern";
import {
    type ContactFormDefinition,
    HONEYPOT_FIELD,
    recaptchaAction,
} from "../../src/forms/contact-forms.js";
import { buildFieldsSchema, type FieldErrors, fieldErrors } from "./fields.js";
import type { ContactMessage, MessageFlag } from "./message.js";
import type { RecaptchaVerdict } from "./recaptcha.js";
import type { ReportError } from "./report.js";
import { type IntakeEvent, parseRequest } from "./request.js";

/** Faster than this from page load to submit is automation, not a person typing. */
export const MIN_FILL_MILLISECONDS = 3000;

export type QuarantinedSubmission = {
    formId: string;
    reason: string;
    values: Record<string, string>;
    receivedAt: string;
};

export type IntakeDependencies = {
    /** The site's forms, normally `contactForms` from src/forms/contact-forms.ts. */
    forms: ContactFormDefinition[];
    verifyRecaptcha: (token: string, action: string) => Promise<RecaptchaVerdict>;
    enqueue: (message: ContactMessage) => Promise<void>;
    quarantine: (submission: QuarantinedSubmission) => Promise<void>;
    now: () => Temporal.Instant;
    report: ReportError;
};

type Outcome = "received" | "invalid" | "javascript-required" | "bad-request" | "error";

type Result = APIGatewayProxyStructuredResultV2;

const statusCodes: Record<Exclude<Outcome, "received">, number> = {
    invalid: 422,
    "javascript-required": 400,
    "bad-request": 400,
    error: 500,
};

const htmlMessages: Record<Exclude<Outcome, "received">, string> = {
    invalid: "Some fields were missing or invalid.",
    "javascript-required": "This form needs JavaScript to protect against spam.",
    "bad-request": "The form could not be read.",
    error: "We could not send your message. Please try again in a moment.",
};

const escapeHtml = (value: string): string =>
    value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");

const jsonResult = (statusCode: number, body: object): Result => ({
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});

const respond = (
    outcome: Outcome,
    wantsJson: boolean,
    form: ContactFormDefinition | null,
    errors?: FieldErrors,
): Result => {
    if (outcome === "received") {
        return wantsJson || form === null
            ? jsonResult(200, { status: outcome })
            : { statusCode: 303, headers: { Location: form.successPath }, body: "" };
    }

    if (wantsJson) {
        return jsonResult(statusCodes[outcome], { status: outcome, errors });
    }

    const message = escapeHtml(htmlMessages[outcome]);

    return {
        statusCode: statusCodes[outcome],
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Message not sent</title></head><body><h1>Message not sent</h1><p>${message}</p><p>Use your browser's Back button to return to the form.</p></body></html>`,
    };
};

const filledTooFast = (elapsed: string | undefined): boolean => {
    if (elapsed === undefined || elapsed === "") {
        return false;
    }

    const milliseconds = Number(elapsed);
    return !Number.isFinite(milliseconds) || milliseconds < MIN_FILL_MILLISECONDS;
};

const buildMessage = (
    form: ContactFormDefinition,
    values: Record<string, string | undefined>,
    submittedAt: Temporal.Instant,
    flags: MessageFlag[],
): ContactMessage => {
    const replyField = form.fields.find((field) => field.type === "email");

    return {
        formId: form.id,
        subject: form.subject,
        replyTo: replyField === undefined ? null : (values[replyField.name] ?? null),
        fields: form.fields.flatMap((field) => {
            const value = values[field.name];
            return value === undefined ? [] : [{ label: field.label, value }];
        }),
        submittedAt: submittedAt.toString(),
        flags,
    };
};

/**
 * Validates a contact form submission and queues it for delivery.
 *
 * Anything that looks automated gets the same answer as a real submission, so the endpoint cannot
 * be probed to learn which check failed. Honeypot hits are dropped; everything else that fails a
 * spam check is written to quarantine so a misjudged real message can still be recovered.
 */
export const createIntakeHandler =
    (dependencies: IntakeDependencies) =>
    async (event: IntakeEvent): Promise<Result> => {
        const request = parseRequest(event);

        if (request === null) {
            return respond("bad-request", false, null);
        }

        const { values, wantsJson } = request;
        const form = dependencies.forms.find((candidate) => candidate.id === values.form);

        if (form === undefined) {
            return respond("bad-request", wantsJson, null);
        }

        if ((values[HONEYPOT_FIELD] ?? "") !== "") {
            console.info("Discarded a submission that filled the honeypot", { formId: form.id });
            return respond("received", wantsJson, form);
        }

        const parsed = buildFieldsSchema(form).safeParse(values);

        if (!parsed.success) {
            return respond("invalid", wantsJson, form, fieldErrors(parsed.error));
        }

        const receivedAt = dependencies.now();

        const quarantine = async (reason: string): Promise<Result> => {
            console.warn("Quarantined a contact form submission", { formId: form.id, reason });

            try {
                await dependencies.quarantine({
                    formId: form.id,
                    reason,
                    values,
                    receivedAt: receivedAt.toString(),
                });
            } catch (error) {
                console.error("Failed to write a submission to quarantine", { error });
            }

            return respond("received", wantsJson, form);
        };

        const deliver = async (flags: MessageFlag[]): Promise<Result> => {
            try {
                await dependencies.enqueue(buildMessage(form, parsed.data, receivedAt, flags));
            } catch (error) {
                console.error("Failed to queue a contact form submission", { error });
                dependencies.report(error, "error");
                return respond("error", wantsJson, form);
            }

            return respond("received", wantsJson, form);
        };

        if (filledTooFast(values.elapsedMs)) {
            return quarantine(`submitted ${values.elapsedMs} ms after the page loaded`);
        }

        const verdict = await dependencies.verifyRecaptcha(
            values.recaptchaToken ?? "",
            recaptchaAction(form),
        );

        return match(verdict)
            .with({ kind: "pass" }, () => deliver([]))
            .with({ kind: "reject" }, ({ reason }) => quarantine(reason))
            .with({ kind: "missing-token" }, async () => {
                console.warn("Rejected a submission without a reCAPTCHA token", {
                    formId: form.id,
                });
                return respond("javascript-required", wantsJson, form);
            })
            .with({ kind: "unconfigured" }, () => deliver(["spam-check-not-configured"]))
            .with({ kind: "unavailable" }, ({ reason }) => {
                console.error("reCAPTCHA verification unavailable, delivering flagged", { reason });
                dependencies.report(
                    new Error(`reCAPTCHA verification unavailable: ${reason}`),
                    "warning",
                );
                return deliver(["spam-check-unavailable"]);
            })
            .exhaustive();
    };
