# Changelog

## 0.2.0 — 2026-09-25

### Added

- Optional agent discussion in both single-plan improvement and candidate comparison modes. Writers and discussion reviewers exchange questions, objections and evidence before revision.
- Separate discussion reviewer count (1–3) and per-reviewer model settings, shown when discussion is enabled. Final evaluator settings are used only for independent scoring.
- Saved discussion transcripts, unresolved issues, and explicit discussion stop reasons. Discussion ends on agreement, lack of new evidence, or reserved call budget, without a fixed turn limit.
- Regression coverage for model separation, configurable reviewer counts, call-budget reservation, settings persistence and responsive controls.

### Changed

- Discussion uses the existing call/time budgets and reserves calls for plan revision and independent evaluation. Scoring sessions receive no discussion transcript; specifications, rubrics and approval requirements remain unchanged.

### Fixed

- Login-page language and theme selectors now share the internal toolbar's spacing. On narrow screens they occupy their own row to avoid overlapping the logo.

- Package installation checks select the current version explicitly, even when older release archives are present locally.

- Browser checks allow time for initial WebAuthn loading and the longer development-mode suite on slower environments while retaining registration and login assertions.

### Upgrade notes

- Discussion is disabled by default. Existing settings and saved plans remain compatible; the new discussion role defaults to one reviewer using the currently selected AI model when none is assigned.
- No database migration or account reconfiguration is required. Restart the application and refresh the browser after upgrading.

## 0.1.0

Initial public standalone release. Includes specification editing, AI planning and evaluation loops, version review and approval, browser completion records, personal/team deployment, English/Korean UI, and npm/ZIP distribution with GitHub Actions validation.

Removed the obsolete companion local bridge, legacy identity sign-in implementation, and plugin-only workflow assumptions. Existing private runtime data is excluded from publication.
