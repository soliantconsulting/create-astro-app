import { ACM, CertificateStatus } from "@aws-sdk/client-acm";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { issueCertificate } from "@soliantconsulting/sld-dns-control-client";
import { type AwsEnvContext, requireContext } from "@soliantconsulting/starter-lib";
import type { ListrTask } from "listr2";

export type StagingDomainContext = {
    stagingDomain: {
        domainName: string;
        certificateArn: string;
    } | null;
};

type Mode = "issue" | "existing";

export const stagingDomainTask: ListrTask<Partial<AwsEnvContext & StagingDomainContext>> = {
    title: "Configure staging domain",
    task: async (context, task): Promise<void> => {
        const prompt = task.prompt(ListrEnquirerPromptAdapter);
        const awsEnvContext = requireContext(context, "awsEnv");

        if (awsEnvContext === null) {
            context.stagingDomain = null;
            task.skip("AWS environment disabled");
            return;
        }

        const mode = await prompt.run<Mode>({
            type: "select",
            message: "Staging certificate:",
            choices: [
                {
                    message: "Issue new for a soliant-dev.io subdomain (recommended)",
                    name: "issue",
                },
                { message: "Pick an existing ACM certificate", name: "existing" },
            ],
        });

        context.stagingDomain =
            mode === "issue"
                ? await issueNewCertificate(prompt, task)
                : await pickExistingCertificate(prompt);
    },
};

const issueNewCertificate = async (
    prompt: ListrEnquirerPromptAdapter,
    task: Parameters<NonNullable<ListrTask["task"]>>[1],
): Promise<{ domainName: string; certificateArn: string }> => {
    const input = await prompt.run<string>({
        type: "input",
        message: "Staging subdomain under .soliant-dev.io (e.g. my-app.customer-name):",
    });
    const subdomain = input.replace(/\.soliant-dev\.io$/, "");
    const domainName = `${subdomain}.soliant-dev.io`;

    task.output =
        "Issuing certificate in us-east-1 (a browser window will open for sign-in if needed)…";

    const certificateArn = await issueCertificate({
        domainName,
        region: "us-east-1",
        onProgress: (event) => {
            if (event.kind === "requested") {
                task.output = `Requested ${event.certificateArn}`;
            } else if (event.kind === "validation-records-ready") {
                task.output = `Publishing ${event.records.length} validation record(s)…`;
            } else if (event.kind === "validation-records-published") {
                task.output = "Validation records published, waiting for issuance…";
            } else if (event.kind === "issued") {
                task.output = "Certificate issued";
            }
        },
    });

    return { domainName, certificateArn };
};

const pickExistingCertificate = async (
    prompt: ListrEnquirerPromptAdapter,
): Promise<{ domainName: string; certificateArn: string }> => {
    const domainName = await prompt.run<string>({
        type: "input",
        message: "Domain name:",
    });

    const acm = new ACM({ region: "us-east-1" });
    const result = await acm.listCertificates({
        CertificateStatuses: [CertificateStatus.ISSUED],
    });

    if (!result.CertificateSummaryList || result.CertificateSummaryList.length === 0) {
        throw new Error("No issued certificates found in region us-east-1");
    }

    const matchingCertificates = result.CertificateSummaryList.filter((certificate) => {
        const domainNames = [
            certificate.DomainName,
            ...(certificate.SubjectAlternativeNameSummaries ?? []),
        ];

        if (domainNames.includes(domainName)) {
            return true;
        }

        const parent = domainName.split(".").slice(1).join(".");
        const wildcard = `*.${parent}`;

        return domainNames.includes(wildcard);
    });

    if (matchingCertificates.length === 0) {
        throw new Error("No matching certificates found in region us-east-1");
    }

    const certificateArn = await prompt.run<string>({
        type: "select",
        message: "Certificate:",
        choices: matchingCertificates.map((certificate) => ({
            message: certificate.DomainName,
            name: certificate.CertificateArn,
        })),
    });

    return { domainName, certificateArn };
};
