import { match } from "ts-pattern";
import { z } from "zod";
import type { ContactField, ContactFormDefinition } from "../../src/forms/contact-forms.js";

const phonePattern = /^[0-9+().\s-]{7,}(\s*(x|ext\.?)\s*\d+)?$/i;

const defaultMaxLength = (field: ContactField): number => (field.type === "textarea" ? 5000 : 200);

const valueSchema = (field: ContactField): z.ZodType<string> => {
    const maxLength = field.maxLength ?? defaultMaxLength(field);
    const text = z
        .string()
        .trim()
        .min(1, `Enter your ${field.label.toLowerCase()}`)
        .max(maxLength, `${field.label} must be ${maxLength} characters or fewer`);

    return match(field.type)
        .with("email", () => text.pipe(z.email(`Enter a valid ${field.label.toLowerCase()}`)))
        .with("tel", () => text.regex(phonePattern, `Enter a valid ${field.label.toLowerCase()}`))
        .with("text", "textarea", () => text)
        .exhaustive();
};

const isBlank = (value: unknown): boolean => typeof value !== "string" || value.trim() === "";

const fieldSchema = (field: ContactField): z.ZodType<string | undefined> =>
    field.required
        ? z.preprocess((value) => value ?? "", valueSchema(field))
        : z.preprocess(
              (value) => (isBlank(value) ? undefined : value),
              valueSchema(field).optional(),
          );

/**
 * Validates a submission against its form definition.
 *
 * Unknown keys are dropped rather than rejected: the payload also carries the form id, the
 * honeypot, the timing value and the reCAPTCHA token, which the handler reads separately.
 */
export const buildFieldsSchema = (
    form: ContactFormDefinition,
): z.ZodType<Record<string, string | undefined>> =>
    z.object(Object.fromEntries(form.fields.map((field) => [field.name, fieldSchema(field)])));

export type FieldErrors = Record<string, string>;

export const fieldErrors = (error: z.ZodError): FieldErrors => {
    const errors: FieldErrors = {};

    for (const issue of error.issues) {
        const name = String(issue.path[0] ?? "");

        if (name !== "" && errors[name] === undefined) {
            errors[name] = issue.message;
        }
    }

    return errors;
};
