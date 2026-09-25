import { discussPlan } from "./plan-discussion.mjs";
import { createHash } from "node:crypto";
import { PLAN_RUBRIC, summarizeReviews } from "../shared/plan-workflow.mjs";
import {
  comparePlanProgress,
  planProgressDelta,
} from "../shared/plan-loop.mjs";
import { problem } from "../shared/schema.mjs";

export async function runAdaptivePlanLoop({
  settings,
  rubric = PLAN_RUBRIC,
  context,
  criteria,
  candidates,
  sessions,
  skills,
  calls,
  usedCalls,
  call,
  review,
  controlled,
  parallel,
  agent,
  validateDraft,
  validateAnswer,
  emit,
  onCheckpoint,
  resumeState,
  evaluateOnly,
}) {
  const summarize = (c) =>
    summarizeReviews(c.reviews, criteria, settings.targetScore, rubric);
  const rank = () =>
    [...candidates].sort((a, b) =>
      comparePlanProgress(summarize(b), summarize(a)),
    );
  const rounds = structuredClone((resumeState?.rounds || []).slice(-64));
  const discussions = structuredClone(resumeState?.discussions || []);
  let bestCandidates = [];
  let bestEvaluatedAt;
  let best = null,
    latest = null,
    stopReason = null;
  let stalled = resumeState?.stalled || 0,
    alternative =
      resumeState?.alternative || resumeState?.stopReason === "stagnation";
  const snapshot = () => ({
    answer: best.answer,
    provider: best.provider,
    model: best.model,
    evaluation: {
      targetScore: settings.targetScore,
      rubricId: rubric.id,
      ...(rubric.requirements ? { rubric: structuredClone(rubric) } : {}),
      rubricHash: createHash("sha256")
        .update(
          JSON.stringify({
            rubric,
            skills,
            criteria,
            target: settings.targetScore,
          }),
        )
        .digest("hex"),
      evaluatedAt: bestEvaluatedAt,
      selectedId: best.id,
      criteria,
      candidates: bestCandidates.map(({ answer, ...candidate }) => candidate),
    },
    execution: {
      settings,
      skills,
      calls: [...calls].sort((a, b) => a.call - b.call),
      loop: {
        target: settings.targetScore,
        stopReason,
        rounds: structuredClone(rounds),
        discussions: structuredClone(discussions),
        nextAction: rounds.at(-1)?.nextAction,
        checkpoint: {
          best: structuredClone(best),
          latest: structuredClone(latest),
        },
        stalled,
        alternative,
      },
    },
  });
  async function checkpoint() {
    await onCheckpoint?.(snapshot());
  }
  async function revise(round) {
    const baseline = best;
    let discussion = null;
    if (settings.discussion) {
      discussion = { round, messages: [], stopReason: null };
      discussions.push(discussion);
      await discussPlan({
        settings,
        context,
        criteria,
        rubric,
        baseline,
        candidates,
        call,
        controlled,
        agent,
        usedCalls,
        validateAnswer,
        discussion,
        checkpoint,
      });
    }
    for (let i = 0; i < candidates.length; i++) {
      // Every candidate branches from the best assessed plan, preserving improvements.
      candidates[i] = {
        ...candidates[i],
        answer: structuredClone(baseline.answer),
        reviews: structuredClone(baseline.reviews),
      };
    }
    await parallel(
      candidates.map((c, i) =>
        controlled(sessions[i], async () => {
          const changed = await call(
            `계획 개선 ${round + 1} · 후보 ${i + 1}`,
            { provider: c.provider, model: c.model },
            `CODEWITH_PLAN_REVISION\n고정 명세·코드·지침: ${context}\n출력 계약: 기존 요구사항별 .html 경로를 유지하고 content 객체에 implementation, before, after, ui, mockup, database, verification 문자열을 반환한다.\n명세와 완료 기준·배점을 고정한다. 기존 기준을 낮추거나 삭제하지 않는다.\n${alternative ? "접근 변경: 같은 수정은 반복하지 않는다. 이전 시도가 지적을 해결하지 못한 원인을 분석하고, 제공된 코드 근거를 다시 조사하거나 다른 설계안·작업 분할을 적용한다. 새 접근과 선택 이유를 본문에 남긴다. 사용자만 알 수 있는 필수 정보가 없으면 questions.json으로 질문한다." : "미해결 완료 기준과 차단 문제를 우선 보완한다. 해결 위치와 검증 방법을 명시한다."}\n이전 시도 결과: ${JSON.stringify(rounds.slice(-4))}\n현재 최선의 계획: ${JSON.stringify(c.answer.files)}\n독립 평가 지적: ${JSON.stringify(baseline.reviews)}${discussion ? "\n토론 기록 (합의는 평가 통과를 뜻하지 않음): " + JSON.stringify(discussion) : ""}\nfiles에는 변경한 요구사항 파일만 반환할 수 있다. 변경한 본문과 코드는 완전하게 작성한다.`,
            sessions[i],
          );
          validateAnswer(changed, () => {
            if (
              !Array.isArray(changed.files) ||
              new Set(changed.files.map((f) => f.path)).size !==
                changed.files.length ||
              changed.files.some(
                (f) => !c.answer.files.some((old) => old.path === f.path),
              )
            )
              throw problem(
                "수정 계획의 요구사항 식별자가 올바르지 않습니다.",
                422,
              );
            const files = c.answer.files.map(
              (old) => changed.files.find((f) => f.path === old.path) || old,
            );
            validateDraft(files);
            c.answer = { ...changed, files };
          });
        }),
      ),
    );
  }
  // Re-evaluate a resumed plan against current settings before further changes.
  for (let attempt = 0; ; attempt++) {
    for (const c of candidates) c.reviews = [];
    await parallel(
      Array.from({ length: settings.reviewers }, (_, j) => {
        const session = { id: `judge-${rounds.length}-${j + 1}`, fresh: true };
        return controlled(session, async () => {
          const results = await review(
            `독립 평가 ${rounds.length + 1} · 평가자 ${j + 1}`,
            agent(settings.judges, j),
            candidates,
            session,
          );
          for (const r of results)
            candidates.find((c) => c.id === r.id).reviews.push(r);
        });
      }),
    );
    latest = structuredClone(rank()[0]);
    const summary = summarize(latest),
      previous = best && summarize(best);
    const delta = planProgressDelta(summary, previous);
    const baseline = !best;
    if (!best || comparePlanProgress(summary, previous) > 0) {
      best = structuredClone(latest);
      bestCandidates = structuredClone(candidates);
      bestEvaluatedAt = new Date().toISOString();
    }
    const changedApproach = !baseline && alternative;
    if (!baseline) stalled = delta.improved ? 0 : stalled + 1;
    stopReason = summary.passed
      ? "target_met"
      : evaluateOnly
        ? "evaluated"
        : changedApproach && !delta.improved
          ? "stagnation"
          : null;
    if (delta.improved) alternative = false;
    if (stalled >= 2) alternative = true;
    if (
      !stopReason &&
      usedCalls() + candidates.length + settings.reviewers > settings.maxCalls
    )
      stopReason = "call_budget";
    const lowScores = summary.requirementScores.filter((r) => !r.passed);
    const unmet = summary.criteria.filter((c) => c.status !== "pass");
    const nextAction = summary.passed
      ? "사용자 검토·승인 대기"
      : stopReason === "stagnation"
        ? `다른 접근에서도 진전이 없습니다. 점수 미달 평가 단위 ${lowScores.map((r) => r.id).join(", ") || "없음"}, 미해결 기준 ${unmet.map((c) => c.id).join(", ") || "없음"}, 차단 문제 ${summary.blockingIssues.length}건의 평가 근거를 검토하고 추가 정보나 대안을 준비하세요.`
        : `${alternative ? "접근 변경 · 원인 분석과 대안 검토: " : "보완: "}${unmet[0]?.text || (lowScores.length ? `${lowScores.map((r) => r.id).join(", ")} 계획의 목표 점수 미달` : "") || summary.blockingIssues[0] || "품질 평가 지적"}`;
    const progress = {
      ...summary,
      latestScore: summary.score,
      round: (rounds.at(-1)?.round ?? -1) + 1,
      bestScore: summarize(best).score,
      delta,
      stalled,
      approach: changedApproach ? "alternative" : "revise",
      nextAction,
      stopReason,
      callsUsed: usedCalls(),
      maxCalls: settings.maxCalls,
    };
    rounds.push(progress);
    emit({ type: "plan-loop", ...progress });
    await checkpoint();
    if (stopReason) return snapshot();
    await revise(rounds.length);
  }
}
