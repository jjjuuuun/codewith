# Contributing

Start with an issue describing the problem and expected behavior, or submit a focused pull request with reproduction steps and validation results.

Use Node.js 22.13+ and `npm ci`. Run `npm run dev` for local development. Keep private workspaces, `.env`, keys, certificates, database files and AI credentials out of commits.

Before submitting, run formatting, lint, syntax, tests and build checks listed in the README. UI changes should include screenshots from synthetic data and cover both languages and narrow/wide layouts. Preserve revision checks, unsaved drafts, user isolation and sandboxed plan rendering.

Translations live in `src/i18n/`. The English catalog uses Korean source-message keys; add both forms for new UI strings and preserve interpolation arguments. Do not translate user-authored documents automatically.

Read `AGENTS.md` for repository conventions. Contributions are accepted under the repository's MIT license. Do not submit code or assets you lack permission to distribute.
