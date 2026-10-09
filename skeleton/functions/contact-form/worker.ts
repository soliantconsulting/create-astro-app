import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import type { SQSBatchItemFailure } from "aws-lambda/trigger/sqs.js";
import { match } from "ts-pattern";
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

type RecordOutcome = "sent" | "retry";

const parseBody = (body: string): unknown => {
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
};

const reportSendFailure = (
    error: unknown,
    receiveCount: number,
    dependencies: WorkerDependencies,
): void => {
    match(classifySendError(error))
        .with("permanent", () => {
            console.error(
                "SES rejected a contact form email; it will reach the dead letter queue",
                {
                    error,
                },
            );
            dependencies.report(error, "error");
        })
        .with("configuration", () => {
            console.error("SES configuration blocks sending, keeping the message", { error });
            dependencies.report(error, "fatal");
        })
        .with("transient", () => {
            if (receiveCount >= dependencies.maxReceiveCount) {
                console.error("Contact form email failed its last attempt", { error });
                dependencies.report(error, "error");
                return;
            }

            console.warn("Contact form email failed, will retry", { error, receiveCount });
        })
        .exhaustive();
};

const processRecord = async (
    record: SQSRecord,
    dependencies: WorkerDependencies,
): Promise<RecordOutcome> => {
    const parsed = contactMessageSchema.safeParse(parseBody(record.body));

    if (!parsed.success) {
        console.error("Unreadable contact form message; it will reach the dead letter queue", {
            messageId: record.messageId,
            error: parsed.error,
        });
        dependencies.report(parsed.error, "error");
        return "retry";
    }

    try {
        await dependencies.send({
            ...renderEmail(parsed.data, dependencies.emailContext),
            replyTo: parsed.data.replyTo,
        });
    } catch (error) {
        const receiveCount = Number.parseInt(record.attributes.ApproximateReceiveCount, 10);
        reportSendFailure(error, receiveCount, dependencies);
        return "retry";
    }

    console.info("Contact form email sent", { formId: parsed.data.formId });
    return "sent";
};

/**
 * Sends one queued contact form submission per record.
 *
 * A message is only acknowledged once its email is sent. Every failure, including ones that will
 * never succeed, is returned as a batch item failure: the queue retries it and then moves it to the
 * dead letter queue, which keeps it for 14 days and raises an alarm. Nothing a visitor submitted is
 * deleted unsent. The error class only decides how loudly the failure is reported.
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
