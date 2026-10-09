import { z } from "zod";

export const messageFlagSchema = z.enum(["spam-check-unavailable", "spam-check-not-configured"]);
export type MessageFlag = z.output<typeof messageFlagSchema>;

/** What the intake Lambda puts on the queue and the worker turns into an email. */
export const contactMessageSchema = z.object({
    formId: z.string().min(1),
    subject: z.string().min(1),
    replyTo: z.email().nullable(),
    fields: z.array(z.object({ label: z.string(), value: z.string() })),
    submittedAt: z.iso.datetime(),
    flags: z.array(messageFlagSchema),
});

export type ContactMessage = z.output<typeof contactMessageSchema>;
