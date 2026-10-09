#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
    type AwsEnvContext,
    type DeployRoleContext,
    type ProjectContext,
    runPipeline,
    type SentryContext,
} from "@soliantconsulting/starter-lib";
import type { ContactFormContext } from "./tasks/contact-form.js";
import type { FeaturesContext } from "./tasks/features.js";
import type { StagingDomainContext } from "./tasks/staging-domain.js";
import { synthTask } from "./tasks/synth.js";

type BaseContext = ProjectContext &
    AwsEnvContext &
    DeployRoleContext &
    FeaturesContext &
    StagingDomainContext &
    SentryContext &
    ContactFormContext;

type Variant = "full" | "minimal";

const variant = process.argv[2];

if (variant !== "full" && variant !== "minimal") {
    throw new Error("Usage: test-cli.ts <full|minimal>");
}

const shared = {
    project: {
        name: `test-synth-${variant}`,
        title: "Test Synth",
        path: fileURLToPath(new URL(`../test-synth/${variant}`, import.meta.url)),
    },
    awsEnv: {
        accountId: "123456789012",
        region: "us-east-1",
    },
    deployRole: {
        arn: "arn:aws:iam::123456789012:role/test-synth-deploy",
    },
    stagingDomain: {
        domainName: "test-synth.soliant-dev.io",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/test-synth",
    },
} satisfies Partial<BaseContext>;

const variants: Record<Variant, BaseContext> = {
    full: {
        ...shared,
        sentry: {
            org: "soliant-consulting-inc",
            projectSlug: "test-synth-full",
            dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
            authToken: "sntrys_example",
            authTokenId: "0",
        },
        features: ["contact-form"],
        contactForm: {
            recipients: ["inbox@example.com", "second-inbox@example.com"],
            senderAddress: "noreply@test-synth.soliant-dev.io",
            timeZone: "America/Los_Angeles",
            alarmEmail: "alerts@example.com",
            recaptchaSiteKey: "6LcTestSiteKeyForSynthOnly000000000000000",
            recaptchaSecretName: "test-synth-full/staging/recaptcha-secret-key",
        },
    },
    minimal: {
        ...shared,
        sentry: null,
        features: [],
        contactForm: null,
    },
};

await runPipeline({
    packageName: "@soliantconsulting/create-astro-app",
    tasks: [synthTask],
    baseContext: variants[variant],
});
