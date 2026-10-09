#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
    type AwsEnvContext,
    type DeployRoleContext,
    type ProjectContext,
    runPipeline,
    type SentryContext,
} from "@soliantconsulting/starter-lib";
import type { FeaturesContext } from "./tasks/features.js";
import type { StagingDomainContext } from "./tasks/staging-domain.js";
import { synthTask } from "./tasks/synth.js";

type BaseContext = ProjectContext &
    AwsEnvContext &
    DeployRoleContext &
    FeaturesContext &
    StagingDomainContext &
    SentryContext;

await runPipeline({
    packageName: "@soliantconsulting/create-astro-app",
    tasks: [synthTask],
    baseContext: {
        project: {
            name: "test-synth",
            title: "Test Synth",
            path: fileURLToPath(new URL("../test-synth", import.meta.url)),
        },
        awsEnv: {
            accountId: "123456789",
            region: "us-east-1",
        },
        deployRole: {
            arn: "arn://unknown",
        },
        stagingDomain: {
            domainName: "example.com",
            certificateArn: "arn://example",
        },
        sentry: {
            org: "soliant-consulting-inc",
            projectSlug: "test-synth",
            dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
            authToken: "sntrys_example",
            authTokenId: "0",
        },
        features: ["contact-form"],
    } satisfies BaseContext,
});
