# Security policy

SPDX-License-Identifier: Apache-2.0

This repository is an experimental developer preview for synthetic data. Do not use it with PHI, production payloads, credentials, or healthcare decisions.

## Boundary

- Raw input is read inside a one-use browser Worker and is not sent to the local coordinator or MCP server.
- A user must review and approve a value-minimized structural summary before a configured AI host can retrieve it.
- The AI host may send that approved summary to its provider. This project does not control the provider's retention or account policy.
- The loopback coordinator stores active cases only in memory. Same-user malware, browser compromise, memory inspection, screenshots, clipboard capture, and a compromised host are explicit limitations.
- JavaScript and browser garbage collectors may retain copies despite best-effort buffer overwrite.

## Reports

Do not include payloads, handles, local paths, or secrets in a report. Use GitHub's private vulnerability-reporting feature when enabled, or contact the repository owner through the security contact listed on the ImOnFHIR organization profile.
