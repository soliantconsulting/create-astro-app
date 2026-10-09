export type SendErrorClass = "permanent" | "transient" | "configuration";

// Retrying the same request will not change the answer on its own. In the SES sandbox an unverified
// sender or recipient also arrives as MessageRejected, and verifying it does fix the retry, which
// is why the worker keeps these messages for the dead letter queue rather than dropping them.
const permanentErrors = new Set([
    "MessageRejected",
    "BadRequestException",
    "NotFoundException",
    "LimitExceededException",
]);

// Fails until someone fixes the account or a custom MAIL FROM domain, then heals without a code
// change.
const configurationErrors = new Set([
    "MailFromDomainNotVerifiedException",
    "SendingPausedException",
    "AccountSuspendedException",
]);

/**
 * Sorts an SES SendEmail failure by how urgently a person needs to act on it.
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
