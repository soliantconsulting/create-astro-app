import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import type { SQSBatchItemFailure } from "aws-lambda/trigger/sqs.js";
import { type EmailContext, type RenderedEmail, renderEmail } from "./email.js";
import { contactMessageSchema } from "./message.js";
import type { ReportError } from "./report.js";
import { classifySendError } from "./send-error.js";

export type OutgoingEmail = RenderedEmail & {
    replyTo: string | null;
};

export type WorkerDependencies = {
    send: (email: OutgoingEmail) => Promise<void>;
    report: ReportError;
    emailContext: EmailContext;
    maxReceiveCount: number;
};

type RecordOutcome = "done" | "retry";

const parseBody = (body: string): unknown => {
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
};

const handleSendFailure = (
    error: unknown,
    receiveCount: number,
    dependencies: WorkerDependencies,
): RecordOutcome => {
    const errorClass = classifySendError(error);

    if (errorClass === "permanent") {
        console.error("SES permanently rejected a contact form email", { error });
        dependencies.report(error, "error");
        return "done";
    }

    if (errorClass === "configuration") {
        console.error("SES configuration blocks sending, keeping the message", { error });
        dependencies.report(error, "fatal");
        return "retry";
    }

    if (receiveCount >= dependencies.maxReceiveCount) {
        console.error("Contact form email failed its last attempt", { error });
        dependencies.report(error, "error");
        return "retry";
    }

    console.warn("Contact form email failed, will retry", { error, receiveCount });
    return "retry";
};

const processRecord = async (
    record: SQSRecord,
    dependencies: WorkerDependencies,
): Promise<RecordOutcome> => {
    const parsed = contactMessageSchema.safeParse(parseBody(record.body));

    if (!parsed.success) {
        console.warn("Discarded an unreadable contact form message", {
            messageId: record.messageId,
            error: parsed.error,
        });
        dependencies.report(parsed.error, "warning");
        return "done";
    }

    try {
        await dependencies.send({
            ...renderEmail(parsed.data, dependencies.emailContext),
            replyTo: parsed.data.replyTo,
        });
    } catch (error) {
        const receiveCount = Number.parseInt(record.attributes.ApproximateReceiveCount, 10);
        return handleSendFailure(error, receiveCount, dependencies);
    }

    console.info("Contact form email sent", { formId: parsed.data.formId });
    return "done";
};

/**
 * Sends one queued contact form submission per record.
 *
 * Returns the failed records instead of throwing, so only those are retried. A permanent SES
 * rejection is acknowledged and reported: retrying cannot help and the message would never reach
 * the dead letter queue's alarm. A transient failure is reported only on its last attempt, since
 * the queue retries it on its own.
 */
export const createWorkerHandler =
    (dependencies: WorkerDependencies) =>
    async (event: SQSEvent): Promise<SQSBatchResponse> => {
        const batchItemFailures: SQSBatchItemFailure[] = [];

        for (const record of event.Records) {
            if ((await processRecord(record, dependencies)) === "retry") {
                batchItemFailures.push({ itemIdentifier: record.messageId });
            }
        }

        return { batchItemFailures };
    };
