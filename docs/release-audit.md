# 0.1.0 publication review

## Findings and resolution

| Finding                                                                     | Resolution                                                                                                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate legacy local bridge shipped beside the application                 | Removed bridge runtime, identity helpers, unused wrapper and obsolete bridge tests after reference checks                                                 |
| Legacy key challenge routes bypassed the current account-creation flow      | Retired with HTTP 410; tests now use supported login-key creation/login                                                                                   |
| Completion was described as a plugin-only operation                         | Added browser completion recording using the existing authorization, version and stale-plan checks                                                        |
| Prompts, approval copy and help implied an unfinished IDE product           | Replaced with the standalone specification/planning boundary and user-selected implementation environment                                                 |
| Health/AI initialization advertised 0.2.0 independently of package metadata | Both now use the package version, released as 0.1.0                                                                                                       |
| No installable package entry point or deterministic release payload         | Added CLI, runtime file allowlist, prebuilt frontend ZIP, lockfile and SHA-256 checksums                                                                  |
| Browser verification depended on a developer's absolute Chromium path       | Uses the pinned Playwright installation or an explicit `CODING_CHROMIUM` override                                                                         |
| Local data and LAN test CA were present in the working directory            | Entire runtime/data directories, certificates, keys, database files, environment and registry credentials excluded; release content is scanned separately |
| No publication pipeline                                                     | Added complete GitHub Actions CI and gated tag-based npm/ZIP release                                                                                      |

Framework plugins used by Vue, Vite, and ProseMirror remain necessary internal dependencies. Stored legacy documents and edited user skills remain data; they are neither published nor reset for this release.

## Validation evidence

Local and GitHub Actions runs cover formatting, lint, syntax, unit/integration tests, production and development browser flows, language switching, dependency auditing, repository/package file inspection, and isolated npm installation. Exact results are recorded in [GitHub Actions](https://github.com/jjjuuuun/codewith/actions). Test counts change when obsolete tests are removed or focused regression tests are added.

README screenshots use a newly created synthetic workspace and illustrative assessments. They contain no exported personal workspace, account credentials, real project path, or private conversation.

Live external AI/SSO/mail and physical-phone passkeys are not certified by mock/virtual tests. AI plan scores do not certify implementation correctness. This initial public release is a self-hosted planning workspace, not a distributed IDE execution platform.

## Documentation references

README organization was informed by the concise introduction, product screenshot, feature overview, and installation sections in [Open WebUI](https://github.com/open-webui/open-webui/blob/main/README.md) and [LocalAI](https://github.com/mudler/LocalAI/blob/master/README.md). Their product claims and artwork were not copied.

Publication follows [GitHub's npm registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry), [Actions security guidance](https://docs.github.com/en/actions/reference/security/secure-use), and the [MIT license conditions](https://choosealicense.com/licenses/mit/).
