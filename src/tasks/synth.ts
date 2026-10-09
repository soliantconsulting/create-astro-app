import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    type AwsEnvContext,
    createSynthTask,
    execute,
    type ProjectContext,
} from "@soliantconsulting/starter-lib";
import type { FeaturesContext } from "./features.js";
import type { StagingDomainContext } from "./staging-domain.js";

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
        ignoreList: (
            context: ProjectContext &
                Partial<AwsEnvContext & FeaturesContext & StagingDomainContext>,
        ) => {
            const list: string[] = [];

            if (!context.awsEnv) {
                list.push("cdk");
                list.push("bitbucket-pipelines.yml.liquid");
            }

            if (!context.stagingDomain) {
                list.push(".sld-dns-control.json.liquid");
            }

            if (!context.features?.includes("contact-form")) {
                list.push("src/forms");
                list.push("src/pages/contact.astro");
                list.push("src/pages/thank-you.astro");
                list.push("cdk/src/contact-form.ts.liquid");
            }

            return list;
        },
    },
);
