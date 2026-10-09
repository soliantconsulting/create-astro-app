import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type EmailContext, renderEmail } from "../../../functions/contact-form/email.js";
import type { ContactMessage } from "../../../functions/contact-form/message.js";

const message: ContactMessage = {
    formId: "contact",
    subject: "Website contact form",
    replyTo: "jane@example.com",
    fields: [
        { label: "Name", value: "<script>alert(1)</script>" },
        { label: "Message", value: "Line one\nLine two" },
    ],
    submittedAt: "2026-10-09T18:43:57Z",
    flags: [],
};

const context: EmailContext = { siteName: "Example", timeZone: "America/Los_Angeles" };

describe("renderEmail", () => {
    it("escapes submitted values in the HTML part", () => {
        const email = renderEmail(message, context);

        assert.equal(email.html.includes("<script>"), false);
        assert.ok(email.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    });

    it("keeps multi-line values on their own lines in the text part", () => {
        assert.ok(renderEmail(message, context).text.includes("Message:\nLine one\nLine two"));
    });

    it("shows the submission time in the recipients' time zone", () => {
        // ICU separates the time from AM/PM with a narrow no-break space, which \s also matches.
        const text = renderEmail(message, context).text.replace(/\s/g, " ");

        assert.ok(text.includes("Submitted Friday, October 9, 2026 at 11:43:57 AM PDT"), text);
    });

    it("prefixes the subject for every flag", () => {
        const email = renderEmail({ ...message, flags: ["spam-check-unavailable"] }, context);

        assert.equal(email.subject, "[Spam check unavailable] Website contact form");
    });
});
