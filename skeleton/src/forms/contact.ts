/**
 * One definition of the contact form's shape, imported by the page that renders it and by the
 * Lambda that receives it. Two copies of a field list drift, and the drift shows up as a field
 * the visitor filled in that never reaches the inbox.
 */

export type ContactField = {
    name: string;
    label: string;
    type: "text" | "email" | "tel" | "textarea";
    required: boolean;
    autocomplete?: string;
};

export const contactFields: ContactField[] = [
    { name: "name", label: "Name", type: "text", required: true, autocomplete: "name" },
    { name: "email", label: "Email", type: "email", required: true, autocomplete: "email" },
    { name: "phone", label: "Phone", type: "tel", required: false, autocomplete: "tel" },
    { name: "message", label: "Message", type: "textarea", required: true },
];

/** Minimum time a genuine visitor takes to fill the form. Faster than this is automation. */
export const MIN_FILL_MILLISECONDS = 3000;

/** Field a bot fills and a person never sees. A value here means discard silently. */
export const HONEYPOT_FIELD = "company-website";
