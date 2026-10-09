import type { APIGatewayProxyEventV2 } from "aws-lambda";

const MAX_BODY_BYTES = 64 * 1024;

/** The parts of an API Gateway HTTP API event the intake reads. */
export type IntakeEvent = Pick<APIGatewayProxyEventV2, "body" | "headers" | "isBase64Encoded">;

export type ParsedRequest = {
    values: Record<string, string>;
    wantsJson: boolean;
};

const decodeBody = (event: IntakeEvent): string => {
    if (event.body === undefined) {
        return "";
    }

    return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
};

const stringValues = (input: unknown): Record<string, string> | null => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return null;
    }

    const values: Record<string, string> = {};

    for (const [key, value] of Object.entries(input)) {
        if (typeof value === "string") {
            values[key] = value;
        }
    }

    return values;
};

const parseJson = (body: string): unknown => {
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
};

/**
 * Reads a submission posted either as JSON by the form script or as a native form post when
 * JavaScript is off. Returns null for anything else, including bodies too large to be a real form.
 */
export const parseRequest = (event: IntakeEvent): ParsedRequest | null => {
    const body = decodeBody(event);

    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        return null;
    }

    const contentType = event.headers["content-type"] ?? "";
    const wantsJson = (event.headers.accept ?? "").includes("application/json");

    if (contentType.startsWith("application/json")) {
        const values = stringValues(parseJson(body));
        return values === null ? null : { values, wantsJson };
    }

    if (contentType.startsWith("application/x-www-form-urlencoded")) {
        return { values: Object.fromEntries(new URLSearchParams(body)), wantsJson };
    }

    return null;
};
