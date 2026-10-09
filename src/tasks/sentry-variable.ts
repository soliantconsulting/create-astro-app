import {
    BitBucketClient,
    type BitbucketRepositoryContext,
    requireContext,
    type SentryContext,
} from "@soliantconsulting/starter-lib";
import type { ListrTask } from "listr2";

export const sentryVariableTask: ListrTask<Partial<BitbucketRepositoryContext & SentryContext>> = {
    title: "Configure Sentry auth token pipeline variable",
    task: async (context, task): Promise<void> => {
        const bitbucketRepository = requireContext(context, "bitbucketRepository");
        const sentry = requireContext(context, "sentry");

        if (bitbucketRepository === null) {
            task.skip("Bitbucket disabled");
            return;
        }

        if (sentry === null) {
            task.skip("Sentry disabled");
            return;
        }

        const client = new BitBucketClient(
            bitbucketRepository.accessToken,
            bitbucketRepository.workspace,
            bitbucketRepository.repository,
        );

        await client.variables().replace("SENTRY_AUTH_TOKEN", sentry.authToken, true);
    },
};
