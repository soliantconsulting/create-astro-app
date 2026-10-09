import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Temporal } from "temporal-polyfill";
import {
    createIntakeHandler,
    type IntakeDependencies,
    type QuarantinedSubmission,
} from "../../../functions/contact-form/intake.js";
import type { ContactMessage } from "../../../functions/contact-form/message.js";
import type { RecaptchaVerdict } from "../../../functions/contact-form/recaptcha.js";
import { type ContactFormDefinition, HONEYPOT_FIELD } from "../../../src/forms/contact-forms.js";

// A fixture rather than the site's own forms, so editing src/forms/contact-forms.ts for a client
// does not change what these tests exercise.
const testForm: ContactFormDefinition = {
    id: "contact",
    subject: "Website contact form",
    successPath: "/thank-you/",
    fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "email", label: "Email", type: "email", required: true },
        { name: "phone", label: "Phone", type: "tel", required: false },
        { name: "message", label: "Message", type: "textarea", required: true },
    ],
};

type Harness = {
    handler: ReturnType<typeof createIntakeHandler>;
    queued: ContactMessage[];
    quarantined: QuarantinedSubmission[];
    actions: string[];
};

const createHarness = (
    verdict: RecaptchaVerdict,
    overrides: Partial<IntakeDependencies> = {},
): Harness => {
    const queued: ContactMessage[] = [];
    const quarantined: QuarantinedSubmission[] = [];
    const actions: string[] = [];

    const handler = createIntakeHandler({
        forms: [testForm],
        verifyRecaptcha: async (_token, action) => {
            actions.push(action);
            return verdict;
        },
        enqueue: async (message) => {
            queued.push(message);
        },
        quarantine: async (submission) => {
            quarantined.push(submission);
        },
        now: () => Temporal.Instant.from("2026-10-09T15:00:00Z"),
        report: () => {
            // Reports are covered by the worker tests; nothing to assert here.
        },
        ...overrides,
    });

    return { handler, queued, quarantined, actions };
};

const validSubmission = {
    form: "contact",
    name: "Jane Doe",
    email: "jane@example.com",
    phone: "",
    message: "Hello there",
    elapsedMs: "15000",
    recaptchaToken: "token",
};

const jsonPost = (values: Record<string, string>) => ({
    body: JSON.stringify(values),
    headers: { "content-type": "application/json", accept: "application/json" },
    isBase64Encoded: false,
});

const formPost = (values: Record<string, string>) => ({
    body: new URLSearchParams(values).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
    isBase64Encoded: false,
});

describe("createIntakeHandler", () => {
    it("queues a submission that passes every check", async () => {
        const harness = createHarness({ kind: "pass", score: 0.9 });
        const result = await harness.handler(jsonPost(validSubmission));

        assert.equal(result.statusCode, 200);
        assert.deepEqual(harness.actions, ["contact_contact"]);
        assert.equal(harness.queued.length, 1);

        const [message] = harness.queued;
        assert.equal(message.replyTo, "jane@example.com");
        assert.deepEqual(message.flags, []);
        assert.deepEqual(
            message.fields.map((field) => field.label),
            ["Name", "Email", "Message"],
        );
        assert.equal(message.submittedAt, "2026-10-09T15:00:00Z");
    });

    it("redirects a native form post to the success page", async () => {
        const harness = createHarness({ kind: "pass", score: 0.9 });
        const result = await harness.handler(formPost(validSubmission));

        assert.equal(result.statusCode, 303);
        assert.equal(result.headers?.Location, "/thank-you/");
    });

    it("answers a honeypot hit like a success and keeps nothing", async () => {
        const harness = createHarness({ kind: "pass", score: 0.9 });
        const result = await harness.handler(
            jsonPost({ ...validSubmission, [HONEYPOT_FIELD]: "https://spam.example" }),
        );

        assert.equal(result.statusCode, 200);
        assert.equal(harness.queued.length, 0);
        assert.equal(harness.quarantined.length, 0);
    });

    it("returns field errors for an invalid submission", async () => {
        const harness = createHarness({ kind: "pass", score: 0.9 });
        const result = await harness.handler(jsonPost({ ...validSubmission, email: "nope" }));

        assert.equal(result.statusCode, 422);
        assert.ok(typeof result.body === "string");
        assert.ok(JSON.parse(result.body).errors.email !== undefined);
        assert.equal(harness.queued.length, 0);
    });

    it("quarantines a submission sent too quickly after page load", async () => {
        const harness = createHarness({ kind: "pass", score: 0.9 });
        const result = await harness.handler(jsonPost({ ...validSubmission, elapsedMs: "800" }));

        assert.equal(result.statusCode, 200);
        assert.equal(harness.queued.length, 0);
        assert.equal(harness.quarantined.length, 1);
        assert.deepEqual(harness.actions, []);
    });

    it("quarantines a submission reCAPTCHA rejects, answering like a success", async () => {
        const harness = createHarness({ kind: "reject", reason: "score 0.1 is below 0.5" });
        const result = await harness.handler(jsonPost(validSubmission));

        assert.equal(result.statusCode, 200);
        assert.equal(harness.queued.length, 0);
        assert.equal(harness.quarantined[0]?.reason, "score 0.1 is below 0.5");
    });

    it("asks for JavaScript when the token is missing", async () => {
        const harness = createHarness({ kind: "missing-token" });
        const result = await harness.handler(formPost({ ...validSubmission, recaptchaToken: "" }));

        assert.equal(result.statusCode, 400);
        assert.equal(harness.queued.length, 0);
    });

    it("delivers flagged when reCAPTCHA is not configured", async () => {
        const harness = createHarness({ kind: "unconfigured" });
        await harness.handler(jsonPost(validSubmission));

        assert.deepEqual(harness.queued[0]?.flags, ["spam-check-not-configured"]);
    });

    it("delivers flagged when Google cannot be reached", async () => {
        const harness = createHarness({ kind: "unavailable", reason: "TimeoutError" });
        await harness.handler(jsonPost(validSubmission));

        assert.deepEqual(harness.queued[0]?.flags, ["spam-check-unavailable"]);
    });

    it("reports an error when the queue rejects the message", async () => {
        const harness = createHarness(
            { kind: "pass", score: 0.9 },
            {
                enqueue: async () => {
                    throw new Error("queue down");
                },
            },
        );
        const result = await harness.handler(jsonPost(validSubmission));

        assert.equal(result.statusCode, 500);
    });

    it("rejects an unknown form", async () => {
        const harness = createHarness({ kind: "pass", score: 0.9 });
        const result = await harness.handler(jsonPost({ ...validSubmission, form: "unknown" }));

        assert.equal(result.statusCode, 400);
    });

    it("rejects a body that is not a form", async () => {
        const harness = createHarness({ kind: "pass", score: 0.9 });
        const result = await harness.handler({
            body: "hello",
            headers: { "content-type": "text/plain" },
            isBase64Encoded: false,
        });

        assert.equal(result.statusCode, 400);
    });
});
