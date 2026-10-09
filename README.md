# Create Astro App

Init project for creating Astro static site projects, hosted on S3 and CloudFront, with Bitbucket Pipelines and CDK integration.

To create a new project, run the following command:

```pnpm dlx @soliantconsulting/create-astro-app@latest [<site-name>]```

The script will place the project in a directory with the given site name under the current working directory.

Setup can also add a contact form. Submissions are checked with reCAPTCHA v3 and emailed through Amazon SES to the addresses you enter; the generated project's README covers what was set up and what is left to do.
