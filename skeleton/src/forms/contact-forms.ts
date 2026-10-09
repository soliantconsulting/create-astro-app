/**
 * Every contact form on the site. ContactForm.astro renders from this list and the intake Lambda
 * validates against it, so a field cannot exist on the page without the handler knowing it.
 *
 * Keep this file free of imports: the Lambda bundles it, and the browser never loads it.
 */

export type ContactFieldType = "text" | "email" | "tel" | "textarea";

export type ContactField = {
    name: string;
    label: string;
    type: ContactFieldType;
    required: boolean;
    autocomplete?: string;
    maxLength?: number;
};

export type ContactFormDefinition = {
    /** Stable identifier, posted with every submission and used for the reCAPTCHA action. */
    id: string;
    /** Subject line of the notification email. */
    subject: string;
    /** Where a visitor lands after a successful submission. Must be a registered route. */
    successPath: string;
    fields: ContactField[];
};

export const contactForms: ContactFormDefinition[] = [
    {
        id: "contact",
        subject: "Website contact form",
        successPath: "/thank-you/",
        fields: [
            { name: "name", label: "Name", type: "text", required: true, autocomplete: "name" },
            { name: "email", label: "Email", type: "email", required: true, autocomplete: "email" },
            { name: "phone", label: "Phone", type: "tel", required: false, autocomplete: "tel" },
            { name: "message", label: "Message", type: "textarea", required: true },
        ],
    },
];

// Deliberately not a word browser autofill recognizes (company, website, url, name...): an
// autofilled honeypot would silently discard a real visitor's message.
export const HONEYPOT_FIELD = "form_trap";

export const findContactForm = (id: string): ContactFormDefinition | undefined =>
    contactForms.find((form) => form.id === id);

/** reCAPTCHA action names allow letters, digits, slashes and underscores only. */
export const recaptchaAction = (form: ContactFormDefinition): string =>
    `contact_${form.id.replace(/[^A-Za-z0-9/]/g, "_")}`;
