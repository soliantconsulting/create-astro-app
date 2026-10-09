#!/usr/bin/env node

import {
    createAwsEnvTask,
    createBitbucketRepositoryTask,
    createDeployRoleTask,
    createGitTask,
    createNodeVersionTask,
    createPnpmVersionTask,
    createProjectTask,
    createSentryTask,
    runPipeline,
} from "@soliantconsulting/starter-lib";
import { contactFormTask } from "./tasks/contact-form.js";
import { featuresTask } from "./tasks/features.js";
import { sentryVariableTask } from "./tasks/sentry-variable.js";
import { stagingDomainTask } from "./tasks/staging-domain.js";
import { synthTask } from "./tasks/synth.js";

await runPipeline({
    packageName: "@soliantconsulting/create-astro-app",
    tasks: [
        createPnpmVersionTask("11.0.0"),
        createNodeVersionTask("22.12.0"),
        createProjectTask(),
        createAwsEnvTask(),
        createBitbucketRepositoryTask(),
        createDeployRoleTask(),
        stagingDomainTask,
        createSentryTask({ projectPlatform: "javascript-astro" }),
        sentryVariableTask,
        featuresTask,
        contactFormTask,
        synthTask,
        createGitTask(),
    ],
});
