# Security Policy

## Supported Versions

This repository does not currently publish a release support matrix. Security fixes are made against the maintained default branch; use the latest available build and apply required database migrations before enabling affected features.

## Reporting a Vulnerability

Please do not report security vulnerabilities in public issues or discussions. Use GitHub's private vulnerability reporting for this repository if it is enabled, or contact a repository maintainer privately through the repository's listed contact channel.

Include a concise description, affected component/version, impact, and safe reproduction details. Do not include real client documents, credentials, access tokens, or other personal data. The maintainers will acknowledge and coordinate remediation privately; no response-time SLA is currently published.

## Security Boundaries

- Keep Supabase service-role keys, backend Gemini credentials, Telegram tokens, and other server secrets on the backend; never commit them. The optional Windows OpenRouter key is stored in Windows Credential Manager, but extraction images are sent directly from the desktop to OpenRouter.
- Client documents belong in private Supabase Storage and must be accessed through the authenticated backend.
- Telegram is a messaging channel, not a document-upload channel. Clients should use the secure portal for documents.
- A security report should not include exploit payloads that affect third-party systems or data.
