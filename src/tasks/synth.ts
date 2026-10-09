import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    type AwsEnvContext,
    createSynthTask,
    execute,
    type ProjectContext,
    type SentryContext,
} from "@soliantconsulting/starter-lib";
import type { ContactFormContext } from "./contact-form.js";
import type { StagingDomainContext } from "./staging-domain.js";

type SynthContext = ProjectContext &
    Partial<AwsEnvContext & StagingDomainContext & SentryContext & ContactFormContext>;

export const synthTask = createSynthTask(
    fileURLToPath(new URL("../../skeleton", import.meta.url)),
    {
        postInstall: async (context: ProjectContext & Partial<AwsEnvContext>, task) => {
            if (context.awsEnv) {
                await execute(task.stdout(), "pnpm", ["install"], {
                    cwd: join(context.project.path, "cdk"),
                });
            }
        },
        ignoreList: (context: SynthContext) => {
            const list: string[] = [];

            if (!context.awsEnv) {
                list.push("cdk");
                list.push("bitbucket-pipelines.yml.liquid");
            }

            if (!context.stagingDomain) {
                list.push(".sld-dns-control.json.liquid");
            }

            if (!context.sentry) {
                list.push("sentry.client.config.js.liquid");
                list.push("functions/contact-form/sentry.ts");
            }

            if (!context.contactForm) {
                list.push("functions");
                list.push("test");
                list.push("src/forms");
                list.push("src/components/ContactForm.astro");
                list.push("src/components/Honeypot.astro");
                list.push("src/pages/contact.astro");
                list.push("src/pages/thank-you.astro");
                list.push("cdk/src/contact-form.ts.liquid");
            }

            return list;
        },
    },
);
