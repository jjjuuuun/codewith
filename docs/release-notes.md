# CodeWith 0.2.0

CodeWith now supports optional discussion between plan writers and dedicated discussion reviewers before revising a plan.

- Enable **Agent discussion** in **Plan execution settings** for either planning mode.
- Configure **1–3 discussion reviewers** and their models separately from final evaluators. Writers, discussion reviewers and final evaluators can use different connected models.
- Let participants exchange questions, objections and evidence without a fixed turn limit. Discussion ends when they are ready to revise, have no new evidence, or must preserve the remaining revision/evaluation calls.
- Review saved discussion transcripts and unresolved issues. Final evaluation runs in fresh sessions without the discussion transcript, using the existing criteria and scoring rubric.
- Login-page language/theme controls have consistent spacing and no longer overlap the logo on narrow screens.

## Upgrading

Discussion is off by default. Existing accounts, settings and plans remain compatible; no database migration is required. New discussion settings default to one reviewer using the currently selected AI model if no model is assigned. Restart CodeWith and refresh the browser after upgrading, then enable discussion if desired.

Requires Node.js 22.13+. Download `codewith-0.2.0.zip` for a prebuilt application, or install `@jjjuuuun/codewith@0.2.0` from GitHub Packages. The npm registry requires authentication; the release ZIP does not.

Discussion calls share the existing call/time budgets. AI assessments remain judgments about the plan, not evidence that project tests ran or passed. Live provider accounts and physical passkeys are outside the mock/virtual regression checks.

한국어: 계획 실행 설정에서 토론을 켜면 토론 검토자 수·모델을 최종 평가자와 별도로 설정할 수 있습니다. 기존 계획과 계정은 유지되며, 업그레이드 후 서버 재시작과 브라우저 새로고침이 필요합니다.
