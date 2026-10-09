import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifySendError } from "../../../functions/contact-form/send-error.js";

const sesError = (name: string): Error => Object.assign(new Error(name), { name });

describe("classifySendError", () => {
    // Every SESv2 SendEmail error name is listed, because a misfiled one either retries forever or
    // silently drops a message, and both look like a working worker.
    const expectations = [
        ["MessageRejected", "permanent"],
        ["BadRequestException", "permanent"],
        ["NotFoundException", "permanent"],
        ["LimitExceededException", "permanent"],
        ["MailFromDomainNotVerifiedException", "configuration"],
        ["SendingPausedException", "configuration"],
        ["AccountSuspendedException", "configuration"],
        ["TooManyRequestsException", "transient"],
        ["InternalServiceError", "transient"],
        ["TimeoutError", "transient"],
    ] as const;

    for (const [name, expected] of expectations) {
        it(`files ${name} as ${expected}`, () => {
            assert.equal(classifySendError(sesError(name)), expected);
        });
    }

    it("files a non-Error throw as transient", () => {
        assert.equal(classifySendError("boom"), "transient");
    });
});
