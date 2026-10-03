# Security Policy

## Supported Versions

Langouste is pre-1.0. Security fixes are made on the `main` branch unless a release branch is explicitly announced.

## Reporting A Vulnerability

Please do not report vulnerabilities through public GitHub issues.

Report security issues through GitHub's private vulnerability reporting for this repository when available, or email the repository owner listed on the GitHub project.

Include:

- Affected version or commit.
- Steps to reproduce.
- Impact and affected data or systems.
- Any known workaround.

We aim to acknowledge high-severity reports within 72 hours.

## Scope

Security-sensitive areas include application-owned authentication, ownership
and membership filters, token handling, agent connectors, provider API keys,
turbopuffer namespace access, imports, and any path that can expose learner
messages or credentials.
