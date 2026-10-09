import * as Sentry from "@sentry/aws-serverless";
import type { ReportError } from "./report.js";

const dsn = process.env.SENTRY_DSN ?? "";

if (dsn !== "") {
    Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENVIRONMENT,
        release: process.env.SENTRY_RELEASE,
        tracesSampleRate: 0,
    });
}

export const reportError: ReportError = (error, level) => {
    Sentry.captureException(error, { level });
};

/** Flushes buffered events before Lambda freezes the environment, on success and on failure. */
export const wrapHandler = Sentry.wrapHandler;
