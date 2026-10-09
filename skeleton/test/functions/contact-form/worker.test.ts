import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SQSEvent, SQSRecord } from "aws-lambda";
import type { ContactMessage } from "../../../functions/contact-form/message.js";
import type { ReportLevel } from "../../../functions/contact-form/report.js";
import { createWorkerHandler, type OutgoingEmail } from "../../../functions/contact-form/worker.js";

const message: ContactMessage = {
    formId: "contact",
    subject: "Website contact form",
    replyTo: "jane@example.com",
    fields: [
        { label: "Name", value: "Jane Doe" },
        { label: "Message", value: "Hello" },
    ],
    submittedAt: "2026-10-09T15:00:00Z",
    flags: [],
};

const record = (body: string, receiveCount: number): SQSRecord => ({
    messageId: `message-${receiveCount}`,
    receiptHandle: "handle",
    body,
    attributes: {
        ApproximateReceiveCount: String(receiveCount),
        SentTimestamp: "0",
        SenderId: "sender",
        ApproximateFirstReceiveTimestamp: "0",
    },
    messageAttributes: {},
    md5OfBody: "",
    eventSource: "aws:sqs",
    eventSourceARN: "arn:aws:sqs:us-east-1:123456789012:contact",
    awsRegion: "us-east-1",
});

const event = (...records: SQSRecord[]): SQSEvent => ({ Records: records });

const sesError = (name: string): Error => Object.assign(new Error(name), { name });

type Harness = {
    handler: ReturnType<typeof createWorkerHandler>;
    sent: OutgoingEmail[];
    reports: ReportLevel[];
};

const createHarness = (failure: Error | null): Harness => {
    const sent: OutgoingEmail[] = [];
    const reports: ReportLevel[] = [];

    const handler = createWorkerHandler({
        send: async (email) => {
            if (failure !== null) {
                throw failure;
            }

            sent.push(email);
        },
        report: (_error, level) => {
            reports.push(level);
        },
        emailContext: { siteName: "Example", timeZone: "America/Chicago" },
        maxReceiveCount: 5,
    });

    return { handler, sent, reports };
};

describe("createWorkerHandler", () => {
    it("sends the email and acknowledges the message", async () => {
        const harness = createHarness(null);
        const result = await harness.handler(event(record(JSON.stringify(message), 1)));

        assert.deepEqual(result.batchItemFailures, []);
        assert.equal(harness.sent.length, 1);
        assert.equal(harness.sent[0]?.replyTo, "jane@example.com");
        assert.equal(harness.sent[0]?.subject, "Website contact form");
    });

    it("acknowledges and reports an unreadable message", async () => {
        const harness = createHarness(null);
        const result = await harness.handler(event(record("{not json", 1)));

        assert.deepEqual(result.batchItemFailures, []);
        assert.deepEqual(harness.reports, ["warning"]);
    });

    it("acknowledges and reports a permanent rejection", async () => {
        const harness = createHarness(sesError("MessageRejected"));
        const result = await harness.handler(event(record(JSON.stringify(message), 1)));

        assert.deepEqual(result.batchItemFailures, []);
        assert.deepEqual(harness.reports, ["error"]);
    });

    it("retries a transient failure without reporting it", async () => {
        const harness = createHarness(sesError("TooManyRequestsException"));
        const result = await harness.handler(event(record(JSON.stringify(message), 2)));

        assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "message-2" }]);
        assert.deepEqual(harness.reports, []);
    });

    it("reports a transient failure on its last attempt", async () => {
        const harness = createHarness(sesError("TooManyRequestsException"));
        const result = await harness.handler(event(record(JSON.stringify(message), 5)));

        assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "message-5" }]);
        assert.deepEqual(harness.reports, ["error"]);
    });

    it("keeps the message and reports a configuration failure", async () => {
        const harness = createHarness(sesError("MailFromDomainNotVerifiedException"));
        const result = await harness.handler(event(record(JSON.stringify(message), 1)));

        assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "message-1" }]);
        assert.deepEqual(harness.reports, ["fatal"]);
    });
});
