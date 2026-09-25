# CI and releases

## Pull requests and main

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, manual dispatch, and calls from the release workflow.

| Gate                    | Checks                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Quality, Node 22 and 24 | Clean `npm ci`, Prettier, ESLint, syntax, production build, all unit/integration tests, dependency audit, public-file checks |
| Databases               | Isolated PostgreSQL and MariaDB containers, persisted state, restart and login                                               |
| Secrets                 | Gitleaks on repository history; no production credentials required                                                           |
| Browser                 | Chromium production regression, English/Korean switching, development-server regression                                      |
| Package                 | Build, npm allowlist and source checks, ZIP/tarball/checksums, isolated installation and HTTP startup smoke test             |

Read-only permissions are the default. Publishing permissions exist only in the release publication job. Actions are pinned to commit SHAs. Automatic dependency-update PRs are disabled to keep only the main branch; dependency auditing remains required in CI. Browser failures retain synthetic test screenshots briefly as CI artifacts.

ESLint uses JavaScript recommended and Vue essential rules. Unused action-adapter arguments and shared editor-prop mutation follow the existing architecture; control-byte sanitizer expressions and empty test iterators have scoped exceptions. These are documented lint boundaries, not a claim of exhaustive static verification.

## Publish a version

1. Update `package.json`, `package-lock.json`, `CHANGELOG.md`, `docs/release-notes.md`, and versioned installation examples.
2. Run the same local gates as CI. `npm run release:bundle` requires a built frontend and the intended public files staged in Git.
3. Push the reviewed commit to `main`; confirm CI is green.
4. Tag that commit, for example `git tag -a v0.2.0 -m 'CodeWith 0.2.0'`, and push the tag.
5. `release.yml` calls the complete CI workflow for that tag. It downloads the verified release candidate, checks tag/version agreement and SHA-256 hashes, publishes the npm tarball to GitHub Packages, and creates the GitHub release with the ZIP, tarball, and checksums.

No manually stored npm token is required for CI publishing: the repository's short-lived `GITHUB_TOKEN` has `packages: write` in that job. The package is associated with the repository through package metadata. Check package visibility in GitHub after first publication; GitHub Packages may initially create packages as private. Set it to public for the public distribution.

If publication fails after all six tag verification jobs passed, manually dispatch `Release` with the existing tag and its validated run ID. Recovery checks the tag commit, original workflow and all six successful jobs before downloading the original checksummed artifact. It never rebuilds or moves the tag.

Published npm versions are immutable. If a publication partially succeeds, inspect the registry and release before retrying. Do not force-move a published tag or silently replace a version's artifacts. Publish a new patch version for changed code.

## Scope of verification

Temporary fixtures cover app behavior, provider contracts, storage, access control, and virtual WebAuthn. CI does not log in to real AI accounts, send real email, test a real identity provider, or validate physical-phone passkeys. CI also runs `npm run test:db` against isolated PostgreSQL and MariaDB containers.
