import { Temporal } from "temporal-polyfill";
import type { ContactMessage, MessageFlag } from "./message.js";

export type RenderedEmail = {
    subject: string;
    text: string;
    html: string;
};

export type EmailContext = {
    siteName: string;
    /** IANA time zone the recipients read the submission time in, such as America/Chicago. */
    timeZone: string;
};

const flagLabels: Record<MessageFlag, string> = {
    "spam-check-unavailable": "[Spam check unavailable]",
    "spam-check-not-configured": "[Spam check not configured]",
};

const escapeHtml = (value: string): string =>
    value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");

const formatSubmittedAt = (submittedAt: string, timeZone: string): string =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "long", timeZone }).format(
        Temporal.Instant.from(submittedAt).epochMilliseconds,
    );

export const renderEmail = (message: ContactMessage, context: EmailContext): RenderedEmail => {
    const prefix = message.flags.map((flag) => `${flagLabels[flag]} `).join("");
    const heading = `New submission from the ${context.siteName} website`;
    const submitted = `Submitted ${formatSubmittedAt(message.submittedAt, context.timeZone)}`;

    const text = [
        heading,
        "",
        ...message.fields.map((field) =>
            field.value.includes("\n")
                ? `${field.label}:\n${field.value}\n`
                : `${field.label}: ${field.value}`,
        ),
        "",
        submitted,
    ].join("\n");

    const rows = message.fields
        .map(
            (field) =>
                `<tr><th align="left" valign="top" style="padding:4px 12px 4px 0">${escapeHtml(field.label)}</th>` +
                `<td style="padding:4px 0;white-space:pre-wrap">${escapeHtml(field.value)}</td></tr>`,
        )
        .join("");

    const html =
        `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:15px">` +
        `<p><strong>${escapeHtml(heading)}</strong></p>` +
        `<table cellpadding="0" cellspacing="0">${rows}</table>` +
        `<p style="color:#555555">${escapeHtml(submitted)}</p>` +
        "</body></html>";

    return { subject: `${prefix}${message.subject}`, text, html };
};
