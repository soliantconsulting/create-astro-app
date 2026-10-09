import {
    CreateSecretCommand,
    PutSecretValueCommand,
    ResourceExistsException,
    SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
    AlreadyExistsException,
    CreateEmailIdentityCommand,
    GetAccountCommand,
    GetEmailIdentityCommand,
    NotFoundException,
    SESv2Client,
} from "@aws-sdk/client-sesv2";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import {
    DnsControlClient,
    defaultConfig,
    toRelativeName,
} from "@soliantconsulting/sld-dns-control-client";
import {
    type AwsEnvContext,
    type ProjectContext,
    requireContext,
} from "@soliantconsulting/starter-lib";
import type { ListrTask } from "listr2";
import type { FeaturesContext } from "./features.js";
import type { StagingDomainContext } from "./staging-domain.js";

export type ContactFormContext = {
    contactForm: {
        recipients: string[];
        senderAddress: string;
        timeZone: string;
        alarmEmail: string | null;
        recaptchaSiteKey: string;
        recaptchaSecretName: string;
    } | null;
};

type ContactFormTaskContext = Partial<
    ProjectContext & AwsEnvContext & FeaturesContext & StagingDomainContext & ContactFormContext
>;

type Note = (line: string) => void;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseEmailList = (input: string): string[] =>
    input
        .split(/[\s,;]+/)
        .map((address) => address.trim())
        .filter((address) => address !== "");

const validateEmailList = (input: string): true | string => {
    const addresses = parseEmailList(input);

    if (addresses.length === 0) {
        return "Enter at least one email address";
    }

    const invalid = addresses.find((address) => !emailPattern.test(address));
    return invalid === undefined ? true : `"${invalid}" is not an email address`;
};

const validateTimeZone = (input: string): true | string =>
    Intl.supportedValuesOf("timeZone").includes(input.trim())
        ? true
        : "Enter an IANA time zone, such as America/Chicago";

const validateOptionalEmail = (input: string): true | string =>
    input.trim() === "" || emailPattern.test(input.trim()) ? true : "Enter an email address";

export const recaptchaSecretName = (projectName: string, environment: string): string =>
    `${projectName}/${environment}/recaptcha-secret-key`;

export const contactFormTask: ListrTask<ContactFormTaskContext> = {
    title: "Configure contact form",
    // DNS records for a sender outside soliant-dev.io are printed here for someone to add by hand,
    // so the output has to outlive the task.
    rendererOptions: {
        persistentOutput: true,
        outputBar: Number.POSITIVE_INFINITY,
    },
    task: async (context, task): Promise<void> => {
        const features = requireContext(context, "features");

        if (!features.includes("contact-form")) {
            context.contactForm = null;
            task.skip("Contact form not selected");
            return;
        }

        const project = requireContext(context, "project");
        const awsEnv = requireContext(context, "awsEnv");
        const stagingDomain = requireContext(context, "stagingDomain");
        const prompt = task.prompt(ListrEnquirerPromptAdapter);

        const recipients = parseEmailList(
            await prompt.run<string>({
                type: "input",
                message:
                    "Email address(es) that receive contact form submissions (comma separated):",
                validate: validateEmailList,
            }),
        );

        const senderAddress =
            stagingDomain === null
                ? await prompt.run<string>({
                      type: "input",
                      message: "Staging sender address (its domain must be verified in SES):",
                      validate: (input: string) =>
                          emailPattern.test(input.trim()) ? true : "Enter an email address",
                  })
                : `noreply@${stagingDomain.domainName}`;

        const timeZone = (
            await prompt.run<string>({
                type: "input",
                message: "Time zone for submission times in the emails (IANA name):",
                initial: "America/Chicago",
                validate: validateTimeZone,
            })
        ).trim();

        const alarmEmail = (
            await prompt.run<string>({
                type: "input",
                message: "Email for undeliverable-submission alarms (blank to skip):",
                validate: validateOptionalEmail,
            })
        ).trim();

        const recaptchaSiteKey = (
            await prompt.run<string>({
                type: "input",
                message: "reCAPTCHA v3 site key for staging (blank to add later):",
            })
        ).trim();

        // A stored secret with no site key in the build would reject every visitor, so the secret
        // is only asked for alongside a site key.
        const recaptchaSecretKey =
            recaptchaSiteKey === ""
                ? ""
                : (
                      await prompt.run<string>({
                          type: "password",
                          message: "reCAPTCHA v3 secret key that pairs with that site key:",
                          validate: (input: string) =>
                              input.trim() === "" ? "Enter the secret key for the site key" : true,
                      })
                  ).trim();

        context.contactForm = {
            recipients,
            senderAddress: senderAddress.trim(),
            timeZone,
            alarmEmail: alarmEmail === "" ? null : alarmEmail,
            recaptchaSiteKey,
            recaptchaSecretName: recaptchaSecretName(project.name, "staging"),
        };

        // The task keeps every value assigned to its output on screen (persistentOutput with an
        // unbounded output bar), so each note is assigned on its own.
        const note = (line: string): void => {
            task.output = line;
        };

        if (awsEnv === null) {
            note("AWS environment disabled, skipping SES and Secrets Manager setup");
            return;
        }

        const contactForm = context.contactForm;
        const ses = new SESv2Client({ region: awsEnv.region });
        const senderDomain = contactForm.senderAddress.split("@")[1];

        await verifySenderDomain(ses, senderDomain, note);
        await verifySandboxRecipients(ses, contactForm.recipients, note);

        if (recaptchaSecretKey !== "") {
            await storeRecaptchaSecret(
                new SecretsManagerClient({ region: awsEnv.region }),
                contactForm.recaptchaSecretName,
                recaptchaSecretKey,
            );
        }
    },
};

