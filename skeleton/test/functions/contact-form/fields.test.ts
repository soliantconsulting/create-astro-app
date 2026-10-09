import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildFieldsSchema,
    type FieldErrors,
    fieldErrors,
} from "../../../functions/contact-form/fields.js";
import type { ContactFormDefinition } from "../../../src/forms/contact-forms.js";

const form: ContactFormDefinition = {
    id: "test",
    subject: "Test form",
    successPath: "/thank-you/",
    fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "email", label: "Email", type: "email", required: true },
        { name: "phone", label: "Phone", type: "tel", required: false },
        { name: "message", label: "Message", type: "textarea", required: true, maxLength: 20 },
    ],
};

const schema = buildFieldsSchema(form);

const errorsFor = (input: Record<string, string>): FieldErrors => {
    const result = schema.safeParse(input);
    assert.ok(!result.success, "expected the submission to be rejected");
    return fieldErrors(result.error);
};

describe("buildFieldsSchema", () => {
    it("accepts a complete submission and trims values", () => {
        const result = schema.parse({
            name: "  Jane Doe ",
            email: "jane@example.com",
            phone: "(818) 555-0100",
            message: "Hello",
        });

        assert.deepEqual(result, {
            name: "Jane Doe",
            email: "jane@example.com",
            phone: "(818) 555-0100",
            message: "Hello",
        });
    });

    it("leaves a blank optional field undefined", () => {
        const result = schema.parse({
            name: "Jane",
            email: "jane@example.com",
            phone: "   ",
            message: "Hello",
        });

        assert.equal(result.phone, undefined);
    });

    it("reports one message per invalid field", () => {
        const errors = errorsFor({ name: "", email: "not-an-email", message: "x".repeat(21) });

        assert.deepEqual(Object.keys(errors).sort(), ["email", "message", "name"]);
    });

    it("rejects a missing required field", () => {
        assert.equal(
            errorsFor({ email: "jane@example.com", message: "Hello" }).name,
            "Enter your name",
        );
    });

    it("rejects letters in a phone number", () => {
        const errors = errorsFor({
            name: "Jane",
            email: "jane@example.com",
            phone: "call me",
            message: "Hello",
        });

        assert.notEqual(errors.phone, undefined);
    });

    // Whitespace runs ending in a character the pattern refuses are the classic way to make a
    // regular expression backtrack for seconds; an anonymous POST can send one before any spam check.
    it("rejects adversarial phone input without stalling", () => {
        const started = performance.now();
        const oversized = errorsFor({
            name: "Jane",
            email: "jane@example.com",
            phone: `1${" ".repeat(65_000)}!`,
            message: "Hello",
        });
        const withinLength = errorsFor({
            name: "Jane",
            email: "jane@example.com",
            phone: `1${" ".repeat(150)}!`,
            message: "Hello",
        });

        assert.ok(performance.now() - started < 1000);
        assert.equal(oversized.phone, "Phone must be 200 characters or fewer");
        assert.equal(withinLength.phone, "Enter a valid phone");
    });

    it("drops keys the form does not define", () => {
        const result = schema.parse({
            name: "Jane",
            email: "jane@example.com",
            message: "Hello",
            recaptchaToken: "token",
        });

        assert.equal("recaptchaToken" in result, false);
    });
});
