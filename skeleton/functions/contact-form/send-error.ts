export type SendErrorClass = "permanent" | "transient" | "configuration";

// Identical input fails identically forever, so retrying only delays the alert.
const permanentErrors = new Set([
    "MessageRejected",
    "BadRequestException",
    "NotFoundException",
    "LimitExceededException",
]);

// Fails until someone fixes the account or the sending domain, then heals without a code change.
const configurationErrors = new Set([
    "MailFromDomainNotVerifiedException",
    "SendingPausedException",
    "AccountSuspendedException",
]);

/**
 * Sorts an SES SendEmail failure by what the queue should do with the message.
 *
 * Keys on the SDK exception name: SES errors from the AWS SDK carry no SMTP response code, and
 * `$retryable` is unset on many network and 5xx failures. Anything unrecognized is transient.
 */
export const classifySendError = (error: unknown): SendErrorClass => {
    const name = error instanceof Error ? error.name : "";

    if (permanentErrors.has(name)) {
        return "permanent";
    }

    if (configurationErrors.has(name)) {
        return "configuration";
    }

    return "transient";
};
