# Security

Report authentication bypasses, cross-user access, secret exposure, unsafe project writes, or plan-rendering issues privately through [GitHub security advisories](https://github.com/jjjuuuun/codewith/security/advisories/new). Do not publish credentials or real workspace exports in an issue.

The latest public release is the supported version. Include the version, deployment mode, reproduction using synthetic data, and expected versus observed behavior.

Keep the data directory, `.env`, provider credentials and TLS private keys outside source control. Use trusted HTTPS for remote authentication, restrict project roots, run one application server per store, and back up data before upgrading. Only load trusted custom database adapters: they execute as server modules.

AI responses and plan HTML are untrusted input. Retain sandbox/CSP restrictions and explicit approval for actions. An evaluation score or user completion record is not independent proof that project tests ran successfully.