const getDkimTokens = async (ses: SESv2Client, domain: string): Promise<string[]> => {
    try {
        const created = await ses.send(
            new CreateEmailIdentityCommand({
                EmailIdentity: domain,
                DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" },
            }),
        );

        return created.DkimAttributes?.Tokens ?? [];
    } catch (error) {
        if (!(error instanceof AlreadyExistsException)) {
            throw error;
        }

        const existing = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
        return existing.DkimAttributes?.Tokens ?? [];
    }
};

const verifySenderDomain = async (ses: SESv2Client, domain: string, note: Note): Promise<void> => {
    const tokens = await getDkimTokens(ses, domain);

    if (tokens.length === 0) {
        throw new Error(`SES returned no DKIM tokens for ${domain}`);
    }

    const records = tokens.map((token) => ({
        name: `${token}._domainkey.${domain}`,
        value: `${token}.dkim.amazonses.com`,
    }));

    if (!domain.endsWith(`.${defaultConfig.zoneName}`)) {
        note(`Add these DKIM CNAME records to the DNS for ${domain} so SES can verify it:`);

        for (const record of records) {
            note(`  ${record.name} CNAME ${record.value}`);
        }

        return;
    }

    const dns = new DnsControlClient();

    for (const record of records) {
        await dns.upsertRecord({
            name: toRelativeName(record.name, defaultConfig.zoneName),
            type: "CNAME",
            value: record.value,
        });
    }

    note(`Published DKIM records for ${domain}; SES verifies it within minutes`);
};

const isVerifiedIdentity = async (ses: SESv2Client, identity: string): Promise<boolean> => {
    try {
        const result = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: identity }));
        return result.VerifiedForSendingStatus === true;
    } catch (error) {
        if (error instanceof NotFoundException) {
            return false;
        }

        throw error;
    }
};

/**
 * Requests verification for each recipient while the account is in the SES sandbox.
 *
 * A sandboxed account can only deliver to verified addresses, so without this the first real
 * submission is rejected. SES emails each newly requested address a link; nothing is delivered to
 * that address until someone clicks it. An address already awaiting verification gets no second
 * email, since SES has no resend. Does nothing once the account has production access.
 */
const verifySandboxRecipients = async (
    ses: SESv2Client,
    recipients: string[],
    note: Note,
): Promise<void> => {
    const account = await ses.send(new GetAccountCommand({}));

    if (account.ProductionAccessEnabled === true) {
        return;
    }

    const emailed: string[] = [];
    const stillPending: string[] = [];

    for (const recipient of recipients) {
        if (await isVerifiedIdentity(ses, recipient)) {
            continue;
        }

        try {
            await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: recipient }));
            emailed.push(recipient);
        } catch (error) {
            if (!(error instanceof AlreadyExistsException)) {
                throw error;
            }

            stillPending.push(recipient);
        }
    }

    if (emailed.length > 0) {
        note(`SES is in the sandbox. Verification emails sent to: ${emailed.join(", ")}`);
    }

    if (stillPending.length > 0) {
        note(
            `Still awaiting verification from an earlier request, so SES sent nothing new: ${stillPending.join(", ")}. If that link has expired, delete the identity in the SES console and create it again.`,
        );
    }
};

const storeRecaptchaSecret = async (
    secretsManager: SecretsManagerClient,
    name: string,
    secretKey: string,
): Promise<void> => {
    try {
        await secretsManager.send(
            new CreateSecretCommand({
                Name: name,
                Description: "reCAPTCHA v3 secret key used by the contact form intake Lambda",
                SecretString: secretKey,
            }),
        );
    } catch (error) {
        if (!(error instanceof ResourceExistsException)) {
            throw error;
        }

        await secretsManager.send(
            new PutSecretValueCommand({ SecretId: name, SecretString: secretKey }),
        );
    }
};
