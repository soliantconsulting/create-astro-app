import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type RecaptchaCheck, verifyRecaptcha } from "../../../functions/contact-form/recaptcha.js";

const check: RecaptchaCheck = {
    secret: "secret",
    token: "token",
    expectedAction: "contact_contact",
    allowedHostnames: ["www.example.com"],
    minScore: 0.5,
};

type SiteverifyBody = {
    success: boolean;
    score?: number;
    action?: string;
    hostname?: string;
    "error-codes"?: string[];
};

const answering =
    (body: SiteverifyBody, status = 200): typeof fetch =>
    async () =>
        new Response(JSON.stringify(body), { status });

const passing: SiteverifyBody = {
    success: true,
    score: 0.9,
    action: "contact_contact",
    hostname: "www.example.com",
};

describe("verifyRecaptcha", () => {
    it("passes a good token", async () => {
        assert.deepEqual(await verifyRecaptcha(check, answering(passing)), {
            kind: "pass",
            score: 0.9,
        });
    });

    it("reports unconfigured without a secret, before looking at the token", async () => {
        const verdict = await verifyRecaptcha(
            { ...check, secret: null, token: "" },
            answering(passing),
        );

        assert.deepEqual(verdict, { kind: "unconfigured" });
    });

    it("reports a missing token", async () => {
        assert.deepEqual(await verifyRecaptcha({ ...check, token: "" }, answering(passing)), {
            kind: "missing-token",
        });
    });

    it("rejects a low score", async () => {
        const verdict = await verifyRecaptcha(check, answering({ ...passing, score: 0.3 }));

        assert.equal(verdict.kind, "reject");
    });

    it("rejects a token minted for another action", async () => {
        const verdict = await verifyRecaptcha(check, answering({ ...passing, action: "login" }));

        assert.equal(verdict.kind, "reject");
    });

    it("rejects a token minted on another hostname", async () => {
        const verdict = await verifyRecaptcha(
            check,
            answering({ ...passing, hostname: "evil.example" }),
        );

        assert.equal(verdict.kind, "reject");
    });

    it("rejects a token Google refuses", async () => {
        const verdict = await verifyRecaptcha(
            check,
            answering({ success: false, "error-codes": ["timeout-or-duplicate"] }),
        );

        assert.equal(verdict.kind, "reject");
    });

    it("treats a wrong secret as unavailable rather than as a bot", async () => {
        const verdict = await verifyRecaptcha(
            check,
            answering({ success: false, "error-codes": ["invalid-input-secret"] }),
        );

        assert.equal(verdict.kind, "unavailable");
    });

    it("treats a server error as unavailable", async () => {
        assert.equal((await verifyRecaptcha(check, answering(passing, 503))).kind, "unavailable");
    });

    it("treats a network failure as unavailable", async () => {
        const failing: typeof fetch = async () => {
            throw new TypeError("fetch failed");
        };

        assert.equal((await verifyRecaptcha(check, failing)).kind, "unavailable");
    });
});
